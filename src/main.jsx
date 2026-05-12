import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Register the service worker immediately (don't wait for load event)
registerSW({ immediate: true });

// Relay SW messages to the app as CustomEvents so any component can listen
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", ({ data }) => {
    if (data?.type === "SYNC_COMPLETE") {
      window.dispatchEvent(new CustomEvent("sw-sync-complete", { detail: data }));
    }
    if (data?.type === "SALE_SAVED_OFFLINE") {
      window.dispatchEvent(new CustomEvent("sw-sale-offline", { detail: data }));
    }
  });
}
