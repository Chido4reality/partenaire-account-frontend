// CHECK EXPIRY/LOW — every role reaches it; a role without the value permission sees
// the stock facts but no money (2026-10-08). Renders the REAL page with its data
// stubbed exactly as the server now answers (sees_value + nulls), and reads the three
// places a role list lives: App.jsx route access, Layout's NAV, the badge query.
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__expiry_access.mjs");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");

const STUBS = {
  "react-router-dom": `export const useNavigate = () => () => {};`,
  "@tanstack/react-query": `
    export const useQuery = ({ queryKey }) => ({ data: globalThis.__q[queryKey[0]], isLoading: false, isError: false });
    export const useMutation = () => ({ mutate() {}, isPending: false });
    export const useQueryClient = () => ({ invalidateQueries() {} });`,
  "react-hot-toast": `const t = () => {}; t.success = t; t.error = t; export default t;`,
  "../utils/api": `export default {};`,
  "../store": `export const useLangStore = () => ({ lang: "en" });
               export const useAuthStore = (sel) => { const s = { user: globalThis.__user }; return typeof sel === "function" ? sel(s) : s; };`,
  "../utils/useCurrency": `export const useCurrency = () => (n) => "XAF " + Number(n).toLocaleString("en-US");`,
  "../hooks/useExpiryFeature": `export default () => ({ canExpiry: globalThis.__canExpiry, plan: globalThis.__plan, userIdNumber: "MP-1" });`,
  "../components/common/PaywallModal": `export default () => null;`,
};
await build({
  entryPoints: [resolve(SRC, "pages/CheckExpiryLowPage.jsx")], outfile: OUT, bundle: true, format: "esm", platform: "node",
  jsx: "automatic", logLevel: "silent", external: ["react", "react/jsx-runtime"],
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (STUBS[a.path] !== undefined ? { path: a.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  } }],
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const row = (value) => ({ type: "expiring", product_id: "p1", location_id: "A", product_name: "Yaourt nature", unit: "pcs", category_id: null,
  location_name: "Boutique A", expiry_date: day(20), days_left: 20, bucket: "d30", batch_nos: "LOT-A1", est_qty: 10,
  unit_cost: value ? 500 : null, est_value: value ? 5000 : null });
const serve = (seesValue) => ({ "expiry-check": { success: true, sees_value: seesValue, expiring: [row(seesValue)], low: [], categories: [] },
  locations: { data: [{ id: "A", name: "Boutique A" }] } });

try {
  const { default: Page } = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const render = (role, seesValue, canExpiry = true) => {
    globalThis.__user = { id: "u", role }; globalThis.__canExpiry = canExpiry; globalThis.__plan = canExpiry ? "pro" : "lite";
    globalThis.__q = serve(seesValue);
    return text(renderToString(React.createElement(Page)));
  };

  console.log("\n-- CHECK EXPIRY/LOW: who sees what --\n");
  const cashier = render("cashier", false);
  check("A1 a cashier's screen shows product, quantity, expiry, days left and lot number",
    cashier.includes("Yaourt nature") && /≈ 10\b/.test(cashier) && cashier.includes("Expiry") && /Days left/.test(cashier) && cashier.includes("LOT-A1"),
    cashier.slice(cashier.indexOf("Yaourt"), cashier.indexOf("Yaourt") + 160));
  check("A2 …and NO value: no Value cell, no amount anywhere", !/\bValue\b|Valeur/.test(cashier) && !/XAF/.test(cashier));
  const owner = render("owner", true);
  check("A3 the owner's screen shows the Value", /Value/.test(owner) && owner.includes("XAF 5,000"), owner.match(/Value[^A-Z]{0,30}/)?.[0]);
  const lite = render("cashier", false, false);
  check("A4 Lite plan: the screen is the Pro lock card, no stock shown", lite.includes("part of the Pro plan") && !lite.includes("Yaourt"));
  const liteOwner = render("owner", false, false);
  check("A4 …same for the owner (who alone gets 'See plans')", liteOwner.includes("part of the Pro plan") && liteOwner.includes("See plans") && !lite.includes("See plans"));

  // The three places the role list lives.
  const ALL = ["owner", "manager", "cashier", "warehouse", "accountant"];
  const app = readFileSync(resolve(SRC, "App.jsx"), "utf8");
  const routeRoles = (app.match(/"\/check-expiry-low":\s*\[([^\]]*)\]/) || [])[1] || "";
  check("A5 App.jsx route access lists all five roles", ALL.every((r) => routeRoles.includes(`"${r}"`)), routeRoles);
  const lay = readFileSync(resolve(SRC, "components/common/Layout.jsx"), "utf8");
  const navRoles = (lay.match(/to: "\/check-expiry-low"[^}]*roles: \[([^\]]*)\]/) || [])[1] || "";
  check("A6 the menu entry lists all five roles", ALL.every((r) => navRoles.includes(`"${r}"`)), navRoles);
  const badge = (lay.match(/queryKey: \["expiry-low-badge"\][\s\S]{0,400}?enabled: ([^\n]*)/) || [])[1] || "";
  check("A7 the badge query is gated on the plan only, not on a role list", /track_expiry/.test(badge) && !/includes\(role\)/.test(badge), badge.trim());
} catch (e) {
  fails++; console.log(`  FAIL  threw: ${e.stack || e.message}`);
} finally {
  rmSync(OUT, { force: true });
}
console.log(`\n${fails ? `FAIL (${fails})` : "PASS"}`);
process.exit(fails ? 1 : 0);
