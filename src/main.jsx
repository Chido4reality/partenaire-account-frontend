import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Register service worker and relay sync messages to the app
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", ({ data }) => {
      if (data?.type === "SYNC_COMPLETE") {
        window.dispatchEvent(new CustomEvent("sw-sync-complete", { detail: data }));
      }
      if (data?.type === "SALE_SAVED_OFFLINE") {
        window.dispatchEvent(new CustomEvent("sw-sale-offline", { detail: data }));
      }
    });
  });
}
