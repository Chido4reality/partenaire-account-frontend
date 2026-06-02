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
import { useLangStore } from "../../store";
import UpgradeModal from "./UpgradeModal";
import { PLAN_CAPABILITIES, getCapabilities } from "../../utils/planCapabilities";
import { openWhatsApp } from "../../utils/whatsapp";

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
  reports:    { en: { title: "Reports require a higher plan",     body: "Upgrade to access reports."       }, fr: { title: "Les rapports nécessitent un plan supérieur",     body: "Mise à niveau requise pour les rapports." } }
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

// MP-BILLING-V2 (2 Jun): rekeyed alongside planCapabilities. Primary
// keys are lite/pro now; gold/premium retained as alias_of fallbacks
// so any pre-deploy cached bundle reading the old keys finds copy
// without going through getCapabilities() name-resolution.
const PLAN_PERKS = {
  lite: {
    en: ["Dashboard, Customers, Credits, Reports, Dozie", "Up to 2 staff, 2 locations"],
    fr: ["Tableau de bord, Clients, Crédits, Rapports, Dozie", "Jusqu'à 2 utilisateurs, 2 emplacements"]
  },
  pro: {
    en: ["Everything Lite has", "Unlimited inventory, staff, locations", "CSV exports + custom receipt branding"],
    fr: ["Tout ce qu'inclut Lite", "Inventaire, utilisateurs, emplacements illimités", "Exports CSV + reçus personnalisés"]
  },
  // Legacy alias fallbacks — keep the same content but under old keys.
  gold: {
    en: ["Dashboard, Customers, Credits, Reports, Dozie", "Up to 2 staff, 2 locations"],
    fr: ["Tableau de bord, Clients, Crédits, Rapports, Dozie", "Jusqu'à 2 utilisateurs, 2 emplacements"]
  },
  premium: {
    en: ["Everything Lite has", "Unlimited inventory, staff, locations", "CSV exports + custom receipt branding"],
    fr: ["Tout ce qu'inclut Lite", "Inventaire, utilisateurs, emplacements illimités", "Exports CSV + reçus personnalisés"]
  }
};

export default function PaywallModal({ feature, currentPlan, mpId, onClose }) {
  const { lang } = useLangStore();
  // MP-BILLING-V2 (2 Jun): default-selected tier rekeyed gold → lite.
  // Under the rekey, PLAN_CAPABILITIES.gold is { legacy: true,
  // alias_of: 'lite' } — selecting it as the initial state and then
  // doing a direct PLAN_CAPABILITIES[tier] lookup (line ~150 below)
  // returns the alias shape, which has no price_fcfa_month, which
  // crashed PaywallModal at render time when any 403 upgrade_required
  // event fired (test_account trial-login repro, 2 Jun).
  const [selectedTier, setSelectedTier] = useState("lite");
  const [openUpgrade, setOpenUpgrade] = useState(false);

  const copy = copyFor(feature, lang);
  const currentCaps = getCapabilities(currentPlan);
  const isDozie = feature === "dozie_access";

  // Mount UpgradeModal in place of this paywall when the user confirms.
  if (openUpgrade) {
    return (
      <UpgradeModal
        onClose={onClose}
        currentPlan={{ id: currentPlan, name: currentCaps.label }}
      />
    );
  }

  const whatsappMsg = () => {
    // MP-BILLING-V2: getCapabilities resolves legacy aliases so a
    // stale selectedTier value still surfaces the canonical label.
    const planName = getCapabilities(selectedTier).label || selectedTier;
    return lang === "fr"
      ? `Bonjour Partenaire Support, je voudrais mettre à niveau mon compte ${mpId || ""} vers le plan ${planName}.`
      : `Hello Partenaire Support, I would like to upgrade my account ${mpId || ""} to the ${planName} plan.`;
  };
  const whatsappUrl = () => `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(whatsappMsg())}`;

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
          <strong>{currentCaps.label}</strong>
        </div>

        {/* MP-BILLING-V2 (2 Jun): tier choice rekeyed gold/premium → lite/pro.
            Trial is the floor — never offered. Using getCapabilities()
            instead of a direct PLAN_CAPABILITIES[tier] lookup so any
            future alias indirection stays handled. PLAN_PERKS is also
            indexed by tier — fall back to the alias's canonical key
            via getCapabilities's .alias_of resolution so a stale code
            path with old keys still finds copy. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {["lite", "pro"].map(tier => {
            const caps = getCapabilities(tier);
            const perks = (PLAN_PERKS[tier] || PLAN_PERKS[caps.label?.toLowerCase() || tier] || { en: [], fr: [] })[lang === "fr" ? "fr" : "en"];
            const selected = selectedTier === tier;
            return (
              <div key={tier} onClick={() => setSelectedTier(tier)}
                style={{
                  padding: "14px 16px", borderRadius: 12,
                  border: `2px solid ${selected ? "var(--brand)" : "var(--border)"}`,
                  background: selected ? "rgba(79,70,229,0.08)" : "var(--bg-card)",
                  cursor: "pointer", transition: "border-color 0.15s"
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{caps.label}</div>
                    <ul style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                      {perks.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--brand-light)" }}>
                      {/* MP-BILLING-V2: defensive guard. A getCapabilities()
                          resolution always returns a primary tier shape with
                          price_fcfa_month present — but if a future code path
                          loses the alias_of resolution and lands on a legacy
                          alias, this Number coercion + nullish fallback
                          keeps the modal renderable instead of crashing the
                          whole app shell. */}
                      {Number(caps?.price_fcfa_month ?? 0).toLocaleString("fr-CM")} FCFA
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {lang === "fr" ? "/ mois" : "/ month"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
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
          <button onClick={() => setOpenUpgrade(true)}
            style={{
              flex: 2, padding: "10px 14px", borderRadius: 10,
              background: "var(--brand)", border: "1px solid var(--brand)",
              color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700
            }}>
            {lang === "fr"
              ? `Mettre à niveau vers ${getCapabilities(selectedTier).label || selectedTier}`
              : `Upgrade to ${getCapabilities(selectedTier).label || selectedTier}`}
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
