# Contributing — engineering discipline

## Cache invalidation rules

Every mutation (POST/PATCH/DELETE) MUST explicitly invalidate every
React Query `queryKey` whose result depends on the mutated data. A
mutation that changes server state but leaves stale UI (stale stock
counts, wrong "today's revenue", etc.) is an incomplete mutation.

### ⚠️ React Query matches keys by ARRAY PREFIX

This is the single most important gotcha and the cause of the bug class
this doc exists to prevent:

`queryClient.invalidateQueries({ queryKey: ['stock'] })` invalidates
`['stock', locId]` (prefix match) but **NOT** `['stock-all']` or
`['stock-alerts']` — those are *different first elements*, not prefixes.

This codebase uses hyphenated, distinct first keys
(`stock-all`, `stock-alerts`, `products-all`, `pos-products`,
`reports-daily`, `reports-today-sales`, …). So generic `['stock']`-style
invalidation **silently misses most of them**. Use one of:

1. The exact keys (see map below), or
2. A predicate that names every affected first-key family — the pattern
   used in `POSPage.jsx` saleMutation (commit `1bf100c`):

```js
onSuccess: () => {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey && q.queryKey[0];
      if (typeof k !== "string") return false;
      return k === "stock" || k === "stock-all" || k === "stock-alerts" ||
             k === "products-all" || k === "pos-products" ||
             k === "recent-sales" || k === "daily-summary" ||
             k.startsWith("reports-") /* …all affected families… */;
    }
  });
}
```

### Mandatory map — REAL keys in this codebase (extend as new appear)

| When you mutate… | Invalidate (exact first-keys) |
|---|---|
| `pa_sales` (new sale, void) | `recent-sales`, `daily-summary`, `stock`, `stock-all`, `stock-alerts`, `pos-products`, `products-all`, `reports-*`, `customer-debt`, `credits` |
| `pa_stock` (receive, adjust, transfer) | `stock`, `stock-all`, `stock-alerts`, `daily-summary`, `pos-products`, `products-all`, `transfers` (if transfer) |
| `pa_products` (create, edit, archive/restore) | `products-all`, `products-barcode`, `pos-products`, `stock`, `stock-all` |
| `pa_customers` (create, edit) | `customers`, `customer-detail`, `pos-customers` |
| payments / credit settle | `recent-sales`, `daily-summary`, `credits`, `customer-debt`, `reports-*` |
| `pa_cash_shifts` (open/close) | `my-shift`, `all-shifts`, `daily-summary` |
| `pa_organisations` (plan upgrade, settings) | `my-plan`, `org-settings` |

`reports-*` = every key starting `reports-` (`reports-daily`,
`reports-today-sales`, `reports-sales-detail`, `reports-top-products`,
`reports-ledger`, `reports-returns`, `reports-debts`). Invalidate the
whole family via `k.startsWith("reports-")` in a predicate — listing
them individually rots.

Keep this table in sync with `grep -rn "queryKey:" src` — if you add a
query that depends on sales/stock/products, add it here and to the
relevant mutation.

### Single source of truth

Any metric shown in more than one place (e.g. "today's revenue" on
Dashboard and Reports) MUST come from the same endpoint/query with the
same filter params. Never compute the same fact two ways — that's how
Dashboard showed 41,500 while Reports showed 81,500 (different location
filter). For ground truth, `GET /api/audit/today-reconcile` returns the
canonical org daily totals; new revenue views should reconcile to it.

### Cross-account state safety

`localStorage` (incl. zustand `persist`) survives logout→login on the
same device/wrapper. State keyed to user A can leak into user B.

When persisting user-scoped state:
- Validate stored IDs against the current user's accessible data on read
  — see `Layout.jsx` (`selectedLocation` is cleared if its id isn't in
  the current user's `/locations`), or
- Namespace the storage key with the user/org id.

Never trust a persisted id (location, org, customer) without checking it
belongs to the logged-in user.

### Before merging any PR

- [ ] Every mutation's `onSuccess` invalidates the affected keys per the
      map above (exact keys or a `predicate` — not a bare `['stock']`
      that RQ won't prefix-match).
- [ ] No metric is computed two different ways; shared metrics hit the
      same endpoint/params (reconcilable to `/api/audit/today-reconcile`).
- [ ] Any new `localStorage`/persisted write is user-scoped or validated
      on read.
- [ ] If you added a query that depends on sales/stock/products/cash,
      the mandatory map above was updated.
