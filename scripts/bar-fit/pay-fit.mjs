// PAYMENT PANEL FIT (Peter 2026-11-19, tablet test): on a LANDSCAPE tablet the bottom of the payment panel
// (Full Credit → the red warning, "Choose customer", Back / Confirm) was cut off. This harness opens the
// payment panel with Full Credit at the 8 fit sizes in BOTH orientations, on /bar AND New Sale (/pos), and
// asserts for each:
//   - Back and Confirm are on screen, inside the viewport, on top (no scrolling needed);
//   - the warning and "Choose customer" are reachable: after scrolling ONLY the payment panel's own
//     scroller they are fully inside the viewport and on top — and the page itself never scrolls;
//   - KEYBOARD: "Choose customer" → the search box focused, the viewport shrunk to 60 % of its height (the
//     app's WebView resizes for the keyboard) → the search box and Confirm are still on screen.
// LOCAL ONLY like shots.mjs: fixtures, nothing leaves this machine. Screenshots → docs/bar-fit/pay-*.png.
// Run: node scripts/bar-fit/bundle.mjs && node scripts/bar-fit/pay-fit.mjs   (BAR_PAY_ONLY=1024x768,… · BAR_PAY_APP=bar|pos)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = process.env.BAR_PAY_OUT ? resolve(process.env.BAR_PAY_OUT) : resolve(ROOT, "docs/bar-fit");
mkdirSync(OUT, { recursive: true });
const APP = resolve(os.tmpdir(), process.env.BAR_PAY_APPDIR || "bar-fit-app");
if (!existsSync(resolve(APP, "bundle.js"))) { console.error(`no bundle in ${APP} — run node scripts/bar-fit/bundle.mjs first`); process.exit(2); }
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const { chromium } = await import(pathToFileURL(PW).href);
const SHOTS = !process.env.BAR_PAY_NOSHOTS;

const ANDROID_TAB = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";
const SIZES = [["1024x768", 1024, 768, "tablet"], ["1180x820", 1180, 820, "tablet"], ["1280x800", 1280, 800, "tablet"], ["1366x1024", 1366, 1024, "tablet"],
  ["1920x1080", 1920, 1080, "desktop"], ["768x1024", 768, 1024, "tablet"], ["800x1280", 800, 1280, "tablet"], ["390x844", 390, 844, "phone"]];
const ONLY = (process.env.BAR_PAY_ONLY || "").split(",").filter(Boolean);
const APPS = (process.env.BAR_PAY_APP || "bar,pos").split(",");
// each size as listed AND rotated
const CASES = [];
for (const [n, w, h, kind] of SIZES) for (const rot of [false, true]) {
  const W = rot ? h : w, H = rot ? w : h, name = `${W}x${H}`;
  if (ONLY.length && !ONLY.includes(name)) continue;
  if (!CASES.some((c) => c.name === name)) CASES.push({ name, W, H, kind });
}

// ── fixtures (as customer-pick.mjs) ────────────────────────────────────────────────────────
const BON = "b0b0b0b0-0000-0000-0000-000000000002";
const ok = (data) => ({ success: true, data });
const PRODUCTS = [["bon1", "Castel Beer 65cl", 1000], ["bon2", "Guinness Foreign Extra Stout 65cl Bottle", 1500], ["bon3", "Coca-Cola 50cl", 600],
  ["bon4", "Johnnie Walker Black Label 12 Years Old 75cl", 25000], ["bon5", "Brochettes de bœuf (4 pièces)", 2500]].map(([id, n, p]) => ({ id, name: n, sell_price: p, min_price: 0, cost_price: 0,
  unit: "piece", is_multipart: false, stock: { quantity: 40, min_quantity: 5 }, pa_categories: { name: "Bières", color: null } }));
const CUSTOMERS = [{ id: "c2", name: "Ngono Marie", phone: "677000002", customer_type: "retail", credit_limit: 500000, total_debt: 0 }];
const USER = { id: "u1", org_id: "o1", role: "owner", full_name: "Boss Dozie", phone: "699000101", has_seen_onboarding: true, location_id: null };
const ORG = { id: "o1", name: "Dozie Tube & Tyre", plan: "pro_plus", subscription_status: "active", currency: "XAF", bar_mode_enabled: true, max_offline_hours: 24 };
const LOCS = [{ id: BON, name: "Bonaberri", type: "shop", is_active: true }];
function answer(path, q) {
  if (path === "/auth/me") return ok({ user: USER, org: ORG });
  if (path === "/bar/mine") return ok({ bars: [{ id: BON, name: "Bonaberri" }], can_setup: true, can_serve: true });
  if (path === "/locations") return ok(LOCS);
  if (/^\/bar\/[^/]+\/floor$/.test(path)) return ok({ zones: [{ id: "z1", name: "Salle" }], tables: [{ id: "t1", label: "T1", zone_id: "z1", tab: null }], named_tabs: [] });
  if (/^\/bar\/[^/]+\/quick-items$/.test(path)) return ok({ ids: PRODUCTS.map((p) => p.id) });
  if (path === "/products") return ok(PRODUCTS);
  if (path === "/products/multipart-availability") return ok({});
  if (path === "/customers") return ok(CUSTOMERS);
  if (path === "/held-carts") return ok([]);
  if (path === "/sales/tickets/summary") return ok({ mode: "direct", open_count: 0 });
  if (path === "/shifts/current") return ok({ shift_id: `s-${q.get("location_id")}`, location_id: q.get("location_id"), opened_at: "2026-11-19T07:00:00.000Z", status: "open" });
  return null;
}

const results = []; let fails = 0, passes = 0;
const check = (tag, label, pass, detail = "") => { if (pass) passes++; else fails++; results.push({ tag, label, pass, detail }); console.log(`  ${pass ? "pass" : "FAIL"}  ${label}${!pass && detail ? `  [${detail}]` : ""}`); };

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const serveFile = (f) => { try { return statSync(f).isFile() ? f : null; } catch { return null; } };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = serveFile(resolve(APP, "." + p)) || serveFile(resolve(ROOT, "public", "." + p)) || resolve(APP, "index.html");
  res.writeHead(200, { "content-type": TYPES[(f.match(/\.[a-z0-9]+$/i) || [""])[0]] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(5195, r));
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });

// measured in the page: is `el` reachable — scroll its own scroll container(s) (never the page), then it
// must be fully inside the viewport and the topmost element at its centre
const REACH = ({ texts, pinned }) => {
  const W = innerWidth, H = innerHeight, se = document.scrollingElement;
  const find = (re) => { const rx = new RegExp(re); return [...document.querySelectorAll("button, div")].filter((e) => rx.test(e.textContent.trim()) &&e.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]; };
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const onTop = (e) => { const r = e.getBoundingClientRect(); const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(H - 1, Math.max(0, r.top + r.height / 2)); const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); };
  const inView = (b) => b.l >= -0.5 && b.t >= -0.5 && b.r <= W + 0.5 && b.b <= H + 0.5;
  const out = {};
  for (const [key, re] of Object.entries(texts)) {
    const e = find(re);
    if (!e) { out[key] = { found: false }; continue; }
    const before = box(e), pageY0 = se.scrollTop;
    const pin = pinned.includes(key);
    if (!pin) {   // scroll only the element's own scrolling ancestors, not the page
      for (let p = e.parentElement; p && p !== document.body && p !== se; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) {
          const pr = p.getBoundingClientRect(), er = e.getBoundingClientRect();
          if (er.bottom > pr.bottom) p.scrollTop += er.bottom - pr.bottom + 4; else if (er.top < pr.top) p.scrollTop -= pr.top - er.top + 4;
        }
      }
    }
    let after = box(e), how = "minimal scroll";
    // a sticky Back/Confirm row can cover the end of the scroll area: a user then swipes to the END
    if (!pin && !(inView(after) && onTop(e))) {
      for (let p = e.parentElement; p && p !== document.body && p !== se; p = p.parentElement) {
        const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) p.scrollTop = p.scrollHeight;
      }
      after = box(e); how = "scrolled to the end";
    }
    out[key] = { found: true, before, after, how, inView: inView(after), onTop: onTop(e), pageScrolled: se.scrollTop !== pageY0 };
  }
  out.pageScrollY = se.scrollHeight - H;
  return out;
};

try {
  for (const app of APPS) for (const c of CASES) {
    const tag = `${app} ${c.name}`;
    console.log(`\n── ${tag} (${c.kind}${c.W > c.H ? ", landscape" : c.W < c.H ? ", portrait" : ""}) ──`);
    const phone = c.kind === "phone";
    const ctx = await browser.newContext({ viewport: { width: c.W, height: c.H }, deviceScaleFactor: 1, serviceWorkers: "block",
      userAgent: phone ? ANDROID_PHONE : c.kind === "tablet" ? ANDROID_TAB : undefined, hasTouch: c.kind !== "desktop", isMobile: phone });
    await ctx.addInitScript(({ USER, ORG, BON, PRODUCTS }) => {
      if (sessionStorage.getItem("__pay_init")) return; sessionStorage.setItem("__pay_init", "1");
      localStorage.clear();
      localStorage.setItem("mp-auth", JSON.stringify({ state: { user: USER, org: ORG, token: "probe-token", isAuthenticated: true, impersonating: false, impersonation: null, lastVerifiedActive: Date.now(), maxOfflineHours: 24 }, version: 0 }));
      localStorage.setItem("mp-lang", JSON.stringify({ state: { lang: "en" }, version: 0 }));
      localStorage.setItem("mp-settings", JSON.stringify({ state: { selectedLocation: { id: BON, name: "Bonaberri", type: "shop" } }, version: 0 }));
      // a 5-line cart (the tall case), restored by the POS from its own saved-cart store
      const items = PRODUCTS.map((p, i) => ({ lineId: `L${i}`, product_id: p.id, name: p.name, unit: "piece", quantity: i + 1, unit_price: p.sell_price, original_price: p.sell_price,
        sell_price: p.sell_price, min_price: 0, cost_price: 0, stock: 40, barLoc: BON }));
      localStorage.setItem("mp-pos-draft-cart", JSON.stringify({ state: { drafts: { [`${USER.id}::${BON}`]: { items, updatedAt: Date.now() } } }, version: 0 }));
    }, { USER, ORG, BON, PRODUCTS });
    await ctx.route((u) => u.hostname !== "localhost", (route) => route.abort());
    await ctx.route((u) => u.hostname === "localhost" && u.pathname.startsWith("/api/"), (route) => {
      const u = new URL(route.request().url()); const p = u.pathname.replace(/^\/api/, "");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().method() === "GET" ? (answer(p, u.searchParams) ?? ok([])) : ok({})) });
    });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    try {
      await page.goto(`http://localhost:5195/${app}`, { waitUntil: "domcontentloaded" });
      const proceed = page.getByRole("button", { name: /^(Proceed to Payment →|Take payment)$/ }).first();
      await proceed.waitFor({ state: "attached", timeout: 60000 });
      await page.waitForTimeout(500);
      if (!(await proceed.isVisible())) { await page.getByRole("button", { name: /Open cart/ }).click({ timeout: 15000 }); await page.waitForTimeout(800); }
      await proceed.click();
      await page.getByRole("button", { name: /Full Credit/ }).first().click({ timeout: 15000 });
      await page.waitForTimeout(500);
      // BAR_PAY_STILL=1 → still frames for a before/after pixel comparison (no animation, no caret, no toast)
      if (process.env.BAR_PAY_STILL) { await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} [role=status],[aria-live]{visibility:hidden!important}" }); await page.waitForTimeout(300); }
      const m = await page.evaluate(REACH, { texts: { warning: "^⚠️ A registered customer is required", choose: "^👤 Choose customer$", back: "^← Back$", confirm: "^✓ Confirm" }, pinned: ["back", "confirm"] });
      // BAR_PAY_LAYOUT=1 → every visible element's box (rounded to 0.1 px) + text, for a before/after LAYOUT comparison
      if (process.env.BAR_PAY_LAYOUT) writeFileSync(resolve(OUT, `layout-${app}-${c.name}.json`), JSON.stringify(await page.evaluate(() =>
        [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; })
          .map((e) => { const r = e.getBoundingClientRect(), f = (v) => Math.round(v * 10) / 10; return `${e.tagName} ${f(r.left)},${f(r.top)} ${f(r.width)}x${f(r.height)} ${e.children.length ? "" : (e.textContent || "").trim().slice(0, 30)}`; })), null, 0));
      if (SHOTS) await page.screenshot({ path: resolve(OUT, `pay-${app}-${c.name}.png`) });
      check(tag, `${tag}: the page itself does not scroll (${m.pageScrollY}px)`, m.pageScrollY <= 0);
      for (const [k, label] of [["back", "← Back"], ["confirm", "✓ Confirm"]])
        check(tag, `${tag}: “${label}” on screen without scrolling, on top`, m[k].found && m[k].inView && m[k].onTop && !m[k].pageScrolled, JSON.stringify(m[k]));
      for (const [k, label] of [["warning", "the red warning"], ["choose", "“Choose customer”"]])
        check(tag, `${tag}: ${label} reachable (panel scroll only), fully in view, on top`, m[k].found && m[k].inView && m[k].onTop && !m[k].pageScrolled, JSON.stringify(m[k]));
      // keyboard: open the search, shrink the viewport like a resizing WebView
      await page.getByRole("button", { name: /^👤 Choose customer$/ }).click();
      const input = page.getByRole("textbox", { name: /Search customer/ });
      await input.focus();
      await page.setViewportSize({ width: c.W, height: Math.round(c.H * 0.6) });
      await page.waitForTimeout(500);
      if (process.env.BAR_PAY_DEBUG) console.log(await page.evaluate(() => {   // the Confirm button's ancestor boxes
        const b = [...document.querySelectorAll("button")].find((e) => /^✓ Confirm/.test(e.textContent.trim())); const out = [];
        for (let p = b; p && p !== document.body; p = p.parentElement) { const r = p.getBoundingClientRect(), cs = getComputedStyle(p);
          out.push(`${p.tagName}.${(p.className || "").toString().slice(0, 20)} t=${Math.round(r.top)} h=${Math.round(r.height)} sh=${p.scrollHeight} ov=${cs.overflowY} flex=${cs.flex} minH=${cs.minHeight} pos=${cs.position}`); }
        return out.join("\n"); }));
      const sIn = await input.evaluate((el) => { // the browser's own "bring the focused field into view" (honours scroll-padding)
        const se = document.scrollingElement, y0 = se.scrollTop; el.scrollIntoView({ block: "nearest" }); se.scrollTop = y0;
        const r = el.getBoundingClientRect(); return { inView: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, t: Math.round(r.top), b: Math.round(r.bottom), H: innerHeight }; });
      // the focused field is scrolled into view (as Android does when the keyboard opens) — THEN Confirm must be on screen
      const k = await page.evaluate(REACH, { texts: { confirm: "^✓ Confirm" }, pinned: ["confirm"] }).catch(() => null);
      // at THE SAME moment (no scroll in between): the search box is in view AND not covered (e.g. by the pinned row)
      const sNow = await input.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
        return { inView: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5, onTop: !!t && (t === el || el.contains(t)), t: Math.round(r.top), b: Math.round(r.bottom), H: innerHeight }; });
      if (SHOTS) await page.screenshot({ path: resolve(OUT, `pay-${app}-${c.name}-keyboard.png`) });
      check(tag, `${tag} keyboard (viewport ${Math.round(c.H * 0.6)}px): the customer search box is in view and not covered — together with Confirm`, sIn.inView && sNow.inView && sNow.onTop, JSON.stringify({ sIn, sNow }));
      check(tag, `${tag} keyboard: “✓ Confirm” still on screen, on top`, !!k && k.confirm.found && k.confirm.inView && k.confirm.onTop, JSON.stringify(k && k.confirm));
      check(tag, `${tag}: no page errors`, !errs.length, errs.slice(0, 2).join(" | "));
    } catch (e) {
      check(tag, `${tag}: run`, false, e.message.split("\n")[0]);
      if (SHOTS) await page.screenshot({ path: resolve(OUT, `pay-${app}-${c.name}-ERROR.png`) }).catch(() => {});
    }
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
writeFileSync(resolve(OUT, "pay-results.json"), JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed, ${passes} passed` : `PASS — ${passes}/${passes}: the payment panel fits every screen`}\n`);
process.exit(fails ? 1 : 0);
