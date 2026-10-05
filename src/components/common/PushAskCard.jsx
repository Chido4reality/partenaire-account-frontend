// MP-PUSH-ASK — our own card, shown BEFORE Android's permission dialog (see utils/pushAsk.js).
//
// The line that matters most is "Android va vous demander l'autorisation : appuyez sur
// « Autoriser »": it turns the system dialog from a surprise into an expected step.
//
// PushAskCardView is props-only at module scope so the render guard can mount it under
// renderToString (useEffect never runs there). PushAskHost is the stateful part, mounted
// once in Layout: it listens for ask-moments and decides whether to show anything.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MOMENT_EVENT, evaluateMoment, putOff, sayYes, recheck, classify } from "../../utils/pushAsk";
import { hasNativeSettings, openNotificationSettings } from "../../utils/notifSettings";

const HINT = {
  fr: "Android va vous demander l'autorisation : appuyez sur « Autoriser ».",
  en: "Android will ask for permission next: tap “Allow”.",
};

export const COPY = {
  owner: {
    fr: { title: "Soyez prévenu sur votre téléphone",
          body: "Quand un employé vous demande l'accord pour annuler une vente, faire une remise ou vendre à crédit, vous le savez tout de suite — même si l'application est fermée.",
          digest: "Et le soir, le résumé de la journée.", hint: HINT.fr, yes: "Oui, me prévenir", later: "Plus tard" },
    en: { title: "Get alerts on your phone",
          body: "When a staff member asks you to approve a cancelled sale, a discount or a credit sale, you'll know straight away — even with the app closed.",
          digest: "And the day's summary every evening.", hint: HINT.en, yes: "Yes, alert me", later: "Not now" },
  },
  manager: {
    fr: { title: "Soyez prévenu sur votre téléphone",
          body: "Les demandes de vos vendeurs arrivent tout de suite, et vous savez dès que le patron répond aux vôtres — même application fermée.",
          hint: HINT.fr, yes: "Oui, me prévenir", later: "Plus tard" },
    en: { title: "Get alerts on your phone",
          body: "Your cashiers' requests reach you straight away, and you'll know as soon as the boss answers yours — even with the app closed.",
          hint: HINT.en, yes: "Yes, alert me", later: "Not now" },
  },
  // vc114 app_update moment: a cashier / warehouse user who already uses the app daily.
  staff: {
    fr: { title: "Soyez prévenu sur votre téléphone",
          body: "Vous savez tout de suite quand le patron répond à vos demandes — même si l'application est fermée.",
          hint: HINT.fr, yes: "Oui, me prévenir", later: "Plus tard" },
    en: { title: "Get alerts on your phone",
          body: "You'll know as soon as the boss answers your requests — even with the app closed.",
          hint: HINT.en, yes: "Yes, alert me", later: "Not now" },
  },
  staff_request: {
    fr: { title: "Demande envoyée au patron",
          body: "Voulez-vous être prévenu sur votre téléphone dès qu'il répond, même si l'application est fermée ?",
          hint: HINT.fr, yes: "Oui, me prévenir", later: "Non merci" },
    en: { title: "Request sent to the owner",
          body: "Want an alert on your phone as soon as they answer, even with the app closed?",
          hint: HINT.en, yes: "Yes, alert me", later: "No thanks" },
  },
  refused_once: {
    fr: { title: "Vous avez refusé les alertes une fois",
          body: "Android ne vous le demandera qu'une seule fois encore. Si vous refusez à nouveau, il faudra passer par les réglages du téléphone.",
          hint: HINT.fr, yes: "Autoriser maintenant", later: "Plus tard" },
    en: { title: "You turned alerts down once",
          body: "Android will only ask one more time. If you refuse again, you'll have to turn them on in your phone's settings.",
          hint: HINT.en, yes: "Allow now", later: "Not now" },
  },
  blocked: {
    fr: { title: "Les alertes sont coupées sur ce téléphone",
          intro: "Pour les remettre :",
          steps: ["Ouvrez Paramètres", "Applications (parfois « Gestion des applications »)", "Stenamo Book", "Notifications → activez."],
          alt: "Ou : appuyez longuement sur une notification de Stenamo Book.",
          maybe: "Il se peut qu'Android vous redemande : touchez « Réessayer ».",
          channel: "C'est la catégorie « Alertes / Alerts » de Stenamo Book qui est coupée.",
          open: "Ouvrir les réglages", check: "J'ai activé — vérifier", retry: "Réessayer", later: "Plus tard" },
    en: { title: "Alerts are off on this phone",
          intro: "To turn them back on:",
          steps: ["Open Settings", "Apps (sometimes “App management”)", "Stenamo Book", "Notifications → turn on."],
          alt: "Or: press and hold a Stenamo Book notification.",
          maybe: "Android may still ask you: tap “Try again”.",
          channel: "It's Stenamo Book's “Alertes / Alerts” category that is off.",
          open: "Open settings", check: "I've turned it on — check", retry: "Try again", later: "Not now" },
  },
};

// The guidance block on its own — the Settings card reuses it.
export function BlockedSteps({ lang, maybeNotBlocked, channelBlocked }) {
  const c = COPY.blocked[lang === "en" ? "en" : "fr"];
  return (
    <div data-push-blocked-steps style={{ fontSize: 13, lineHeight: 1.6 }}>
      {channelBlocked && <div style={{ marginBottom: 6 }}>{c.channel}</div>}
      <div>{c.intro}</div>
      <ol style={{ margin: "4px 0 6px", paddingLeft: 20 }}>
        {c.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <div style={{ color: "var(--text-muted)" }}>{c.alt}</div>
      {maybeNotBlocked && <div style={{ marginTop: 6 }}>{c.maybe}</div>}
    </div>
  );
}

// Blocked buttons (vc114): "Ouvrir les réglages" first when the native plugin is there;
// "Réessayer" only when Android might still show its dialog — never when permission is
// already granted and it is the phone's switch (osOff) that is off, where it would do nothing.
export function PushAskCardView({ variant, lang, hasDigest, maybeNotBlocked, osOff, channelBlocked, canOpenSettings,
  busy, onYes, onLater, onCheck, onOpenSettings }) {
  const L = lang === "en" ? "en" : "fr";
  const c = COPY[variant]?.[L];
  if (!c) return null;
  const btn = { flex: 1, minHeight: 44 };
  return (
    <div data-push-ask={variant} role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 440, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)",
        borderRadius: 16, padding: "18px 18px 16px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>🔔 {c.title}</div>
        {variant === "blocked" ? (
          <BlockedSteps lang={L} maybeNotBlocked={maybeNotBlocked && !osOff} channelBlocked={channelBlocked} />
        ) : (
          <>
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>{c.body}</div>
            {variant === "owner" && hasDigest && <div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 4 }}>{c.digest}</div>}
            <div data-push-hint style={{ fontSize: 13, marginTop: 10, padding: "8px 10px", borderRadius: 8,
              background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.30)" }}>{c.hint}</div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {variant === "blocked" ? (
            <>
              {canOpenSettings && (
                <button className="btn btn-primary" style={{ ...btn, flexBasis: "100%" }} disabled={busy} onClick={onOpenSettings}>{c.open}</button>
              )}
              <button className={canOpenSettings ? "btn btn-secondary" : "btn btn-primary"} style={btn} disabled={busy} onClick={onCheck}>{c.check}</button>
              {!osOff && <button className="btn btn-secondary" style={btn} disabled={busy} onClick={onYes}>{c.retry}</button>}
              <button className="btn btn-secondary" style={{ ...btn, flexBasis: "100%" }} disabled={busy} onClick={onLater}>{c.later}</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" style={btn} disabled={busy} onClick={onLater}>{c.later}</button>
              <button className="btn btn-primary" style={btn} disabled={busy} onClick={onYes}>{c.yes}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PushAskHost({ role, lang, hasDigest }) {
  const [card, setCard] = useState(null);   // { variant, maybeNotBlocked, osOff, channelBlocked }
  const [busy, setBusy] = useState(false);
  const en = lang === "en";

  useEffect(() => {
    const onMoment = async (e) => {
      try {
        const d = await evaluateMoment(e?.detail?.moment, role);
        if (d.show) setCard({ variant: d.variant, maybeNotBlocked: !!d.maybeNotBlocked, osOff: !!d.osOff, channelBlocked: !!d.channelBlocked });
      } catch { /* an ask must never break the screen it sits on */ }
    };
    window.addEventListener(MOMENT_EVENT, onMoment);
    return () => window.removeEventListener(MOMENT_EVENT, onMoment);
  }, [role]);

  // Coming back from Android's settings (opened by the button below): re-read and close the
  // card if alerts are now on, so the user is not asked to press "vérifier" for what they did.
  useEffect(() => {
    if (card?.variant !== "blocked") return;
    const onBack = async () => {
      if (document.hidden) return;
      const { receive, store } = await recheck();
      if (classify(receive, store).state === "active") { setCard(null); toast.success(en ? "Alerts on." : "Alertes activées."); }
    };
    document.addEventListener("visibilitychange", onBack);
    return () => document.removeEventListener("visibilitychange", onBack);
  }, [card?.variant, en]);

  if (!card) return null;
  const close = () => setCard(null);
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <PushAskCardView
      variant={card.variant} lang={lang} hasDigest={hasDigest} maybeNotBlocked={card.maybeNotBlocked}
      osOff={card.osOff} channelBlocked={card.channelBlocked} canOpenSettings={hasNativeSettings()} busy={busy}
      onLater={() => run(async () => { await putOff(); close(); })}
      onYes={() => run(async () => {
        const out = await sayYes();
        if (out === "os_off") { setCard({ variant: "blocked", osOff: true, maybeNotBlocked: false, channelBlocked: card.channelBlocked }); return; }
        close();
        if (out === "granted") toast.success(en ? "Alerts on." : "Alertes activées.");
        else if (out !== "not_granted") toast.error(en ? "Alerts could not be turned on — see Settings." : "Impossible d'activer les alertes — voir Paramètres.");
      })}
      onOpenSettings={() => run(async () => { await openNotificationSettings(card.channelBlocked ? "channel" : "app"); })}
      onCheck={() => run(async () => {
        const { receive, store } = await recheck();
        if (classify(receive, store).state === "active") { close(); toast.success(en ? "Alerts on." : "Alertes activées."); }
        else toast(en ? "Still off on this phone." : "Toujours coupées sur ce téléphone.", { icon: "🔕" });
      })}
    />
  );
}
