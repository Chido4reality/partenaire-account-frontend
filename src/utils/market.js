// LAUNCH-BATCH-2b (b) — Stenamo Market is a Cameroon (XAF) marketplace: listings, orders
// and payments carry no currency and are read as FCFA. Shops in another currency
// (Nigeria, NGN) do not see the Market at all; the server refuses the same actions
// (backend lib/marketAvailability.js, code MARKET_NOT_AVAILABLE_IN_COUNTRY).
export const MARKET_ROUTES = new Set(["/dozie-listings", "/dozie-orders", "/dozie-messages", "/dozie-disputes", "/online-cart"]);
export function marketAvailable(org) {
  return String(org?.currency || "XAF").toUpperCase() === "XAF";
}

// LAUNCH-BATCH-2b: plan feature chips — "Stenamo Market", never the old "Partenaire Dozie"
// name, and not offered at all to a shop the Market is closed to. The server does the
// same (routes/subscriptions.js planFeaturesFor); this covers a server that hasn't yet.
export function planFeatureList(features, org) {
  let list = features;
  if (!Array.isArray(list)) { try { list = JSON.parse(features || "[]"); } catch { list = []; } }
  const open = marketAvailable(org);
  return list
    .map((f) => String(f).replace(/Partenaire Dozie marketplace/gi, "Stenamo Market").replace(/Partenaire Dozie/gi, "Stenamo Market"))
    .filter((f) => open || !/Stenamo Market|marketplace/i.test(f));
}

// LAUNCH-BATCH-2b: the stored chips are English; a French-speaking shop reads them in French.
// An unknown chip stays as stored (never blank).
export const PLAN_FEATURE_FR = {
  "Sales": "Ventes", "Inventory": "Inventaire", "Customers": "Clients", "Credits": "Crédits",
  "Reports": "Rapports", "Transfers": "Transferts", "Expenses": "Dépenses", "Cash register": "Caisse",
  "Everything in Lite": "Tout ce qu'offre Lite", "Everything in Pro": "Tout ce qu'offre Pro",
  "Unlimited locations / products / users": "Emplacements, produits et utilisateurs illimités",
  "Stenamo Market": "Stenamo Market", "Priority support": "Support prioritaire",
  "AI Business Assistant": "Assistant IA", "Staff & attendance management": "Gestion du personnel et des présences",
  "Asset & cash ledger": "Registre des biens et de la caisse", "Cashier location binding": "Caissier lié à son emplacement",
  "30-day free trial": "Essai gratuit de 30 jours", "Every Pro feature": "Toutes les fonctions Pro",
};
export function planFeatureLabel(f, lang) {
  return lang === "fr" ? (PLAN_FEATURE_FR[f] || f) : f;
}
