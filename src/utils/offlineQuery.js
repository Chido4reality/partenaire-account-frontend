// MP-PHASE-4-OFFLINE-CACHED-QUERY
//
// A useQuery variant that actually serves the offline path. The codebase
// has a try/catch + cacheData/getCachedData pattern in a few places already,
// but under the global default `networkMode:'online'` (App.jsx, deliberately
// — see feedback_react_query_networkmode_custom_adapter) the queryFn does
// not run offline, so the catch→getCachedData fallback never fires. This
// helper sets `networkMode:'always'` AND owns the try/catch wrap, so the
// caller writes only the happy-path GET.
//
// Memory-rule check: that feedback says don't put `networkMode:'always'`
// on queries that can return error objects to consumers — error objects
// slip past `(x || []).filter(...)` guards and crash callers. Here, our
// queryFn ALWAYS returns an array-shape (`r` on success, `cached` on
// failure, or the `fallback` — defaults to `{ data: [] }`), never an
// error object. So this is the safe form of `networkMode:'always'` the
// rule's caveat allows ("...unless you've also built a matching
// read-through cache that handles offline GETs gracefully").
//
// Usage:
//   useOfflineCachedQuery({
//     queryKey: ["dashboard-summary", from, to],
//     queryFn: () => api.get(`/dashboard/summary?from=${from}&to=${to}`).then(r => r.data),
//     refetchInterval: 60000,
//   });
//
// On the first online load the cache populates; on subsequent offline
// loads (Phase-2 SW serves the shell, then this helper serves the data)
// the cached payload is returned instantly. cacheKey is derived from
// queryKey so distinct param sets get distinct cache slots.

import { useQuery } from "@tanstack/react-query";
import { cacheData, getCachedData } from "./offlineStore";

function deriveCacheKey(queryKey) {
  return "oq_" + queryKey.map(v => v == null ? "" : String(v)).join("|");
}

export function useOfflineCachedQuery({ queryKey, queryFn, fallback, ...opts }) {
  const cacheKey = deriveCacheKey(queryKey);
  const empty = fallback !== undefined ? fallback : { data: [] };
  return useQuery({
    queryKey,
    networkMode: "always",
    queryFn: async () => {
      try {
        const r = await queryFn();
        // Cache on the success path. cacheData is a thin localStorage wrapper
        // that swallows its own errors (e.g. QuotaExceededError) — see
        // offlineStore.js. Q5 followup: add a size-warning when usage
        // approaches the localStorage budget.
        cacheData(cacheKey, r);
        return r;
      } catch {
        const c = await getCachedData(cacheKey);
        return c ?? empty;
      }
    },
    ...opts,
  });
}
