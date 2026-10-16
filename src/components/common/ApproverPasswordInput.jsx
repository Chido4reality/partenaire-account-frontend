// APPROVAL PASSWORD (Peter, 2026-10-16 — option A). Every approve / reject / reveal box
// is checked by the server against pa_users.pin_hash, which IS the login password. These
// boxes used to strip every non-digit (inputMode numeric + replace(/\D/g, "")), so an owner
// whose password has letters (Peter's rule: letters + numbers) could never approve anything.
// One input for all of them: it accepts exactly what the login box accepts.

export const approverPasswordReady = (v) => String(v || "").length > 0;

export const approverPasswordLabel = (en) => (en ? "Your password" : "Votre mot de passe");

export const approverPasswordMissing = (en) => (en ? "Enter your password." : "Entrez votre mot de passe.");

export const approverPasswordWrong = (en) => (en ? "Wrong password." : "Mot de passe incorrect.");

export default function ApproverPasswordInput({ value, onChange, onEnter, autoFocus, style, inputRef }) {
  return (
    <input
      ref={inputRef}
      className="input" type="password" autoFocus={autoFocus}
      // Not the browser's saved login: a cashier's device must never fill the owner's password.
      autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      maxLength={200}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined}
      placeholder="••••••"
      style={style} />
  );
}
