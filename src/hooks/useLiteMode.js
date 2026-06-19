// MP-LITE-MODE-PHASE-1: single source of truth for "is this org in
// Lite Mode?" Reads from the cached authStore.org.lite_mode that
// /auth/me populates on login (and that the Settings toggle updates
// in place when the owner flips the switch).
//
// Resolution order (MP-LITE-MODE-DEFAULT-BY-PLAN):
//   1. An EXPLICIT org.lite_mode (true/false) from the Simple/Full toggle
//      ALWAYS wins — the owner's choice is sticky.
//   2. When lite_mode is UNSET (undefined/null — fresh login, stale session,
//      or backend not returning it), default BY PLAN:
//        • paid, non-trial (plan_id ∈ {pro, pro_plus} AND subscription_status
//          !== 'trial') → Full view (lite = false) so paying owners see their
//          paid surfaces without first hunting for the toggle.
//        • free / lite / trial (everything else) → Simple view (lite = true).
//
// "Paid" = a paid TIER (pro/pro_plus per planCapabilities) that is NOT
// currently trialing (subscription_status distinguishes 'trial' from a real
// paid 'active'/paid state). A pro_plus org mid 7-day trial (status 'trial')
// correctly stays Simple under this rule.
//
// Consumers gate queries (`enabled: !useLiteMode()`) and conditionally
// render UI surfaces. See Layout, Dashboard, InventoryPage, POSPage,
// TransfersPage, ReportsPage, SettingsPage call sites.

import { useAuthStore } from "../store";

const PAID_TIERS = ["pro", "pro_plus"];

export function useLiteMode() {
  return useAuthStore(s => {
    const lm = s.org?.lite_mode;
    if (lm === true || lm === false) return lm;            // explicit toggle wins
    // Unset → default by plan: paid+non-trial → Full (false); else Simple (true).
    const isPaidNonTrial =
      PAID_TIERS.includes(s.org?.plan_id) && s.org?.subscription_status !== "trial";
    return !isPaidNonTrial;
  });
}
