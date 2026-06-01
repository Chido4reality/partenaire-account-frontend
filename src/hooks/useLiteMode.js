// MP-LITE-MODE-PHASE-1: single source of truth for "is this org in
// Lite Mode?" Reads from the cached authStore.org.lite_mode that
// /auth/me populates on login (and that the Settings toggle updates
// in place when the owner flips the switch).
//
// Default: Lite (return true) when the field is undefined. Two cases
// land here:
//   - Pre-migration / pre-deploy: backend hasn't yet returned the
//     column. Frontend should behave as Lite to be safe; Lite hides
//     surfaces but doesn't break anything Pro users need.
//   - Stale session where authStore was populated by an old /auth/me
//     before the column existed. Same fallback.
//
// Only explicit `lite_mode === false` returns Pro. This keeps the
// semantics clean: Lite is the default, Pro is the opt-in.
//
// Consumers gate queries (`enabled: !useLiteMode()`) and conditionally
// render UI surfaces. See Layout, Dashboard, InventoryPage, POSPage,
// TransfersPage, ReportsPage, SettingsPage call sites.

import { useAuthStore } from "../store";

export function useLiteMode() {
  return useAuthStore(s => s.org?.lite_mode !== false);
}
