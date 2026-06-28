// MP-BILLING-V3 — unified subscription form.
//
// ONE flow for ALL THREE paid plans (Lite / Pro / Pro Plus): pick a plan →
// pay via Flutterwave Standard Checkout (the hosted page where the user chooses
// card / mobile money / bank / USSD) → the webhook auto-activates the plan.
// No per-plan special case. Manual ("pay offline → admin approval") stays as a
// fallback/audit path only.
//
// Plans + country-aware pricing come from GET /subscriptions/plans (default
// Cameroun/XAF). Reachable from the restricted banner and Settings →
// "Manage subscription". A ?plan=<id> query param preselects a plan so Pro Plus
// feature deep-links (AI / Staff / Asset) can land here with Pro Plus chosen.
import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatDate } from "../utils/api";
import { useCurrency } from "../utils/useCurrency";

// Manual (offline) fallback methods → admin approval, ONLY for paying the owner
// directly offline. MP-SUB-NO-PHANTOM-PENDING: Mobile Money / Orange are NOT
// here — those are Flutterwave methods and go through the FW hosted page (the
// method is chosen on FW, not in this form). No in-app MoMo button may create a
// manual request. Manual = truly-offline cash / bank transfer only.
const MANUAL_METHODS = [
  { value: "cash", en: "Cash",          fr: "Espèces" },
  { value: "bank", en: "Bank transfer", fr: "Virement bancaire" },
];

const DURATIONS = [1, 3, 6, 12];

export default function RequestActivationPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const deepLinkPlan = searchParams.get("plan"); // e.g. ?plan=pro_plus

  const [selectedId, setSelectedId] = useState(null);
  const [months, setMonths] = useState(1);
  const [showManual, setShowManual] = useState(false);
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  // Plans (country-aware price + currency) — single source of truth.
  const { data: plansData, isLoading: plansLoading, error: plansError } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get("/subscriptions/plans").then(r => r.data),
    retry: 2,
  });

  // Pending state: a Flutterwave/manual upgrade is already awaiting approval.
  const { data: myPlanData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
  });
  const pending = !!myPlanData?.data?.has_pending_request;
  const pendingPlanId = myPlanData?.data?.pending_plan_id || null;

  // Only purchasable paid tiers (Lite / Pro / Pro Plus). Pro Plus appears
  // automatically once it's active in pa_plans — no hardcoded list.
  const plans = useMemo(() => (plansData?.data || [])
    .filter(p => p.id !== "silver" && p.id !== "trial" && (p.price ?? p.price_monthly) > 0)
    .sort((a, b) => (a.price ?? a.price_monthly) - (b.price ?? b.price_monthly)),
    [plansData]);

  // Resolve the effective selection: explicit click → deep-link → first plan.
  const selected = useMemo(() => {
    if (!plans.length) return null;
    const wanted = selectedId || deepLinkPlan;
    return plans.find(p => p.id === wanted) || plans[0];
  }, [plans, selectedId, deepLinkPlan]);

  const unitPrice = selected ? (selected.price ?? selected.price_monthly) : 0;
  const total = unitPrice * months;
  // MP-SUBSCRIPTION-DISCOUNT: the backend already resolves the admin pricing rule
  // and returns original_price + discount on each plan. Surface it (struck-through
  // original + −X% badge + savings) — without this the discounted price looked
  // like a plain full price (e.g. a 45,000 → 40,500 −10% showed only "40,500").
  const unitOriginal = selected ? (selected.original_price ?? unitPrice) : 0;
  const totalOriginal = unitOriginal * months;
  const selDiscount = selected?.discount || null;
  const discBadge = (d) => !d ? null
    : (d.discount_type === "percent" ? `−${d.discount_value}%` : `−${fmt(d.amount_off)}`);
  const pendingPlan = plans.find(p => p.id === pendingPlanId);

  // PRIMARY — Flutterwave Standard Checkout. Backend creates the hosted payment
  // + a pending record and returns the link; we redirect. Activation happens via
  // the verified webhook (auto-activate), never on the redirect alone.
  const flwMutation = useMutation({
    mutationFn: () => api.post("/subscriptions/flw/initiate", { plan_id: selected.id, months }),
    onSuccess: (res) => {
      const link = res.data?.data?.link;
      if (link) window.location.href = link;
      else toast.error(en ? "Could not start payment." : "Impossible de démarrer le paiement.");
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Payment error" : "Erreur de paiement")),
  });

  // FALLBACK — manual offline payment → admin approval (audit trail).
  const manualMutation = useMutation({
    mutationFn: () => api.post("/subscriptions/request-upgrade", {
      plan_id: selected.id, payment_method: method, months, notes: notes || null,
    }),
    onSuccess: () => {
      toast.success(en ? "✓ Request sent! Pending admin approval." : "✓ Demande envoyée ! En attente d'approbation.");
      qc.invalidateQueries({ queryKey: ["my-plan"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Could not submit request" : "Échec de l'envoi")),
  });

  const wrap = (children) => <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>{children}</div>;

  // ── Pending → don't allow duplicate submits ───────────────────────────────
  if (pending) {
    return wrap(
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {en ? "Upgrade pending" : "Mise à niveau en attente"}
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 8, lineHeight: 1.6 }}>
          {en
            ? `Your request${pendingPlan ? ` for ${pendingPlan.badge_icon} ${pendingPlan.name}` : ""} is being processed. Your plan activates automatically once payment is confirmed — no need to submit again.`
            : `Votre demande${pendingPlan ? ` pour ${pendingPlan.badge_icon} ${pendingPlan.name}` : ""} est en cours. Votre plan s'active automatiquement après confirmation du paiement — inutile de renvoyer.`}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => qc.invalidateQueries({ queryKey: ["my-plan"] })}>
          {en ? "Refresh status" : "Actualiser le statut"}
        </button>
      </div>
    );
  }

  if (plansLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading plans…" : "Chargement…"}</div>);
  if (plansError) return wrap(<div style={{ color: "#f87171" }}>{en ? "Failed to load plans. Please try again." : "Échec du chargement. Réessayez."}</div>);

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "Choose your plan" : "Choisissez votre forfait"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 18, lineHeight: 1.55 }}>
        {en
          ? "Select a plan and pay securely with Flutterwave — you'll choose your payment method (card, mobile money, bank, USSD) on the next page. Your plan activates automatically once payment is confirmed."
          : "Sélectionnez un forfait et payez en toute sécurité avec Flutterwave — vous choisirez votre moyen de paiement (carte, mobile money, banque, USSD) à l'étape suivante. Votre plan s'active automatiquement après confirmation."}
      </div>

      {/* Plan cards — Lite / Pro / Pro Plus, consistent UI, country-aware price */}
      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        {plans.map(p => {
          const price = p.price ?? p.price_monthly;
          const isSel = selected?.id === p.id;
          const feats = Array.isArray(p.features) ? p.features : (() => { try { return JSON.parse(p.features || "[]"); } catch { return []; } })();
          return (
            <div key={p.id} onClick={() => setSelectedId(p.id)}
              style={{ cursor: "pointer", borderRadius: 14, padding: 16,
                border: `2px solid ${isSel ? "var(--brand)" : "var(--border)"}`,
                background: isSel ? "rgba(251,197,3,0.08)" : "var(--bg-card)", transition: "all 0.15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{p.badge_icon} {p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {p.max_locations === -1 ? "∞" : p.max_locations} {en ? "location(s)" : "emplacement(s)"} ·{" "}
                    {p.max_products === -1 ? "∞" : p.max_products} {en ? "products" : "produits"} ·{" "}
                    {p.max_users === -1 ? "∞" : p.max_users} {en ? "user(s)" : "utilisateur(s)"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {feats.map((f, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(251,197,3,0.1)", color: "var(--brand-light)" }}>✓ {f}</span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                  {/* MP-SUBSCRIPTION-DISCOUNT: struck-through original when an admin rule applies. */}
                  {p.discount && p.original_price != null && p.original_price > price && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "line-through" }}>{fmt(p.original_price)}</div>
                  )}
                  <div style={{ fontWeight: 800, fontSize: 18, color: p.discount ? "#34d399" : "var(--brand-light)" }}>{fmt(price)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "/month" : "/mois"}</div>
                  {p.discount && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", marginTop: 2 }}>
                      {p.discount.discount_type === "percent" ? `−${p.discount.discount_value}%` : `−${fmt(p.discount.amount_off)}`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Duration */}
      <div className="label">{en ? "Duration" : "Durée"}</div>
      <select className="input" value={months} onChange={e => setMonths(+e.target.value)} style={{ marginBottom: 16 }}>
        {DURATIONS.map(m => (
          <option key={m} value={m}>{m} {en ? (m === 1 ? "month" : "months") : "mois"} — {fmt(unitPrice * m)}</option>
        ))}
      </select>

      {/* Total — MP-SUBSCRIPTION-DISCOUNT: struck-through original + −X% badge + savings. */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{en ? "Total" : "Total"}</span>
          <span style={{ textAlign: "right" }}>
            {selDiscount && totalOriginal > total && (
              <span style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "line-through", marginRight: 8 }}>{fmt(totalOriginal)}</span>
            )}
            <span style={{ fontWeight: 800, fontSize: 18, color: selDiscount ? "#34d399" : "var(--brand-light)" }}>{fmt(total)}</span>
            {selDiscount && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", marginLeft: 8, padding: "2px 6px", borderRadius: 8, background: "rgba(52,211,153,0.15)" }}>
                {discBadge(selDiscount)}
              </span>
            )}
          </span>
        </div>
        {selDiscount && totalOriginal > total && (
          <div style={{ fontSize: 11, color: "#34d399", marginTop: 6, textAlign: "right" }}>
            {en ? `You save ${fmt(totalOriginal - total)}` : `Vous économisez ${fmt(totalOriginal - total)}`}
          </div>
        )}
      </div>

      {/* PRIMARY — Flutterwave */}
      <div style={{ background: "rgba(251,197,3,0.08)", border: "1px solid rgba(251,197,3,0.25)", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 12, color: "var(--brand-light)" }}>
        ⚡ {en
          ? `Selecting "Pay with Flutterwave" takes you to Flutterwave's secure page to pay ${fmt(total)} by your preferred method (card, mobile money, bank or USSD). Your ${selected?.name} plan activates automatically once payment is confirmed.`
          : `« Payer avec Flutterwave » vous amène à la page sécurisée de Flutterwave pour payer ${fmt(total)} par le moyen de votre choix (carte, mobile money, banque ou USSD). Votre forfait ${selected?.name} s'active automatiquement après confirmation.`}
      </div>
      <button className="btn btn-primary btn-block" style={{ height: 48, fontWeight: 700 }}
        disabled={!selected || flwMutation.isPending} onClick={() => flwMutation.mutate()}>
        {flwMutation.isPending
          ? (en ? "⏳ Redirecting…" : "⏳ Redirection…")
          : (en ? `⚡ Pay with Flutterwave — ${fmt(total)}` : `⚡ Payer avec Flutterwave — ${fmt(total)}`)}
      </button>

      {/* FALLBACK — manual / offline → admin approval */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button onClick={() => setShowManual(s => !s)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
          {en ? "Can't pay online? Request manual activation" : "Impossible de payer en ligne ? Demander une activation manuelle"}
        </button>
      </div>

      {showManual && (
        <div style={{ marginTop: 12, padding: 14, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {en
              ? "Pay offline, then submit — an admin confirms and activates your account."
              : "Payez hors ligne, puis soumettez — un admin confirme et active votre compte."}
          </div>
          <div className="label">{en ? "Payment method" : "Mode de paiement"}</div>
          <select className="input" value={method} onChange={e => setMethod(e.target.value)} style={{ marginBottom: 12 }}>
            {MANUAL_METHODS.map(m => <option key={m.value} value={m.value}>{en ? m.en : m.fr}</option>)}
          </select>
          <div className="label">{en ? "Notes (optional)" : "Notes (optionnel)"}</div>
          <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={en ? "Payment reference, etc." : "Référence de paiement, etc."} style={{ marginBottom: 12 }} />
          <button className="btn btn-secondary btn-block" disabled={!selected || manualMutation.isPending}
            onClick={() => manualMutation.mutate()}>
            {manualMutation.isPending ? (en ? "Submitting…" : "Envoi…") : (en ? "Submit manual request" : "Soumettre la demande manuelle")}
          </button>
        </div>
      )}
    </div>
  );
}
