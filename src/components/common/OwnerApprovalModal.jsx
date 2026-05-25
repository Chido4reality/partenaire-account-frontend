// MP-OWNER-PIN-APPROVAL: reusable PIN-entry modal. Cashier triggers a
// sensitive action; the modal pops; owner/manager taps in their PIN at
// the counter; on success the parent gets back a short-lived token it
// passes as `Approval-Token` to the gated endpoint.
//
// Drive this via the useOwnerApproval hook for the cleanest call site;
// you can also render it directly if you need bespoke state handling.
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import api from "../../utils/api";
import { useLangStore } from "../../store";
import { tapHaptic } from "../../utils/haptics";

export default function OwnerApprovalModal({
  open,
  onClose,
  title,
  actionDescription,
  actionType,
  targetTable,
  targetId,
  context,
  onApproved,
}) {
  const { lang } = useLangStore();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  // Reset on open so a previous attempt's PIN doesn't linger.
  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setShake(false);
      setSubmitting(false);
      // Slight delay so the modal animates in before focus pulls the
      // keyboard up — feels less abrupt on mobile.
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    if (submitting) return;
    tapHaptic("light");
    if (!/^\d{4,6}$/.test(pin)) {
      setError(lang === "fr" ? "Le PIN doit être 4 à 6 chiffres" : "PIN must be 4-6 digits");
      setShake(true); setTimeout(() => setShake(false), 350);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post("/approval/verify-pin", {
        pin,
        action_type: actionType,
        target_table: targetTable,
        target_id: targetId,
        context: context || {},
      });
      if (data?.success && data.token) {
        tapHaptic("medium");
        // Hand the parent both pieces — most callers want the token,
        // a few want approver_id for client-side display ("approved by …").
        onApproved?.(data.token, data.approver_id);
        // Defensive close in case parent forgot. Parent's onApproved
        // should also close, but double-close is a no-op.
        onClose?.();
        return;
      }
      setError(lang === "fr" ? "PIN incorrect" : "Wrong PIN");
      setShake(true); setTimeout(() => setShake(false), 350);
      tapHaptic("light");
      setPin("");
    } catch (err) {
      tapHaptic("light");
      const status = err?.response?.status;
      const code = err?.response?.data?.error;
      if (status === 429) {
        setError(lang === "fr" ? "Trop de tentatives. Attendez 5 minutes." : "Too many attempts. Wait 5 minutes.");
      } else if (status === 403 || status === 401 || code === "invalid_pin") {
        // 403 is the new bad-PIN response (was 401 pre-APK fix; 401
        // tripped the universal logout interceptor). Keep 401 in the
        // match for any deploys mid-rollout.
        setError(lang === "fr" ? "PIN incorrect" : "Wrong PIN");
        setPin("");
      } else if (code === "bad_pin_format") {
        setError(lang === "fr" ? "Format PIN invalide" : "Invalid PIN format");
      } else {
        setError(err?.response?.data?.message || (lang === "fr" ? "Échec — réessayez" : "Failed — try again"));
      }
      setShake(true); setTimeout(() => setShake(false), 350);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2500, padding: 16 }}>
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={shake ? { scale: 1, opacity: 1, x: [-6, 6, -4, 4, 0] } : { scale: 1, opacity: 1, x: 0 }}
        transition={{ duration: shake ? 0.32 : 0.18 }}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, width: "100%", maxWidth: 380, padding: 22, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
      >
        <div style={{ fontSize: 26, marginBottom: 6 }}>🔐</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
          {title || (lang === "fr" ? "Approbation requise" : "Owner Approval Required")}
        </div>
        {actionDescription && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
            {actionDescription}
          </div>
        )}
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          {lang === "fr" ? "PIN propriétaire / gérant" : "Owner / manager PIN"}
        </label>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="••••"
          className="input"
          style={{ width: "100%", textAlign: "center", letterSpacing: "0.5em", fontSize: 20, fontWeight: 700, marginBottom: 10 }}
        />
        {error && (
          <div style={{ fontSize: 12, color: "#f87171", marginBottom: 10, fontWeight: 600 }}>
            ✕ {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { tapHaptic("light"); onClose?.(); }}
            disabled={submitting}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            {lang === "fr" ? "Annuler" : "Cancel"}
          </button>
          <button
            onClick={submit}
            disabled={submitting || pin.length < 4}
            className="btn btn-primary"
            style={{ flex: 2, fontWeight: 700 }}
          >
            {submitting
              ? "⏳"
              : (lang === "fr" ? "Approuver" : "Approve")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
