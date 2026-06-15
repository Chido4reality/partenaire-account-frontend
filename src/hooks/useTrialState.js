// MP-MODE-TRIAL-REWORK: unified trial readouts for the frontend.
//
// There is ONE trial now — the signup trial (pa_organisations.trial_ends_at,
// subscription_status='trial'), which the backend resolves to full feature
// access for 7 days. The old separate "Pro Mode" trial (pro_trial_*) is retired.
// App Mode (Simple/Full) is a pure view toggle; whether Full view is free is
// driven by `can_use_full_view` (trial active OR paid/lifetime).
//
// Shape:
//   {
//     plan_id,
//     is_paid,                 // on a paid plan (lite/pro/pro_plus/legacy), not expired
//     is_lifetime,
//     trial_active,            // signup trial currently running
//     trial_ends_at,           // ISO string or null
//     trial_days_remaining,    // number or null
//     show_trial_countdown,    // boolean — show the trial countdown banner
//     can_use_full_view,       // trial_active || is_paid || is_lifetime
//     // back-compat aliases (deprecated → mapped to can_use_full_view):
//     can_flip_to_pro, is_paid_pro,
//   }

import { useAuthStore } from "../store";

const DAY_MS = 24 * 60 * 60 * 1000;
const ceilDays = (ms) => Math.max(0, Math.ceil(ms / DAY_MS));
const PAID_PLANS = new Set(["lite", "pro", "pro_plus", "gold", "premium"]);

export function useTrialState() {
  const org = useAuthStore(s => s.org) || {};
  const plan_id = org.plan_id || "trial";
  const now = Date.now();

  const isLifetime = org.is_lifetime === true;
  const expiryOk = !org.plan_expires_at || new Date(org.plan_expires_at).getTime() > now;
  const terminated = ["expired", "suspended", "cancelled"].includes(org.subscription_status);
  const isPaid = PAID_PLANS.has(plan_id) && !terminated && expiryOk;

  // The single signup trial.
  const trialEndsAt = org.trial_ends_at || null;
  const trialActive = org.subscription_status === "trial"
    && !!trialEndsAt
    && new Date(trialEndsAt).getTime() > now;
  const trialDaysRemaining = trialActive
    ? ceilDays(new Date(trialEndsAt).getTime() - now)
    : (trialEndsAt ? 0 : null);

  const canUseFullView = isLifetime || isPaid || trialActive;

  return {
    plan_id,
    is_paid: isPaid,
    is_lifetime: isLifetime,
    trial_active: trialActive,
    trial_ends_at: trialEndsAt,
    trial_days_remaining: trialDaysRemaining,
    show_trial_countdown: !!trialActive,
    can_use_full_view: canUseFullView,
    // Deprecated aliases kept so any straggler consumer doesn't crash mid-rollout.
    can_flip_to_pro: canUseFullView,
    is_paid_pro: isPaid,
  };
}
