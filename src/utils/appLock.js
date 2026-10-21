// APP LOCK (2026-10-21) — device side: storage, the owner's policy, the unlock check, and logout.
// The rules themselves are in utils/appLockCore.js; the screen is components/AppLock.jsx.
//
// What is kept on this device, per user (A3: native in @capacitor/preferences, web in localStorage):
//   mp-applock-rec-<user>    { v, user_id, org_id, salt, iter, hash, at } — PBKDF2 of the password, never the password
//   mp-applock-fails-<user>  wrong passwords in a row on this device
//   mp-applock-bio-<user>    "on" | "needs_password" (fingerprint/face unlock; the key itself is in the Android Keystore)
//   mp-applock-policy-<org>  the last policy read from the server (used offline)
//   mp-device-id             a random id for this install (the server's per-device limit)
// The hash is written when a login or a password change succeeds, from the password the user just typed —
// by our OWN response handler on the shared api instance (LoginPage.jsx and api.js are not changed).
//
// A2: on ANY logout or user change, the previous user's record, counter and biometric key are deleted —
// from a store subscription (covers the Logout button, the 401 interceptor, the session-swap tripwire,
// our own 5-wrong logout), plus a sweep at start-up for anything a page unload interrupted.
import { Capacitor } from "@capacitor/core";
import api from "./api";
import { useAuthStore } from "../store";
import { nukeClientState, hardRedirectToLogin } from "./authReset";
import { revokeOnLogout } from "./push";
import { DEFAULT_POLICY, makeRecord, checkRecord, recordMatchesSession, afterWrong } from "./appLockCore";
import { createBiometricKey, deleteBiometricKey, biometricUnlock, biometricStatus } from "./biometric";

export const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
export const SESSION_STARTED_AT = Date.now();   // this app process / browser tab

// ── storage ───────────────────────────────────────────────────────────────────────────────────────
let prefs = null;
async function P() { if (!prefs) prefs = (await import("@capacitor/preferences")).Preferences; return prefs; }
// The Preferences plugin is a proxy: only ever called, never returned from these functions.
const store = {
  async get(k) {
    if (isNative()) { try { const r = await (await P()).get({ key: k }); return r && r.value != null ? r.value : null; } catch { return null; } }
    try { return localStorage.getItem(k); } catch { return null; }
  },
  async set(k, v) {
    if (isNative()) { try { await (await P()).set({ key: k, value: v }); } catch { /* storage off */ } return; }
    try { localStorage.setItem(k, v); } catch { /* storage off */ }
  },
  async remove(k) {
    if (isNative()) { try { await (await P()).remove({ key: k }); } catch { /* gone */ } return; }
    try { localStorage.removeItem(k); } catch { /* gone */ }
  },
  async keys() {
    if (isNative()) { try { const r = await (await P()).keys(); return (r && r.keys) || []; } catch { return []; } }
    try { return Object.keys(localStorage); } catch { return []; }
  },
};
const getJSON = async (k) => { try { const v = await store.get(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const K = {
  rec: (u) => `mp-applock-rec-${u}`, fails: (u) => `mp-applock-fails-${u}`, bio: (u) => `mp-applock-bio-${u}`,
  policy: (o) => `mp-applock-policy-${o}`, device: "mp-device-id", pending: "mp-applock-pending-event",
};
const USER_KEY = /^mp-applock-(rec|fails|bio)-(.+)$/;

// ── this install's id (server-side per-device limit) ─────────────────────────────────────────────
let deviceIdCache = null;
export async function deviceId() {
  if (deviceIdCache) return deviceIdCache;
  let id = await store.get(K.device);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const a = crypto.getRandomValues(new Uint8Array(16));
    id = "d" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    await store.set(K.device, id);
  }
  deviceIdCache = id;
  return id;
}

// ── "just unlocked / just logged in" (web: survives a reload, not a new tab) ─────────────────────
let lastUnlockMem = 0;
export function markUnlocked(at = Date.now()) {
  lastUnlockMem = at;
  try { sessionStorage.setItem("mp-applock-unlocked-at", String(at)); } catch { /* storage off */ }
}
export function lastUnlockAt() {
  if (isNative()) return lastUnlockMem;
  let s = 0; try { s = Number(sessionStorage.getItem("mp-applock-unlocked-at") || 0); } catch { /* storage off */ }
  return Math.max(lastUnlockMem, s || 0);
}

// ── policy ─────────────────────────────────────────────────────────────────────────────────────────
export async function savedPolicy(orgId) {
  const p = orgId ? await getJSON(K.policy(orgId)) : null;
  return p && typeof p === "object" ? { ...DEFAULT_POLICY, ...p } : { ...DEFAULT_POLICY };
}
// Reads the server's policy (online) and keeps a copy for offline. null = could not read it.
export async function refreshPolicy(orgId) {
  if (!orgId || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
  try {
    const r = await api.get("/app-lock/policy", { timeout: 8000 });
    const d = r && r.data && r.data.data;
    if (!d) return null;
    const keep = { lock_android: d.lock_android, lock_web: d.lock_web, lock_after_minutes: d.lock_after_minutes,
      biometric_allowed: d.biometric_allowed, starts_at: d.starts_at, active: d.active, source: d.source };
    await store.set(K.policy(orgId), JSON.stringify(keep));
    return { ...DEFAULT_POLICY, ...keep };
  } catch { return null; }
}
export async function savePolicyCopy(orgId, d) {
  if (!orgId || !d) return;
  const keep = { lock_android: d.lock_android, lock_web: d.lock_web, lock_after_minutes: d.lock_after_minutes,
    biometric_allowed: d.biometric_allowed, starts_at: d.starts_at, active: d.active, source: d.source };
  await store.set(K.policy(orgId), JSON.stringify(keep));
}

// ── the unlock record ──────────────────────────────────────────────────────────────────────────────
export async function hasRecord(user, org) {
  return !!(user && org && recordMatchesSession(await getJSON(K.rec(user.id)), user, org));
}
async function writeRecord(user, org, password) {
  if (!user || !org || typeof password !== "string" || !password) return;
  try { await store.set(K.rec(user.id), JSON.stringify(await makeRecord({ password, user, org }))); }
  catch (e) { console.warn("[app-lock] could not keep the unlock record:", e && e.message); }
}
const getFails = async (u) => Number(await store.get(K.fails(u))) || 0;
const setFails = (u, n) => (n > 0 ? store.set(K.fails(u), String(n)) : store.remove(K.fails(u)));

// A2: everything this device keeps for that user.
export async function wipeUser(userId) {
  if (!userId) return;
  await Promise.all([store.remove(K.rec(userId)), store.remove(K.fails(userId)), store.remove(K.bio(userId))]);
  await deleteBiometricKey(userId);
}
// At start-up: anything left behind for a user who is not the signed-in one goes (a logout's page
// unload can cut the subscription's async clean-up short).
export async function sweepOtherUsers() {
  const me = useAuthStore.getState().user;
  const mine = me && useAuthStore.getState().isAuthenticated ? me.id : null;
  const others = new Set();
  for (const k of await store.keys()) { const m = USER_KEY.exec(k); if (m && m[2] !== mine) others.add(m[2]); }
  for (const u of others) await wipeUser(u);
  return [...others];
}

// ── capture the hash when a login / password change succeeds (our own handler) ───────────────────
function bodyOf(cfg) { try { return typeof cfg.data === "string" ? JSON.parse(cfg.data) : (cfg.data || {}); } catch { return {}; } }
api.interceptors.response.use((res) => {
  try {
    const url = String((res && res.config && res.config.url) || "").split("?")[0];
    if (/\/auth\/login$/.test(url) && res.data && res.data.user && res.data.org && res.data.token) {
      const { password } = bodyOf(res.config);
      const user = res.data.user, org = res.data.org;
      markUnlocked();                                   // never lock right after a login
      writeRecord(user, org, password);
      setFails(user.id, 0);
      flushPendingEvent(user.id);
      if (res.data.org && res.data.org.id) refreshPolicyLater(org.id);
    } else if (/\/auth\/change-password$/.test(url) && res.data && res.data.success !== false) {
      const { new_password } = bodyOf(res.config);
      const { user, org } = useAuthStore.getState();
      writeRecord(user, org, new_password);
    }
  } catch { /* never break a login */ }
  return res;
});
function refreshPolicyLater(orgId) { setTimeout(() => { refreshPolicy(orgId); }, 1500); }

// A2 — every way the signed-in user changes or goes away passes through the auth store.
useAuthStore.subscribe((s, prev) => {
  const before = prev && prev.user && prev.user.id;
  const now = s && s.isAuthenticated && s.user && s.user.id;
  if (before && before !== now) wipeUser(before);
});

// ── a "failed logout" that happened offline is reported at that user's next login ────────────────
async function rememberPendingEvent(ev) { if (isNative()) await store.set(K.pending, JSON.stringify(ev)); }
async function flushPendingEvent(userId) {
  const ev = await getJSON(K.pending);
  if (!ev) return;
  await store.remove(K.pending);
  if (ev.user_id !== userId) return;                // only that user's own session may report it
  try { await api.post("/app-lock/event", { event: ev.event, offline: true, wrong_attempts: ev.wrong_attempts, occurred_at: ev.occurred_at, device_id: await deviceId(), platform: "android" }, { timeout: 8000 }); }
  catch { /* best effort */ }
}
export async function reportEvent(event, extra = {}) {
  try { await api.post("/app-lock/event", { event, device_id: await deviceId(), platform: isNative() ? "android" : "web", ...extra }, { timeout: 8000 }); return true; }
  catch { return false; }
}

// ── unlocking ─────────────────────────────────────────────────────────────────────────────────────
// → { ok: true }
//   { ok: false, left, logout }                 a wrong password
//   { ok: false, rateLimited: true, retryAfter } the server's limit (A1) — not counted on the device
//   { ok: false, cannotCheck: true }            offline with no record on this device
export async function unlockWithPassword(password) {
  const { user, org } = useAuthStore.getState();
  if (!user || !org) return { ok: false, cannotCheck: true };
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  if (online) {
    try {
      const r = await api.post("/app-lock/verify", { password, device_id: await deviceId() }, { timeout: 8000 });
      const d = r && r.data && r.data.data;
      if (d && d.ok === true) { await onUnlocked(user, org, password); return { ok: true }; }
      if (d && d.ok === false) {
        const fails = (await getFails(user.id)) + 1;
        await setFails(user.id, fails);
        const w = afterWrong({ deviceFails: fails, serverLeft: d.attempts_left, serverLogout: d.logout });
        return { ok: false, left: w.left, logout: w.logout, audited: !!d.logout };
      }
    } catch (e) {
      const st = e && e.response && e.response.status;
      if (st === 429) {
        const ra = Number(e.response.data && e.response.data.retry_after) || 60;
        return { ok: false, rateLimited: true, retryAfter: ra };
      }
      // network error, timeout, 5xx → the device's own check below
    }
  }
  const rec = await getJSON(K.rec(user.id));
  const res = await checkRecord(rec, { password, user, org });
  if (res === "none") return { ok: false, cannotCheck: true };
  if (res === "match") { await onUnlocked(user, org, null); return { ok: true }; }
  const fails = (await getFails(user.id)) + 1;
  await setFails(user.id, fails);
  const w = afterWrong({ deviceFails: fails });
  return { ok: false, left: w.left, logout: w.logout, offline: true };
}
async function onUnlocked(user, org, freshPassword) {
  await setFails(user.id, 0);
  if (freshPassword) await writeRecord(user, org, freshPassword);   // the server just confirmed it: refresh
  // fingerprints changed since the key was made: the password re-arms biometric unlock
  if ((await store.get(K.bio(user.id))) === "needs_password") {
    if (await createBiometricKey(user.id)) await store.set(K.bio(user.id), "on");
  }
  markUnlocked();
}

// ── biometric ─────────────────────────────────────────────────────────────────────────────────────
export async function biometricState(userId) { return userId ? (await store.get(K.bio(userId))) || "off" : "off"; }
export { biometricStatus };
// → { ok } | { ok:false, code }  (the person confirms with their finger/face once)
export async function enableBiometric(texts) {
  const { user } = useAuthStore.getState();
  if (!user) return { ok: false, code: "no_user" };
  const st = await biometricStatus();
  if (!st.available) return { ok: false, code: st.reason };
  if (!(await createBiometricKey(user.id))) return { ok: false, code: "error" };
  const r = await biometricUnlock(user.id, texts);
  if (!r.ok) { await deleteBiometricKey(user.id); return r; }
  await store.set(K.bio(user.id), "on");
  reportEvent("biometric_enabled");
  return { ok: true };
}
export async function disableBiometric(reason) {
  const { user } = useAuthStore.getState();
  if (!user) return;
  await store.remove(K.bio(user.id));
  await deleteBiometricKey(user.id);
  reportEvent("biometric_disabled", reason ? { reason } : {});
}
// → { ok } | { ok:false, code }   code "invalidated": a new finger/face was enrolled → password needed
export async function unlockWithBiometric(texts) {
  const { user, org } = useAuthStore.getState();
  if (!user) return { ok: false, code: "no_user" };
  const r = await biometricUnlock(user.id, texts);
  if (r.ok) { await setFails(user.id, 0); markUnlocked(); return { ok: true }; }
  if (r.code === "invalidated" || r.code === "no_key") await store.set(K.bio(user.id), "needs_password");
  return r;
}

// ── signing out (the 5th wrong password, or "Not you? Sign out") ─────────────────────────────────
// The same steps as the Logout button (Layout.jsx handleLogout), called from here — nothing there is
// changed. The offline queue is in IndexedDB and is not touched: it syncs at the next login.
export async function signOut(queryClient, { reason, wrongAttempts, audited } = {}) {
  const { user } = useAuthStore.getState();
  if (reason === "failed_logout" && user && !audited) {
    const ev = { event: "failed_logout", user_id: user.id, wrong_attempts: wrongAttempts || null, occurred_at: new Date().toISOString() };
    const sent = (typeof navigator === "undefined" || navigator.onLine !== false) && (await reportEvent("failed_logout", { wrong_attempts: ev.wrong_attempts, occurred_at: ev.occurred_at }));
    if (!sent) await rememberPendingEvent(ev);
  }
  if (user) await wipeUser(user.id);                           // A2 — before the page goes
  const quick = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  await quick(revokeOnLogout());
  await quick(api.post("/auth/logout"));
  useAuthStore.getState().logout();
  nukeClientState(queryClient);
  hardRedirectToLogin(reason === "failed_logout" ? "app_lock" : undefined);
}
