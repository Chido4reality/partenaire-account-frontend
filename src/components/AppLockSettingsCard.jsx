// APP LOCK (2026-10-21) — Settings → Account.
//   Owner:   the business's lock — Android / Web / Both / Off, lock after X minutes, fingerprint/face
//            allowed — PATCH /api/app-lock/policy (owner only, audited on the server).
//   Android: each person's own fingerprint/face unlock, opt-in, with the shared-phone warning.
// The start date is decided by the server: an owner's save with the lock on starts it (2026-10-27).
//
// 2026-10-27 (Peter's phone was signed in to ANOTHER business, Demo Shop, and its owner's save there
// turned that phone's lock off): the card names the business it changes; the form shows "Not saved yet"
// until the server has it; a failed save shows the error AND puts the stored values back (nothing local
// changes without the server's answer — utils/appLockSettings.savePolicy); the status line says why the
// lock is not active; the two fingerprint switches say whose they are.
import { useEffect, useState } from "react";
import api from "../utils/api";
import { useAuthStore } from "../store";
import { isNative, announcePolicy, biometricState, biometricStatus, enableBiometric, disableBiometric } from "../utils/appLock";
import { MINUTES, MODES, draftOf, isDirty, statusText, savePolicy, policyStatus } from "../utils/appLockSettings";

export default function AppLockSettingsCard({ lang }) {
  const en = lang === "en";
  const user = useAuthStore((s) => s.user);
  const org = useAuthStore((s) => s.org);
  const isOwner = user && user.role === "owner";
  const [policy, setPolicy] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bio, setBio] = useState("off");
  const [bioSt, setBioSt] = useState({ available: false, reason: "no_plugin" });
  const [bioMsg, setBioMsg] = useState("");
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/app-lock/policy", { timeout: 8000 }).then((r) => {
      const d = r.data && r.data.data;
      if (!alive || !d) return;
      setPolicy(d);
      setDraft(draftOf(d));
    }).catch(() => { if (alive) setErr(en ? "The app lock setting could not be read." : "Impossible de lire le réglage du verrouillage."); });
    if (isNative() && user) {
      biometricState(user.id).then((s) => alive && setBio(s));
      biometricStatus().then((s) => alive && setBioSt(s));
    }
    return () => { alive = false; };
  }, [user && user.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next) => { setDraft(next); setSaved(false); setErr(""); };

  const save = async () => {
    if (!draft || !policy || saving) return;
    setSaving(true); setErr(""); setSaved(false); setJustStarted(false);
    const r = await savePolicy((body) => api.patch("/app-lock/policy", body, { timeout: 10000 }), draft, policy, en);
    if (r.ok) {
      setPolicy(r.policy); setDraft(draftOf(r.policy)); setSaved(true); setJustStarted(r.justStarted);
      if (org) await announcePolicy(org.id, r.policy);     // the running lock uses it now
    } else {
      setErr(r.error); setDraft(r.draft);                  // the stored values come back on screen
    }
    setSaving(false);
  };

  const toggleBio = async () => {
    if (bioBusy) return;
    setBioBusy(true); setBioMsg("");
    if (bio === "off") {
      const r = await enableBiometric({ title: en ? "Turn on fingerprint / face" : "Activer l'empreinte / le visage",
        subtitle: en ? "Confirm with your finger or face" : "Confirmez avec votre doigt ou votre visage", cancel: en ? "Cancel" : "Annuler" });
      if (r.ok) setBio("on");
      else if (r.code !== "cancelled") setBioMsg(en ? "Fingerprint / face unlock could not be turned on." : "Impossible d'activer le déverrouillage par empreinte / visage.");
    } else {
      await disableBiometric();
      setBio("off");
    }
    setBioBusy(false);
  };

  const bioReason = {
    none_enrolled: en ? "Add a fingerprint or face in this phone's settings first." : "Ajoutez d'abord une empreinte ou un visage dans les réglages du téléphone.",
    no_hardware: en ? "This phone has no fingerprint or face sensor strong enough." : "Ce téléphone n'a pas de capteur d'empreinte ou de visage assez sûr.",
    unsupported: en ? "Not available on this phone." : "Non disponible sur ce téléphone.",
    old_android: en ? "Needs Android 7 or newer." : "Nécessite Android 7 ou plus récent.",
  }[bioSt.reason] || (en ? "Not available on this phone." : "Non disponible sur ce téléphone.");

  const showBio = isNative() && policy && policy.biometric_allowed && policy.lock_android;
  if (!isOwner && !showBio) return null;
  const orgName = (org && org.name) || "";
  const dirty = isDirty(draft, policy);
  const st = policyStatus(policy);
  const bioOn = bio === "on" || bio === "needs_password";

  return (
    <div data-app-lock-settings style={{ marginTop: 20, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }} data-app-lock-title>
        🔒 {en ? `App lock for ${orgName || "this business"}` : `Verrouillage de l'application — ${orgName || "cette entreprise"}`}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, marginBottom: 16 }}>
        {en ? "Asks for the signed-in person's password when the app opens and after a while without use."
            : "Demande le mot de passe de la personne connectée à l'ouverture et après un moment sans utilisation."}
      </div>
      {policy && (
        <div data-app-lock-status={st} style={{ fontSize: 13, fontWeight: 600, marginBottom: 14,
          color: st === "active" ? "#34d399" : "#FBC503" }}>
          {statusText(policy, en, { justStarted })}
        </div>
      )}
      {isOwner && draft && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }} role="radiogroup" aria-label={en ? "Where" : "Où"}>
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={draft.mode === m.key} data-app-lock-mode={m.key}
                onClick={() => edit({ ...draft, mode: m.key })}
                style={{ padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: draft.mode === m.key ? "2px solid #FBC503" : "1px solid var(--border)",
                  background: draft.mode === m.key ? "rgba(251,197,3,.12)" : "transparent", color: "var(--text-primary)" }}>
                {en ? m.en : m.fr}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div className="form-group">
              <label className="label">{en ? "Lock after (minutes without use)" : "Verrouiller après (minutes sans utilisation)"}</label>
              <select className="input" value={draft.minutes} data-app-lock-minutes onChange={(e) => edit({ ...draft, minutes: Number(e.target.value) })}>
                {MINUTES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={draft.bio} data-app-lock-bio-allowed onChange={(e) => edit({ ...draft, bio: e.target.checked })} />
              <span>
                {en ? "Let everyone in this business use fingerprint / face (Android)" : "Autoriser l'empreinte / le visage pour toute l'entreprise (Android)"}
                <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {en ? "Business rule. Each person then turns it on for their own phone below."
                      : "Règle de l'entreprise. Chacun l'active ensuite pour son propre téléphone ci-dessous."}
                </span>
              </span>
            </label>
          </div>
          {dirty && !saving && <div data-app-lock-dirty style={{ color: "#FBC503", fontSize: 12, margin: "8px 0" }}>
            {en ? "Not saved yet — press Save." : "Pas encore enregistré — appuyez sur Enregistrer."}</div>}
          {err && <div data-app-lock-error style={{ color: "#f87171", fontSize: 12, margin: "8px 0" }}>{err}</div>}
          {saved && <div style={{ color: "#34d399", fontSize: 12, margin: "8px 0" }}>{en ? "Saved." : "Enregistré."}</div>}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save} data-app-lock-save style={{ marginTop: 6 }}>
            {saving ? (en ? "Saving…" : "Enregistrement…") : (en ? "Save" : "Enregistrer")}
          </button>
        </>
      )}
      {isOwner && !draft && err && <div style={{ color: "#f87171", fontSize: 12 }}>{err}</div>}
      {showBio && (
        <div data-app-lock-personal style={{ marginTop: isOwner ? 20 : 0, paddingTop: isOwner ? 16 : 0, borderTop: isOwner ? "1px solid var(--border)" : "none" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {en ? "My fingerprint / face on THIS phone" : "Mon empreinte / visage sur CE téléphone"}
            {user && user.full_name ? <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> — {user.full_name}</span> : null}
          </div>
          <div data-app-lock-bio-state={bioOn ? "on" : "off"} style={{ fontSize: 13, margin: "4px 0", fontWeight: 600, color: bioOn ? "#34d399" : "var(--text-muted)" }}>
            {bioOn ? (en ? "On for this phone" : "Activé sur ce téléphone") : (en ? "Off for this phone" : "Désactivé sur ce téléphone")}
          </div>
          {st !== "active" && (
            <div data-app-lock-bio-inactive style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
              {en ? `The app lock is not active for ${orgName || "this business"}, so nothing asks for it yet.`
                  : `Le verrouillage n'est pas actif pour ${orgName || "cette entreprise"} : rien ne le demande encore.`}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#FBC503", margin: "4px 0 10px" }}>
            {en ? "Only if this phone is yours: anyone whose finger or face is saved on this phone could unlock your session."
                : "Seulement si ce téléphone est le vôtre : toute personne dont l'empreinte ou le visage est enregistré sur ce téléphone pourrait ouvrir votre session."}
          </div>
          {bioSt.available ? (
            <button type="button" className="btn" disabled={bioBusy} onClick={toggleBio} data-app-lock-bio-toggle={bio}>
              {bio === "off" ? (en ? "Turn on for this phone" : "Activer sur ce téléphone") : (en ? "Turn off for this phone" : "Désactiver sur ce téléphone")}
            </button>
          ) : <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{bioReason}</div>}
          {bio === "needs_password" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            {en ? "The fingerprints or faces on this phone changed: it will work again after your next password unlock."
                : "Les empreintes ou visages du téléphone ont changé : cela remarchera après votre prochain déverrouillage par mot de passe."}</div>}
          {bioMsg && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{bioMsg}</div>}
        </div>
      )}
    </div>
  );
}
