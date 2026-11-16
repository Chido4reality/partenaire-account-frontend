// BAR MODE — build step 1 (switches, ALL OFF). The frontend half of the proof that normal shops
// see nothing new (spec proof (b), menu snapshots, plus the card's own gate):
//   1. the menus cannot change: every file that builds a menu / route / nav item is byte-identical
//      to the base commit (BASE, default origin/main), and SettingsPage gains exactly two lines;
//   2. the Settings card: rendered for every role × plan. Only an OWNER on PRO PLUS gets it — and
//      only those even FETCH /auth/bar-mode (no extra request for anyone else);
//   3. while the org switch is ON the card lists real shops only (no warehouse, Goods Buffer,
//      virtual store, inactive shop), with each shop's own bar switch.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
const OUT = resolve(HERE, "__bar_mode_step1_mounted.mjs");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};
console.log("\n── BAR MODE step 1 (frontend) ─────────────────────────────────────\n");

// ── 1. menus / routes / nav: byte-identical to BASE ─────────────────────────────
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
// BASE = the tree just BEFORE the Bar Mode step-1 commit on THIS branch (main or the staging branch,
// whose App.jsx differs from main for Orange reasons), unless BAR_BASE is given.
let BASE = process.env.BAR_BASE || "";
if (!BASE) {
  try {
    const c = git("log", "-1", "--format=%H", "--grep=^Bar Mode step 1 (frontend)", "HEAD").trim();
    if (c) BASE = c + "^";
  } catch { /* no git */ }
}
if (!BASE) BASE = "origin/main";
let baseOk = true;
try { git("rev-parse", "--verify", BASE); } catch { baseOk = false; }
if (!baseOk) {
  console.log(`  ....  menu sources: SKIPPED — base ${BASE} not available (not a pass)`);
} else {
  const MENU_FILES = ["src/components/common/Layout.jsx", "src/components/layout/NavDrawer.jsx", "src/App.jsx", "src/hooks/useLiteMode.js",
    "src/utils/workMode.js", "src/utils/locations.js"];
  for (const f of MENU_FILES) {
    let base = null; try { base = git("show", `${BASE}:${f}`); } catch { /* not in base */ }
    let now = null; try { now = readFileSync(resolve(ROOT, f), "utf8"); } catch { /* absent */ }
    if (base === null && now === null) continue;
    check(`${f} byte-identical to ${BASE} (menus / routes cannot change)`, base === now, base === now ? "" : "DIFFERS");
  }
  const d = git("diff", "--unified=0", BASE, "--", "src/pages/SettingsPage.jsx");
  const added = d.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  check("SettingsPage: exactly two lines added (the import + the card in the owner-only Mode tab), none removed",
    added.length === 2 && removed.length === 0 && added.some((l) => l.includes("import { BarModeOrgSwitch }"))
      && added.some((l) => l.includes("<BarModeOrgSwitch ") && l.includes("isOwner={isOwner}")),
    `+${added.length} -${removed.length}`);
  const s = readFileSync(resolve(SRC, "pages/SettingsPage.jsx"), "utf8");
  const i = s.indexOf("<BarModeOrgSwitch "), tab = s.lastIndexOf(`{tab === "mode" && isOwner && (`, i);
  check("the card sits inside the owner-only Mode tab", i > 0 && tab > 0 && i - tab < 400);
}

// ── 2/3. the card, rendered ─────────────────────────────────────────────────────
const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = (o) => { globalThis.__barQ.push(!!o.enabled); return { data: o.enabled ? globalThis.__barData : undefined }; };
    export const useQueryClient = () => ({ invalidateQueries: async () => {} });
  `,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), patch: async () => ({ data: {} }) };`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
};
await build({
  stdin: { contents: `export * from "./components/settings/BarModeSettings";`, resolveDir: SRC, loader: "jsx", sourcefile: "bar-entry.jsx" },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic",
  external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      for (const k of Object.keys(STUBS)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" };
      return null;
    });
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  } }],
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));
rmSync(OUT, { force: true });

const LOCS = [
  { id: "s1", name: "Shop A", type: "shop", is_active: true, kind: null, bar_enabled: false },
  { id: "s2", name: "Night Bar", type: "shop", is_active: true, kind: null, bar_enabled: true },
  { id: "w1", name: "Warehouse", type: "warehouse", is_active: true, kind: null },
  { id: "gb", name: "Goods Buffer", type: "shop", is_active: true, kind: "goods_buffer" },
  { id: "v1", name: "Virtual", type: "shop", is_active: true, kind: "virtual" },
  { id: "x1", name: "Closed shop", type: "shop", is_active: false, kind: null },
];
const render = (role, plan, data, lang = "en") => {
  globalThis.__barQ = []; globalThis.__barData = data;
  const html = renderToString(React.createElement(M.BarModeOrgSwitch,
    { lang, effectivePlan: plan, isOwner: role === "owner", locations: LOCS }));
  return { html, fetched: globalThis.__barQ.some(Boolean) };
};

const ROLES = ["owner", "manager", "accountant", "warehouse", "cashier"];
const PLANS = ["silver", "gold", "pro", "pro_plus", undefined];
let shownWrong = [], fetchedWrong = [];
for (const role of ROLES) for (const plan of PLANS) {
  const want = role === "owner" && plan === "pro_plus";
  const r = render(role, plan, { enabled: false, available: false, pro_plus: plan === "pro_plus" });
  if ((r.html !== "") !== want) shownWrong.push(`${role}/${plan}`);
  if (r.fetched !== want) fetchedWrong.push(`${role}/${plan}`);
}
check(`card rendered ONLY for owner + Pro Plus (${ROLES.length * PLANS.length} role × plan cases)`, shownWrong.length === 0, shownWrong.join(",") || "ok");
check("GET /auth/bar-mode fetched ONLY for owner + Pro Plus (no new request for anyone else)", fetchedWrong.length === 0, fetchedWrong.join(",") || "ok");

{
  const off = render("owner", "pro_plus", { enabled: false });
  check("org OFF: card says Off + Turn on, and lists NO shop switches", off.html.includes("○ Off") && off.html.includes("Turn on") && !off.html.includes("data-bar-shop"));
  const none = render("owner", "pro_plus", undefined);
  check("before the answer arrives: nothing rendered (no flash of a wrong state)", none.html === "");
  const on = render("owner", "pro_plus", { enabled: true, available: true });
  const listed = [...on.html.matchAll(/data-bar-shop="([^"]+)"/g)].map((m) => m[1]).sort().join(",");
  check("org ON: real active shops only (no warehouse / Goods Buffer / virtual / closed shop)", listed === "s1,s2", listed);
  check("org ON: each shop shows its own state (Night Bar ticked, Shop A not)",
    /data-bar-shop="s2"[^>]*>\s*<input[^>]*checked/.test(on.html) && !/data-bar-shop="s1"[^>]*>\s*<input[^>]*checked/.test(on.html));
  const fr = render("owner", "pro_plus", { enabled: true }, "fr");
  check("French: Mode Bar / Désactiver / Quelles boutiques sont des bars", fr.html.includes("Mode Bar") && fr.html.includes("Désactiver") && fr.html.includes("Quelles boutiques sont des bars"));
}

console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "all bar-mode step-1 frontend checks pass"}\n`);
process.exit(fails ? 1 : 0);
