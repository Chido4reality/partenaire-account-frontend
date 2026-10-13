// LAUNCH-BATCH-2b (b) — Stenamo Market is a Cameroon (XAF) marketplace: listings, orders
// and payments carry no currency and are read as FCFA. Shops in another currency
// (Nigeria, NGN) do not see the Market at all; the server refuses the same actions
// (backend lib/marketAvailability.js, code MARKET_NOT_AVAILABLE_IN_COUNTRY).
export const MARKET_ROUTES = new Set(["/dozie-listings", "/dozie-orders", "/dozie-messages", "/dozie-disputes", "/online-cart"]);
export function marketAvailable(org) {
  return String(org?.currency || "XAF").toUpperCase() === "XAF";
}
