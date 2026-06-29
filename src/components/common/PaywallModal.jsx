// Sprint A — universal paywall modal.
//
// Opens whenever any gated action is attempted (sidebar click on a
// locked section, "Add product" past the cap, CSV export click,
// receipt-branding edit, Dozie launch). Feature-aware: the body copy
// changes per feature, with a special prominent treatment for
// dozie_access per Peter's spec.
//
// Primary action: "Continue to upgrade" opens the existing
// UpgradeModal (full CamPay flow). WhatsApp link is a secondary
// fallback for when CamPay times out / network is bad.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore } from "../../store";
import { useCurrency } from "../../utils/useCurrency";
import api from "../../utils/api";
import UpgradeModal from "./UpgradeModal";
import { getCapabilities, hasSection, hasFeature } from "../../utils/planCapabilities";
import { openWhatsApp } from "../../utils/whatsapp";

// MP-PAYWALL-LOCALIZED-PRICING (29 Jun): the tier list + prices shown here now
// come from the SAME localized GET /subscriptions/plans response the checkout /
// RequestActivationPage uses — so a Nigeria org sees NGN and a Cameroon org sees
// XAF, each with the right symbol via useCurrency(). We no longer read
// pa_plans.price_monthly / planCapabilities.price_fcfa_month for display (those
// are XAF base only — rendering them under a ₦ sign was the NG pricing bug).

// Rank used to (a) label the org's CURRENT plan and (b) only offer tiers ABOVE
// it. trial/silver are the free floor (rank 0). Matches pa_plans ordering.
const PLAN_RANK = { trial: 0, silver: 0, lite: 1, gold: 1, pro: 2, premium: 2, pro_plus: 3 };
// Lowest→highest paid tier, used to resolve the minimum plan a gated feature
// needs by walking capabilities (no hardcoded feature→tier table to drift).
const PAID_TIER_ORDER = ["lite", "pro", "pro_plus"];

// Minimum paid tier whose capabilities satisfy this gate. Sections (dashboard,
// customers, …) and feature flags (csv_exports, dozie_access, ai_assistant, …)
// are resolved from planCapabilities; caps / trial_countdown / unknown keys fall
// back to the lowest paid tier.
function minimumTierFor(feature) {
  for (const tier of PAID_TIER_ORDER) {
    if (hasSection(tier, feature) || hasFeature(tier, feature)) return tier;
  }
  return "lite";
}

const SUPPORT_PHONE = "237621840952";

// Human-readable label per feature key, both languages. Falls back to
// a Title-Cased slug when a feature isn't listed (defensive).
const FEATURE_COPY = {
  dozie_access: {
    en: { title: "Upgrade to access Partenaire Dozie", body: "Partenaire Dozie — the wholesale marketplace — is included on Trial, Gold, and Premium plans." },
    fr: { title: "Mise à niveau requise pour Partenaire Dozie", body: "Partenaire Dozie — la place de marché — est incluse dans les plans Essai, Gold et Premium." }
  },
  inventory_cap: {
    en: { title: "Inventory cap reached", body: "Silver is capped at 10 products. Upgrade to add more." },
    fr: { title: "Limite d'inventaire atteinte", body: "Silver est limité à 10 produits. Mise à niveau requise pour en ajouter." }
  },
  staff_cap: {
    en: { title: "Staff cap reached", body: "Your current plan limits the number of staff accounts you can invite. Upgrade to add more." },
    fr: { title: "Limite d'utilisateurs atteinte", body: "Votre plan limite le nombre d'utilisateurs. Mise à niveau requise." }
  },
  location_cap: {
    en: { title: "Location cap reached", body: "Your current plan limits the number of locations. Upgrade to add more." },
    fr: { title: "Limite d'emplacements atteinte", body: "Votre plan limite le nombre d'emplacements." }
  },
  csv_exports: {
    en: { title: "CSV exports require Premium", body: "Bulk CSV downloads of sales, inventory, customers, and staff are a Premium feature." },
    fr: { title: "Les exports CSV nécessitent Premium", body: "Les téléchargements CSV en masse sont une fonctionnalité Premium." }
  },
  receipt_branding: {
    en: { title: "Receipt branding requires Premium", body: "Custom logo and receipt footer text are Premium features." },
    fr: { title: "La personnalisation du reçu nécessite Premium", body: "Logo personnalisé et pied de page sont des fonctionnalités Premium." }
  },
  dashboard:  { en: { title: "Dashboard requires a higher plan",  body: "Upgrade to access the dashboard."  }, fr: { title: "Le tableau de bord nécessite un plan supérieur",  body: "Mise à niveau requise pour le tableau de bord." } },
  customers:  { en: { title: "Customers requires a higher plan",  body: "Upgrade to access customers."     }, fr: { title: "Clients nécessite un plan supérieur",            body: "Mise à niveau requise pour accéder aux clients." } },
  credits:    { en: { title: "Credits requires a higher plan",    body: "Upgrade to access credits."       }, fr: { title: "Crédits nécessite un plan supérieur",            body: "Mise à niveau requise pour accéder aux crédits." } },
  cashflow:   { en: { title: "Cash flow requires a higher plan",  body: "Upgrade to access cash flow."     }, fr: { title: "Trésorerie nécessite un plan supérieur",         body: "Mise à niveau requise pour la trésorerie." } },
  reports:    { en: { title: "Reports require a higher plan",     body: "Upgrade to access reports."       }, fr: { title: "Les rapports nécessitent un plan supérieur",     body: "Mise à niveau requise pour les rapports." } },
  trial_countdown: {
    en: { title: "Your free trial is ending", body: "Pick a plan to keep full access after your trial ends." },
    fr: { title: "Votre essai gratuit se termine", body: "Choisissez un plan pour garder l'accès complet après votre essai." }
  }
};

function copyFor(feature, lang) {
  const slot = FEATURE_COPY[feature];
  if (slot && slot[lang]) return slot[lang];
  // Fallback — title-cased feature slug with generic copy.
  const titled = String(feature || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
  return lang === "fr"
    ? { title: `${titled} nécessite un plan supérieur`, body: "Mise à niveau requise." }
    : { title: `${titled} requires a higher plan`, body: "Upgrade required." };
}

export default function PaywallModal({ feature, currentPlan, mpId, onClose }) {
  const { lang } = useLangStore();
  const fmt = useCurrency();
  const [selectedTier, setSelectedTier] = useState(null);
  const [openUpgrade, setOpenUpgrade] = useState(false);

  // Localized, country-correct tier list + prices — SAME source as the checkout
  // (UpgradeModal) and RequestActivationPage. Backend attaches .price/.currency
  // per the org's country (NGN for NG, XAF for CM). Cached under the shared
  // ["plans"]/["my-plan"] keys so reopening the gate is free.
  const { data: plansData, isLoading: plansLoading, error: plansError } = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get("/subscriptions/plans").then(r => r.data),
    retry: 2
  });
  const { data: myPlanData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
  });
  const myPlan = myPlanData?.data;

  const copy = copyFor(feature, lang);
  const isDozie = feature === "dozie_access";

  // CURRENT plan = the org's REAL plan_id (NOT the effective/entitlement plan —
  // a trial org runs on the 'pro' entitlement during its window, which used to
  // mislabel the header "Current plan: Pro"). Label prefers the localized name
  // from /my-plan, falling back to planCapabilities.
  const realPlanId = myPlan?.plan_id || currentPlan || "trial";
  const currentRank = PLAN_RANK[realPlanId] ?? 0;
  const currentCaps = getCapabilities(realPlanId);
  const currentPlanLabel = myPlan?.plan?.name
    || (lang === "fr" ? currentCaps.label_fr : currentCaps.label)
    || realPlanId;

  // Purchasable paid tiers (Lite / Pro / Pro Plus) from the API, minus the free
  // floor — Pro Plus appears automatically once is_active. Only offer tiers
  // ABOVE the org's current plan.
  const allPaid = (plansData?.data || [])
    .filter(p => p.id !== "silver" && p.id !== "trial" && (p.price ?? p.price_monthly) > 0);
  const tiers = allPaid
    .filter(p => (PLAN_RANK[p.id] ?? 0) > currentRank)
    .sort((a, b) => (PLAN_RANK[a.id] ?? 0) - (PLAN_RANK[b.id] ?? 0));

  // Default-select the minimum tier this gate actually needs (so the primary
  // button points at the correct target), clamped to an offered tier.
  const requiredTier = minimumTierFor(feature);
  const effectiveSelected =
    selectedTier && tiers.some(t => t.id === selectedTier)
      ? selectedTier
      : (tiers.find(t => t.id === requiredTier)?.id || tiers[0]?.id || null);
  const selectedPlan = tiers.find(t => t.id === effectiveSelected) || null;
  const selectedLabel = selectedPlan?.name
    || getCapabilities(effectiveSelected).label
    || effectiveSelected;

  // Mount UpgradeModal in place of this paywall when the user confirms.
  if (openUpgrade) {
    return (
      <UpgradeModal
        onClose={onClose}
        currentPlan={{ id: realPlanId, name: currentPlanLabel }}
      />
    );
  }

  const whatsappMsg = () => {
    const planName = selectedLabel;
    return lang === "fr"
      ? `Bonjour Partenaire Support, je voudrais mettre à niveau mon compte ${mpId || ""} vers le plan ${planName}.`
      : `Hello Partenaire Support, I would like to upgrade my account ${mpId || ""} to the ${planName} plan.`;
  };
  const whatsappUrl = () => `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(whatsappMsg())}`;

  // Feature chips per plan — tolerate array or JSON-string shape from the API.
  const planFeatures = (p) =>
    Array.isArray(p.features)
      ? p.features
      : (() => { try { return JSON.parse(p.features || "[]"); } catch { return []; } })();

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        borderRadius: 20, padding: 24, maxWidth: 480, width: "100%",
        maxHeight: "92vh", overflowY: "auto"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {lang === "fr" ? "Mise à niveau requise" : "Upgrade required"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
              {isDozie ? "🛒 " : ""}{copy.title}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, padding: 0 }}
            aria-label={lang === "fr" ? "Fermer" : "Close"}
          >✕</button>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
          {copy.body}
        </div>

        <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>
            {lang === "fr" ? "Plan actuel" : "Current plan"}
          </span>
          <strong>{currentPlanLabel}</strong>
        </div>

        {/* MP-PAYWALL-LOCALIZED-PRICING (29 Jun): tier list + prices are now
            data-driven from /subscriptions/plans (country-correct NGN/XAF),
            include Pro Plus, and only offer tiers ABOVE the org's real plan.
            Price is rendered with fmt() so the symbol matches the org currency
            (₦ for NG, FCFA for CM) — never pa_plans XAF base under a ₦ sign. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {plansLoading && (
            <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "fr" ? "Chargement des plans…" : "Loading plans…"}
            </div>
          )}
          {plansError && (
            <div style={{ textAlign: "center", padding: 16, color: "#f87171", fontSize: 13 }}>
              {lang === "fr" ? "Échec du chargement des plans." : "Failed to load plans."}
            </div>
          )}
          {!plansLoading && !plansError && tiers.map(plan => {
            const selected = effectiveSelected === plan.id;
            const isRequired = plan.id === requiredTier;
            return (
              <div key={plan.id} onClick={() => setSelectedTier(plan.id)}
                style={{
                  padding: "14px 16px", borderRadius: 12,
                  border: `2px solid ${selected ? "var(--brand)" : "var(--border)"}`,
                  background: selected ? "rgba(251,197,3,0.08)" : "var(--bg-card)",
                  cursor: "pointer", transition: "border-color 0.15s"
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                      {plan.badge_icon ? `${plan.badge_icon} ` : ""}{plan.name}
                      {isRequired && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--brand-light)", background: "rgba(251,197,3,0.12)", borderRadius: 8, padding: "1px 7px" }}>
                          {lang === "fr" ? "Recommandé" : "Recommended"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                      {plan.max_locations === -1 ? "∞" : plan.max_locations} {lang === "fr" ? "emplacement(s)" : "location(s)"} ·{" "}
                      {plan.max_products === -1 ? "∞" : plan.max_products} {lang === "fr" ? "produits" : "products"} ·{" "}
                      {plan.max_users === -1 ? "∞" : plan.max_users} {lang === "fr" ? "utilisateur(s)" : "user(s)"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {planFeatures(plan).map((f, i) => (
                        <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(251,197,3,0.1)", color: "var(--brand-light)" }}>✓ {f}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--brand-light)" }}>
                      {fmt(plan.price ?? plan.price_monthly)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {lang === "fr" ? "/ mois" : "/ month"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!plansLoading && !plansError && tiers.length === 0 && (
            <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "fr" ? "Vous êtes déjà sur le plan le plus élevé." : "You're already on the highest plan."}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 600
            }}>
            {lang === "fr" ? "Annuler" : "Cancel"}
          </button>
          <button onClick={() => setOpenUpgrade(true)} disabled={!selectedPlan}
            style={{
              flex: 2, padding: "10px 14px", borderRadius: 10,
              background: "var(--brand)", border: "1px solid var(--brand)",
              color: "#152B52", cursor: selectedPlan ? "pointer" : "not-allowed",
              opacity: selectedPlan ? 1 : 0.5, fontSize: 13, fontWeight: 700
            }}>
            {lang === "fr"
              ? `Mettre à niveau vers ${selectedLabel}`
              : `Upgrade to ${selectedLabel}`}
          </button>
        </div>

        <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
          {lang === "fr" ? "ou " : "or "}
          <a href={whatsappUrl()} target="_blank" rel="noopener"
            onClick={(e) => openWhatsApp(e, SUPPORT_PHONE, whatsappMsg())}
            style={{ color: "var(--brand-light)" }}>
            {lang === "fr" ? "contacter le support WhatsApp" : "contact WhatsApp support"}
          </a>
        </div>
      </div>
    </div>
  );
}
