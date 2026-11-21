// BAR CART FIX — probe (Peter 2026-11-18, tablet test): the Home cart must be kept per branch.
// Found on staging: Bepanda's cart stayed on screen after switching to Bonaberri (intermittent).
// LOCAL ONLY, like shots.mjs: the real app bundle in headless Chromium, EVERY /api call answered here from
// fixtures, every non-localhost request aborted — nothing reaches staging or prod, no login, no writes.
// Each branch has its OWN products (names "Bon …" / "Bep …"), so a line from the wrong branch is visible.
//   P1  build a cart at Bonaberri → switch to Bepanda → Bepanda's cart is EMPTY → build Bepanda's own cart
//   P2  20 switches A↔B, each settled → every time the cart is exactly that branch's cart
//   P3  20 FAST switches (0–80 ms apart, no settling) → after each burst the cart is that branch's
//   P4  20 switches with a 300–900 ms network delay on every /api answer → right cart every time
//   P5  pay at Bepanda → the POST /sales holds ONLY Bepanda's lines, location_id = Bepanda
//       → back to Bonaberri → Bonaberri's cart intact
//   P6  a fresh device with NO saved carts: 20 switches → both carts empty every time
// 2026-11-19 (Peter, tablet: 5 Bepanda lines in Bonaberri's Home cart after Cash → back; the guard silent):
//   P7  Bepanda listed first; Bonaberri cart → ☰ Cash (open a shift) → back: /bar reopens on Bonaberri, its own cart
//   P8  → New Sale → back: same      P9  reload at Bepanda: reopens on Bepanda, each branch its own cart
//   P10 a cart saved before the per-line branch (Bepanda lines under Bonaberri's key): not shown, never sold
//   P10s the tablet's state — those lines already stamped "Bonaberri" + bad lines under the bar key: none shown,
//        the old bar-written cart removed by the store migration
//   P11 no shift: "Open a shift first" + Open shift beside Take payment → shift opened in place → pay goes through
// 2026-11-20 (Peter's tablet: "No connection" while the server had paid T1):
//   P12 Take payment whose answer is LOST (paid / not paid) or refused 409 "already paid" (tab or ticket shape):
//       the page reads the tab back and says what the server did; the pay is never re-sent.
// Teeth 3 (fix 2 removed) → red on P7/P9/P10/P10s; teeth 4 (in-place shift removed) → red on P11;
// teeth 5 (the bill's lost-pay read-back removed, POSPage) → red on P12a/b/c; teeth 6 (bill cart not locked) → red on P13b;
// teeth 7 (Send request to boss parks a held cart in bill mode) → red on P13e.
// Run: node scripts/bar-fit/bundle.mjs && BAR_FIT_PREBUILT=1 node scripts/bar-fit/branch-cart.mjs
// Teeth: BAR_CART_TEETH=1|2 node scripts/bar-fit/bundle.mjs && BAR_CART_TEETH=1|2 node scripts/bar-fit/branch-cart.mjs
//        (1 = the fix removed → must go red on the cart; 2 = also the pay guard removed → must also go red on P5)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const TEETH = process.env.BAR_CART_TEETH || "";
const APP = process.env.BAR_CART_APP ? resolve(os.tmpdir(), process.env.BAR_CART_APP) : resolve(os.tmpdir(), TEETH ? `bar-fit-app-teeth${TEETH}` : "bar-fit-app");   // BAR_CART_APP=bar-fit-app-base → the old code (reproduction)
if (!existsSync(resolve(APP, "bundle.js"))) { console.error(`no bundle in ${APP} — run node scripts/bar-fit/bundle.mjs first (same BAR_CART_TEETH)`); process.exit(2); }
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const { chromium } = await import(pathToFileURL(PW).href);
if (TEETH) console.log(`!!  TEETH ${TEETH}: bundle with the fix removed (${APP}) — this run MUST fail`);

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const BON = "b0b0b0b0-0000-0000-0000-000000000002", BEP = "b0b0b0b0-0000-0000-0000-000000000001";
const NAME = { [BON]: "Bonaberri", [BEP]: "Bepanda" };
const ok = (data) => ({ success: true, data });
const mk = (loc, tag, names, prices) => names.map((n, i) => ({ id: `${tag}${i + 1}`, name: `${tag === "bon" ? "Bon" : "Bep"} ${n}`, sell_price: prices[i],
  unit: "piece", is_multipart: false, stock: { quantity: 40, min_quantity: 5 }, pa_categories: { name: "Bières", color: null }, location_id: loc }));
const PRODUCTS = {
  [BON]: mk(BON, "bon", ["Castel", "Guinness", "Coca", "Water", "Mutzig", "Heineken"], [1000, 1500, 600, 500, 900, 1200]),
  [BEP]: mk(BEP, "bep", ["Booster", "Top Ananas", "Red Bull", "Smirnoff", "Beaufort", "Isenberg"], [1000, 600, 1500, 1500, 900, 1000]),
};
const ALL = [...PRODUCTS[BON], ...PRODUCTS[BEP]];
const USER = { id: "u1", org_id: "o1", role: "owner", full_name: "Boss Dozie", phone: "699000101", has_seen_onboarding: true, location_id: null };
const ORG = { id: "o1", name: "Dozie Tube & Tyre", plan: "pro_plus", subscription_status: "active", currency: "XAF", bar_mode_enabled: true, max_offline_hours: 24 };
const LOCS = [{ id: BON, name: "Bonaberri", type: "shop", is_active: true }, { id: BEP, name: "Bepanda", type: "shop", is_active: true }];
const TABLES = Array.from({ length: 4 }, (_, i) => ({ id: `t${i + 1}`, label: `T${i + 1}`, zone_id: "z1", tab: null }));

function answer(path, q, st = {}) {
  if (path === "/auth/me") return ok({ user: USER, org: ORG });
  // st.bepFirst: Bepanda listed first, as staging's /bar/mine does (no ORDER BY) — the "jumped to Bepanda" case
  if (path === "/bar/mine") return ok({ bars: st.bepFirst ? [{ id: BEP, name: "Bepanda" }, { id: BON, name: "Bonaberri" }] : [{ id: BON, name: "Bonaberri" }, { id: BEP, name: "Bepanda" }], can_setup: true, can_serve: true });
  if (path === "/shifts/current" && st.noShift && st.noShift.has(q.get("location_id"))) return ok(null);
  // GET /bar/tabs/:id = the BILL (2026-11-20): served lines, version, the boss's answer (st.approval)
  const tb = path.match(/^\/bar\/tabs\/([^/]+)$/); if (tb) { (st.tabReads = st.tabReads || []).push(tb[1]);
    const named = Object.values(st.named || {}).flat().find((t) => t.id === tb[1]) || {};
    return ok({ id: tb[1], name: named.name || null, status: (st.tabTrue || {})[tb[1]] || "closed", location_id: BON, sale_id: `sale-${tb[1]}`,
      pa_sales: { version: 3, total_amount: 1500, sale_number: `T-${tb[1]}` },
      bill_lines: [{ product_id: "bon2", quantity: 1, unit_price: 1500, name: "Bon Guinness", price_tier: "walk_in" }],
      approval: (st.approval || {})[tb[1]] || null }); }
  const sl = path.match(/^\/sales\/(sale-[^/]+)$/); if (sl) { (st.saleReads = st.saleReads || []).push(sl[1]); return ok({ id: sl[1], sale_number: `T-${sl[1]}`, total_amount: 1500, status: "paid" }); }
  if (path === "/locations") return ok(LOCS);
  if (/^\/bar\/[^/]+\/floor$/.test(path)) return ok({ zones: [{ id: "z1", name: "Salle" }], tables: TABLES, named_tabs: (st.named && st.named[path.split("/")[2]]) || [] });
  const qi = path.match(/^\/bar\/([^/]+)\/quick-items$/); if (qi) return ok({ ids: (PRODUCTS[qi[1]] || []).map((p) => p.id) });
  if (path === "/products") return ok(PRODUCTS[q.get("location_id")] || []);
  if (path === "/products/multipart-availability") return ok({});
  if (path === "/held-carts") return ok([]);
  if (path === "/sales/tickets/summary") return ok({ mode: "direct", open_count: 0 });   // a direct till: Confirm completes the sale
  if (path === "/shifts/current") return ok({ shift_id: `s-${q.get("location_id")}`, location_id: q.get("location_id"), opened_at: new Date().toISOString(), status: "open" });
  return null;
}

let fails = 0, passes = 0, lastPage = null;
const check = (label, pass, detail = "") => { if (pass) passes++; else fails++; console.log(`  ${pass ? "pass" : "FAIL"}  ${label}${!pass && detail ? `  [${detail}]` : ""}`); };

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const serveFile = (f) => { try { return statSync(f).isFile() ? f : null; } catch { return null; } };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = serveFile(resolve(APP, "." + p)) || serveFile(resolve(ROOT, "public", "." + p)) || resolve(APP, "index.html");
  res.writeHead(200, { "content-type": TYPES[(f.match(/\.[a-z0-9]+$/i) || [""])[0]] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(5198, r));
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });

// opts.bepFirst — /bar/mine lists Bepanda first (staging's order); opts.drafts — saved carts seeded into the
// app's own draft store ({ "<loc>": [items] }), e.g. a cart saved BEFORE the per-line branch field existed;
// opts.at — the app-wide location at start (default Bonaberri); opts.noShift — locations with no open shift.
async function session(label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  await ctx.addInitScript(({ USER, ORG, BON, drafts, at, atName }) => {
    if (sessionStorage.getItem("__cart_init")) return; sessionStorage.setItem("__cart_init", "1");
    localStorage.clear();
    localStorage.setItem("mp-auth", JSON.stringify({ state: { user: USER, org: ORG, token: "probe-token", isAuthenticated: true, impersonating: false, impersonation: null, lastVerifiedActive: Date.now(), maxOfflineHours: 24 }, version: 0 }));
    localStorage.setItem("mp-lang", JSON.stringify({ state: { lang: "en" }, version: 0 }));
    localStorage.setItem("mp-settings", JSON.stringify({ state: { selectedLocation: { id: at || BON, name: atName || "Bonaberri", type: "shop" } }, version: 0 }));
    if (drafts) {   // AFTER the clear: the app's own draft store, exactly its persisted shape
      const d = {}; for (const [loc, items] of Object.entries(drafts)) d[`${USER.id}::${loc}`] = { items, updatedAt: Date.now() };
      localStorage.setItem("mp-pos-draft-cart", JSON.stringify({ state: { drafts: d }, version: 0 }));
    }
  }, { USER, ORG, BON, drafts: opts.drafts || null, at: opts.at || null, atName: opts.at ? NAME[opts.at] : null });
  const st = { delay: null, sales: [], holds: [], bepFirst: !!opts.bepFirst, noShift: new Set(opts.noShift || []), named: opts.named || null, payMode: opts.payMode || null,
    approval: opts.approval || null, payAnswer: opts.payAnswer || null };
  await ctx.route((u) => u.hostname !== "localhost", (route) => route.abort());
  await ctx.route((u) => u.hostname === "localhost" && u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace(/^\/api/, "");
    if (st.delay) await new Promise((r) => setTimeout(r, st.delay[0] + Math.random() * (st.delay[1] - st.delay[0])));
    let a, status = 200;
    if (req.method() === "GET") a = answer(p, u.searchParams, st) ?? ok([]);
    else if (p === "/shifts/open") { const b = req.postDataJSON() || {}; st.noShift.delete(b.location_id); st.opened = (st.opened || 0) + 1; a = ok({ id: `s-${b.location_id}`, location_id: b.location_id, status: "open" }); }
    else if (/^\/bar\/tabs\/[^/]+\/pay$/.test(p)) { const loc = (Object.entries(st.named || {}).find(([, ts]) => ts.some((t) => p.includes(t.id))) || [])[0];
      const tid = p.split("/")[3], mode = (st.payMode || {})[tid];
      if (mode) {   // P12: the server's side is decided here; the page must find out by reading the tab
        (st.pays = st.pays || []).push({ path: p, body: req.postDataJSON() });
        if (mode === "lost-paid") { (st.tabTrue = st.tabTrue || {})[tid] = "paid"; return route.abort("connectionreset"); }   // paid, answer lost
        if (mode === "lost-unpaid") return route.abort("connectionreset");                                                // nothing done, answer lost
        if (mode === "409-tab") { status = 409; (st.tabTrue = st.tabTrue || {})[tid] = "paid"; a = { success: false, code: "tab_not_payable", tab_status: "paid", message_en: "This tab is already paid.", message_fr: "Cette note est déjà payée." }; }
        if (mode === "409-ticket") { status = 409; (st.tabTrue = st.tabTrue || {})[tid] = "paid"; a = { success: false, code: "wrong_status", current_status: "paid", expected_status: "pending_payment", message_en: "This ticket is paid — it cannot be paid now.", message_fr: "Ce ticket est payé." }; }
      }
      else if (st.noShift.has(loc)) { status = 400; a = { success: false, code: "no_open_shift", message_en: "Open your till before taking payment.", message_fr: "Ouvrez votre caisse avant d'encaisser." }; }
      else if ((st.payAnswer || {})[tid]) { (st.pays = st.pays || []).push({ path: p, body: req.postDataJSON() }); [status, a] = st.payAnswer[tid]; }
      else { (st.pays = st.pays || []).push({ path: p, body: req.postDataJSON() }); a = ok({ id: `sale-${tid}`, sale_number: `T-${tid}`, total_amount: 1500, status: "paid" }); } }
    else if (/^\/bar\/tabs\/[^/]+\/close$/.test(p)) { (st.closes = st.closes || []).push(p); a = ok({}); }
    else if (p === "/sales/bundled-approval-request") { (st.asks = st.asks || []).push(req.postDataJSON()); status = 202; a = { success: true, pending_approval: true, approval_id: "ap1", status: "pending" }; }
    else if (p === "/sales" || p === "/sales/ticket") { const body = req.postDataJSON(); st.sales.push(body); a = ok({ id: `sale${st.sales.length}`, sale_number: `S-${st.sales.length}`, total_amount: 0, status: "completed" }); }
    else if (p === "/held-carts") { st.holds.push(req.postDataJSON()); a = ok({ id: "h1", hold_ref: "H-1" }); }
    else a = ok({});
    try { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(a) }); } catch { /* page moved on */ }
  });
  const page = await ctx.newPage(); lastPage = page;
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://localhost:5198/bar", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bar-box", { timeout: 60000 });
  console.log(`\n── ${label} ──`);
  return { ctx, page, st, errs };
}

// the branch on screen, once the grid shows ITS products and the POS has had time to restore
async function settle(page, loc, extra = 0) {
  const tag = loc === BON ? "Bon " : "Bep ";
  await page.waitForFunction((t) => { const b = document.querySelector(".bar-box"); return !!b && b.textContent.includes(t) && !!document.querySelector(".bar-cart"); }, tag, { timeout: 30000 });
  await page.waitForTimeout(450 + extra);
}
const cartNames = (page) => page.evaluate((names) => { const c = document.querySelector(".bar-cart"); if (!c) return null; const t = c.innerText;
  return names.filter((n) => t.includes(n)).sort(); }, ALL.map((p) => p.name));
const select = (page, loc) => page.selectOption(".bar-select", loc);
async function tap(page, names) { for (const n of names) { await page.locator(".bar-box", { hasText: n }).first().click(); await page.waitForTimeout(120); } }
const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...b].sort());

const CART = { [BON]: ["Bon Castel", "Bon Guinness", "Bon Coca"], [BEP]: ["Bep Booster", "Bep Red Bull"] };
const other = (l) => (l === BON ? BEP : BON);

try {
  // ── P1–P5: one device, carts at both branches ──
  {
    const { ctx, page, st, errs } = await session("P1 build at Bonaberri → switch to Bepanda");
    await settle(page, BON);
    check("P1a starts at Bonaberri with an empty cart", same(await cartNames(page), []), JSON.stringify(await cartNames(page)));
    await tap(page, CART[BON]);
    await page.waitForTimeout(400);
    check("P1b Bonaberri cart = its 3 lines", same(await cartNames(page), CART[BON]), JSON.stringify(await cartNames(page)));
    await select(page, BEP); await settle(page, BEP);
    let got = await cartNames(page);
    check("P1c switched to Bepanda → Bepanda's cart is EMPTY (no Bonaberri line)", same(got, []), JSON.stringify(got));
    await tap(page, CART[BEP]); await page.waitForTimeout(400);
    got = await cartNames(page);
    check("P1d Bepanda cart = its own 2 lines", same(got, CART[BEP]), JSON.stringify(got));
    await select(page, BON); await settle(page, BON);
    got = await cartNames(page);
    check("P1e back to Bonaberri → its 3 lines intact", same(got, CART[BON]), JSON.stringify(got));

    console.log("\n── P2 20 settled switches A↔B ──");
    let at = BON, bad = [];
    for (let i = 1; i <= 20; i++) { at = other(at); await select(page, at); await settle(page, at); got = await cartNames(page); if (!same(got, CART[at])) bad.push(`#${i} ${NAME[at]}: ${JSON.stringify(got)}`); }
    check(`P2 20 settled switches — right cart every time (${20 - bad.length}/20)`, !bad.length, bad.slice(0, 4).join(" | "));

    console.log("\n── P3 20 FAST switches (bursts of 4, 0–80 ms apart) ──");
    bad = [];
    for (let b = 1; b <= 5; b++) {
      for (let k = 0; k < 4; k++) { at = other(at); await select(page, at); await page.waitForTimeout(Math.floor(Math.random() * 80)); }
      await settle(page, at); got = await cartNames(page); if (!same(got, CART[at])) bad.push(`burst ${b} → ${NAME[at]}: ${JSON.stringify(got)}`);
    }
    // one odd burst so the run ends on the OTHER branch than it started
    for (let k = 0; k < 3; k++) { at = other(at); await select(page, at); await page.waitForTimeout(Math.floor(Math.random() * 60)); }
    await settle(page, at); got = await cartNames(page); if (!same(got, CART[at])) bad.push(`odd burst → ${NAME[at]}: ${JSON.stringify(got)}`);
    check(`P3 fast switches — right cart after every burst (${6 - bad.length}/6)`, !bad.length, bad.slice(0, 4).join(" | "));

    console.log("\n── P4 20 switches with a 300–900 ms delay on every /api answer ──");
    st.delay = [300, 900]; bad = [];
    for (let i = 1; i <= 20; i++) {
      at = other(at); await select(page, at);
      // look DURING the slow load too: whatever cart is on screen must never be the other branch's
      await page.waitForTimeout(150); const mid = await cartNames(page);
      if (mid && mid.some((n) => !CART[at].includes(n))) bad.push(`#${i} mid-load ${NAME[at]}: ${JSON.stringify(mid)}`);
      await settle(page, at, 900); got = await cartNames(page); if (!same(got, CART[at])) bad.push(`#${i} ${NAME[at]}: ${JSON.stringify(got)}`);
    }
    st.delay = null;
    check(`P4 delayed network — right cart every time, never the other branch's mid-load (${20 - new Set(bad.map((x) => x.split(" ")[0])).size}/20)`, !bad.length, bad.slice(0, 4).join(" | "));

    console.log("\n── P5 pay at Bepanda → back to Bonaberri ──");
    if (at !== BEP) { at = BEP; await select(page, BEP); await settle(page, BEP); }
    got = await cartNames(page);
    check("P5a at Bepanda before paying: Bepanda's lines only", same(got, CART[BEP]), JSON.stringify(got));
    const before = st.sales.length;
    await page.getByRole("button", { name: /^Take payment$/ }).click();
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 });
    for (let i = 0; i < 40 && st.sales.length === before; i++) await page.waitForTimeout(150);
    const sale = st.sales[before];
    const ids = (sale?.items || []).map((i) => i.product_id).filter(Boolean).sort();
    const want = PRODUCTS[BEP].filter((p) => CART[BEP].includes(p.name)).map((p) => p.id).sort();
    check("P5b one sale was sent", !!sale, `sales sent: ${st.sales.length - before}`);
    check(`P5c the sale holds ONLY Bepanda's lines (${ids.join(",")})`, !!sale && same(ids, want), JSON.stringify({ ids, want }));
    check("P5d the sale's location_id is Bepanda", sale?.location_id === BEP, String(sale?.location_id));
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape").catch(() => {});
    await select(page, BON); await settle(page, BON);
    got = await cartNames(page);
    check("P5e back to Bonaberri → its 3 lines still intact", same(got, CART[BON]), JSON.stringify(got));
    await select(page, BEP); await settle(page, BEP);
    got = await cartNames(page);
    check("P5f Bepanda after its sale → empty (the sale is not restored)", same(got, []), JSON.stringify(got));
    check("P1–P5 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  // ── P6: a device with no saved carts ──
  {
    const { ctx, page, errs } = await session("P6 no saved carts: 20 switches");
    await settle(page, BON);
    let at = BON; const bad = [];
    for (let i = 1; i <= 20; i++) { at = other(at); await select(page, at); if (i % 2) await settle(page, at); else await page.waitForTimeout(40); }
    await settle(page, at);
    for (let i = 1; i <= 6; i++) { at = other(at); await select(page, at); await settle(page, at); const got = await cartNames(page); if (!same(got, [])) bad.push(`${NAME[at]}: ${JSON.stringify(got)}`); }
    check("P6 empty carts stay empty at both branches", !bad.length, bad.slice(0, 3).join(" | "));
    check("P6 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  // ── P7–P10 (Peter 2026-11-19, tablet): Bepanda's lines in Bonaberri's Home cart after Cash → back ──
  const go = (page, path) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);   // in-app navigation, as the ☰ menu does
  const barValue = (page) => page.$eval(".bar-select", (s) => s.value).catch(() => null);
  const backToBar = async (page) => { await go(page, "/bar"); await page.waitForSelector(".bar-box", { timeout: 30000 }); await page.waitForTimeout(600); };
  const line = (p, loc) => ({ lineId: `L-${p.id}`, product_id: p.id, name: p.name, unit: "piece", quantity: 1, unit_price: p.sell_price, original_price: p.sell_price, sell_price: p.sell_price,
    min_price: 0, cost_price: 0, stock: 40, ...(loc ? { barLoc: loc } : {}) });
  const BEP_LINES = PRODUCTS[BEP].filter((p) => CART[BEP].includes(p.name));
  {
    // P7 — Peter's steps: Bepanda already holds a saved cart; /bar at Bonaberri (the app's branch, Bepanda
    // listed FIRST like staging) → build Bonaberri's cart → ☰ Cash (no shift at Bonaberri → open one) → back
    const { ctx, page, st, errs } = await session("P7 Bonaberri → Cash (open shift) → back to /bar", { bepFirst: true, noShift: [BON],
      drafts: { [BEP]: BEP_LINES.map((p) => line(p, BEP)), [`${BEP}::bar`]: BEP_LINES.map((p) => line(p, BEP)) } });   // the old key AND the bar's own key
    await page.waitForTimeout(800);
    check("P7a /bar opens on Bonaberri (the branch the app is on), not the first bar in the list", (await barValue(page)) === BON, String(NAME[await barValue(page)]));
    if ((await barValue(page)) !== BON) await select(page, BON);
    await settle(page, BON);
    check("P7b Bonaberri's Home cart starts EMPTY", same(await cartNames(page), []), JSON.stringify(await cartNames(page)));
    await tap(page, CART[BON]); await page.waitForTimeout(400);
    await go(page, "/shifts"); await page.waitForTimeout(1500);
    await page.evaluate(async (loc) => { await fetch("/api/shifts/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ location_id: loc, opening_float: 0 }) }); }, BON);
    await backToBar(page);
    check("P7c back from Cash: /bar reopens on Bonaberri (the LAST bar branch used)", (await barValue(page)) === BON, String(NAME[await barValue(page)]));
    if ((await barValue(page)) !== BON) await select(page, BON);
    await settle(page, BON);
    let got = await cartNames(page);
    check("P7d Bonaberri's Home cart = its own 3 lines, not one Bepanda line", same(got, CART[BON]), JSON.stringify(got));
    await select(page, BEP); await settle(page, BEP); got = await cartNames(page);
    check("P7e Bepanda = its own saved lines", same(got, CART[BEP]), JSON.stringify(got));
    await select(page, BON); await settle(page, BON); got = await cartNames(page);
    check("P7f back at Bonaberri = its 3 lines", same(got, CART[BON]), JSON.stringify(got));
    // P8 — to New Sale and back
    await go(page, "/pos"); await page.waitForTimeout(1800);
    await backToBar(page); const p8at = await barValue(page);
    if (p8at !== BON) await select(page, BON);
    await settle(page, BON); got = await cartNames(page);
    check("P8 to New Sale and back: /bar on Bonaberri with exactly its 3 lines", p8at === BON && same(got, CART[BON]), `${NAME[p8at]} ${JSON.stringify(got)}`);
    // P9 — reload while at Bepanda: the last branch used is Bepanda
    await select(page, BEP); await settle(page, BEP);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".bar-box", { timeout: 60000 }); await page.waitForTimeout(800);
    check("P9a reload: /bar reopens on Bepanda (the last branch used)", (await barValue(page)) === BEP, String(NAME[await barValue(page)]));
    if ((await barValue(page)) !== BEP) await select(page, BEP);
    await settle(page, BEP); got = await cartNames(page);
    check("P9b reload: Bepanda's lines only", same(got, CART[BEP]), JSON.stringify(got));
    await select(page, BON); await settle(page, BON); got = await cartNames(page);
    check("P9c reload: Bonaberri's 3 lines only", same(got, CART[BON]), JSON.stringify(got));
    check("P7–P9 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // P10 — a cart saved BEFORE the per-line branch field (or by New Sale, which never sets it) under
    // Bonaberri's key, holding Bepanda's lines: they must NOT show at Bonaberri, and nothing of them may be sold
    const OLD = [...BEP_LINES.map((p) => line(p, null)), line(PRODUCTS[BON][0], null)];
    const { ctx, page, st, errs } = await session("P10 pre-fix saved cart with Bepanda lines under Bonaberri", { drafts: { [BON]: OLD } });
    await settle(page, BON);
    let got = await cartNames(page);
    check("P10a Bonaberri's Home cart shows NO Bepanda line from the old saved cart", !got.some((n) => n.startsWith("Bep ")), JSON.stringify(got));
    await tap(page, [CART[BON][1]]); await page.waitForTimeout(400);
    const before = st.sales.length;
    await page.getByRole("button", { name: /^Take payment$/ }).click();
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 30 && st.sales.length === before; i++) await page.waitForTimeout(150);
    const sale = st.sales[before];
    const bepIds = PRODUCTS[BEP].map((p) => p.id);
    check("P10b paying at Bonaberri sends a sale with NO Bepanda product", !!sale && !(sale.items || []).some((i) => bepIds.includes(i.product_id)), JSON.stringify((sale?.items || []).map((i) => i.product_id)));
    check("P10c …and the sale is for Bonaberri", !!sale && sale.location_id === BON, String(sale?.location_id));
    check("P10 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // P10s — the state found on the tablet: Bepanda's lines under Bonaberri's key, ALREADY STAMPED as Bonaberri
    // (the old stamping effect did that on restore), plus the bar's own key holding lines with no / another branch
    const STAMPED = BEP_LINES.map((p) => line(p, BON));
    const BAD = [...BEP_LINES.map((p) => line(p, null)), ...BEP_LINES.map((p) => line(p, BEP))];
    const { ctx, page, errs } = await session("P10s stamped-as-Bonaberri Bepanda lines + bad lines under the bar key",
      { drafts: { [BON]: STAMPED, [`${BON}::bar`]: BAD } });
    await settle(page, BON);
    const got = await cartNames(page);
    check("P10s-a Bonaberri's Home cart shows NONE of them", same(got, []), JSON.stringify(got));
    const left = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem("mp-pos-draft-cart") || "{}").state?.drafts?.[k] || null; } catch { return "unreadable"; } }, `u1::${BON}`);
    check("P10s-b the old bar-written cart under the New Sale key is gone (store migration)", left === null, JSON.stringify(left).slice(0, 120));
    check("P10s no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // P11 — no shift at Bonaberri, a counter tab to pay: "Open a shift first" + Open shift BESIDE Take payment,
    // the shift opened in place (the POS shift modal), then Take payment goes through without leaving the tab
    const TAB = { id: "nt1", name: "Jo", status: "closed", location_id: BON, opened_at: new Date().toISOString(), pa_sales: { version: 3, total_amount: 1500 },
      figures: { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 } };
    const { ctx, page, st, errs } = await session("P11 pay a tab with no shift open → Open shift in place → pay", { noShift: [BON], named: { [BON]: [TAB] } });
    await settle(page, BON);
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
    const row = page.locator("div", { has: page.getByText("Jo", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
    await row.getByRole("button", { name: "Take payment" }).waitFor({ timeout: 15000 });
    const hint = row.locator(".bar-noshift");
    check("P11a beside Take payment: \"Open a shift first\"", (await hint.count()) === 1 && (await hint.innerText()).trim() === "Open a shift first", String(await hint.count()));
    check("P11b the old wording is gone from the screen", !(await page.evaluate(() => document.body.innerText.includes("Open your till"))));
    check("P11c Take payment is disabled until a shift is open", await row.getByRole("button", { name: "Take payment" }).isDisabled());
    await row.getByRole("button", { name: "Open shift", exact: true }).click();
    await page.locator("input[type=number]").last().fill("0");
    await page.getByRole("button", { name: "✓ Open shift" }).click();
    for (let i = 0; i < 40 && !st.opened; i++) await page.waitForTimeout(150);
    check("P11d the shift was opened in place, at Bonaberri", st.opened === 1 && !st.noShift.has(BON), `opened ${st.opened}`);
    await page.waitForFunction(() => !document.querySelector(".bar-noshift"), null, { timeout: 15000 }).catch(() => {});
    check("P11e the hint is gone and Take payment is enabled", (await page.locator(".bar-noshift").count()) === 0 && !(await row.getByRole("button", { name: "Take payment" }).isDisabled()));
    check("P11f still on /bar, the same tab", new URL(page.url()).pathname === "/bar" && (await row.count()) > 0);
    await row.getByRole("button", { name: "Take payment" }).click();
    // BAR BILL (2026-11-20): Take payment opens the POS payment panel on the tab's bill; Confirm pays the tab
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 });
    for (let i = 0; i < 40 && !(st.pays || []).length; i++) await page.waitForTimeout(150);
    const pb = (st.pays || [])[0]?.body || {};
    check("P11g Take payment went through the POS panel (POST /bar/tabs/nt1/pay with the POS terms + the served lines)",
      (st.pays || []).length === 1 && st.pays[0].path === "/bar/tabs/nt1/pay" && pb.pay_mode === "paid" && pb.version === 3
      && (pb.items || []).length === 1 && pb.items[0].product_id === "bon2" && Number(pb.paid_amount) === 1500, JSON.stringify(st.pays));
    check("P11 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // P12 — LOST RESPONSE on Take payment (Peter's tablet 2026-11-19: "No connection" while the server had paid).
    // Four counter tabs, each a different server outcome; the page must say what the SERVER did, and never re-send.
    const fig = { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 };
    const T = (id, name) => ({ id, name, status: "closed", location_id: BON, opened_at: new Date().toISOString(), pa_sales: { version: 3, total_amount: 1500 }, figures: fig });
    const TABS = [T("nt2", "Ann"), T("nt3", "Ben"), T("nt4", "Cyd"), T("nt5", "Dee")];
    const { ctx, page, st, errs } = await session("P12 Take payment: the answer is lost / refused as already paid → the tab's true state decides",
      { named: { [BON]: TABS }, payMode: { nt2: "lost-paid", nt3: "409-tab", nt4: "409-ticket", nt5: "lost-unpaid" } });
    // BAR BILL (2026-11-20): the pay now leaves from the POS panel (Take payment → bill → Confirm); the read-back
    // is the bill's own: GET /bar/tabs/:id AFTER the pay, then the sale for the receipt. Each tab from a fresh /bar.
    const payOne = async (id, name) => {
      await page.goto("http://localhost:5198/bar", { waitUntil: "domcontentloaded" }); await settle(page, BON);
      await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
      const row = page.locator("div", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
      await row.getByRole("button", { name: "Take payment" }).waitFor({ timeout: 15000 });
      const before = (st.pays || []).filter((x) => x.path.includes(`/${id}/`)).length;
      await row.getByRole("button", { name: "Take payment" }).click();
      await page.getByRole("button", { name: /✓ Confirm/ }).first().waitFor({ timeout: 15000 });
      const readsBefore = (st.tabReads || []).filter((x) => x === id).length;   // the bill's own load
      await page.getByRole("button", { name: /✓ Confirm/ }).first().click();
      for (let i = 0; i < 60 && (st.pays || []).filter((x) => x.path.includes(`/${id}/`)).length === before; i++) await page.waitForTimeout(150);
      for (let i = 0; i < 40 && (st.tabReads || []).filter((x) => x === id).length === readsBefore; i++) await page.waitForTimeout(150);
      await page.waitForTimeout(1200);
      const sent = (st.pays || []).filter((x) => x.path.includes(`/${id}/`)).length - before;
      const text = await page.evaluate(() => document.body.innerText);
      return { sent, text: text.replace(/\s+/g, " ").slice(0, 4000), read: (st.tabReads || []).filter((x) => x === id).length > readsBefore,
        receipt: (st.saleReads || []).includes(`sale-${id}`) };
    };
    let r = await payOne("nt2", "Ann");
    check("P12a paid but the answer LOST → \"Tab paid.\", never \"No connection\"", /Tab paid\./.test(r.text) && !/No connection/.test(r.text), r.text);
    check("P12a the pay was sent ONCE (no re-send), the tab READ back, the sale read for the receipt", r.sent === 1 && r.read && r.receipt, `sent ${r.sent} read ${r.read} receipt ${r.receipt}`);
    r = await payOne("nt3", "Ben");
    check("P12b refused 409 tab_status=paid → \"Tab paid.\"", /Tab paid\./.test(r.text) && !/already paid/.test(r.text), r.text);
    check("P12b sent once, read back", r.sent === 1 && r.read && r.receipt, `sent ${r.sent} read ${r.read}`);
    r = await payOne("nt4", "Cyd");
    check("P12c refused 409 current_status=paid (the ticket) → \"Tab paid.\"", /Tab paid\./.test(r.text), r.text);
    check("P12c sent once, read back", r.sent === 1 && r.read && r.receipt, `sent ${r.sent} read ${r.read}`);
    r = await payOne("nt5", "Dee");
    check("P12d answer lost and the tab is NOT paid → the POS network error (\"try again\"), never \"Tab paid.\"", /Network error|No connection/.test(r.text) && !/Tab paid/.test(r.text) && !r.receipt, r.text.slice(0, 300));
    check("P12d sent once (the page never re-sends by itself)", r.sent === 1, `sent ${r.sent}`);
    check("P12 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // P13 — THE BILL (Peter 2026-11-20): "Bill / Addition" (not "Close tab") opens the POS payment panel on the
    // tab's served lines, read-only; credit needs a customer (POS rule); a bill waiting for the boss shows only the
    // wait; "Send request to boss" on a bill is tied to the TAB (bar_tab_id) — no held cart, no new sale.
    const fig = { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 };
    const T = (id, name, status, extra = {}) => ({ id, name, status, location_id: BON, opened_at: new Date().toISOString(), pa_sales: { version: 3, total_amount: 1500 }, figures: fig, ...extra });
    const WAIT = { id: "ap9", status: "pending", requested_by: "u2", terms: { pay_mode: "credit" }, actions: [{ type: "credit" }] };
    const TABS = [T("nt6", "Kim", "open"), T("nt7", "Lou", "closed", { approval: WAIT }), T("nt8", "Max", "closed")];
    const { ctx, page, st, errs } = await session("P13 the bill: Bill button, read-only lines, POS rules, waiting for the boss, send to boss",
      { named: { [BON]: TABS }, approval: { nt7: WAIT },
        payAnswer: { nt8: [403, { success: false, code: "approval_required", actions: [{ type: "discount", effective_pct: 20, total_discount: 300 }], message_en: "This sale needs the boss's approval." }] } });
    await settle(page, BON);
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
    const rowOf = (name, btn) => page.locator("div", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: btn, exact: true }) }).last();
    const kim = rowOf("Kim", "Bill");
    await kim.getByRole("button", { name: "Bill", exact: true }).waitFor({ timeout: 15000 });
    check("P13a an open tab shows \"Bill\" — the old \"Close tab\" is gone", !(await page.evaluate(() => /Close tab/.test(document.body.innerText))));
    await kim.getByRole("button", { name: "Bill", exact: true }).click();
    await page.getByRole("button", { name: /✓ Confirm/ }).first().waitFor({ timeout: 15000 });
    check("P13a Bill stops the rounds (POST …/nt6/close) and opens the bill in the POS payment panel", (st.closes || []).includes("/bar/tabs/nt6/close")
      && (await page.evaluate(() => /Bill — Kim/.test(document.body.innerText))), JSON.stringify(st.closes));
    const ro = await page.evaluate(() => { const c = document.querySelector(".bar-cart") || document.body; const t = c.innerText;
      const btns = [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
      return { line: !!c.querySelector(".bill-line") && /1 × /.test(t), qtyInputs: c.querySelectorAll(".bill-line input").length + [...c.querySelectorAll("input[type=number]")].filter((i) => i.closest(".bill-line")).length,
        clear: /Clear all/.test(t), hold: btns.some((b) => /^⏸/.test(b)), x: btns.filter((b) => b === "✕" || b === "−" || b === "+").length, addDisc: /Add discount/.test(t) }; });
    check("P13b the bill's lines are read-only: no ✕ / − / + / qty / line discount, no Clear all, no Hold", ro.line && !ro.qtyInputs && !ro.clear && !ro.hold && !ro.x && !ro.addDisc, JSON.stringify(ro));
    // full credit with no customer: the POS refuses before anything is sent
    const paysBefore = (st.pays || []).length;
    await page.getByRole("button", { name: /Full Credit|Crédit total/ }).first().click().catch(() => {});
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    check("P13c Full Credit with no customer → refused by the panel, nothing sent", (st.pays || []).length === paysBefore, JSON.stringify((st.pays || []).slice(paysBefore)));
    await page.getByRole("button", { name: /← Back/ }).first().click();
    await page.waitForTimeout(600);
    check("P13c Back returns to the floor", !(await page.evaluate(() => /Bill — Kim/.test(document.body.innerText))));
    // a bill waiting for the boss: no Take payment on the row; the bill shows only the wait
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click().catch(() => {});
    const lou = rowOf("Lou", "View");
    await lou.getByRole("button", { name: "View", exact: true }).waitFor({ timeout: 15000 });
    check("P13d the row says \"Waiting for approval\", no Take payment", /Waiting for approval/.test(await lou.innerText()) && !(await lou.getByRole("button", { name: "Take payment" }).count()));
    await lou.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Cancel request" }).waitFor({ timeout: 15000 });
    check("P13d the bill shows the wait + Cancel request, and NO Confirm", (await page.getByRole("button", { name: /✓ Confirm/ }).count()) === 0);
    await page.getByRole("button", { name: /Back to the floor/ }).first().click();
    // Send request to boss on a bill
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click().catch(() => {});
    const max = rowOf("Max", "Take payment");
    await max.getByRole("button", { name: "Take payment" }).click({ timeout: 15000 });
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 });
    await page.getByRole("button", { name: /Send request to boss/ }).click({ timeout: 15000 });
    for (let i = 0; i < 40 && !(st.asks || []).length; i++) await page.waitForTimeout(150);
    await page.waitForTimeout(800);
    const ask = (st.asks || [])[0] || {};
    check("P13e Send request to boss → ONE request tied to the tab (bar_tab_id nt8, the served lines)", (st.asks || []).length === 1 && ask.bar_tab_id === "nt8"
      && (ask.items || []).length === 1 && ask.items[0].product_id === "bon2" && ask.location_id === BON, JSON.stringify(st.asks));
    check("P13e nothing parked as a held cart, no sale created", !st.holds.length && !st.sales.length, JSON.stringify({ holds: st.holds.length, sales: st.sales.length }));
    check("P13e back on the floor, told the tab waits for the boss", /waits for his answer/.test(await page.evaluate(() => document.body.innerText)) && !(await page.evaluate(() => /Bill — Max/.test(document.body.innerText))));
    check("P13 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
} catch (e) {
  fails++; console.log(`  FAIL  probe stopped: ${e.message.split("\n")[0]}`);
  if (process.env.BAR_CART_SHOT && lastPage) await lastPage.screenshot({ path: process.env.BAR_CART_SHOT }).catch(() => {});
} finally {
  await browser.close(); server.close();
}
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed, ${passes} passed` : `PASS — ${passes}/${passes}: each branch keeps its own Home cart`}${TEETH ? `  (TEETH ${TEETH}: ${fails ? "red as required" : "STILL GREEN — the probe has no teeth!"})` : ""}\n`);
process.exit(TEETH ? (fails ? 0 : 1) : (fails ? 1 : 0));
