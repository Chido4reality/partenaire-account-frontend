// MP-MY-PERMISSIONS-ONE-SHAPE — the CURRENT user's own policy/grant map.
//
// Why this file exists: four call sites each ran their own useQuery on the SHARED
// react-query key ["my-permissions"], and they did NOT agree on the shape they wrote
// into the cache. POSPage stored the INNER object (`r.data?.data`); TransfersPage,
// SettingsPage and VoidReturnModal stored the ENVELOPE (`r.data`, i.e. {success,data})
// and read `?.data?.x` off it. One shared key + two shapes = whichever page fetched
// last decides, so the OTHER page silently reads undefined for every field — no error,
// no empty state, just a permission that reads as "not granted". That hid the Cancel
// button on TransfersPage for a manager who genuinely held can_cancel_transfers, and
// symmetrically could downgrade POSPage's sold-date gate.
//
// See [[feedback_shared_querykey_shape]] — the same class of bug as the ["locations"]
// key. The fix is a single hook so the key and the shape can never drift apart again.
//
// ALWAYS returns the INNER permissions object (or null while loading/disabled).
import { useQuery } from "@tanstack/react-query";
import api from "./api";

export const MY_PERMISSIONS_KEY = ["my-permissions"];

export function useMyPermissions({ enabled = true, staleTime = 60000, retry } = {}) {
  const q = useQuery({
    queryKey: MY_PERMISSIONS_KEY,
    // The ONE canonical unwrap. Every consumer gets the same object.
    queryFn: () => api.get("/staff/my-permissions").then((r) => r.data?.data || null),
    enabled,
    staleTime,
    ...(retry === undefined ? {} : { retry }),
  });
  return { perms: q.data || null, ...q };
}

export default useMyPermissions;
