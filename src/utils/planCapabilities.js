// Sync with backend/src/lib/planCapabilities.js — DO NOT EDIT
// EITHER FILE WITHOUT UPDATING THE OTHER.
//
// Frontend copy of the central plan-capabilities config. Used by the
// sidebar nav filter, the universal PaywallModal, and per-feature cap
// badges on the Inventory / Staff / Settings pages.
//
// 'trial' is a virtual plan — pa_plans has no 'trial' row; the
// effective_plan returned by /api/subscriptions/my-plan is the value
// to feed into hasSection/hasFeature/meetsCap helpers.

export const PLAN_CAPABILITIES = {
  trial: {
    label: 'Trial',
    label_fr: 'Essai',
    duration_days: 14,
    grace_days: 7,
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
    price_fcfa_month: 0
  },
  silver: {
    label: 'Silver',
    label_fr: 'Silver',
    sections: ['sales', 'inventory', 'settings'],
    inventory_cap: 10,
    staff_cap: 1,
    location_cap: 1,
    csv_exports: false,
    receipt_branding: false,
    dozie_access: false,
    dozie_city_cap: 0,
    price_fcfa_month: 0
  },
  gold: {
    label: 'Gold',
    label_fr: 'Gold',
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
  premium: {
    label: 'Premium',
    label_fr: 'Premium',
    sections: '*',
    inventory_cap: null,
    staff_cap: null,
    location_cap: null,
    csv_exports: true,
    receipt_branding: true,
    dozie_access: true,
    dozie_city_cap: null,
    price_fcfa_month: 10000
  }
};

export function getCapabilities(plan_id) {
  return PLAN_CAPABILITIES[plan_id] || PLAN_CAPABILITIES.silver;
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
