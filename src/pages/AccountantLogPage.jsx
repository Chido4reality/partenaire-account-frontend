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
import { useState, useMemo, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import { useCurrency } from "../utils/useCurrency";
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
  const [detailStaff, setDetailStaff] = useState(null);  // open staff's activity screen
  const [deepLink, setDeepLink] = useState(null);        // { highlightId, initialDay } from a tapped alert
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: watchedResp, isLoading } = useQuery({
    queryKey: ["accountant-log-watched"],
    queryFn: () => api.get("/staff/watched").then(r => r.data),
    enabled: entitled,
  });
  const staff = watchedResp?.data || [];

  // ── Phase 3 alert on/off preference (org-level, default ON) ──
  const { data: alertResp } = useQuery({
    queryKey: ["accountant-alert-settings"],
    queryFn: () => api.get("/staff/alert-settings").then(r => r.data),
    enabled: entitled,
  });
  const alertsEnabled = alertResp?.data?.alerts_enabled !== false;
  const toggleAlerts = useMutation({
    mutationFn: (next) => api.patch("/staff/alert-settings", { alerts_enabled: next }),
    onSuccess: (_d, next) => {
      toast.success(next ? (en ? "Instant alerts on" : "Alertes instantanées activées")
                         : (en ? "Instant alerts off" : "Alertes instantanées désactivées"));
      qc.invalidateQueries({ queryKey: ["accountant-alert-settings"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  // ── Phase 3 deep-link: a tapped alert in the bell lands here as ?audit=<id>.
  // Resolve it → the staff member + the entry's day, open their activity screen
  // and highlight the row. Clear the param so refresh/back doesn't re-fire. ──
  useEffect(() => {
    const auditId = searchParams.get("audit");
    if (!auditId || !entitled) return;
    let cancelled = false;
    api.get(`/staff/activity/by-audit/${auditId}`)
      .then((r) => {
        if (cancelled) return;
        const d = r.data?.data;
        if (d?.staff) {
          setDetailStaff(d.staff);
          setDeepLink({ highlightId: d.audit_id, initialDay: (d.created_at || "").slice(0, 10) });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        const sp = new URLSearchParams(searchParams);
        sp.delete("audit");
        setSearchParams(sp, { replace: true });
      });
    return () => { cancelled = true; };
  }, [searchParams, entitled]); // eslint-disable-line react-hooks/exhaustive-deps

  // WhatsApp share of today's summary — matches the app's client wa.me pattern
  // (there is no server-side WhatsApp/push transport; see accountantDigest.js).
  const shareTodayToWhatsApp = async () => {
    try {
      const { from, to } = computeRange("today", null);
      const r = await api.get(`/staff/activity-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const s = r.data?.data;
      if (!s || Number(s.total_actions) === 0) { toast(en ? "No activity today" : "Aucune activité aujourd'hui"); return; }
      const hi = Number(s.high_count || 0);
      const msg = en
        ? `Accountant Log — today: ${hi} thing${hi === 1 ? "" : "s"} to check. ${Number(s.voids)} cancelled sales, ${Number(s.refunds)} refunds, ${Number(s.stock_adjustments)} stock changes, ${Number(s.deletes)} deletions.`
        : `Journal du comptable — aujourd'hui : ${hi} chose${hi === 1 ? "" : "s"} à vérifier. ${Number(s.voids)} ventes annulées, ${Number(s.refunds)} remboursements, ${Number(s.stock_adjustments)} modifs de stock, ${Number(s.deletes)} suppressions.`;
      const enc = encodeURIComponent(msg);
      try { window.open(`https://wa.me/?text=${enc}`, "_blank", "noopener"); }
      catch (_) { window.location.href = `https://wa.me/?text=${enc}`; }
    } catch (_) { toast.error(en ? "Error" : "Erreur"); }
  };

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

  // ── Phase 5b: pending approvals (owner inbox) ──
  const fmtCur = useCurrency();
  const { data: approvalsResp } = useQuery({
    queryKey: ["staff-approvals-pending"],
    queryFn: () => api.get("/staff/approvals?status=pending").then((r) => r.data),
    enabled: entitled,
    refetchInterval: 30000, // keep the owner's inbox fresh
  });
  const pendingApprovals = approvalsResp?.data || [];
  const [pinFor, setPinFor] = useState(null);     // approval row being approved (PIN prompt)
  const [pinValue, setPinValue] = useState("");
  const [rejectFor, setRejectFor] = useState(null); // approval row being rejected (note prompt)
  const [rejectNote, setRejectNote] = useState("");

  const APPROVAL_VERB = {
    void: en ? "cancel a sale" : "annuler une vente",
    refund: en ? "give a refund" : "faire un remboursement",
    stock_adjust: en ? "change stock" : "modifier le stock",
    debt_adjust: en ? "change a customer's debt" : "modifier la dette d'un client",
    delete_customer: en ? "delete a customer" : "supprimer un client",
    expense: en ? "record an expense" : "enregistrer une dépense",
    discount: en ? "apply a discount" : "appliquer une remise",
  };

  const approveMut = useMutation({
    mutationFn: ({ id, pin }) => api.post(`/staff/approvals/${id}/approve`, { pin }),
    onSuccess: () => {
      toast.success(en ? "Approved — staff will complete it" : "Approuvé — le personnel le finalisera");
      setPinFor(null); setPinValue("");
      qc.invalidateQueries({ queryKey: ["staff-approvals-pending"] });
      qc.invalidateQueries({ queryKey: ["accountant-log-watched"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Could not approve" : "Échec de l'approbation")),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, note }) => api.post(`/staff/approvals/${id}/reject`, { note }),
    onSuccess: () => {
      toast.success(en ? "Rejected" : "Rejeté");
      setRejectFor(null); setRejectNote("");
      qc.invalidateQueries({ queryKey: ["staff-approvals-pending"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Could not reject" : "Échec du rejet")),
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

  // Tapping a watched-staff row (or an alert in the bell) opens this person's
  // full activity screen in place of the list — bigger + more scannable.
  if (detailStaff) return wrap(
    <StaffActivityView staff={detailStaff} en={en}
      initialDay={deepLink?.initialDay} highlightId={deepLink?.highlightId}
      onBack={() => { setDetailStaff(null); setDeepLink(null); }} />
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

      {/* Controls: instant-alerts on/off + WhatsApp share of today's summary */}
      <div className="card" style={{ marginTop: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>🔔 {en ? "Instant alerts" : "Alertes instantanées"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {en ? "Get warned the moment a staff member does something to check." : "Soyez prévenu dès qu'un employé fait une action à vérifier."}
          </div>
        </div>
        {/* simple switch */}
        <button
          onClick={() => toggleAlerts.mutate(!alertsEnabled)}
          disabled={toggleAlerts.isPending}
          aria-label="toggle instant alerts"
          style={{
            width: 50, height: 28, borderRadius: 999, border: "none", cursor: "pointer", flexShrink: 0, position: "relative",
            background: alertsEnabled ? "var(--brand)" : "var(--border-hover)", transition: "background .15s",
          }}>
          <span style={{
            position: "absolute", top: 3, left: alertsEnabled ? 25 : 3, width: 22, height: 22, borderRadius: "50%",
            background: "#fff", transition: "left .15s",
          }} />
        </button>
        <button className="btn btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={shareTodayToWhatsApp}>
          📤 {en ? "WhatsApp" : "WhatsApp"}
        </button>
      </div>

      {/* Phase 5b — pending approvals (owner inbox) */}
      {pendingApprovals.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden", border: "1px solid rgba(245,158,11,0.5)" }}>
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.12)" }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#fbbf24" }}>
              {en ? "Waiting for your approval" : "En attente de votre approbation"}
            </span>
            <span style={{ marginLeft: "auto", background: "#f59e0b", color: "#1a1a1a", borderRadius: 999, padding: "1px 9px", fontSize: 13, fontWeight: 800 }}>
              {pendingApprovals.length}
            </span>
          </div>
          {pendingApprovals.map((a, i) => (
            <div key={a.id} style={{ padding: "12px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                {(a.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wants to" : "veut"} {APPROVAL_VERB[a.action_type] || a.action_type}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                {[a.amount != null ? fmtCur(Math.abs(Number(a.amount))) : null, a.target_ref, a.branch_name].filter(Boolean).join(" · ")}
                {" · "}{new Date(a.created_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setRejectNote(""); setRejectFor(a); }}>
                  ✕ {en ? "Reject" : "Rejeter"}
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setPinValue(""); setPinFor(a); }}>
                  ✓ {en ? "Approve" : "Approuver"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* ── APPROVE (PIN) MODAL ── */}
      {pinFor && (
        <div className="modal-overlay" onClick={() => setPinFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{en ? "Approve this action?" : "Approuver cette action ?"}</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 14 }}>
              {(pinFor.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wants to" : "veut"} {APPROVAL_VERB[pinFor.action_type] || pinFor.action_type}
              {pinFor.amount != null ? ` — ${fmtCur(Math.abs(Number(pinFor.amount)))}` : ""}{pinFor.target_ref ? ` — ${pinFor.target_ref}` : ""}.
              <br />{en ? "Approving gives the green light — the staff member completes it at the counter." : "Approuver donne le feu vert — l'employé la finalise au comptoir."}
            </div>
            <div className="form-group"><label className="label">{en ? "Enter your PIN to approve" : "Entrez votre code PIN pour approuver"}</label>
              <input className="input" type="password" inputMode="numeric" value={pinValue}
                onChange={e => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••" autoFocus />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPinFor(null)}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={pinValue.length < 4 || approveMut.isPending}
                onClick={() => approveMut.mutate({ id: pinFor.id, pin: pinValue })}>
                {approveMut.isPending ? "..." : (en ? "Approve & do it" : "Approuver et exécuter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECT MODAL ── */}
      {rejectFor && (
        <div className="modal-overlay" onClick={() => setRejectFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{en ? "Reject this request?" : "Rejeter cette demande ?"}</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 14 }}>
              {(rejectFor.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wanted to" : "voulait"} {APPROVAL_VERB[rejectFor.action_type] || rejectFor.action_type}.
            </div>
            <div className="form-group"><label className="label">{en ? "Reason (optional)" : "Raison (facultatif)"}</label>
              <input className="input" value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                placeholder={en ? "e.g. not needed" : "ex. pas nécessaire"} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setRejectFor(null)}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={rejectMut.isPending}
                onClick={() => rejectMut.mutate({ id: rejectFor.id, note: rejectNote.trim() || null })}>
                {rejectMut.isPending ? "..." : (en ? "Reject" : "Rejeter")}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Accountant Log Phase 2 — per-staff ACTIVITY screen. Read-only viewing only
// (no alerts, no PDF, no approvals). Money-first, plain language, big + scannable
// for a low-literacy boss.
// ════════════════════════════════════════════════════════════════════════════

// Local-day boundaries for the date filter. Returns ISO {from,to}; `to` is the
// EXCLUSIVE upper bound (the RPC compares created_at < p_to), so each window is
// [start-of-day, start-of-next-day).
function dayStartLocal(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function computeRange(range, pickedDay) {
  const now = new Date();
  if (range === "today") {
    const s = dayStartLocal(now); const e = new Date(s); e.setDate(e.getDate() + 1);
    return { from: s.toISOString(), to: e.toISOString() };
  }
  if (range === "week") {
    const s = dayStartLocal(now); const dow = (s.getDay() + 6) % 7; // Monday = 0
    s.setDate(s.getDate() - dow); const e = new Date(s); e.setDate(e.getDate() + 7);
    return { from: s.toISOString(), to: e.toISOString() };
  }
  // pick a day
  const s = dayStartLocal(new Date(pickedDay + "T00:00:00")); const e = new Date(s); e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
}

// Plain-language label for each audited action. Keep the wording simple +
// concrete — the boss may read slowly. `money` flags rows whose amount matters.
const ACTION_TEXT = {
  sale_voided:                      { en: "Cancelled a sale",            fr: "Vente annulée",                 money: true },
  sale_voided_approval:             { en: "Cancelled a sale (approved)", fr: "Vente annulée (approuvée)",     money: true },
  return_processed:                 { en: "Gave a refund",               fr: "Remboursement effectué",        money: true },
  customer_debt_manual_adjustment:  { en: "Changed a debt by hand",      fr: "Dette modifiée à la main",      money: true },
  customer_debt_adjusted:           { en: "Adjusted a customer's debt",  fr: "Dette client ajustée",          money: true },
  customer_debt_refund_adjustment:  { en: "Adjusted debt (refund)",      fr: "Dette ajustée (remboursement)", money: true },
  customer_credit_edited:           { en: "Changed a credit limit",      fr: "Limite de crédit modifiée" },
  invoice_written_off_via_debt_line:{ en: "Wrote off an unpaid bill",    fr: "Facture passée en perte" },
  customer_deleted:                 { en: "Deleted a customer",          fr: "Client supprimé",               money: true },
  stock_adjusted_manually:          { en: "Changed stock by hand",       fr: "Stock modifié à la main" },
  customer_edited:                  { en: "Edited a customer",           fr: "Client modifié" },
  customer_edited_by_cashier:       { en: "Edited a customer",           fr: "Client modifié" },
  debt_collected_no_invoice:        { en: "Collected debt (no bill)",    fr: "Dette encaissée (sans facture)", money: true },
  credit_extended_in_sale:          { en: "Gave credit in a sale",       fr: "Crédit accordé dans une vente",  money: true },
};
// Rich plain-language wording pulled straight from the audit row's new_data.
// `nd` = new_data; `money` = the org currency formatter (n)=>string. Every piece
// is gracefully omitted when missing. SHARED by the Phase-2 list, the bell deep-
// link target, and the Phase-4 PDF "What happened" column — one source of truth.
function actionText(a, en, nd, money) {
  const d = nd || {};
  const has = (v) => v != null && v !== "";
  const m = (v) => (money ? money(Math.abs(Number(v) || 0)) : String(Math.round(Math.abs(Number(v) || 0))));
  switch (a) {
    case "sale_voided":
    case "sale_voided_approval": {
      let s = has(d.sale_number)
        ? (en ? `cancelled invoice ${d.sale_number}` : `a annulé la facture ${d.sale_number}`)
        : (en ? "cancelled a sale" : "a annulé une vente");
      if (has(d.customer_name)) s += ` — ${d.customer_name}`;
      if (has(d.original_total_amount)) s += ` — ${m(d.original_total_amount)}`;
      if (has(d.reason)) s += en ? ` — reason: ${d.reason}` : ` — motif : ${d.reason}`;
      return s;
    }
    case "return_processed": {
      const ref = has(d.sale_number)
        ? (en ? `invoice ${d.sale_number}` : `facture ${d.sale_number}`)
        : (en ? "a sale" : "une vente");
      const amt = Number(d.refund_amount) || 0;
      if (amt > 0) {
        const method = has(d.refund_method) ? ` (${d.refund_method})` : "";
        return en ? `refunded ${m(amt)}${method} on ${ref}` : `a remboursé ${m(amt)}${method} sur ${ref}`;
      }
      return en ? `exchange on ${ref}` : `échange sur ${ref}`;
    }
    case "credit_extended_in_sale": {
      const who = has(d.target_name) ? d.target_name : (en ? "a customer" : "un client");
      const ext = has(d.extended) ? m(d.extended) : "";
      const inv = has(d.sale_number) ? (en ? ` (invoice ${d.sale_number})` : ` (facture ${d.sale_number})`) : "";
      return en ? `sold ${ext} on credit to ${who}${inv}`.replace(/\s+/g, " ").trim()
                : `a vendu ${ext} à crédit à ${who}${inv}`.replace(/\s+/g, " ").trim();
    }
    case "customer_debt_manual_adjustment": {
      const nm = d.customer_name || d.target_name;
      const who = has(nm) ? (en ? ` for ${nm}` : ` de ${nm}`) : "";
      let s = has(d.delta)
        ? (en ? `adjusted a customer's debt by ${m(d.delta)}${who}` : `a ajusté la dette d'un client de ${m(d.delta)}${who}`)
        : (en ? `adjusted a customer's debt${who}` : `a ajusté la dette d'un client${who}`);
      if (has(d.note)) s += ` — ${d.note}`;
      return s;
    }
    case "customer_credit_edited": {
      const who = has(d.target_name) ? d.target_name : (en ? "a customer" : "un client");
      let s = en ? `edited ${who}` : `a modifié ${who}`;
      const ch = d.changes && d.changes.credit_limit;
      if (ch && (has(ch.from) || has(ch.to))) {
        s += en ? ` — credit limit ${m(ch.from)} → ${m(ch.to)}` : ` — limite de crédit ${m(ch.from)} → ${m(ch.to)}`;
      }
      return s;
    }
    case "customer_deleted": {
      const who = has(d.target_name) ? d.target_name : (en ? "a customer" : "un client");
      let s = en ? `deleted customer ${who}` : `a supprimé le client ${who}`;
      if (has(d.total_debt)) s += en ? ` (debt was ${m(d.total_debt)})` : ` (dette : ${m(d.total_debt)})`;
      return s;
    }
    case "stock_adjusted_manually": {
      const prod = has(d.product_name) ? ` ${d.product_name}` : "";
      const from = has(d.from_quantity) ? d.from_quantity : "?";
      const to = has(d.to_quantity) ? d.to_quantity : "?";
      let s = en ? `changed stock${prod} ${from} → ${to}` : `a modifié le stock${prod} ${from} → ${to}`;
      if (has(d.reason)) s += ` — ${d.reason}`;
      return s;
    }
    default: {
      const t = ACTION_TEXT[a];
      if (t) return en ? t.en : t.fr;
      return String(a || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
}

// Phase-enhancement — readable label/value breakdown for the tap-detail modal
// (NOT raw JSON). Returns [{ label, value }] where value is a string or, for
// item lists, an array of lines. Amounts via `money`; everything missing-safe.
function detailFields(r, en, money) {
  const d = (r && r.new_data) || {};
  const has = (v) => v != null && v !== "";
  const m = (v) => (money ? money(Math.abs(Number(v) || 0)) : String(Math.round(Math.abs(Number(v) || 0))));
  const lines = (arr) => (arr || []).map((it) => {
    const qty = it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 0);
    const nm = it.name || it.product_name || it.product_id || "?";
    return `${qty} × ${nm}${has(it.unit_price) ? ` @ ${m(it.unit_price)}` : ""}`;
  });
  const F = [];
  switch (r && r.action) {
    case "sale_voided":
    case "sale_voided_approval":
      if (has(d.sale_number)) F.push({ label: en ? "Invoice" : "Facture", value: d.sale_number });
      if (has(d.customer_name)) F.push({ label: en ? "Customer" : "Client", value: d.customer_name });
      if (has(d.reason)) F.push({ label: en ? "Reason" : "Motif", value: d.reason });
      if (has(d.original_total_amount)) F.push({ label: en ? "Original total" : "Total initial", value: m(d.original_total_amount) });
      if (Array.isArray(d.items_returned) && d.items_returned.length) F.push({ label: en ? "Items" : "Articles", value: lines(d.items_returned) });
      if (has(d.customer_debt_before) || has(d.customer_debt_after))
        F.push({ label: en ? "Customer debt" : "Dette client", value: `${has(d.customer_debt_before) ? m(d.customer_debt_before) : "?"} → ${has(d.customer_debt_after) ? m(d.customer_debt_after) : "?"}` });
      break;
    case "return_processed": {
      if (has(d.sale_number)) F.push({ label: en ? "Invoice" : "Facture", value: d.sale_number });
      if (has(d.refund_amount)) F.push({ label: en ? "Refund" : "Remboursement", value: `${m(d.refund_amount)}${has(d.refund_method) ? ` (${d.refund_method})` : ""}` });
      if (has(d.return_type)) F.push({ label: "Type", value: d.return_type });
      const items = d.items || d.items_returned;
      if (Array.isArray(items) && items.length) F.push({ label: en ? "Items" : "Articles", value: lines(items) });
      const rep = d.replacements || d.replacement_items;
      if (Array.isArray(rep) && rep.length) F.push({ label: en ? "Replacements" : "Remplacements", value: lines(rep) });
      break;
    }
    case "customer_credit_edited":
    case "customer_edited":
    case "customer_edited_by_cashier":
    case "customer_debt_adjusted":
      if (has(d.target_name)) F.push({ label: en ? "Customer" : "Client", value: d.target_name });
      if (d.changes && typeof d.changes === "object") {
        Object.entries(d.changes).forEach(([field, ch]) => {
          if (!ch || typeof ch !== "object" || ch.from === ch.to) return;
          const moneyish = /limit|debt|amount|price/i.test(field);
          const fromV = moneyish && has(ch.from) ? m(ch.from) : (has(ch.from) ? String(ch.from) : "—");
          const toV = moneyish && has(ch.to) ? m(ch.to) : (has(ch.to) ? String(ch.to) : "—");
          F.push({ label: field.replace(/_/g, " "), value: `${fromV} → ${toV}` });
        });
      }
      break;
    case "customer_debt_manual_adjustment":
      if (has(d.delta)) F.push({ label: en ? "Change" : "Changement", value: m(d.delta) });
      if (has(d.customer_name || d.target_name)) F.push({ label: en ? "Customer" : "Client", value: d.customer_name || d.target_name });
      if (has(d.note)) F.push({ label: "Note", value: d.note });
      if (has(d.total_debt_after)) F.push({ label: en ? "New balance" : "Nouveau solde", value: m(d.total_debt_after) });
      break;
    case "stock_adjusted_manually":
      if (has(d.product_name)) F.push({ label: en ? "Product" : "Produit", value: d.product_name });
      F.push({ label: "Stock", value: `${has(d.from_quantity) ? d.from_quantity : "?"} → ${has(d.to_quantity) ? d.to_quantity : "?"}` });
      if (has(d.reason)) F.push({ label: en ? "Reason" : "Motif", value: d.reason });
      break;
    case "customer_deleted":
      if (has(d.target_name)) F.push({ label: en ? "Customer" : "Client", value: d.target_name });
      if (has(d.total_debt)) F.push({ label: en ? "Debt was" : "Dette", value: m(d.total_debt) });
      break;
    default:
      break;
  }
  return F;
}

const RISK = {
  high:   { dot: "#ef4444", bg: "rgba(239,68,68,0.12)", fg: "#fca5a5" },
  medium: { dot: "#f59e0b", bg: "rgba(245,158,11,0.12)", fg: "#fbbf24" },
  normal: { dot: "#64748b", bg: "transparent",           fg: "var(--text-muted)" },
};

function timeLabel(iso, en) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(en ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" })
    + " · " + d.toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short" });
}

// ── Phase 4: build the printable EVIDENCE PACK as a self-contained HTML doc,
// rendered in the app's print overlay (window.print → "Save as PDF") — the app
// has no PDF library; this mirrors the FACTURE print path. Black-on-white, A4.
// "What happened" REUSES the Phase-2 actionText() templates (same FR/EN
// wording); amounts use the org currency formatter (fmt, handles NGN/XAF).
function buildEvidenceHtml({ data, en, fmt }) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const b = (data && data.business) || {};
  const st = (data && data.staff) || {};
  const rows = (data && data.rows) || [];
  const range = (data && data.range) || {};
  const p2 = (n) => String(n).padStart(2, "0");
  const dt = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const dateOnly = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };

  const title = en ? "Staff Activity Evidence Report" : "Rapport d'activité du personnel (preuve)";
  const fromTo = (() => {
    const f = dateOnly(range.from);
    // range.to is the EXCLUSIVE end (next-day midnight) — show the inclusive last day.
    const t = range.to ? dateOnly(new Date(new Date(range.to).getTime() - 1).toISOString()) : null;
    if (f && t) return `${f} → ${t}`;
    if (f) return `${en ? "from" : "du"} ${f}`;
    return en ? "All time" : "Tout l'historique";
  })();
  const gen = (() => { const d = new Date(); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; })();

  const letter = [];
  if (b.logo_url) letter.push(`<img class="logo" src="${esc(b.logo_url)}" />`);
  if (b.name) letter.push(`<div class="biz-name">${esc(b.name)}</div>`);
  const sub1 = [b.mp_id, [b.address, b.city, b.country].filter(Boolean).join(", ")].filter(Boolean).map(esc).join(" · ");
  if (sub1) letter.push(`<div class="biz-sub">${sub1}</div>`);
  const tel = [b.phone, b.whatsapp_number].filter(Boolean).map(esc).join(" / ");
  if (tel) letter.push(`<div class="biz-sub">${en ? "Tel" : "Tél"}: ${tel}</div>`);

  const ident = [
    `<tr><td class="k">${en ? "Name" : "Nom"}</td><td>${esc(st.full_name) || "—"}</td></tr>`,
    `<tr><td class="k">${en ? "Role" : "Rôle"}</td><td>${esc(roleLabel(st.role, en))}${st.job_title ? ` — ${esc(st.job_title)}` : ""}</td></tr>`,
    `<tr><td class="k">${en ? "National ID" : "Pièce d'identité"}</td><td>${esc(st.national_id) || "—"}</td></tr>`,
    st.phone ? `<tr><td class="k">${en ? "Phone" : "Téléphone"}</td><td>${esc(st.phone)}</td></tr>` : "",
    `<tr><td class="k">${en ? "Period" : "Période"}</td><td>${esc(fromTo)}</td></tr>`,
    `<tr><td class="k">${en ? "Generated on" : "Généré le"}</td><td>${esc(gen)}</td></tr>`,
  ].join("");

  const head = `<tr><th>#</th><th>${en ? "Date & time" : "Date & heure"}</th><th>${en ? "What happened" : "Ce qui s'est passé"}</th><th>${en ? "Branch" : "Boutique"}</th><th class="r">${en ? "Amount" : "Montant"}</th><th>${en ? "Reason" : "Raison"}</th><th>${en ? "Approved by" : "Approuvé par"}</th></tr>`;

  const body = rows.length ? rows.map((r) => {
    const hi = r.risk_level === "high";
    const amt = (r.amount != null && r.amount !== "") ? esc(fmt(Math.abs(Number(r.amount)))) : "—";
    return `<tr class="${hi ? "hi" : ""}">`
      + `<td class="c">${esc(r.seq)}${hi ? ' <span class="flag">⚠</span>' : ""}</td>`
      + `<td>${dt(r.created_at)}</td>`
      + `<td>${esc(actionText(r.action, en, r.new_data, fmt))}</td>`
      + `<td>${esc(r.branch_name) || "—"}</td>`
      + `<td class="r">${amt}</td>`
      + `<td>${esc(r.reason) || "—"}</td>`
      + `<td>${esc(r.approver_name) || "—"}</td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty c">${en ? "No recorded activity in this period." : "Aucune activité enregistrée sur cette période."}</td></tr>`;

  const footLine = en
    ? "This report is generated from a tamper-proof, append-only activity log."
    : "Ce rapport provient d'un journal d'activité infalsifiable et en ajout seul.";

  return `<style>
    .mp-ev, .mp-ev * { box-sizing:border-box; color:#000; }
    .mp-ev { font-family:Arial,Helvetica,sans-serif; font-size:11px; background:#fff; max-width:820px; margin:0 auto; padding:16px; }
    .mp-ev .head { text-align:center; border-bottom:2px solid #000; padding-bottom:8px; }
    .mp-ev .logo { max-height:60px; max-width:180px; object-fit:contain; display:block; margin:0 auto 4px; }
    .mp-ev .biz-name { font-weight:bold; font-size:16px; }
    .mp-ev .biz-sub { font-size:11px; }
    .mp-ev .title { text-align:center; font-weight:bold; font-size:14px; letter-spacing:.5px; margin:10px 0; text-transform:uppercase; }
    .mp-ev .ident { display:flex; gap:12px; align-items:flex-start; margin-bottom:10px; }
    .mp-ev .photo { width:84px; height:104px; object-fit:cover; border:1px solid #000; flex-shrink:0; }
    .mp-ev table.id { border-collapse:collapse; flex:1; }
    .mp-ev table.id td { border:1px solid #999; padding:3px 6px; font-size:11px; }
    .mp-ev table.id td.k { background:#f0f0f0; font-weight:bold; width:130px; white-space:nowrap; }
    .mp-ev table.log { border-collapse:collapse; width:100%; }
    .mp-ev table.log th, .mp-ev table.log td { border:1px solid #999; padding:4px 5px; font-size:10px; vertical-align:top; word-break:break-word; }
    .mp-ev table.log th { background:#e8e8e8; text-align:left; }
    .mp-ev table.log .c { text-align:center; } .mp-ev table.log .r { text-align:right; white-space:nowrap; }
    .mp-ev table.log tr.hi td { background:#fdecec; font-weight:bold; }
    .mp-ev table.log tr.hi td:first-child { border-left:3px solid #d00; }
    .mp-ev .flag { color:#d00; }
    .mp-ev .empty { color:#666; padding:14px; }
    .mp-ev table.log tfoot td { border:none; padding-top:6px; font-size:10px; text-align:center; font-style:italic; }
    @media print {
      .mp-ev table.log thead { display: table-header-group; }
      .mp-ev table.log tfoot { display: table-footer-group; }
      .mp-ev table.log tr { page-break-inside: avoid; }
    }
  </style>
  <div class="mp-ev">
    <div class="head">${letter.join("")}</div>
    <div class="title">${esc(title)}</div>
    <div class="ident">
      ${st.photo_url ? `<img class="photo" src="${esc(st.photo_url)}" />` : ""}
      <table class="id"><tbody>${ident}</tbody></table>
    </div>
    <table class="log">
      <thead>${head}</thead>
      <tfoot><tr><td colspan="7">${esc(footLine)}</td></tr></tfoot>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

// Phase 5a — the actions an owner can Allow/Block per staff member. Keys map to
// pa_staff_permissions policy columns. Plain, low-literacy wording.
const PERM_ACTIONS = [
  { key: "void_policy",         en: "Cancel a sale",        fr: "Annuler une vente" },
  { key: "refund_policy",       en: "Give a refund",        fr: "Faire un remboursement" },
  { key: "stock_adjust_policy", en: "Change stock by hand", fr: "Modifier le stock à la main" },
  { key: "debt_adjust_policy",  en: "Change / forgive debt", fr: "Modifier / annuler une dette" },
  { key: "delete_policy",       en: "Delete a customer",    fr: "Supprimer un client" },
  { key: "discount_policy",     en: "Give a discount",      fr: "Faire une remise" },
  { key: "expense_policy",      en: "Record an expense",    fr: "Enregistrer une dépense" },
];

function StaffActivityView({ staff, en, onBack, initialDay, highlightId }) {
  const fmt = useCurrency();
  // Deep-linked from a tapped alert → land on that entry's day so it's visible.
  const [range, setRange] = useState(initialDay ? "day" : "today"); // today | week | day
  const [pickedDay, setPickedDay] = useState(() => initialDay || new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState("everything");      // everything | check
  const [detailRow, setDetailRow] = useState(null);  // tapped activity row → detail modal

  // ── Phase 4 evidence export ──
  const [showExport, setShowExport] = useState(false);
  const [exFrom, setExFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [exTo, setExTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [printHtml, setPrintHtml] = useState(null);

  // Default the export range to whatever is selected on screen.
  const openExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (range === "day") { setExFrom(pickedDay); setExTo(pickedDay); }
    else if (range === "week") {
      const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow);
      setExFrom(d.toISOString().slice(0, 10)); setExTo(today);
    } else { setExFrom(today); setExTo(today); }
    setShowExport(true);
  };

  const doExport = async () => {
    try {
      setExporting(true);
      const fromIso = new Date(exFrom + "T00:00:00").toISOString();
      const toD = new Date(exTo + "T00:00:00"); toD.setDate(toD.getDate() + 1); // inclusive of exTo
      const r = await api.get(`/staff/evidence?user_id=${staff.id}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toD.toISOString())}`);
      setPrintHtml(buildEvidenceHtml({ data: r.data?.data, en, fmt }));
      setShowExport(false);
    } catch (_) {
      toast.error(en ? "Could not generate the report" : "Impossible de générer le rapport");
    } finally { setExporting(false); }
  };

  // ── Phase 5a staff limits (allow/block + caps) ──
  const [showPerms, setShowPerms] = useState(false);
  const [perms, setPerms] = useState(null);
  const [permsBusy, setPermsBusy] = useState(false);

  const openPerms = async () => {
    setShowPerms(true); setPerms(null);
    try {
      const r = await api.get(`/staff/permissions/${staff.id}`);
      setPerms(r.data?.data || null);
    } catch (_) {
      toast.error(en ? "Could not load permissions" : "Impossible de charger les permissions");
      setShowPerms(false);
    }
  };
  const setPolicy = (key, value) => setPerms((p) => ({ ...p, [key]: value }));
  const setCap = (key, value) => setPerms((p) => ({ ...p, [key]: value }));
  const savePerms = async () => {
    if (!perms) return;
    try {
      setPermsBusy(true);
      const body = {
        max_discount_pct: perms.max_discount_pct === "" ? null : perms.max_discount_pct,
        max_expense_amount: perms.max_expense_amount === "" ? null : perms.max_expense_amount,
        approve_above_amount: perms.approve_above_amount === "" ? null : perms.approve_above_amount,
      };
      PERM_ACTIONS.forEach((a) => {
        const v = perms[a.key];
        body[a.key] = ["allow", "approve", "block"].includes(v) ? v : "allow";
      });
      await api.put(`/staff/permissions/${staff.id}`, body);
      toast.success(en ? "Permissions saved" : "Permissions enregistrées");
      setShowPerms(false);
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Could not save" : "Échec de l'enregistrement"));
    } finally { setPermsBusy(false); }
  };

  const { from, to } = useMemo(() => computeRange(range, pickedDay), [range, pickedDay]);
  const qs = `user_id=${staff.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const summaryQ = useQuery({
    queryKey: ["staff-activity-summary", staff.id, from, to],
    queryFn: () => api.get(`/staff/activity-summary?${qs}`).then((r) => r.data),
  });
  const activityQ = useQuery({
    queryKey: ["staff-activity", staff.id, from, to, tab],
    queryFn: () => api.get(`/staff/activity?${qs}&risk_only=${tab === "check"}&limit=200`).then((r) => r.data),
  });

  // MP-OPS-MONEY-EXPLAINABLE: the per-cashier money BRIDGE — read from the SAME
  // shared source as Operations (/dashboard/overview) so it can't diverge. Finds
  // this staff's scoreboard row to explain Total sales vs cash collected.
  const fromDate = String(from).slice(0, 10);
  const toDate = (() => { try { const d = new Date(to); d.setMilliseconds(d.getMilliseconds() - 1); return d.toISOString().slice(0, 10); } catch { return fromDate; } })();
  const bridgeQ = useQuery({
    queryKey: ["accountant-bridge", staff.id, fromDate, toDate],
    queryFn: () => api.get(`/dashboard/overview?from=${fromDate}&to=${toDate}`).then(r => r.data?.data || null),
  });
  const bridge = (bridgeQ.data?.cashiers || []).find(c => c.cashier_id === staff.id) || null;

  const summary = summaryQ.data?.data || null;
  let rows = activityQ.data?.data || [];
  // "Things to check" = HIGH risk only. The RPC's risk_only returns high+medium,
  // so we narrow to high client-side.
  if (tab === "check") rows = rows.filter((r) => r.risk_level === "high");

  const rangeBtn = (key, label) => (
    <button
      onClick={() => setRange(key)}
      style={{
        flex: 1, padding: "12px 6px", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer",
        border: `1.5px solid ${range === key ? "var(--brand)" : "var(--border)"}`,
        background: range === key ? "var(--brand)" : "var(--bg-elevated)",
        color: range === key ? "#1a1a1a" : "var(--text-primary)",
      }}>
      {label}
    </button>
  );

  // Money-first summary chips — only the buckets that actually happened.
  const chips = summary ? [
    { n: summary.voids,                label: en ? "Cancelled sales" : "Ventes annulées",   risk: true },
    { n: summary.refunds,              label: en ? "Refunds" : "Remboursements",            risk: true },
    { n: summary.debt_adjustments,     label: en ? "Debt changes" : "Modifs de dette",      risk: true },
    { n: summary.credit_limit_changes, label: en ? "Credit changes" : "Modifs de crédit",   risk: true },
    { n: summary.stock_adjustments,    label: en ? "Stock changes" : "Modifs de stock",     risk: true },
    { n: summary.deletes,              label: en ? "Deletions" : "Suppressions",            risk: true },
    { n: summary.write_offs,           label: en ? "Write-offs" : "Pertes",                 risk: true },
  ].filter((c) => Number(c.n) > 0) : [];

  const highCount = Number(summary?.high_count || 0);

  return (
    <>
      {/* Back */}
      <button className="btn btn-secondary" style={{ marginBottom: 12 }} onClick={onBack}>
        ← {en ? "Back to staff" : "Retour au personnel"}
      </button>

      {/* A) Header — reuse the watched-row styling */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>{staff.full_name}</span>
        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: roleColor(staff.role) + "20", color: roleColor(staff.role), fontWeight: 600 }}>
          {roleLabel(staff.role, en)}
        </span>
        {!staff.is_active && (
          <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: "rgba(239,68,68,0.15)", color: "#fca5a5", fontWeight: 600 }}>
            {en ? "Inactive" : "Inactif"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
        {staff.branch_name || (en ? "All branches" : "Toutes les boutiques")}
      </div>

      {/* Phase 4 evidence pack + Phase 5a staff limits */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={openExport}>
          📄 {en ? "Export evidence (PDF)" : "Exporter la preuve (PDF)"}
        </button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={openPerms}>
          🔒 {en ? "Permissions" : "Permissions"}
        </button>
      </div>

      {/* B) Date filter */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {rangeBtn("today", en ? "Today" : "Aujourd'hui")}
        {rangeBtn("week", en ? "This week" : "Cette semaine")}
        {rangeBtn("day", en ? "Pick a day" : "Choisir un jour")}
      </div>
      {range === "day" && (
        <input type="date" className="input" style={{ marginTop: 8 }} value={pickedDay}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setPickedDay(e.target.value)} />
      )}

      {/* C) Tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={() => setTab("everything")}
          style={{
            flex: 1, padding: "10px 6px", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
            border: "none", borderBottom: `3px solid ${tab === "everything" ? "var(--brand)" : "transparent"}`,
            background: "transparent", color: tab === "everything" ? "var(--text-primary)" : "var(--text-muted)",
          }}>
          {en ? "Everything" : "Tout"}
        </button>
        <button onClick={() => setTab("check")}
          style={{
            flex: 1, padding: "10px 6px", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
            border: "none", borderBottom: `3px solid ${tab === "check" ? "#ef4444" : "transparent"}`,
            background: "transparent", color: tab === "check" ? "#fca5a5" : "var(--text-muted)",
          }}>
          {en ? "Things to check" : "À vérifier"}{highCount > 0 ? ` (${highCount})` : ""}
        </button>
      </div>

      {/* D) Summary band — money-first */}
      <div className="card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, marginBottom: chips.length ? 12 : 0,
          background: highCount > 0 ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
        }}>
          <span style={{ fontSize: 22 }}>{highCount > 0 ? "⚠️" : "👍"}</span>
          <div style={{ fontWeight: 700, fontSize: 15, color: highCount > 0 ? "#fca5a5" : "#34d399" }}>
            {highCount > 0
              ? (en ? `${highCount} thing${highCount > 1 ? "s" : ""} to check` : `${highCount} chose${highCount > 1 ? "s" : ""} à vérifier`)
              : (en ? "Nothing to check" : "Rien à vérifier")}
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
            {en ? "Total actions" : "Actions totales"}: <strong style={{ color: "var(--text-primary)" }}>{Number(summary?.total_actions || 0)}</strong>
          </div>
        </div>
        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {chips.map((c) => (
              <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12, fontWeight: 600 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>{Number(c.n)}</span> {c.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* D2) MONEY BRIDGE — why Total sales ≠ Cash collected (shared source). */}
      {bridge && (Number(bridge.total_sales) > 0 || Number(bridge.voided_receipts_total) > 0) && (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>
            {en ? "Money bridge" : "Pont d'argent"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
            {en
              ? "Total sales = Cash (valid) + MoMo (valid) + Credit given. Voided receipts sit OUTSIDE — never inside cash."
              : "Ventes totales = Espèces (valides) + MoMo (valides) + Crédit accordé. Les reçus annulés sont EN DEHORS — jamais dans les espèces."}
          </div>
          {(() => {
            const Row = ({ label, val, note, color, strong, indent }) => (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderTop: "1px solid var(--border)", paddingLeft: indent ? 12 : 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: strong ? 800 : 600, fontSize: 13, color: color || "var(--text-primary)" }}>{label}</div>
                  {note && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{note}</div>}
                </div>
                <div style={{ fontWeight: strong ? 800 : 600, fontSize: 13, color: color || "var(--text-primary)", whiteSpace: "nowrap" }}>{fmt(val || 0)}</div>
              </div>
            );
            return (
              <div>
                <Row strong label={en ? "Total sales" : "Ventes totales"} val={bridge.total_sales}
                  note={en ? "goods sold (excludes voided & debt lines)" : "marchandises vendues (hors annulés & lignes de dette)"} />
                <Row indent label={en ? "= Cash (valid)" : "= Espèces (valides)"} val={bridge.cash_valid != null ? bridge.cash_valid : bridge.cash_collected}
                  note={en ? "cash received for valid sales; excludes cancelled receipts" : "espèces reçues pour ventes valides; hors reçus annulés"} />
                <Row indent label={en ? "+ MoMo (valid)" : "+ MoMo (valides)"} val={bridge.momo_collected}
                  note={en ? "mobile money received" : "mobile money reçu"} />
                <Row indent label={en ? "+ Credit given" : "+ Crédit accordé"} val={bridge.credit_given}
                  note={en ? "left unpaid on valid sales today" : "resté impayé sur ventes valides"} />
                {Number(bridge.debt_collected) > 0 && (
                  <Row indent label={en ? "Debt collected (old credit)" : "Dette encaissée (ancien crédit)"} val={bridge.debt_collected}
                    note={en ? "old credit repaid — not a new sale" : "ancien crédit remboursé — pas une nouvelle vente"} />
                )}
                {Number(bridge.voided_receipts_total) > 0 && (
                  <Row strong color="#f87171" label={en ? "⚠ Voided receipts (paid then cancelled)" : "⚠ Reçus annulés (payés puis annulés)"} val={bridge.voided_receipts_total}
                    note={en ? "OUTSIDE cash collected — confirm the money was returned" : "EN DEHORS des espèces — confirmez que l'argent a été rendu"} />
                )}
                {Array.isArray(bridge.voided_receipts) && bridge.voided_receipts.map((v, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)", padding: "3px 0 3px 16px" }}>
                    <span style={{ fontFamily: "monospace" }}>{v.sale_number || "—"}{v.void_reason ? ` · ${v.void_reason}` : ""}</span>
                    <span style={{ color: "#f87171" }}>{fmt(v.amount)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* E) Activity list */}
      <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
        {activityQ.isLoading && <div style={{ padding: 18, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
        {!activityQ.isLoading && rows.length === 0 && (
          <div className="empty-state" style={{ padding: 26, textAlign: "center" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>{tab === "check" ? "✅" : "🗒️"}</div>
            <div style={{ fontWeight: 600 }}>
              {tab === "check"
                ? (en ? "Nothing to check here" : "Rien à vérifier ici")
                : (en ? "No activity in this period" : "Aucune activité sur cette période")}
            </div>
          </div>
        )}
        {rows.map((r, i) => {
          const rk = RISK[r.risk_level] || RISK.normal;
          const amt = r.amount != null && r.amount !== "" ? Number(r.amount) : null;
          const highlighted = highlightId && r.id === highlightId;
          return (
            <div key={r.id} onClick={() => setDetailRow(r)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              borderLeft: highlighted ? "3px solid var(--brand)" : "3px solid transparent",
              background: highlighted ? "rgba(251,197,3,0.12)" : (r.risk_level === "high" ? "rgba(239,68,68,0.05)" : "transparent"),
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: rk.dot, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{actionText(r.action, en, r.new_data, fmt)}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {timeLabel(r.created_at, en)}{r.branch_name ? ` · ${r.branch_name}` : ""}
                </div>
              </div>
              {amt != null && (
                <div style={{ fontWeight: 800, fontSize: 15, color: rk.fg !== "var(--text-muted)" ? rk.fg : "var(--text-primary)", whiteSpace: "nowrap" }}>
                  {fmt(Math.abs(amt))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 24 }} />

      {/* ── ACTIVITY DETAIL (tap a row) — readable label/value breakdown ── */}
      {detailRow && (
        <div className="modal-overlay" onClick={() => setDetailRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{actionText(detailRow.action, en, detailRow.new_data, fmt)}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              {timeLabel(detailRow.created_at, en)}{detailRow.branch_name ? ` · ${detailRow.branch_name}` : ""}
              {detailRow.amount != null && detailRow.amount !== "" ? ` · ${fmt(Math.abs(Number(detailRow.amount)))}` : ""}
            </div>
            {(() => {
              const F = detailFields(detailRow, en, fmt);
              if (!F.length) return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{en ? "No extra detail recorded." : "Aucun détail supplémentaire."}</div>;
              return F.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div style={{ width: 118, flexShrink: 0, fontSize: 12.5, color: "var(--text-muted)", textTransform: "capitalize" }}>{f.label}</div>
                  <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0, wordBreak: "break-word" }}>
                    {Array.isArray(f.value) ? f.value.map((line, j) => <div key={j}>{line}</div>) : f.value}
                  </div>
                </div>
              ));
            })()}
            <button className="btn btn-secondary" style={{ width: "100%", marginTop: 16 }} onClick={() => setDetailRow(null)}>{en ? "Close" : "Fermer"}</button>
          </div>
        </div>
      )}

      {/* ── EXPORT DATE-RANGE MODAL ── */}
      {showExport && (
        <div className="modal-overlay" onClick={() => setShowExport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              📄 {en ? "Export evidence" : "Exporter la preuve"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              {en ? `A printable activity report for ${staff.full_name} over the dates you choose.`
                  : `Un rapport d'activité imprimable pour ${staff.full_name} sur les dates choisies.`}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label">{en ? "From" : "Du"}</label>
                <input type="date" className="input" value={exFrom} max={exTo}
                  onChange={(e) => setExFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label">{en ? "To" : "Au"}</label>
                <input type="date" className="input" value={exTo} min={exFrom}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setExTo(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowExport(false)}>
                {en ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={exporting || !exFrom || !exTo} onClick={doExport}>
                {exporting ? "..." : (en ? "Generate report" : "Générer le rapport")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PERMISSIONS PANEL (Phase 5a staff limits) ── */}
      {showPerms && (
        <div className="modal-overlay" onClick={() => setShowPerms(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
              🔒 {en ? "Permissions" : "Permissions"} — {staff.full_name}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14, background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 10px" }}>
              {en
                ? "By default everyone is allowed everything. Block only what you want to restrict."
                : "Par défaut, tout le monde a le droit de tout faire. Bloquez seulement ce que vous voulez limiter."}
            </div>
            {!perms ? (
              <div style={{ padding: 18, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
            ) : (
              <>
                {PERM_ACTIONS.map((a) => {
                  const pol = perms[a.key] || "allow";
                  const seg = (val, label, bg, fg) => (
                    <button key={val} onClick={() => setPolicy(a.key, val)}
                      style={{ flex: 1, padding: "7px 4px", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer",
                        background: pol === val ? bg : "var(--bg-elevated)", color: pol === val ? fg : "var(--text-muted)" }}>
                      {label}
                    </button>
                  );
                  const blocked = pol === "block";
                  return (
                    <div key={a.key} style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{en ? a.en : a.fr}</div>
                      <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                        {seg("allow", en ? "Allowed" : "Autorisé", "rgba(16,185,129,0.9)", "#06281d")}
                        {seg("approve", en ? "Needs approval" : "Approbation", "rgba(245,158,11,0.9)", "#3a2400")}
                        {seg("block", en ? "Blocked" : "Bloqué", "rgba(239,68,68,0.9)", "#fff")}
                      </div>
                      {/* Caps tied to discount / expense */}
                      {a.key === "discount_policy" && !blocked && (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{en ? "Max discount %" : "Remise max %"}</span>
                          <input type="number" min="0" max="100" className="input" style={{ width: 110 }}
                            value={perms.max_discount_pct ?? ""} placeholder={en ? "no limit" : "sans limite"}
                            onChange={(e) => setCap("max_discount_pct", e.target.value)} />
                        </div>
                      )}
                      {a.key === "expense_policy" && !blocked && (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{en ? "Max expense amount" : "Dépense max"} ({fmt.symbol})</span>
                          <input type="number" min="0" className="input" style={{ width: 130 }}
                            value={perms.max_expense_amount ?? ""} placeholder={en ? "no limit" : "sans limite"}
                            onChange={(e) => setCap("max_expense_amount", e.target.value)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Approve-above threshold — even 'Allowed' actions ask for approval over this. */}
                <div style={{ marginTop: 4, marginBottom: 8, padding: "9px 11px", background: "var(--bg-elevated)", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                    {en ? "Approve any action above" : "Approuver toute action au-dessus de"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="number" min="0" className="input" style={{ flex: 1 }}
                      value={perms.approve_above_amount ?? ""} placeholder={en ? "no threshold" : "sans seuil"}
                      onChange={(e) => setCap("approve_above_amount", e.target.value)} />
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{fmt.symbol}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {en
                      ? "Even allowed actions will ask for your approval when the amount is this high or more."
                      : "Même les actions autorisées demanderont votre approbation à partir de ce montant."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPerms(false)}>{en ? "Cancel" : "Annuler"}</button>
                  <button className="btn btn-primary" style={{ flex: 2 }} disabled={permsBusy} onClick={savePerms}>
                    {permsBusy ? "..." : (en ? "Save permissions" : "Enregistrer")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── PRINT OVERLAY (mirrors the FACTURE print path; window.print → Save as PDF).
          @media print isolates this overlay so only the report prints; page numbers
          come from the print dialog's footer, the credibility line repeats via tfoot. ── */}
      {printHtml && (
        <div className="mp-print-overlay"
          style={{ position: "fixed", inset: 0, zIndex: 4000, background: "#fff", color: "#000", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .mp-print-overlay, .mp-print-overlay * { visibility: visible !important; }
              .mp-print-overlay { position: absolute !important; inset: 0 !important; }
              .mp-print-overlay .no-print { display: none !important; }
            }
          `}</style>
          <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", padding: 10, background: "#fff", borderBottom: "1px solid #ccc" }}>
            <button onClick={() => { try { window.print(); } catch (_) { /* ignore */ } }}
              style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none", background: "#152B52", color: "#fff", cursor: "pointer" }}>
              🖨️ {en ? "Print / Save as PDF" : "Imprimer / Enregistrer en PDF"}
            </button>
            <button onClick={() => setPrintHtml(null)}
              style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "1px solid #999", background: "#fff", color: "#333", cursor: "pointer" }}>
              ✕ {en ? "Close" : "Fermer"}
            </button>
          </div>
          <div dangerouslySetInnerHTML={{ __html: printHtml }} />
        </div>
      )}
    </>
  );
}
