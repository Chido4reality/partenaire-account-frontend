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
// Keeps the legacy formatCFA() "—" guard (`!amount && amount !== 0`) and
// `Math.round(amount)`.
//
// SEPARATOR FIX: Intl "fr-CM" groups with U+202F (NARROW no-break space), which
// renders at near-zero width in several Android WebViews / fonts — so
// "1 000 000" visually collapsed to "1000000" and big amounts on the dashboard
// scorebar were indistinguishable from smaller ones (1000000 vs 100000 looked
// the same length). Normalise that separator to U+00A0 (regular no-break
// space): visibly wide in every webview AND non-breaking, so a number never
// wraps mid-figure. One shared formatter -> every money figure (scorebar
// included) groups identically; no second formatting style is introduced.
export function formatMoney(amount, code) {
  if (!amount && amount !== 0) return "—";
  const grouped = new Intl.NumberFormat("fr-CM")
    .format(Math.round(amount))
    .replace(/ /g, " "); // narrow NBSP -> regular NBSP (visible everywhere)
  return grouped + " " + currencySymbol(code);
}
