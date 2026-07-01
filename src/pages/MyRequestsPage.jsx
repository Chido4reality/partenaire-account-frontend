// Accountant Log — staffer-facing "My Requests" queue (non-blocking approval
// model). A gated action the staffer triggered is PARKED here as Pending; once
// the owner approves (green light), the staffer taps the Approved item to
// FINALIZE — only then does it execute, produce the receipt, and register to the
// report. Pending / Rejected items are read-only.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import api from "../utils/api";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";

const VERB = {
  void:            { en: "cancel a sale",        fr: "annuler une vente" },
  refund:          { en: "refund",               fr: "remboursement" },
  stock_adjust:    { en: "stock change",         fr: "modif de stock" },
  debt_adjust:     { en: "debt/credit change",   fr: "modif dette/crédit" },
  delete_customer: { en: "delete a customer",    fr: "supprimer un client" },
  expense:         { en: "expense",              fr: "dépense" },
  discount:        { en: "discount",             fr: "remise" },
  below_cost_sale: { en: "below-cost sale",       fr: "vente sous le prix plancher" },
};
const verb = (a, en) => (VERB[a] ? (en ? VERB[a].en : VERB[a].fr) : a);

const STATUS = {
  pending:  { en: "Pending",  fr: "En attente", bg: "rgba(245,158,11,0.18)", fg: "#fbbf24" },
  approved: { en: "Approved", fr: "Approuvé",   bg: "rgba(16,185,129,0.18)", fg: "#34d399" },
  rejected: { en: "Rejected", fr: "Rejeté",     bg: "rgba(239,68,68,0.18)",  fg: "#fca5a5" },
  executed: { en: "Done",     fr: "Terminé",    bg: "rgba(100,116,139,0.18)", fg: "var(--text-muted)" },
  failed:   { en: "Failed",   fr: "Échoué",     bg: "rgba(239,68,68,0.18)",  fg: "#fca5a5" },
  expired:  { en: "Expired",  fr: "Expiré",     bg: "rgba(100,116,139,0.18)", fg: "var(--text-muted)" },
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

  const { data: resp, isLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: () => api.get("/staff/my-requests").then((r) => r.data),
    refetchInterval: 7000, // React Query auto-clears on unmount + pauses backgrounded
  });
  const requests = resp?.data || [];

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
    onSuccess: (data) => {
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
    onError: (e) => {
      const d = e?.response?.data || {};
      // Bilingual, never a silent dead tap. The server sends message_en/message_fr.
      const msg = (en ? (d.message_en || d.message) : (d.message_fr || d.message))
        || (en ? "Could not complete the action." : "Impossible de finaliser.");
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ["my-requests"] });
    },
    onSettled: () => setFinalizingId(null),
  });

  const finalize = (id) => { setFinalizingId(id); finalizeMut.mutate(id); };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 20 }}>📨 {en ? "My Requests" : "Mes demandes"}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2, marginBottom: 14 }}>
        {en
          ? "Actions waiting for the owner. When one is Approved, tap it to complete it and print the receipt."
          : "Actions en attente du propriétaire. Quand une est Approuvée, touchez-la pour la finaliser et imprimer le reçu."}
      </div>

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
          const st = STATUS[r.status] || STATUS.pending;
          const isApproved = r.status === "approved";
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
                {[r.amount != null ? fmt(Math.abs(Number(r.amount))) : null, r.target_ref, r.branch_name].filter(Boolean).join(" · ") || "—"}
              </div>
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
            </div>
          );
        })}
      </div>

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
