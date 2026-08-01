// MP-PUSH — the user-facing state of lock-screen alerts, on Settings → Account.
//
// Exists for the DECLINE path. Android treats a denied notification permission as
// final: the OS refuses to show the dialog again, so an app that only asks in-flow
// leaves the user permanently stuck with no explanation and no way back. This screen
// is that way back — it says plainly whether alerts are on, lets them turn them on if
// the prompt was never answered, and otherwise tells them exactly where in System
// Settings to fix it. We do NOT deep-link: that needs another native plugin, and a
// button that silently does nothing is worse than clear instructions.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { canUsePush, promptIfSensible, pushStatus, waitForRegistration } from "../../utils/push";

export default function PushAlertsCard({ lang }) {
  const en = lang === "en";
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => setStatus(await pushStatus());
  useEffect(() => { if (canUsePush()) load(); }, []);

  // Web build: push doesn't exist here, so promising it would be a lie.
  if (!canUsePush()) return null;

  const on = (status?.my_live_devices || 0) > 0 && status?.push_configured;

  const enable = async () => {
    setBusy(true);
    // force: this is an explicit request, so it must always attempt the prompt even if
    // the automatic contextual ask already fired earlier in the session.
    const r = await promptIfSensible({ force: true });
    // Registration completes asynchronously; without this the status re-read races it
    // and the card reports OFF on a successful enable.
    if (r === "granted") await waitForRegistration();
    await load();
    setBusy(false);

    if (r === "granted") toast.success(en ? "Alerts on." : "Alertes activées.");
    else if (r === "denied") {
      toast.error(en
        ? "Android is blocking alerts for this app. Open Settings → Apps → Mon Partenaire Dozie → Notifications and allow them."
        : "Android bloque les alertes. Ouvrez Paramètres → Applications → Mon Partenaire Dozie → Notifications et autorisez-les.");
    } else {
      // 'unavailable' (not a native build / plugin missing) — never leave the tap silent.
      toast.error(en ? "Alerts aren't available on this device." : "Alertes indisponibles sur cet appareil.");
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api.post("/devices/test");
      toast.success(en
        ? "Test sent — lock your phone and watch for it."
        : "Test envoyé — verrouillez votre téléphone et regardez.");
    } catch {
      toast.error(en ? "Could not send the test." : "Impossible d'envoyer le test.");
    } finally { setTesting(false); }
  };

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          🔔 {en ? "Lock-screen alerts" : "Alertes sur l'écran verrouillé"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700,
          color: on ? "#10b981" : "var(--text-muted)" }}>
          {on ? (en ? "ON" : "ACTIVÉ") : (en ? "OFF" : "DÉSACTIVÉ")}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
        {en
          ? "Get approvals, risky staff actions and the end-of-day summary on your phone even when the app is closed. Low-stock alerts stay in the app only."
          : "Recevez les approbations, les actions à risque du personnel et le résumé du jour sur votre téléphone même quand l'application est fermée. Les alertes de stock bas restent dans l'application."}
      </div>

      {/* push_configured=false means the SERVER has no Firebase credentials — the user
          can do nothing about that, so say so honestly instead of offering a dead button. */}
      {status && !status.push_configured ? (
        <div style={{ fontSize: 12.5, color: "#fbbf24", background: "rgba(251,191,36,0.10)",
          border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, padding: "9px 11px" }}>
          {en ? "Alerts aren't available yet on this server."
              : "Les alertes ne sont pas encore disponibles sur ce serveur."}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!on && (
            <button className="btn btn-primary" disabled={busy} onClick={enable}>
              {busy ? "…" : (en ? "Turn on alerts" : "Activer les alertes")}
            </button>
          )}
          {on && (
            <button className="btn btn-secondary" disabled={testing} onClick={sendTest}>
              {testing ? "…" : (en ? "Send a test alert" : "Envoyer un test")}
            </button>
          )}
        </div>
      )}

      {status && status.push_configured && !on && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
          {en
            ? "If nothing happens when you tap, Android has already blocked alerts for this app. Open Settings → Apps → Mon Partenaire Dozie → Notifications and allow them."
            : "Si rien ne se passe, Android a déjà bloqué les alertes. Ouvrez Paramètres → Applications → Mon Partenaire Dozie → Notifications et autorisez-les."}
        </div>
      )}
    </div>
  );
}
