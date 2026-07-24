import { useEffect, useRef, useState, useCallback } from "react";
import api from "../utils/api";
import { useAuthStore, isStaleLocked } from "../store";

// MP-STALE-TRUST-LOCKOUT (Task B): if a device has been offline longer than the org's
// max_offline_hours (owner exempt), lock the ENTIRE authed app — reads included — behind a
// bilingual reconnect screen, and keep probing so it lifts the instant the network returns.
// The tripwire is best-effort (localStorage-editable); the SERVER is the real gate — the
// probe (GET /api/auth/heartbeat) either refreshes the stamp (active) or 401s account_disabled
// (deactivated → the api interceptor logs the user out). The offline queue is never touched.
export default function LockGate({ children }) {
  const auth = useAuthStore();
  const [, setNow] = useState(Date.now());
  const [checking, setChecking] = useState(false);
  const [probedOnce, setProbedOnce] = useState(false);
  const busy = useRef(false);

  const locked = isStaleLocked(auth);

  const probe = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      // Success → the response interceptor calls markVerified() (stamp refreshed, window
      // updated) → this component re-renders unlocked. A 401 account_disabled is handled
      // globally by the api interceptor (session cleared → /login). Network error → stay put.
      await api.get("/auth/heartbeat", { timeout: 8000 });
    } catch { /* offline or logged-out — leave state as-is */ }
    finally { busy.current = false; setChecking(false); setProbedOnce(true); }
  }, []);

  // Re-evaluate the lock on a cadence (so it engages when the window elapses while idle),
  // probe on wake/reconnect (prompt logout for a deactivated user / prompt unlock for an
  // honest one), and stamp a pre-feature session that has no tripwire yet.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 15000);
    const onWake = () => { tick(); probe(); };
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    if (auth.isAuthenticated && auth.lastVerifiedActive == null) probe();
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [probe, auth.isAuthenticated, auth.lastVerifiedActive]);

  // While locked, keep trying so an honest cashier in a bad-signal shop unlocks smoothly
  // the moment signal returns — no re-login, no lost queue.
  useEffect(() => {
    if (!locked) return;
    probe();
    const id = setInterval(probe, 10000);
    return () => clearInterval(id);
  }, [locked, probe]);

  if (!locked) return children;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90000, background: "var(--bg-base, #0d1b34)",
      color: "var(--text-primary, #fff)", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24, textAlign: "center",
    }}>
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 46, marginBottom: 12 }}>📴</div>
        {/* Bilingual: both languages shown so it's understood regardless of app language. */}
        <h1 style={{ fontFamily: "var(--font-display, inherit)", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          Reconnexion requise · Reconnect required
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: "var(--text-secondary, #cbd5e1)", marginBottom: 6 }}>
          Cet appareil est hors ligne depuis trop longtemps. Connectez-vous à internet pour
          confirmer votre compte avant de continuer.
        </p>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: "var(--text-secondary, #cbd5e1)", marginBottom: 20 }}>
          This device has been offline too long. Connect to the internet so we can confirm
          your account before you continue.
        </p>
        <button
          onClick={probe}
          disabled={checking}
          style={{
            background: "linear-gradient(135deg, #152B52, #FBC503)", color: "#fff",
            border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 15,
            fontWeight: 700, cursor: checking ? "default" : "pointer", opacity: checking ? 0.7 : 1,
          }}
        >
          {checking ? "Vérification… · Checking…" : "Réessayer · Retry now"}
        </button>
        {probedOnce && !checking && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted, #94a3b8)", marginTop: 14 }}>
            Toujours hors ligne — nous réessayons automatiquement.<br />
            Still offline — we keep retrying automatically.
          </p>
        )}
      </div>
    </div>
  );
}
