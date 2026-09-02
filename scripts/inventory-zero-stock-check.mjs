// MP-ZERO-STOCK-INVISIBLE — does the Inventory Stock tab actually RENDER a
// zero-stock product, or does it say "No results"?
//
// WHY A RENDER CHECK AND NOT JUST THE BACKEND RIG
// -----------------------------------------------
// The backend rig (backend/scripts/zero-stock-visibility-check.mjs) proves what
// GET /stock returns and what the predicate decides. Neither proves the SCREEN.
// InventoryPage is 2900 lines and is NOT covered by mount-check (which renders
// TicketListPage and CashierOversightTab only), so a scope slip in the filter
// would have shipped with a green suite and a blank page. `npm run build` cannot
// catch it either — esbuild does not resolve identifiers.
//
// Each scenario asserts on the RENDERED HTML: the product's name is present, and
// the "No results" empty state is not. A scenario that cannot fail measures
// nothing, so the OLD payload shape (no lives_elsewhere → the shipped bug) is
// rendered too and asserted to produce the empty state.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(HERE, "../src");
const OUT  = resolve(HERE, "__inventory_mounted.mjs");

globalThis.__S = {};

const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = (o) => {
      const s = globalThis.__S, key = JSON.stringify(o.queryKey), hit = s.queries || {};
      for (const k of Object.keys(hit)) if (key.includes(k)) return { data: hit[k], isLoading: false, isError: false, refetch(){} };
      return { data: undefined, isLoading: false, isError: false, refetch(){} };
    };
    export const useMutation = () => ({ mutate(){}, mutateAsync: async () => {}, isPending: false, variables: undefined });
    export const useQueryClient = () => ({ invalidateQueries(){}, setQueryData(){}, getQueryData(){} });
  `,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), patch: async () => ({ data: {} }) };`,
  // Zustand stores are called BOTH ways in this codebase — with a selector and
  // bare. A selector-only stub crashes on the bare call, so serve both.
  "store": `
    // Read __S per CALL, not at module eval — the scenario is mutated between renders.
    const pick = (get) => (sel) => (typeof sel === "function" ? sel(get()) : get());
    export const useAuthStore = pick(() => ({ user: { role: globalThis.__S.role || "owner", id: "u1", name: "Ada" }, org: { name: "Shop" } }));
    export const useLangStore = pick(() => ({ lang: globalThis.__S.lang || "en" }));
    export const useSettingsStore = pick(() => ({ selectedLocation: { id: "loc-1", name: "Bepanda" } }));
  `,
  "useCurrency": `const f = (n) => String(n ?? 0) + " FCFA"; f.symbol = "FCFA"; f.currency = "XAF"; export const useCurrency = () => f;`,
  "useNetworkStatus": `export const useNetworkStatus = () => ({ isOnline: true });`,
  "useMyPermissions": `export const useMyPermissions = () => ({ perms: {} });`,
  "useLiteMode": `export const useLiteMode = () => ({ isLite: false, liteMode: false });`,
  "useOwnerApproval": `export default function useOwnerApproval(){ return { ask: () => {}, modal: null, pending: false }; }`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
  "CameraScanner": `export default function CameraScanner(){ return null; }`,
  "DoziePublishModal": `export default function DoziePublishModal(){ return null; }`,
  "PaywallModal": `export default function PaywallModal(){ return null; }`,
  "MultipartBuilder": `export default function MultipartBuilder(){ return null; }
                       export const partsToPayload = (p) => p; export const emptyPart = () => ({});`,
  "MultipartAvailability": `export default function MultipartAvailability(){ return null; }`,
  "productImport": `export const parseProductImport = () => []; export const buildProductTemplateXlsx = () => null;`,
};

await build({
  stdin: {
    contents: `export { default as InventoryPage } from "./pages/InventoryPage";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "inv-entry.jsx",
  },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic",
  external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        for (const k of Object.keys(STUBS)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" };
        return null;
      });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
    },
  }],
});

const M = await import("file:///" + OUT.replace(/\\/g, "/"));

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

const LOC = { id: "loc-1", name: "Bepanda", type: "shop" };
const LOC2 = { id: "loc-2", name: "Depot", type: "warehouse" };

// A pa_stock row exactly as GET /stock returns it.
const row = (o) => ({
  id: o.id, product_id: o.product_id, location_id: o.location_id,
  quantity: o.quantity, min_quantity: 0, slot_code: null, alert_enabled: false,
  last_moved_at: o.last_moved_at ?? null, last_movement_type: o.last_movement_type ?? null,
  ...(o.lives_elsewhere === undefined ? {} : { lives_elsewhere: o.lives_elsewhere }),
  pa_products: { name: o.name, unit: "pc", sell_price: 1500, cost_price: 500 },
  pa_locations: { name: o.loc?.name, type: o.loc?.type },
});

const render = (stockRows) => {
  globalThis.__S = {
    role: "owner", lang: "en",
    queries: {
      "\"stock\"": { success: true, data: stockRows },
      "stock-alerts": { success: true, data: [] },
      "products-all": { success: true, data: [] },
      locations: { success: true, data: [LOC, LOC2] },
      "stock-all": { success: true, data: stockRows },
    },
  };
  return renderToString(React.createElement(M.InventoryPage));
};

console.log("\n-- Inventory: a zero-stock product must render, not vanish ------\n");

// ── 0. the harness renders the real screen at all ─────────────────────────────
const sanity = render([row({ id: "s0", product_id: "p0", location_id: LOC.id, quantity: 7,
  last_moved_at: "2026-08-01T00:00:00Z", last_movement_type: "receive", name: "Piston CG125", loc: LOC, lives_elsewhere: true })]);
check("the Stock tab renders a stocked product", sanity.includes("Piston CG125"));
check("...and does NOT show the empty state", !sanity.includes("No results") && !sanity.includes("No stock records yet"));

// ── 1. PAUL'S BUG, on the payload the OLD backend returned ────────────────────
// No lives_elsewhere field at all + a never-moved zero row = the shipped bug.
const OLD_SHAPE = [row({ id: "s1", product_id: "p1", location_id: LOC.id, quantity: 0,
  name: "Brake Pedal TVS", loc: LOC })];
const oldHtml = render(OLD_SHAPE);
check("NEGATIVE CONTROL: the old payload still renders the product (fix is safe without the field)",
  oldHtml.includes("Brake Pedal TVS"));

// ── 2. the fixed payload: product lives NOWHERE → must show at quantity 0 ─────
const nowhere = [row({ id: "s2", product_id: "p2", location_id: LOC.id, quantity: 0,
  name: "Clutch Cable GN", loc: LOC, lives_elsewhere: false })];
const nowhereHtml = render(nowhere);
check("a product that lives nowhere RENDERS instead of vanishing", nowhereHtml.includes("Clutch Cable GN"));
check("...and the screen is not the 'No stock records' empty state",
  !nowhereHtml.includes("No stock records yet"));

// ── 3. the rule the filter exists for: still hidden where it never lived ──────
const elsewhere = [
  row({ id: "s3", product_id: "p3", location_id: LOC2.id, quantity: 0,
        name: "Fork Oil Seal", loc: LOC2, lives_elsewhere: true }),
  row({ id: "s4", product_id: "p4", location_id: LOC.id, quantity: 3,
        last_moved_at: "2026-08-01T00:00:00Z", last_movement_type: "receive",
        name: "Trump Horn", loc: LOC, lives_elsewhere: true }),
];
const elsewhereHtml = render(elsewhere);
check("a phantom placement is STILL hidden when the product lives elsewhere",
  !elsewhereHtml.includes("Fork Oil Seal"));
check("...while the location it really lives at still lists it", elsewhereHtml.includes("Trump Horn"));

// ── 4. a genuinely sold-out row is untouched ──────────────────────────────────
const soldOut = [row({ id: "s5", product_id: "p5", location_id: LOC.id, quantity: 0,
  last_moved_at: "2026-08-28T00:00:00Z", last_movement_type: "sale",
  name: "Tube 300-18", loc: LOC, lives_elsewhere: true })];
const soldHtml = render(soldOut);
check("a product sold down to zero still lists at quantity 0", soldHtml.includes("Tube 300-18"));

console.log(`\n-- ${fails === 0 ? "all checks passed" : fails + " FAILED"} --\n`);
try { rmSync(OUT); } catch { /* best effort */ }
process.exit(fails === 0 ? 0 : 1);
