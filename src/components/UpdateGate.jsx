import { useCallback, useEffect, useRef, useState } from "react";
import { useLangStore } from "../store";
import {
  isNative, fetchVersionPolicy, decideAndroid, appVersionCode, playUpdateInfo,
  cartHasItems, pendingCount, reminderDue, markReminderShown,
} from "../utils/appUpdate";

// APP UPDATE (2026-10-21) — Android only (renders nothing on the web; see WebUpdateBanner).
// Checked at cold start and every time the app comes back to the foreground, against the server policy
// (GET /api/app/version-policy, pa_app_release_policy):
//   below the minimum  → "Update required", full screen, cannot be dismissed. Google Play's IMMEDIATE
//                        update when Play offers it; otherwise (sideloaded, no Play) our own screen with a
//                        Play Store button. If Play says there is NO update for this phone yet (staged
//                        rollout, Play delay), it is only the dismissible reminder — never strand a shop.
//   below the latest   → a reminder the user can close; Play's FLEXIBLE update (downloads in the
//                        background, then "Restart"). At most once every reminder_every_hours, and never
//                        while the POS cart has items.
// It never blocks offline, nor when the policy can't be read. While the required screen is up and the
// phone goes offline, it steps aside until the connection is back.
// A cart in progress is respected even for a required update: the screen waits until the cart is empty
// (re-checked every 20 s), at most 15 minutes, so a customer at the counter can still be served.
// Before updating, the screen shows the offline queue (read-only) and lets the normal sync send it. An
// update from Play keeps the app's data, so anything still queued is kept and sent afterwards.
const CART_GRACE_MS = 15 * 60 * 1000;

const T = {
  fr: {
    reqTitle: "Mise à jour requise",
    reqBody: "Cette version de Stenamo Book n'est plus prise en charge. Installez la mise à jour pour continuer.",
    update: "Mettre à jour",
    openStore: "Ouvrir le Play Store",
    sending: (n) => `Envoi de ${n} élément${n > 1 ? "s" : ""} en attente…`,
    allSent: "Toutes vos données sont envoyées.",
    kept: (n) => `Vos ${n} élément${n > 1 ? "s" : ""} en attente ${n > 1 ? "sont gardés et seront envoyés" : "est gardé et sera envoyé"} après la mise à jour — ne désinstallez pas l'application.`,
    remTitle: "Nouvelle version disponible",
    remBody: "Une mise à jour de Stenamo Book est prête.",
    later: "Plus tard",
    ready: "Mise à jour téléchargée",
    restart: "Redémarrer pour installer",
    finishSale: "Terminez d'abord la vente en cours.",
    playLag: "Si le Play Store ne propose pas encore la mise à jour, réessayez dans quelques heures.",
  },
  en: {
    reqTitle: "Update required",
    reqBody: "This version of Stenamo Book is no longer supported. Install the update to continue.",
    update: "Update now",
    openStore: "Open Play Store",
    sending: (n) => `Sending ${n} pending item${n > 1 ? "s" : ""}…`,
    allSent: "All your data has been sent.",
    kept: (n) => `Your ${n} pending item${n > 1 ? "s are" : " is"} kept and will be sent after the update — do not uninstall the app.`,
    remTitle: "New version available",
    remBody: "An update to Stenamo Book is ready.",
    later: "Later",
    ready: "Update downloaded",
    restart: "Restart to install",
    finishSale: "Finish the sale in progress first.",
    playLag: "If the Play Store doesn't show the update yet, try again in a few hours.",
  },
};

async function plugin() { return (await import("@capawesome/capacitor-app-update")).AppUpdate; }

export default function UpdateGate() {
  const lang = useLangStore((s) => s.lang);
  const t = T[lang === "fr" ? "fr" : "en"];
  // view: null | { kind: "required", play, note, storeUrl } | { kind: "reminder", play, note, storeUrl } | { kind: "downloaded" }
  const [view, setView] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [queue, setQueue] = useState(null);       // pending items, or null while unknown
  const [queueWaitDone, setQueueWaitDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const cartSince = useRef(0);
  const cartTimer = useRef(null);

  const check = useCallback(async () => {
    if (!isNative() || checking.current) return;
    checking.current = true;
    try {
      const policy = await fetchVersionPolicy();
      if (!policy) return;                                  // offline / 503 / no policy → never block
      const vc = await appVersionCode();
      let decision = decideAndroid(vc, policy);
      if (decision === "none") { setView((v) => (v && v.kind === "downloaded" ? v : null)); return; }
      const play = await playUpdateInfo();
      if (decision === "required" && play.status === "not_available") decision = "reminder";
      const base = { play, note: (lang === "fr" ? policy.note_fr : policy.note_en) || null, storeUrl: policy.store_url };
      if (decision === "required") {
        if (cartHasItems()) {
          if (!cartSince.current) cartSince.current = Date.now();
          if (Date.now() - cartSince.current < CART_GRACE_MS) {
            clearTimeout(cartTimer.current);
            cartTimer.current = setTimeout(() => { check(); }, 20000);
            return;
          }
        }
        cartSince.current = 0;
        setView({ kind: "required", ...base });
        return;
      }
      // reminder
      if (cartHasItems() || !reminderDue(policy.reminder_every_hours)) return;
      markReminderShown();
      setView((v) => (v && v.kind === "downloaded" ? v : { kind: "reminder", ...base }));
    } finally { checking.current = false; }
  }, [lang]);

  // Cold start + every return to the foreground; online/offline.
  useEffect(() => {
    if (!isNative()) return undefined;
    let handle = null, alive = true;
    check();
    import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) check(); }))
      .then((h) => { if (alive) handle = h; else { try { h.remove(); } catch { /* ignore */ } } })
      .catch(() => { /* no App plugin */ });
    const on = () => { setOnline(true); check(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      alive = false;
      try { handle && handle.remove(); } catch { /* ignore */ }
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearTimeout(cartTimer.current);
    };
  }, [check]);

  // Flexible update progress → "Restart to install" when downloaded.
  useEffect(() => {
    if (!isNative()) return undefined;
    let handle = null, alive = true;
    plugin().then((p) => p.addListener("onFlexibleUpdateStateChange", (s) => {
      if (s && s.installStatus === 11) setView({ kind: "downloaded" });   // FlexibleUpdateInstallStatus.DOWNLOADED
    })).then((h) => { if (alive) handle = h; else { try { h.remove(); } catch { /* ignore */ } } })
      .catch(() => { /* no plugin */ });
    return () => { alive = false; try { handle && handle.remove(); } catch { /* ignore */ } };
  }, []);

  // While the required screen is up: watch the offline queue (read only) — the normal sync drains it.
  useEffect(() => {
    if (!view || view.kind !== "required") return undefined;
    let alive = true;
    setQueueWaitDone(false);
    const poll = async () => { const n = await pendingCount(); if (alive) setQueue(n); };
    poll();
    const id = setInterval(poll, 2000);
    const wait = setTimeout(() => { if (alive) setQueueWaitDone(true); }, 30000);
    return () => { alive = false; clearInterval(id); clearTimeout(wait); };
  }, [view && view.kind]);

  const openStore = async (storeUrl) => {
    try { await (await plugin()).openAppStore(); }
    catch { if (storeUrl) window.open(storeUrl, "_blank"); }
  };

  const doRequired = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (view.play && view.play.status === "available" && view.play.immediateAllowed) {
        await (await plugin()).performImmediateUpdate();   // Play's own full screen; on success the app restarts
      } else {
        await openStore(view.storeUrl);
      }
    } catch { await openStore(view.storeUrl); }
    finally { setBusy(false); }
  };

  const doReminder = async () => {
    const v = view;
    setView(null);
    try {
      if (v.play && v.play.status === "available" && v.play.flexibleAllowed) { await (await plugin()).startFlexibleUpdate(); return; }
    } catch { /* fall through to the store */ }
    await openStore(v.storeUrl);
  };

  const doRestart = async () => {
    if (cartHasItems()) return;
    try { await (await plugin()).completeFlexibleUpdate(); } catch { /* Play will install on next start */ }
  };

  if (!view) return null;

  if (view.kind === "required") {
    if (!online) return null;                       // offline → never block
    const n = queue;
    const waiting = n != null && n > 0 && !queueWaitDone;
    return (
      <div role="alertdialog" aria-modal="true" data-update-gate="required" style={S.full}>
        <div style={{ maxWidth: 440, width: "100%" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }} aria-hidden="true">⬆️</div>
          <h1 style={S.h1}>{t.reqTitle}</h1>
          <p style={S.p}>{t.reqBody}</p>
          {view.note && <p style={{ ...S.p, fontStyle: "italic" }}>{view.note}</p>}
          {n != null && n > 0 && waiting && <p style={S.info} data-update-queue="sending">{t.sending(n)}</p>}
          {n != null && n > 0 && !waiting && <p style={S.warn} data-update-queue="kept">{t.kept(n)}</p>}
          {n === 0 && <p style={S.info} data-update-queue="empty">{t.allSent}</p>}
          <button type="button" style={{ ...S.btn, opacity: waiting || busy ? 0.6 : 1 }} disabled={waiting || busy} onClick={doRequired}>
            {view.play && view.play.status === "available" ? t.update : t.openStore}
          </button>
          {view.play && view.play.status !== "available" && <p style={S.small}>{t.playLag}</p>}
        </div>
      </div>
    );
  }

  if (view.kind === "reminder") {
    return (
      <div role="dialog" data-update-gate="reminder" style={S.sheet}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{t.remTitle}</div>
        <div style={{ fontSize: 13.5, opacity: 0.9 }}>{view.note || t.remBody}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" style={S.ghost} onClick={() => setView(null)}>{t.later}</button>
          <button type="button" style={S.btnSm} onClick={doReminder}>{t.update}</button>
        </div>
      </div>
    );
  }

  // downloaded (flexible)
  const cart = cartHasItems();
  return (
    <div role="dialog" data-update-gate="downloaded" style={S.sheet}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{t.ready}</div>
      {cart && <div style={{ fontSize: 13.5, opacity: 0.9 }}>{t.finishSale}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" style={S.ghost} onClick={() => setView(null)}>{t.later}</button>
        <button type="button" style={{ ...S.btnSm, opacity: cart ? 0.6 : 1 }} disabled={cart} onClick={doRestart}>{t.restart}</button>
      </div>
    </div>
  );
}

const S = {
  full: {
    position: "fixed", inset: 0, zIndex: 95000, background: "var(--bg-base, #0d1b34)",
    color: "var(--text-primary, #fff)", display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24, textAlign: "center", overflowY: "auto",
  },
  h1: { fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, marginBottom: 8 },
  p: { fontSize: 14.5, lineHeight: 1.5, color: "var(--text-secondary, #cbd5e1)", marginBottom: 12 },
  info: { fontSize: 13.5, lineHeight: 1.45, color: "var(--text-secondary, #cbd5e1)", marginBottom: 16 },
  warn: { fontSize: 13.5, lineHeight: 1.45, color: "#FBC503", marginBottom: 16, fontWeight: 600 },
  small: { fontSize: 12.5, color: "var(--text-muted, #94a3b8)", marginTop: 14 },
  btn: {
    background: "linear-gradient(135deg, #152B52, #FBC503)", color: "#fff", border: "none", borderRadius: 12,
    padding: "13px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", minWidth: 200,
  },
  sheet: {
    position: "fixed", left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", zIndex: 94000,
    background: "#152B52", color: "#fff", borderRadius: 14, padding: "14px 16px",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 8,
    maxWidth: 520, margin: "0 auto",
  },
  btnSm: { background: "#FBC503", color: "#152B52", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  ghost: { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.35)", borderRadius: 10, padding: "9px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" },
};
