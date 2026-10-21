// APP LOCK (2026-10-21) — Settings → Account.
//   Owner:   the business's lock — Android / Web / Both / Off, lock after X minutes, fingerprint/face
//            allowed — PATCH /api/app-lock/policy (owner only, audited on the server).
//   Android: each person's own fingerprint/face unlock, opt-in, with the shared-phone warning.
// The start date is decided by the server (APP_LOCK_DEFAULT_START or the owner's own) and only shown here.
import { useEffect, useState } from "react";
import api from "../utils/api";
import { useAuthStore } from "../store";
import { isNative, savePolicyCopy, biometricState, biometricStatus, enableBiometric, disableBiometric } from "../utils/appLock";

const MINUTES = [1, 2, 5, 10, 15, 30];
const MODES = [
  { key: "both", android: true, web: true, fr: "Android et Web", en: "Android and web" },
  { key: "android", android: true, web: false, fr: "Android seulement", en: "Android only" },
  { key: "web", android: false, web: true, fr: "Web seulement", en: "Web only" },
  { key: "off", android: false, web: false, fr: "Désactivé", en: "Off" },
];
const modeOf = (p) => (MODES.find((m) => m.android === !!p.lock_android && m.web === !!p.lock_web) || MODES[0]).key;

export default function AppLockSettingsCard({ lang }) {
  const en = lang === "en";
  const user = useAuthStore((s) => s.user);
  const org = useAuthStore((s) => s.org);
  const isOwner = user && user.role === "owner";
  const [policy, setPolicy] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
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
      setDraft({ mode: modeOf(d), minutes: d.lock_after_minutes, bio: d.biometric_allowed });
    }).catch(() => { if (alive) setErr(en ? "The app lock setting could not be read." : "Impossible de lire le réglage du verrouillage."); });
    if (isNative() && user) {
      biometricState(user.id).then((s) => alive && setBio(s));
      biometricStatus().then((s) => alive && setBioSt(s));
    }
    return () => { alive = false; };
  }, [user && user.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft || saving) return;
    const m = MODES.find((x) => x.key === draft.mode);
    setSaving(true); setErr(""); setSaved(false);
    try {
      const r = await api.patch("/app-lock/policy", { lock_android: m.android, lock_web: m.web, lock_after_minutes: draft.minutes, biometric_allowed: draft.bio }, { timeout: 10000 });
      const d = r.data && r.data.data;
      setPolicy(d); setSaved(true);
      if (org) savePolicyCopy(org.id, d);
    } catch (e) {
      const b = e && e.response && e.response.data;
      setErr((b && (en ? b.message_en : b.message_fr)) || (en ? "Could not save." : "Échec de l'enregistrement."));
    } finally { setSaving(false); }
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

  const startText = () => {
    if (!policy) return "";
    if (!policy.starts_at) return en ? "Start date: not set yet — it will be announced in the app first." : "Date de début : pas encore fixée — elle sera annoncée dans l'application.";
    const d = new Date(policy.starts_at).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return policy.active ? (en ? `Active since ${d}.` : `Actif depuis le ${d}.`) : (en ? `Starts on ${d}.` : `Commence le ${d}.`);
  };
  const bioReason = {
    none_enrolled: en ? "Add a fingerprint or face in this phone's settings first." : "Ajoutez d'abord une empreinte ou un visage dans les réglages du téléphone.",
    no_hardware: en ? "This phone has no fingerprint or face sensor strong enough." : "Ce téléphone n'a pas de capteur d'empreinte ou de visage assez sûr.",
    unsupported: en ? "Not available on this phone." : "Non disponible sur ce téléphone.",
    old_android: en ? "Needs Android 7 or newer." : "Nécessite Android 7 ou plus récent.",
  }[bioSt.reason] || (en ? "Not available on this phone." : "Non disponible sur ce téléphone.");

  const showBio = isNative() && policy && policy.biometric_allowed && policy.lock_android;
  if (!isOwner && !showBio) return null;

  return (
    <div data-app-lock-settings style={{ marginTop: 20, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>🔒 {en ? "App lock" : "Verrouillage de l'application"}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, marginBottom: 16 }}>
        {en ? "Asks for the signed-in person's password when the app opens and after a while without use."
            : "Demande le mot de passe de la personne connectée à l'ouverture et après un moment sans utilisation."}
      </div>
      {isOwner && draft && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }} role="radiogroup" aria-label={en ? "Where" : "Où"}>
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={draft.mode === m.key} data-app-lock-mode={m.key}
                onClick={() => setDraft({ ...draft, mode: m.key })}
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
              <select className="input" value={draft.minutes} data-app-lock-minutes onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}>
                {MINUTES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={draft.bio} data-app-lock-bio-allowed onChange={(e) => setDraft({ ...draft, bio: e.target.checked })} />
              {en ? "Allow fingerprint / face unlock (Android)" : "Autoriser l'empreinte / le visage (Android)"}
            </label>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 12px" }}>{startText()}</div>
          {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{err}</div>}
          {saved && <div style={{ color: "#34d399", fontSize: 12, marginBottom: 12 }}>{en ? "Saved." : "Enregistré."}</div>}
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save} data-app-lock-save>
            {saving ? (en ? "Saving…" : "Enregistrement…") : (en ? "Save" : "Enregistrer")}
          </button>
        </>
      )}
      {isOwner && !draft && err && <div style={{ color: "#f87171", fontSize: 12 }}>{err}</div>}
      {showBio && (
        <div style={{ marginTop: isOwner ? 20 : 0, paddingTop: isOwner ? 16 : 0, borderTop: isOwner ? "1px solid var(--border)" : "none" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{en ? "Unlock with my fingerprint / face" : "Déverrouiller avec mon empreinte / visage"}</div>
          <div style={{ fontSize: 12, color: "#FBC503", margin: "4px 0 10px" }}>
            {en ? "Only if this phone is yours: anyone whose finger or face is saved on this phone could unlock your session."
                : "Seulement si ce téléphone est le vôtre : toute personne dont l'empreinte ou le visage est enregistré sur ce téléphone pourrait ouvrir votre session."}
          </div>
          {bioSt.available ? (
            <button type="button" className="btn" disabled={bioBusy} onClick={toggleBio} data-app-lock-bio-toggle={bio}>
              {bio === "off" ? (en ? "Turn on" : "Activer") : (en ? "Turn off" : "Désactiver")}
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
