import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

// MP-SLICE-3-RETIRE-LEGACY-SERVICE-WORKER: clean up any leftover MP service
// worker registered by a previous version of the app. The legacy SW had its
// own offline queue using IndexedDB and was intercepting POST /api/sales
// before the axios adapter could run; Slice 3 supersedes both behaviours.
// Returning visitors carry the old SW until something unregisters it — this
// shim does so on every load (no-op once the registrations array is empty).
// Scope: only the MP SW (scriptURL ending in /sw.js) is unregistered. The
// admin portal SW (/sw-admin.js, scoped to /admin.html) is left alone.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const r of regs) {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url && !url.endsWith("/sw-admin.js")) {
        r.unregister().catch(() => { /* best-effort */ });
      }
    }
  }).catch(() => { /* getRegistrations rejected — nothing to clean up */ });
}
