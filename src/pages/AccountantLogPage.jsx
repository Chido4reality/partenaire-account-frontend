// Accountant Log — Phase 1 (FOUNDATION). OWNER-only, Pro Plus.
//
// Low-literacy shop owners hire a literate helper ("accountant") to run the app
// and fear theft. This screen lets the boss WATCH every non-owner staff member
// and keep control. Phase 1 stands up:
//   • the watched-staff list (all non-owner staff + their state + last activity)
//   • the boss's kill switch (Deactivate / Reactivate — reuses the existing
//     PATCH /auth/users/:id is_active toggle)
//   • "Add accountant" (reuses POST /auth/users with role pre-set to accountant;
//     starting PIN restricted to letters+numbers only)
//   • a placeholder detail screen (Phase 2 fills it with the activity feed).
// NO activity feed, NO approval logic here — those are later phases.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";

// Role badge colours — mirror SettingsPage ROLES.
const ROLE_META = {
  cashier:    { en: "Cashier",    fr: "Caissier",     color: "#94a3b8" },
  manager:    { en: "Manager",    fr: "Gestionnaire", color: "#818cf8" },
  warehouse:  { en: "Warehouse",  fr: "Magasinier",   color: "#34d399" },
  accountant: { en: "Accountant", fr: "Comptable",    color: "#22d3ee" },
};
const roleLabel = (r, en) => (ROLE_META[r] ? (en ? ROLE_META[r].en : ROLE_META[r].fr) : r);
const roleColor = (r) => ROLE_META[r]?.color || "#94a3b8";

// PIN/credential rule: letters + numbers only, no special characters.
const ALNUM = /[^a-zA-Z0-9]/g;

// Compact "last activity" — relative for recent, date for older. null → never.
function lastActivityLabel(iso, en) {
  if (!iso) return en ? "Never" : "Jamais";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return en ? "Just now" : "À l'instant";
  if (mins < 60) return en ? `${mins} min ago` : `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return en ? `${hrs}h ago` : `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return en ? `${days}d ago` : `il y a ${days}j`;
  return new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR");
}

export default function AccountantLogPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();

  // ── Entitlement (Pro Plus). Hooks stay above any early return. ──
  const { data: planResp } = useQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const entitled = hasFeature(planResp?.data?.effective_plan || "trial", "accountant_log");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", password: "" });
  const [confirmKill, setConfirmKill] = useState(null); // { staff, nextActive }
  const [detailStaff, setDetailStaff] = useState(null);  // placeholder detail target

  const { data: watchedResp, isLoading } = useQuery({
    queryKey: ["accountant-log-watched"],
    queryFn: () => api.get("/staff/watched").then(r => r.data),
    enabled: entitled,
  });
  const staff = watchedResp?.data || [];

  const addAccountant = useMutation({
    // Reuses the existing add-staff flow; role pre-set to 'accountant'.
    mutationFn: () => api.post("/auth/users", {
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      password: form.password,
      role: "accountant",
    }),
    onSuccess: () => {
      toast.success(en ? "Accountant added" : "Comptable ajouté");
      setShowAdd(false);
      setForm({ full_name: "", phone: "", password: "" });
      qc.invalidateQueries({ queryKey: ["accountant-log-watched"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  const toggleActive = useMutation({
    // The boss's kill switch — reuses the staff is_active toggle endpoint.
    mutationFn: ({ id, nextActive }) => api.patch(`/auth/users/${id}`, { is_active: nextActive }),
    onSuccess: (_d, vars) => {
      toast.success(vars.nextActive
        ? (en ? "Reactivated" : "Réactivé")
        : (en ? "Deactivated" : "Désactivé"));
      setConfirmKill(null);
      qc.invalidateQueries({ queryKey: ["accountant-log-watched"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  const wrap = (c) => <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>{c}</div>;

  // ── Pro Plus paywall (server also enforces a hard 403). ──
  if (!entitled) return wrap(
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>🛡️</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{en ? "Accountant Log — Pro Plus" : "Journal du comptable — Pro Plus"}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
        {en
          ? "Watch what every staff member does and keep control of your shop. Available on Pro Plus."
          : "Surveillez ce que fait chaque employé et gardez le contrôle de votre boutique. Disponible avec Pro Plus."}
      </div>
      <Link to="/request-activation?plan=pro_plus" className="btn btn-primary" style={{ textDecoration: "none" }}>
        🔒 {en ? "Upgrade to Pro Plus" : "Passer à Pro Plus"}
      </Link>
    </div>
  );

  const canSubmitAdd = form.full_name.trim() && form.phone.trim() && form.password.length >= 4 && !addAccountant.isPending;

  return wrap(
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>🛡️ {en ? "Accountant Log" : "Journal du comptable"}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
            {en ? "Everyone working in your shop, and your control over them." : "Tous ceux qui travaillent dans votre boutique, et votre contrôle sur eux."}
          </div>
        </div>
        <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} onClick={() => setShowAdd(true)}>
          + {en ? "Add accountant" : "Ajouter un comptable"}
        </button>
      </div>

      {/* Watched-staff list */}
      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        {isLoading && <div style={{ padding: 20, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
        {!isLoading && staff.length === 0 && (
          <div className="empty-state" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontWeight: 600 }}>{en ? "No staff to watch yet" : "Aucun employé à surveiller"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {en ? "Add an accountant or staff member to get started." : "Ajoutez un comptable ou un employé pour commencer."}
            </div>
          </div>
        )}
        {staff.map((s, i) => (
          <div key={s.id}
            onClick={() => setDetailStaff(s)}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              opacity: s.is_active ? 1 : 0.6,
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{s.full_name}</span>
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: roleColor(s.role) + "20", color: roleColor(s.role), fontWeight: 600 }}>
                  {roleLabel(s.role, en)}
                </span>
                {!s.is_active && (
                  <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: "rgba(239,68,68,0.15)", color: "#fca5a5", fontWeight: 600 }}>
                    {en ? "Inactive" : "Inactif"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                {(s.branch_name || (en ? "All branches" : "Toutes les boutiques"))} · {en ? "Last seen" : "Vu"} {lastActivityLabel(s.last_activity, en)}
              </div>
            </div>
            <button
              className="btn"
              style={{
                whiteSpace: "nowrap", padding: "6px 12px", fontSize: 13,
                background: s.is_active ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
                color: s.is_active ? "#fca5a5" : "#34d399",
                border: `1px solid ${s.is_active ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)"}`,
              }}
              onClick={(e) => { e.stopPropagation(); setConfirmKill({ staff: s, nextActive: !s.is_active }); }}>
              {s.is_active ? (en ? "Deactivate" : "Désactiver") : (en ? "Reactivate" : "Réactiver")}
            </button>
          </div>
        ))}
      </div>

      {/* ── ADD ACCOUNTANT MODAL (reuses the add-staff flow) ── */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{en ? "Add accountant" : "Ajouter un comptable"}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18 }}>
              {en ? "They log in with their phone number and this PIN." : "Il se connecte avec son téléphone et ce code PIN."}
            </div>
            <div className="form-group"><label className="label">{en ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jean Dupont" />
            </div>
            <div className="form-group"><label className="label">{en ? "Phone number" : "Téléphone"} *</label>
              <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group"><label className="label">{en ? "Starting PIN" : "Code PIN de départ"} *</label>
              {/* letters + numbers only, no special characters */}
              <input className="input" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value.replace(ALNUM, "") }))}
                placeholder={en ? "Letters and numbers only" : "Lettres et chiffres uniquement"} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {en ? "Letters and numbers only — no special characters. They can change it later." : "Lettres et chiffres uniquement — pas de caractères spéciaux. Modifiable plus tard."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!canSubmitAdd} onClick={() => addAccountant.mutate()}>
                {addAccountant.isPending ? "..." : (en ? "Add accountant" : "Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KILL-SWITCH CONFIRM ── */}
      {confirmKill && (
        <div className="modal-overlay" onClick={() => setConfirmKill(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>
              {confirmKill.nextActive ? (en ? "Reactivate this person?" : "Réactiver cette personne ?") : (en ? "Deactivate this person?" : "Désactiver cette personne ?")}
            </div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 18 }}>
              {confirmKill.nextActive
                ? (en ? `${confirmKill.staff.full_name} will be able to log in and use the app again.` : `${confirmKill.staff.full_name} pourra de nouveau se connecter et utiliser l'app.`)
                : (en ? `${confirmKill.staff.full_name} will be logged out and blocked from the app until you reactivate them.` : `${confirmKill.staff.full_name} sera déconnecté et bloqué jusqu'à réactivation.`)}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmKill(null)}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={toggleActive.isPending}
                onClick={() => toggleActive.mutate({ id: confirmKill.staff.id, nextActive: confirmKill.nextActive })}>
                {toggleActive.isPending ? "..." : (confirmKill.nextActive ? (en ? "Reactivate" : "Réactiver") : (en ? "Deactivate" : "Désactiver"))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DETAIL PLACEHOLDER (Phase 2 fills this with the activity feed) ── */}
      {detailStaff && (
        <div className="modal-overlay" onClick={() => setDetailStaff(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{detailStaff.full_name}</span>
              <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: roleColor(detailStaff.role) + "20", color: roleColor(detailStaff.role), fontWeight: 600 }}>
                {roleLabel(detailStaff.role, en)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
              {(detailStaff.branch_name || (en ? "All branches" : "Toutes les boutiques"))} · {en ? "Last seen" : "Vu"} {lastActivityLabel(detailStaff.last_activity, en)}
            </div>
            <div style={{ textAlign: "center", padding: "24px 8px", background: "var(--bg-elevated)", borderRadius: 12 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>👁️</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{en ? "Activity monitoring is coming" : "Le suivi d'activité arrive bientôt"}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 320, margin: "0 auto" }}>
                {en
                  ? "Soon you'll see every sale, payment, refund and change this person makes — right here."
                  : "Bientôt, vous verrez ici chaque vente, paiement, remboursement et modification de cette personne."}
              </div>
            </div>
            <button className="btn btn-secondary" style={{ width: "100%", marginTop: 16 }} onClick={() => setDetailStaff(null)}>
              {en ? "Close" : "Fermer"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
