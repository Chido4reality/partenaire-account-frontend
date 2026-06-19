// MP-CURRENCY-DISPLAY (Nigeria Phase 1) — per-org currency formatter hook.
//
// Returns `fmt`, a function that formats an amount in the LOGGED-IN ORG's
// currency: fmt(1234567) -> "1 234 567 FCFA" for an XAF org, "1 234 567 ₦" for
// an NGN org. The currency comes from authStore.org.currency, defaulting to
// 'XAF' so existing Cameroon orgs render EXACTLY "FCFA" as before (formatMoney
// is byte-identical to the old formatCFA when the symbol is "FCFA").
//
// `fmt.symbol` / `fmt.currency` are exposed for inline labels (e.g. a bare
// "FCFA" suffix in a template string -> `${fmt.symbol}`).
//
// Non-component / util code that can't call a hook should read the currency
// non-reactively via `useAuthStore.getState().org?.currency` and call
// formatMoney(amount, currency) / currencySymbol(currency) from ./currency.
import { useAuthStore } from "../store";
import { formatMoney, currencySymbol } from "./currency";

export function useCurrency() {
  const currency = useAuthStore(s => s.org?.currency) || "XAF";
  const fmt = (n) => formatMoney(n, currency);
  fmt.symbol = currencySymbol(currency);
  fmt.currency = currency;
  return fmt;
}
