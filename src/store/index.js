import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translations } from "../i18n/translations";

export const useAuthStore = create(persist(
  (set) => ({
    user: null, org: null, token: null, isAuthenticated: false,
    // Impersonation flag + metadata set by App.jsx when ?impersonate=<token>
    // is consumed at boot. The MP backend's session token still works the
    // same way as a real login token; this flag just powers the banner.
    impersonating: false,
    impersonation: null, // { admin_email, target_org_name, target_org_mp_id, target_user_name }
    login: (user, org, token) => set({ user, org, token, isAuthenticated: true, impersonating: false, impersonation: null }),
    loginImpersonated: (user, org, token, meta) => set({ user, org, token, isAuthenticated: true, impersonating: true, impersonation: meta || null }),
    endImpersonation: () => set({ user: null, org: null, token: null, isAuthenticated: false, impersonating: false, impersonation: null }),
    logout: () => set({ user: null, org: null, token: null, isAuthenticated: false, impersonating: false, impersonation: null }),
  }),
  { name: "mp-auth" }
));

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
  { name: "mp-lang" }
));

export const useOfflineStore = create(persist(
  (set) => ({
    queue: [], isOnline: true,
    setOnline: (v) => set({ isOnline: v }),
  }),
  { name: "mp-offline" }
));

export const useSettingsStore = create(persist(
  (set) => ({
    selectedLocation: null,
    setLocation: (loc) => set({ selectedLocation: loc }),
  }),
  { name: "mp-settings" }
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
export const useDraftCartStore = create(persist(
  (set, get) => ({
    drafts: {},
    saveDraft: ({ userId, locationId, items, customer, payMode, paidAmt, dueDate, notes }) => {
      if (!userId || !locationId) return;
      const key = `${userId}::${locationId}`;
      set((state) => ({
        drafts: {
          ...state.drafts,
          [key]: { items, customer, payMode, paidAmt, dueDate, notes, updatedAt: Date.now() },
        },
      }));
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
  { name: "mp-pos-draft-cart" }
));
