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
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import { useCurrency } from "../utils/useCurrency";
import { SHOP_TZ } from "../utils/shopTime"; // MP-REPORT-TZ
import api from "../utils/api";
import { formatLastSeen, isRecentlyActive } from "../utils/lastSeen";
import { useStockCheckSummary, NOT_COUNTED_AMBER_AT } from "../utils/useStockCheckSummary";
import ApprovalDetailView from "../components/common/ApprovalDetailView"; // MP-APPROVAL-DETAIL (all types, on-expand)
import { explainAnomaly, severityCue, groupLabel, anomalySeverity } from "../utils/anomalyExplain";
import { momoLabel, momoLabelShort } from "../utils/paymentLabels";
import TransferDetailModal from "../components/TransferDetailModal"; // MP-STAFF-ACTIVITY-LEDGER Phase 3
import BufferDetailModal from "../components/BufferDetailModal";
import { LEDGER_TYPES, LEDGER_TYPE_ORDER, ltLabel, fmtLedgerWhen } from "../utils/ledgerTypes";
import HelpButton from "../components/common/HelpButton"; // MP-STAFF-ACTIVITY-LEDGER Phase 5

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

// MP-LAST-SEEN: relative "last seen" now lives in utils/lastSeen.js (shared with
// Settings → Staff) so the two screens can never format presence differently.

export default function AccountantLogPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();

  // ── Entitlement (Pro Plus). Hooks stay above any early return. ──
  const { data: planResp } = useQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const entitled = hasFeature(planResp?.data?.effective_plan || "trial", "accountant_log");
  const navigate = useNavigate();

  // MP-COUNT-INTEGRITY (F2.4). Shared hook — same key AND same queryFn as the
  // sidebar badge and StockCheckPage. `enabled` differs per consumer, which is
  // safe; the queryFn must not. Gated on entitlement so it never 403s for a plan
  // that cannot see this page anyway.
  const { data: stockCheckSummary } = useStockCheckSummary({ enabled: entitled, onError: () => {} });
  const notCounted30d = Number(stockCheckSummary?.data?.not_counted_30d) || 0;

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", password: "" });
  const [confirmKill, setConfirmKill] = useState(null); // { staff, nextActive }
  const [detailStaff, setDetailStaff] = useState(null);  // open staff's activity screen
  const [showLedger, setShowLedger] = useState(false);   // MP-STAFF-ACTIVITY-LEDGER: full typed feed
  const [deepLink, setDeepLink] = useState(null);        // { highlightId, initialDay } from a tapped alert
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: watchedResp, isLoading } = useQuery({
    queryKey: ["accountant-log-watched"],
    queryFn: () => api.get("/staff/watched").then(r => r.data),
    enabled: entitled,
  });
  // MP-LAST-SEEN: surface who's active — sort currently-active staff to the top
  // (online first, then active accounts, then by most-recent last_seen), so the
  // boss sees at a glance who's on the app right now.
  const staff = useMemo(() => {
    const rows = watchedResp?.data || [];
    const onlineOf = (s) => (s.online != null ? s.online : isRecentlyActive(s.last_seen_at));
    const seenMs = (s) => (s.last_seen_at ? new Date(s.last_seen_at).getTime() : 0);
    return [...rows].sort((a, b) =>
      (onlineOf(b) - onlineOf(a)) ||
      ((b.is_active ? 1 : 0) - (a.is_active ? 1 : 0)) ||
      (seenMs(b) - seenMs(a)) ||
      String(a.full_name || "").localeCompare(String(b.full_name || "")));
  }, [watchedResp]);

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

  // ── MP-CORRECTIONS-GUARDRAIL: approved-but-NOT-yet-completed ──────────────
  // Approval on this rail is a GREEN LIGHT only — the requester must finalize to
  // execute. Until now an approved row simply vanished from this inbox, so the boss
  // approved, believed it was done, and never learned it wasn't. (That is exactly
  // what happened to us: a float correction sat approved-unapplied while the drawer
  // kept the wrong figure.)
  //
  // Rendered BELOW as a read-only INFO strip, deliberately not styled like the
  // pending queue — nothing here needs a decision, so it must not read as a second
  // pile of work or the boss will start ignoring both.
  const { data: awaitingResp } = useQuery({
    queryKey: ["staff-approvals-awaiting"],
    queryFn: () => api.get("/staff/approvals?status=approved").then((r) => r.data),
    enabled: entitled,
    refetchInterval: 30000,
  });
  const awaitingCompletion = awaitingResp?.data || [];
  // Cancel an approved row that can never be completed. Reuses the existing
  // /approvals/:id/cancel endpoint (valid on 'pending' OR 'approved', owner allowed),
  // so it writes the standard action_approval_cancelled audit row and executes nothing.
  const cancelAwaitingMut = useMutation({
    mutationFn: (id) => api.post(`/staff/approvals/${id}/cancel`, {
      reason: "cancelled by owner — could no longer be completed",
    }),
    onSuccess: () => {
      toast.success(en ? "Request cancelled." : "Demande annulée.");
      qc.invalidateQueries({ queryKey: ["staff-approvals-awaiting"] });
      qc.invalidateQueries({ queryKey: ["staff-approvals-pending"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Could not cancel" : "Échec de l'annulation")),
  });

  // "3d" / "4h" / "12m" since approval — an old one is the whole signal.
  const sinceLabel = (iso) => {
    if (!iso) return "";
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };
  const [pinFor, setPinFor] = useState(null);     // approval row being approved (PIN prompt)
  const [pinValue, setPinValue] = useState("");
  const [rejectFor, setRejectFor] = useState(null); // approval row being rejected (note prompt)
  const [rejectNote, setRejectNote] = useState("");
  const [cancelFor, setCancelFor] = useState(null); // approval row being cancelled (confirm)

  const APPROVAL_VERB = {
    void: en ? "cancel a sale" : "annuler une vente",
    refund: en ? "give a refund" : "faire un remboursement",
    stock_adjust: en ? "change stock" : "modifier le stock",
    debt_adjust: en ? "change a customer's debt" : "modifier la dette d'un client",
    delete_customer: en ? "delete a customer" : "supprimer un client",
    expense: en ? "record an expense" : "enregistrer une dépense",
    discount: en ? "apply a discount" : "appliquer une remise",
    below_cost_sale: en ? "sell below the floor price" : "vendre sous le prix plancher",
    transfer: en ? "transfer goods" : "transférer des marchandises",
    oversell: en ? "sell when out of stock" : "vendre en rupture de stock",
    credit_sale: en ? "sell on credit" : "vendre à crédit",
    bundled_sale: en ? "make a sale that needs approval" : "faire une vente à approuver",
    // MP-CORRECTIONS — corrections to money already recorded.
    float_edit: en ? "correct the opening float" : "corriger le fonds de caisse",
    expense_edit: en ? "correct an expense" : "corriger une dépense",
    expense_delete: en ? "delete an expense" : "supprimer une dépense",
  };
  // MP-BUNDLE-VERB: a bundled_sale's reasons live in its target_ref (reason tokens joined
  // by "+"). When there is exactly ONE distinct reason, name it; 2+ distinct (or
  // unreadable) → the generic wording (the WHY block spells out each reason).
  const BUNDLED_VERB = {
    below_cost: { en: "sell below cost",  fr: "vendre sous le prix plancher" },
    credit:     { en: "sell on credit",   fr: "vendre à crédit" },
    discount:   { en: "give a discount",  fr: "faire une remise" },
    oversell:   { en: "oversell",         fr: "vendre en rupture de stock" },
    sold_date:  { en: "back-date a sale", fr: "antidater une vente" },
  };
  // Plain labels for the META line's bundled reason-ref (collapse duplicates + pluralise).
  const REF_LABEL = {
    below_cost: { en: "below cost", fr: "sous le prix plancher" },
    credit:     { en: "on credit",  fr: "à crédit" },
    discount:   { en: "discount",   fr: "remise" },
    oversell:   { en: "oversell",   fr: "survente" },
    sold_date:  { en: "back-dated", fr: "antidatée" },
  };
  const bundledTokens = (ref) => String(ref || "").split("+").map(t => t.trim()).filter(Boolean);
  // MP-APPROVAL-VERB: never surface a raw action_type enum. bundled_sale → the single
  // reason when there is one, else generic; any unmapped type → a plain fallback.
  const approvalVerb = (t, ref) => {
    if (t === "bundled_sale") {
      const distinct = [...new Set(bundledTokens(ref))];
      if (distinct.length === 1 && BUNDLED_VERB[distinct[0]]) {
        const v = BUNDLED_VERB[distinct[0]]; return en ? v.en : v.fr;
      }
      return APPROVAL_VERB.bundled_sale;
    }
    return APPROVAL_VERB[t] || (en ? "make a change that needs approval" : "faire une modification à approuver");
  };
  // MP-META-REF: ONLY bundled_sale's target_ref is reason-tokens — collapse + pluralise
  // into plain text ("3 items below cost", "below cost, on credit"), dropping unknown
  // tokens (whole segment omitted if none map). EVERY other type's target_ref is a real
  // human reference (sale number, customer, product) → render as-is.
  const metaRef = (x) => {
    if (!x || x.action_type !== "bundled_sale") return (x && x.target_ref) || null;
    const order = [], counts = {};
    for (const tok of bundledTokens(x.target_ref)) {
      const lab = REF_LABEL[tok]; if (!lab) continue;
      const label = en ? lab.en : lab.fr;
      if (!(label in counts)) { counts[label] = 0; order.push(label); }
      counts[label]++;
    }
    if (!order.length) return null;
    return order.map(label => counts[label] > 1
      ? (en ? `${counts[label]} items ${label}` : `${counts[label]} articles ${label}`) : label).join(", ");
  };

  const approveMut = useMutation({
    mutationFn: ({ id, pin }) => api.post(`/staff/approvals/${id}/approve`, { pin }),
    onSuccess: () => {
      toast.success(en ? "Approved — staff will complete it" : "Approuvé — le personnel le finalisera");
      setPinFor(null); setPinValue("");
      qc.invalidateQueries({ queryKey: ["staff-approvals-pending"] });
      // MP-CORRECTIONS-GUARDRAIL: the row moves pending → approved, so the
      // "waiting to be completed" strip must refresh too or the boss sees it
      // disappear from one list without appearing in the other.
      qc.invalidateQueries({ queryKey: ["staff-approvals-awaiting"] });
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
  // MP-APPROVAL-CANCEL: drop a request that's no longer needed — no sale recorded.
  const cancelMut = useMutation({
    mutationFn: ({ id }) => api.post(`/staff/approvals/${id}/cancel`),
    onSuccess: () => {
      toast.success(en ? "Request cancelled — no sale recorded" : "Demande annulée — aucune vente");
      setCancelFor(null);
      qc.invalidateQueries({ queryKey: ["staff-approvals-pending"] });
    },
    onError: (e) => { toast.error(e?.response?.data?.message || (en ? "Could not cancel" : "Échec de l'annulation")); setCancelFor(null); },
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

  // MP-STAFF-ACTIVITY-LEDGER: the all-staff / by-type / by-range typed feed.
  if (showLedger) return wrap(
    <LedgerView staffList={staff} en={en} onBack={() => setShowLedger(false)} />
  );

  const canSubmitAdd = form.full_name.trim() && form.phone.trim() && form.password.length >= 4 && !addAccountant.isPending;

  return wrap(
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
            🛡️ {en ? "Accountant Log" : "Journal du comptable"}
            <HelpButton topic="accountant_log" style={{ width: 24, height: 24, fontSize: 13 }} />
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
            {en ? "Everyone working in your shop, and your control over them." : "Tous ceux qui travaillent dans votre boutique, et votre contrôle sur eux."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {/* MP-STAFF-ACTIVITY-LEDGER: open the full typed activity feed (all staff / by type / by range). */}
          <button className="btn btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => setShowLedger(true)}>
            📒 {en ? "Ledger" : "Registre"}
          </button>
          <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }} onClick={() => setShowAdd(true)}>
            + {en ? "Add accountant" : "Ajouter un comptable"}
          </button>
        </div>
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
                {(a.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wants to" : "veut"} {approvalVerb(a.action_type, a.target_ref)}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                {/* MP-BELOW-COST-CLEAR-WORDING: a below-cost amount is the shortfall,
                    not the sale total — render it labelled, not as a bare number. */}
                {[!["below_cost_sale", "discount"].includes(a.action_type) && a.amount != null ? fmtCur(Math.abs(Number(a.amount))) : null, metaRef(a), a.branch_name].filter(Boolean).join(" · ")}
                {" · "}{new Date(a.created_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
              {/* MP-APPROVAL-DETAIL: full plain-language why + order for EVERY type, fetched on expand. */}
              <ApprovalDetailView approval={a} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setRejectNote(""); setRejectFor(a); }}>
                  ✕ {en ? "Reject" : "Rejeter"}
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setPinValue(""); setPinFor(a); }}>
                  ✓ {en ? "Approve" : "Approuver"}
                </button>
              </div>
              {/* MP-APPROVAL-CANCEL: drop a no-longer-needed request outright (no sale). */}
              <button className="btn" style={{ width: "100%", marginTop: 6, fontSize: 12.5, color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)" }}
                onClick={() => setCancelFor(a)}>
                {en ? "Cancel request (no sale)" : "Annuler la demande (sans vente)"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── MP-COUNT-INTEGRITY (F2.4): variances closed WITHOUT a count ───────
          The condition attached to allowing "not counted" at all. A boss can close
          a real variance by saying it was never counted — that has to be legitimate
          (a discontinued product, a duplicate flag), but if it is free and invisible
          it becomes the route of least resistance and the Done hole reopens under a
          new name. So it surfaces here, in the log the boss already reads, and turns
          amber once it stops looking like an exception.
          Same shared hook as the sidebar badge and the Stock Check page — one
          queryFn for one key; see utils/useStockCheckSummary.js for why that matters. */}
      {notCounted30d > 0 && (
        <div className="card" style={{ marginTop: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
          border: notCounted30d >= NOT_COUNTED_AMBER_AT ? "1px solid rgba(251,191,36,0.35)" : undefined,
          background: notCounted30d >= NOT_COUNTED_AMBER_AT ? "rgba(251,191,36,0.07)" : undefined }}>
          <span style={{ fontSize: 15 }}>{notCounted30d >= NOT_COUNTED_AMBER_AT ? "⚠️" : "🕗"}</span>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", flex: 1 }}>
            {en
              ? <><strong style={{ color: notCounted30d >= NOT_COUNTED_AMBER_AT ? "#fbbf24" : "var(--text-primary)" }}>{notCounted30d}</strong> stock difference{notCounted30d === 1 ? " was" : "s were"} closed without being counted in the last 30 days.</>
              : <><strong style={{ color: notCounted30d >= NOT_COUNTED_AMBER_AT ? "#fbbf24" : "var(--text-primary)" }}>{notCounted30d}</strong> écart{notCounted30d === 1 ? "" : "s"} de stock clos sans comptage sur les 30 derniers jours.</>}
            {notCounted30d >= NOT_COUNTED_AMBER_AT && (
              <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 2 }}>
                {en ? "That is enough to be a pattern rather than an exception — worth a look."
                    : "C'est assez pour être une habitude plutôt qu'une exception — à regarder."}
              </div>
            )}
          </div>
          <button onClick={() => navigate("/stock-check")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12.5, textDecoration: "underline", whiteSpace: "nowrap" }}>
            {en ? "View" : "Voir"}
          </button>
        </div>
      )}

      {/* ── MP-CORRECTIONS-GUARDRAIL: approved, waiting to be completed ──────
          INFO ONLY. Muted/neutral on purpose — the amber block above is the
          decision queue; this one asks nothing of the boss. Styling it the same
          would turn one glanceable "you have work" signal into two competing
          ones, and he'd learn to skip both. What it must do is make the state
          EXIST: an approved correction that nobody finalised used to be
          invisible to everyone. The age badge is the point — "3d" is the tell. */}
      {awaitingCompletion.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "9px 14px", display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)" }}>
            <span style={{ fontSize: 15 }}>✅</span>
            <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-secondary)" }}>
              {en ? "Approved — waiting to be completed" : "Approuvé — en attente d'exécution"}
            </span>
            <span style={{ marginLeft: "auto", background: "rgba(255,255,255,0.10)", color: "var(--text-secondary)",
              borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 700 }}>
              {awaitingCompletion.length}
            </span>
          </div>
          {awaitingCompletion.map((a, i) => (
            <div key={a.id} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)",
              display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                {en ? "Waiting for " : "En attente de "}
                <strong style={{ color: "var(--text-primary)" }}>{a.requested_by_name || (en ? "the staff member" : "l'employé")}</strong>
                {en ? " to complete: " : " pour terminer : "}
                {approvalVerb(a.action_type, a.target_ref)}
                {a.target_ref ? ` (${a.target_ref})` : ""}
              </div>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" }}>
                {en ? "approved " : "approuvé "}{sinceLabel(a.decided_at)}{en ? " ago" : ""}
              </span>
              {/* Some approved rows can NEVER be completed — the shift they target has
                  closed, or the staffer has left, or the moment simply passed. Without a
                  way out they sit here forever and this strip becomes permanent noise,
                  which is how a useful signal dies. Cancel is the same terminal state and
                  the same audit row the /cancel endpoint writes; it executes nothing. */}
              <button
                onClick={() => cancelAwaitingMut.mutate(a.id)}
                disabled={cancelAwaitingMut.isPending}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7,
                  color: "var(--text-muted)", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
                {en ? "Cancel" : "Annuler"}
              </button>
            </div>
          ))}
          <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11.5,
            color: "var(--text-muted)", lineHeight: 1.5 }}>
            {en
              ? "You've approved these — nothing has changed yet. The staff member must open My Requests and complete each one. A shift cannot be closed while a correction to it is still waiting."
              : "Vous les avez approuvées — rien n'a encore changé. L'employé doit ouvrir Mes demandes et terminer chacune. Une caisse ne peut pas être fermée tant qu'une correction la concernant est en attente."}
          </div>
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
                {/* MP-LAST-SEEN presence dot — green = active in the last ~10 min
                    (heartbeat throttled to 5 min: presence, not live). Grey for
                    inactive/deactivated accounts (a till, not a person). */}
                {(() => {
                  const online = s.is_active && (s.online != null ? s.online : isRecentlyActive(s.last_seen_at));
                  return <span title={online ? (en ? "Active now" : "Actif maintenant") : ""}
                    style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                      background: online ? "#34d399" : "#94a3b8",
                      boxShadow: online ? "0 0 0 3px rgba(52,211,153,0.18)" : "none" }} />;
                })()}
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
                {(s.branch_name || (en ? "All branches" : "Toutes les boutiques"))} ·{" "}
                {/* Deactivated/shared accounts (a till, not a person) never show a
                    stale "last seen" line beside an active cashier. */}
                {!s.is_active
                  ? (en ? "Inactive account" : "Compte inactif")
                  : (s.last_seen_at
                      ? `${en ? "Active" : "Actif"} ${formatLastSeen(s.last_seen_at, en)}`
                      : (en ? "Never active" : "Jamais actif"))}
              </div>
            </div>
            {/* MP-OWNER-MANAGER-IN-PERSON-VIEWS: owners appear in the roster so
                they can view their own numbers, but never get a deactivate
                toggle (an owner can't lock themselves out). */}
            {s.role !== "owner" && (
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
            )}
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
              {(pinFor.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wants to" : "veut"} {approvalVerb(pinFor.action_type, pinFor.target_ref)}
              {/* MP-BELOW-COST-CLEAR-WORDING: the below-cost amount is the shortfall — show it labelled below, not inline as a total. */}
              {!["below_cost_sale", "discount"].includes(pinFor.action_type) && pinFor.amount != null ? ` — ${fmtCur(Math.abs(Number(pinFor.amount)))}` : ""}{metaRef(pinFor) ? ` — ${metaRef(pinFor)}` : ""}.
              {/* MP-APPROVAL-FULL-DETAIL: WHO + WHEN must be on every approval surface, not
                  just the inbox card — this modal is where the decision is actually made. */}
              {pinFor.created_at ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {" "}({en ? "requested" : "demandé"} {new Date(pinFor.created_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})
                </span>
              ) : null}
              <br />{en ? "Approving gives the green light — the staff member completes it at the counter." : "Approuver donne le feu vert — l'employé la finalise au comptoir."}
            </div>
            {/* MP-APPROVAL-DETAIL: show the full why + order right where he decides (auto-open). */}
            <div style={{ marginBottom: 14 }}>
              <ApprovalDetailView approval={pinFor} defaultOpen />
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
              {(rejectFor.requested_by_name || (en ? "A staff member" : "Un employé"))} {en ? "wanted to" : "voulait"} {approvalVerb(rejectFor.action_type, rejectFor.target_ref)}.
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

      {/* ── CANCEL CONFIRM ── MP-APPROVAL-CANCEL */}
      {cancelFor && (
        <div className="modal-overlay" onClick={() => { if (!cancelMut.isPending) setCancelFor(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{en ? "Cancel this request?" : "Annuler cette demande ?"}</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
              {en ? "No sale will be recorded." : "Aucune vente ne sera enregistrée."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={cancelMut.isPending}
                onClick={() => setCancelFor(null)}>{en ? "Keep it" : "Garder"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={cancelMut.isPending}
                onClick={() => cancelMut.mutate({ id: cancelFor.id })}>
                {cancelMut.isPending ? "..." : (en ? "Yes, cancel" : "Oui, annuler")}
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
// MP-REPORT-LOCAL-DAY: a Date's LOCAL calendar date as YYYY-MM-DD (from local
// components — never toISOString(), which shifts to UTC and off-by-ones a UTC+ org).
function localDayStr(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
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
    case "staff_added":
    case "staff_deactivated":
    case "staff_reactivated":
      if (has(d.target_name)) F.push({ label: en ? "Staff member" : "Membre", value: `${d.target_name}${has(d.target_role) ? ` (${d.target_role})` : ""}` });
      if (has(d.actor_name)) F.push({ label: en ? "By" : "Par", value: d.actor_name });
      if (has(d.reason)) F.push({ label: en ? "Reason" : "Motif", value: d.reason });
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
  return d.toLocaleTimeString(en ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ })
    + " · " + d.toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short" });
}

// MP-ANOMALY-EXPLAIN: collapse repeated same-action rows in the SAME day into one
// summary item so the feed doesn't drown the owner in identical scary lines.
// >= GROUP_MIN of the same action on a day → one group (expandable); fewer stay
// individual. First-seen order is preserved (rows arrive newest-first).
const GROUP_MIN = 3;
function buildFeedItems(rows) {
  const byKey = new Map();
  const order = [];
  for (const r of (rows || [])) {
    const day = String(r.created_at || "").slice(0, 10);
    const key = `${r.action}|${day}`;
    if (!byKey.has(key)) { byKey.set(key, { key, action: r.action, day, rows: [] }); order.push(key); }
    byKey.get(key).rows.push(r);
  }
  const items = [];
  for (const key of order) {
    const g = byKey.get(key);
    if (g.rows.length >= GROUP_MIN) {
      const sum = g.rows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
      items.push({ type: "group", key, action: g.action, rows: g.rows, count: g.rows.length, sum });
    } else {
      for (const r of g.rows) items.push({ type: "row", key: r.id, row: r });
    }
  }
  return items;
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
// MP-OVERSELL-SAFE-DEFAULT-UI-FIX: oversell_policy is the ONE policy that is
// SAFE-DEFAULT-BLOCK on the server (sales.js: no pa_staff_permissions row →
// block) — every other policy here defaults to allow. `defaultPolicy` lets the
// UI (display AND save) reflect each key's real server-side default instead of
// assuming "allow" for all of them.
// MP-MANAGER-DELEGATION Phase 3 — the action_types a delegated manager can be given to
// APPROVE on the boss's behalf (deputy). Maps 1:1 to pa_action_approvals.action_type +
// pa_staff_permissions.can_approve. Below-cost is deliberately absent — it ALWAYS goes to
// the owner and the server refuses it even if sent.
const DEPUTY_APPROVABLE = [
  { key: "void",         en: "Cancel a sale",        fr: "Annuler une vente" },
  { key: "refund",       en: "Give a refund",        fr: "Faire un remboursement" },
  { key: "bundled_sale", en: "Sales needing approval (discount, credit, over-sell)", fr: "Ventes à approuver (remise, crédit, rupture)" },
  { key: "transfer",     en: "Transfer goods",       fr: "Transférer des marchandises" },
  { key: "stock_adjust", en: "Stock changes",        fr: "Modifications de stock" },
  { key: "debt_adjust",  en: "Debt changes",         fr: "Modifications de dette" },
  { key: "expense",      en: "Expenses",             fr: "Dépenses" },
];

const PERM_ACTIONS = [
  { key: "void_policy",         en: "Cancel a sale",        fr: "Annuler une vente" },
  { key: "refund_policy",       en: "Give a refund",        fr: "Faire un remboursement" },
  { key: "stock_adjust_policy", en: "Change stock by hand", fr: "Modifier le stock à la main" },
  { key: "debt_adjust_policy",  en: "Change / forgive debt", fr: "Modifier / annuler une dette" },
  { key: "delete_policy",       en: "Delete a customer",    fr: "Supprimer un client" },
  { key: "discount_policy",     en: "Give a discount",      fr: "Faire une remise" },
  { key: "credit_policy",       en: "Sell on credit",       fr: "Vendre à crédit" },
  { key: "expense_policy",      en: "Record an expense",    fr: "Enregistrer une dépense" },
  { key: "transfer_policy",     en: "Transfer goods",       fr: "Transférer des marchandises" },
  { key: "oversell_policy",     en: "Sell when finished (out of stock)", fr: "Vendre quand c'est fini (rupture)",
    defaultPolicy: "block",
    note: {
      en: "Unlike every other permission above, this one defaults to BLOCKED until you set it — selling out-of-stock goods is refused unless explicitly allowed or set to need your approval.",
      fr: "Contrairement aux autres permissions ci-dessus, celle-ci est BLOQUÉE par défaut tant que vous ne la réglez pas — vendre en rupture de stock est refusé sauf si vous l'autorisez explicitement ou exigez votre approbation.",
    } },
  // MP-SOLD-DATE-NOTE: same SAFE-DEFAULT-BLOCK shape as oversell_policy —
  // nobody can back-note a sold date until the owner explicitly opts them in.
  // The owner himself is exempt from this gate everywhere it's enforced
  // (sales.js) but still shows up in his own Activity feed when he uses it.
  { key: "sold_date_policy",    en: "Record a sold date (back-dated note)", fr: "Enregistrer une date de vente (note antidatée)",
    defaultPolicy: "block",
    note: {
      en: "BLOCKED by default. A note only — it never changes the receipt's real date or any report/total — but lets a staffer label a sale \"actually sold on [date]\" when they register it late. Allow only staff you trust to use this honestly.",
      fr: "BLOQUÉ par défaut. Une simple note — elle ne change jamais la date réelle du reçu ni aucun rapport/total — mais permet à un employé d'indiquer qu'une vente a \"eu lieu le [date]\" quand il l'enregistre en retard. N'autorisez que le personnel de confiance.",
    } },
  // MP-CORRECTIONS: correcting money that is ALREADY RECORDED. Two separate keys — a boss
  // may trust someone with petty-cash typos but not with the drawer's opening float.
  // Both SAFE-DEFAULT-BLOCK, and for staff the only meaningful non-blocked setting is
  // "needs your approval": a staffer never edits recorded money without a boss decision.
  { key: "float_edit_policy",   en: "Correct the opening float", fr: "Corriger le fonds de caisse",
    defaultPolicy: "block",
    note: {
      en: "BLOCKED by default. Lets a staff member ASK to fix a mistyped opening float — you still approve it, and you see the old and new amount before you do. Only the CURRENT OPEN shift can be corrected; once a shift is closed its float is final.",
      fr: "BLOQUÉ par défaut. Permet à un employé de DEMANDER la correction d'un fonds de caisse mal saisi — vous approuvez quand même, et vous voyez l'ancien et le nouveau montant avant. Seule la caisse OUVERTE peut être corrigée ; une fois fermée, son fonds est définitif.",
    } },
  { key: "expense_edit_policy", en: "Correct or delete an expense", fr: "Corriger ou supprimer une dépense",
    defaultPolicy: "block",
    note: {
      en: "BLOCKED by default. Lets a staff member ASK to fix or remove an expense they entered wrongly — you approve, and you see exactly what changes (or what disappears) first. Expenses belonging to a CLOSED shift can never be changed.",
      fr: "BLOQUÉ par défaut. Permet à un employé de DEMANDER la correction ou la suppression d'une dépense mal saisie — vous approuvez, et vous voyez d'abord exactement ce qui change (ou ce qui disparaît). Les dépenses d'une caisse FERMÉE ne peuvent jamais être modifiées.",
    } },
];
const permDefault = (a) => a.defaultPolicy || "allow";

// ── MP-CAP-ZERO-WARNING ──────────────────────────────────────────────────────
// Every cap input below is `min="0"` with a "no limit" PLACEHOLDER, so BLANK and 0
// look like the same answer and mean opposite things: blank = no ceiling, 0 = the
// tightest ceiling there is. One shared predicate so the three warnings can never
// drift apart on WHEN they fire — only on WHAT they say, which is the whole point:
//   discount 0 → REFUSED (403)                      staffPermissions.js:71
//   credit   0 → routed to approval, NOT refused    staffPermissions.js:156
//   expense  0 → REFUSED (403)                      staffPermissions.js:76
// Number("") and Number(null) are both 0, which is why emptiness is excluded first.
const capIsZero = (v) => v !== "" && v !== null && v !== undefined && Number(v) === 0;

// ── MP-STAFF-ACTIVITY-LEDGER (Phase 2) ───────────────────────────────────────
// One typed timeline of how goods + money moved — filterable by staff, activity type,
// and a from–to date range. Backed by the ADDITIVE pa_staff_ledger RPC (sales + transfers
// + audit money/goods events). The risk view (pa_staff_activity / StaffActivityView) is
// untouched. Retroactive over existing history; price/cost changes are forward-only.
// Type labels + time formatting are shared with the staff MyActivity view.

function LedgerDetailRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
// Phase 2 basic detail. Phase 3 routes transfer/buffer taps to the rich detail modals.
function LedgerDetailModal({ row, en, fmt, onClose }) {
  const t = LEDGER_TYPES[row.activity_type];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: 14, padding: 20, maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 10 }}>
          {t?.icon} {ltLabel(row.activity_type, en)}
          {row.ref_number ? <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>{row.ref_number}</span> : null}
        </div>
        <LedgerDetailRow label={en ? "Who" : "Qui"} value={`${row.actor_name || "—"}${row.actor_role ? ` (${row.actor_role})` : ""}`} />
        <LedgerDetailRow label={en ? "When" : "Quand"} value={fmtLedgerWhen(row.occurred_at, en)} />
        {row.branch_name && <LedgerDetailRow label={en ? "Branch" : "Boutique"} value={row.branch_name} />}
        {row.amount != null && <LedgerDetailRow label={en ? "Amount" : "Montant"} value={fmt(row.amount)} />}
        {(row.ref_type === "transfer" || row.ref_type === "buffer") && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>
            {en ? "Full transfer/goods detail view is coming next." : "La vue détaillée du transfert/des marchandises arrive bientôt."}
          </div>
        )}
        <button onClick={onClose} className="btn btn-secondary" style={{ width: "100%", marginTop: 14 }}>{en ? "Close" : "Fermer"}</button>
      </div>
    </div>
  );
}

function LedgerView({ staffList, en, onBack }) {
  const fmt = useCurrency();
  const [staffId, setStaffId] = useState("all");
  const [type, setType] = useState("all");
  // Default window: last 30 days → today. A boss back after 2 months widens "From" to June.
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [detail, setDetail] = useState(null);
  const [transferId, setTransferId] = useState(null); // Phase 3: rich transfer detail
  const [bufferId, setBufferId] = useState(null);      // Phase 3: rich buffer detail

  // Route by ref_type: transfers + goods → the rich detail views; everything else → basic.
  const openDetail = (r) => {
    if (r.ref_type === "transfer" && r.ref_id) setTransferId(r.ref_id);
    else if (r.ref_type === "buffer" && r.ref_id) setBufferId(r.ref_id);
    else setDetail(r);
  };

  const fromIso = new Date(fromDate + "T00:00:00").toISOString();
  const toIso = (() => { const d = new Date(toDate + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString(); })(); // inclusive of toDate
  const qs = [
    staffId !== "all" ? `user_id=${staffId}` : "",
    type !== "all" ? `types=${encodeURIComponent(type)}` : "",
    `from=${encodeURIComponent(fromIso)}`, `to=${encodeURIComponent(toIso)}`, "limit=300",
  ].filter(Boolean).join("&");

  const ledgerQ = useQuery({
    queryKey: ["staff-ledger", staffId, type, fromIso, toIso],
    queryFn: () => api.get(`/staff/ledger?${qs}`).then((r) => r.data),
  });
  const rows = ledgerQ.data?.data || [];
  const sel = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, width: "100%" };

  return (
    <div>
      <button onClick={onBack} className="btn btn-secondary" style={{ marginBottom: 12 }}>← {en ? "Back" : "Retour"}</button>
      <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 2 }}>📒 {en ? "Activity Ledger" : "Registre d'activité"}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
        {en ? "Everything that moved — sales, transfers, goods and money — by who and when."
            : "Tout ce qui a bougé — ventes, transferts, marchandises et argent — par qui et quand."}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Staff" : "Personnel"}</label>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={sel}>
            <option value="all">{en ? "All staff" : "Tout le personnel"}</option>
            {(staffList || []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Type" : "Type"}</label>
          <select value={type} onChange={(e) => setType(e.target.value)} style={sel}>
            <option value="all">{en ? "All types" : "Tous les types"}</option>
            {LEDGER_TYPE_ORDER.map((t) => <option key={t} value={t}>{LEDGER_TYPES[t].icon} {ltLabel(t, en)}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "From" : "Du"}</label>
          <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={sel} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "To" : "Au"}</label>
          <input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} style={sel} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", marginBottom: 12 }}>
        ℹ️ {en ? "Price and cost changes are recorded only from today onward — earlier ones have no history."
              : "Les changements de prix et de coût ne sont enregistrés qu'à partir d'aujourd'hui — les précédents n'ont pas d'historique."}
      </div>

      {ledgerQ.isLoading ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : ledgerQ.isError ? (
        <div style={{ textAlign: "center", color: "var(--danger, #dc2626)", padding: 24 }}>{en ? "Could not load the ledger." : "Impossible de charger le registre."}</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>{en ? "Nothing in this range." : "Rien dans cette période."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <button key={r.entry_id} onClick={() => openDetail(r)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, textAlign: "left", cursor: "pointer", width: "100%" }}>
              <div style={{ fontSize: 20, flexShrink: 0 }}>{LEDGER_TYPES[r.activity_type]?.icon || "•"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {ltLabel(r.activity_type, en)}
                  {r.ref_number ? <span style={{ color: "var(--text-muted)", fontWeight: 500, fontFamily: "monospace", fontSize: 11, marginLeft: 6 }}>{r.ref_number}</span> : null}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                  👤 {r.actor_name || "—"}{r.actor_role ? ` · ${r.actor_role}` : ""} · {fmtLedgerWhen(r.occurred_at, en)}{r.branch_name ? ` · ${r.branch_name}` : ""}
                </div>
              </div>
              {r.amount != null && <div style={{ fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{fmt(r.amount)}</div>}
            </button>
          ))}
        </div>
      )}

      {detail && <LedgerDetailModal row={detail} en={en} fmt={fmt} onClose={() => setDetail(null)} />}
      {transferId && <TransferDetailModal transferId={transferId} onClose={() => setTransferId(null)} />}
      {bufferId && <BufferDetailModal bufferId={bufferId} onClose={() => setBufferId(null)} />}
    </div>
  );
}

function StaffActivityView({ staff, en, onBack, initialDay, highlightId }) {
  const fmt = useCurrency();
  // Deep-linked from a tapped alert → land on that entry's day so it's visible.
  const [range, setRange] = useState(initialDay ? "day" : "today"); // today | week | day
  const [pickedDay, setPickedDay] = useState(() => initialDay || new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState("everything");      // everything | check
  const [detailRow, setDetailRow] = useState(null);  // tapped activity row → detail modal
  const [openGroups, setOpenGroups] = useState({});  // MP-ANOMALY-EXPLAIN: expanded collapsed groups

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
        max_credit_amount: perms.max_credit_amount === "" ? null : perms.max_credit_amount,
        // MP-FILTER-PERMISSION: a SEPARATE axis from PERM_ACTIONS below —
        // 'block'|'self'|'all', or null/"" to explicitly clear back to the
        // role default. Not defaulted to anything here — an untouched control
        // must save exactly what the server already has (null stays null).
        filter_policy: perms.filter_policy === "" ? null : (perms.filter_policy ?? null),
        // MP-GOODS-BUFFER: boolean — may this staffer PRICE + RELEASE buffer goods into
        // inventory? Default OFF.
        buffer_access: !!perms.buffer_access,
        // MP-MANAGER-DELEGATION Phase 3: the delegation grant (only meaningful for a
        // manager). Sent every save; the server filters can_approve to valid types and
        // never accepts below_cost. Owner-only screen (this whole page is owner-gated).
        can_approve: Array.isArray(perms.can_approve) ? perms.can_approve : [],
        branch_scope: perms.branch_scope === "all" ? "all" : "own",
        can_manage_staff: !!perms.can_manage_staff,
        can_cancel_transfers: !!perms.can_cancel_transfers, // MP-TRANSFER-GOVERNANCE
        // MP-CASHIER-PHASE-1b: sent on every save like the flags above, so an
        // untouched grant round-trips as itself rather than being cleared by a
        // save that happened to be about something else.
        can_receive_payment: !!perms.can_receive_payment,
        can_release_goods: !!perms.can_release_goods,
        // MP-EXPENSE-TICKETS: same round-trip rule — sent on every save so an
        // untouched grant saves as itself instead of being cleared by a save
        // that was about something else entirely.
        can_pay_expenses: !!perms.can_pay_expenses,
      };
      PERM_ACTIONS.forEach((a) => {
        const v = perms[a.key];
        // MP-OVERSELL-SAFE-DEFAULT-UI-FIX: an untouched key must save as ITS OWN
        // default, not always "allow" — this previously wrote oversell_policy:
        // "allow" for a staffer whose oversell setting was never touched, the
        // instant an owner saved ANY other permission for them, silently
        // reversing the server's safe-default-block.
        body[a.key] = ["allow", "approve", "block"].includes(v) ? v : permDefault(a);
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
  // MP-REPORT-LOCAL-DAY: send LOCAL calendar dates derived from the on-screen
  // range/pickedDay directly — NOT sliced from `from`/`to` (those are local-
  // midnight-as-UTC ISO strings, whose first 10 chars are the PREVIOUS day for a
  // UTC+ org → the "Today shows yesterday" bug). The backend interprets these
  // plain dates in the org's timezone.
  const { fromDate, toDate } = useMemo(() => {
    if (range === "day") return { fromDate: pickedDay, toDate: pickedDay };
    if (range === "week") {
      const s = new Date(); const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow);
      return { fromDate: localDayStr(s), toDate: localDayStr(new Date()) };
    }
    const t = localDayStr(new Date()); // "today"
    return { fromDate: t, toDate: t };
  }, [range, pickedDay]);
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
              ? `Total sales = Cash (valid) + ${momoLabelShort(fmt.currency, en)} (valid) + Credit given. Voided receipts sit OUTSIDE — never inside cash.`
              : `Ventes totales = Espèces (valides) + ${momoLabelShort(fmt.currency, en)} (valides) + Crédit accordé. Les reçus annulés sont EN DEHORS — jamais dans les espèces.`}
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
                <Row strong label={en
                    ? `Total sales${bridge.sales_count != null ? ` (${bridge.sales_count} sale${bridge.sales_count === 1 ? "" : "s"})` : ""}`
                    : `Ventes totales${bridge.sales_count != null ? ` (${bridge.sales_count} vente${bridge.sales_count === 1 ? "" : "s"})` : ""}`}
                  val={bridge.total_sales}
                  note={en ? "goods sold (excludes voided & debt lines)" : "marchandises vendues (hors annulés & lignes de dette)"} />
                <Row indent label={en ? "= Cash (valid)" : "= Espèces (valides)"} val={bridge.cash_valid != null ? bridge.cash_valid : bridge.cash_collected}
                  note={en ? "cash received for valid sales; excludes cancelled receipts" : "espèces reçues pour ventes valides; hors reçus annulés"} />
                <Row indent label={`+ ${momoLabelShort(fmt.currency, en)} ${en ? "(valid)" : "(valides)"}`} val={bridge.momo_collected}
                  note={en ? `${momoLabel(fmt.currency, en)} received` : `${momoLabel(fmt.currency, en)} reçu`} />
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
        {(() => {
          // MP-ANOMALY-EXPLAIN: each row shows plain What + a jargon-free severity
          // cue; the tap-detail adds Why + What-to-do. Repeated same-action rows
          // in a day collapse into one expandable summary (buildFeedItems).
          const staffName = (staff && staff.full_name) || (en ? "This person" : "Cette personne");
          const renderRow = (r, isChild) => {
            const ex = explainAnomaly({ action: r.action, new_data: r.new_data, actor_name: r.actor_name || staffName }, en, fmt);
            const cue = severityCue(ex.severity, en);
            const amt = r.amount != null && r.amount !== "" ? Number(r.amount) : null;
            const highlighted = highlightId && r.id === highlightId;
            return (
              <div key={r.id} onClick={() => setDetailRow(r)} style={{
                display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                padding: isChild ? "10px 14px 10px 30px" : "12px 14px",
                borderTop: "1px solid var(--border)",
                borderLeft: highlighted ? "3px solid var(--brand)" : "3px solid transparent",
                background: highlighted ? "rgba(251,197,3,0.12)" : (ex.severity === "high" ? "rgba(239,68,68,0.05)" : "transparent"),
              }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: cue.dot, flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cue.dot, marginBottom: 2 }}>{cue.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.35 }}>{ex.what}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    👤 {ex.staffName} · {timeLabel(r.created_at, en)}{r.branch_name ? ` · ${r.branch_name}` : ""} · {en ? "tap for what to do" : "toucher pour quoi faire"}
                  </div>
                </div>
                {amt != null && (
                  <div style={{ fontWeight: 800, fontSize: 15, color: cue.dot, whiteSpace: "nowrap", marginTop: 12 }}>
                    {fmt(Math.abs(amt))}
                  </div>
                )}
              </div>
            );
          };
          return buildFeedItems(rows).map((it) => {
            if (it.type === "row") return renderRow(it.row, false);
            // Collapsed group summary — tap to expand into the explained items.
            const cue = severityCue(anomalySeverity(it.action), en);
            // Auto-expand a group that holds the deep-linked (tapped-alert) row.
            const isOpen = !!openGroups[it.key] || (highlightId && it.rows.some((r) => r.id === highlightId));
            return (
              <div key={it.key} style={{ borderTop: "1px solid var(--border)" }}>
                <div onClick={() => setOpenGroups((g) => ({ ...g, [it.key]: !g[it.key] }))} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "12px 14px",
                  background: it.action && anomalySeverity(it.action) === "high" ? "rgba(239,68,68,0.07)" : "rgba(245,158,11,0.06)",
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: cue.dot, flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cue.dot, marginBottom: 2 }}>{cue.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>
                      {staffName} {groupLabel(it.action, it.count, en)} {en ? "today" : "aujourd'hui"}
                      {it.sum > 0 ? ` (${en ? "total" : "total"} ${fmt(it.sum)})` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {isOpen ? (en ? "Tap to hide" : "Toucher pour masquer") : (en ? "Tap to see each" : "Toucher pour voir chacune")}
                    </div>
                  </div>
                  <span style={{ color: "var(--text-muted)", fontSize: 16, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", marginTop: 8 }}>›</span>
                </div>
                {isOpen && it.rows.map((r) => renderRow(r, true))}
              </div>
            );
          });
        })()}
      </div>
      <div style={{ height: 24 }} />

      {/* ── ACTIVITY DETAIL (tap a row) — readable label/value breakdown ── */}
      {detailRow && (
        <div className="modal-overlay" onClick={() => setDetailRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            {(() => {
              // MP-ANOMALY-EXPLAIN: lead the detail with the plain-language
              // What / Why / What-to-do (same mapper as the feed + bell).
              const ex = explainAnomaly({ action: detailRow.action, new_data: detailRow.new_data, actor_name: detailRow.actor_name || ((staff && staff.full_name) || "") }, en, fmt);
              const cue = severityCue(ex.severity, en);
              return (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cue.dot, marginBottom: 6 }}>{cue.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.35 }}>{ex.what}</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>👤 {en ? "Staff" : "Personnel"}: <b>{ex.staffName}</b></div>
                  {ex.why && (
                    <div style={{ marginTop: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 3 }}>{en ? "Why it's flagged" : "Pourquoi c'est signalé"}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>{ex.why}</div>
                    </div>
                  )}
                  {ex.do && (
                    <div style={{ marginTop: 8, background: "rgba(251,197,3,0.08)", border: "1px solid rgba(251,197,3,0.35)", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand-light)", marginBottom: 3 }}>{en ? "What to do" : "Quoi faire"}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>{ex.do}</div>
                    </div>
                  )}
                </div>
              );
            })()}
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
                ? "By default everyone is allowed everything — EXCEPT \"Sell when finished\" below, which is blocked by default. Change only what you want different."
                : "Par défaut, tout le monde a le droit de tout faire — SAUF « Vendre quand c'est fini » ci-dessous, bloqué par défaut. Ne changez que ce que vous voulez différent."}
            </div>
            {!perms ? (
              <div style={{ padding: 18, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
            ) : (
              <>
                {PERM_ACTIONS.map((a) => {
                  // MP-OVERSELL-SAFE-DEFAULT-UI-FIX: was `perms[a.key] || "allow"` for
                  // EVERY key — an untouched oversell_policy displayed "Allowed" as the
                  // active segment while the server actually enforces "block" for it.
                  const pol = perms[a.key] || permDefault(a);
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
                      {/* MP-OVERSELL-SAFE-DEFAULT-UI-FIX: explain what each state means for
                          THIS action specifically — "sell when finished" is abstract without it. */}
                      {a.note && (
                        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                          {en ? a.note.en : a.note.fr}
                          <br />
                          {pol === "block"
                            ? (en ? "→ Currently: refused outright — the sale is blocked and they're told to ask you."
                                  : "→ Actuellement : refusé directement — la vente est bloquée et on leur dit de vous demander.")
                            : pol === "approve"
                            ? (en ? "→ Currently: allowed only with your PIN (in person) or after you approve a request sent to your phone."
                                  : "→ Actuellement : autorisé seulement avec votre PIN (en personne) ou après votre approbation d'une demande envoyée sur votre téléphone.")
                            : (en ? "→ Currently: sold freely, even past zero stock — no approval asked."
                                  : "→ Actuellement : vendu librement, même sous stock zéro — aucune approbation demandée.")}
                        </div>
                      )}
                      {/* Caps tied to discount / expense */}
                      {a.key === "discount_policy" && !blocked && (
                        /* 0 REFUSES. staffPermissions.js:71 returns a 403 permission_limit,
                           and it runs AFTER the policy check without consulting it — so a cap
                           of 0 overrides the segment above for both "Allowed" AND "Needs
                           approval": the request is refused outright rather than sent to the
                           owner, who is left waiting for an approval that will never arrive.
                           Live on prod today (Bepanda Shop: discount "approve", cap 0), which
                           is why the warning names the approval case explicitly. */
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{en ? "Max discount %" : "Remise max %"}</span>
                            <input type="number" min="0" max="100" className="input" style={{ width: 110 }}
                              value={perms.max_discount_pct ?? ""} placeholder={en ? "no limit" : "sans limite"}
                              onChange={(e) => setCap("max_discount_pct", e.target.value)} />
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {en ? "Leave BLANK for no limit. 0 refuses every discount."
                                : "Laissez VIDE pour aucune limite. 0 refuse toute remise."}
                          </div>
                          {capIsZero(perms.max_discount_pct) && (
                            <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "var(--warning)", lineHeight: 1.45 }}>
                              ⚠ {en ? "A limit of 0% refuses EVERY discount for this person — including the ones you set to need approval, which never reach you to approve. Leave it blank if you meant no limit."
                                    : "Une limite de 0 % refuse TOUTE remise pour cette personne — y compris celles que vous avez mises en « approbation », qui ne vous parviennent jamais. Laissez vide si vous vouliez dire aucune limite."}
                            </div>
                          )}
                        </div>
                      )}
                      {/* MP-CREDIT-PERMISSION: per-sale credit ceiling (blank = no limit).
                          A credit above it needs the boss even when the policy is Allowed. */}
                      {a.key === "credit_policy" && !blocked && (
                        /* ⚠️ THIS CAP DOES NOT BEHAVE LIKE THE OTHER TWO, AND THE WORDING HAS
                           TO SAY SO. Over the discount or expense cap the action is REFUSED.
                           Over this one, decideCredit returns "approve" (staffPermissions.js:156)
                           — the sale still goes through, it just needs the boss first. So 0 here
                           does not stop credit, it sends EVERY credit sale for approval.
                           Copying the neighbouring warning would describe a refusal that never
                           happens: a control lying about itself, which is the same class of
                           defect one layer up. The way to actually stop credit is the Blocked
                           segment above, so the warning points at it by name. */
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{en ? "Max credit amount" : "Crédit max"} ({fmt.symbol})</span>
                            <input type="number" min="0" className="input" style={{ width: 130 }}
                              value={perms.max_credit_amount ?? ""} placeholder={en ? "no limit" : "sans limite"}
                              onChange={(e) => setCap("max_credit_amount", e.target.value)} />
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {en ? "Leave BLANK for no limit. Above this the sale is not refused — it comes to you for approval first."
                                : "Laissez VIDE pour aucune limite. Au-dessus, la vente n'est pas refusée — elle vous est d'abord soumise pour approbation."}
                          </div>
                          {capIsZero(perms.max_credit_amount) && (
                            <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "var(--warning)", lineHeight: 1.45 }}>
                              ⚠ {en ? "A limit of 0 does not stop credit — it sends EVERY credit sale to you for approval, including the smallest. Leave it blank if you meant no limit, or choose Blocked above to stop credit altogether."
                                    : "Une limite de 0 n'empêche pas le crédit — elle vous envoie TOUTE vente à crédit pour approbation, même la plus petite. Laissez vide si vous vouliez dire aucune limite, ou choisissez Bloqué ci-dessus pour interdire le crédit."}
                            </div>
                          )}
                        </div>
                      )}
                      {a.key === "expense_policy" && !blocked && (
                        /* ⚠️ BLANK AND 0 MEAN OPPOSITE THINGS AND THE CONTROL DID NOT SAY SO.
                           Blank = no limit; 0 = refuse every expense. The input offers 0 as
                           an in-range value (min="0", and the spinner stops there) while the
                           only hint that blank means unlimited is a PLACEHOLDER — grey text
                           that vanishes the moment you type, and which many people read as
                           "what to enter" rather than "what empty means".
                           Two of Paul's staff carry caps of 0 and 2 and have never recorded
                           an expense. Someone typing 0 to express "no limit" is the obvious
                           reading of this control, so the control is what changes. */
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>{en ? "Max expense amount" : "Dépense max"} ({fmt.symbol})</span>
                            <input type="number" min="0" className="input" style={{ width: 130 }}
                              value={perms.max_expense_amount ?? ""} placeholder={en ? "no limit" : "sans limite"}
                              onChange={(e) => setCap("max_expense_amount", e.target.value)} />
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                            {en ? "Leave BLANK for no limit. 0 refuses every expense."
                                : "Laissez VIDE pour aucune limite. 0 refuse toute dépense."}
                          </div>
                          {/* allow + 0 is a contradiction: the policy says yes and the cap says
                              never. Warned at the point of setting it, not discovered later by
                              a member of staff who cannot record anything. */}
                          {capIsZero(perms.max_expense_amount) && (
                            <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "var(--warning)", lineHeight: 1.45 }}>
                              ⚠ {en ? "A limit of 0 refuses EVERY expense for this person — including the ones you set to need approval, which never reach you to approve. Leave it blank if you meant no limit."
                                    : "Une limite de 0 refuse TOUTE dépense pour cette personne — y compris celles que vous avez mises en « approbation », qui ne vous parviennent jamais. Laissez vide si vous vouliez dire aucune limite."}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* MP-FILTER-PERMISSION (Peter, "boss control"): a SEPARATE axis from
                    every policy above — visibility SCOPE, not allow/approve/block.
                    null = role default (cashier→own only, manager/accountant/owner→
                    all staff) so nobody's access changes until you set this. */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>
                    {en ? "See other staff's activity (Filters)" : "Voir l'activité des autres (Filtres)"}
                  </div>
                  <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {[
                      { val: "block", en: "Blocked", fr: "Bloqué", bg: "rgba(239,68,68,0.9)", fg: "#fff" },
                      { val: "self",  en: "Own only", fr: "Soi seulement", bg: "rgba(245,158,11,0.9)", fg: "#3a2400" },
                      { val: "all",   en: "All staff", fr: "Tout le personnel", bg: "rgba(16,185,129,0.9)", fg: "#06281d" },
                    ].map((o) => (
                      <button key={o.val} onClick={() => setPolicy("filter_policy", perms.filter_policy === o.val ? "" : o.val)}
                        style={{ flex: 1, padding: "7px 4px", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer",
                          background: perms.filter_policy === o.val ? o.bg : "var(--bg-elevated)", color: perms.filter_policy === o.val ? o.fg : "var(--text-muted)" }}>
                        {en ? o.en : o.fr}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {!perms.filter_policy
                      ? (en ? `→ Role default (not set): ${staff.role === "cashier" ? "own activity only" : staff.role === "warehouse" ? "own activity, except full Inventory access" : "all staff"}.`
                            : `→ Défaut du rôle (non défini) : ${staff.role === "cashier" ? "activité propre uniquement" : staff.role === "warehouse" ? "activité propre, sauf accès complet à l'Inventaire" : "tout le personnel"}.`)
                      : perms.filter_policy === "block"
                      ? (en ? "→ Currently: cannot open Filters at all." : "→ Actuellement : ne peut pas ouvrir les Filtres.")
                      : perms.filter_policy === "self"
                      ? (en ? "→ Currently: sees only their own activity in Filters, regardless of role." : "→ Actuellement : voit uniquement sa propre activité dans les Filtres, quel que soit le rôle.")
                      : (en ? "→ Currently: sees ALL staff's activity in Filters." : "→ Actuellement : voit l'activité de TOUT le personnel dans les Filtres.")}
                    {" "}
                    <button onClick={() => setPolicy("filter_policy", "")} style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", textDecoration: "underline", fontSize: 11, padding: 0 }}>
                      {en ? "reset to role default" : "réinitialiser au défaut du rôle"}
                    </button>
                  </div>
                </div>
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
                {/* MP-GOODS-BUFFER: may this staffer PRICE + RELEASE buffer goods into
                    inventory? Default OFF — pricing/release is owner-level trust. */}
                <div style={{ marginTop: 4, marginBottom: 8, padding: "9px 11px", background: "var(--bg-elevated)", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                    {en ? "Goods Buffer — price & release into stock" : "Zone tampon — fixer prix & ajouter au stock"}
                  </div>
                  <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {[
                      { val: false, en: "No", fr: "Non", bg: "rgba(239,68,68,0.9)", fg: "#fff" },
                      { val: true,  en: "Allowed", fr: "Autorisé", bg: "rgba(16,185,129,0.9)", fg: "#06281d" },
                    ].map((o) => (
                      <button key={String(o.val)} onClick={() => setPerms(p => ({ ...(p || {}), buffer_access: o.val }))}
                        style={{ flex: 1, padding: "7px 4px", fontSize: 12.5, fontWeight: 700, border: "none", cursor: "pointer",
                          background: !!perms.buffer_access === o.val ? o.bg : "var(--bg-elevated)", color: !!perms.buffer_access === o.val ? o.fg : "var(--text-muted)" }}>
                        {en ? o.en : o.fr}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {en ? "Everyone can pre-register arrivals. Only this lets them set prices and add goods to inventory."
                        : "Tout le monde peut pré-enregistrer les arrivées. Ceci autorise en plus à fixer les prix et ajouter au stock."}
                  </div>
                </div>
                {/* MP-TRANSFER-GOVERNANCE Part 2 — BRANCH REACH, hoisted OUT of the
                    manager-only delegation box below. branch_scope governs two different
                    roles: a MANAGER's deputy reach (which branch's approvals he decides)
                    and a WAREHOUSE keeper's stock reach (which location's stock he moves).
                    A keeper is never a deputy, so while this lived inside the delegation
                    box he was permanently locked to his own location with no control the
                    boss could reach — a warehouse keeper created through the UI could not
                    transfer at all. This is a SCOPE control, never a grant: 'all' only
                    WIDENS powers the staffer already holds and confers no approval, deputy
                    or staff-management authority by itself (enforced server-side —
                    canManagerDecide checks can_approve BEFORE branch_scope, and
                    staffMgmtAuthority reads only can_manage_staff). */}
                {(staff.role === "manager" || staff.role === "warehouse") && (
                  <div style={{ marginTop: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                      {staff.role === "warehouse"
                        ? (en ? "Branch reach — whose stock he can move" : "Portée — quel stock il peut déplacer")
                        : (en ? "Branch reach — where he can act" : "Portée — où il peut agir")}
                    </div>
                    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                      {[
                        { val: "own", en: "His branch only", fr: "Sa succursale seulement" },
                        { val: "all", en: "All branches", fr: "Toutes les succursales" },
                      ].map((o) => (
                        <button key={o.val} onClick={() => setPerms((p) => ({ ...(p || {}), branch_scope: o.val }))}
                          style={{ flex: 1, padding: "7px 4px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                            background: (perms.branch_scope || "own") === o.val ? "rgba(230,190,92,0.9)" : "var(--bg-elevated)",
                            color: (perms.branch_scope || "own") === o.val ? "#2a1e00" : "var(--text-muted)" }}>
                          {en ? o.en : o.fr}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {staff.role === "warehouse"
                        ? (en ? "“His branch only” (default) limits him to the location assigned in Settings → Staff — he must have one to move stock at all. “All branches” lets him move stock at any location. This gives him NO approval or staff-management powers."
                              : "« Sa succursale seulement » (défaut) le limite à la boutique assignée dans Paramètres → Personnel — il lui en faut une pour déplacer du stock. « Toutes les succursales » lui permet de déplacer du stock partout. Cela ne lui donne AUCUN pouvoir d'approbation ni de gestion du personnel.")
                        : (en ? "Limits where he can act. On its own it grants nothing — it only widens what you delegate below."
                              : "Limite où il peut agir. Seul, cela n'accorde rien — cela élargit seulement ce que vous déléguez ci-dessous.")}
                    </div>
                  </div>
                )}

                {/* ── MP-CASHIER-PHASE-1b: the two cashier-workflow grants ──────────
                    Shown for every staff role, because who works the till is a shop
                    decision, not a role one. Both default OFF and stay inert at a
                    direct-mode shop: the server checks sales_mode BEFORE it reads
                    either flag, so granting them somewhere that sells directly changes
                    nothing until that shop is switched in Settings → Sales Workflow.
                    Owners and managers already hold both implicitly and are not
                    offered them here — a checkbox that cannot be unticked is a lie. */}
                {staff.role !== "owner" && staff.role !== "manager" && (
                  <div style={{ marginTop: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
                      {en ? "Cashier workflow" : "Circuit caissier"}
                    </div>
                    {[
                      { key: "can_receive_payment", en: "Can take payment", fr: "Peut encaisser",
                        hen: "Sees the Cashier queue and settles tickets a salesperson sent.",
                        hfr: "Voit la file Caissier et encaisse les tickets envoyés par un vendeur." },
                      { key: "can_release_goods", en: "Can hand over goods", fr: "Peut remettre la marchandise",
                        hen: "Sees the Pickup list and marks paid orders as collected.",
                        hfr: "Voit la liste Retrait et marque les commandes payées comme retirées." },
                      // MP-EXPENSE-TICKETS: a SEPARATE trust. Taking money in and
                      // paying money out are different jobs, and a cashier who
                      // receives payments all day is not automatically the person
                      // a shop wants handing cash to a supplier. Granting it is
                      // the owner's decision, which is the point of the feature.
                      { key: "can_pay_expenses", en: "Can pay expenses out", fr: "Peut payer les dépenses",
                        hen: "Sees the Payouts queue and hands money to suppliers. Separate from taking payment.",
                        hfr: "Voit la file Paiements et remet l'argent aux fournisseurs. Distinct de l'encaissement." },
                    ].map((f) => (
                      <label key={f.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", cursor: "pointer" }}>
                        <input type="checkbox" checked={!!perms[f.key]} style={{ marginTop: 3 }}
                          onChange={(e) => setPerms((p) => ({ ...(p || {}), [f.key]: e.target.checked }))} />
                        <span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{en ? f.en : f.fr}</span>
                          <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{en ? f.hen : f.hfr}</span>
                        </span>
                      </label>
                    ))}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {en ? "Both do nothing at a shop that sells directly. Switch the shop in Settings → Sales Workflow first."
                          : "Les deux n'ont aucun effet dans une boutique en vente directe. Basculez d'abord la boutique dans Paramètres → Circuit de vente."}
                    </div>
                  </div>
                )}

                {/* MP-MANAGER-DELEGATION Phase 3 — "Delegate as manager": only shown for a
                    MANAGER. Everything above governs what THIS person may do directly; this
                    section lends them the boss's authority to APPROVE OTHER staff, scope it
                    to a branch, and (guarded) manage cashiers. One tap removes it all. */}
                {staff.role === "manager" && (
                  <div style={{ marginTop: 10, marginBottom: 8, padding: "11px 12px", background: "rgba(230,190,92,0.06)", border: "1px solid rgba(230,190,92,0.35)", borderRadius: 10 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--brand-light)", marginBottom: 2 }}>
                      {en ? "⭐ Delegate as manager" : "⭐ Déléguer comme responsable"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
                      {en ? "Let this manager act for you while you're away. Turn any of it off and he's a plain manager again."
                          : "Laissez ce responsable agir pour vous en votre absence. Désactivez et il redevient un simple responsable."}
                    </div>

                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>{en ? "Can APPROVE other staff's:" : "Peut APPROUVER pour les autres :"}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 4 }}>
                      {DEPUTY_APPROVABLE.map((a) => {
                        const on = Array.isArray(perms.can_approve) && perms.can_approve.includes(a.key);
                        return (
                          <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                            <input type="checkbox" checked={on}
                              onChange={() => setPerms((p) => {
                                const cur = Array.isArray(p.can_approve) ? p.can_approve : [];
                                return { ...p, can_approve: cur.includes(a.key) ? cur.filter((k) => k !== a.key) : [...cur, a.key] };
                              })} />
                            <span>{en ? a.en : a.fr}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 10 }}>
                      {en ? "Below-cost sales always come to you — never delegated." : "Les ventes sous le prix plancher vous reviennent toujours — jamais déléguées."}
                    </div>

                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 10 }}>
                      {en ? "Which branch he may decide for is set by \"Branch reach\" above."
                          : "La succursale où il peut décider est définie par « Portée » ci-dessus."}
                    </div>

                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>{en ? "Manage staff:" : "Gérer le personnel :"}</div>
                    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                      {[
                        { val: false, en: "No", fr: "Non" },
                        { val: true,  en: "Add & deactivate cashiers", fr: "Ajouter & désactiver caissiers" },
                      ].map((o) => (
                        <button key={String(o.val)} onClick={() => setPerms((p) => ({ ...(p || {}), can_manage_staff: o.val }))}
                          style={{ flex: 1, padding: "7px 4px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                            background: !!perms.can_manage_staff === o.val ? (o.val ? "rgba(16,185,129,0.9)" : "rgba(239,68,68,0.9)") : "var(--bg-elevated)",
                            color: !!perms.can_manage_staff === o.val ? (o.val ? "#06281d" : "#fff") : "var(--text-muted)" }}>
                          {en ? o.en : o.fr}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                      {en ? "Cashiers only — he can never add or deactivate a manager, the owner, or himself, and every such action alerts you."
                          : "Caissiers uniquement — il ne peut jamais ajouter ou désactiver un responsable, le propriétaire, ni lui-même, et chaque action vous alerte."}
                    </div>

                    {/* MP-TRANSFER-GOVERNANCE Part 1: grant a manager the right to cancel/reverse transfers. */}
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 12, marginBottom: 5 }}>{en ? "Cancel / reverse transfers:" : "Annuler / inverser des transferts :"}</div>
                    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                      {[
                        { val: false, en: "No", fr: "Non" },
                        { val: true,  en: "Can cancel transfers", fr: "Peut annuler des transferts" },
                      ].map((o) => (
                        <button key={String(o.val)} onClick={() => setPerms((p) => ({ ...(p || {}), can_cancel_transfers: o.val }))}
                          style={{ flex: 1, padding: "7px 4px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                            background: !!perms.can_cancel_transfers === o.val ? (o.val ? "rgba(16,185,129,0.9)" : "rgba(239,68,68,0.9)") : "var(--bg-elevated)",
                            color: !!perms.can_cancel_transfers === o.val ? (o.val ? "#06281d" : "#fff") : "var(--text-muted)" }}>
                          {en ? o.en : o.fr}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>
                      {en ? "Cancels a pending or fully un-received in-transit transfer, returning stock to source. Every cancel is logged. If 'only the owner can cancel an owner's transfer' is on (Settings), he still can't touch yours."
                          : "Annule un transfert en attente ou en transit non reçu, rendant le stock à la source. Chaque annulation est enregistrée. Si « seul le propriétaire peut annuler un transfert du propriétaire » est activé (Paramètres), il ne peut pas toucher les vôtres."}
                    </div>

                    <button className="btn btn-secondary" style={{ width: "100%", marginTop: 10 }}
                      onClick={() => setPerms((p) => ({ ...(p || {}), can_approve: [], branch_scope: "own", can_manage_staff: false, can_cancel_transfers: false }))}>
                      {en ? "↺ Remove all delegation" : "↺ Retirer toute délégation"}
                    </button>
                  </div>
                )}

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
