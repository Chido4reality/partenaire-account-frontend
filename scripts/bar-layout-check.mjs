// BAR LAYOUT (Peter 2026-11-18) — frontend proof.
//   A. the view rules (utils/barLayout.js): a BRANCH SWITCH returns to Home of the new branch and
//      carries nothing across (the bug found in testing); a tab of another branch is refused; drafts
//      are kept per (person × branch × tab); the grid order holds still while an order is entered;
//      box colours are stable and readable; photos are the product's own (https) or nothing.
//   B. NEW SALE IS IDENTICAL: POSPage with no `embed` prop renders byte-for-byte the same HTML as the
//      POSPage before this change (BAR_LAYOUT_BASE, default origin/fix/orange-proxy-v2), over several
//      scenarios.
//   C. the embed: the grid replaces the search, no "New Sale" title / location picker, the buttons
//      read "Take payment" and "Hold" (not "Hold Sale").
//   D. Layout: the sidebar hides ONLY on /bar and only until the bar's menu button opens it.
//   E. the round-draft store: two tabs, two branches, two people never share a draft.
// TEETH: BAR_LAYOUT_TEETH=1 breaks the branch reset in a copy of barLayout.js — part A must go red.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail !== "" ? `  [${detail}]` : ""}`); };
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const tmp = [];
const cleanup = () => { for (const f of tmp) rmSync(f, { force: true }); };
process.on("exit", cleanup);

async function bundle(entryContents, out, stubs = {}) {
  tmp.push(out);
  await build({
    stdin: { contents: entryContents, resolveDir: SRC, loader: "jsx", sourcefile: "bar-layout-entry.jsx" },
    bundle: true, format: "esm", outfile: out, jsx: "automatic", external: ["react", "react/jsx-runtime", "react-dom", "react-dom/server"],
    logLevel: "silent", platform: "node",
    define: { "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }) },   // Vite-only object
    banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => { for (const k of Object.keys(stubs)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" }; return null; });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
    } }],
  });
  return import("file:///" + out.replace(/\\/g, "/") + `?t=${Date.now()}`);
}

// ── A. view rules ──────────────────────────────────────────────────────────────────────────
console.log("\n── A. view rules (branch switch, drafts, grid order, colours) ──");
let layoutSrc = readFileSync(resolve(SRC, "utils/barLayout.js"), "utf8");
if (process.env.BAR_LAYOUT_TEETH) {
  // the bug: a branch change that keeps the open table on screen
  layoutSrc = layoutSrc.replace(`return { barId: action.barId || null, view: HOME };`, `return { ...state, barId: action.barId || null };`);
  console.log("  !!  TEETH: branch reset removed in a COPY of barLayout.js");
}
const teethFile = resolve(SRC, "utils/__bar_layout_under_test.js");
writeFileSync(teethFile, layoutSrc); tmp.push(teethFile);
const A = await bundle(`export * from "./utils/__bar_layout_under_test.js";`, resolve(HERE, "__bar_layout_a.mjs"));
{
  const R = A.barViewReducer;
  let s = R({ barId: null, view: "home" }, { type: "branch", barId: "BON" });
  s = R(s, { type: "table", tableId: "T1" });
  check("A1 on Bonaberri, table T1 selected", s.barId === "BON" && s.view === "table" && s.tableId === "T1");
  const after = R(s, { type: "branch", barId: "BEP" });
  check("A2 BRANCH SWITCH → Home of the new branch: no table, no tab, nothing from Bonaberri", after.barId === "BEP" && after.view === "home" && !after.tableId && !after.tabId, JSON.stringify(after));
  const named = R(R(s, { type: "named", tabId: "N1" }), { type: "branch", barId: "BEP" });
  check("A3 … same from a counter tab", named.view === "home" && !named.tabId, JSON.stringify(named));
  check("A4 re-selecting the SAME branch changes nothing", R(s, { type: "branch", barId: "BON" }) === s);
  const floorBEP = { tables: [{ id: "T1", tab: { id: "X-BON" } }], named_tabs: [] };
  check("A5 after the switch the bill shown is null (Home), even if the new floor has a T1",
    A.currentTabId(after, floorBEP) === null);
  check("A6 a floor of ANOTHER branch never changes the view", R(s, { type: "floor", barId: "BEP", floor: { tables: [], named_tabs: [] } }) === s);
  check("A7 the selected table vanished from THIS branch's floor → Home", R(s, { type: "floor", barId: "BON", floor: { tables: [], named_tabs: [] } }).view === "home");
  check("A8 a table's bill follows the floor (paid → null → shows free)",
    A.currentTabId(s, { tables: [{ id: "T1", tab: { id: "TAB9" } }] }) === "TAB9" && A.currentTabId(s, { tables: [{ id: "T1", tab: null }] }) === null);
  check("A9 a tab of another branch is refused by the second guard", !A.tabBelongsToBar({ location_id: "BON" }, "BEP") && A.tabBelongsToBar({ location_id: "BEP" }, "BEP"));
  const k = A.draftKey;
  check("A10 drafts kept per person × branch × tab — every pair differs",
    new Set([k("u1", "BON", "t1"), k("u1", "BON", "t2"), k("u1", "BEP", "t1"), k("u2", "BON", "t1")]).size === 4 && k("u1", "BON", null) === null);
  check("A11 grid order holds still while busy, refreshes when empty",
    JSON.stringify(A.stableOrder(["a", "b"], ["b", "c"], true)) === '["a","b"]' && JSON.stringify(A.stableOrder(["a", "b"], ["b", "c"], false)) === '["b","c"]');
  check("A12 grid shows only products the till knows, no kits, at most the limit",
    JSON.stringify(A.gridProducts(["x", "a", "k", "b"], [{ id: "a" }, { id: "b" }, { id: "k", is_multipart: true }], 5).map((p) => p.id)) === '["a","b"]');
  const p1 = { id: "prod-1" };
  check("A13 box colour stable per product and from the palette", A.productColor(p1) === A.productColor({ id: "prod-1" }) && A.BOX_PALETTE.includes(A.productColor(p1)));
  check("A14 a dark category colour is used; a light one (white text unreadable) falls back to the palette",
    A.productColor({ id: "z", pa_categories: { color: "#123456" } }) === "#123456" && A.BOX_PALETTE.includes(A.productColor({ id: "z", pa_categories: { color: "#fafafa" } })));
  check("A15 picture = the product's own https photo_url (then image_url); anything else → none",
    A.productPhoto({ photo_url: "https://x/p.jpg" }) === "https://x/p.jpg" && A.productPhoto({ image_url: "https://x/i.jpg" }) === "https://x/i.jpg"
    && A.productPhoto({ photo_url: "javascript:alert(1)" }) === null && A.productPhoto({}) === null);
  check("A16 neutral icon by category: drinks → bottle, spirits → glass, food → plate",
    A.productIconKind({ pa_categories: { name: "Boissons" } }) === "bottle" && A.productIconKind({ pa_categories: { name: "Whisky" } }) === "glass" && A.productIconKind({ pa_categories: { name: "Grillades" } }) === "plate");
}
if (process.env.BAR_LAYOUT_TEETH) { console.log(`\nTEETH RUN: ${fails ? `RED as required (${fails} failed)` : "STILL GREEN — the check has no teeth"}\n`); process.exit(fails ? 0 : 1); }

// ── B + C. POSPage: New Sale identical; the embed ────────────────────────────────────────────
console.log("\n── B. New Sale renders identically · C. the embed ──");
const BASE = process.env.BAR_LAYOUT_BASE || "origin/fix/orange-proxy-v2";
const baseFile = resolve(SRC, "pages/__base_POSPage.jsx");
let baseOk = true;
try { writeFileSync(baseFile, git("show", `${BASE}:src/pages/POSPage.jsx`)); tmp.push(baseFile); } catch { baseOk = false; }
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
  "ShiftWidgets": `export const useActiveShift = () => ({ hasShift: true, shift: { id: "s1" }, locId: "loc-1" }); export const noShiftHint = () => "x";
    export function ActiveShiftIndicator(){ return null; } export function OpenShiftModal(){ return null; }`,
  "MobileShiftChip": `export default function MobileShiftChip(){ return null; }`,
  "MobileCartSheet": `import React from "react"; export default function MobileCartSheet(p){ return React.createElement("div", { "data-sheet": "1" }, p.children); }`,
  "CameraScanner": `export default function CameraScanner(){ return null; }`,
  "framer-motion": `import React from "react"; const P = new Proxy({}, { get: (_, tag) => (p) => { const { initial, animate, exit, transition, whileTap, layout, ...rest } = p; return React.createElement(tag, rest); } }); export const motion = P; export const AnimatePresence = (p) => p.children;`,
  "useLiteMode": `export const useLiteMode = () => false; export default () => false;`,
};
if (!baseOk) check(`B base ${BASE} available`, false, "git show failed");
else {
  // TEETH for B: BAR_LAYOUT_TEETH_B=1 drops ONE embed guard in a copy of today's POSPage (the bar's
  // button row applied to New Sale too) — B must go red.
  let nowEntry = "./pages/POSPage";
  if (process.env.BAR_LAYOUT_TEETH_B) {
    const nowFile = resolve(SRC, "pages/__now_POSPage.jsx");
    const src = readFileSync(resolve(SRC, "pages/POSPage.jsx"), "utf8");
    const bad = src.replace(`flexDirection: embed ? "row-reverse" : "column", gap: 8`, `flexDirection: "row-reverse", gap: 8`);
    check("B-TEETH the mutation landed", bad !== src);
    writeFileSync(nowFile, bad); tmp.push(nowFile); nowEntry = "./pages/__now_POSPage";
    console.log("  !!  TEETH B: one embed guard removed in a COPY of POSPage");
  }
  const M = await bundle(`export { default as NowPOS } from "${nowEntry}"; export { default as BasePOS } from "./pages/__base_POSPage";`, resolve(HERE, "__bar_layout_pos.mjs"), POS_STUBS);
  const render = (C, cfg, props = {}) => { globalThis.window = globalThis.window || { innerWidth: 1280, addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }), location: { search: "", pathname: "/pos" } };
    globalThis.__S = { lang: "en", role: "cashier", q: {}, ...cfg }; return renderToString(React.createElement(C, props)); };
  const PRODUCTS = { data: [{ id: "p1", name: "Castel", sell_price: 1500, stock: { quantity: 20 }, unit: "piece" }, { id: "p2", name: "Water", sell_price: 500, stock: { quantity: 3 }, unit: "piece" }] };
  const SCEN = [
    ["English cashier", { lang: "en", role: "cashier" }],
    ["French cashier", { lang: "fr", role: "cashier" }],
    ["English owner + product list", { lang: "en", role: "owner", q: { "pos-products": PRODUCTS } }],
    ["French manager + product list", { lang: "fr", role: "manager", q: { "pos-products": PRODUCTS } }],
  ];
  for (const [name, cfg] of SCEN) {
    let a = "", b = "", err = "";
    try { a = render(M.NowPOS, cfg); b = render(M.BasePOS, cfg); } catch (e) { err = e.message; }
    check(`B New Sale (${name}): identical HTML to ${BASE.slice(0, 26)} (${a.length} chars)`, !err && a.length > 1000 && a === b, err || (a === b ? "" : `differs at char ${[...a].findIndex((c, i) => c !== b[i])}`));
    // not a fallback: the real New Sale screen — title, location picker, search, both cart buttons
    const fr = cfg.lang === "fr";
    check(`B … and it IS the New Sale screen (title, Proceed, Hold)`,
      a.includes(fr ? "Nouvelle vente" : "New Sale") && a.includes(fr ? "Paiement →" : "Proceed to Payment →") && a.includes(fr ? "Mettre en attente" : "Hold Sale"),
      a.slice(0, 160));
  }
  // C — the embed
  let h = "", err = "";
  try { h = render(M.NowPOS, { lang: "en", role: "cashier", q: { "pos-products": PRODUCTS } }, { embed: { showAll: false, renderLeft: (api) => React.createElement("div", { id: "grid" }, `GRID:${api.products.length}:${typeof api.addToCart}:${api.priceOf(api.products[0])}`) } }); } catch (e) { err = e.message; }
  check("C1 embed renders, with the grid fed the POS products, addToCart and the price", !err && h.includes("GRID:2:function:1500"), err || h.slice(0, 200));
  check("C2 embed: no “New Sale” title, no location picker, no search box until All items", !h.includes("New Sale") && !h.includes("— Select location —") && !h.includes("Search by name, code, barcode"));
  check("C3 embed: “Take payment” and “Hold” (not “Proceed to Payment” / “Hold Sale”)", h.includes("Take payment") && />⏸ (<!-- -->)?Hold</.test(h) && !h.includes("Hold Sale") && !h.includes("Proceed to Payment"));
  const fr = render(M.NowPOS, { lang: "fr", role: "cashier", q: { "pos-products": PRODUCTS } }, { embed: { showAll: false, renderLeft: () => null } });
  check("C4 embed in French: “Encaisser” and “Mettre en attente”", fr.includes("Encaisser") && fr.includes("Mettre en attente"));
  const all = render(M.NowPOS, { lang: "en", role: "cashier", q: { "pos-products": PRODUCTS } }, { embed: { showAll: true, renderLeft: () => null } });
  check("C5 embed + All items: the POS search is back", /Search by name, code, barcode|Or type to search/.test(all));
}

// ── D. Layout: sidebar hidden only on /bar ──────────────────────────────────────────────────
console.log("\n── D. Layout ──");
const layout = readFileSync(resolve(SRC, "components/common/Layout.jsx"), "utf8");
check("D1 barFullWidth = on /bar AND the bar menu not opened", /const barFullWidth = location\.pathname === "\/bar" && !barMenuOpen;/.test(layout));
check("D2 the ONLY use of barFullWidth hides the desktop <aside>", (layout.match(/barFullWidth/g) || []).length === 2 && /<aside style=\{\{[^\n]*\.\.\.\(barFullWidth \? \{ display: "none" \} : \{\}\) \}\}>/.test(layout));
check("D3 leaving /bar closes the bar menu", /if \(location\.pathname !== "\/bar"\) useBarChrome\.getState\(\)\.setMenuOpen\(false\)/.test(layout));
check("D4 every other Layout line is unchanged — proven by bar-mode-step1/2 (menu-edits undo = byte-identical base)",
  readFileSync(resolve(HERE, "bar-mode-menu-edits.mjs"), "utf8").includes("BAR LAYOUT (Peter 2026-11-18)"));

// ── E. round-draft store ───────────────────────────────────────────────────────────────────
console.log("\n── E. round drafts ──");
{
  const mem = new Map();
  const S = await bundle(`export { useBarDraftStore } from "./store/barDrafts";`, resolve(HERE, "__bar_layout_e.mjs"),
    { "utils/safeStorage": `export const safeStorage = { getItem: (k) => globalThis.__mem.get(k) ?? null, setItem: (k, v) => globalThis.__mem.set(k, v), removeItem: (k) => globalThis.__mem.delete(k) };` });
  globalThis.__mem = mem;
  const st = S.useBarDraftStore.getState();
  st.setDraft("u1::BON::t1", [{ id: "a", qty: 2 }], "k1");
  st.setDraft("u1::BON::t2", [{ id: "b", qty: 1 }], "k2");
  st.setDraft("u1::BEP::t1", [{ id: "c", qty: 1 }], "k3");
  const g = S.useBarDraftStore.getState();
  check("E1 three contexts, three separate drafts, each with its own send key",
    g.getDraft("u1::BON::t1").items[0].id === "a" && g.getDraft("u1::BON::t2").items[0].id === "b" && g.getDraft("u1::BEP::t1").items[0].id === "c"
    && new Set(["u1::BON::t1", "u1::BON::t2", "u1::BEP::t1"].map((x) => g.getDraft(x).roundKey)).size === 3);
  g.clearDraft("u1::BON::t1");
  check("E2 sending (clearing) one draft leaves the others", !S.useBarDraftStore.getState().getDraft("u1::BON::t1") && !!S.useBarDraftStore.getState().getDraft("u1::BON::t2"));
  check("E3 no key → nothing stored", (S.useBarDraftStore.getState().setDraft(null, [{ id: "x" }], "k"), Object.keys(S.useBarDraftStore.getState().drafts).length === 2));
}

console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "PASS — all bar layout checks"}\n`);
process.exit(fails ? 1 : 0);
