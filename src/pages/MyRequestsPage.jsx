// Accountant Log — staffer-facing "My Requests" queue (non-blocking approval
// model). A gated action the staffer triggered is PARKED here as Pending; once
// the owner approves (green light), the staffer taps the Approved item to
// FINALIZE — only then does it execute, produce the receipt, and register to the
// report. Pending / Rejected items are read-only.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
// MP-SCOPED-GRANT: a refused completion is a STATE on the request, not a toast.
import {
  getRefusals, recordRefusal, clearRefusal, isRefusal, refusalSentences,
} from "../utils/requestRefusals";
import { useCurrency } from "../utils/useCurrency";
import api from "../utils/api";
import { useMyRequests } from "../utils/useMyRequests"; // MP-CORRECTIONS-GUARDRAIL
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";
import BelowCostLossDetail from "../components/common/BelowCostLossDetail";
import DiscountApprovalDetail from "../components/common/DiscountApprovalDetail";

const VERB = {
  void:            { en: "cancel a sale",        fr: "annuler une vente" },
  refund:          { en: "refund",               fr: "remboursement" },
  stock_adjust:    { en: "stock change",         fr: "modif de stock" },
  debt_adjust:     { en: "debt/credit change",   fr: "modif dette/crédit" },
  delete_customer: { en: "delete a customer",    fr: "supprimer un client" },
  expense:         { en: "expense",              fr: "dépense" },
  discount:        { en: "discount",             fr: "remise" },
  below_cost_sale: { en: "below-cost sale",       fr: "vente sous le prix plancher" },
  // MP-CORRECTIONS
  float_edit:      { en: "opening-float correction", fr: "correction du fonds de caisse" },
  expense_edit:    { en: "expense correction",    fr: "correction de dépense" },
  expense_delete:  { en: "expense deletion",      fr: "suppression de dépense" },
};
const verb = (a, en) => (VERB[a] ? (en ? VERB[a].en : VERB[a].fr) : a);

const STATUS = {
  pending:  { en: "Pending",  fr: "En attente", bg: "rgba(245,158,11,0.18)", fg: "#fbbf24" },
  approved: { en: "Approved", fr: "Approuvé",   bg: "rgba(16,185,129,0.18)", fg: "#34d399" },
  rejected: { en: "Rejected", fr: "Rejeté",     bg: "rgba(239,68,68,0.18)",  fg: "#fca5a5" },
  executed: { en: "Done",     fr: "Terminé",    bg: "rgba(100,116,139,0.18)", fg: "var(--text-muted)" },
  failed:   { en: "Failed",   fr: "Échoué",     bg: "rgba(239,68,68,0.18)",  fg: "#fca5a5" },
  expired:  { en: "Expired",  fr: "Expiré",     bg: "rgba(100,116,139,0.18)", fg: "var(--text-muted)" },
  cancelled:{ en: "Cancelled",fr: "Annulé",     bg: "rgba(100,116,139,0.18)", fg: "var(--text-muted)" },
};

function whenLabel(iso, en) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MyRequestsPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [receiptEvent, setReceiptEvent] = useState(null);
  const [finalizingId, setFinalizingId] = useState(null);
  const [cancelFor, setCancelFor] = useState(null); // request row pending a cancel confirm
  const navigate = useNavigate();
  // MP-SCOPED-GRANT: refusals live in localStorage (see utils/requestRefusals.js
  // for why), mirrored into state so the row re-renders the moment one lands.
  const [refusals, setRefusals] = useState(() => getRefusals());
  const [resendingId, setResendingId] = useState(null);

  // MP-CORRECTIONS-GUARDRAIL: shared hook — the nav badge reads the same key, and one
  // key with two unwrap shapes is a bug this codebase has already shipped twice.
  const { requests, awaitingCompletion, isLoading } = useMyRequests({ refetchInterval: 7000 });

  // Org settings (currency, name, logo…) for the receipt — same source the
  // refund/void receipts use elsewhere.
  const { data: orgResp } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings").then((r) => r.data),
    staleTime: 300000,
  });
  const orgSettings = orgResp?.data || {};

  const finalizeMut = useMutation({
    mutationFn: (id) => api.post(`/staff/approvals/${id}/finalize`).then((r) => r.data),
    onSuccess: (data, id) => {
      // A completion that succeeds retires any earlier refusal on the same row.
      clearRefusal(id);
      setRefusals(getRefusals());
      if (data?.receipt && data.receipt.data) {
        setReceiptEvent({ eventType: data.receipt.eventType, data: data.receipt.data });
      } else if (data?.note === "already_completed") {
        // Idempotent replay — the sale already exists; never a duplicate.
        toast(en ? (data.message || "Already completed.") : (data.message_fr || "Déjà finalisée."));
      } else {
        toast.success(en ? "Done" : "Terminé");
      }
      qc.invalidateQueries({ queryKey: ["my-requests"] });
      qc.invalidateQueries({ queryKey: ["my-requests-approved-count"] });
    },
    onError: (e, id) => {
      const d = e?.response?.data || {};
      // ── MP-SCOPED-GRANT: refusal vs outage. These must NOT look the same. ──
      // A refusal is a deliberate server answer (resend:true / a known refusal
      // code): it becomes a persistent state on the row, with the numbers and two
      // exits. An outage has no response body at all and just says try again —
      // telling a cashier to "try again" on a genuine refusal is a loop with no
      // way out, and dressing an outage up as a refusal is a lie about the stock.
      if (isRefusal(e)) {
        recordRefusal(id, d);
        setRefusals(getRefusals());
        qc.invalidateQueries({ queryKey: ["my-requests"] });
        return; // no toast — the state on the row IS the message
      }
      const msg = (en ? (d.message_en || d.message) : (d.message_fr || d.message))
        || (en ? "Could not complete — check your connection and try again."
               : "Échec — vérifiez votre connexion et réessayez.");
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ["my-requests"] });
    },
    onSettled: () => setFinalizingId(null),
  });

  // ── RE-SEND: ONE new bundle covering every reason that applies NOW ──────────
  // Posts the original cart back through /sales/bundled-approval-request, which
  // re-evaluates EVERY gate against live data and parks a single fresh request —
  // so a sale that failed on stock and now also breaches the ceiling goes to the
  // boss as ONE approval, not two.
  //
  // 🔴 NO SECOND PIN. There is deliberately no owner-PIN path anywhere in this
  // flow. Prompting again here is the cascading-approval trap (approve → approve
  // → dead sale) that this whole redesign exists to remove.
  const resendMut = useMutation({
    mutationFn: async (row) => {
      const saleReq = row?.payload?.sale_request;
      if (!saleReq) throw new Error("no_sale_request");
      const fresh = await api.post("/sales/bundled-approval-request", saleReq).then((r) => r.data);
      // Retire the old approval so the cashier is never holding two live requests
      // for one order. Best-effort: the new request is what matters.
      await api.post(`/staff/approvals/${row.id}/cancel`).catch(() => {});
      return fresh;
    },
    onSuccess: (_data, row) => {
      clearRefusal(row.id);
      setRefusals(getRefusals());
      toast.success(en ? "Sent to the boss again" : "Renvoyé au patron");
      qc.invalidateQueries({ queryKey: ["my-requests"] });
      qc.invalidateQueries({ queryKey: ["my-requests-approved-count"] });
    },
    onError: () => {
      toast.error(en ? "Could not send it again — check your connection."
                     : "Impossible de renvoyer — vérifiez votre connexion.");
    },
    onSettled: () => setResendingId(null),
  });

  const finalize = (id) => { setFinalizingId(id); finalizeMut.mutate(id); };

  // MP-APPROVAL-CANCEL: drop a pending/approved request without recording a sale.
  const cancelMut = useMutation({
    mutationFn: (id) => api.post(`/staff/approvals/${id}/cancel`).then((r) => r.data),
    onSuccess: (_d, id) => {
      clearRefusal(id);
      setRefusals(getRefusals());
      toast.success(en ? "Request cancelled — no sale recorded" : "Demande annulée — aucune vente");
      setCancelFor(null);
      qc.invalidateQueries({ queryKey: ["my-requests"] });
      qc.invalidateQueries({ queryKey: ["my-requests-approved-count"] });
    },
    onError: (e) => {
      const d = e?.response?.data || {};
      toast.error((en ? (d.message || d.message_en) : (d.message_fr || d.message))
        || (en ? "Could not cancel." : "Impossible d'annuler."));
      setCancelFor(null);
      qc.invalidateQueries({ queryKey: ["my-requests"] });
    },
  });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 20 }}>📨 {en ? "My Requests" : "Mes demandes"}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2, marginBottom: 14 }}>
        {en
          ? "Actions waiting for the owner. When one is Approved, tap it to complete it and print the receipt."
          : "Actions en attente du propriétaire. Quand une est Approuvée, touchez-la pour la finaliser et imprimer le reçu."}
      </div>

      {/* ── MP-CORRECTIONS-GUARDRAIL ────────────────────────────────────────
          The nav badge already counts these, but a badge is easy to walk past —
          and walking past it is the whole failure mode: the owner approves,
          believes it is done, and the action never executes. For a float
          correction that means the drawer keeps a figure the boss has already
          agreed is wrong, until the shift closes and freezes it.
          So: say it in words, at the top, with the count and what happens next. */}
      {awaitingCompletion.length > 0 && (
        <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12,
          background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.40)" }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#34d399" }}>
            {awaitingCompletion.length === 1
              ? (en ? "1 approved action to complete" : "1 action approuvée à terminer")
              : (en ? `${awaitingCompletion.length} approved actions to complete`
                    : `${awaitingCompletion.length} actions approuvées à terminer`)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
            {en
              ? "The owner approved these, but nothing has happened yet — they only take effect once you complete them below. A cash shift cannot be closed while a correction to it is still waiting."
              : "Le propriétaire les a approuvées, mais rien n'a encore changé — elles ne prennent effet qu'une fois terminées ci-dessous. Une caisse ne peut pas être fermée tant qu'une correction la concernant est en attente."}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading && <div style={{ padding: 20, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
        {!isLoading && requests.length === 0 && (
          <div className="empty-state" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ fontWeight: 600 }}>{en ? "No requests yet" : "Aucune demande"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {en ? "Actions that need owner approval will appear here." : "Les actions nécessitant l'approbation du propriétaire apparaîtront ici."}
            </div>
          </div>
        )}
        {requests.map((r, i) => {
          const refusal = refusals[r.id] || null;
          // MP-SCOPED-GRANT: a refused row is NOT "Approved" to the cashier —
          // presenting it as approved with a Complete button is what sent Wisdom
          // back to the same dead tap. It reads as its own status.
          const st = refusal
            ? { en: "Not completed", fr: "Non finalisée",
                bg: "rgba(245,158,11,0.18)", fg: "#fbbf24" }
            : (STATUS[r.status] || STATUS.pending);
          const isApproved = r.status === "approved" && !refusal;
          return (
            <div key={r.id} style={{ padding: "12px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14.5, textTransform: "capitalize" }}>{verb(r.action_type, en)}</span>
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 8, background: st.bg, color: st.fg, fontWeight: 700 }}>
                  {en ? st.en : st.fr}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>{whenLabel(r.created_at, en)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                {/* MP-BELOW-COST-CLEAR-WORDING: below-cost amount is the shortfall (shown labelled below), not the sale total. */}
                {[!["below_cost_sale", "discount"].includes(r.action_type) && r.amount != null ? fmt(Math.abs(Number(r.amount))) : null, r.target_ref, r.branch_name].filter(Boolean).join(" · ") || "—"}
              </div>
              {r.action_type === "below_cost_sale" && (
                <BelowCostLossDetail payload={r.payload} shortfall={r.amount} en={en} fmt={fmt} cashier={r.requested_by_name} />
              )}
              {r.action_type === "discount" && (
                <DiscountApprovalDetail payload={r.payload} en={en} fmt={fmt} cashier={r.requested_by_name} />
              )}
              {r.status === "rejected" && r.decision_note && (
                <div style={{ fontSize: 12.5, color: "#fca5a5", marginTop: 4 }}>{en ? "Reason:" : "Raison :"} {r.decision_note}</div>
              )}
              {r.status === "failed" && r.execution_error && (
                <div style={{ fontSize: 12.5, color: "#fca5a5", marginTop: 4 }}>{r.execution_error}</div>
              )}
              {/* MP-DISCOUNT-HYBRID-APPROVAL: a discount isn't finalized here — the
                  cashier resumes the held sale in the POS to apply it. */}
              {isApproved && r.action_type === "discount" && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "#34d399", fontWeight: 600 }}>
                  {en
                    ? "✅ Approved — open Sales and resume the held sale to apply this discount."
                    : "✅ Approuvé — ouvrez Ventes et reprenez la vente en attente pour appliquer cette remise."}
                </div>
              )}
              {isApproved && r.action_type !== "discount" && (
                <button className="btn btn-primary" style={{ width: "100%", marginTop: 10 }}
                  disabled={finalizingId === r.id}
                  onClick={() => finalize(r.id)}>
                  {finalizingId === r.id ? "..." : (en ? "✓ Complete & print receipt" : "✓ Finaliser et imprimer le reçu")}
                </button>
              )}
              {/* ── MP-SCOPED-GRANT: THE REFUSAL STATE ────────────────────────
                  Persistent (localStorage), survives closing the app, and says
                  what changed in numbers rather than naming an error code.
                  One sentence PER reason — a sale can fail the stock gate AND
                  the ceiling at once, and "something changed" tells Wisdom
                  nothing he can act on. */}
              {refusal && (
                <div style={{ marginTop: 10, padding: "11px 13px", borderRadius: 10,
                  background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.45)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fbbf24" }}>
                    {en ? "Not completed — something changed" : "Non finalisée — quelque chose a changé"}
                  </div>
                  {refusalSentences(refusal, en).map((s, k) => (
                    <div key={k} style={{ fontSize: 13, color: "var(--text-secondary)",
                      marginTop: 5, lineHeight: 1.5 }}>• {s}</div>
                  ))}
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 7, lineHeight: 1.45 }}>
                    {en
                      ? "Nothing was sold and no stock moved. Send it to the boss again, or change the order."
                      : "Rien n'a été vendu et le stock n'a pas bougé. Renvoyez la demande au patron, ou modifiez la commande."}
                  </div>
                  {/* EXACTLY TWO EXITS. No owner-PIN prompt here, by design. */}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary" style={{ flex: 1 }}
                      disabled={resendingId === r.id}
                      onClick={() => { setResendingId(r.id); resendMut.mutate(r); }}>
                      {resendingId === r.id ? "..." : (en ? "Send again to the boss" : "Renvoyer au patron")}
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1 }}
                      onClick={() => navigate("/pos")}>
                      {en ? "Change the order" : "Modifier la commande"}
                    </button>
                  </div>
                </div>
              )}
              {/* MP-APPROVAL-CANCEL: a pending/approved request the cashier no
                  longer needs can be cancelled — no sale is recorded.
                  Hidden while a refusal is showing: that block owns the exits,
                  and a third button next to them is the ambiguity the brief
                  rules out. Abandoning is reachable via "Change the order". */}
              {!refusal && (r.status === "pending" || r.status === "approved") && (
                <button className="btn btn-secondary" style={{ width: "100%", marginTop: 8 }}
                  disabled={cancelMut.isPending}
                  onClick={() => setCancelFor(r)}>
                  ✕ {en ? "Cancel request" : "Annuler la demande"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* MP-APPROVAL-CANCEL: confirm so it isn't tapped by accident. */}
      {cancelFor && (
        <div className="modal-overlay" onClick={() => { if (!cancelMut.isPending) setCancelFor(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
              {en ? "Cancel this request?" : "Annuler cette demande ?"}
            </div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
              {en ? "No sale will be recorded." : "Aucune vente ne sera enregistrée."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={cancelMut.isPending}
                onClick={() => setCancelFor(null)}>
                {en ? "Keep it" : "Garder"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={cancelMut.isPending}
                onClick={() => cancelMut.mutate(cancelFor.id)}>
                {cancelMut.isPending ? "..." : (en ? "Yes, cancel" : "Oui, annuler")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing shared receipt + print overlay, rendered from finalize data. */}
      {receiptEvent && (
        <PaymentEventReceipt
          eventType={receiptEvent.eventType}
          data={receiptEvent.data}
          org={orgSettings}
          lang={lang}
          onClose={() => setReceiptEvent(null)}
        />
      )}
    </div>
  );
}
