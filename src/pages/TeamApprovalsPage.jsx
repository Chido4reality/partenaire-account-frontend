// MP-MANAGER-DELEGATION Phase 1 — a delegated MANAGER's deputy inbox: the pending
// requests OTHER staff raised that this manager may decide on the boss's behalf. The
// server (GET /staff/approvals, owner-or-deputy) already scopes the list to what his
// grant covers (action_types in can_approve, his branch, NEVER below-cost — those still
// go to the owner). Approving requires the manager's OWN PIN (same check as the owner).
// The OWNER keeps using the Accountant Log inbox; this surface is for managers.
import { useState } from "react";
import { locationNameLabel } from "../utils/locations"; // GOODS-BUFFER: branch names follow the app language
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import api from "../utils/api";
import ApprovalDetailView from "../components/common/ApprovalDetailView"; // MP-APPROVAL-FULL-DETAIL
import HoldRejectFields, { HOLD_ACTION, holdRejectReady } from "../components/common/HoldRejectFields"; // receive-mismatch gate
import ApproverPasswordInput, { approverPasswordReady, approverPasswordLabel } from "../components/common/ApproverPasswordInput"; // approval password = login
import HoldShortfallFields, { useHoldShortfall, holdShortfallReady, holdShortfallBody, approveBlockedReason } from "../components/common/HoldShortfallFields"; // variance outcomes
import HeldReceiptsBanner, { HoldTierBadge } from "../components/common/HeldReceiptsBanner"; // held-receipt reminders
import { SHOP_TZ } from "../utils/shopTime";
import { useWorkMode } from "../utils/workMode"; // WAREHOUSE MODE

const VERB = {
  void:            { en: "cancel a sale",      fr: "annuler une vente" },
  refund:          { en: "refund",             fr: "remboursement" },
  stock_adjust:    { en: "stock change",       fr: "modif de stock" },
  stock_count:     { en: "stock count",        fr: "comptage de stock" },
  debt_adjust:     { en: "debt/credit change", fr: "modif dette/crédit" },
  delete_customer: { en: "delete a customer",  fr: "supprimer un client" },
  expense:         { en: "expense",            fr: "dépense" },
  discount:        { en: "discount",           fr: "remise" },
  transfer:        { en: "transfer goods",     fr: "transfert de marchandises" },
  bundled_sale:    { en: "a sale needing approval", fr: "une vente à approuver" },
  // MP-CORRECTIONS. NOTE these only appear here if the owner adds them to a manager's
  // can_approve grant — the deputy inbox is server-scoped to that list.
  float_edit:      { en: "opening-float correction", fr: "correction du fonds de caisse" },
  expense_edit:    { en: "expense correction",  fr: "correction de dépense" },
  expense_delete:  { en: "expense deletion",    fr: "suppression de dépense" },
  // RECEIVE-MISMATCH GATE: ANY manager decides these — no grant needed (Peter).
  transfer_receive_hold: { en: "goods received short", fr: "réception non conforme" },
};
const verb = (a, en) => (VERB[a] ? (en ? VERB[a].en : VERB[a].fr) : a);

function whenLabel(iso, en) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ });
}

export default function TeamApprovalsPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [pinFor, setPinFor] = useState(null); // row awaiting PIN to approve
  const [pin, setPin] = useState("");
  const [rejectFor, setRejectFor] = useState(null); // row awaiting reject confirm
  const [note, setNote] = useState("");
  const [holdMode, setHoldMode] = useState(null); // receive-mismatch gate
  const [holdPin, setHoldPin] = useState("");
  const [sfAnswers, setSfAnswers] = useState({}); // variance outcomes: one answer per short line
  const hold = useHoldShortfall(pinFor);
  const rejectHold = useHoldShortfall(rejectFor); // its source branch name, for the reject wording

  const workMode = useWorkMode();
  const { data: resp, isLoading, isError } = useQuery({
    queryKey: ["team-approvals", workMode],   // WAREHOUSE MODE: the warehouse view lists fewer (one cache per mode)
    queryFn: () => api.get("/staff/approvals?status=pending").then((r) => r.data),
    refetchInterval: 7000,
  });
  const rows = resp?.data || [];

  const closePin = () => { setPinFor(null); setPin(""); setSfAnswers({}); };
  const closeReject = () => { setRejectFor(null); setNote(""); setHoldMode(null); setHoldPin(""); };

  const approveMut = useMutation({
    mutationFn: ({ id, pin, extra }) => api.post(`/staff/approvals/${id}/approve`, { pin, ...(extra || {}) }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res?.virtual
        ? (en ? "Approved — the goods left the warehouse. Transfer complete." : "Approuvé — la marchandise a quitté l'entrepôt. Transfert terminé.")
        : res?.status === "executed"
        ? (en ? "Approved — the counted goods are now in stock." : "Approuvé — les marchandises comptées sont en stock.")
        : (en ? "Approved — the staffer can now complete it." : "Approuvé — l'employé peut maintenant finaliser."));
      const sf = res?.shortfall;
      if (sf && sf.success) toast.success(en ? "Shortfall closed" : "Manque clos");
      else if (sf) toast.error(sf[en ? "message_en" : "message_fr"] || sf.message || (en ? "Shortfall still open on the transfer" : "Manque toujours ouvert sur le transfert"));
      closePin();
      qc.invalidateQueries({ queryKey: ["team-approvals"] });
    },
    onError: (e) => {
      const d = e?.response?.data || {};
      // Already decided by an earlier tap (or another device): not a failure.
      if (d.error === "not_pending" && (d.status === "executed" || d.status === "approved")) {
        toast.success(d.status === "executed" ? (en ? "Already approved and done." : "Déjà approuvé et exécuté.")
          : (en ? "Already approved." : "Déjà approuvé."));
        closePin();
        qc.invalidateQueries({ queryKey: ["team-approvals"] });
        return;
      }
      toast.error((en ? (d.message_en || d.message) : (d.message_fr || d.message))
        || (en ? "Could not approve." : "Impossible d'approuver."));
      // keep the modal open on a wrong-PIN so they can retry; close on structural errors
      if (d.error !== "invalid_pin" && d.error !== "bad_pin_format") closePin();
      else setPin("");
      if (d.virtual) qc.invalidateQueries({ queryKey: ["team-approvals"] });   // WAREHOUSE MODE: now 'failed'
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, note, mode, pin }) => api.post(`/staff/approvals/${id}/reject`, { note, ...(mode ? { mode, pin } : {}) }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res?.mode === "recount" ? (en ? "Sent back for a recount." : "Renvoyé pour recomptage.")
        : res?.mode === "return_to_source" ? (en ? "Return transfer created — the source must receive it." : "Transfert de retour créé — la source doit le réceptionner.")
        : (en ? "Rejected." : "Rejeté."));
      closeReject();
      qc.invalidateQueries({ queryKey: ["team-approvals"] });
    },
    onError: (e) => {
      const d = e?.response?.data || {};
      toast.error((en ? (d.message_en || d.message) : (d.message_fr || d.message))
        || (en ? "Could not reject." : "Impossible de rejeter."));
      closeReject();
    },
  });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 20 }}>✅ {en ? "Approvals" : "Approbations"}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2, marginBottom: 14 }}>
        {en
          ? "Requests from your team that the owner delegated to you. Approve with your password or reject. Below-cost sales still go to the owner."
          : "Demandes de votre équipe que le propriétaire vous a déléguées. Approuvez avec votre mot de passe ou rejetez. Les ventes sous le prix plancher restent au propriétaire."}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading && <div style={{ padding: 20, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
        {isError && !isLoading && (
          <div style={{ padding: 20, color: "#fca5a5" }}>{en ? "Could not load requests. Pull to retry." : "Impossible de charger. Réessayez."}</div>
        )}
        <div style={{ padding: "0 14px" }}><HeldReceiptsBanner variant="pinned" en={en} /></div>
        {!isLoading && !isError && rows.length === 0 && (
          <div className="empty-state" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontWeight: 600 }}>{en ? "Nothing waiting" : "Rien en attente"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {en ? "Requests you can approve will appear here." : "Les demandes que vous pouvez approuver apparaîtront ici."}
            </div>
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.id} style={{ padding: "12px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 14.5, textTransform: "capitalize" }}>{verb(r.action_type, en)}</span>
              <HoldTierBadge tier={r.hold_tier} ageHours={r.hold_age_hours} en={en} />
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>{whenLabel(r.created_at, en)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
              {[r.requested_by_name, r.amount != null ? fmt(Math.abs(Number(r.amount))) : null, r.target_ref, locationNameLabel(r.branch_name, en ? "en" : "fr")].filter(Boolean).join(" · ") || "—"}
            </div>
            {/* MP-APPROVAL-FULL-DETAIL: a delegated manager decides the same requests the
                boss does and was equally blind here. Safe by construction — the server
                404s any row outside his grant, and below-cost (the only owner-only figure
                this renders) is never delegated, so cost/floor can't reach this screen. */}
            <ApprovalDetailView approval={r} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}
                disabled={rejectMut.isPending || approveMut.isPending}
                onClick={() => { setRejectFor(r); setNote(""); }}>
                ✕ {en ? "Reject" : "Rejeter"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={rejectMut.isPending || approveMut.isPending}
                onClick={() => { setPinFor(r); setPin(""); }}>
                ✓ {en ? "Approve" : "Approuver"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Approve → the manager's OWN PIN (server verifies against his pa_users.pin_hash). */}
      {pinFor && (
        <div className="modal-overlay" onClick={() => { if (!approveMut.isPending) closePin(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {en ? "Enter your password to approve" : "Entrez votre mot de passe pour approuver"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              {verb(pinFor.action_type, en)}{pinFor.requested_by_name ? ` · ${pinFor.requested_by_name}` : ""}
            </div>
            <label className="label">{approverPasswordLabel(en)}</label>
            <ApproverPasswordInput value={pin} onChange={setPin} autoFocus
              style={{ width: "100%", marginBottom: 14, textAlign: "center", fontSize: 18 }} />
            {pinFor.action_type === HOLD_ACTION && (
              <div style={{ marginBottom: 14, maxHeight: "45vh", overflowY: "auto" }}>
                <HoldShortfallFields en={en} hold={hold} answers={sfAnswers} setAnswers={setSfAnswers} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={approveMut.isPending} onClick={closePin}>
                {en ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={approveMut.isPending || !approverPasswordReady(pin)
                  || (pinFor.action_type === HOLD_ACTION && !holdShortfallReady(hold, sfAnswers))}
                onClick={() => approveMut.mutate({ id: pinFor.id, pin,
                  extra: pinFor.action_type === HOLD_ACTION ? holdShortfallBody(hold, sfAnswers) : {} })}>
                {approveMut.isPending ? "..." : (en ? "Approve" : "Approuver")}
              </button>
            </div>
            {!approveMut.isPending && approveBlockedReason({ en, pin, hold: pinFor.action_type === HOLD_ACTION ? hold : null, answers: sfAnswers }) && (
              <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8, textAlign: "center" }}>
                {approveBlockedReason({ en, pin, hold: pinFor.action_type === HOLD_ACTION ? hold : null, answers: sfAnswers })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject → optional reason. */}
      {rejectFor && (
        <div className="modal-overlay" onClick={() => { if (!rejectMut.isPending) closeReject(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>
              {en ? "Reject this request?" : "Rejeter cette demande ?"}
            </div>
            {rejectFor.action_type === HOLD_ACTION && (
              <HoldRejectFields en={en} mode={holdMode} setMode={setHoldMode} pin={holdPin} setPin={setHoldPin}
                sourceName={(rejectHold.payload || {}).from_name} />
            )}
            <input className="input" type="text" value={note} maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder={en ? "Reason (optional)" : "Raison (facultatif)"}
              style={{ width: "100%", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={rejectMut.isPending} onClick={closeReject}>
                {en ? "Keep" : "Garder"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={rejectMut.isPending || (rejectFor.action_type === HOLD_ACTION && !holdRejectReady(holdMode, holdPin))}
                onClick={() => rejectMut.mutate({ id: rejectFor.id, note: note.trim() || null,
                  ...(rejectFor.action_type === HOLD_ACTION ? { mode: holdMode, pin: holdPin } : {}) })}>
                {rejectMut.isPending ? "..." : (en ? "Yes, reject" : "Oui, rejeter")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
