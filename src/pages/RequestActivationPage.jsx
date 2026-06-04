// MP-RESTRICTED-MODE (B2): in-app "Request Activation" page. Owner picks a
// plan + cycle + manual payment method and submits; an admin approves via the
// portal (Track A3), which flips the org plan and lifts restricted mode.
// Reachable from the restricted banner and Settings → Subscription.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

const PLANS = {
  lite: { monthly: 8000,  yearly: 80000 },
  pro:  { monthly: 10000, yearly: 100000 },
};
const METHODS = [
  { value: "cash",  en: "Cash",            fr: "Espèces" },
  { value: "momo",  en: "Mobile Money",    fr: "Mobile Money" },
  { value: "bank",  en: "Bank transfer",   fr: "Virement bancaire" },
  { value: "other", en: "Other",           fr: "Autre" },
];

export default function RequestActivationPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();
  const [plan, setPlan]   = useState("lite");
  const [cycle, setCycle] = useState("monthly");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [forceForm, setForceForm] = useState(false); // "submit new request" after a reject

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-request"],
    queryFn: () => api.get("/subscriptions/requests/mine").then(r => r.data),
    staleTime: 10000,
  });
  const myReq = data?.data;

  const submit = useMutation({
    mutationFn: () => api.post("/subscriptions/requests", {
      requested_plan_id: plan, billing_cycle: cycle, payment_method: method, notes: notes || null,
    }),
    onSuccess: () => {
      toast.success(en ? "Request submitted" : "Demande envoyée");
      setForceForm(false);
      qc.invalidateQueries({ queryKey: ["my-request"] });
      qc.invalidateQueries({ queryKey: ["my-plan"] });
      refetch();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Could not submit request" : "Échec de l'envoi")),
  });

  const wrap = (children) => <div style={{ maxWidth: 520, margin: "0 auto", padding: 20 }}>{children}</div>;

  if (isLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);

  // Pending → "submitted" view (don't allow duplicate submits).
  if (myReq && myReq.status === "pending" && !forceForm) {
    return wrap(
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{en ? "Request submitted" : "Demande envoyée"}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 6 }}>
          {en
            ? `Sent ${formatDate(myReq.created_at)}. Awaiting admin approval.`
            : `Envoyée le ${formatDate(myReq.created_at)}. En attente d'approbation par l'admin.`}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {String(myReq.requested_plan_id || "").toUpperCase()} · {myReq.billing_cycle === "yearly" ? (en ? "Yearly" : "Annuel") : (en ? "Monthly" : "Mensuel")} · {myReq.payment_method}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 18 }} onClick={() => refetch()}>
          {en ? "Refresh status" : "Actualiser le statut"}
        </button>
      </div>
    );
  }

  // Rejected → show reason + allow a new request.
  if (myReq && myReq.status === "rejected" && !forceForm) {
    return wrap(
      <div className="card">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{en ? "Request declined" : "Demande refusée"}</div>
        </div>
        {myReq.admin_note && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 12, fontSize: 13, color: "var(--text-secondary)", margin: "10px 0" }}>
            <strong>{en ? "Reason: " : "Raison : "}</strong>{myReq.admin_note}
          </div>
        )}
        <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={() => setForceForm(true)}>
          {en ? "Submit a new request" : "Soumettre une nouvelle demande"}
        </button>
      </div>
    );
  }

  // Form.
  const price = PLANS[plan][cycle];
  const yearlySave = PLANS[plan].monthly * 12 - PLANS[plan].yearly;

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "Request activation" : "Demander l'activation"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 18 }}>
        {en
          ? "Choose a plan, pay via your method, then submit. An admin confirms and activates your account."
          : "Choisissez un forfait, payez via votre mode, puis soumettez. Un admin confirme et active votre compte."}
      </div>

      <div className="label">{en ? "Plan" : "Forfait"}</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {["lite", "pro"].map(p => (
          <div key={p} onClick={() => setPlan(p)} style={{ flex: 1, cursor: "pointer", borderRadius: 12, padding: 14,
            border: `2px solid ${plan === p ? "var(--brand)" : "var(--border)"}`, background: plan === p ? "rgba(251,197,3,0.08)" : "var(--bg-card)" }}>
            <div style={{ fontWeight: 800, fontSize: 15, textTransform: "uppercase" }}>{p}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{formatCFA(PLANS[p].monthly)}/{en ? "mo" : "mois"}</div>
          </div>
        ))}
      </div>

      <div className="label">{en ? "Billing cycle" : "Cycle de facturation"}</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {["monthly", "yearly"].map(c => (
          <div key={c} onClick={() => setCycle(c)} style={{ flex: 1, cursor: "pointer", borderRadius: 12, padding: "10px 14px", textAlign: "center",
            border: `2px solid ${cycle === c ? "var(--brand)" : "var(--border)"}`, background: cycle === c ? "rgba(251,197,3,0.08)" : "var(--bg-card)" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{c === "monthly" ? (en ? "Monthly" : "Mensuel") : (en ? "Yearly" : "Annuel")}</div>
            {c === "yearly" && <div style={{ fontSize: 11, color: "#FBC503", marginTop: 2 }}>{en ? "~2 months free" : "~2 mois offerts"}</div>}
          </div>
        ))}
      </div>

      <div className="label">{en ? "Payment method" : "Mode de paiement"}</div>
      <select className="input" value={method} onChange={e => setMethod(e.target.value)} style={{ marginBottom: 16 }}>
        {METHODS.map(m => <option key={m.value} value={m.value}>{en ? m.en : m.fr}</option>)}
      </select>

      <div className="label">{en ? "Notes (optional)" : "Notes (optionnel)"}</div>
      <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
        placeholder={en ? "Payment reference, etc." : "Référence de paiement, etc."} style={{ marginBottom: 18 }} />

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{en ? "Total" : "Total"}</span>
        <span style={{ fontWeight: 800, fontSize: 18 }}>{formatCFA(price)}</span>
      </div>
      {cycle === "yearly" && yearlySave > 0 && (
        <div style={{ fontSize: 12, color: "#FBC503", textAlign: "center", marginBottom: 12 }}>
          {en ? `You save ${formatCFA(yearlySave)} vs monthly` : `Vous économisez ${formatCFA(yearlySave)} vs mensuel`}
        </div>
      )}
      <button className="btn btn-primary btn-block" disabled={submit.isPending} onClick={() => submit.mutate()}>
        {submit.isPending ? (en ? "Submitting…" : "Envoi…") : (en ? "Request activation" : "Demander l'activation")}
      </button>
    </div>
  );
}
