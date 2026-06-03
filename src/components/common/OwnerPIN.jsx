import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../../store";
import api from "../../utils/api";

/**
 * OwnerPIN — reusable PIN verification modal
 * Usage:
 *   <OwnerPIN
 *     open={showPin}
 *     onSuccess={() => { setShowPin(false); doSomething(); }}
 *     onCancel={() => setShowPin(false)}
 *     reason="Override min price for Tube"
 *     lang={lang}
 *   />
 */
export default function OwnerPIN({ open, onSuccess, onCancel, reason = "", lang = "fr" }) {
  const { user } = useAuthStore();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setPin("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (pin.length < 4) { setError(lang === "en" ? "PIN must be 4 digits" : "PIN doit être 4 chiffres"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/settings/verify-pin", { pin });
      if (res.data.success) {
        onSuccess();
      } else {
        setError(lang === "en" ? "Incorrect PIN" : "PIN incorrect");
        setPin("");
      }
    } catch {
      setError(lang === "en" ? "Incorrect PIN" : "PIN incorrect");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 340, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
          {lang === "en" ? "Owner PIN Required" : "PIN propriétaire requis"}
        </div>
        {reason && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20, padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
            {reason}
          </div>
        )}

        {/* PIN dots display */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: pin.length > i ? "var(--brand)" : "var(--border)", transition: "background 0.15s" }} />
          ))}
        </div>

        <input ref={inputRef} type="password" inputMode="numeric" maxLength={4}
          value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, "").slice(0,4)); setError(""); }}
          onKeyDown={handleKey}
          style={{ width: "100%", padding: "12px", textAlign: "center", letterSpacing: 8, fontSize: 20, background: "var(--bg-card)", border: `1px solid ${error ? "#f87171" : "var(--border)"}`, borderRadius: 10, color: "var(--text-primary)", marginBottom: 8, outline: "none" }}
          placeholder="••••" />

        {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>
            {lang === "en" ? "Cancel" : "Annuler"}
          </button>
          <button onClick={handleSubmit} disabled={pin.length < 4 || loading}
            style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: pin.length === 4 ? "var(--brand)" : "var(--border)", color: pin.length === 4 ? "#152B52" : "var(--text-muted)", cursor: pin.length === 4 ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 14 }}>
            {loading ? "..." : (lang === "en" ? "Confirm" : "Confirmer")}
          </button>
        </div>
      </div>
    </div>
  );
}
