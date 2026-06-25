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
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
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

  // Tapping a watched-staff row opens this person's full activity screen
  // (Phase 2) in place of the list — bigger + more scannable than a modal.
  if (detailStaff) return wrap(
    <StaffActivityView staff={detailStaff} en={en} onBack={() => setDetailStaff(null)} />
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
function actionText(a, en) {
  const t = ACTION_TEXT[a];
  if (t) return en ? t.en : t.fr;
  return String(a || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function StaffActivityView({ staff, en, onBack }) {
  const fmt = useCurrency();
  const [range, setRange] = useState("today");       // today | week | day
  const [pickedDay, setPickedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState("everything");      // everything | check

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
          return (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              background: r.risk_level === "high" ? "rgba(239,68,68,0.05)" : "transparent",
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: rk.dot, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{actionText(r.action, en)}</div>
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
    </>
  );
}
