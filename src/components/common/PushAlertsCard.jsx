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
import { canUsePush, pushStatus, lastRegistrationOutcome } from "../../utils/push";

// Plain-language explanation of what the last login attempt hit. The point is that a
// failure to register must be READABLE without a debugger, a diagnostics table, or
// another instrumented build.
function explainOutcome(o, en) {
  if (!o) return null;
  switch (o.outcome) {
    case "granted":
      return null; // registered — the ON badge already says so
    case "blocked":
      return en
        ? "Your phone is blocking notifications for this app. Open Settings → Apps → Mon Partenaire Dozie → Notifications and allow them, then log out and back in."
        : "Votre téléphone bloque les notifications pour cette application. Ouvrez Paramètres → Applications → Mon Partenaire Dozie → Notifications, autorisez-les, puis déconnectez-vous et reconnectez-vous.";
    case "denied":
      return en ? "Notification permission was refused. Allow it in your phone's settings, then log out and back in."
                : "L'autorisation a été refusée. Autorisez-la dans les réglages du téléphone, puis reconnectez-vous.";
    case "no_token":
      return en ? "Permission is allowed, but the phone didn't return a notification token. Check the internet connection and log out and back in."
                : "L'autorisation est accordée, mais le téléphone n'a pas renvoyé de jeton. Vérifiez la connexion et reconnectez-vous.";
    case "register_failed":
      return en ? "Registration failed on this phone. Log out and back in; if it persists, tell support."
                : "L'enregistrement a échoué. Reconnectez-vous ; si cela persiste, signalez-le.";
    case "unavailable":
      return en ? "Alerts aren't available on this device." : "Alertes indisponibles sur cet appareil.";
    default:
      return null;
  }
}

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
  const outcome = lastRegistrationOutcome();
  const reason = explainOutcome(outcome, en);

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

      {/* Why this phone isn't registered, in plain words. Only shown when it isn't. */}
      {!registered && reason && (
        <div style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 10, padding: "9px 11px", borderRadius: 8,
          color: "#fbbf24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)" }}>
          {reason}
          {outcome?.at && (
            <div style={{ opacity: 0.7, marginTop: 4 }}>
              {(en ? "Last check: " : "Dernière vérification : ") +
                new Date(outcome.at).toLocaleString(en ? "en-GB" : "fr-FR",
                  { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {outcome.outcome ? ` · ${outcome.outcome}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
