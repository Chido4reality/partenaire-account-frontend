// BAR · SHIFT CLOSE REFUSAL WORDING — browser proof (Peter 2026-11-25). The REAL CloseShiftModal (esbuild, the app's
// own CSS through PostCSS — no Vite) in Chromium, with ONLY utils/api replaced by an in-page mock that answers like the
// server (be shifts.js): POST /shifts/:id/close → 409 bar_tabs_open { tabs, message = one line per tab } while tabs are
// open. Phone 360×740, tablet 768×1024, PC 1366×768 · EN + FR · the Cash screen (no onOpenBarTab → navigates to /bar)
// and the bar floor (onOpenBarTab) — the SAME component, so the same words on both.
// Checks: one line per tab — "Close or take payment for T1 · Bonaberri" / "Fermez ou encaissez T1 · Bonaberri" —
// each shown ONCE, no "N open bar tab(s)" summary; a tab with items → only "Take payment" / "Encaisser"; an empty
// tab → only "Close empty tab" / "Fermer la note vide"; every button reachable, in view, on top, ≥ 40 px; no
// sideways scroll; Close empty tab → POST /bar/tabs/:id/close + /pay and the line goes; Take payment opens that tab.
// Teeth: BAR_CLOSE_TEETH=1|2|3 bundles a mutated copy (tree untouched) and must go RED.
//   1 = the summary/message printed above the lines again · 2 = the two buttons swapped · 3 = the line loses its words
// Run: node scripts/bar-close-refusal-fit.mjs — SPLIT by default: 1 build + 12 short browser runs (scripts/lib/splitRun.mjs)
//   BAR_CLOSE_ONLY=phone|tablet|pc narrows it · BAR_CLOSE_NOSPLIT=1 = one process
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEETH = process.env.BAR_CLOSE_TEETH || "";
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const TMP = resolve(ROOT, "scripts", "__barclosefit");
const OUT = resolve(os.tmpdir(), `bar-close-fit-app${TEETH ? "-teeth" + TEETH : ""}`);

const SW = /components\/common\/ShiftWidgets\.jsx$/;
const MUTATIONS = {
  1: [{ file: SW, from: "{ setBarTabs(d.tabs); setError(null); setConfirming(false); return; }",
              to: "{ setBarTabs(d.tabs); setError(lang === \"fr\" ? (d.message_fr || d.message) : (d.message_en || d.message)); setConfirming(false); return; }" }],
  2: [{ file: SW, from: "              {t.empty\n                ? <button", to: "              {!t.empty\n                ? <button" }],
  3: [{ file: SW, from: "{lang === \"fr\" ? \"Fermez ou encaissez \" : \"Close or take payment for \"}", to: "" }],
};
if (TEETH && !MUTATIONS[TEETH]) { console.error(`unknown BAR_CLOSE_TEETH=${TEETH}`); process.exit(2); }

const PHASE = process.env.SPLIT_PHASE || "all";
const SIZE_LIST = [["phone", 360, 740], ["tablet", 768, 1024], ["pc", 1366, 768]];
if (!process.env.SPLIT_CHILD && !process.env.BAR_CLOSE_NOSPLIT) {
  const { splitRun } = await import("./lib/splitRun.mjs");
  const cases = [];
  for (const [size] of SIZE_LIST.filter(([n]) => !process.env.BAR_CLOSE_ONLY || process.env.BAR_CLOSE_ONLY === n))
    for (const lang of ["en", "fr"]) for (const screen of ["cash", "bar"])
      cases.push({ label: `${size} ${lang} ${screen}`, env: { BAR_CLOSE_ONLY: size, BAR_CLOSE_LANG: lang, BAR_CLOSE_SCREEN: screen } });
  await splitRun({ name: "the bar shift-close refusal names each tab, phone/tablet/PC, EN + FR, Cash screen + bar floor", script: fileURLToPath(import.meta.url), cases, teeth: !!TEETH });
}

let fails = 0, passes = 0;
const check = (label, ok, detail = "") => { ok ? passes++ : fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail !== "" ? `  [${String(detail).slice(0, 300)}]` : ""}`); };

if (PHASE !== "run") {
mkdirSync(TMP, { recursive: true });
writeFileSync(resolve(TMP, "api-mock.js"), `
const S = window.__api = { calls: [], tabs: [
  { id: "t1", status: "open", table_id: "tb1", location_id: "L1", label: "T1", branch: "Bonaberri", title: "T1 · Bonaberri", empty: false },
  { id: "jo", status: "open", table_id: null, location_id: "L1", label: "Jo", branch: "Bonaberri", title: "Jo · Bonaberri", empty: true } ] };
const ok = (data) => Promise.resolve({ data });
const no = (status, data) => Promise.reject(Object.assign(new Error("HTTP " + status), { response: { status, data } }));
const api = {
  get: () => ok({ success: true, data: null }),
  post: (url, body) => {
    S.calls.push({ url, body: body || null });
    if (/^\\/shifts\\/[^/]+\\/close$/.test(url)) {
      if (S.tabs.length) {   // like be shifts.js: one line per tab
        const fr = S.tabs.map((t) => "Fermez ou encaissez " + t.title).join("\\n"), en = S.tabs.map((t) => "Close or take payment for " + t.title).join("\\n");
        return no(409, { success: false, code: "bar_tabs_open", open_tabs: S.tabs.length, tabs: S.tabs, message: fr, message_fr: fr, message_en: en });
      }
      return ok({ success: true, data: { ok: true, variance: 0 } });
    }
    const m = url.match(/^\\/bar\\/tabs\\/([^/]+)\\/(close|pay)$/);
    if (m && m[2] === "pay") S.tabs = S.tabs.filter((t) => t.id !== m[1]);
    return ok({ success: true, data: null });
  },
  patch: () => ok({ success: true }), put: () => ok({ success: true }), delete: () => ok({ success: true }),
  interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } },
};
export default api;
`);
writeFileSync(resolve(TMP, "entry.jsx"), `
import "../../src/index.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useAuthStore, useLangStore } from "../../src/store";
import { CloseShiftModal } from "../../src/components/common/ShiftWidgets";
const P = new URLSearchParams(location.search);
const screen = P.get("screen") || "cash";
useAuthStore.setState({ user: { id: "u-cash", role: "cashier", org_id: "o1", name: "Kosi", full_name: "Kosi", currency: "XAF", country: "Cameroun" }, token: "t" });
useLangStore.setState({ lang: P.get("lang") || "en" });
window.__opened = null; window.__loc = null;
function Where() { const l = useLocation(); window.__loc = { path: l.pathname, state: l.state || null }; return null; }
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(
  <MemoryRouter><QueryClientProvider client={qc}><Where />
    <CloseShiftModal open shift={{ shift_id: "S1", opening_float: 0, expected_drawer: 0, location_id: "L1" }}
      onClose={() => {}} onClosed={() => {}}
      {...(screen === "bar" ? { onOpenBarTab: (t) => { window.__opened = t; } } : {})} />
  </QueryClientProvider></MemoryRouter>);
`);

const mutate = MUTATIONS[TEETH] || [];
const hits = mutate.map(() => 0);
await build({
  entryPoints: { bundle: resolve(TMP, "entry.jsx") }, outdir: OUT, bundle: true, format: "esm",
  jsx: "automatic", loader: { ".js": "jsx", ".png": "file", ".svg": "file", ".woff2": "file", ".jpg": "file", ".webp": "file", ".mp3": "file" },
  define: { "import.meta.env": JSON.stringify({ MODE: "bar-close-fit", DEV: false, PROD: true, VITE_API_URL: "/api" }), "process.env.NODE_ENV": '"production"' },
  logLevel: "error", external: ["https://*"], publicPath: "/",
  plugins: [{ name: "bar-close-fit", setup(b) {
    const API = resolve(ROOT, "src/utils/api");
    b.onResolve({ filter: /(^|\/)api(\.js)?$/ }, (a) => {
      const p = resolve(a.resolveDir, a.path).replace(/\.js$/, "");
      return p === API ? { path: resolve(TMP, "api-mock.js") } : undefined;
    });
    b.onLoad({ filter: /src[\\/]index\.css$/ }, async (a) => ({ loader: "css",
      contents: (await postcss([tailwind({ config: resolve(ROOT, "tailwind.config.js") }), autoprefixer]).process(readFileSync(a.path, "utf8"), { from: a.path })).css }));
    if (mutate.length) b.onLoad({ filter: /src[\\/].*\.jsx?$/ }, (a) => {
      const norm = a.path.split("\\").join("/");
      const idx = mutate.map((m, i) => (m.file.test(norm) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return undefined;
      let src = readFileSync(a.path, "utf8");
      for (const i of idx) { const n = src.split(mutate[i].from).length - 1;
        if (n !== 1) throw new Error(`teeth mutation ${i} expected 1 copy in ${norm}, found ${n}`); src = src.replace(mutate[i].from, mutate[i].to); hits[i]++; }
      return { contents: src, loader: "jsx" };
    });
  } }],
});
rmSync(TMP, { recursive: true, force: true });
if (hits.some((h) => h !== 1)) { console.error("teeth mutation did not land exactly once"); process.exit(3); }
writeFileSync(resolve(OUT, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`);
}   // end of the build phase
if (PHASE === "build") { console.log(`built ${OUT}`); process.exit(0); }
if (PHASE === "run" && !existsSync(resolve(OUT, "bundle.js"))) { console.error(`no build at ${OUT} — run the build phase first`); process.exit(3); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((q, s) => { const p = resolve(OUT, "." + (q.url.split("?")[0] === "/" ? "/index.html" : q.url.split("?")[0]));
  if (!p.startsWith(OUT) || !existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); s.end(readFileSync(p)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });
const SIZES = SIZE_LIST.filter(([n]) => !process.env.BAR_CLOSE_ONLY || process.env.BAR_CLOSE_ONLY === n);
const WORDS = {
  en: { line: (t) => `Close or take payment for ${t}`, pay: "Take payment", empty: "Close empty tab", close: "✓ Close shift" },
  fr: { line: (t) => `Fermez ou encaissez ${t}`, pay: "Encaisser", empty: "Fermer la note vide", close: "✓ Fermer le poste" },
};
const LAYOUT = () => {
  const W = innerWidth, H = innerHeight, out = [];
  for (const b of document.querySelectorAll(".shift-bar-tab button")) {
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = b.getBoundingClientRect(), t = document.elementFromPoint(Math.min(W - 1, r.left + r.width / 2), Math.min(H - 1, r.top + r.height / 2));
    out.push({ text: b.textContent.trim(), inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5,
      onTop: !!t && (t === b || b.contains(t)), h: Math.round(r.height) });
  }
  return { buttons: out, sideways: document.scrollingElement.scrollWidth > W + 1 };
};
const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".shift-bar-tab")].map((r) => ({
  line: (r.querySelector(".shift-bar-tab-line") || r).textContent.replace(/\s+/g, " ").trim(),
  buttons: [...r.querySelectorAll("button")].map((b) => b.textContent.trim()) })));
const countIn = (hay, needle) => hay.split(needle).length - 1;

for (const [size, W, H] of SIZES) for (const lang of ["en", "fr"].filter((l) => !process.env.BAR_CLOSE_LANG || process.env.BAR_CLOSE_LANG === l))
for (const screen of ["cash", "bar"].filter((s) => !process.env.BAR_CLOSE_SCREEN || process.env.BAR_CLOSE_SCREEN === s)) {
  const tag = `${size} ${lang} ${screen === "cash" ? "Cash screen" : "bar floor"}`;
  const w = WORDS[lang];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: size !== "pc" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/?screen=${screen}&lang=${lang}`);
    await page.locator("input").first().fill("0");
    await page.getByRole("button", { name: w.close }).click({ timeout: 8000 });
    await page.locator(".shift-bar-tab").first().waitFor({ timeout: 8000 });
    const R = await rows(page);
    const body = await page.evaluate(() => document.body.innerText);
    check(`${tag}: one line per open tab (2)`, R.length === 2, JSON.stringify(R));
    check(`${tag}: "${w.line("T1 · Bonaberri")}" → only "${w.pay}"`, R[0] && R[0].line === w.line("T1 · Bonaberri") && JSON.stringify(R[0].buttons) === JSON.stringify([w.pay]), JSON.stringify(R[0]));
    check(`${tag}: "${w.line("Jo · Bonaberri")}" (empty) → only "${w.empty}"`, R[1] && R[1].line === w.line("Jo · Bonaberri") && JSON.stringify(R[1].buttons) === JSON.stringify([w.empty]), JSON.stringify(R[1]));
    check(`${tag}: each line shown ONCE — no summary sentence, no repeat of the server message`,
      countIn(body, w.line("T1 · Bonaberri")) === 1 && countIn(body, w.line("Jo · Bonaberri")) === 1 && !/open bar tab|note\(s\) de bar|Take payment for your|Encaissez d'abord/i.test(body), body.slice(0, 300));
    const lay = await page.evaluate(LAYOUT);
    check(`${tag}: every button reachable, fully in view, on top, ≥ 40 px tall`, lay.buttons.length === 2 && lay.buttons.every((b) => b.inView && b.onTop && b.h >= 40), JSON.stringify(lay.buttons));
    check(`${tag}: no sideways scroll`, !lay.sideways);
    await page.locator(".shift-bar-tab", { hasText: "Jo · Bonaberri" }).getByRole("button", { name: w.empty }).click({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll(".shift-bar-tab").length === 1, null, { timeout: 5000 });
    const calls = await page.evaluate(() => window.__api.calls.map((c) => c.url));
    check(`${tag}: ${w.empty} → POST /bar/tabs/jo/close then /pay, its line goes`, calls.indexOf("/bar/tabs/jo/close") >= 0 && calls.indexOf("/bar/tabs/jo/pay") > calls.indexOf("/bar/tabs/jo/close"), JSON.stringify(calls));
    await page.locator(".shift-bar-tab", { hasText: "T1 · Bonaberri" }).getByRole("button", { name: w.pay }).click({ timeout: 5000 });
    await page.waitForFunction(() => window.__opened || (window.__loc && window.__loc.path === "/bar"), null, { timeout: 5000 }).catch(() => {});
    const went = await page.evaluate(() => ({ opened: window.__opened, loc: window.__loc }));
    check(`${tag}: ${w.pay} opens tab T1 (${screen === "bar" ? "on the floor" : "→ the bar"})`, screen === "bar"
      ? !!went.opened && went.opened.id === "t1"
      : !!went.loc && went.loc.path === "/bar" && went.loc.state && went.loc.state.openTab && went.loc.state.openTab.id === "t1", JSON.stringify(went));
    check(`${tag}: no page error`, errs.length === 0, errs.join(" | "));
  } catch (e) {
    check(`${tag}: ran to the end`, false, e.message.split("\n")[0] + (errs.length ? ` · page error: ${errs.join(" | ")}` : ""));
  } finally { await ctx.close(); }
}
await browser.close(); server.close();

if (TEETH) {
  console.log(`\nTEETH ${TEETH}: ${fails ? `RED as required (${fails} failed)` : "STILL GREEN — the check has no teeth"}`);
  process.exit(fails ? 0 : 1);
}
console.log(fails ? `\nFAIL — ${fails} check(s) failed, ${passes} passed` : `\nPASS — ${passes}/${passes}: the bar shift-close refusal names each tab, phone/tablet/PC, EN + FR, Cash screen + bar floor`);
process.exit(fails ? 1 : 0);
