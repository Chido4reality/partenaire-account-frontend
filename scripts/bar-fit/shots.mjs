// BAR LAYOUT — FIT EVERY SCREEN (Peter 2026-11-18). Screenshots + measurements of /bar at 8 viewports.
// LOCAL ONLY: a Vite dev server of this tree + headless Chromium; EVERY /api call is answered here
// from fixtures (page.route) — nothing reaches staging or prod, no login, no writes.
// Per viewport: Home with 4 items in the cart, then table T1 with a 2-item round draft; on narrow
// screens (cart = bottom sheet) also the sheet opened. Asserts: no horizontal overflow, no page or
// <main> scroll, the cart/table panel fully inside the viewport with nothing cropped inside it, Hold +
// Take payment visible and on top, names ≤ 2 lines with the price pill inside the box, compact header.
// Output: docs/bar-fit/*.png + docs/bar-fit/results.json. Exit 1 on any failed assertion.
// Run: node scripts/bar-fit/shots.mjs   (PW_MODULE / PW_CHROME override the Playwright + browser paths)
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { bundleApp } from "./bundle.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = resolve(ROOT, "docs/bar-fit");
mkdirSync(OUT, { recursive: true });
const PW = process.env.PW_MODULE || "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const CHROME = process.env.PW_CHROME || resolve(os.homedir(), "AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const { chromium } = await import(pathToFileURL(PW).href);
const ONLY = (process.env.BAR_FIT_ONLY || "").split(",").filter(Boolean);
const LANG = process.env.BAR_FIT_LANG || "en";
const UA_TAG = process.env.BAR_FIT_DESKTOP_UA ? "-desktopUA" : "";   // the same sizes with a desktop browser identity

const ANDROID_TAB = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";
const VIEWPORTS = [
  ["1024x768", 1024, 768, "tablet"], ["1180x820", 1180, 820, "tablet"], ["1280x800", 1280, 800, "tablet"],
  ["1366x1024", 1366, 1024, "tablet"], ["1920x1080", 1920, 1080, "desktop"],
  ["768x1024", 768, 1024, "tablet"], ["800x1280", 800, 1280, "tablet"], ["390x844", 390, 844, "phone"],
].filter(([n]) => !ONLY.length || ONLY.includes(n));

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const BON = "b0b0b0b0-0000-0000-0000-000000000002", BEP = "b0b0b0b0-0000-0000-0000-000000000001";
const ok = (data) => ({ success: true, data });
const NAMES = ["Castel Beer 65cl", "Guinness Foreign Extra Stout 65cl Bottle", "Johnnie Walker Black Label 12 Years Old 75cl", "Coca-Cola 50cl",
  "Supermont Water 1.5L", "Mützig", "Heineken 33cl Can", "Jack Daniel's Old No. 7 Tennessee Whiskey 70cl", "Brochettes de bœuf (4 pièces)",
  "Poisson braisé avec plantains et sauce piment", "Top Pamplemousse", "Red Bull 25cl", "Smirnoff Ice", "Booster Cola Lime"];
const CATS = ["Bières", "Bières", "Whisky", "Boissons", "Boissons", "Bières", "Bières", "Whisky", "Grillades", "Grillades", "Boissons", "Boissons", "Vodka", "Boissons"];
const PRODUCTS = NAMES.map((name, i) => ({ id: `p${String(i + 1).padStart(2, "0")}`, name, sell_price: [1000, 1500, 25000, 600, 500, 900, 1200, 30000, 2500, 6000, 600, 1500, 1500, 1000][i],
  unit: "piece", is_multipart: false, stock: { quantity: 40, min_quantity: 5 }, pa_categories: { name: CATS[i], color: null } }));
const ZONES = [{ id: "z1", name: "Terrasse" }, { id: "z2", name: "Salle" }, { id: "z3", name: "VIP" }];
const TABLES = Array.from({ length: 14 }, (_, i) => ({ id: `t${i + 1}`, label: `T${i + 1}`, zone_id: ZONES[i % 3].id,
  tab: i === 0 ? { id: "tab1", status: "open", pa_sales: { version: 3, total_amount: 4500 } } : i === 4 ? { id: "tab5", status: "closed", pa_sales: { version: 2, total_amount: 7000 } } : null }));
const TAB1 = { id: "tab1", location_id: BON, status: "open", pa_sales: { version: 3, total_amount: 4500 }, rounds: [
  { id: "r1", round_no: 1, status: "served", total: 3000, version: 2, served_by_name: "Kusi", pa_bar_round_items: [{ quantity: 2, pa_products: { name: "Castel Beer 65cl" } }, { quantity: 1, pa_products: { name: "Coca-Cola 50cl" } }] },
  { id: "r2", round_no: 2, status: "sent", total: 1500, version: 1, pa_bar_round_items: [{ quantity: 1, pa_products: { name: "Guinness Foreign Extra Stout 65cl Bottle" } }] }] };
const USER = { id: "u1", org_id: "o1", role: "owner", full_name: "Boss Dozie", phone: "699000101", has_seen_onboarding: true, location_id: null };
const ORG = { id: "o1", name: "Dozie Tube & Tyre", plan: "pro_plus", subscription_status: "active", currency: "XAF", bar_mode_enabled: true, max_offline_hours: 24 };
const LOCS = [{ id: BON, name: "Bonaberri", type: "shop", is_active: true }, { id: BEP, name: "Bepanda", type: "shop", is_active: true }];

function answer(path, search) {
  if (path === "/auth/me") return ok({ user: USER, org: ORG });
  if (path === "/bar/mine") return ok({ bars: [{ id: BON, name: "Bonaberri" }, { id: BEP, name: "Bepanda" }], can_setup: true });
  if (path === "/locations") return ok(LOCS);
  if (/^\/bar\/[^/]+\/floor$/.test(path)) return ok({ zones: ZONES, tables: TABLES, named_tabs: [] });
  if (/^\/bar\/[^/]+\/quick-items$/.test(path)) return ok({ ids: ["p02", "p01", "p03", "p08", "p04", "p10", "p05", "p06", "p09", "p07", "p11", "p12", "p13", "p14"] });
  if (path === "/bar/tabs/tab1") return ok(TAB1);
  if (path === "/products/multipart-availability") return ok({});
  if (path === "/products") return ok(PRODUCTS);
  if (path === "/held-carts") return ok([]);
  if (path === "/shifts/current") return ok(null);
  return null;
}

const unknown = new Set();
const results = [];
let fails = 0;
const check = (vp, label, pass, detail = "") => { if (!pass) fails++; results.push({ vp, label, pass, detail }); console.log(`  ${pass ? "pass" : "FAIL"}  ${label}${!pass && detail ? `  [${detail}]` : ""}`); };

// measured in the page: overflow, scroll, panel inside viewport, nothing cropped, buttons on top
const MEASURE = ({ panelSel, buttons }) => {
  const W = innerWidth, H = innerHeight, r = (el) => el.getBoundingClientRect();
  const se = document.scrollingElement, main = document.querySelector("main");
  const scr = document.querySelector(".bar-screen");
  const out = {
    pageScrollX: se.scrollWidth - W, pageScrollY: se.scrollHeight - H,
    mainScrollX: main ? main.scrollWidth - main.clientWidth : 0, mainScrollY: main ? main.scrollHeight - main.clientHeight : 0,
    screenScrollX: scr ? scr.scrollWidth - scr.clientWidth : null, screenScrollY: scr ? scr.scrollHeight - scr.clientHeight : null,
    topH: (document.querySelector(".bar-top")?.getBoundingClientRect().height || 0), rowH: (document.querySelector(".bar-row")?.getBoundingClientRect().height || 0),
    cols: (() => { const g = document.querySelector(".bar-grid"); return g ? getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length : 0; })(),
    names: [...document.querySelectorAll(".bar-box")].map((b) => { const n = b.querySelector(".bar-box-name"), p = b.querySelector(".bar-box-price"); const lh = parseFloat(getComputedStyle(n).lineHeight) || 20;
      const br = r(b), pr = p ? r(p) : null; return { text: n.textContent, lines: Math.round(r(n).height / lh), priceInside: !!pr && pr.left >= br.left - 1 && pr.right <= br.right + 1 && pr.top >= br.top - 1 && pr.bottom <= br.bottom + 1 && pr.width > 0 }; }),
  };
  const panel = panelSel ? [...document.querySelectorAll(panelSel)].find((e) => r(e).width > 0) : null;
  if (panel) {
    const pr = r(panel); out.panel = { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, width: pr.width, pct: pr.width / W };
    out.cropped = [...panel.querySelectorAll("*")].filter((e) => { const x = r(e); if (!x.width || !x.height) return false;
      // inside a scroller that scrolls vertically, below/above the fold is fine; sideways never
      return x.right > pr.right + 1 || x.left < pr.left - 1; }).slice(0, 5).map((e) => `${e.tagName}.${e.className || ""}:${(e.textContent || "").trim().slice(0, 30)}`);
  }
  out.buttons = buttons.map((re) => {
    const b = [...document.querySelectorAll("button")].find((e) => new RegExp(re).test(e.textContent) && r(e).width > 0);
    if (!b) return { re, found: false };
    const x = r(b), cx = x.left + x.width / 2, cy = x.top + x.height / 2, top = document.elementFromPoint(cx, cy);
    return { re, found: true, inView: x.left >= 0 && x.top >= 0 && x.right <= W + 0.5 && x.bottom <= H + 0.5, onTop: !!top && (top === b || b.contains(top)), rect: [x.left, x.top, x.right, x.bottom].map(Math.round) };
  });
  return out;
};

function assertAll(vp, tag, m, { panel = true, buttons = true, H }) {
  check(vp, `${tag}: no horizontal overflow (page ${m.pageScrollX}, main ${m.mainScrollX}, bar ${m.screenScrollX})`, m.pageScrollX <= 0 && m.mainScrollX <= 0 && (m.screenScrollX ?? 0) <= 0);
  check(vp, `${tag}: no page scroll (page ${m.pageScrollY}, main ${m.mainScrollY}, bar ${m.screenScrollY})`, m.pageScrollY <= 0 && m.mainScrollY <= 0 && (m.screenScrollY ?? 0) <= 0);
  if (panel) {
    check(vp, `${tag}: panel fully inside the viewport${m.panel ? ` (${Math.round(m.panel.left)}→${Math.round(m.panel.right)} × ${Math.round(m.panel.top)}→${Math.round(m.panel.bottom)}, ${Math.round(m.panel.pct * 100)}% wide)` : ""}`,
      !!m.panel && m.panel.left >= -0.5 && m.panel.top >= -0.5 && m.panel.right <= m.W + 0.5 && m.panel.bottom <= H + 0.5, m.panel ? "" : "panel not found");
    check(vp, `${tag}: nothing cropped sideways inside the panel`, !!m.cropped && !m.cropped.length, (m.cropped || []).join(" | "));
  }
  if (buttons) for (const b of m.buttons) check(vp, `${tag}: “${b.re}” visible, in the viewport and on top`, b.found && b.inView && b.onTop, JSON.stringify(b));
}

// a light build (esbuild + the project's PostCSS) served statically; /bar falls back to index.html
const APP_DIR = resolve(os.tmpdir(), "bar-fit-app");
// BAR_FIT_PREBUILT=1: use the bundle a separate `node scripts/bar-fit/bundle.mjs` run made (keeps the bundler's memory out of the browser run)
const APP = process.env.BAR_FIT_PREBUILT && existsSync(resolve(APP_DIR, "bundle.js")) ? APP_DIR : await bundleApp(ROOT, APP_DIR);
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const serveFile = (f) => { try { return statSync(f).isFile() ? f : null; } catch { return null; } };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = serveFile(resolve(APP, "." + p)) || serveFile(resolve(ROOT, "public", "." + p)) || resolve(APP, "index.html");
  res.writeHead(200, { "content-type": TYPES[(f.match(/\.[a-z0-9]+$/i) || [""])[0]] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(5199, ok));
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--disable-gpu", "--disable-extensions", "--js-flags=--max-old-space-size=384", "--renderer-process-limit=1", "--disable-dev-shm-usage"] });
try {
  for (const [name, W, H, kind] of VIEWPORTS) {
    console.log(`\n── ${name} (${kind}) ──`);
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, serviceWorkers: "block",
      userAgent: process.env.BAR_FIT_DESKTOP_UA ? undefined : kind === "phone" ? ANDROID_PHONE : kind === "tablet" ? ANDROID_TAB : undefined, hasTouch: kind !== "desktop", isMobile: kind === "phone" });
    await ctx.addInitScript(({ USER, ORG, BON, LANG }) => {
      if (sessionStorage.getItem("__fit_init")) return; sessionStorage.setItem("__fit_init", "1");
      localStorage.clear();
      localStorage.setItem("mp-auth", JSON.stringify({ state: { user: USER, org: ORG, token: "fit-token", isAuthenticated: true, impersonating: false, impersonation: null, lastVerifiedActive: Date.now(), maxOfflineHours: 24 }, version: 0 }));
      localStorage.setItem("mp-lang", JSON.stringify({ state: { lang: LANG }, version: 0 }));
      localStorage.setItem("mp-settings", JSON.stringify({ state: { selectedLocation: { id: BON, name: "Bonaberri", type: "shop" } }, version: 0 }));
    }, { USER, ORG, BON, LANG });
    // nothing leaves this machine: anything not on localhost (fonts, analytics…) is refused
    await ctx.route((u) => u.hostname !== "localhost", (route) => route.abort());
    await ctx.route((u) => u.hostname === "localhost" && u.pathname.startsWith("/api/"), (route) => {
      const u = new URL(route.request().url()); const p = u.pathname.replace(/^\/api/, "");
      const a = route.request().method() === "GET" ? answer(p, u.search) : ok({});
      if (a === null) unknown.add(p);
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(a ?? ok([])) });
    });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("http://localhost:5199/bar", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bar-box", { timeout: 60000 });
    await page.waitForTimeout(600);
    // Home: A ×2, B, C — tapped like a bartender
    const boxes = page.locator(".bar-box");
    for (const i of [0, 0, 1, 2]) { await boxes.nth(i).click(); await page.waitForTimeout(120); }
    await page.waitForTimeout(500);
    const sheetMode = await page.evaluate(() => !document.querySelector(".bar-cart"));
    let m = await page.evaluate(MEASURE, { panelSel: sheetMode ? null : ".bar-cart", buttons: sheetMode ? [] : ["Take payment|Encaisser", "^⏸ (Hold|Mettre en attente)$"] }); m.W = W;
    await page.screenshot({ path: resolve(OUT, `${name}${UA_TAG}-home.png`) });
    assertAll(name, "Home", m, { panel: !sheetMode, buttons: !sheetMode, H });
    check(name, `Home: cart is ${sheetMode ? "the bottom sheet (narrow)" : "the side panel"} — expected ${W >= 900 ? "side panel" : "bottom sheet"}`, sheetMode === (W < 900));
    const expCols = W >= 1366 ? 4 : W >= 900 ? 3 : 2;
    check(name, `grid columns ${m.cols} (expected ${expCols})`, m.cols === expCols);
    const badNames = m.names.filter((n) => n.lines > 2 || !n.priceInside);
    check(name, `names ≤ 2 lines, price pill inside every box (${m.names.length} boxes)`, m.names.length > 0 && !badNames.length, JSON.stringify(badNames.slice(0, 3)));
    const topPct = (m.topH / H) * 100, rowPct = (m.rowH / H) * 100;
    check(name, `header ${Math.round(m.topH)}px (${topPct.toFixed(1)}%) + tables row ${Math.round(m.rowH)}px (${rowPct.toFixed(1)}%) compact (each ≤ 10%)`, topPct <= 10 && rowPct <= 10);
    if (sheetMode) {
      // the existing strip → open the sheet; Take payment + Hold must be reachable in it
      await page.screenshot({ path: resolve(OUT, `${name}${UA_TAG}-home-strip.png`) });
      const strip = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => /Open cart|Ouvrir le panier/.test(e.getAttribute("aria-label") || ""));
        if (!b) return null; const x = b.getBoundingClientRect(); return { inView: x.top >= 0 && x.bottom <= innerHeight, bottom: Math.round(x.bottom) }; });
      check(name, `Home: the cart strip is on screen${strip ? ` (bottom ${strip.bottom}px)` : ""}`, !!strip && strip.inView, JSON.stringify(strip));
      await page.getByRole("button", { name: /Open cart|Ouvrir le panier/ }).click();
      await page.waitForTimeout(900);
      const s = await page.evaluate(MEASURE, { panelSel: "[data-vaul-drawer]", buttons: ["Take payment|Encaisser", "^⏸ (Hold|Mettre en attente)$"] }); s.W = W;
      await page.screenshot({ path: resolve(OUT, `${name}${UA_TAG}-home-sheet.png`) });
      assertAll(name, "Home sheet open", s, { panel: true, buttons: true, H });
      await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    }
    // a table: T1 (open tab, 2 rounds) + a 2-item next-round draft
    await page.locator(".bar-pill", { hasText: "T1 ·" }).first().click();
    await page.waitForSelector(".bar-card .bar-total", { timeout: 20000 });
    const tb = page.locator(".bar-box");
    for (const i of [3, 4]) { await tb.nth(i).click(); await page.waitForTimeout(120); }
    await page.waitForTimeout(400);
    m = await page.evaluate(MEASURE, { panelSel: ".bar-card", buttons: ["^(Send round|Envoyer la tournée)", "^(Close tab|Fermer la note)$"] }); m.W = W;
    await page.screenshot({ path: resolve(OUT, `${name}${UA_TAG}-table.png`) });
    assertAll(name, "Table T1", m, { H });
    const badT = m.names.filter((n) => n.lines > 2 || !n.priceInside);
    check(name, `Table: names ≤ 2 lines, price pill inside every box (${m.names.length} boxes, ${m.cols} columns)`, m.names.length > 0 && !badT.length, JSON.stringify(badT.slice(0, 3)));
    check(name, "no page errors", !errs.length, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
writeFileSync(resolve(OUT, `results${UA_TAG}.json`), JSON.stringify({ when: new Date().toISOString(), lang: LANG, results, unknownApi: [...unknown] }, null, 2));
if (unknown.size) console.log(`\n(api paths answered with an empty list: ${[...unknown].join(", ")})`);
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "PASS — /bar fits every screen"}  (screenshots: docs/bar-fit/)\n`);
process.exit(fails ? 1 : 0);
