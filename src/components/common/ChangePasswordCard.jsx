// CHANGE PASSWORD (Peter, 2026-10-16) — replaces the retired "Owner PIN" card, for EVERY
// signed-in user: owner/manager in Settings → Account, everyone on My account (/my-account).
// POST /auth/change-password changes only the caller's own login password. The same rules
// as the server (backend/src/lib/passwordRules.js) run here first so the person is told
// at once; the server stays the authority. This device stays signed in.
import { useState } from "react";
import api from "../../utils/api";

export const PASSWORD_MIN = 6;

// Mirrors the server, same order, same words. null = fine.
export function newPasswordProblem({ current, next, confirm }, en) {
  if (!current) return en ? "Enter your current password." : "Entrez votre mot de passe actuel.";
  if (!next) return en ? "Enter a new password." : "Entrez un nouveau mot de passe.";
  if (!/^[A-Za-z0-9]+$/.test(next))
    return en ? "Use letters and numbers only — no spaces or special characters."
              : "Utilisez seulement des lettres et des chiffres — pas d'espaces ni de caractères spéciaux.";
  if (next.length < PASSWORD_MIN)
    return en ? `The new password needs at least ${PASSWORD_MIN} characters.`
              : `Le nouveau mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`;
  if (next === current) return en ? "The new password must be different from the current one." : "Le nouveau mot de passe doit être différent de l'actuel.";
  if (confirm !== next) return en ? "The two new passwords do not match." : "Les deux nouveaux mots de passe ne correspondent pas.";
  return null;
}

const inputProps = { className: "input", type: "password", autoCapitalize: "off", autoCorrect: "off", spellCheck: false, maxLength: 64 };

export default function ChangePasswordCard({ en }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr(""); setDone(false); };

  const save = async () => {
    const p = newPasswordProblem(f, en);
    if (p) { setErr(p); return; }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: f.current, new_password: f.next, confirm_password: f.confirm });
      setF({ current: "", next: "", confirm: "" }); setDone(true);
    } catch (e) {
      const d = e?.response?.data || {};
      setErr((en ? d.message_en : d.message_fr) || d.message || (en ? "Could not change the password." : "Impossible de changer le mot de passe."));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>🔐 {en ? "Change password" : "Changer le mot de passe"}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, marginBottom: 16 }}>
        {en ? `The password you sign in with — and approve with. Letters and numbers only, at least ${PASSWORD_MIN}.`
            : `Le mot de passe de connexion — et d'approbation. Lettres et chiffres seulement, au moins ${PASSWORD_MIN}.`}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="form-group">
          <label className="label">{en ? "Current password" : "Mot de passe actuel"}</label>
          <input {...inputProps} autoComplete="current-password" value={f.current} onChange={set("current")} />
        </div>
        <div className="form-group">
          <label className="label">{en ? "New password" : "Nouveau mot de passe"}</label>
          <input {...inputProps} autoComplete="new-password" value={f.next} onChange={set("next")} />
        </div>
        <div className="form-group">
          <label className="label">{en ? "Confirm new password" : "Confirmer le nouveau"}</label>
          <input {...inputProps} autoComplete="new-password" value={f.confirm} onChange={set("confirm")} />
        </div>
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{err}</div>}
      {done && <div style={{ color: "#34d399", fontSize: 12, marginBottom: 12 }}>
        ✓ {en ? "Password changed. Use the new one next time you sign in or approve." : "Mot de passe modifié. Utilisez le nouveau à la prochaine connexion ou approbation."}
      </div>}
      <button onClick={save} disabled={busy} className="btn btn-primary" style={{ minWidth: 200 }}>
        {busy ? "..." : (en ? "Change password" : "Changer le mot de passe")}
      </button>
    </div>
  );
}
