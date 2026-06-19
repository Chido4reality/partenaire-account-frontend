// MP-MODE-TRIAL-REWORK: SINGLE source of trial / entitlement truth.
//
// Reads the backend-authoritative /subscriptions/my-plan (computeEffectivePlan)
// via the SAME ["my-plan"] react-query cache that Layout uses, so the sidebar
// countdown + nav gating + TrialBanner + the Settings Mode tab can never
// desync. (Previously this derived from the client-cached authStore.org, which
// could go stale and disagree with /my-plan — the reported bug.)
//
// Shape:
//   {
//     plan_id, effective_plan,
//     is_paid,                 // on a paid plan (not the free floor, not trial)
//     trial_active,            // signup trial currently running
//     trial_ends_at,
//     trial_days_remaining,    // whole days (backend floor) — decrements daily
//     show_trial_countdown,
//     can_use_full_view,       // authoritative entitlement (lockstep w/ lite-mode 402 gate)
//     // back-compat aliases:
//     can_flip_to_pro, is_paid_pro,
//   }

import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";

export function useTrialState() {
  const { data } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    refetchInterval: 300000,
    retry: 1,
    onError: () => {},
  });
  const mp = (data && data.data) || {};

  const plan_id = mp.plan_id || "trial";
  const effective_plan = mp.effective_plan || null;
  const trial_active = !!mp.trial_active;
  const trial_days_remaining = mp.days_remaining_in_trial != null ? mp.days_remaining_in_trial : null;
  // Authoritative entitlement from the backend (exact lockstep with the
  // /auth/lite-mode 402 gate). Defensive fallback if the field isn't present yet.
  const can_use_full_view = mp.can_use_full_view != null
    ? !!mp.can_use_full_view
    : (effective_plan ? effective_plan !== "trial" : true);
  const is_paid = !!effective_plan && effective_plan !== "trial" && !trial_active;

  return {
    plan_id,
    effective_plan,
    is_paid,
    trial_active,
    trial_ends_at: mp.trial_ends_at || null,
    trial_days_remaining,
    show_trial_countdown: trial_active,
    can_use_full_view,
    // Deprecated aliases kept so any straggler consumer doesn't crash.
    can_flip_to_pro: can_use_full_view,
    is_paid_pro: is_paid,
  };
}
