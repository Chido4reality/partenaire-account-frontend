// MP-AUTH-STATE-HYGIENE — single place that wipes every client-side
// trace of a session. Used by logout AND the user-change tripwire so
// the two can never drift. queryClient is passed in (it's created in
// App.jsx) — clearing the React Query cache is the most-missed step.
import { useAuthStore, useLangStore, useOfflineStore, useSettingsStore } from "../store";

const PERSIST_STORES = [useAuthStore, useLangStore, useOfflineStore, useSettingsStore];

export function nukeClientState(queryClient) {
  // 1. React Query cache (cached profile/org/lists/etc.)
  try { queryClient && queryClient.clear(); } catch (_) {}
  // 2. zustand persist stores — clearStorage() drops the persisted copy
  //    AND the rehydrated value, before the blanket localStorage wipe.
  PERSIST_STORES.forEach((s) => {
    try { s.persist && s.persist.clearStorage && s.persist.clearStorage(); } catch (_) {}
  });
  // 3/4. Everything else this app stored.
  try { localStorage.clear(); } catch (_) {}
  try { sessionStorage.clear(); } catch (_) {}
  // (No idb-keyval / react-query-persist-client / IndexedDB persistence
  //  is configured in this app — verified; nothing more to clear.)
}

// Hard navigation (NOT reload) so React + React Query start from zero.
export function hardRedirectToLogin(flash) {
  const url = flash ? `/login?flash=${encodeURIComponent(flash)}` : "/login";
  window.location.replace(url);
}
