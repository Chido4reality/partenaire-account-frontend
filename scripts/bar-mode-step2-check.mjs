// BAR MODE — build step 2 (zones, tables, tabs). Frontend half of the proof that shops see nothing new:
//   1. menu / route / nav files = the tree before Bar Mode + EXACTLY the entries in
//      bar-mode-menu-edits.mjs (all present, nothing else changed);
//   2. the one new request (GET /bar/mine) is asked ONLY on Pro Plus, only by owner / manager /
//      cashier, and never when the org is known to have Bar Mode off — evaluated over every case;
//   3. the Bar Mode button (replaced the plain "Bar" entry 2026-11-18): above Warehouse Mode in the
//      sidebar and drawer; shown only when /bar/mine listed a bar (not in Warehouse Mode); never fetches;
//   4. the bar page, rendered: no bar → one sentence; a floor → free / open / closed tables, the
//      duplicate-name hint (waiter + time), offline refusal, setup only for owner / manager.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MENU_EDITS, undoMenuEdits } from "./bar-mode-menu-edits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
const OUT = resolve(HERE, "__bar_mode_step2_mounted.mjs");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
console.log("\n── BAR MODE step 2 (frontend) ─────────────────────────────────────\n");

// ── 1. menu files ──────────────────────────────────────────────────────────────
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
let BASE = process.env.BAR_BASE || "";
if (!BASE) { try { const c = git("log", "-1", "--format=%H", "--grep=^Bar Mode step 1 (frontend)", "HEAD").trim(); if (c) BASE = c + "^"; } catch { /* */ } }
if (!BASE) BASE = "origin/main";
let baseOk = true; try { git("rev-parse", "--verify", BASE); } catch { baseOk = false; }
const files = [...new Set(MENU_EDITS.map((e) => e[0]))];
if (!baseOk) console.log(`  ....  menu sources: SKIPPED — base ${BASE} not available (not a pass)`);
else for (const f of files) {
  const base = git("show", `${BASE}:${f}`);
  const { text, missing } = undoMenuEdits(f, readFileSync(resolve(ROOT, f), "utf8"));
  check(`${f}: every listed Bar entry present`, missing.length === 0, missing.join(" | "));
  check(`${f}: with them undone, byte-identical to ${BASE.slice(0, 9)}… (nothing else changed)`, text === base, text === base ? "" : "DIFFERS");
}

// ── 2. who asks GET /bar/mine ──────────────────────────────────────────────────
const layout = readFileSync(resolve(SRC, "components/common/Layout.jsx"), "utf8");
const m = layout.match(/queryKey: \["bar-mine"\],[\s\S]*?enabled: ([^\n]+),\n/);
check("Layout: the /bar/mine query has one explicit enabled expression", !!m);
if (m) {
  const enabled = new Function("effectivePlan", "role", "org", `return (${m[1]});`);
  const bad = [];
  let asked = 0, cases = 0;
  for (const plan of ["silver", "gold", "pro", "pro_plus", undefined])
    for (const role of ["owner", "manager", "cashier", "accountant", "warehouse"])
      for (const org of [null, {}, { bar_mode_enabled: false }, { bar_mode_enabled: true }]) {
        cases++;
        const want = plan === "pro_plus" && ["owner", "manager", "cashier"].includes(role) && org?.bar_mode_enabled !== false;
        const got = !!enabled(plan, role, org);
        if (got) asked++;
        if (got !== want) bad.push(`${plan}/${role}/${JSON.stringify(org)}`);
      }
  check(`GET /bar/mine asked only on Pro Plus, owner/manager/cashier, org not known OFF (${cases} cases, ${asked} ask)`, bad.length === 0, bad.join(",") || "ok");
}

// ── 3. the Bar Mode button (Peter 2026-11-18: replaces the plain "Bar" menu entry) ─────────────
// No "Bar" NAV entry is left; the button sits ABOVE Warehouse Mode in the sidebar AND the phone drawer;
// it never fetches (reads Layout's /bar/mine answer); rendered over every state, it shows ONLY for a
// non-empty bars list outside Warehouse Mode — every other case renders NOTHING (no wrapper either).
{
  check("no plain “Bar” menu entry left (no barOnly item, no NAV /bar)", !/barOnly/.test(layout) && !/\{ to: "\/bar"/.test(layout));
  const drawer = readFileSync(resolve(SRC, "components/layout/NavDrawer.jsx"), "utf8");
  const above = (txt) => { const b = txt.indexOf("<BarModeButton "), w = txt.indexOf("<WorkModeButton "); return b > 0 && w > 0 && b < w && txt.split("<BarModeButton ").length === 2; };
  check("sidebar: exactly one Bar Mode button, ABOVE the Warehouse Mode button", above(layout));
  check("phone drawer: exactly one Bar Mode button, ABOVE the Warehouse Mode button", above(drawer));
  const BOUT = resolve(HERE, "__bar_mode_button.mjs");
  const BSTUBS = {
    "@tanstack/react-query": `export const useQuery = (o) => { globalThis.__bm.queries.push({ key: o.queryKey, enabled: o.enabled });
      return { data: globalThis.__bm.cache[o.queryKey[0]] }; };`,
    "react-router-dom": `export const useNavigate = () => () => {}; export const useLocation = () => ({ pathname: globalThis.__bm.path });`,
    "utils/api": `export default { get: async () => { globalThis.__bm.fetched++; return { data: {} }; } };`,
    "store": `export const useLangStore = () => ({ lang: globalThis.__bm.lang });`,
    "utils/workMode": `export const useWorkMode = () => globalThis.__bm.mode;`,
    "store/barChrome": `export const useBarChrome = { getState: () => ({ setMenuOpen() {} }) };`,
  };
  await build({
    stdin: { contents: `export { default } from "./components/common/BarModeButton";`, resolveDir: SRC, loader: "jsx", sourcefile: "bm-entry.jsx" },
    bundle: true, format: "esm", outfile: BOUT, jsx: "automatic", external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => { for (const k of Object.keys(BSTUBS).sort((x, y) => y.length - x.length)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" }; return null; });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: BSTUBS[a.path], loader: "js" }));
    } }],
  });
  const BM = (await import("file:///" + BOUT.replace(/\\/g, "/"))).default;
  rmSync(BOUT, { force: true });
  const rb = (cfg) => { globalThis.__bm = { lang: "en", mode: "pos", path: "/", cache: {}, queries: [], fetched: 0, ...cfg };
    const html = renderToString(React.createElement(BM, { compact: false })); return { html, q: globalThis.__bm.queries, fetched: globalThis.__bm.fetched }; };
  const ONE = { bars: [{ id: "b1", name: "Bepanda" }] };
  const bad = []; let cases = 0;
  for (const data of [undefined, null, {}, { bars: [] }, ONE, { bars: [{ id: "b1" }, { id: "b2" }] }])
    for (const mode of ["pos", "warehouse", undefined])
      for (const lang of ["en", "fr"])
        for (const path of ["/", "/bar"]) {
          cases++;
          const r = rb({ cache: data === undefined ? {} : { "bar-mine": data }, mode, lang, path });
          const want = mode !== "warehouse" && (data?.bars || []).length > 0;
          const shown = r.html !== "";
          if (shown !== want) bad.push(`${JSON.stringify(data)}/${mode}/${lang}${path}: ${shown ? "shown" : "hidden"}`);
          if (shown && !r.html.includes(lang === "en" ? "Bar Mode" : "Mode Bar")) bad.push(`${lang}: label missing`);
          if (r.q.some((x) => x.enabled !== false) || r.fetched) bad.push("the button fetched");
          if (r.q.some((x) => JSON.stringify(x.key) !== '["bar-mine"]')) bad.push(`other key ${JSON.stringify(r.q)}`);
        }
  check(`Bar Mode button shown ONLY with a bar and outside Warehouse Mode; otherwise renders nothing; never fetches (${cases} cases)`, !bad.length, bad.slice(0, 4).join(" | ") || "ok");
  check("Bar Mode button on /bar is marked as the current page", rb({ cache: { "bar-mine": ONE }, path: "/bar" }).html.includes('aria-current="page"'));
}

// ── 4. the page, rendered ──────────────────────────────────────────────────────
const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = (o) => { const k = o.queryKey[0]; if (o.enabled === false) return { data: undefined };
      const d = globalThis.__bar[k]; return { data: d, isLoading: false, isError: false }; };
    export const useMutation = () => ({ mutate: () => {}, isPending: false });
    export const useQueryClient = () => ({ invalidateQueries: async () => {} });`,
  "utils/api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), patch: async () => ({ data: {} }) };`,
  "store": `export const useLangStore = () => ({ lang: globalThis.__bar.lang });
    export const useAuthStore = (sel) => sel({ user: { role: globalThis.__bar.role, id: "u1" } });
    export const useSettingsStore = () => ({ selectedLocation: { id: "b1" }, setLocation() {} });`,
  "utils/useNetworkStatus": `export const useNetworkStatus = () => ({ isOnline: globalThis.__bar.online });`,
  // BAR LAYOUT: Home embeds the POS — its own proof is scripts/bar-layout-check.mjs
  "POSPage": `export default function POSPage() { return "POS-EMBED"; }`,
  "utils/useCurrency": `const f = (n) => String(Number(n) || 0) + " F"; export const useCurrency = () => f;`,
  "utils/safeStorage": `const m = new Map(); export const safeStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };`,
};
await build({
  stdin: { contents: `export { default, CounterTabsPanel, TableSide } from "./pages/BarPage";`, resolveDir: SRC, loader: "jsx", sourcefile: "bar2-entry.jsx" },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic", external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
  // BAR LAYOUT: the page now uses the real zustand stores, whose CommonJS deps require("react")
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => { for (const k of Object.keys(STUBS)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" }; return null; });
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  } }],
});
const MOD = await import("file:///" + OUT.replace(/\\/g, "/"));
const Page = MOD.default;
rmSync(OUT, { force: true });
const render = (cfg) => { globalThis.__bar = { lang: "en", role: "owner", online: true, ...cfg }; return renderToString(React.createElement(Page)); };
// BAR LAYOUT: tab actions now live in the selected table's panel and the Counter tabs panel
const noop = { mutate: () => {}, isPending: false };
const renderEl = (C, props, cfg = {}) => { globalThis.__bar = { lang: "en", role: "owner", online: true, ...cfg }; return renderToString(React.createElement(C, props)); };

const FLOOR = {
  location: { id: "b1", name: "Night Bar" },
  zones: [{ id: "z1", name: "Terrace" }],
  tables: [
    { id: "t1", zone_id: "z1", label: "T1", tab: { id: "x1", status: "open", waiter_name: "Awa", opened_at: "2026-11-16T20:05:00Z", pa_sales: { version: 1 } } },
    { id: "t2", zone_id: "z1", label: "T2", tab: { id: "x2", status: "closed", waiter_name: "Awa", opened_at: "2026-11-16T20:10:00Z", pa_sales: { version: 1 } } },
    { id: "t3", zone_id: null, label: "T3", tab: null },
  ],
  named_tabs: [
    { id: "n1", kind: "named", name: "Paul", status: "open", waiter_name: "Awa", opened_at: "2026-11-16T20:15:00Z", pa_sales: { version: 1 } },
    { id: "n2", kind: "named", name: "paul", status: "open", waiter_name: "Ben", opened_at: "2026-11-16T20:20:00Z", pa_sales: { version: 1 } },
    { id: "n3", kind: "named", name: "Marie", status: "closed", waiter_name: "Ben", opened_at: "2026-11-16T20:25:00Z", pa_sales: { version: 1 } },
  ],
};
{
  const none = render({ "bar-mine": { bars: [] } });
  check("no bar for this person → one sentence, no floor, no buttons", none.includes("No bar is set up for you.") && !none.includes("<button"));
  const h = render({ "bar-mine": { bars: [{ id: "b1", name: "Night Bar" }], can_setup: true }, "bar-floor": FLOOR });
  check("tables row: Home, the zone label, every table with its status (Open / To pay / Free)",
    h.includes("Home") && h.includes("Terrace") && /T1<\/b> · (<!-- -->)?Open/.test(h) && /T2<\/b> · (<!-- -->)?To pay/.test(h) && /T3<\/b> · (<!-- -->)?Free/.test(h));
  check("Home (the start view) = the POS embedded", h.includes("POS-EMBED"));
  const tbl = (tab, extra = {}) => renderEl(MOD.TableSide, { lang: "en", barId: "b1", userId: "u1", tabId: tab ? tab.id : null, table: { id: "t9", label: "T9", tab },
    title: "T9", products: [], fmt: (n) => `${n} F`, showAll: false, setShowAll() {}, canServe: true, isOnline: true, busy: false, act: noop, tender: {}, setTender() {},
    onChanged() {}, onWrongBranch() {} }, { "bar-tab": tab ? { ...tab, location_id: "b1", rounds: [] } : undefined, ...extra });
  const tFree = tbl(null), tOpen = tbl({ id: "x1", status: "open", pa_sales: { version: 1, total_amount: 0 } }), tClosed = tbl({ id: "x2", status: "closed", pa_sales: { version: 1, total_amount: 3000 } });
  check("free table → Open tab; open → Close tab; closed → Take payment (in the selected table's panel)",
    (tFree.match(/Open tab</g) || []).length === 1 && tOpen.includes("Close tab") && !tOpen.includes("Take payment") && tClosed.includes("Take payment") && !tClosed.includes("Close tab"));
  const tForeign = renderEl(MOD.TableSide, { lang: "en", barId: "b1", userId: "u1", tabId: "xx", table: { id: "t9", label: "T9", tab: { id: "xx", status: "open", pa_sales: { version: 1 } } },
    title: "T9", products: [], fmt: (n) => `${n} F`, showAll: false, setShowAll() {}, canServe: true, isOnline: true, busy: false, act: noop, tender: {}, setTender() {}, onChanged() {}, onWrongBranch() {} },
    { "bar-tab": { id: "xx", status: "open", location_id: "OTHER-BAR", pa_sales: { version: 1 }, rounds: [{ id: "r", round_no: 1, status: "sent", total: 1 }] } });
  check("a tab of ANOTHER branch is never shown: no rounds, no actions", !tForeign.includes("Round") && !tForeign.includes("Close tab") && !tForeign.includes("Take payment"));
  const ct = renderEl(MOD.CounterTabsPanel, { lang: "en", barId: "b1", named: FLOOR.named_tabs, busy: false, act: noop, tender: {}, setTender() {}, onRounds() {} });
  const dupWarn = (ct.match(/⚠ /g) || []).length;
  check("two 'Paul' tabs (any case) each show ⚠ + waiter + time; 'Marie' (unique) no ⚠", dupWarn === 2 && ct.includes("Awa") && ct.includes("Ben"), dupWarn);
  check("counter tab form needs a name (required input)", /<input[^>]*required[^>]*placeholder="Name \(who is it for\?\)"/.test(ct) || /placeholder="Name \(who is it for\?\)"[^>]*required/.test(ct));
  check("counter tabs: open → Rounds + Close tab; closed → Take payment", ct.includes("Rounds") && ct.includes("Close tab") && ct.includes("Take payment"));
  check("owner/manager: “Set up tables” offered", h.includes("Set up tables") && h.includes("Counter tabs"));
  const c = render({ role: "cashier", "bar-mine": { bars: [{ id: "b1", name: "Night Bar" }], can_setup: false }, "bar-floor": FLOOR });
  check("cashier: no set-up button (Counter tabs still there)", !c.includes("Set up tables") && c.includes("Counter tabs"));
  const off = render({ online: false, "bar-mine": { bars: [{ id: "b1", name: "Night Bar" }] }, "bar-floor": FLOOR });
  check("offline: the refusal sentence is shown", off.includes("Offline — tabs cannot be opened, closed or paid"));
  const fr = render({ lang: "fr", "bar-mine": { bars: [{ id: "b1", name: "Night Bar" }], can_setup: true }, "bar-floor": FLOOR });
  const frT = renderEl(MOD.TableSide, { lang: "fr", barId: "b1", userId: "u1", tabId: null, table: { id: "t9", label: "T9", tab: null }, title: "T9", products: [], fmt: (n) => `${n} F`,
    showAll: false, setShowAll() {}, canServe: true, isOnline: true, busy: false, act: noop, tender: {}, setTender() {}, onChanged() {}, onWrongBranch() {} }, { lang: "fr" });
  const frC = renderEl(MOD.CounterTabsPanel, { lang: "fr", barId: "b1", named: FLOOR.named_tabs, busy: false, act: noop, tender: {}, setTender() {}, onRounds() {} }, { lang: "fr" });
  check("French: Ouvrir une note / Fermer la note / Encaisser / Notes au comptoir / Accueil",
    frT.includes("Ouvrir une note") && frC.includes("Fermer la note") && frC.includes("Encaisser") && fr.includes("Notes au comptoir") && fr.includes("Accueil"));
}

console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "all bar-mode step-2 frontend checks pass"}\n`);
process.exit(fails ? 1 : 0);
