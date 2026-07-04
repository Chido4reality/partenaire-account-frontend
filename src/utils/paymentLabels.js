// MP-PAYMENT-METHOD-LABEL (display-only, keyed on ORG CURRENCY)
//
// The electronic (non-cash) payment bucket is STORED everywhere as
// payment_method='mobile_money' — anomalies, shift-close, drawer, scoreboard and
// every reconciliation query keep filtering on that literal value UNCHANGED.
// This module ONLY resolves the WORD shown to the user, by country:
//   • XAF (Cameroun) → "Mobile Money" / "MoMo"          (MoMo market)
//   • NGN (Nigeria)  → "Bank Transfer" / "Transfer"     (bank-transfer market)
//
// Same gate style as the receipt advert / receipt_code_style (currency-keyed).
// The choice is by CURRENCY, independent of UI language — NG is an English
// market, so the FR variant ("Virement") is provided only for completeness and
// is rarely shown. Never write or query these strings; they are labels only.
import { useAuthStore } from "../store";

function currencyOf(orgOrCurrency) {
  if (orgOrCurrency && typeof orgOrCurrency === "object") return orgOrCurrency.currency;
  return orgOrCurrency;
}
function isNgn(orgOrCurrency) {
  return String(currencyOf(orgOrCurrency) || "").trim().toUpperCase() === "NGN";
}

// Full label — POS button, receipt "Method" line, selectors.
export function momoLabel(orgOrCurrency, en = true) {
  if (isNgn(orgOrCurrency)) return en ? "Bank Transfer" : "Virement";
  return "Mobile Money";
}

// Short label — column headers, compact rows ("Debt (MoMo)" → "Debt (Transfer)").
export function momoLabelShort(orgOrCurrency, en = true) {
  if (isNgn(orgOrCurrency)) return en ? "Transfer" : "Virement";
  return "MoMo";
}

// Non-reactive currency for util/render code that can't call a hook.
export function currentOrgCurrency() {
  return useAuthStore.getState().org?.currency || "XAF";
}
