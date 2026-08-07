// MP-COUNT-INTEGRITY (F2) — ONE definition of the stock-check summary query.
//
// WHY THIS FILE EXISTS. react-query dedupes by queryKey, so two components sharing
// a key but declaring different queryFn shapes do NOT both run: whichever mounts
// first populates the cache and the other silently receives the other one's shape.
// This has now bitten us twice — ["locations"] (~16 components, silently empty
// lists) and ["my-permissions"] (a GRANTED permission read as DENIED). The fix that
// stuck for my-permissions was a shared hook, so this key gets one before it has a
// third consumer rather than after.
//
// Consumers as of F2: Layout.jsx (sidebar badge), StockCheckPage.jsx (Resolved-tab
// not-counted chip), AccountantLogPage.jsx (oversight line).
//
// Response shape is the raw envelope body:
//   { success: true, data: { pending, mismatch, damaged, stale, not_counted_30d } }
// so every consumer reads resp?.data?.<field>. Do not "helpfully" unwrap it here —
// Layout.jsx already reads it that way and changing the shape would break it in the
// exact silent manner described above.
import { useQuery } from "@tanstack/react-query";
import api from "./api";

export const STOCK_CHECK_SUMMARY_KEY = ["stock-check-summary"];

// F2.4: the owner is warned once the 30-day not-counted tally reaches this.
// Five dismissals in a month is no longer a one-off; it is a habit forming, and the
// whole reason not_counted is allowed to exist is that it is visible when it does.
export const NOT_COUNTED_AMBER_AT = 5;

export function useStockCheckSummary(opts = {}) {
  return useQuery({
    queryKey: STOCK_CHECK_SUMMARY_KEY,
    queryFn: () => api.get("/stock-checks/summary").then(r => r.data),
    retry: 1,
    ...opts,
  });
}
