// PAYMENT PANEL CUSTOMER PICK (Peter 2026-11-18) — browser test. LOCAL ONLY like shots.mjs: the real app
// bundle in headless Chromium, EVERY /api call answered here from fixtures, every non-localhost request
// aborted — nothing reaches staging or prod, no login, no writes.
//   C1  New Sale (PC 1280×800): Full Credit → warning → "Choose customer" → pick → warning gone, the TOP
//       Customer field shows the same customer, Confirm → POST /sales carries that customer_id (credit)
//   C2  New Sale (PC): Full Credit → "Choose customer" → "+ New customer" → the Customers page's modal →
//       POST /customers → selected → POST /sales carries the NEW customer's id
//   C3  New Sale on a phone (390×844, cart = bottom sheet): the same as C1 inside the sheet
//   C4  Bar (1280×800, the embedded POS): the same as C1 — French labels this time
//   C5  New Sale render vs BASE (BAR_FIT_BASE bundle = the committed tree before this change): the page with
//       the payment panel open is byte-identical; with Full Credit chosen it is identical once the ONE new
//       button inside the warning is taken out
// Run:   node scripts/bar-fit/bundle.mjs && BAR_FIT_BASE=<ref> node scripts/bar-fit/bundle.mjs && node scripts/bar-fit/customer-pick.mjs
// Teeth: BAR_PICK_TEETH=1 node scripts/bar-fit/bundle.mjs && BAR_PICK_TEETH=1 node scripts/bar-fit/customer-pick.mjs  (must go red)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const TEETH = !!process.env.BAR_PICK_TEETH;
const APP = resolve(os.tmpdir(), TEETH ? "bar-fit-app-pickteeth" : "bar-fit-app");
const BASE_APP = resolve(os.tmpdir(), "bar-fit-app-base");
for (const d of TEETH ? [APP] : [APP, BASE_APP]) if (!existsSync(resolve(d, "bundle.js"))) { console.error(`no bundle in ${d} — see Run above`); process.exit(2); }
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const { chromium } = await import(pathToFileURL(PW).href);
if (TEETH) console.log("!!  TEETH: the warning's pick does not set the sale's customer — this run MUST fail");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const BON = "b0b0b0b0-0000-0000-0000-000000000002", BEP = "b0b0b0b0-0000-0000-0000-000000000001";
const ok = (data) => ({ success: true, data });
const PRODUCTS = [["bon1", "Castel", 1000], ["bon2", "Guinness", 1500], ["bon3", "Coca", 600]].map(([id, n, p]) => ({ id, name: n, sell_price: p, min_price: 0, cost_price: 0,
  unit: "piece", is_multipart: false, stock: { quantity: 40, min_quantity: 5 }, pa_categories: { name: "Bières", color: null } }));
const CUSTOMERS = [
  { id: "c1", name: "Abena Fotso", phone: "677000001", customer_type: "retail", credit_limit: 500000, total_debt: 0 },
  { id: "c2", name: "Ngono Marie", phone: "677000002", customer_type: "retail", credit_limit: 500000, total_debt: 0 },
  { id: "c3", name: "Ngoh Paul", phone: "677000003", customer_type: "retail", credit_limit: 500000, total_debt: 0 },
];
const USER = { id: "u1", org_id: "o1", role: "owner", full_name: "Boss Dozie", phone: "699000101", has_seen_onboarding: true, location_id: null };
const ORG = { id: "o1", name: "Dozie Tube & Tyre", plan: "pro_plus", subscription_status: "active", currency: "XAF", bar_mode_enabled: true, max_offline_hours: 24 };
const LOCS = [{ id: BON, name: "Bonaberri", type: "shop", is_active: true }, { id: BEP, name: "Bepanda", type: "shop", is_active: true }];
const OPENED = "2026-11-18T07:00:00.000Z";

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
  if (path === "/shifts/current") return ok({ shift_id: `s-${q.get("location_id")}`, location_id: q.get("location_id"), opened_at: OPENED, status: "open" });
  return null;
}

let fails = 0, passes = 0, lastPage = null;
const check = (label, pass, detail = "") => { if (pass) passes++; else fails++; console.log(`  ${pass ? "pass" : "FAIL"}  ${label}${!pass && detail ? `  [${detail}]` : ""}`); };

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const serveFile = (f) => { try { return statSync(f).isFile() ? f : null; } catch { return null; } };
const serve = (dir, port) => new Promise((r) => { const s = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = serveFile(resolve(dir, "." + p)) || serveFile(resolve(ROOT, "public", "." + p)) || resolve(dir, "index.html");
  res.writeHead(200, { "content-type": TYPES[(f.match(/\.[a-z0-9]+$/i) || [""])[0]] || "application/octet-stream" }); res.end(readFileSync(f));
}); s.listen(port, () => r(s)); });
const servers = [await serve(APP, 5197)];
if (!TEETH) servers.push(await serve(BASE_APP, 5196));
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });

const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";
async function session({ port = 5197, path = "/pos", w = 1280, h = 800, phone = false, lang = "en", seedCart = true }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: "block",
    userAgent: phone ? ANDROID_PHONE : undefined, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(({ USER, ORG, BON, lang, seedCart, PRODUCTS }) => {
    if (sessionStorage.getItem("__pick_init")) return; sessionStorage.setItem("__pick_init", "1");
    localStorage.clear();
    localStorage.setItem("mp-auth", JSON.stringify({ state: { user: USER, org: ORG, token: "probe-token", isAuthenticated: true, impersonating: false, impersonation: null, lastVerifiedActive: Date.now(), maxOfflineHours: 24 }, version: 0 }));
    localStorage.setItem("mp-lang", JSON.stringify({ state: { lang }, version: 0 }));
    localStorage.setItem("mp-settings", JSON.stringify({ state: { selectedLocation: { id: BON, name: "Bonaberri", type: "shop" } }, version: 0 }));
    if (seedCart) {   // a 2-line cart the POS restores on load (its own saved-cart store), so no product search is driven
      const items = [[PRODUCTS[0], 2], [PRODUCTS[1], 1]].map(([p, q], i) => ({ lineId: `L${i}`, product_id: p.id, name: p.name, unit: "piece", quantity: q,
        unit_price: p.sell_price, original_price: p.sell_price, sell_price: p.sell_price, min_price: 0, cost_price: 0, stock: 40, barLoc: BON }));
      localStorage.setItem("mp-pos-draft-cart", JSON.stringify({ state: { drafts: { [`${USER.id}::${BON}`]: { items, updatedAt: Date.now() } } }, version: 0 }));
    }
  }, { USER, ORG, BON, lang, seedCart, PRODUCTS });
  const st = { sales: [], created: [] };
  await ctx.route((u) => u.hostname !== "localhost", (route) => route.abort());
  await ctx.route((u) => u.hostname === "localhost" && u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname.replace(/^\/api/, "");
    let a, status = 200;
    if (req.method() === "GET") a = answer(p, u.searchParams) ?? ok([]);
    else if (p === "/sales" || p === "/sales/ticket") { st.sales.push(req.postDataJSON()); a = ok({ id: `sale${st.sales.length}`, sale_number: `S-${st.sales.length}`, status: "completed" }); }
    else if (p === "/customers") { const b = req.postDataJSON(); const c = { id: "c9", name: b.name, phone: b.phone, customer_type: b.customer_type, credit_limit: 0, total_debt: 0 }; st.created.push(b); a = ok(c); status = 201; }
    else a = ok({});
    try { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(a) }); } catch { /* moved on */ }
  });
  const page = await ctx.newPage(); lastPage = page;
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}${path}`, { waitUntil: "domcontentloaded" });
  return { ctx, page, st, errs };
}

const T = (lang) => lang === "en"
  ? { proceed: /^(Proceed to Payment →|Take payment)$/, credit: /Full Credit/, warn: "A registered customer is required", choose: /Choose customer/, newc: /New customer/, confirm: /✓ Confirm/, label: "Customer (optional)", add: /^Add Customer$/ }
  : { proceed: /^(Paiement →|Encaisser)$/, credit: /Crédit total/, warn: "Un client enregistré est requis", choose: /Choisir un client/, newc: /Nouveau client/, confirm: /✓ Valider/, label: "Client (optionnel)", add: /^Ajouter$/ };

// the cart lines are on screen (restored) → open payment → Full Credit
async function toCredit(page, t, { sheet = false } = {}) {
  if (sheet) {   // a restored cart opens the sheet by itself on a phone; otherwise tap the strip
    await page.getByRole("button", { name: t.proceed }).first().waitFor({ timeout: 60000 }).catch(() => {});
    if (!(await page.getByRole("button", { name: t.proceed }).first().isVisible())) { await page.getByRole("button", { name: /Open cart|Ouvrir le panier/ }).click({ timeout: 15000 }); await page.waitForTimeout(700); }
  }
  await page.getByRole("button", { name: t.proceed }).first().click({ timeout: 60000 });
  await page.getByRole("button", { name: t.credit }).first().click({ timeout: 15000 });
  await page.waitForTimeout(300);
}
const warnShown = (page, t) => page.evaluate((w) => [...document.querySelectorAll("div")].some((d) => d.firstChild && d.firstChild.textContent && d.firstChild.textContent.includes(w) && d.getBoundingClientRect().width > 0), t.warn);
// the TOP customer field (the "Customer (optional)" block), whatever layout put it where
const topCustomer = (page, t) => page.evaluate((label) => { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.includes(label)); return l ? l.parentElement.innerText : null; }, t.label);
async function confirmAndGetSale(page, st, t) {
  const before = st.sales.length;
  await page.getByRole("button", { name: t.confirm }).first().click({ timeout: 15000 });
  for (let i = 0; i < 40 && st.sales.length === before; i++) await page.waitForTimeout(150);
  return st.sales[before] || null;
}

async function pickFlow(tag, opts) {
  const t = T(opts.lang || "en");
  const { ctx, page, st, errs } = await session(opts);
  console.log(`\n── ${tag} ──`);
  await toCredit(page, t, { sheet: !!opts.phone });
  check(`${tag}: the warning shows with Full Credit and no customer`, await warnShown(page, t));
  const btn = page.getByRole("button", { name: t.choose });
  check(`${tag}: “${t.choose.source}” is inside the warning`, (await btn.count()) === 1 && await btn.evaluate((b, w) => b.parentElement.textContent.includes(w), t.warn));
  await btn.click();
  await page.getByRole("textbox", { name: /Search customer|Rechercher un client/ }).fill("Ngon");
  await page.locator(".pay-cust-row", { hasText: "Ngono Marie" }).click();
  await page.waitForTimeout(300);
  check(`${tag}: picked → the warning is gone`, !(await warnShown(page, t)));
  const top = await topCustomer(page, t);
  check(`${tag}: the TOP Customer field shows the same customer`, !!top && top.includes("Ngono Marie"), JSON.stringify(top));
  const sale = await confirmAndGetSale(page, st, t);
  check(`${tag}: Confirm → the sale is sent with customer_id c2 (Ngono Marie)`, sale?.customer_id === "c2", JSON.stringify(sale && { customer_id: sale.customer_id }));
  check(`${tag}: … as a credit sale (payment unchanged: pay_mode credit, nothing paid)`, sale?.pay_mode === "credit" && Number(sale?.paid_amount || 0) === 0, JSON.stringify(sale && { pay_mode: sale.pay_mode, paid_amount: sale.paid_amount }));
  check(`${tag}: no page errors`, !errs.length, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

try {
  await pickFlow("C1 New Sale PC", { path: "/pos" });
  {
    const t = T("en");
    const { ctx, page, st, errs } = await session({ path: "/pos" });
    console.log("\n── C2 New Sale PC: + New customer ──");
    await toCredit(page, t);
    await page.getByRole("button", { name: t.choose }).click();
    await page.getByRole("button", { name: t.newc }).click();
    await page.waitForSelector(".modal", { timeout: 10000 });
    check("C2: “+ New customer” opens the Customers page's Add Customer modal", await page.locator(".modal", { hasText: "Add New Customer" }).count() === 1);
    await page.locator(".modal input").nth(0).fill("Etame Bertrand");
    await page.locator(".modal input").nth(1).fill("677000099");
    await page.getByRole("button", { name: t.add }).click();
    for (let i = 0; i < 30 && !st.created.length; i++) await page.waitForTimeout(150);
    await page.waitForTimeout(400);
    check("C2: POST /customers sent once with the typed name + phone", st.created.length === 1 && st.created[0].name === "Etame Bertrand" && st.created[0].phone === "677000099", JSON.stringify(st.created));
    check("C2: the modal closed and the new customer is the sale's customer (warning gone)", !(await page.locator(".modal").count()) && !(await warnShown(page, t)));
    const top = await topCustomer(page, t);
    check("C2: the TOP Customer field shows the new customer", !!top && top.includes("Etame Bertrand"), JSON.stringify(top));
    const sale = await confirmAndGetSale(page, st, t);
    check("C2: the sale is sent with the NEW customer's id (c9)", sale?.customer_id === "c9", JSON.stringify(sale && { customer_id: sale.customer_id }));
    check("C2: no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
  await pickFlow("C3 New Sale phone sheet", { path: "/pos", w: 390, h: 844, phone: true });
  await pickFlow("C4 Bar (FR)", { path: "/bar", lang: "fr" });

  if (!TEETH) {
    console.log("\n── C5 New Sale render vs BASE ──");
    const grab = async (port) => {
      const t = T("en");
      const { ctx, page } = await session({ port, path: "/pos" });
      await page.getByRole("button", { name: t.proceed }).first().click({ timeout: 60000 });
      await page.waitForTimeout(600);
      const open = await page.evaluate(() => document.querySelector("main").innerHTML);
      await page.getByRole("button", { name: t.credit }).first().click();
      await page.waitForTimeout(600);
      const credit = await page.evaluate(() => { const m = document.querySelector("main").cloneNode(true); const b = m.querySelectorAll(".pay-cust-choose"); const n = b.length; b.forEach((x) => x.remove()); return { html: m.innerHTML, removed: n }; });
      await ctx.close();
      return { open, credit };
    };
    const base = await grab(5196), cand = await grab(5197);
    const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i >= a.length && a.length === b.length ? -1 : i; };
    const d1 = firstDiff(base.open, cand.open);
    check(`C5 payment panel open (Full Payment): page byte-identical to base (${cand.open.length} chars)`, d1 === -1, d1 >= 0 ? `base …${base.open.slice(d1 - 60, d1 + 80)}… | new …${cand.open.slice(d1 - 60, d1 + 80)}…` : "");
    check("C5 Full Credit: exactly ONE new element (the Choose customer button), none in the base", cand.credit.removed === 1 && base.credit.removed === 0, `${cand.credit.removed}/${base.credit.removed}`);
    const d2 = firstDiff(base.credit.html, cand.credit.html);
    check("C5 Full Credit: identical to base once that button is taken out", d2 === -1, d2 >= 0 ? `base …${base.credit.html.slice(d2 - 60, d2 + 80)}… | new …${cand.credit.html.slice(d2 - 60, d2 + 80)}…` : "");
  }
} catch (e) {
  fails++; console.log(`  FAIL  stopped: ${e.message.split("\n")[0]}`);
  if (process.env.BAR_PICK_SHOT && lastPage) await lastPage.screenshot({ path: process.env.BAR_PICK_SHOT }).catch(() => {});
} finally {
  await browser.close(); for (const s of servers) s.close();
}
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed, ${passes} passed` : `PASS — ${passes}/${passes}: the customer is picked right in the payment panel`}${TEETH ? `  (TEETH: ${fails ? "red as required" : "STILL GREEN — no teeth!"})` : ""}\n`);
process.exit(TEETH ? (fails ? 0 : 1) : (fails ? 1 : 0));
