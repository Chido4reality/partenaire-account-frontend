// EXPIRY-TRACKING (Peter, 2026-10-04): is expiry tracking in this org's plan?
// Same ["my-plan"] query shape AssetsPage / AccountantLogPage use, so the cache entry
// is shared, never clobbered by a different shape.
import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";
import { hasFeature } from "../utils/planCapabilities";

export default function useExpiryFeature() {
  const { data } = useQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const plan = data?.data?.effective_plan || "trial";
  return { canExpiry: hasFeature(plan, "track_expiry"), plan, userIdNumber: data?.data?.user_id_number };
}
