// MP-CURRENCY-GROUNDWORK (build 10) — render amounts using the org's `currency`
// field instead of a hard-coded "FCFA"/"XAF" literal, so a future Nigeria (NGN)
// rollout is a config change rather than a rewrite.
//
// Stored ISO code -> display symbol. XAF/XOF -> "FCFA" (Central/West African
// CFA franc — what shops actually print). Missing/unknown -> "FCFA" so existing
// XAF shops are byte-for-byte unchanged.
//
// SCOPE: currency only. There is NO per-user city field or city picker in the
// app yet (every user is hardcoded to Douala); do not infer anything about city
// from here. City selection is a separate future feature.
export const CURRENCY_SYMBOLS = {
  XAF: "FCFA",
  XOF: "FCFA",
  NGN: "₦",
};

export function currencySymbol(code) {
  const c = String(code || "").toUpperCase();
  return CURRENCY_SYMBOLS[c] || (c || "FCFA");
}

// Grouped number (fr-CM: space thousands), no decimals, + currency symbol.
// Matches formatCFA() exactly when the currency is XAF/unset (FCFA shops keep
// identical output).
export function formatMoney(amount, code) {
  if (amount == null || amount === "") return "—";
  const n = new Intl.NumberFormat("fr-CM").format(Math.round(Number(amount) || 0));
  return `${n} ${currencySymbol(code)}`;
}
