// SW TAKEOVER (2026-10-18; update banner 2026-10-21): how a new web version replaces the running one.
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
//   • an AUTOMATIC reload happens only when nobody can lose anything:
//       – the tab is in the background (hidden) and no request is in flight, or
//       – during the first 15 s after the page started, the POS cart is empty and no request is in
//         flight (setBusyCheck — utils/appUpdate decides what "busy" means);
//   • otherwise a tab someone is looking at gets the "New version available — Reload" banner
//     (components/WebUpdateBanner) and reloads when the user taps it, or the next time it is hidden;
//   • at most ONE automatic reload per tab per minute (sessionStorage), so a version that keeps
//     changing can never loop the page. A tap on Reload is not limited — the user asked for it.
// The offline queue (IndexedDB) and the POS cart (persisted draft) both survive a reload; nothing here
// touches either.
// Native (Capacitor) never registers a service worker — see main.jsx — so none of this runs in the app.

const SW_URL = "/sw.js";
const STARTUP_MS = 15 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const RELOAD_KEY = "mp-sw-takeover-reload-at";
const LOOP_MS = 60 * 1000;

const startedAt = Date.now();
let hadController = false;   // a version was already running this page → a takeover is an UPDATE
let asked = false;           // this tab told the waiting version to take over
let userAsked = false;       // …because the user tapped Reload
let pendingReload = false;   // took over while someone was using the tab → reload when hidden or tapped
let registration = null;

// Busy = a sale in the cart or a request in flight. Set by utils/appUpdate; until then, assume busy
// (never reload a visible tab on a guess).
let busyCheck = () => ({ cart: true, inFlight: 0 });
export function setBusyCheck(fn) { if (typeof fn === "function") busyCheck = fn; }
const busy = () => { try { return busyCheck() || { cart: true, inFlight: 0 }; } catch { return { cart: true, inFlight: 0 }; } };

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const inStartup = () => Date.now() - startedAt < STARTUP_MS;
const freeToReloadVisible = () => { const b = busy(); return !b.cart && !b.inFlight; };

// The banner's state: a new version is ready for this tab.
const listeners = new Set();
let available = false;
function setAvailable(v) {
  if (available === v) return;
  available = v;
  listeners.forEach((cb) => { try { cb(v); } catch { /* a listener must not break the others */ } });
}
export function subscribeUpdate(cb) { listeners.add(cb); cb(available); return () => listeners.delete(cb); }
function refreshAvailable() { setAvailable(!!(hadController && ((registration && registration.waiting) || pendingReload))); }

// Reload once; refuses (returns false) if this tab already auto-reloaded within the last minute.
export function reloadOnce() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* storage off */ }
  if (Date.now() - last < LOOP_MS) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage off: still once per page */ }
  window.location.reload();
  return true;
}

// A hidden tab reloads once its requests have finished (up to 30 s; then it waits for the next hide).
function reloadWhenIdleHidden(triesLeft = 15) {
  if (!isHidden()) { pendingReload = true; refreshAvailable(); return; }
  if (busy().inFlight && triesLeft > 0) { setTimeout(() => reloadWhenIdleHidden(triesLeft - 1), 2000); return; }
  if (busy().inFlight) { pendingReload = true; refreshAvailable(); return; }
  if (!reloadOnce()) { pendingReload = true; refreshAvailable(); }
}

// Tell a waiting version to take over. `force` = the caller knows nobody is mid-task (LearnBounce, or
// the user tapped Reload).
export function activateWaiting(reg = registration, { force = false } = {}) {
  if (!reg || !reg.waiting || !hadController) return false;
  if (!force && !isHidden() && !(inStartup() && freeToReloadVisible())) { refreshAvailable(); return false; }
  asked = true;
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

function onControllerChange() {
  // First control of a tab that started uncontrolled (first visit, or a reload that raced an
  // activation): nothing old to replace — but from now on a new version IS an update for this tab.
  if (!hadController) { hadController = true; refreshAvailable(); return; }
  if (userAsked) { window.location.reload(); return; }
  if (isHidden()) { reloadWhenIdleHidden(); return; }
  if (asked && freeToReloadVisible() && reloadOnce()) return;
  pendingReload = true;                  // someone is using this tab — banner, or reload when hidden
  refreshAvailable();
}

function watchInstalling(reg) {
  const sw = reg.installing;
  if (!sw) return;
  sw.addEventListener("statechange", () => { if (sw.state === "installed") activateWaiting(reg); refreshAvailable(); });
}

// The banner's Reload button.
export function applyUpdateNow() {
  userAsked = true;
  if (registration && registration.waiting && hadController) {
    asked = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => window.location.reload(), 5000);   // in case controllerchange never comes
    return;
  }
  window.location.reload();
}

export function registerAppSW() {
  if (!("serviceWorker" in navigator)) return;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", () => {
    if (isHidden()) {
      if (pendingReload) { pendingReload = false; reloadWhenIdleHidden(); return; }
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
    refreshAvailable();
    // The app's own start-up requests are usually still in flight at this moment, so keep trying
    // once a second for the rest of the start-up window (cart and requests re-checked each time).
    const retry = setInterval(() => {
      if (!inStartup() || asked || !reg.waiting) { clearInterval(retry); return; }
      activateWaiting(reg);
    }, 1000);
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
    if (!took) return reloadOnce();
    return true;
  }
  return reloadOnce();
}
