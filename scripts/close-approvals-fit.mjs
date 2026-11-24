// CLOSE SHIFT × OPEN MONEY REQUESTS — browser proof (2026-11-24). The REAL CloseShiftModal + CloseApprovalsPanel
// (esbuild, the app's own CSS through PostCSS — no Vite) in Chromium, with ONLY utils/api replaced by an in-page
// mock that answers like the server: POST /shifts/:id/close → 409 approvals_pending until every listed request is
// resolved or named in carry_over_approval_ids. Phone 360×740, tablet 768×1024, PC 1366×768 · EN + FR · cashier
// (asked for both requests) and owner. Checks: who sees which button, everything reachable + on top + ≥ 40 px
// tall, no sideways scroll, the close stays blocked until each request is handled, the re-sent close names
// exactly the carried ids, and the approve / finalize / cancel calls hit the existing routes.
// Teeth: CLOSE_FIT_TEETH=1|2|3 bundles a mutated copy (tree untouched) and must go RED.
//   1 = the close no longer sends carry_over_approval_ids · 2 = the button is not blocked · 3 = a cashier may approve
// Run: node scripts/close-approvals-fit.mjs   (CLOSE_FIT_ONLY=phone|tablet|pc narrows it)
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
const TEETH = process.env.CLOSE_FIT_TEETH || "";
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const TMP = resolve(ROOT, "scripts", "__closefit");           // entry + mock live beside src so relative imports resolve
const OUT = resolve(os.tmpdir(), `close-fit-app${TEETH ? "-teeth" + TEETH : ""}`);

const MUTATIONS = {
  1: [{ file: /components\/common\/ShiftWidgets\.jsx$/, from: "...(pendingAppr && carry.length ? { carry_over_approval_ids: carry } : {}),", to: "" }],
  2: [{ file: /components\/common\/ShiftWidgets\.jsx$/, from: "(!!blockedBy && !override) || apprBlocked}", to: "(!!blockedBy && !override)}" }],
  3: [{ file: /components\/common\/CloseApprovalsPanel\.jsx$/, from: `if (a.status === "pending") return { approve: boss,`, to: `if (a.status === "pending") return { approve: true,` }],
};
if (TEETH && !MUTATIONS[TEETH]) { console.error(`unknown CLOSE_FIT_TEETH=${TEETH}`); process.exit(2); }

let fails = 0, passes = 0;
const check = (label, ok, detail = "") => { ok ? passes++ : fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail !== "" ? `  [${String(detail).slice(0, 300)}]` : ""}`); };

// ── the page: real modal, mocked api ──────────────────────────────────────────────────────────────
mkdirSync(TMP, { recursive: true });
writeFileSync(resolve(TMP, "api-mock.js"), `
const P = new URLSearchParams(location.search);
const S = window.__api = { calls: [], list: [
  { id: "A", action_type: "bundled_sale", status: "approved", amount: 496000, requested_by: "u-cash", requested_by_name: "Kosi", target_ref: "credit", created_at: "2026-11-12T16:48:00Z" },
  { id: "B", action_type: "refund", status: "pending", amount: 12000, requested_by: "u-cash", requested_by_name: "Kosi", target_ref: "VNT-20261112-0031", created_at: "2026-11-12T18:02:00Z" } ] };
const ok = (data) => Promise.resolve({ data });
const no = (status, data) => Promise.reject(Object.assign(new Error("HTTP " + status), { response: { status, data } }));
const api = {
  get: () => ok({ success: true, data: null }),
  post: (url, body) => {
    S.calls.push({ url, body: body || null });
    if (/^\\/shifts\\/[^/]+\\/close$/.test(url)) {
      const ids = (body && body.carry_over_approval_ids) || [];
      if (S.list.length && !S.list.every((a) => ids.includes(a.id)))
        return no(409, { success: false, code: "approvals_pending", approvals: S.list, choices: ["approve", "refuse", "carry_over"],
          message_en: S.list.length + " approval request(s) …", message_fr: S.list.length + " demande(s) …" });
      return ok({ success: true, data: { ok: true, variance: 0 } });
    }
    const m = url.match(/^\\/staff\\/approvals\\/([^/]+)\\/(approve|reject|finalize|cancel)$/);
    if (m) {
      if (m[2] === "approve") S.list = S.list.map((a) => (a.id === m[1] ? { ...a, status: "approved" } : a));
      else S.list = S.list.filter((a) => a.id !== m[1]);
      return ok({ success: true, status: m[2] === "finalize" ? "executed" : "ok" });
    }
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
import { useAuthStore, useLangStore } from "../../src/store";
import { CloseShiftModal } from "../../src/components/common/ShiftWidgets";
const P = new URLSearchParams(location.search);
const role = P.get("role") || "cashier";
useAuthStore.setState({ user: { id: role === "cashier" ? "u-cash" : "u-owner", role, org_id: "o1", name: role, full_name: role, currency: "XAF", country: "Cameroun" }, token: "t" });
useLangStore.setState({ lang: P.get("lang") || "en" });
window.__closed = null;
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={qc}>
    <CloseShiftModal open shift={{ shift_id: "S1", opening_float: 0, expected_drawer: 0, location_id: "L1" }}
      onClose={() => {}} onClosed={(d) => { window.__closed = d || {}; }} />
  </QueryClientProvider>);
`);

const mutate = MUTATIONS[TEETH] || [];
const hits = mutate.map(() => 0);
await build({
  entryPoints: { bundle: resolve(TMP, "entry.jsx") }, outdir: OUT, bundle: true, format: "esm",
  jsx: "automatic", loader: { ".js": "jsx", ".png": "file", ".svg": "file", ".woff2": "file", ".jpg": "file", ".webp": "file", ".mp3": "file" },
  define: { "import.meta.env": JSON.stringify({ MODE: "close-fit", DEV: false, PROD: true, VITE_API_URL: "/api" }), "process.env.NODE_ENV": '"production"' },
  logLevel: "error", external: ["https://*"], publicPath: "/",
  plugins: [{ name: "close-fit", setup(b) {
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((q, s) => { const p = resolve(OUT, "." + (q.url.split("?")[0] === "/" ? "/index.html" : q.url.split("?")[0]));
  if (!p.startsWith(OUT) || !existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); s.end(readFileSync(p)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── the runs ──────────────────────────────────────────────────────────────────────────────────────
const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });
const SIZES = [["phone", 360, 740], ["tablet", 768, 1024], ["pc", 1366, 768]].filter(([n]) => !process.env.CLOSE_FIT_ONLY || process.env.CLOSE_FIT_ONLY === n);
const L = (en, fr) => new RegExp(`^(${en}|${fr})$`);
const T = {
  close: L("✓ Close shift", "✓ Fermer le poste"), blocked: L("Requests not finished", "Demandes non terminées"),
  closeCarry: /^(✓ Close · carry over \d|✓ Fermer · \d reportée\(s\))$/,
  approve: L("✓ Approve", "✓ Approuver"), refuse: L("✕ Refuse", "✕ Refuser"), complete: L("✓ Complete now", "✓ Terminer maintenant"),
  cancel: L("✕ Cancel request", "✕ Annuler la demande"), carry: L("↪ Carry over", "↪ Reporter"),
};

// every button in the requests panel: reachable inside the modal (its own scroll), fully in view, on top, ≥ 40 px
const LAYOUT = () => {
  const W = innerWidth, H = innerHeight, out = [];
  for (const b of document.querySelectorAll(".close-approvals button")) {
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = b.getBoundingClientRect(), t = document.elementFromPoint(Math.min(W - 1, r.left + r.width / 2), Math.min(H - 1, r.top + r.height / 2));
    out.push({ text: b.textContent.trim(), inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5,
      onTop: !!t && (t === b || b.contains(t)), h: Math.round(r.height) });
  }
  return { buttons: out, sideways: document.scrollingElement.scrollWidth > W + 1 };
};
const rowButtons = (page, id) => page.evaluate((id) => {   // the buttons of request `id` (rows are in list order)
  const rows = [...document.querySelectorAll(".close-approval-row")];
  const row = rows.find((r) => r.textContent.includes(id === "A" ? "credit" : "VNT-20261112-0031"));
  return row ? [...row.querySelectorAll("button")].map((b) => b.textContent.trim()) : null;
}, id);
const has = (list, re) => !!list && list.some((t) => re.test(t));
const clickIn = async (page, id, re) => {
  const row = page.locator(".close-approval-row", { hasText: id === "A" ? "credit" : "VNT-20261112-0031" });
  await row.getByRole("button", { name: re }).click({ timeout: 5000 });
};

for (const [size, W, H] of SIZES) for (const lang of ["en", "fr"]) for (const role of ["cashier", "owner"]) {
  const tag = `${size} ${lang} ${role}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: size !== "pc" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  try {
    await page.goto(`${BASE}/?role=${role}&lang=${lang}`);
    await page.locator("input").first().fill("0");
    await page.getByRole("button", { name: T.close }).click({ timeout: 8000 });
    await page.locator(".close-approvals").waitFor({ timeout: 8000 });
    const lay = await page.evaluate(LAYOUT);
    check(`${tag}: the refusal shows the 2 requests (not a bare error)`, (await page.locator(".close-approval-row").count()) === 2);
    check(`${tag}: every button reachable, fully in view, on top, ≥ 40 px tall`, lay.buttons.length > 0 && lay.buttons.every((b) => b.inView && b.onTop && b.h >= 40), JSON.stringify(lay.buttons.filter((b) => !(b.inView && b.onTop && b.h >= 40))));
    check(`${tag}: no sideways scroll`, !lay.sideways);
    const closeBtn = page.locator("button", { hasText: T.blocked });
    check(`${tag}: close blocked ("${lang === "en" ? "Requests not finished" : "Demandes non terminées"}") while requests are open`,
      (await closeBtn.count()) === 1 && (await closeBtn.isDisabled()), String(await closeBtn.count()));
    const a = await rowButtons(page, "A"), b = await rowButtons(page, "B");
    if (role === "cashier") {
      check(`${tag}: A (approved, mine) → Complete now · Cancel · Carry over`, has(a, T.complete) && has(a, T.cancel) && has(a, T.carry) && !has(a, T.approve), JSON.stringify(a));
      check(`${tag}: B (pending) → only Carry over for a cashier (no Approve / Refuse)`, has(b, T.carry) && !has(b, T.approve) && !has(b, T.refuse), JSON.stringify(b));
      await clickIn(page, "B", T.carry);
      await clickIn(page, "A", T.complete);
      await page.waitForFunction(() => document.querySelectorAll(".close-approval-row").length === 1, null, { timeout: 5000 });
      const calls = await page.evaluate(() => window.__api.calls.map((c) => c.url));
      check(`${tag}: Complete now → POST /staff/approvals/A/finalize, A leaves the list`, calls.includes("/staff/approvals/A/finalize"), JSON.stringify(calls));
    } else {
      check(`${tag}: A (approved, someone else's) → Cancel · Carry over, NOT Complete`, has(a, T.cancel) && has(a, T.carry) && !has(a, T.complete), JSON.stringify(a));
      check(`${tag}: B (pending) → Approve · Refuse · Carry over for the owner`, has(b, T.approve) && has(b, T.refuse) && has(b, T.carry), JSON.stringify(b));
      await clickIn(page, "B", T.approve);
      await page.locator(".close-approval-row input[type=password]").fill("owner-pass");
      await clickIn(page, "B", T.approve);
      await page.waitForFunction(() => /approved — not completed yet|approuvée — pas encore terminée/.test(document.querySelector(".close-approvals").textContent), null, { timeout: 5000 });
      const ap = await page.evaluate(() => window.__api.calls.find((c) => c.url === "/staff/approvals/B/approve"));
      check(`${tag}: Approve asks the password → POST /approve {pin}; B stays listed as approved-not-completed`, !!ap && ap.body?.pin === "owner-pass", JSON.stringify(ap));
      await clickIn(page, "A", T.cancel);
      await page.waitForFunction(() => document.querySelectorAll(".close-approval-row").length === 1, null, { timeout: 5000 });
      await clickIn(page, "B", T.carry);
    }
    const go = page.locator("button", { hasText: T.closeCarry });
    check(`${tag}: once every request is handled the close button opens ("carry over 1")`, (await go.count()) === 1 && !(await go.isDisabled()), String(await go.count()));
    if ((await go.count()) === 1 && !(await go.isDisabled())) await go.click();
    await page.waitForFunction(() => window.__closed !== null, null, { timeout: 5000 }).catch(() => {});
    const last = await page.evaluate(() => window.__api.calls.filter((c) => /\/close$/.test(c.url)).pop());
    check(`${tag}: the re-sent close names exactly the carried request → the shift closes`,
      JSON.stringify(last?.body?.carry_over_approval_ids) === JSON.stringify(["B"]) && (await page.evaluate(() => window.__closed !== null)), JSON.stringify(last && last.body));
    check(`${tag}: no page error`, errs.length === 0, errs.join(" | "));
  } catch (e) {
    check(`${tag}: ran to the end`, false, e.message.split("\n")[0]);
  } finally { await ctx.close(); }
}
await browser.close(); server.close();

if (TEETH) {
  console.log(`\nTEETH ${TEETH}: ${fails ? `RED as required (${fails} failed)` : "STILL GREEN — the check has no teeth"}`);
  process.exit(fails ? 0 : 1);
}
console.log(fails ? `\nFAIL — ${fails} check(s) failed, ${passes} passed` : `\nPASS — ${passes}/${passes}: the close-refusal dialog works on phone, tablet and PC, EN + FR`);
process.exit(fails ? 1 : 0);
