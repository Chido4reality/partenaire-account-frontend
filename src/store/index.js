import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translations } from "../i18n/translations";

export const useAuthStore = create(persist(
  (set) => ({
    user: null, org: null, token: null, isAuthenticated: false,
    login: (user, org, token) => set({ user, org, token, isAuthenticated: true }),
    logout: () => set({ user: null, org: null, token: null, isAuthenticated: false }),
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
