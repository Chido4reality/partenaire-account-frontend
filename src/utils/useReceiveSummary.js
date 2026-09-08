// F-C — ONE definition of the receive-override summary query.
//
// Same reasoning as useStockCheckSummary.js, applied BEFORE the second consumer
// rather than after the third: react-query dedupes by queryKey, so two components
// sharing a key but declaring different queryFn shapes do not both run — whichever
// mounts first populates the cache and the other silently gets the wrong shape.
// That has bitten this codebase twice (["locations"], ["my-permissions"]), and this
// key ships with two consumers on day one.
//
// Response shape is the raw envelope body:
//   { success: true, data: { overrides, receipts, pct, amber, window_days } }
// so every consumer reads resp?.data?.<field>. Do not unwrap it here.
//
// WHY A RATE AND NOT A COUNT. The escape hatch has to be survivable but visible:
// an escape hatch nobody can see gets abused, which is exactly what `Done` was on
// stock checks before not_counted_30d put a number beside it. A bare count is
// ignorable and, worse, unreadable — four overrides is fine in a shop that
// received two hundred times and alarming in one that received five. The
// proportion is the honest figure.
import { useQuery } from "@tanstack/react-query";
import api from "./api";

export const RECEIVE_SUMMARY_KEY = ["transfer-receive-summary"];

// Amber at >= 20% OR >= 5 absolute, whichever comes first. The percentage alone
// would let a busy month hide a dozen overrides behind a big denominator; the
// absolute alone would flag a small shop that received three times and skipped
// one. The server computes `amber` — these are exported for the copy that
// explains the threshold, NOT to re-derive the decision on the client.
export const OVERRIDE_AMBER_PCT = 20;
export const OVERRIDE_AMBER_ABS = 5;

export function useReceiveSummary(opts = {}) {
  return useQuery({
    queryKey: RECEIVE_SUMMARY_KEY,
    queryFn: () => api.get("/transfers/receive-summary").then(r => r.data),
    retry: 1,
    ...opts,
  });
}
