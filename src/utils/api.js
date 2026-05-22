import axios from "axios";
import { useAuthStore, useLangStore } from "../store";

// Timeout intentionally generous: the service worker has its own 4s abort timer
// for offline detection, then writes to IndexedDB and posts a message. A short
// axios timeout (e.g. 5s) can fire DURING that fallback and surface as a hang.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 15000 });

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(res => res, err => {
  if (err.response?.status === 401) { useAuthStore.getState().logout(); window.location.href = "/login"; }
  // Sprint A: any 403 with { error: 'upgrade_required' } pops the universal
  // PaywallModal. Layout listens for this event so individual pages don't
  // each have to handle the response shape. Rejection still propagates so
  // local error handlers can stay tight if they want to.
  // MP-REQUIRE-OPEN-SHIFT Phase 3: backend gates every money-event
  // POST with 400 { code:"NO_OPEN_SHIFT", message:"Ouvrez votre…" }
  // when the caller has no open pa_cash_shifts row. Rewrite the
  // message in-place to the user's language so the dozens of
  // existing `toast.error(err.response?.data?.message || "Error")`
  // handlers across pages surface the right text — no per-page
  // special-case needed. The proactive blocker card + disabled
  // submit buttons cover the happy path; this is the backstop for
  // a cashier who clicks faster than the 30s shift-status refetch
  // (or whose shift was closed from another device mid-action).
  if (err.response?.status === 400 && err.response?.data?.code === "NO_OPEN_SHIFT") {
    try {
      const lang = useLangStore.getState().lang;
      err.response.data.message = lang === "fr"
        ? "Ouvrez votre caisse avant de continuer."
        : "Open your shift before continuing.";
    } catch (_) { /* SSR / store not initialised */ }
  }
  if (err.response?.status === 403 && err.response?.data?.error === "upgrade_required") {
    const d = err.response.data;
    try {
      window.dispatchEvent(new CustomEvent("partenaire:paywall", {
        detail: {
          feature:      d.feature,
          current_plan: d.current_plan,
          current_count: d.current_count,
          cap:           d.cap
        }
      }));
    } catch (_) { /* SSR / no-window env */ }
  }
  return Promise.reject(err);
});

export default api;

export const formatCFA = (amount) => {
  if (!amount && amount !== 0) return "—";
  return new Intl.NumberFormat("fr-CM").format(Math.round(amount)) + " FCFA";
};

export const formatDate = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const getGreeting = (lang = "en") => {
  const h = new Date().getHours();
  if (lang === "fr") return h < 12 ? "Bonjour" : h < 18 ? "Bon apres-midi" : "Bonsoir";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
