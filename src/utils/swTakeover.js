// SW TAKEOVER (2026-10-18): how a new web version replaces the running one.
//
// The app's service worker only takes over when a page posts it {type:"SKIP_WAITING"} (Workbox's
// message handler). vite-plugin-pwa turns on skipWaiting by itself only when it injects its own
// register script — this app registers manually (injectRegister:false, native skips the SW), so a new
// version installed and then WAITED until every tab of the app was closed; meanwhile the old one kept
// serving the old shell (and, for /learn, the app instead of the lessons page).
//
// The plugin's own client (virtual:pwa-register) would reload EVERY open tab the moment a new version
// took over — including a cashier's visible screen mid-payment — with no loop guard. So the rules
// here are ours:
//   • look for a new version at start-up, every 30 min, and when a tab comes back into view;
//   • a waiting version is told to take over only when nobody is mid-task: during the first 15 s
//     after this page started (nothing typed yet), or while this tab is in the background;
//   • when the new version takes control, a tab reloads at once if it asked for it or is in the
//     background; a tab someone is looking at reloads the next time it is hidden;
//   • at most ONE automatic reload per tab per minute (sessionStorage), so a version that keeps
//     changing can never loop the page.
// Native (Capacitor) never registers a service worker — see main.jsx.

const SW_URL = "/sw.js";
const STARTUP_MS = 15 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const RELOAD_KEY = "mp-sw-takeover-reload-at";
const LOOP_MS = 60 * 1000;

const startedAt = Date.now();
let hadController = false;   // a version was already running this page → a takeover is an UPDATE
let asked = false;           // this tab told the waiting version to take over
let pendingReload = false;   // took over while visible → reload when hidden
let registration = null;

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const inStartup = () => Date.now() - startedAt < STARTUP_MS;

// Reload once; refuses (returns false) if this tab already auto-reloaded within the last minute.
export function reloadOnce() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* storage off */ }
  if (Date.now() - last < LOOP_MS) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage off: still once per page */ }
  window.location.reload();
  return true;
}

// Tell a waiting version to take over. `force` = the caller knows nobody is mid-task (LearnBounce).
export function activateWaiting(reg = registration, { force = false } = {}) {
  if (!reg || !reg.waiting || !hadController) return false;
  if (!force && !inStartup() && !isHidden()) return false;
  asked = true;
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

function onControllerChange() {
  if (!hadController) return;            // first install: nothing old to replace
  if (asked || isHidden()) { reloadOnce(); return; }
  pendingReload = true;                  // someone is looking at this tab — wait until it is hidden
}

function watchInstalling(reg) {
  const sw = reg.installing;
  if (!sw) return;
  sw.addEventListener("statechange", () => { if (sw.state === "installed") activateWaiting(reg); });
}

export function registerAppSW() {
  if (!("serviceWorker" in navigator)) return;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", () => {
    if (isHidden()) {
      if (pendingReload) { pendingReload = false; reloadOnce(); return; }
      activateWaiting();
    } else if (registration) {
      registration.update().catch(() => { /* offline */ });
    }
  });
  navigator.serviceWorker.register(SW_URL, { scope: "/" }).then((reg) => {
    registration = reg;
    reg.addEventListener("updatefound", () => watchInstalling(reg));
    watchInstalling(reg);
    activateWaiting(reg);                // a version that was already waiting at start-up
    setInterval(() => { reg.update().catch(() => { /* offline */ }); }, CHECK_EVERY_MS);
  }).catch((e) => console.warn("[sw] register failed:", e && e.message));
}

// For LearnBounce: the page is showing the app where /learn should be — make sure the newest
// version is in control, then reload once. Resolves true if a reload was started.
export async function takeOverAndReload() {
  if (!("serviceWorker" in navigator)) return false;
  let reg = registration;
  try { reg = reg || (await navigator.serviceWorker.getRegistration("/")); } catch { reg = null; }
  if (!reg) return false;
  if (!reg.waiting) {
    try { await reg.update(); } catch { /* offline */ }
    if (reg.installing) {
      await new Promise((res) => {
        const sw = reg.installing;
        const done = () => { if (sw.state !== "installing") res(); };
        sw.addEventListener("statechange", done);
        setTimeout(res, 8000);
      });
    }
  }
  if (reg.waiting && activateWaiting(reg, { force: true })) {
    const took = await new Promise((res) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => res(true), { once: true });
      setTimeout(() => res(false), 5000);
    });
    // onControllerChange already reloads (asked = true); this covers a page that had no controller.
    if (!took) return reloadOnce();
    return true;
  }
  return reloadOnce();
}
