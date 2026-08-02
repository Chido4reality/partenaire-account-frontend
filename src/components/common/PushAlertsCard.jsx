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
import toast from "react-hot-toast";
import { canUsePush, pushStatus, lastRegistrationOutcome, promptIfSensible } from "../../utils/push";

// Plain-language explanation of what the last login attempt hit. The point is that a
// failure to register must be READABLE without a debugger, a diagnostics table, or
// another instrumented build.
const outcomeDetail = (o) => (o && typeof o.detail === "string" ? o.detail.split(":").pop().trim() : "");

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
      return en ? "Permission is allowed, but the phone didn't return a notification token. Check the internet connection, then tap Retry."
                : "L'autorisation est accordée, mais le téléphone n'a pas renvoyé de jeton. Vérifiez la connexion, puis touchez Réessayer.";
    case "server_rejected":
      return (en ? "The phone produced a token but the server refused it" : "Le téléphone a produit un jeton mais le serveur l'a refusé")
        + (outcomeDetail(o) ? ` (${outcomeDetail(o)})` : "")
        + (en ? ". Check the connection and tap Retry." : ". Vérifiez la connexion et touchez Réessayer.");
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
  const [retrying, setRetrying] = useState(false);
  // Held in state, not read during render: the outcome is written by the login flow AFTER
  // this card may already have mounted, and a plain localStorage read would never refresh.
  const [outcome, setOutcome] = useState(() => lastRegistrationOutcome());

  // Re-read on mount and whenever the screen regains focus — which is exactly what
  // happens on returning from Android's notification settings, so the status reflects a
  // change the user just made there. A plain GET; no bridge involved.
  useEffect(() => {
    if (!canUsePush()) return;
    const load = async () => { setStatus(await pushStatus()); setOutcome(lastRegistrationOutcome()); };
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

  // `unknown` = the status read timed out. Deliberately NOT folded into "OFF": telling
  // someone their alerts are off when we simply couldn't reach the server is the kind of
  // small lie that sends them into Android settings to fix nothing.
  const unknown = !!status?.unknown;
  const registered = (status?.my_live_devices || 0) > 0 && status?.push_configured;
  const reason = explainOutcome(outcome, en);

  const retry = async () => {
    setRetrying(true);
    try {
      // force:true — an explicit press must always attempt, even if the automatic ask
      // already ran this session. promptIfSensible now arms the token waiter BEFORE
      // register() and awaits the real completion itself, so there is nothing left to
      // wait for here — and no window in which the token can land unheard.
      const r = await promptIfSensible({ force: true });
      setOutcome(lastRegistrationOutcome());
      const s = await pushStatus();
      setStatus(s);
      // r === "granted" already means the server ACKed the token, so trust it even when
      // the follow-up status read times out — otherwise a slow link turns a success into
      // a "still not registered" error message.
      if ((s?.my_live_devices || 0) > 0 || r === "granted") {
        toast.success(en ? "Alerts on." : "Alertes activées.");
      } else if (r === "denied") {
        toast.error(en
          ? "Your phone is blocking notifications. Allow them in Settings → Apps → Mon Partenaire Dozie → Notifications."
          : "Votre téléphone bloque les notifications. Autorisez-les dans Paramètres → Applications → Mon Partenaire Dozie → Notifications.");
      } else {
        toast.error(en ? "Still not registered — see the note below." : "Toujours pas enregistré — voir la note ci-dessous.");
      }
    } finally { setRetrying(false); }
  };

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          🔔 {en ? "Lock-screen alerts" : "Alertes sur l'écran verrouillé"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700,
          color: registered ? "#10b981" : "var(--text-muted)" }}>
          {registered ? (en ? "ON" : "ACTIVÉ")
            : unknown ? (en ? "—" : "—")
            : (en ? "OFF" : "DÉSACTIVÉ")}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {en
          ? "Approvals, risky staff actions and the end-of-day summary arrive on your phone even when the app is closed. Low-stock alerts stay in the app only."
          : "Les approbations, les actions à risque du personnel et le résumé du jour arrivent sur votre téléphone même quand l'application est fermée. Les alertes de stock bas restent dans l'application."}
      </div>

      {unknown ? (
        // The status read timed out (time-boxed at 8s — it used to be able to hang for
        // over a minute). Say so plainly instead of showing a confident OFF.
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.55 }}>
          {en ? "Couldn't check the alert status just now — connection too slow. It will refresh when you come back to this screen."
              : "Impossible de vérifier l'état des alertes — connexion trop lente. Cela se mettra à jour en revenant sur cet écran."}
        </div>
      ) : status && !status.push_configured ? (
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

      {/* RETRY — the only control, and only when something is wrong.
          This is NOT the old on/off toggle: it can only ever ADD a registration, never
          unregister, so it cannot reproduce the register/unregister cycling that caused
          every previous hang. Every call inside it is time-boxed. Without it, a user whose
          registration failed once had no way back except logging out and in — a dead end
          for anyone who doesn't know that trick. */}
      {!registered && (status?.push_configured || unknown) && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={retrying} onClick={retry}>
            {retrying ? (en ? "Trying…" : "Tentative…") : (en ? "Turn on alerts / Retry" : "Activer les alertes / Réessayer")}
          </button>
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
