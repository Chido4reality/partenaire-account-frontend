import { useEffect, useState } from "react";
import { useLangStore } from "../store";
import { subscribeUpdate, applyUpdateNow } from "../utils/swTakeover";
import { isNative, requestsInFlight } from "../utils/appUpdate";

// APP UPDATE (2026-10-21) — web only. A new version of the web app is ready for this tab and nobody let
// it reload on its own (someone is using the tab: a cart, a request, or simply past the first 15 s).
// "Reload" applies it now: it waits for requests in flight to finish (up to 10 s) so a sale being sent
// is never cut off. The POS cart is the persisted draft and comes back after the reload; the offline
// queue lives in IndexedDB. Rules for the AUTOMATIC reload are in utils/swTakeover.
export default function WebUpdateBanner() {
  const lang = useLangStore((s) => s.lang);
  const fr = lang === "fr";
  const [available, setAvailable] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => (isNative() ? undefined : subscribeUpdate(setAvailable)), []);

  if (isNative() || !available) return null;

  const reload = async () => {
    if (applying) return;
    setApplying(true);
    for (let i = 0; i < 20 && requestsInFlight() > 0; i++) await new Promise((r) => setTimeout(r, 500));
    applyUpdateNow();
  };

  return (
    <div role="status" data-web-update-banner="" style={{
      position: "fixed", left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", zIndex: 94000,
      maxWidth: 520, margin: "0 auto", background: "#152B52", color: "#fff", borderRadius: 14,
      padding: "12px 14px", boxShadow: "0 10px 30px rgba(0,0,0,.35)", display: "flex", alignItems: "center",
      gap: 12, flexWrap: "wrap", justifyContent: "space-between",
    }}>
      <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>
        {fr ? "Nouvelle version disponible" : "New version available"}
      </span>
      <button type="button" onClick={reload} disabled={applying} style={{
        background: "#FBC503", color: "#152B52", border: "none", borderRadius: 10, padding: "8px 16px",
        fontWeight: 800, fontSize: 14, cursor: applying ? "default" : "pointer", opacity: applying ? 0.7 : 1,
      }}>
        {applying ? (fr ? "Rechargement…" : "Reloading…") : (fr ? "Recharger" : "Reload")}
      </button>
    </div>
  );
}
