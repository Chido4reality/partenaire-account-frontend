// MP-BILLING-V2 (2 Jun): centralised trial-state readouts for the
// frontend. Backend computes everything authoritatively; this hook
// just packages the org's persisted fields (returned by /auth/me via
// the existing pa_organisations(*) join) into structured booleans +
// day counts so consumers don't each re-derive the same Math.ceil
// calls.
//
// Shape:
//   {
//     plan_id,                      // 'trial' | 'lite' | 'pro' (or legacy alias)
//     is_paid_pro,                  // plan_id === 'pro' or 'premium'
//     // ── Lite (14-day) trial ──
//     trial_ends_at,                // ISO string or null
//     lite_trial_days_remaining,    // number or null when no trial / past
//     show_lite_trial_countdown,    // true on days 8-14 of trial
//     // ── Pro (7-day, sticky) trial ──
//     pro_trial_started_at,         // ISO string or null
//     pro_trial_ends_at,            // ISO string or null
//     pro_trial_state,              // 'never_started' | 'active' | 'expired'
//     pro_trial_days_remaining,     // number or null
//     can_start_pro_trial,          // boolean — true only when 'never_started'
//     can_flip_to_pro,              // boolean — gate for Settings Mode CTA
//   }

import { useAuthStore } from "../store";

const DAY_MS = 24 * 60 * 60 * 1000;
const ceilDays = (ms) => Math.max(0, Math.ceil(ms / DAY_MS));

export function useTrialState() {
  const org = useAuthStore(s => s.org) || {};
  const plan_id = org.plan_id || 'trial';
  const isPaidPro = plan_id === 'pro' || plan_id === 'premium';

  // ── Lite (14-day) trial countdown ───────────────────────────────
  const trialEndsAt = org.trial_ends_at || null;
  let liteTrialDaysRemaining = null;
  let showLiteTrialCountdown = false;
  if (trialEndsAt) {
    const endMs = new Date(trialEndsAt).getTime();
    const now = Date.now();
    if (endMs > now) {
      liteTrialDaysRemaining = ceilDays(endMs - now);
      // Per directive: quiet days 1-7, countdown days 8-14.
      showLiteTrialCountdown = liteTrialDaysRemaining <= 7;
    } else {
      liteTrialDaysRemaining = 0;
    }
  }

  // ── Pro (7-day, sticky) trial state ─────────────────────────────
  const proStartedAt = org.pro_trial_started_at || null;
  const proEndsAt    = org.pro_trial_ends_at || null;
  let proTrialState = 'never_started';
  let proTrialDaysRemaining = null;
  if (proStartedAt && proEndsAt) {
    const endMs = new Date(proEndsAt).getTime();
    const now = Date.now();
    if (endMs > now) {
      proTrialState = 'active';
      proTrialDaysRemaining = ceilDays(endMs - now);
    } else {
      proTrialState = 'expired';
      proTrialDaysRemaining = 0;
    }
  }

  const canStartProTrial = proTrialState === 'never_started';
  // Flip is allowed when: never tried, trial active, OR user is on
  // paid Pro (trial doesn't apply). Blocked when trial expired AND
  // user isn't on paid Pro.
  const canFlipToPro = isPaidPro || proTrialState === 'never_started' || proTrialState === 'active';

  return {
    plan_id,
    is_paid_pro: isPaidPro,
    trial_ends_at: trialEndsAt,
    lite_trial_days_remaining: liteTrialDaysRemaining,
    show_lite_trial_countdown: showLiteTrialCountdown,
    pro_trial_started_at: proStartedAt,
    pro_trial_ends_at: proEndsAt,
    pro_trial_state: proTrialState,
    pro_trial_days_remaining: proTrialDaysRemaining,
    can_start_pro_trial: canStartProTrial,
    can_flip_to_pro: canFlipToPro,
  };
}
