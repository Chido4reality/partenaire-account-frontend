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
const APP = resolve(os.tmpdir(), TEETH ? `bar-fit-app-teeth${TEETH}` : "bar-fit-app");
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

function answer(path, q) {
  if (path === "/auth/me") return ok({ user: USER, org: ORG });
  if (path === "/bar/mine") return ok({ bars: [{ id: BON, name: "Bonaberri" }, { id: BEP, name: "Bepanda" }], can_setup: true, can_serve: true });
  if (path === "/locations") return ok(LOCS);
  if (/^\/bar\/[^/]+\/floor$/.test(path)) return ok({ zones: [{ id: "z1", name: "Salle" }], tables: TABLES, named_tabs: [] });
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

async function session(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  await ctx.addInitScript(({ USER, ORG, BON }) => {
    if (sessionStorage.getItem("__cart_init")) return; sessionStorage.setItem("__cart_init", "1");
    localStorage.clear();
    localStorage.setItem("mp-auth", JSON.stringify({ state: { user: USER, org: ORG, token: "probe-token", isAuthenticated: true, impersonating: false, impersonation: null, lastVerifiedActive: Date.now(), maxOfflineHours: 24 }, version: 0 }));
    localStorage.setItem("mp-lang", JSON.stringify({ state: { lang: "en" }, version: 0 }));
    localStorage.setItem("mp-settings", JSON.stringify({ state: { selectedLocation: { id: BON, name: "Bonaberri", type: "shop" } }, version: 0 }));
  }, { USER, ORG, BON });
  const st = { delay: null, sales: [], holds: [] };
  await ctx.route((u) => u.hostname !== "localhost", (route) => route.abort());
  await ctx.route((u) => u.hostname === "localhost" && u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace(/^\/api/, "");
    if (st.delay) await new Promise((r) => setTimeout(r, st.delay[0] + Math.random() * (st.delay[1] - st.delay[0])));
    let a;
    if (req.method() === "GET") a = answer(p, u.searchParams) ?? ok([]);
    else if (p === "/sales" || p === "/sales/ticket") { const body = req.postDataJSON(); st.sales.push(body); a = ok({ id: `sale${st.sales.length}`, sale_number: `S-${st.sales.length}`, total_amount: 0, status: "completed" }); }
    else if (p === "/held-carts") { st.holds.push(req.postDataJSON()); a = ok({ id: "h1", hold_ref: "H-1" }); }
    else a = ok({});
    try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(a) }); } catch { /* page moved on */ }
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
} catch (e) {
  fails++; console.log(`  FAIL  probe stopped: ${e.message.split("\n")[0]}`);
  if (process.env.BAR_CART_SHOT && lastPage) await lastPage.screenshot({ path: process.env.BAR_CART_SHOT }).catch(() => {});
} finally {
  await browser.close(); server.close();
}
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed, ${passes} passed` : `PASS — ${passes}/${passes}: each branch keeps its own Home cart`}${TEETH ? `  (TEETH ${TEETH}: ${fails ? "red as required" : "STILL GREEN — the probe has no teeth!"})` : ""}\n`);
process.exit(TEETH ? (fails ? 0 : 1) : (fails ? 1 : 0));
