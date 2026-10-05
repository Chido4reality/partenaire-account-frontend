// MP-PUSH — Settings → Account: THIS phone's alert state, honestly.
//
// MP-PUSH-ASK (2026-10-05): the badge used to read `my_live_devices > 0` — a SERVER count
// across all of the user's devices — so a phone with notifications off showed ON whenever
// another phone of theirs was live. It now reads THIS phone (checkPermissions, a read-only,
// time-boxed call) and shows one of four states: Activé · Pas encore demandé · Refusé une
// fois · Bloqué (plus "Non enregistré" when permission is granted but no token was stored).
//
// No register/unregister toggle, ever: every hang this feature produced lived in that
// lifecycle (createChannel, register-after-revoke, unregister). The buttons here can only
// ADD a registration, through the same time-boxed routine login uses, and the only one that
// can open Android's dialog is an explicit tap (askAndRegister). Alerts are switched off
// where every other Android app switches them off: the phone's notification settings.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { canUsePush, pushStatus, lastRegistrationOutcome, getStoredToken, askAndRegister } from "../../utils/push";
import { settingsBadge, sayYes, recheck, readPhoneState } from "../../utils/pushAsk";
import { hasNativeSettings, openNotificationSettings } from "../../utils/notifSettings";
import { readAsk } from "../../utils/pushAskStore";
import { BlockedSteps, COPY } from "./PushAskCard";

const BADGE = {
  active:       { fr: "ACTIVÉ",             en: "ON",              color: "#10b981" },
  unregistered: { fr: "NON ENREGISTRÉ",     en: "NOT REGISTERED",  color: "#fbbf24" },
  not_asked:    { fr: "PAS ENCORE DEMANDÉ", en: "NOT ASKED YET",   color: "var(--text-muted)" },
  refused_once: { fr: "REFUSÉ UNE FOIS",    en: "REFUSED ONCE",    color: "#fbbf24" },
  blocked:      { fr: "BLOQUÉ",             en: "BLOCKED",         color: "#ef4444" },
  unknown:      { fr: "—",                  en: "—",               color: "var(--text-muted)" },
};

const outcomeDetail = (o) => (o && typeof o.detail === "string" ? o.detail.split(":").pop().trim() : "");

// Why a GRANTED phone has no token. Only shown in the "unregistered" state — permission
// problems are the badge's job now, so nothing here can say "refused" about a swipe-away.
export function explainOutcome(o, en) {
  if (!o) return null;
  switch (o.outcome) {
    case "no_token":
      return en ? "Permission is allowed, but the phone didn't return a notification token. Check the internet connection, then tap Retry."
                : "L'autorisation est accordée, mais le téléphone n'a pas renvoyé de jeton. Vérifiez la connexion, puis touchez Réessayer.";
    case "server_rejected":
      return (en ? "The phone produced a token but the server refused it" : "Le téléphone a produit un jeton mais le serveur l'a refusé")
        + (outcomeDetail(o) ? ` (${outcomeDetail(o)})` : "")
        + (en ? ". Check the connection and tap Retry." : ". Vérifiez la connexion et touchez Réessayer.");
    case "register_failed":
      return en ? "Registration failed on this phone. Tap Retry; if it persists, tell support."
                : "L'enregistrement a échoué sur ce téléphone. Touchez Réessayer ; si cela persiste, signalez-le.";
    case "unavailable":
      return (en ? "Alerts aren't available on this device." : "Alertes indisponibles sur cet appareil.")
        + (o.detail ? ` (${o.detail})` : "");
    default:
      return null;
  }
}

// Props-only, module scope: the render guard mounts it under renderToString.
export function PushAlertsCardView({ lang, badge, maybeNotBlocked, osOff, channelBlocked, canOpenSettings, reason, serverOff,
  busy, onEnable, onCheck, onRetry, onOpenSettings }) {
  const en = lang === "en";
  const L = en ? "en" : "fr";
  const b = BADGE[badge] || BADGE.unknown;
  const note = { fontSize: 12.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.55 };
  const amber = { fontSize: 12, lineHeight: 1.55, marginTop: 10, padding: "9px 11px", borderRadius: 8,
    color: "#fbbf24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)" };
  const ask = badge === "refused_once" ? COPY.refused_once[L] : COPY.owner[L];

  return (
    <div data-push-settings={badge} style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>🔔 {en ? "Lock-screen alerts" : "Alertes sur l'écran verrouillé"}</span>
        <span data-push-badge style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: b.color }}>{b[L]}</span>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {en
          ? "Approvals, risky staff actions and the end-of-day summary arrive on this phone even when the app is closed. Low-stock alerts stay in the app only."
          : "Les approbations, les actions à risque du personnel et le résumé du jour arrivent sur ce téléphone même quand l'application est fermée. Les alertes de stock bas restent dans l'application."}
      </div>

      {serverOff && (
        <div style={amber}>{en ? "Alerts aren't available yet on this server." : "Les alertes ne sont pas encore disponibles sur ce serveur."}</div>
      )}

      {badge === "unknown" && (
        <div style={note}>{en ? "Couldn't read this phone's notification setting just now. It will refresh when you come back to this screen."
                              : "Impossible de lire le réglage des notifications de ce téléphone. Cela se mettra à jour en revenant sur cet écran."}</div>
      )}

      {(badge === "not_asked" || badge === "refused_once") && (
        <div style={{ marginTop: 10 }}>
          {badge === "refused_once" && <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>{ask.body}</div>}
          <div data-push-hint style={{ fontSize: 12.5, marginBottom: 8 }}>{ask.hint}</div>
          <button className="btn btn-primary" disabled={busy} onClick={onEnable}>
            {busy ? (en ? "Waiting…" : "Patientez…") : badge === "refused_once" ? ask.yes : (en ? "Turn on alerts" : "Activer les alertes")}
          </button>
        </div>
      )}

      {badge === "blocked" && (
        <div style={{ marginTop: 10 }}>
          <BlockedSteps lang={L} maybeNotBlocked={maybeNotBlocked && !osOff} channelBlocked={channelBlocked} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {canOpenSettings && (
              <button className="btn btn-primary" disabled={busy} onClick={onOpenSettings}>{COPY.blocked[L].open}</button>
            )}
            <button className={canOpenSettings ? "btn btn-secondary" : "btn btn-primary"} disabled={busy} onClick={onCheck}>{COPY.blocked[L].check}</button>
            {/* No retry when permission is granted and the phone's switch is what's off — it would do nothing. */}
            {!osOff && <button className="btn btn-secondary" disabled={busy} onClick={onEnable}>{COPY.blocked[L].retry}</button>}
          </div>
        </div>
      )}

      {badge === "unregistered" && (
        <>
          {reason && <div style={amber}>{reason}</div>}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={onRetry}>
              {busy ? (en ? "Trying…" : "Tentative…") : (en ? "Retry" : "Réessayer")}
            </button>
          </div>
        </>
      )}

      {badge === "active" && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.55 }}>
          {en
            ? "To turn alerts off, use your phone's own settings: press and hold a notification, or open Settings → Apps → Stenamo Book → Notifications."
            : "Pour couper les alertes, utilisez les réglages du téléphone : appuyez longuement sur une notification, ou ouvrez Paramètres → Applications → Stenamo Book → Notifications."}
        </div>
      )}
    </div>
  );
}

// What the card shows, from what it read. `status` is the server's /devices/status: only its
// push_configured flag is used — NEVER my_live_devices (another phone being live says
// nothing about this one).
export function deriveSettings({ receive, store, storedToken, status }) {
  return {
    ...settingsBadge({ receive, store, storedToken }),
    serverOff: !!status && !status.unknown && status.push_configured === false,
  };
}

export default function PushAlertsCard({ lang }) {
  const en = lang === "en";
  const [view, setView] = useState({ badge: "unknown" });
  const [serverOff, setServerOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    // receive = Capacitor's answer corrected by the phone's real state (vc114 native plugin).
    const [{ receive, native }, store, status] = await Promise.all([readPhoneState(), readAsk(), pushStatus()]);
    const d = deriveSettings({ receive, store, storedToken: getStoredToken(), status });
    setView({ ...d, channelBlocked: !!(native && native.channelBlocked) });
    setServerOff(d.serverOff);
  };

  // Re-read on mount and whenever the screen regains focus — exactly what happens on coming
  // back from Android's notification settings.
  useEffect(() => {
    if (!canUsePush()) return;
    load();
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Web build: push doesn't exist here, so claiming anything would be a lie.
  if (!canUsePush()) return null;

  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); await load(); } };
  const reason = view.badge === "unregistered" ? explainOutcome(lastRegistrationOutcome(), en) : null;

  return (
    <PushAlertsCardView
      lang={lang} badge={view.badge} maybeNotBlocked={view.maybeNotBlocked} reason={reason}
      osOff={view.osOff} channelBlocked={view.channelBlocked} canOpenSettings={hasNativeSettings()}
      serverOff={serverOff} busy={busy}
      onEnable={() => run(async () => {
        const out = await sayYes();
        if (out === "granted") toast.success(en ? "Alerts on." : "Alertes activées.");
      })}
      onOpenSettings={() => run(async () => { await openNotificationSettings(view.channelBlocked ? "channel" : "app"); })}
      onCheck={() => run(async () => { await recheck(); })}
      onRetry={() => run(async () => {
        // Permission is already granted here, so this opens no dialog — it re-runs registration.
        const out = await askAndRegister();
        if (out === "granted") toast.success(en ? "Alerts on." : "Alertes activées.");
      })}
    />
  );
}
