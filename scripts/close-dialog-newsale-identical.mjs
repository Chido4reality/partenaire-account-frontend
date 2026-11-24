// NEW SALE RENDERS IDENTICALLY (2026-11-24): the close-refusal dialog changed src/components/common/ShiftWidgets.jsx,
// which New Sale imports (useActiveShift, the shift chip). New Sale is rendered with the REAL ShiftWidgets twice:
// as on this branch, and with ShiftWidgets as it is at origin/main (CLOSE_NS_BASE). The HTML must be identical in
// EN + FR for a cashier, an owner and a manager. Stubs = the bar layout check's New Sale stubs, minus its
// ShiftWidgets stub (so the changed file really renders).
// Teeth: CLOSE_NS_TEETH=1 changes one visible word in a COPY of the base ShiftWidgets used as "today" → must go RED.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
const BASE = process.env.CLOSE_NS_BASE || "086f219";   // bar branch: the bar app just before the dialog (main lacks the bar changes)
const TEETH = !!process.env.CLOSE_NS_TEETH;
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const tmp = [];
let fails = 0, passes = 0;
const check = (label, ok, detail = "") => { ok ? passes++ : fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`); };

async function bundle(out, stubs, swWhole) {   // swWhole: ShiftWidgets.jsx contents to use instead of the file
  tmp.push(out);
  await build({
    stdin: { contents: `export { default as POS } from "./pages/POSPage";`, resolveDir: SRC, loader: "jsx", sourcefile: "close-ns-entry.jsx" },
    bundle: true, format: "esm", outfile: out, jsx: "automatic", external: ["react", "react/jsx-runtime", "react-dom", "react-dom/server"],
    logLevel: "silent", platform: "node",
    define: { "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }) },
    banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => { for (const k of Object.keys(stubs)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" }; return null; });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
      if (swWhole !== undefined) b.onLoad({ filter: /components[\\/]common[\\/]ShiftWidgets\.jsx$/ }, () => ({ contents: swWhole, loader: "jsx" }));
    } }],
  });
  return import("file:///" + out.replace(/\\/g, "/") + `?t=${Date.now()}`);
}

const POS_STUBS = {
  "@tanstack/react-query": `
    export const useQuery = (o) => { const d = (globalThis.__S.q || {})[o.queryKey[0]]; return { data: d, isLoading: false, isError: false, refetch(){}, isFetching: false }; };
    export const useMutation = () => ({ mutate(){}, mutateAsync: async () => ({}), isPending: false, isLoading: false });
    export const useQueryClient = () => ({ invalidateQueries(){}, setQueryData(){}, getQueryData(){}, getQueriesData: () => [], setQueriesData(){}, cancelQueries: async () => {} });`,
  "utils/api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`,
  "store": `
    const S = () => globalThis.__S;
    const auth = () => ({ user: { id: "u1", role: S().role, full_name: "Ada" }, org: { name: "Shop", currency: "XAF" }, token: "t" });
    export const useAuthStore = (sel) => (typeof sel === "function" ? sel(auth()) : auth()); useAuthStore.getState = auth;
    const lang = () => ({ lang: S().lang });
    export const useLangStore = (sel) => (typeof sel === "function" ? sel(lang()) : lang());
    const set = () => ({ selectedLocation: { id: "loc-1", name: "Bonaberri", type: "shop", sales_mode: "direct" }, setLocation(){} });
    export const useSettingsStore = (sel) => (typeof sel === "function" ? sel(set()) : set()); useSettingsStore.getState = set;
    const draft = { drafts: {}, saveDraft(){}, getDraft(){ return null; }, clearDraft(){} };
    export const useDraftCartStore = (sel) => (typeof sel === "function" ? sel(draft) : draft); useDraftCartStore.getState = () => draft;`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}]; export const useLocation = () => ({ pathname: "/pos", search: "" });`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; t.dismiss = () => {}; export default t;`,
  "MobileShiftChip": `export default function MobileShiftChip(){ return null; }`,
  "MobileCartSheet": `import React from "react"; export default function MobileCartSheet(p){ return React.createElement("div", { "data-sheet": "1" }, p.children); }`,
  "CameraScanner": `export default function CameraScanner(){ return null; }`,
  "framer-motion": `import React from "react"; const P = new Proxy({}, { get: (_, tag) => (p) => { const { initial, animate, exit, transition, whileTap, layout, ...rest } = p; return React.createElement(tag, rest); } }); export const motion = P; export const AnimatePresence = (p) => p.children;`,
  "useLiteMode": `export const useLiteMode = () => false; export default () => false;`,
};

let baseSW = null;
try { baseSW = git("show", `${BASE}:src/components/common/ShiftWidgets.jsx`); } catch { /* */ }
const nowSW = readFileSync(resolve(SRC, "components/common/ShiftWidgets.jsx"), "utf8");
check(`base ShiftWidgets at ${BASE} available and different from this branch (the comparison means something)`, !!baseSW && baseSW !== nowSW);
// teeth: "today" = the base file with the shift indicator New Sale shows (ActiveShiftIndicator) rendering one
// extra word — the comparison must catch any change to what New Sale draws from this file
let nowOverride;
if (TEETH) {
  nowOverride = baseSW.replace("export function ActiveShiftIndicator() {", "export function ActiveShiftIndicator() { if (globalThis.__S) return \"shift\";");
  check("teeth: the shift indicator changed in a copy of ShiftWidgets", nowOverride !== baseSW);
  console.log("  !!  TEETH: a copy of ShiftWidgets whose shift indicator draws something else");
}
// the real ShiftWidgets pulls in the offline-sync module, which reads the (stubbed) auth store on load
globalThis.__S = { lang: "en", role: "cashier", q: {} };
try {
  const N = await bundle(resolve(HERE, "__close_ns_now.mjs"), POS_STUBS, nowOverride);
  const B = await bundle(resolve(HERE, "__close_ns_base.mjs"), POS_STUBS, baseSW);
  const render = (C, cfg, props = {}) => { globalThis.window = globalThis.window || { innerWidth: 1280, addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }), location: { search: "", pathname: "/pos" } };
    globalThis.__S = { lang: "en", role: "cashier", q: {}, ...cfg }; return renderToString(React.createElement(C, props)); };
  const PRODUCTS = { data: [{ id: "p1", name: "Castel", sell_price: 1500, stock: { quantity: 20 }, unit: "piece" }, { id: "p2", name: "Water", sell_price: 500, stock: { quantity: 3 }, unit: "piece" }] };
  const SCEN = [
    ["English cashier", { lang: "en", role: "cashier" }],
    ["French cashier", { lang: "fr", role: "cashier" }],
    ["English owner + product list", { lang: "en", role: "owner", q: { "pos-products": PRODUCTS } }],
    ["French manager + product list", { lang: "fr", role: "manager", q: { "pos-products": PRODUCTS } }],
  ];
  // the shift chip / no-shift hint only render when they have something to say: also render with NO open shift
  const NOSHIFT = { "current-shift": null, "my-shift": null };
  for (const [name, cfg0] of [...SCEN, ["French cashier, no open shift", { lang: "fr", role: "cashier", q: NOSHIFT }],
    ["English cashier, no open shift", { lang: "en", role: "cashier", q: NOSHIFT }]]) {
    let a = "", b = "", err = "";
    try { a = render(N.POS, cfg0); b = render(B.POS, cfg0); } catch (e) { err = e.message; }
    check(`New Sale (${name}): identical HTML to ${BASE} (${a.length} chars)`, !err && a.length > 1000 && a === b,
      err || (a === b ? "" : `differs at char ${[...a].findIndex((c, i) => c !== b[i])}`));
    const fr = cfg0.lang === "fr";
    check(`… and it IS the New Sale screen`, a.includes(fr ? "Nouvelle vente" : "New Sale") && a.includes(fr ? "Paiement →" : "Proceed to Payment →"), a.slice(0, 120));
  }
} finally { for (const f of tmp) rmSync(f, { force: true }); }
if (TEETH) { console.log(`\nTEETH: ${fails ? `RED as required (${fails} failed)` : "STILL GREEN — no teeth"}`); process.exit(fails ? 0 : 1); }
console.log(fails ? `\nFAIL — ${fails} failed, ${passes} passed` : `\nPASS — ${passes}/${passes}: New Sale renders identically to ${BASE}`);
process.exit(fails ? 1 : 0);
