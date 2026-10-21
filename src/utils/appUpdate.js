// APP UPDATE (2026-10-21): what the update gate (Android) and the reload banner (web) need to decide.
//
//   decideAndroid(versionCode, policy) → "none" | "reminder" | "required"   (pure)
//   fetchVersionPolicy()  GET /api/app/version-policy → the android policy, or null. null = offline,
//                         503, timeout, no row, a bad row — and null NEVER blocks anyone.
//   cartHasItems()        the signed-in user has items in a POS cart (the persisted draft — read only)
//   requestsInFlight()    API requests started and not yet answered (counted by our own interceptors
//                         on the shared axios instance; api.js itself is not changed)
//   pendingCount()        items in the offline queue (pendingSync.getStats — read only)
//
// The offline queue is never written from here: no enqueue, retry, discard or delete.

import api from "./api";
import { getStats } from "./pendingSync";
import { useAuthStore, useDraftCartStore } from "../store";
import { setBusyCheck } from "./swTakeover";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // same as the store's: an older draft is not restored
const POLICY_TIMEOUT_MS = 8000;
const REMINDER_KEY = "mp-update-reminder-at";

export const isNative = () => {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch { return false; }
};

const posInt = (v) => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// Pure. A missing/odd policy or version code is "none" — never block on a guess.
export function decideAndroid(versionCode, policy) {
  const vc = posInt(versionCode);
  if (vc == null || !policy) return "none";
  const min = posInt(policy.min_supported_version_code);
  const latest = posInt(policy.latest_version_code);
  if (min == null || latest == null || min > latest) return "none";
  if (vc < min) return "required";
  if (vc < latest) return "reminder";
  return "none";
}

export async function fetchVersionPolicy() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const base = import.meta.env.VITE_API_URL || "/api";
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch { /* ignore */ } }, POLICY_TIMEOUT_MS);
  try {
    const r = await fetch(base + "/app/version-policy", { signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.success && j.data && j.data.android) || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function cartHasItems() {
  try {
    const user = useAuthStore.getState().user;
    if (!user || !user.id) return false;
    const drafts = useDraftCartStore.getState().drafts || {};
    const now = Date.now();
    return Object.entries(drafts).some(([k, d]) => k.startsWith(user.id + "::") && d
      && Array.isArray(d.items) && d.items.length > 0 && now - (d.updatedAt || 0) <= DRAFT_TTL_MS);
  } catch { return true; }   // can't tell → treat as busy
}

// ── requests in flight ────────────────────────────────────────────────────────────────────────────
// Each request gets a ticket when it starts and returns it when answered (success OR error — axios
// passes a rejected request interceptor down to the response error handlers too). A ticket older than
// 60 s is ignored, so one lost ticket can never hold the reload forever.
const tickets = new Map();
let nextTicket = 1;
const TICKET_MAX_MS = 60 * 1000;
const done = (cfg) => { if (cfg && cfg.__mpTicket) tickets.delete(cfg.__mpTicket); };
api.interceptors.request.use((cfg) => { cfg.__mpTicket = nextTicket++; tickets.set(cfg.__mpTicket, Date.now()); return cfg; });
api.interceptors.response.use((res) => { done(res && res.config); return res; },
  (err) => { done(err && err.config); return Promise.reject(err); });
export function requestsInFlight() {
  const now = Date.now();
  let n = 0;
  for (const [k, t] of tickets) { if (now - t > TICKET_MAX_MS) tickets.delete(k); else n++; }
  return n;
}

// The web reload rule (utils/swTakeover): a visible tab reloads on its own only with an empty cart
// and nothing in flight.
setBusyCheck(() => ({ cart: cartHasItems(), inFlight: requestsInFlight() }));

export async function pendingCount() {
  try { const s = await getStats(); return s && Number.isFinite(s.total) ? s.total : null; }
  catch { return null; }
}

// The reminder is shown at most once every `hours`.
export function reminderDue(hours) {
  const h = posInt(hours) || 24;
  let last = 0;
  try { last = Number(localStorage.getItem(REMINDER_KEY) || 0); } catch { /* storage off */ }
  return !(last > 0 && last <= Date.now() && Date.now() - last < h * 3600 * 1000);
}
export function markReminderShown() {
  try { localStorage.setItem(REMINDER_KEY, String(Date.now())); } catch { /* storage off */ }
}

// This build's versionCode (number), or null off-device / unreadable. Only a plain value crosses the
// promise boundary — never the plugin proxy (see feedback on Capacitor proxies being thenable).
export async function appVersionCode() {
  if (!isNative()) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await Promise.race([App.getInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    return posInt(info && info.build);
  } catch { return null; }
}

// What Google Play says. status: "available" | "not_available" | "error" (sideloaded, no Play, timeout).
export async function playUpdateInfo() {
  if (!isNative()) return { status: "error" };
  try {
    const { AppUpdate, AppUpdateAvailability } = await import("@capawesome/capacitor-app-update");
    const info = await Promise.race([AppUpdate.getAppUpdateInfo(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    const a = info && info.updateAvailability;
    const status = a === AppUpdateAvailability.UPDATE_AVAILABLE || a === AppUpdateAvailability.UPDATE_IN_PROGRESS ? "available"
      : a === AppUpdateAvailability.UPDATE_NOT_AVAILABLE ? "not_available" : "error";
    return { status, immediateAllowed: !!(info && info.immediateUpdateAllowed), flexibleAllowed: !!(info && info.flexibleUpdateAllowed) };
  } catch (e) {
    return { status: "error", reason: String((e && e.message) || e).slice(0, 120) };
  }
}
