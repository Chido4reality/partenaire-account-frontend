// SUB-PRICE-2026-12 — plan page browser proof (Peter 2026-11-25). The REAL RequestActivationPage (esbuild, the app's
// own CSS through PostCSS — no Vite) in Chromium; ONLY utils/api is replaced by an in-page mock that answers
// GET /subscriptions/plans exactly as the backend does (shape + numbers proven live by be scripts/sub-price-probe.mjs:
// CM 10 000 / 15 000 / 20 000 FCFA, NG ₦25,000 / ₦35,000 / ₦45,000, launch discount −3 000 / −₦10,000 a month as on staging).
// Scenarios: cm · ng · cmpromo (CM shop with a 15 000 FCFA promo code — bigger than one month, so the server's period
// total is NOT monthly × months: the page must show the server's figure, and keep all three plans).
// Phone 360×740 + tablet 768×1024 · EN + FR. Checks: periods 12 → 6 → 3 only, 12 marked Recommended/Recommandé and
// chosen by default; every plan × period: card total, Total line and Pay button = the server's figure; Pay sends
// { plan_id, months } and nothing else; buttons in view, on top, ≥ 40 px; badge not clipped; no sideways scroll.
// Screenshots: <tmp>/sub-price-shots/<scenario>-<size>-<lang>.png
// Teeth: SUB_PAGE_TEETH=1|2|3 bundles a mutated copy (tree untouched) and must go RED.
//   1 = the page multiplies monthly × months again · 2 = default period 3, not 12 · 3 = no Recommended badge
// Run: node scripts/sub-price-page-fit.mjs — SPLIT by default (scripts/lib/splitRun.mjs) · SUB_PAGE_NOSPLIT=1 = one process
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
const TEETH = process.env.SUB_PAGE_TEETH || "";
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const TMP = resolve(ROOT, "scripts", "__subpricefit");
const OUT = resolve(os.tmpdir(), `sub-price-fit-app${TEETH ? "-teeth" + TEETH : ""}`);
const SHOTS = resolve(os.tmpdir(), "sub-price-shots");

const RAP = /pages\/RequestActivationPage\.jsx$/;
const MUTATIONS = {
  1: [{ file: RAP, from: "if (d && d.amount != null) return", to: "if (false && d && d.amount != null) return" }],
  2: [{ file: RAP, from: "useState(RECOMMENDED_MONTHS)", to: "useState(3)" }],
  3: [{ file: RAP, from: "{rec && (", to: "{false && (" }],
};
if (TEETH && !MUTATIONS[TEETH]) { console.error(`unknown SUB_PAGE_TEETH=${TEETH}`); process.exit(2); }

const PHASE = process.env.SPLIT_PHASE || "all";
const SIZE_LIST = [["phone", 360, 740], ["tablet", 768, 1024]];
const SCEN = ["cm", "ng", "cmpromo"];
if (!process.env.SPLIT_CHILD && !process.env.SUB_PAGE_NOSPLIT) {
  const { splitRun } = await import("./lib/splitRun.mjs");
  const cases = [];
  for (const [size] of SIZE_LIST) for (const lang of ["en", "fr"]) for (const sc of SCEN)
    cases.push({ label: `${size} ${lang} ${sc}`, env: { SUB_PAGE_SIZE: size, SUB_PAGE_LANG: lang, SUB_PAGE_SCEN: sc } });
  await splitRun({ name: "plan page: 12/6/3 months, 12 recommended, totals = the server's, phone + tablet, EN + FR, CM + NG", script: fileURLToPath(import.meta.url), cases, teeth: !!TEETH });
}

let fails = 0, passes = 0;
const check = (label, ok, detail = "") => { ok ? passes++ : fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail !== "" ? `  [${String(detail).slice(0, 300)}]` : ""}`); };

// ── what the backend answers (be GET /subscriptions/plans) ──────────────────
const LIST = { XAF: { lite: 10000, pro: 15000, pro_plus: 20000 }, NGN: { lite: 25000, pro: 35000, pro_plus: 45000 } };
const OFF = { XAF: 3000, NGN: 10000 };
function plansFor(sc) {
  const cur = sc === "ng" ? "NGN" : "XAF";
  const names = { lite: ["Lite", "🥈"], pro: ["Pro", "🥇"], pro_plus: ["Pro Plus", "👑"] };
  return Object.keys(LIST[cur]).map((id) => {
    const list = LIST[cur][id], off = OFF[cur];
    const launch = { source: "launch", scope_type: "launch", scope_value: cur, discount_type: "amount", discount_value: off };
    const durations = [12, 6, 3].map((m) => {
      const full = list * m, viaLaunch = (list - off) * m;
      const viaPromo = sc === "cmpromo" ? Math.max(0, full - 15000) : Infinity;
      return viaPromo < viaLaunch
        ? { months: m, recommended: m === 12, amount: viaPromo, original_amount: full, discount: { source: "promo", code: "PROBE", discount_type: "amount", discount_value: 15000, amount_off: full - viaPromo } }
        : { months: m, recommended: m === 12, amount: viaLaunch, original_amount: full, discount: { ...launch, amount_off: off * m } };
    });
    const monthly = sc === "cmpromo" ? Math.max(0, list - 15000) : list - off;   // the months=1 figure the server still sends
    return { id, name: names[id][0], badge_icon: names[id][1], is_active: true, price_monthly: list, max_locations: id === "lite" ? 1 : -1, max_products: id === "lite" ? 100 : -1, max_users: id === "lite" ? 2 : -1,
      features: [], price: monthly, original_price: list, discount: sc === "cmpromo" ? { source: "promo", discount_type: "amount", discount_value: 15000, amount_off: list - monthly } : { ...launch, amount_off: off },
      durations, allowed_months: [3, 6, 12], recommended_months: 12, currency: cur, country: cur === "NGN" ? "Nigeria" : "Cameroun" };
  });
}

if (PHASE !== "run") {
mkdirSync(TMP, { recursive: true });
writeFileSync(resolve(TMP, "api-mock.js"), `
const P = new URLSearchParams(location.search);
const S = window.__api = { calls: [], plans: JSON.parse(decodeURIComponent(P.get("plans") || "[]")), promo: P.get("promo") === "1" };
const ok = (data) => Promise.resolve({ data });
const api = {
  get: (url) => {
    S.calls.push({ m: "GET", url });
    if (url === "/subscriptions/plans") return ok({ success: true, data: S.plans });
    if (url === "/subscriptions/my-plan") return ok({ success: true, data: { has_pending_request: false, user_id_number: "MP-000123" } });
    if (url === "/promo/mine") return ok({ success: true, data: S.promo ? { code: "PROBE", eligible_now: true } : null });
    return ok({ success: true, data: null });
  },
  post: (url, body) => { S.calls.push({ m: "POST", url, body: body || null }); return ok({ success: true, data: { link: null } }); },
  patch: () => ok({ success: true }), put: () => ok({ success: true }), delete: () => ok({ success: true }),
  interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } },
};
export const formatDate = (d) => String(d || "");
export default api;
`);
writeFileSync(resolve(TMP, "entry.jsx"), `
import "../../src/index.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore, useLangStore } from "../../src/store";
import RequestActivationPage from "../../src/pages/RequestActivationPage";
const P = new URLSearchParams(location.search);
const cur = P.get("cur") || "XAF";
const org = { id: "o1", name: "Probe Shop", currency: cur, country: cur === "NGN" ? "Nigeria" : "Cameroun", plan_id: "trial" };
useAuthStore.setState({ user: { id: "u1", role: "owner", org_id: "o1", full_name: "Owner", currency: cur, country: org.country }, org, token: "t" });
useLangStore.setState({ lang: P.get("lang") || "en" });
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(<MemoryRouter><QueryClientProvider client={qc}><RequestActivationPage /></QueryClientProvider></MemoryRouter>);
`);
const mutate = MUTATIONS[TEETH] || [];
const hits = mutate.map(() => 0);
await build({
  entryPoints: { bundle: resolve(TMP, "entry.jsx") }, outdir: OUT, bundle: true, format: "esm",
  jsx: "automatic", loader: { ".js": "jsx", ".png": "file", ".svg": "file", ".woff2": "file", ".jpg": "file", ".webp": "file", ".mp3": "file" },
  define: { "import.meta.env": JSON.stringify({ MODE: "sub-price-fit", DEV: false, PROD: true, VITE_API_URL: "/api" }), "process.env.NODE_ENV": '"production"' },
  logLevel: "error", external: ["https://*"], publicPath: "/",
  plugins: [{ name: "sub-price-fit", setup(b) {
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
mkdirSync(SHOTS, { recursive: true });

const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });
const WORDS = { en: { mo: (m) => `${m} months`, rec: "Recommended" }, fr: { mo: (m) => `${m} mois`, rec: "Recommandé" } };
const digits = (s) => Number(String(s || "").replace(/[^0-9]/g, "")) || 0;

for (const [size, W, H] of SIZE_LIST.filter(([n]) => !process.env.SUB_PAGE_SIZE || process.env.SUB_PAGE_SIZE === n))
for (const lang of ["en", "fr"].filter((l) => !process.env.SUB_PAGE_LANG || process.env.SUB_PAGE_LANG === l))
for (const sc of SCEN.filter((s) => !process.env.SUB_PAGE_SCEN || process.env.SUB_PAGE_SCEN === s)) {
  const tag = `${size} ${lang} ${sc}`, w = WORDS[lang], plans = plansFor(sc);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/?lang=${lang}&cur=${plans[0].currency}&promo=${sc === "cmpromo" ? 1 : 0}&plans=${encodeURIComponent(JSON.stringify(plans))}`);
    await page.locator(".sub-durations button").first().waitFor({ timeout: 8000 });
    const btns = await page.evaluate(() => [...document.querySelectorAll(".sub-durations button")].map((b) => ({ m: Number(b.dataset.months), text: b.innerText.replace(/\s+/g, " ").trim(), on: b.getAttribute("aria-checked") === "true", rec: !!b.querySelector(".sub-recommended") })));
    check(`${tag}: periods 12 → 6 → 3 only`, JSON.stringify(btns.map((b) => b.m)) === "[12,6,3]" && btns.every((b) => b.text.includes(w.mo(b.m))), JSON.stringify(btns));
    check(`${tag}: "${w.rec}" on 12 months only, and 12 is chosen by default`, btns.filter((b) => b.rec).map((b) => b.m).join() === "12" && btns.find((b) => b.m === 12)?.text.includes(w.rec) && btns.filter((b) => b.on).map((b) => b.m).join() === "12", JSON.stringify(btns));
    const cards = await page.locator(".plan-period-total").count();
    check(`${tag}: all three plans shown (Lite, Pro, Pro Plus)`, cards === 3, `${cards} cards`);
    await page.screenshot({ path: resolve(SHOTS, `${sc}-${size}-${lang}.png`), fullPage: true });
    const bad = [];
    for (const [pi, p] of plans.entries()) {
      await page.locator(".plan-period-total").nth(pi).click();
      for (const m of [12, 6, 3]) {
        await page.locator(`.sub-durations button[data-months="${m}"]`).click();
        const want = p.durations.find((d) => d.months === m).amount;
        const seen = await page.evaluate(() => ({ cards: [...document.querySelectorAll(".plan-period-total")].map((e) => e.textContent), total: document.querySelector(".sub-total")?.textContent,
          pay: [...document.querySelectorAll("button")].map((b) => b.textContent).find((t) => /Flutterwave/.test(t)) || "" }));
        const cardsOk = plans.every((q, qi) => digits(seen.cards[qi]) === q.durations.find((d) => d.months === m).amount);
        if (!(digits(seen.total) === want && cardsOk && digits(seen.pay.split("—").pop()) === want)) bad.push(`${p.id} ${m}: total ${seen.total} pay "${seen.pay}" cards ${seen.cards.join("/")} want ${want}`);
      }
    }
    check(`${tag}: every plan × period — card, Total and Pay button = the server's figure (9 combinations)`, bad.length === 0, bad.join(" | "));
    await page.locator(".plan-period-total").nth(1).click();
    await page.locator(`.sub-durations button[data-months="6"]`).click();
    await page.locator("button", { hasText: "Flutterwave" }).click();
    await page.waitForFunction(() => window.__api.calls.some((c) => c.url === "/subscriptions/flw/initiate"), null, { timeout: 5000 });
    const sent = await page.evaluate(() => window.__api.calls.filter((c) => c.url === "/subscriptions/flw/initiate").map((c) => c.body));
    check(`${tag}: Pay sends { plan_id: "pro", months: 6 } — no price`, sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ plan_id: "pro", months: 6 }), JSON.stringify(sent));
    const lay = await page.evaluate(() => {
      const W = innerWidth, H = innerHeight, out = [];
      for (const b of document.querySelectorAll(".sub-durations button")) {
        b.scrollIntoView({ block: "nearest" });
        const r = b.getBoundingClientRect(), t = document.elementFromPoint(Math.min(W - 1, r.left + r.width / 2), Math.min(H - 1, r.top + r.height / 2));
        out.push({ m: b.dataset.months, inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5, onTop: !!t && (t === b || b.contains(t)), h: Math.round(r.height) });
      }
      const badge = document.querySelector(".sub-recommended"); let badgeOk = false;
      if (badge) { badge.scrollIntoView({ block: "center" }); const r = badge.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        badgeOk = r.left >= 0 && r.right <= W && r.width > 20 && r.height > 8 && !!t && (t === badge || badge.contains(t)); }
      const tot = document.querySelector(".sub-total");
      const cut = [...document.querySelectorAll(".sub-durations button div")].filter((d) => d.scrollWidth > d.clientWidth + 1).map((d) => d.textContent);
      return { out, badgeOk, sideways: document.scrollingElement.scrollWidth > W + 1, totalLines: tot ? tot.getClientRects().length : 0, cut };
    });
    check(`${tag}: the Total amount sits on one line (not "84 000 / FCFA")`, lay.totalLines === 1, `${lay.totalLines} lines`);
    check(`${tag}: no period price cut off`, lay.cut.length === 0, JSON.stringify(lay.cut));
    check(`${tag}: the 3 period buttons in view, on top, ≥ 40 px tall`, lay.out.length === 3 && lay.out.every((b) => b.inView && b.onTop && b.h >= 40), JSON.stringify(lay.out));
    check(`${tag}: "${w.rec}" badge fully visible (not clipped or covered)`, lay.badgeOk);
    check(`${tag}: no sideways scroll`, !lay.sideways);
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
console.log(fails ? `\nFAIL — ${fails} check(s) failed, ${passes} passed` : `\nPASS — ${passes}/${passes}: plan page 12/6/3, recommended, server totals, phone + tablet, EN + FR, CM + NG (shots in ${SHOTS})`);
process.exit(fails ? 1 : 0);
