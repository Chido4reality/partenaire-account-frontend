// The Stenamo Admin wrap must NEVER install a service worker.
//
// WHY IT MATTERS
// --------------
// sw-admin.js serves navigations CACHE-FIRST from a precached '/'. In a browser
// that is a deliberate offline shell. Inside the Capacitor wrap it is a trap:
// the app loads partenairedozieadmin.com remotely SO THAT portal updates land
// without shipping a new APK, and a caching SW would pin the WebView to an old
// build indefinitely — the same failure that made a live browser serve a stale
// page on 2026-08-30.
//
// This does not test that the guard "compiles". It executes the REAL bootstrap
// IIFE out of public/admin.html twice — once with window.Capacitor present and
// once without — and asserts registration happens in exactly one of them, plus
// that the native path actively tears down anything left behind.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

// The bootstrap block is the LAST inline <script> — the one that registers the
// SW and drives the install banner. Pulled from the shipped file, not retyped.
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const boot = blocks.filter((b) => b.includes("serviceWorker.register")).pop() || "";
console.log("\n── admin wrap: service-worker guard ────────────────────────\n");
check("found the bootstrap block that registers the SW", boot.length > 200, `${boot.length} chars`);

async function run({ native }) {
  const registered = [];
  const unregistered = [];
  const deletedCaches = [];
  let loadHandler = null;

  const sw = {
    register: (path, opts) => { registered.push({ path, opts }); return Promise.resolve({}); },
    getRegistrations: () => Promise.resolve([
      { unregister: () => { unregistered.push(1); return Promise.resolve(true); } },
      { unregister: () => { unregistered.push(1); return Promise.resolve(true); } },
    ]),
  };
  const sandbox = {
    console,
    navigator: { serviceWorker: sw, userAgent: "node" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    caches: {
      keys: () => Promise.resolve(["admin-pwa-v2-shell", "admin-pwa-v2-runtime"]),
      delete: (k) => { deletedCaches.push(k); return Promise.resolve(true); },
    },
    document: {
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
    setTimeout, clearTimeout, Promise, Date, JSON, Math,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (evt, fn) => { if (evt === "load") loadHandler = fn; };
  sandbox.addEventListener = sandbox.window.addEventListener;
  if (native) sandbox.window.Capacitor = { isNativePlatform: () => true };

  try {
    vm.createContext(sandbox);
    new vm.Script(boot, { filename: "admin.html:bootstrap" }).runInContext(sandbox);
  } catch (e) {
    return { error: e.message, registered, unregistered, deletedCaches };
  }
  // The browser path defers registration to window 'load' — fire it, or the
  // browser case would look identical to the native one and this rig would
  // "pass" for the wrong reason.
  if (loadHandler) loadHandler();
  // The teardown is promise-based (getRegistrations().then / caches.keys().then),
  // so it settles on microtasks AFTER the script returns. Without this the rig
  // reads zeros and reports a working guard as broken — which it did first time.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { registered, unregistered, deletedCaches, hadLoadHandler: !!loadHandler };
}

// ── BROWSER: must register, exactly as before ───────────────────────────────
const web = await run({ native: false });
check("browser: the bootstrap runs without throwing", !web.error, web.error || "");
check("browser: a load handler is still attached", web.hadLoadHandler === true);
check("browser: sw-admin.js IS registered (unchanged behaviour)",
  web.registered.length === 1 && web.registered[0].path === "/sw-admin.js",
  web.registered.map((r) => r.path).join(",") || "none");
check("browser: scoped to /admin.html", web.registered[0]?.opts?.scope === "/admin.html",
  web.registered[0]?.opts?.scope);
check("browser: does NOT tear down caches", web.deletedCaches.length === 0,
  web.deletedCaches.join(",") || "none");

// ── NATIVE (Capacitor wrap): must NOT register, and must clean up ───────────
const app = await run({ native: true });
check("native: the bootstrap runs without throwing", !app.error, app.error || "");
check("native: NOTHING is registered — no stale shell is possible",
  app.registered.length === 0, app.registered.map((r) => r.path).join(",") || "none");
check("native: existing registrations are actively unregistered",
  app.unregistered.length === 2, `${app.unregistered.length} unregistered`);
check("native: leftover workbox caches are deleted",
  app.deletedCaches.length === 2, app.deletedCaches.join(","));

// ── the guard must key on Capacitor, not on something incidental ────────────
check("the guard reads window.Capacitor.isNativePlatform()",
  /Capacitor[\s\S]{0,40}isNativePlatform/.test(boot));

console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} SW-guard checks\n`);
process.exit(fails === 0 ? 0 : 1);
