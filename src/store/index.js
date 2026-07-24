import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { translations } from "../i18n/translations";
import { safeStorage } from "../utils/safeStorage";

// MP-STORAGE-QUOTA-CRASH-FIX: route ALL persisted stores through the guarded
// storage shim so a QuotaExceededError on any persist write degrades (skips the
// snapshot) instead of throwing into React and crashing the app.
const safeJSONStorage = createJSONStorage(() => safeStorage);

// MP-STALE-TRUST-LOCKOUT: clamp the offline window to 4..72h (default 24), mirroring the
// backend clamp — the client trusts its own persisted value while offline, so it must be sane.
export const clampOfflineHours = (n) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(4, Math.min(72, v)) : 24;
};

export const useAuthStore = create(persist(
  (set) => ({
    user: null, org: null, token: null, isAuthenticated: false,
    // Impersonation flag + metadata set by App.jsx when ?impersonate=<token>
    // is consumed at boot. The MP backend's session token still works the
    // same way as a real login token; this flag just powers the banner.
    impersonating: false,
    impersonation: null, // { admin_email, target_org_name, target_org_mp_id, target_user_name }
    // MP-STALE-TRUST-LOCKOUT: best-effort TRIPWIRE (NOT a security boundary — the server is
    // the real gate). lastVerifiedActive = client clock at the last CONFIRMED-active server
    // response (see api.js interceptor); maxOfflineHours = the org's current offline window.
    // Both persist in mp-auth so they survive an app restart. A user who edits these in
    // localStorage only fools their own device into staying usable a bit longer — the moment
    // it reconnects it hits account_disabled / the write carve-out on the server.
    lastVerifiedActive: null,
    maxOfflineHours: 24,
    login: (user, org, token) => set({ user, org, token, isAuthenticated: true, impersonating: false, impersonation: null,
      lastVerifiedActive: Date.now(), maxOfflineHours: clampOfflineHours(org?.max_offline_hours) }),
    // MP-RECEIPT-LIVE-CASHIER-NAME: merge fresh fields (e.g. a renamed full_name)
    // into the cached user without a re-login, so receipts / "served by" reflect
    // the current pa_users.full_name. No-op when logged out.
    patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),
    // Refresh the tripwire on every CONFIRMED-active server response. maxHrs (from the
    // X-MP-Max-Offline-Hours header) propagates a boss's window change on next contact.
    markVerified: (maxHrs) => set((s) => ({
      lastVerifiedActive: Date.now(),
      maxOfflineHours: maxHrs != null ? clampOfflineHours(maxHrs) : s.maxOfflineHours,
    })),
    loginImpersonated: (user, org, token, meta) => set({ user, org, token, isAuthenticated: true, impersonating: true, impersonation: meta || null,
      lastVerifiedActive: Date.now(), maxOfflineHours: clampOfflineHours(org?.max_offline_hours) }),
    endImpersonation: () => set({ user: null, org: null, token: null, isAuthenticated: false, impersonating: false, impersonation: null, lastVerifiedActive: null }),
    logout: () => set({ user: null, org: null, token: null, isAuthenticated: false, impersonating: false, impersonation: null, lastVerifiedActive: null }),
  }),
  { name: "mp-auth", storage: safeJSONStorage }
));

// Is the session stale-locked? Owner is exempt from the TIME lock only (an owner can't be
// deactivated, so a network outage must never lock the boss out). A future-dated stamp is
// treated as invalid (forged / clock rolled back) → locked. A null stamp (pre-feature
// session) is grace-not-locked; LockGate fires a background probe to stamp it.
export function isStaleLocked(state) {
  const { isAuthenticated, user, lastVerifiedActive, maxOfflineHours } = state;
  if (!isAuthenticated || !user) return false;
  if (user.role === "owner") return false;
  if (lastVerifiedActive == null) return false;
  const age = Date.now() - lastVerifiedActive;
  if (age < 0) return true; // future-dated → invalid
  return age > clampOfflineHours(maxOfflineHours) * 3600 * 1000;
}

export const useLangStore = create(persist(
  (set, get) => ({
    lang: "en",
    setLang: (lang) => set({ lang }),
    t: (key) => {
      const dict = translations[get().lang];
      const keys = key.split(".");
      let val = dict;
      for (const k of keys) val = val?.[k];
      return val || key;
    }
  }),
  { name: "mp-lang", storage: safeJSONStorage }
));

export const useOfflineStore = create(persist(
  (set) => ({
    queue: [], isOnline: true,
    setOnline: (v) => set({ isOnline: v }),
  }),
  { name: "mp-offline", storage: safeJSONStorage }
));

export const useSettingsStore = create(persist(
  (set) => ({
    selectedLocation: null,
    setLocation: (loc) => set({ selectedLocation: loc }),
  }),
  { name: "mp-settings", storage: safeJSONStorage }
));

// MP-POS-CART-PERSIST: keep an in-progress sale alive across navigation,
// hard refresh, and offline crashes. Cart used to live in POSPage local
// state, so tapping any sidebar link unmounted the page and wiped the
// cart. Now POSPage saves draft snapshots here on every change and
// restores them on mount when (userId, locationId) match. Scoping
// matters: Nora's cart at Bonaberri shouldn't appear when she's working
// Bepanda, and one cashier's draft mustn't surface for another user on
// the same device.
//
// Shape: drafts[`${userId}::${locationId}`] = {
//   items, customer, payMode, paidAmt, dueDate, notes, updatedAt
// }
// updatedAt drives a 24h TTL on restore — older drafts are stale and
// silently discarded so a cashier who walked away yesterday doesn't
// come back to surprise data today.
// MP-STORAGE-QUOTA-CRASH-FIX (growth side): the drafts map grew UNBOUNDED.
// Entries are keyed by `${userId}::${locationId}`; clearDraft only ever removed
// the CURRENT scope (on sale finalize / empty cart) and the 24h TTL was applied
// only on READ in POSPage — never deleted from storage. So every other scope
// (other cashiers, other locations, abandoned carts) lingered forever, and on a
// shared device they piled up until the blob blew the quota. Fix: prune
// TTL-stale scopes + hard-cap the count on every save, and slim each line to a
// known whitelist (no whole product records ever creep in).
const DRAFT_TTL_MS  = 24 * 60 * 60 * 1000;  // matches POSPage restore TTL
const MAX_DRAFTS    = 12;                    // most-recent scopes kept; backstop
// Exactly the fields addToCart()/addDebtToCart() in POSPage produce and that
// restore + customer-tier re-pricing + receipts read back. Anything else (e.g.
// a stray full product object) is dropped so the snapshot can't bloat.
const DRAFT_ITEM_FIELDS = [
  "lineId", "product_id", "name", "unit", "barcode", "quantity",
  "unit_price", "original_price", "price_tier", "sell_price",
  "wholesale_price", "min_price", "cost_price", "stock",
  "isDebt", "debtSaleIds", "debtAmount",
  // MP-BELOW-COST-PERSIST: keep the boss-approval markers on the line so a
  // restored draft (navigate-away-and-back) keeps the APPROVED below-cost price
  // instead of reverting to the tier price + forcing re-approval.
  "price_overridden", "price_approval_token", "below_cost_approved",
  // MP-DAMAGED-GOODS: a damaged line carries these two markers so the /sales
  // payload can record it as a damaged sale + decrement the right pile row.
  // They MUST survive draft persistence — Stock Check hands the item off to POS
  // via the draft cart, and without these on the whitelist the markers would be
  // silently stripped on the next save/restore and the sale would post as normal.
  "is_damaged", "damaged_source_id",
];
function slimDraftItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const o = {};
    if (it) for (const f of DRAFT_ITEM_FIELDS) if (it[f] !== undefined) o[f] = it[f];
    return o;
  });
}

export const useDraftCartStore = create(persist(
  (set, get) => ({
    drafts: {},
    saveDraft: ({ userId, locationId, items, customer, payMode, paidAmt, dueDate, notes, belowCostApprovalId, discountApprovalId }) => {
      if (!userId || !locationId) return;
      const key = `${userId}::${locationId}`;
      const now = Date.now();
      set((state) => {
        // Prune TTL-stale scopes (the read-side TTL never deleted these).
        const kept = {};
        for (const [k, d] of Object.entries(state.drafts || {})) {
          if (k === key) continue; // current scope rewritten below
          if (d && (now - (d.updatedAt || 0)) <= DRAFT_TTL_MS) kept[k] = d;
        }
        kept[key] = {
          items: slimDraftItems(items),
          customer, payMode, paidAmt, dueDate, notes, updatedAt: now,
          // MP-BELOW-COST-PERSIST: the cart-level boss-approval links survive
          // navigation so checkout still sends below_cost_approval_id /
          // discount_approval_id after the page remounts.
          belowCostApprovalId: belowCostApprovalId || null,
          discountApprovalId: discountApprovalId || null,
        };
        // Hard cap: keep only the most-recently-updated MAX_DRAFTS scopes.
        const entries = Object.entries(kept);
        if (entries.length > MAX_DRAFTS) {
          entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
          return { drafts: Object.fromEntries(entries.slice(0, MAX_DRAFTS)) };
        }
        return { drafts: kept };
      });
    },
    getDraft: ({ userId, locationId }) => {
      if (!userId || !locationId) return null;
      return get().drafts[`${userId}::${locationId}`] || null;
    },
    clearDraft: ({ userId, locationId }) => {
      if (!userId || !locationId) return;
      const key = `${userId}::${locationId}`;
      set((state) => {
        if (!state.drafts[key]) return state;
        const { [key]: _drop, ...rest } = state.drafts;
        return { drafts: rest };
      });
    },
  }),
  { name: "mp-pos-draft-cart", storage: safeJSONStorage }
));
