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
