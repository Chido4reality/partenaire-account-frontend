import axios from "axios";
import { useAuthStore } from "../store";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 5000 });

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(res => res, err => {
  if (err.response?.status === 401) { useAuthStore.getState().logout(); window.location.href = "/login"; }
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
