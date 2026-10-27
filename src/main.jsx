import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerAppSW } from "./utils/swTakeover";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

// MP-BLANK-SCREEN-FIX: the boot self-heal in index.html is capped by TIME (one automatic
// reload per tab per minute). Mounting must NOT reset that cap (2026-10-27): it used to clear
// a counter here, so a chunk that failed after mount reloaded the tab every ~1.5 s, forever.
// The cap expires on its own after 60 s of clean running. Only the old counter is dropped.
try { sessionStorage.removeItem("mp-boot-reloads"); } catch { /* private mode — legacy key from before 2026-10-27 */ }

// MP-SW-LIFECYCLE (3 Jun): the PWA service worker is REDUNDANT on native
// (Capacitor serves the app shell from the local APK bundle) and was the
// root cause of the "-0157 offline broken" stale-install P0 — an older
// build's workbox precache lingered across APK upgrades because the old
// retire-shim's unregister() never cleared Cache Storage, so a stale JS
// shell kept being served. Deterministic fix:
//   • NATIVE: never register the SW. On every boot, unregister any leftover
//     app SW AND delete all caches → self-heals existing bad installs with
//     NO uninstall required. The admin SW (/sw-admin.js, /admin.html scope)
//     is left alone.
//   • WEB/PWA: register (utils/swTakeover — when a new version takes over and when tabs
//     reload) — this is Paul's offline-launch path and still needs the shell precache.
const _isNative = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
if (_isNative) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (const r of regs) {
        const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
        if (!url.endsWith("/sw-admin.js")) r.unregister().catch(() => { /* best-effort */ });
      }
    }).catch(() => { /* nothing to clean up */ });
    // Nuke leftover workbox precache so a stale shell can't be served. Skip
    // any admin-scoped cache. Self-healing — runs harmlessly once empty.
    if (typeof caches !== "undefined" && caches.keys) {
      caches.keys().then(keys => keys.forEach(k => {
        if (!/admin/i.test(k)) caches.delete(k).catch(() => {});
      })).catch(() => {});
    }
  }
} else {
  registerAppSW();
}
