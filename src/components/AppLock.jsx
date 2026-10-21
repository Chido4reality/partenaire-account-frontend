import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useLangStore } from "../store";
import { armed, lockAtStart, lockAfterIdle } from "../utils/appLockCore";
import {
  isNative, SESSION_STARTED_AT, lastUnlockAt, savedPolicy, refreshPolicy, hasRecord, sweepOtherUsers,
  unlockWithPassword, unlockWithBiometric, biometricState, biometricStatus, disableBiometric, signOut,
} from "../utils/appLock";

// APP LOCK (2026-10-21) — an outer layer: Guard → AppLock → LockGate → Layout.
// It ALWAYS renders its children, unchanged and in the same place; the lock screen is drawn on top through
// a portal into document.body and the app's #root is made `inert` (no taps, no barcode-scanner typing).
// Nothing underneath unmounts: the POS cart, an open modal, a request in flight all survive lock/unlock.
// It sits OUTSIDE LockGate (the offline-too-long lockout): this asks "who is holding the phone", LockGate
// asks "does the server still trust this device"; LockGate's checks keep running under this screen.
//   locks: cold start (Android) / a new or reopened tab (web); after the owner's X minutes without a
//          touch or key, including time in the background; never right after a login, never in an admin
//          "log in as" session, never before the owner's start date, never offline without a record.
//   unlock: the signed-in user's password (server when online, the on-device PBKDF2 record offline), or
//           their fingerprint/face if they turned it on. 5 wrong → the normal logout.
// It never touches the boss-approval flows (own endpoint, own counter, no approval token).

const T = {
  fr: {
    title: "Stenamo Book est verrouillé", who: (n) => `Connecté : ${n}`, pwd: "Mot de passe", unlock: "Déverrouiller",
    bio: "Empreinte / visage", bioTitle: "Déverrouiller Stenamo Book", bioSub: "Touchez le capteur ou regardez l'écran",
    bioCancel: "Mot de passe", notYou: (n) => `Pas ${n} ? Se déconnecter`,
    wrong: (k) => `Mot de passe incorrect. Encore ${k} essai${k > 1 ? "s" : ""} avant la déconnexion.`,
    wait: (m) => `Trop d'essais. Patientez ${m} min.`, offlineNoRecord: "Connectez-vous à Internet pour déverrouiller.",
    bioChanged: "Les empreintes ou visages de ce téléphone ont changé. Saisissez votre mot de passe.",
    bioLockout: "Trop d'essais d'empreinte. Saisissez votre mot de passe.", signingOut: "Déconnexion…",
    notice: (d) => `À partir du ${d}, Stenamo Book demandera votre mot de passe à l'ouverture.`, ok: "Compris",
  },
  en: {
    title: "Stenamo Book is locked", who: (n) => `Signed in: ${n}`, pwd: "Password", unlock: "Unlock",
    bio: "Fingerprint / face", bioTitle: "Unlock Stenamo Book", bioSub: "Touch the sensor or look at the screen",
    bioCancel: "Password", notYou: (n) => `Not ${n}? Sign out`,
    wrong: (k) => `Wrong password. ${k} more ${k > 1 ? "tries" : "try"} before you are signed out.`,
    wait: (m) => `Too many attempts. Wait ${m} min.`, offlineNoRecord: "Connect to the internet to unlock.",
    bioChanged: "The fingerprints or faces on this phone have changed. Enter your password.",
    bioLockout: "Too many fingerprint attempts. Enter your password.", signingOut: "Signing out…",
    notice: (d) => `From ${d}, Stenamo Book will ask for your password when it opens.`, ok: "Got it",
  },
};
const ACTIVITY = ["pointerdown", "keydown", "touchstart", "wheel"];

export default function AppLock({ children }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const org = useAuthStore((s) => s.org);
  const impersonating = useAuthStore((s) => s.impersonating);
  const lang = useLangStore((s) => s.lang);
  const t = T[lang === "en" ? "en" : "fr"];
  const native = isNative();

  const [locked, setLocked] = useState(null);          // null = deciding (opaque cover), false, true
  const [policy, setPolicy] = useState(null);
  const [bio, setBio] = useState("off");
  const [bioOk, setBioOk] = useState(false);
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noticeOff, setNoticeOff] = useState(false);
  const lastActivity = useRef(Date.now());
  const policyRef = useRef(null);
  const recRef = useRef(false);
  const lockedRef = useRef(null);
  lockedRef.current = locked;

  const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
  const sessionStart = () => Math.max(SESSION_STARTED_AT, lastUnlockAt());
  const isArmed = useCallback((p) => armed(p, { native, sessionStartedAt: sessionStart(), impersonating }), [native, impersonating]);

  // ── decide at start (and when the signed-in user changes) ──────────────────────────────────────
  useEffect(() => {
    if (!user || !org) { setLocked(false); return undefined; }
    let alive = true;
    (async () => {
      sweepOtherUsers();
      // Decide at once from the copy kept on the device (a few ms of cover, never a network wait);
      // the server's current policy is read in the background.
      const p = await savedPolicy(org.id);
      const r = await hasRecord(user, org);
      const b = await biometricState(user.id);
      if (!alive) return;
      const startDecision = (pol) => lockAtStart({ isArmed: isArmed(pol), hasHash: r, online: online(), lastUnlockAt: lastUnlockAt(),
        now: Date.now(), minutes: pol.lock_after_minutes });
      policyRef.current = p; recRef.current = r;
      // right after a login the record is still being hashed: look again shortly
      if (!r) setTimeout(() => { if (alive) hasRecord(user, org).then((v) => { if (alive) recRef.current = v; }); }, 4000);
      setPolicy(p); setBio(b);
      setLocked(startDecision(p));
      const st = native ? await biometricStatus() : { available: false };
      if (alive) setBioOk(st.available);
      const fresh = await refreshPolicy(org.id);
      if (!alive || !fresh) return;
      policyRef.current = fresh; setPolicy(fresh);
      if (b !== "off" && !fresh.biometric_allowed) { disableBiometric("policy"); setBio("off"); }
      // A device that had no (or an old) copy: still lock if the app has only just opened.
      if (lockedRef.current === false && Date.now() - SESSION_STARTED_AT < 20000 && startDecision(fresh)) setLocked(true);
    })();
    // never leave the app covered if storage hangs
    const cap = setTimeout(() => { if (alive && lockedRef.current === null) setLocked(false); }, 6000);
    return () => { alive = false; clearTimeout(cap); };
  }, [user && user.id, org && org.id, isArmed]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── idle / background → lock ───────────────────────────────────────────────────────────────────
  const checkIdle = useCallback(() => {
    const p = policyRef.current;
    if (!p || lockedRef.current !== false) return;
    if (lockAfterIdle({ isArmed: isArmed(p), hasHash: recRef.current, online: online(), idleMs: Date.now() - lastActivity.current, minutes: p.lock_after_minutes })) {
      setMsg(null); setPwd(""); setLocked(true);
    }
  }, [isArmed]);
  useEffect(() => {
    const touch = () => { if (lockedRef.current === false) lastActivity.current = Date.now(); };
    ACTIVITY.forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));
    const id = setInterval(checkIdle, 15000);
    const onVis = () => { if (document.visibilityState === "visible") { checkIdle(); if (org) refreshPolicy(org.id).then((p) => { if (p) { policyRef.current = p; setPolicy(p); } }); } };
    document.addEventListener("visibilitychange", onVis);
    let handle = null, alive = true;
    if (native) {
      import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) onVis(); }))
        .then((h) => { if (alive) handle = h; else { try { h.remove(); } catch { /* ignore */ } } }).catch(() => {});
    }
    return () => {
      alive = false;
      ACTIVITY.forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
      clearInterval(id); document.removeEventListener("visibilitychange", onVis);
      try { handle && handle.remove(); } catch { /* ignore */ }
    };
  }, [checkIdle, native, org && org.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── while locked: the app is inert, Android Back minimises instead of navigating ───────────────
  useEffect(() => {
    const root = document.getElementById("root");
    const cover = locked !== false;
    if (root) { root.inert = cover; if (cover) root.setAttribute("aria-hidden", "true"); else root.removeAttribute("aria-hidden"); }
    if (!cover || !native) return undefined;
    let handle = null, alive = true;
    import("@capacitor/app").then(({ App }) => App.addListener("backButton", () => { App.minimizeApp().catch(() => {}); }))
      .then((h) => { if (alive) handle = h; else { try { h.remove(); } catch { /* ignore */ } } }).catch(() => {});
    return () => { alive = false; try { handle && handle.remove(); } catch { /* ignore */ } };
  }, [locked, native]);
  useEffect(() => () => { const root = document.getElementById("root"); if (root) { root.inert = false; root.removeAttribute("aria-hidden"); } }, []);

  const unlocked = () => {
    lastActivity.current = Date.now(); setPwd(""); setMsg(null); setLocked(false);
    // the first online unlock writes the record: from now on the lock also works offline
    if (user && org) hasRecord(user, org).then((v) => { recRef.current = v; });
  };
  const name = (user && (user.full_name || user.name)) || "";
  const first = name.split(" ")[0] || name;

  const tryBio = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const r = await unlockWithBiometric({ title: t.bioTitle, subtitle: t.bioSub, cancel: t.bioCancel });
    setBusy(false);
    if (r.ok) { unlocked(); return; }
    if (r.code === "invalidated" || r.code === "no_key") { setBio("needs_password"); setMsg({ kind: "bio_changed", text: t.bioChanged }); }
    else if (r.code === "lockout" || r.code === "lockout_permanent") setMsg({ kind: "bio_lockout", text: t.bioLockout });
  }, [busy, t]);  // eslint-disable-line react-hooks/exhaustive-deps

  // each time the screen locks: read the person's fingerprint/face setting afresh (it may have been turned
  // on or off in Settings since start-up) and offer the prompt once
  useEffect(() => {
    if (locked !== true || !user) return undefined;
    let alive = true;
    biometricState(user.id).then((b) => {
      if (!alive) return;
      setBio(b);
      const p = policyRef.current;
      if (b === "on" && bioOk && p && p.biometric_allowed) tryBio();
    });
    return () => { alive = false; };
  }, [locked]);  // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy || !pwd) return;
    setBusy(true);
    const r = await unlockWithPassword(pwd);
    if (r.ok) { setBusy(false); setBio(await biometricState(user.id)); unlocked(); return; }
    setPwd("");
    if (r.rateLimited) { setBusy(false); setMsg({ kind: "wait", text: t.wait(Math.max(1, Math.ceil(r.retryAfter / 60))) }); return; }
    if (r.cannotCheck) { setBusy(false); setMsg({ kind: "offline_no_record", text: t.offlineNoRecord }); return; }
    if (r.logout) {
      setMsg({ kind: "signing_out", text: t.signingOut });
      await signOut(qc, { reason: "failed_logout", wrongAttempts: 5, audited: r.audited });
      return;
    }
    setBusy(false);
    setMsg({ kind: "wrong", text: t.wrong(r.left) });
  };

  const leave = async () => { setBusy(true); setMsg({ kind: "signing_out", text: t.signingOut }); await signOut(qc, { reason: "switch" }); };

  // pre-start notice (FR/EN), dismissible, once per start date
  const noticeKey = policy && policy.starts_at ? `mp-applock-notice-${policy.starts_at}` : null;
  let noticeSeen = false;
  try { noticeSeen = !!(noticeKey && localStorage.getItem(noticeKey)); } catch { /* storage off */ }
  const showNotice = locked === false && !noticeOff && !noticeSeen && !impersonating && policy && policy.starts_at
    && Date.parse(policy.starts_at) > Date.now() && (native ? policy.lock_android : policy.lock_web);
  const startDate = policy && policy.starts_at
    ? new Date(policy.starts_at).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

  return (
    <>
      {children}
      {locked === null && user && createPortal(<div data-app-lock="deciding" style={S.cover} />, document.body)}
      {locked === true && createPortal(
        <div data-app-lock="locked" role="dialog" aria-modal="true" aria-labelledby="mp-applock-title" style={S.cover}>
          <form onSubmit={submit} style={S.card}>
            <div style={{ fontSize: 40 }} aria-hidden="true">🔒</div>
            <h1 id="mp-applock-title" style={S.h1}>{t.title}</h1>
            <p style={S.who}>{t.who(name)}</p>
            <input type="password" autoComplete="current-password" autoFocus value={pwd} disabled={busy && msg && msg.kind === "signing_out"}
              onChange={(e) => setPwd(e.target.value)} placeholder={t.pwd} aria-label={t.pwd} data-app-lock-input style={S.input} />
            {msg && <p data-app-lock-msg={msg.kind} style={msg.kind === "wrong" || msg.kind === "wait" ? S.warn : S.info}>{msg.text}</p>}
            <button type="submit" disabled={busy || !pwd} style={{ ...S.btn, opacity: busy || !pwd ? 0.6 : 1 }}>{t.unlock}</button>
            {bio === "on" && bioOk && policy && policy.biometric_allowed && (
              <button type="button" onClick={tryBio} disabled={busy} style={S.ghost} data-app-lock-bio>{t.bio}</button>
            )}
            <button type="button" onClick={leave} disabled={busy} style={S.link}>{t.notYou(first)}</button>
          </form>
        </div>, document.body)}
      {showNotice && createPortal(
        <div data-app-lock-notice style={S.notice}>
          <span style={{ flex: 1 }}>{t.notice(startDate)}</span>
          <button type="button" style={S.noticeBtn} onClick={() => { try { localStorage.setItem(noticeKey, "1"); } catch { /* off */ } setNoticeOff(true); }}>{t.ok}</button>
        </div>, document.body)}
    </>
  );
}

const S = {
  cover: { position: "fixed", inset: 0, zIndex: 99000, background: "var(--bg-base, #0d1b34)", color: "var(--text-primary, #fff)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflowY: "auto" },
  card: { width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12, textAlign: "center" },
  h1: { fontFamily: "var(--font-display, inherit)", fontSize: 21, fontWeight: 800, margin: 0 },
  who: { fontSize: 14, color: "var(--text-secondary, #cbd5e1)", margin: 0 },
  input: { background: "var(--bg-elevated, #152B52)", border: "1px solid var(--border, #334155)", borderRadius: 12, color: "var(--text-primary, #fff)",
    padding: "13px 14px", fontSize: 16, textAlign: "center" },
  btn: { background: "linear-gradient(135deg, #152B52, #FBC503)", color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  ghost: { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.35)", borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  link: { background: "transparent", color: "var(--text-muted, #94a3b8)", border: "none", padding: 8, fontSize: 13, cursor: "pointer", textDecoration: "underline" },
  warn: { fontSize: 13.5, color: "#FBC503", fontWeight: 600, margin: 0 },
  info: { fontSize: 13.5, color: "var(--text-secondary, #cbd5e1)", margin: 0 },
  notice: { position: "fixed", left: 12, right: 12, top: "calc(12px + env(safe-area-inset-top, 0px))", zIndex: 93000, background: "#152B52", color: "#fff",
    borderRadius: 12, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, maxWidth: 560, margin: "0 auto",
    boxShadow: "0 8px 24px rgba(0,0,0,.3)" },
  noticeBtn: { background: "#FBC503", color: "#152B52", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 800, cursor: "pointer" },
};
