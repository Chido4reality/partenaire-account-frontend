// MP-PUSH — informational only. Settings → Account.
//
// THIS COMPONENT MAKES NO NATIVE CALLS AND HAS NO CONTROLS.
//
// Every hang this feature produced lived in a native bridge call sitting behind a button
// users could tap: createChannel stalling inside bindListeners, register() after a revoke
// never re-firing `registration`, then unregister() itself. Each fix surfaced the next,
// because the fault was not any individual call — it was putting the plugin's
// register/unregister lifecycle behind a toggle at all.
//
// So: the token registers ONCE when permission is granted and is never unregistered, and
// alerts are managed where every other Android app manages them — the OS notification
// settings. Nothing here can hang, because nothing here does anything.
import { useEffect, useState } from "react";
import { canUsePush, pushStatus } from "../../utils/push";

export default function PushAlertsCard({ lang }) {
  const en = lang === "en";
  const [status, setStatus] = useState(null);

  // Re-read on mount and whenever the screen regains focus — which is exactly what
  // happens on returning from Android's notification settings, so the status reflects a
  // change the user just made there. A plain GET; no bridge involved.
  useEffect(() => {
    if (!canUsePush()) return;
    const load = async () => setStatus(await pushStatus());
    load();
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Web build: push doesn't exist here, so claiming it would be a lie.
  if (!canUsePush()) return null;

  const registered = (status?.my_live_devices || 0) > 0 && status?.push_configured;

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          🔔 {en ? "Lock-screen alerts" : "Alertes sur l'écran verrouillé"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700,
          color: registered ? "#10b981" : "var(--text-muted)" }}>
          {registered ? (en ? "ON" : "ACTIVÉ") : (en ? "OFF" : "DÉSACTIVÉ")}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {en
          ? "Approvals, risky staff actions and the end-of-day summary arrive on your phone even when the app is closed. Low-stock alerts stay in the app only."
          : "Les approbations, les actions à risque du personnel et le résumé du jour arrivent sur votre téléphone même quand l'application est fermée. Les alertes de stock bas restent dans l'application."}
      </div>

      {status && !status.push_configured ? (
        // Not the user's fault and nothing they can do — say so rather than imply they
        // have a setting to find.
        <div style={{ fontSize: 12.5, color: "#fbbf24", background: "rgba(251,191,36,0.10)",
          border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, padding: "9px 11px", marginTop: 10 }}>
          {en ? "Alerts aren't available yet on this server."
              : "Les alertes ne sont pas encore disponibles sur ce serveur."}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.55 }}>
          {en
            ? "To turn alerts off or back on, use your phone's own settings: press and hold a notification, or open Settings → Apps → Mon Partenaire Dozie → Notifications."
            : "Pour désactiver ou réactiver les alertes, utilisez les réglages de votre téléphone : appuyez longuement sur une notification, ou ouvrez Paramètres → Applications → Mon Partenaire Dozie → Notifications."}
        </div>
      )}
    </div>
  );
}
