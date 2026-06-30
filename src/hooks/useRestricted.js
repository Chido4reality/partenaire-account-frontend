// MP-TRIAL-EXPIRY-RESTRICTION (UI polish) — single source for "is this org
// read-only?" used to PRE-DISABLE create/write controls before the tap. Reads the
// SAME /subscriptions/my-plan.is_restricted the Layout banner + server gate use
// (computeEffectivePlan().is_restricted), so the UI lock can't diverge from the
// server 403 'subscription_restricted'. Cached under the shared ["my-plan"] key.
import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";

export function useRestricted() {
  const { lang } = useLangStore();
  const { data } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    staleTime: 60000,
  });
  const restricted = !!data?.data?.is_restricted;
  const hint = lang === "en"
    ? "Trial ended — upgrade to continue"
    : "Essai terminé — passez à la version supérieure";
  return { restricted, hint };
}
