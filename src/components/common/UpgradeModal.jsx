import { useState, useEffect, useRef } from "react";
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
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState(1); // 1=plan, 2=payment, 3=confirm, 4=campay-polling

  // CamPay polling state
  const [campayRef, setCampayRef] = useState(null);
  const [campayUssd, setCampayUssd] = useState(null);
  const [pollSeconds, setPollSeconds] = useState(0);
  const [pollStatus, setPollStatus] = useState("waiting"); // waiting | paid | failed
  const pollInterval = useRef(null);

  const { data: plansData, isLoading: plansLoading, error: plansError } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get("/subscriptions/plans").then(r => r.data),
    retry: 2
  });

  const plans = (plansData?.data || []).filter(p => p.id !== "silver");
  const totalAmount = selectedPlan ? selectedPlan.price_monthly * months : 0;

  // Manual payment (non-CamPay)
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

  // CamPay payment initiation
  const campayMutation = useMutation({
    mutationFn: () => api.post("/subscriptions/campay-pay", {
      plan_id: selectedPlan.id,
      months,
      phone
    }),
    onSuccess: (res) => {
      const { reference, ussd_code } = res.data.data;
      setCampayRef(reference);
      setCampayUssd(ussd_code || null);
      setPollSeconds(0);
      setPollStatus("waiting");
      setStep(4);
      startPolling(reference);
    },
    onError: (err) => toast.error(err.response?.data?.message || "CamPay error")
  });

  function startPolling(reference) {
    let elapsed = 0;
    pollInterval.current = setInterval(async () => {
      elapsed += 5;
      setPollSeconds(elapsed);
      if (elapsed >= 120) {
        clearInterval(pollInterval.current);
        setPollStatus("failed");
        return;
      }
      try {
        const res = await api.get(`/subscriptions/campay-check/${reference}`);
        if (res.data.paid) {
          clearInterval(pollInterval.current);
          setPollStatus("paid");
          qc.invalidateQueries(["my-plan"]);
        }
      } catch (_) {}
    }, 5000);
  }

  useEffect(() => () => clearInterval(pollInterval.current), []);

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
          {step !== 4 && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>✕</button>
          )}
        </div>

        {/* Step 1: Choose Plan */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase" }}>
              {lang === "en" ? "Select a plan" : "Choisir un plan"}
            </div>
            {plansLoading && <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>Loading plans...</div>}
            {plansError && <div style={{ textAlign: "center", padding: 20, color: "#f87171" }}>Failed to load plans. Please try again.</div>}
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
                      {(Array.isArray(plan.features) ? plan.features : (() => { try { return JSON.parse(plan.features || "[]"); } catch { return []; } })()).map((f, i) => (
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

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="label">{lang === "en" ? "Duration" : "Durée"}</label>
              <select className="input" value={months} onChange={e => setMonths(+e.target.value)}>
                <option value={1}>{lang === "en" ? "1 month" : "1 mois"} — {formatCFA(selectedPlan?.price_monthly)}</option>
                <option value={3}>{lang === "en" ? "3 months" : "3 mois"} — {formatCFA(selectedPlan?.price_monthly * 3)}</option>
                <option value={6}>{lang === "en" ? "6 months" : "6 mois"} — {formatCFA(selectedPlan?.price_monthly * 6)}</option>
                <option value={12}>{lang === "en" ? "12 months" : "12 mois"} — {formatCFA(selectedPlan?.price_monthly * 12)}</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {PAYMENT_METHODS.map(pm => (
                <div key={pm.value} onClick={() => setPaymentMethod(pm.value)}
                  style={{ padding: "12px 16px", borderRadius: 12, border: `2px solid ${paymentMethod === pm.value ? pm.color : "var(--border)"}`, background: paymentMethod === pm.value ? `${pm.color}15` : "var(--bg-card)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{pm.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{pm.label}</span>
                  {pm.value === "campay" && <span style={{ fontSize: 11, color: "var(--brand-light)", marginLeft: "auto" }}>⚡ Auto-approved</span>}
                </div>
              ))}
            </div>

            {/* Phone number — only shown for CamPay */}
            {paymentMethod === "campay" && (
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="label">{lang === "en" ? "Mobile Money phone number" : "Numéro Mobile Money"}</label>
                <input className="input" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+237 6XX XXX XXX" type="tel" />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en" ? "You will receive a USSD push on this number to confirm payment." : "Vous recevrez un USSD push sur ce numéro pour confirmer le paiement."}
                </div>
              </div>
            )}

            {paymentMethod !== "campay" && (
              <div className="form-group">
                <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
                <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={lang === "en" ? "e.g. Transfer reference number..." : "Ex: Référence du transfert..."} />
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>← {lang === "en" ? "Back" : "Retour"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!paymentMethod || (paymentMethod === "campay" && !phone.trim())}
                onClick={() => setStep(3)}>
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
              {paymentMethod === "campay" && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Phone" : "Téléphone"}</span>
                  <strong>{phone}</strong>
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <strong style={{ fontSize: 18, color: "var(--brand-light)" }}>{formatCFA(totalAmount)}</strong>
              </div>
            </div>

            {paymentMethod === "campay" ? (
              <div style={{ background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.25)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: "var(--brand-light)" }}>
                ⚡ {lang === "en"
                  ? `A USSD push will be sent to ${phone}. Accept it to complete payment automatically.`
                  : `Un USSD push sera envoyé au ${phone}. Acceptez-le pour finaliser le paiement automatiquement.`}
              </div>
            ) : (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: "#fbbf24" }}>
                ⏳ {lang === "en"
                  ? `After submitting, your request will be pending until admin approves. Please send ${formatCFA(totalAmount)} via ${PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label} and mention your account ID.`
                  : `Après soumission, votre demande sera en attente jusqu'à approbation. Envoyez ${formatCFA(totalAmount)} via ${PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label} et mentionnez votre ID de compte.`}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(2)}>← {lang === "en" ? "Back" : "Retour"}</button>
              {paymentMethod === "campay" ? (
                <button className="btn btn-primary" style={{ flex: 2, background: "#4f46e5", borderColor: "#4f46e5" }}
                  disabled={campayMutation.isPending} onClick={() => campayMutation.mutate()}>
                  {campayMutation.isPending ? "⏳ Initiating..." : (lang === "en" ? "⚡ Pay with CamPay" : "⚡ Payer via CamPay")}
                </button>
              ) : (
                <button className="btn btn-primary" style={{ flex: 2, background: "#10b981", borderColor: "#10b981" }}
                  disabled={upgradeMutation.isPending} onClick={() => upgradeMutation.mutate()}>
                  {upgradeMutation.isPending ? "..." : (lang === "en" ? "✓ Submit Request" : "✓ Soumettre la demande")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 4: CamPay polling */}
        {step === 4 && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            {pollStatus === "waiting" && (
              <>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
                  {lang === "en" ? "Waiting for payment…" : "En attente du paiement…"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
                  {lang === "en"
                    ? `Check your phone (${phone}) and accept the USSD prompt.`
                    : `Vérifiez votre téléphone (${phone}) et acceptez le USSD.`}
                </div>
                {campayUssd && (
                  <div style={{ background: "rgba(79,70,229,0.1)", border: "1px solid rgba(79,70,229,0.3)", borderRadius: 12, padding: "14px 20px", marginBottom: 20, display: "inline-block" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", fontWeight: 700 }}>USSD Code</div>
                    <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: 2 }}>{campayUssd}</div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4f46e5", animation: "pulse 1.5s infinite" }} />
                  {lang === "en" ? `Checking… ${pollSeconds}s / 120s` : `Vérification… ${pollSeconds}s / 120s`}
                </div>
                <div style={{ marginTop: 20 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => { clearInterval(pollInterval.current); onClose(); }}>
                    {lang === "en" ? "Cancel" : "Annuler"}
                  </button>
                </div>
              </>
            )}

            {pollStatus === "paid" && (
              <>
                <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
                <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8, color: "#10b981" }}>
                  {lang === "en" ? "Payment confirmed!" : "Paiement confirmé!"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
                  {lang === "en"
                    ? `Your account has been upgraded to ${selectedPlan?.name}. Enjoy!`
                    : `Votre compte a été mis à niveau vers ${selectedPlan?.name}. Profitez-en!`}
                </div>
                <button className="btn btn-primary" style={{ width: "100%", height: 44 }} onClick={onClose}>
                  {lang === "en" ? "Close" : "Fermer"}
                </button>
              </>
            )}

            {pollStatus === "failed" && (
              <>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⏱️</div>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
                  {lang === "en" ? "Payment timeout" : "Délai dépassé"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
                  {lang === "en"
                    ? "We didn't receive confirmation. Your request is still pending — contact support if payment was deducted."
                    : "Aucune confirmation reçue. Votre demande est en attente — contactez le support si le paiement a été débité."}
                </div>
                <button className="btn btn-primary" style={{ width: "100%", height: 44 }} onClick={onClose}>
                  {lang === "en" ? "Close" : "Fermer"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
