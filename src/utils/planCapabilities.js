// Sync with backend/src/lib/planCapabilities.js — DO NOT EDIT
// EITHER FILE WITHOUT UPDATING THE OTHER.
//
// MP-BILLING-V2 (2 Jun): rekeyed from silver/gold/premium → trial/lite/pro
// to match the MCP-applied pa_plans rename. Mapping decided in
// review-claude's Q1 hybrid answer:
//   trial = old silver behavior + 10-product cap. Trial is the free
//           floor that orgs stay on indefinitely after the 14-day
//           countdown ends — caps are constant, only the banner
//           disappears.
//   lite  = old gold behavior at 8 000 FCFA/mo — full sections +
//           Dozie access.
//   pro   = old premium behavior at 10 000 FCFA/mo — wildcard
//           sections, no caps, CSV + receipt branding unlocked.
//
// Legacy aliases (silver/gold/premium) still resolve to the
// equivalent new tier via getCapabilities()'s alias_of lookup so any
// stale call path (cached bundle, audit log payload) keeps working.

export const PLAN_CAPABILITIES = {
  trial: {
    label: 'Trial',
    label_fr: 'Essai',
    duration_days: 7,    // MP-7DAY-FULL-TRIAL: 7-day full-feature trial window
    grace_days: 0,       // these caps are the restricted FREE floor AFTER expiry
    // NOTE: during the 7-day window the backend effective plan is 'pro' (full);
    // these 'trial' sections are the restricted free floor an org lands on after.
    sections: ['sales', 'inventory', 'settings'],
    inventory_cap: 10,     // MP-BILLING-V2 Q3
    staff_cap: 1,
    location_cap: 1,
    csv_exports: false,
    receipt_branding: false,
    dozie_access: false,
    dozie_city_cap: 0,
    price_fcfa_month: 0
  },
  lite: {
    label: 'Lite',
    label_fr: 'Lite',
    sections: ['dashboard', 'sales', 'inventory', 'count', 'labels',
               'transfers', 'customers', 'credits', 'cashflow', 'reports',
               'online_cart', 'settings'],
    inventory_cap: null,
    staff_cap: 2,
    location_cap: 2,
    csv_exports: false,
    receipt_branding: false,
    dozie_access: true,
    dozie_city_cap: 3,
    price_fcfa_month: 8000
  },
  pro: {
    label: 'Pro',
    label_fr: 'Pro',
    sections: '*',
    inventory_cap: null,
    staff_cap: null,
    location_cap: null,
    csv_exports: true,
    receipt_branding: true,
    dozie_access: true,
    dozie_city_cap: null,
    price_fcfa_month: 10000
  },

  // Legacy aliases — DO NOT REFERENCE FROM NEW CODE.
  silver:  { legacy: true, alias_of: 'trial' },
  gold:    { legacy: true, alias_of: 'lite' },
  premium: { legacy: true, alias_of: 'pro' }
};

export function getCapabilities(plan_id) {
  const raw = PLAN_CAPABILITIES[plan_id];
  if (raw && raw.alias_of) return PLAN_CAPABILITIES[raw.alias_of];
  return raw || PLAN_CAPABILITIES.trial;
}

export function hasSection(plan, section) {
  const caps = getCapabilities(plan);
  if (caps.sections === '*') return true;
  return Array.isArray(caps.sections) && caps.sections.includes(section);
}

export function hasFeature(plan, feature) {
  const caps = getCapabilities(plan);
  return !!caps[feature];
}

export function meetsCap(plan, capName, currentCount, proposed) {
  const caps = getCapabilities(plan);
  const cap = caps[capName];
  if (cap == null) return true;
  const future = (currentCount || 0) + (proposed || 1);
  return future <= cap;
}

export function isAtCap(plan, capName, currentCount) {
  const caps = getCapabilities(plan);
  const cap = caps[capName];
  if (cap == null) return false;
  return (currentCount || 0) >= cap;
}
