// MP-DRAWER-REVEAL — the PIN prompt that unmasks the till figure.
//
// Shared by DrawerDashboardCard and ActiveShiftIndicator so the copy, the error handling
// and the rate-limit message are identical wherever the drawer is masked.
//
// Asks for the VIEWER'S OWN PIN (POST /auth/verify-my-pin) — "prove you are still you",
// not "fetch a supervisor". A cashier unmasks their own drawer with their own code.
import { useState } from "react";
import { useLangStore } from "../../store";
import { revealWithPin, REVEAL_MS } from "../../utils/useDrawerReveal";

export default function RevealPinModal({ open, onClose, onRevealed }) {
  const { lang } = useLangStore();
  const fr = lang === "fr";
  const [pin, setPin]   = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  if (!open) return null;

  const submit = async () => {
    if (busy || !/^\d{4,6}$/.test(pin)) return;
    setBusy(true); setErr(null);
    const r = await revealWithPin(pin);
    setBusy(false);
    if (r.ok) { setPin(""); onRevealed && onRevealed(); onClose(); return; }
    // Rate-limited is worth naming separately — "wrong code" five times in a row when the
    // real problem is a 5-minute lockout is the kind of message that makes people
    // reinstall the app.
    setErr(r.rateLimited
      ? (fr ? "Trop de tentatives — attendez 5 minutes." : "Too many attempts — wait 5 minutes.")
      : (fr ? "Code incorrect." : "Wrong PIN."));
    setPin("");
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-elevated)",
        border: "1px solid var(--border)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 330 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          🔒 {fr ? "Afficher le montant" : "Show the amount"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          {fr
            ? `Entrez VOTRE code pour afficher l'argent en caisse. Il se masque à nouveau après ${Math.round(REVEAL_MS / 1000)} secondes, ou dès que vous quittez l'écran.`
            : `Enter YOUR PIN to show the cash in the drawer. It hides again after ${Math.round(REVEAL_MS / 1000)} seconds, or as soon as you leave this screen.`}
        </div>

        <input
          type="password" inputMode="numeric" autoFocus
          className="input" style={{ width: "100%", textAlign: "center", fontSize: 22, letterSpacing: 6 }}
          value={pin} maxLength={6}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="••••" />

        {err && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#f87171" }}>{err}</div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {fr ? "Annuler" : "Cancel"}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !/^\d{4,6}$/.test(pin)}>
            {busy ? "…" : (fr ? "Afficher" : "Show")}
          </button>
        </div>
      </div>
    </div>
  );
}
