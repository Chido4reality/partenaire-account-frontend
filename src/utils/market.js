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
