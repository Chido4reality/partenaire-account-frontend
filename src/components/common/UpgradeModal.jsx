import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../../store";
import api, { formatCFA } from "../../utils/api";

const PAYMENT_METHODS = [
  { value: "mtn_momo",      label: "MTN Mobile Money",    icon: "📱", color: "#FFC300" },
  { value: "orange_money",  label: "Orange Money",         icon: "🟠", color: "#FF6600" },
  { value: "campay",        label: "CamPay (Auto)",        icon: "⚡", color: "#4f46e5" },
  { value: "cash",          label: "Cash",                 icon: "💵", color: "#10b981" },
  { value: "bank",          label: "Bank Transfer",        icon: "🏦", color: "#6366f1" },
];

export default function UpgradeModal({ onClose, currentPlan }) {
  const { lang } = useLangStore();
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [months, setMonths] = useState(1);
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState(1); // 1=choose plan, 2=choose payment, 3=confirm

  const { data: plansData } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get("/subscriptions/plans").then(r => r.data)
  });

  const plans = (plansData?.data || []).filter(p => p.id !== "silver");

  const upgradeMutation = useMutation({
    mutationFn: () => api.post("/subscriptions/request-upgrade", {
      plan_id: selectedPlan.id,
      payment_method: paymentMethod,
      months,
      notes: notes || null
    }),
    onSuccess: () => {
      toast.success(lang === "en"
        ? "✓ Upgrade request sent! Pending admin approval."
        : "✓ Demande envoyée! En attente d'approbation.");
      qc.invalidateQueries(["my-plan"]);
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const totalAmount = selectedPlan ? selectedPlan.price_monthly * months : 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 20, padding: 28, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>
              {lang === "en" ? "Upgrade your plan" : "Améliorer votre plan"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {lang === "en" ? `Current: ${currentPlan?.name || "Silver"}` : `Actuel: ${currentPlan?.name || "Silver"}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        {/* Step 1: Choose Plan */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase" }}>
              {lang === "en" ? "Select a plan" : "Choisir un plan"}
            </div>
            {plans.map(plan => (
              <div key={plan.id} onClick={() => setSelectedPlan(plan)}
                style={{ padding: 16, borderRadius: 14, border: `2px solid ${selectedPlan?.id === plan.id ? "var(--brand)" : "var(--border)"}`, background: selectedPlan?.id === plan.id ? "rgba(79,70,229,0.08)" : "var(--bg-card)", cursor: "pointer", marginBottom: 10, transition: "all 0.15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{plan.badge_icon} {plan.name}</div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                      {plan.max_locations === -1 ? "∞" : plan.max_locations} {lang === "en" ? "location(s)" : "emplacement(s)"} ·{" "}
                      {plan.max_products === -1 ? "∞" : plan.max_products} {lang === "en" ? "products" : "produits"} ·{" "}
                      {plan.max_users === -1 ? "∞" : plan.max_users} {lang === "en" ? "user(s)" : "utilisateur(s)"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {(JSON.parse(plan.features || "[]")).map((f, i) => (
                        <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(79,70,229,0.1)", color: "var(--brand-light)" }}>✓ {f}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "var(--brand-light)" }}>{formatCFA(plan.price_monthly)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "/month" : "/mois"}</div>
                  </div>
                </div>
              </div>
            ))}

            <button className="btn btn-primary" style={{ width: "100%", height: 46, marginTop: 8 }}
              disabled={!selectedPlan} onClick={() => setStep(2)}>
              {lang === "en" ? "Continue →" : "Continuer →"}
            </button>
          </div>
        )}

        {/* Step 2: Choose Payment Method */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase" }}>
              {lang === "en" ? "Payment method" : "Moyen de paiement"}
            </div>

            {/* Duration */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="label">{lang === "en" ? "Duration" : "Durée"}</label>
              <select className="input" value={months} onChange={e => setMonths(+e.target.value)}>
                <option value={1}>{lang === "en" ? "1 month" : "1 mois"} — {formatCFA(selectedPlan?.price_monthly)}</option>
                <option value={3}>{lang === "en" ? "3 months" : "3 mois"} — {formatCFA(selectedPlan?.price_monthly * 3)}</option>
                <option value={6}>{lang === "en" ? "6 months" : "6 mois"} — {formatCFA(selectedPlan?.price_monthly * 6)}</option>
                <option value={12}>{lang === "en" ? "12 months" : "12 mois"} — {formatCFA(selectedPlan?.price_monthly * 12)}</option>
              </select>
            </div>

            {/* Payment methods */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {PAYMENT_METHODS.map(pm => (
                <div key={pm.value} onClick={() => setPaymentMethod(pm.value)}
                  style={{ padding: "12px 16px", borderRadius: 12, border: `2px solid ${paymentMethod === pm.value ? pm.color : "var(--border)"}`, background: paymentMethod === pm.value ? `${pm.color}15` : "var(--bg-card)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{pm.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{pm.label}</span>
                  {pm.value === "campay" && <span style={{ fontSize: 11, color: "var(--brand-light)", marginLeft: "auto" }}>✓ Auto-approved</span>}
                </div>
              ))}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={lang === "en" ? "e.g. Transfer reference number..." : "Ex: Référence du transfert..."} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>← {lang === "en" ? "Back" : "Retour"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!paymentMethod} onClick={() => setStep(3)}>
                {lang === "en" ? "Review →" : "Vérifier →"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 16, textTransform: "uppercase" }}>
              {lang === "en" ? "Confirm upgrade" : "Confirmer l'upgrade"}
            </div>

            <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Plan" : "Plan"}</span>
                <strong>{selectedPlan?.badge_icon} {selectedPlan?.name}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Duration" : "Durée"}</span>
                <strong>{months} {lang === "en" ? "month(s)" : "mois"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Payment" : "Paiement"}</span>
                <strong>{PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label}</strong>
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <strong style={{ fontSize: 18, color: "var(--brand-light)" }}>{formatCFA(totalAmount)}</strong>
              </div>
            </div>

            {paymentMethod !== "campay" && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: "#fbbf24" }}>
                ⏳ {lang === "en"
                  ? `After submitting, your request will be pending until admin approves. Please send ${formatCFA(totalAmount)} via ${PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label} and mention your account ID.`
                  : `Après soumission, votre demande sera en attente jusqu'à approbation. Envoyez ${formatCFA(totalAmount)} via ${PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label} et mentionnez votre ID de compte.`}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(2)}>← {lang === "en" ? "Back" : "Retour"}</button>
              <button className="btn btn-primary" style={{ flex: 2, background: "#10b981", borderColor: "#10b981" }}
                disabled={upgradeMutation.isPending} onClick={() => upgradeMutation.mutate()}>
                {upgradeMutation.isPending ? "..." : (lang === "en" ? "✓ Submit Request" : "✓ Soumettre la demande")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
