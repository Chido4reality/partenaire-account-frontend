// BAR CART FIX — probe (Peter 2026-11-18, tablet test): the Home cart must be kept per branch.
// Found on staging: Bepanda's cart stayed on screen after switching to Bonaberri (intermittent).
// LOCAL ONLY, like shots.mjs: the real app bundle in headless Chromium, EVERY /api call answered here from
// fixtures, every request off the app host aborted (BAR_CART_URL = a deployed bundle) — nothing reaches staging or prod, no login, no writes.
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
//   P12 the bill's answer LOST → New Sale's queue, one local_id; refused 409 "already paid" → said + reload; offline → nothing sent
//   P13 the bill (read-only lines, POS rules, waiting for the boss, send to boss)   P14 empty tab: no sale   P15 shift > 24 h warning
// 2026-11-25 JOB 3 PHASE 0: P16 a paid bill → "✓ Paid — <number>" + Next table + optional Receipt; nothing prints/opens by itself.
// Teeth 12 (receipt auto-opens again) → P16b red; teeth 13 (the receipt prints on open) → P16e red.
// Teeth 3 (fix 2 removed) → red on P7/P9/P10/P10s; teeth 4 (in-place shift removed) → red on P11;
// teeth 5 (bill posted without bar_tab_id) → P11g; teeth 6 (bill cart not locked) → P13b; teeth 8 (offline guard) → P12c;
// teeth 7 (send to boss parks a held cart) → P13e; teeth 9 (empty bill) → P14; teeth 10 (no warning) → P15; teeth 11 → P12a.
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
  // st.proPlus: the plan answer (Layout asks /bar/mine only on pro_plus) — P15 reloads straight onto the Cash screen
  if (path === "/subscriptions/my-plan" && st.proPlus) return ok({ effective_plan: "pro_plus" });
  // st.bepFirst: Bepanda listed first, as staging's /bar/mine does (no ORDER BY) — the "jumped to Bepanda" case
  if (path === "/bar/mine") return ok({ bars: st.bepFirst ? [{ id: BEP, name: "Bepanda" }, { id: BON, name: "Bonaberri" }] : [{ id: BON, name: "Bonaberri" }, { id: BEP, name: "Bepanda" }], can_setup: true, can_serve: true });
  if (path === "/shifts/current" && st.noShift && st.noShift.has(q.get("location_id"))) return ok(null);
  // GET /bar/tabs/:id = the BILL: served lines + the boss's answer (st.approval). Since 2026-11-23 a tab holds
  // NO sale until its bill is paid through POST /sales (Bar Mode = layout only).
  // st.tableTab (P17): table T1 holds an OPEN tab "tt1" with one round waiting at the bar
  if (st.tableTab && path === "/bar/tabs/tt1") return ok({ id: "tt1", name: null, status: "open", location_id: BON, table_id: "t1", sale_id: null, pa_sales: null,
    pa_bar_tables: { label: "T1" }, bill_lines: [], approval: null,
    figures: { ordered: 1500, served: 0, waiting: 1500, paid: 0, balance_due: 0, service_status: "waiting", payment_status: "unpaid", rounds_waiting: 1, rounds_served: 0 },
    rounds: [{ id: "r1", round_no: 1, status: "sent", version: 1, total: 1500, pa_bar_round_items: [{ product_id: "bon2", quantity: 1, unit_price: 1500, pa_products: { name: "Bon Guinness" } }] }] });
  const tb = path.match(/^\/bar\/tabs\/([^/]+)$/); if (tb) { (st.tabReads = st.tabReads || []).push(tb[1]);
    const named = Object.values(st.named || {}).flat().find((t) => t.id === tb[1]) || {};
    return ok({ id: tb[1], name: named.name || null, status: (st.tabTrue || {})[tb[1]] || "closed", location_id: BON, sale_id: null, pa_sales: null,
      bill_lines: (st.emptyTabs || []).includes(tb[1]) ? [] : [{ product_id: "bon2", quantity: 1, unit_price: 1500, name: "Bon Guinness", price_tier: "walk_in" }],
      approval: (st.approval || {})[tb[1]] || null }); }
  const sl = path.match(/^\/sales\/(sale-[^/]+)$/); if (sl) { (st.saleReads = st.saleReads || []).push(sl[1]); return ok({ id: sl[1], sale_number: `T-${sl[1]}`, total_amount: 1500, status: "paid" }); }
  if (path === "/locations") return ok(LOCS);
  if (/^\/bar\/[^/]+\/floor$/.test(path)) return ok({ zones: [{ id: "z1", name: "Salle" }],
    tables: st.tableTab ? TABLES.map((t) => t.id === "t1" ? { ...t, tab: { id: "tt1", status: "open", location_id: BON, opened_at: new Date().toISOString(),
      figures: { ordered: 1500, served: 0, waiting: 1500, paid: 0, balance_due: 0, service_status: "waiting", payment_status: "unpaid", rounds_waiting: 1, rounds_served: 0 } } } : t) : TABLES,
    named_tabs: (st.named && st.named[path.split("/")[2]]) || [] });
  const qi = path.match(/^\/bar\/([^/]+)\/quick-items$/); if (qi) return ok({ ids: (PRODUCTS[qi[1]] || []).map((p) => p.id) });
  if (path === "/products") return ok(PRODUCTS[q.get("location_id")] || []);
  if (path === "/products/multipart-availability") return ok({});
  if (path === "/held-carts") return ok([]);
  if (path === "/sales/tickets/summary") return ok({ mode: "direct", open_count: 0 });   // a direct till: Confirm completes the sale
  if (path === "/shifts/current") return ok({ shift_id: `s-${q.get("location_id")}`, location_id: q.get("location_id"), opened_at: (st.oldShift && st.oldShift.has(q.get("location_id"))) ? "2026-11-19T18:00:00.000Z" : new Date().toISOString(), status: "open" });
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
// BAR_CART_URL=https://<deployed staging> → test the DEPLOYED bundle instead of a local one (no local build). The
// app host serves the page; EVERY /api/* call (whatever host the bundle points at) is still answered by the mocks
// below and every other host is aborted — nothing reaches the staging server, no login, no writes.
const BASE = (process.env.BAR_CART_URL || "").replace(/\/+$/, "") || "http://localhost:5198";
const APP_HOST = new URL(BASE).hostname;
if (!process.env.BAR_CART_URL) await new Promise((r) => server.listen(5198, r));
else console.log(`target: DEPLOYED bundle at ${BASE}`);
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
    approval: opts.approval || null, payAnswer: opts.payAnswer || null, oldShift: new Set(opts.oldShift || []), emptyTabs: opts.emptyTabs || [], proPlus: !!opts.proPlus,
    tableTab: !!opts.tableTab, slowWrites: opts.slowWrites || 0 };
  await ctx.route((u) => u.hostname !== APP_HOST && !u.pathname.startsWith("/api/"), (route) => route.abort());
  await ctx.route((u) => u.pathname.startsWith("/api/"), async (route) => { try {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace(/^\/api/, ""); if (process.env.BAR_CART_DEBUG && req.method() !== "GET") console.log("  REQ", req.method(), p, JSON.stringify(req.postDataJSON() || {}).slice(0, 160));
    if (st.delay) await new Promise((r) => setTimeout(r, st.delay[0] + Math.random() * (st.delay[1] - st.delay[0])));
    // P17: every write is recorded and answered slowly (st.slowWrites ms) — a slow server, as on the tablet
    if (req.method() !== "GET" && st.slowWrites) { (st.writes = st.writes || []).push(p); await new Promise((r) => setTimeout(r, st.slowWrites)); }
    let a, status = 200;
    if (req.method() === "GET") a = answer(p, u.searchParams, st) ?? ok([]);
    else if (p === "/shifts/open") { const b = req.postDataJSON() || {}; st.noShift.delete(b.location_id); st.opened = (st.opened || 0) + 1; a = ok({ id: `s-${b.location_id}`, location_id: b.location_id, status: "open" }); }
    // THE BILL (2026-11-23): paid by New Sale's own POST /sales with bar_tab_id. st.pays = those posts.
    else if (p === "/sales" && (req.postDataJSON() || {}).bar_tab_id) { const body = req.postDataJSON(); const tid = body.bar_tab_id;
      const loc = (Object.entries(st.named || {}).find(([, ts]) => ts.some((t) => t.id === tid)) || [])[0];
      const mode = (st.payMode || {})[tid];
      (st.pays = st.pays || []).push({ path: p, body });
      const first = st.pays.find((x) => x.body.bar_tab_id === tid);
      if (mode === "lost-paid" && first === st.pays[st.pays.length - 1]) { (st.tabTrue = st.tabTrue || {})[tid] = "paid"; return route.abort("connectionreset"); }   // paid, answer lost
      if (mode === "lost-paid") {   // the queue's replay: the SAME local_id → the server's dedupe replays the sale; another → refused
        if (body.local_id && body.local_id === first.body.local_id) a = ok({ id: `sale-${tid}`, sale_number: `S-${tid}`, total_amount: 1500, status: "completed" });
        else { status = 409; a = { success: false, code: "tab_not_payable", tab_status: "paid", message_en: "This tab is already paid.", message_fr: "Cette note est déjà payée." }; }
      }
      else if (mode === "409-tab") { status = 409; (st.tabTrue = st.tabTrue || {})[tid] = "paid"; a = { success: false, code: "tab_not_payable", tab_status: "paid", message_en: "This tab is already paid.", message_fr: "Cette note est déjà payée." }; }
      else if (st.noShift.has(loc)) { status = 400; a = { success: false, code: "no_open_shift", message_en: "Open your till before taking payment.", message_fr: "Ouvrez votre caisse avant d'encaisser." }; }
      else if ((st.payAnswer || {})[tid]) [status, a] = st.payAnswer[tid];
      else a = ok({ id: `sale-${tid}`, sale_number: `S-${tid}`, total_amount: 1500, status: "completed" }); }
    // the old tab pay: only an EMPTY tab (nothing served → no sale) still goes here
    else if (/^\/bar\/tabs\/[^/]+\/pay$/.test(p)) { (st.oldPays = st.oldPays || []).push({ path: p, body: req.postDataJSON() }); a = ok({ id: p.split("/")[3], status: "paid", sale_id: null }); }
    else if (/^\/bar\/tabs\/[^/]+\/close$/.test(p)) { (st.closes = st.closes || []).push(p); a = ok({}); }
    else if (p === "/sales/bundled-approval-request") { (st.asks = st.asks || []).push(req.postDataJSON()); status = 202; a = { success: true, pending_approval: true, approval_id: "ap1", status: "pending" }; }
    else if (p === "/sales" || p === "/sales/ticket") { const body = req.postDataJSON(); st.sales.push(body); a = ok({ id: `sale${st.sales.length}`, sale_number: `S-${st.sales.length}`, total_amount: 0, status: "completed" }); }
    else if (p === "/held-carts") { st.holds.push(req.postDataJSON()); a = ok({ id: "h1", hold_ref: "H-1" }); }
    else a = ok({});
    try { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(a) }); } catch { /* page moved on */ }
  } catch (e) { console.log("  MOCK ERROR", route.request().method(), route.request().url(), e.message); throw e; } });
  const page = await ctx.newPage(); lastPage = page;
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/bar`, { waitUntil: "domcontentloaded" });
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

// BAR_CART_ONLY=P1,P6,… → run only those case groups (one browser per run, to stay above the memory floor)
const ONLY = (process.env.BAR_CART_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
try {
  // ── P1–P5: one device, carts at both branches ──
  if (want("P1")) {
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
  if (want("P6")) {
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
  if (want("P7")) {
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
  if (want("P10")) {
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
  if (want("P10s")) {
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
  if (want("P11")) {
    // P11 — no shift at Bonaberri, a counter tab to pay: "Open a shift first" + Open shift BESIDE Take payment,
    // the shift opened in place (the POS shift modal), then Take payment goes through without leaving the tab
    const TAB = { id: "nt1", name: "Jo", status: "closed", location_id: BON, opened_at: new Date().toISOString(),
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
    // Take payment opens the POS payment panel on the tab's bill; Confirm = New Sale's own POST /sales + bar_tab_id
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 });
    for (let i = 0; i < 40 && !(st.pays || []).length; i++) await page.waitForTimeout(150);
    const pb = (st.pays || [])[0]?.body || {};
    check("P11g Take payment = New Sale's POST /sales (bar_tab_id nt1, the served lines, location Bonaberri, a local_id)",
      (st.pays || []).length === 1 && st.pays[0].path === "/sales" && pb.bar_tab_id === "nt1" && pb.location_id === BON && !!pb.local_id
      && (pb.items || []).length === 1 && pb.items[0].product_id === "bon2" && Number(pb.paid_amount) === 1500, JSON.stringify(st.pays));
    check("P11h the old bar pay route was NOT used for a bill with lines", !(st.oldPays || []).length, JSON.stringify(st.oldPays));
    check("P11 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  if (want("P12")) {
    // P12 — LOST RESPONSE on the bill's Confirm (Peter's tablet 2026-11-19: "No connection" while the server had paid).
    // Since 2026-11-23 the bill IS a New Sale, so a lost answer is New Sale's: the request is queued with its
    // local_id and every re-send carries the SAME local_id (the server's dedupe replays the one sale — never two).
    const fig = { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 };
    const T = (id, name) => ({ id, name, status: "closed", location_id: BON, opened_at: new Date().toISOString(), figures: fig });
    const TABS = [T("nt2", "Ann"), T("nt3", "Ben"), T("nt4", "Cyd")];
    const { ctx, page, st, errs } = await session("P12 the bill's answer is lost / refused as already paid / offline",
      { named: { [BON]: TABS }, payMode: { nt2: "lost-paid", nt3: "409-tab" } });
    const openBill = async (name) => {
      await page.goto(`${BASE}/bar`, { waitUntil: "domcontentloaded" }); await settle(page, BON);
      await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
      const row = page.locator("div", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
      await row.getByRole("button", { name: "Take payment" }).click({ timeout: 15000 });
      await page.getByRole("button", { name: /✓ Confirm/ }).first().waitFor({ timeout: 15000 });
    };
    const sends = (id) => (st.pays || []).filter((x) => x.body.bar_tab_id === id);
    // a — paid on the server, the answer lost
    await openBill("Ann");
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click();
    for (let i = 0; i < 60 && !sends("nt2").length; i++) await page.waitForTimeout(150);
    await page.waitForTimeout(2500);
    let text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    check("P12a answer lost → New Sale's queue: said as saved (never \"Tab paid.\" and never a second sale)", /Saved — the connection dropped/.test(text) && !/Tab paid\./.test(text), text.slice(0, 300));
    const ids = [...new Set(sends("nt2").map((x) => x.body.local_id))];
    check("P12a every send of this bill carries ONE local_id (the server's dedupe collapses a re-send)", ids.length === 1 && !!ids[0], JSON.stringify(sends("nt2").map((x) => x.body.local_id)));
    // b — someone else paid it: the server refuses → said in its words, the bill reloads, nothing re-sent
    await openBill("Ben");
    const readsB = (st.tabReads || []).filter((x) => x === "nt3").length;
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click();
    for (let i = 0; i < 60 && !sends("nt3").length; i++) await page.waitForTimeout(150);
    await page.waitForTimeout(1500);
    text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    check("P12b refused 409 tab_not_payable → \"This tab is already paid.\", the bill reloads", /This tab is already paid\./.test(text) && (st.tabReads || []).filter((x) => x === "nt3").length > readsB, text.slice(0, 300));
    check("P12b sent once (never re-sent by the page)", sends("nt3").length === 1, String(sends("nt3").length));
    // c — offline at Confirm: a tab is a shared object, its bill is never started offline (spec decision 12)
    await openBill("Cyd");
    await ctx.setOffline(true);
    await page.getByRole("button", { name: /✓ Confirm/ }).first().click();
    await page.waitForTimeout(1200);
    text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    await ctx.setOffline(false);
    check("P12c offline → \"Tabs need a connection. Nothing was saved\", nothing sent", /Tabs need a connection/.test(text) && !sends("nt4").length, text.slice(0, 300));
    check("P12 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  if (want("P13")) {
    // P13 — THE BILL (Peter 2026-11-20): "Bill / Addition" (not "Close tab") opens the POS payment panel on the
    // tab's served lines, read-only; credit needs a customer (POS rule); a bill waiting for the boss shows only the
    // wait; "Send request to boss" on a bill is tied to the TAB (bar_tab_id) — no held cart, no new sale.
    const fig = { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 };
    const T = (id, name, status, extra = {}) => ({ id, name, status, location_id: BON, opened_at: new Date().toISOString(), figures: fig, ...extra });
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
  if (want("P14")) {
    // P14 — a closed tab with NOTHING served: no sale is made. The bill says so and closes the tab off empty
    // (the only use left of POST /bar/tabs/:id/pay); the POS panel never mounts, nothing goes to POST /sales.
    const fig = { ordered: 0, served: 0, waiting: 0, paid: 0, balance_due: 0, service_status: "none", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 0 };
    const { ctx, page, st, errs } = await session("P14 an empty tab: no sale, closed off empty",
      { named: { [BON]: [{ id: "nt9", name: "Zoe", status: "closed", location_id: BON, opened_at: new Date().toISOString(), figures: fig }] }, emptyTabs: ["nt9"] });
    await settle(page, BON);
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
    const row = page.locator("div", { has: page.getByText("Zoe", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
    await row.getByRole("button", { name: "Take payment" }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "Close the empty tab" }).waitFor({ timeout: 15000 });
    check("P14a the empty bill says there is nothing to pay, and shows NO Confirm", /Nothing was served on this tab/.test(await page.evaluate(() => document.body.innerText))
      && (await page.getByRole("button", { name: /✓ Confirm/ }).count()) === 0);
    await page.getByRole("button", { name: "Close the empty tab" }).click();
    for (let i = 0; i < 40 && !(st.oldPays || []).length; i++) await page.waitForTimeout(150);
    check("P14b closed off through /bar/tabs/nt9/pay with no terms; nothing sent to POST /sales", (st.oldPays || []).length === 1 && st.oldPays[0].path === "/bar/tabs/nt9/pay"
      && !Object.keys(st.oldPays[0].body || {}).length && !(st.pays || []).length && !st.sales.length, JSON.stringify({ old: st.oldPays, pays: (st.pays || []).length }));
    check("P14 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  if (want("P15")) {
    // P15 — SHIFT OPEN > 24 h (Peter 2026-11-21): a warning on the bar floor and the Cash screen, nothing blocked.
    // Bonaberri's shift opened 19 Nov; Bepanda's just now (no warning).
    const { ctx, page, st, errs } = await session("P15 shift open more than 24 h → warning on the floor + Cash", { oldShift: [BON], proPlus: true });
    await settle(page, BON);
    const warn = page.locator(".shift-age-warning");
    await warn.first().waitFor({ timeout: 15000 }).catch(() => {});
    check("P15a bar floor: \"Shift open since 19 Nov — close it\"", (await warn.count()) === 1 && /Shift open since 19 Nov — close it/.test(await warn.first().innerText()), (await warn.count()) ? await warn.first().innerText() : "none");
    check("P15b warning only: the POS cart + its Confirm path are still there", (await page.locator(".bar-cart").count()) > 0);
    await page.goto(`${BASE}/shifts`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Cash register/).first().waitFor({ timeout: 30000 });
    await warn.first().waitFor({ timeout: 15000 }).catch(() => {});
    if (process.env.BAR_CART_SHOT && !(await warn.count())) await page.screenshot({ path: process.env.BAR_CART_SHOT.replace(/.png$/, "-p15c.png") });
    check("P15c Cash screen at Bonaberri: the same warning", (await warn.count()) === 1 && /Shift open since 19 Nov — close it/.test(await warn.first().innerText()), String(await warn.count()));
    await page.goto(`${BASE}/bar`, { waitUntil: "domcontentloaded" }); await settle(page, BON);
    await page.locator("select.bar-select").selectOption(BEP); await settle(page, BEP);
    await page.waitForTimeout(800);
    check("P15d Bepanda (shift opened today): no warning", (await warn.count()) === 0, String(await warn.count()));
    check("P15 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  if (want("P16")) {
    // P16 — JOB 3 PHASE 0 (Peter 2026-11-25): NO PRINTING IN THE SERVICE FLOW. A paid bill shows "✓ Paid — <number>"
    // with Next table + an optional Receipt; nothing prints, shares, opens a window or logs a print by itself.
    const mk = (id, name) => ({ id, name, status: "closed", location_id: BON, opened_at: new Date().toISOString(),
      figures: { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 } });
    const { ctx, page, st, errs } = await session("P16 a paid bill → Paid card, nothing printed or opened by itself", { named: { [BON]: [mk("nt6", "Ama"), mk("nt7", "Bea")] } });
    const printLogs = []; page.on("request", (r) => { if (/bill-printed/.test(r.url())) printLogs.push(r.url()); });
    await settle(page, BON);
    await page.evaluate(() => { window.__out = []; window.print = () => window.__out.push("print"); window.open = (u) => { window.__out.push("open " + u); return null; };
      if (navigator.share) navigator.share = () => { window.__out.push("share"); return Promise.resolve(); }; });
    const receiptOpen = () => page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /(Share|Send) via WhatsApp|(Partager|Envoyer) par WhatsApp/.test(b.textContent)));
    const payTab = async (name) => {
      await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
      const row = page.locator("div", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
      await row.getByRole("button", { name: "Take payment" }).click({ timeout: 15000 });
      const n = (st.pays || []).length;
      await page.getByRole("button", { name: /✓ Confirm/ }).first().click({ timeout: 15000 });
      for (let i = 0; i < 40 && (st.pays || []).length === n; i++) await page.waitForTimeout(150);
      await page.locator(".bar-paid-card").waitFor({ timeout: 15000 }).catch(() => {});   // missing → P16a/b say so
      await page.waitForTimeout(1200);   // anything automatic would have fired by now
    };
    await payTab("Ama");
    const t1 = ((await page.locator(".bar-paid-card").count()) ? await page.locator(".bar-paid-card").innerText() : "(no Paid card)").replace(/\s+/g, " ");
    check("P16a paid → \"✓ Paid — S-nt6\" with the total and Next table", /✓ Paid — S-nt6/.test(t1) && /Total : 1[\s  ,.]?500/.test(t1) && /Next table →/.test(t1), t1);
    check("P16b no receipt window opened by itself", !(await receiptOpen()));
    let out = await page.evaluate(() => window.__out);
    check("P16c nothing printed, shared or opened, no print logged", out.length === 0 && printLogs.length === 0, JSON.stringify({ out, printLogs }));
    await page.locator(".bar-paid-receipt").click();
    await page.waitForTimeout(600);
    check("P16d Receipt (optional tap) → the receipt with print / WhatsApp", await receiptOpen());
    out = await page.evaluate(() => window.__out);
    check("P16e …still nothing printed until a print button is tapped", out.length === 0 && printLogs.length === 0, JSON.stringify({ out, printLogs }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    check("P16f closing the receipt → back on the floor (no Paid card, no payment panel)", (await page.locator(".bar-paid-card").count()) === 0 && !(await receiptOpen())
      && (await page.getByRole("button", { name: /✓ Confirm/ }).count()) === 0 && new URL(page.url()).pathname === "/bar");
    await payTab("Bea");
    await page.locator(".bar-paid-next").click();
    await page.waitForTimeout(600);
    out = await page.evaluate(() => window.__out);
    check("P16g Next table → straight back to the floor; nothing printed or opened", (await page.locator(".bar-paid-card").count()) === 0 && !(await receiptOpen())
      && (await page.getByRole("button", { name: /✓ Confirm/ }).count()) === 0 && out.length === 0 && printLogs.length === 0, JSON.stringify({ out, printLogs }));
    check("P16h two bills → two POST /sales, nothing else", (st.pays || []).filter((x) => /^nt[67]$/.test(x.body.bar_tab_id)).length === 2, JSON.stringify((st.pays || []).map((x) => x.body.bar_tab_id)));
    check("P16 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }

  if (want("P17")) {
    // P17 — INSTANT TAP (Peter 2026-11-28): every pay / send / serve button reacts ON THE TAP — disabled and
    // "⏳ Saving…" at once — and a double tap sends ONE request. Each write is answered after 1.5 s (a slow server).
    // The double tap = two clicks in the SAME instant (one script, no wait between), the case a frame-late lock misses.
    const SLOW = 1500;
    const mkNamed = (id, name) => ({ id, name, status: "closed", location_id: BON, opened_at: new Date().toISOString(),
      figures: { ordered: 1500, served: 1500, waiting: 0, paid: 0, balance_due: 1500, service_status: "served", payment_status: "unpaid", rounds_waiting: 0, rounds_served: 1 } });
    const { ctx, page, st, errs } = await session("P17 instant tap: pay / send round / serve / Bill — locked on the tap, one request",
      { named: { [BON]: [mkNamed("nt9", "Cid")] }, tableTab: true, slowWrites: SLOW });
    await settle(page, BON);
    // double-tap the button whose text matches `re`, then read the SAME button 100 ms later
    const doubleTap = async (re) => {
      const found = await page.evaluate((src) => {
        const r = new RegExp(src);
        const b = [...document.querySelectorAll("button")].filter((x) => r.test(x.textContent) && !x.disabled && x.offsetParent !== null).pop();
        if (!b) return false;
        window.__tapped = b; b.click(); b.click(); return true;
      }, re.source);
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => { const b = window.__tapped; return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; });
      return { found, after };
    };
    const writesTo = (re) => (st.writes || []).filter((p) => re.test(p)).length;
    const saving = (a) => !!a && a.disabled && /⏳ Saving…/.test(a.text);
    const waitWrites = async () => { await page.waitForTimeout(SLOW + 900); };

    // a) New Sale's pay (Home cart → Take payment → ✓ Confirm)
    await tap(page, ["Bon Castel"]);
    await page.getByRole("button", { name: /^Take payment$/ }).click();
    await page.getByRole("button", { name: /✓ Confirm/ }).first().waitFor({ timeout: 15000 });
    let r = await doubleTap(/✓ Confirm/);
    check("P17a New Sale ✓ Confirm: \"⏳ Saving…\" and disabled 100 ms after the tap", r.found && saving(r.after), JSON.stringify(r));
    await waitWrites();
    check("P17b …a double tap sent ONE sale", st.sales.length === 1, `POST /sales: ${st.sales.length}`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);

    // b) the bar bill's pay (Counter tabs → Take payment → ✓ Confirm)
    await page.getByRole("button", { name: /Counter tabs|Tabs/ }).first().click();
    const row = page.locator("div", { has: page.getByText("Cid", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Take payment" }) }).last();
    await row.getByRole("button", { name: "Take payment" }).click({ timeout: 15000 });
    await page.getByRole("button", { name: /✓ Confirm/ }).first().waitFor({ timeout: 15000 });
    r = await doubleTap(/✓ Confirm/);
    check("P17c bar bill ✓ Confirm: \"⏳ Saving…\" and disabled 100 ms after the tap", r.found && saving(r.after), JSON.stringify(r));
    await waitWrites();
    check("P17d …a double tap paid the bill ONCE", (st.pays || []).filter((x) => x.body.bar_tab_id === "nt9").length === 1, `POST /sales (bar): ${(st.pays || []).length}`);
    const next = page.getByRole("button", { name: /Next table/ });
    if (await next.count()) await next.first().click(); else await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);

    // c) a table: Serve the waiting round, Send a new round, Bill
    await page.locator(".bar-pill", { hasText: "T1" }).first().click();
    await page.getByRole("button", { name: /^Serve$/ }).first().waitFor({ timeout: 15000 });
    r = await doubleTap(/^Serve$/);
    check("P17e Serve: \"⏳ Saving…\" and disabled 100 ms after the tap", r.found && saving(r.after), JSON.stringify(r));
    await waitWrites();
    check("P17f …a double tap served ONCE", writesTo(/^\/bar\/rounds\/r1\/serve$/) === 1, JSON.stringify(st.writes));
    await page.locator(".bar-box", { hasText: "Bon Coca" }).first().click();
    await page.getByRole("button", { name: /^Send round/ }).first().waitFor({ timeout: 15000 });
    r = await doubleTap(/^Send round/);
    check("P17g Send round: \"⏳ Saving…\" and disabled 100 ms after the tap", r.found && saving(r.after), JSON.stringify(r));
    await waitWrites();
    check("P17h …a double tap sent ONE round", writesTo(/^\/bar\/tabs\/tt1\/rounds$/) === 1, JSON.stringify(st.writes));
    r = await doubleTap(/^Bill$/);
    check("P17i Bill: \"⏳ Saving…\" and disabled 100 ms after the tap", r.found && saving(r.after), JSON.stringify(r));
    await waitWrites();
    check("P17j …a double tap closed the tab ONCE", writesTo(/^\/bar\/tabs\/tt1\/close$/) === 1, JSON.stringify(st.writes));
    check("P17 no page errors", !errs.length, errs.slice(0, 2).join(" | "));
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
