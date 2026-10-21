// APP LOCK (2026-10-21) — the pure rules (no imports, no storage, no network): what the lock decides
// and how the password is hashed on the device. utils/appLock.js does the storage, network and logout;
// components/AppLock.jsx draws the lock screen. scripts/app-lock-check.mjs tests this file.

export const MAX_WRONG = 5;                 // the 5th wrong password signs the user out
export const PBKDF2_ITERATIONS = 210000;    // timed on the emulator (see the Step 4 report)
export const DEFAULT_POLICY = Object.freeze({
  lock_android: true, lock_web: true, lock_after_minutes: 5, biometric_allowed: true,
  starts_at: null, active: false, source: "default",
});

// Is the lock switched on for this platform at all, and has it started for THIS session?
// `sessionStartedAt` = when this app process / browser tab started (or the user logged in): a session
// already open when the start date passes is never locked — it waits for the next cold start / login.
export function armed(policy, { native, sessionStartedAt, impersonating }) {
  const p = policy || DEFAULT_POLICY;
  if (impersonating) return false;                         // admin "log in as": no password to ask
  if (!p.active || !p.starts_at) return false;
  if (!(native ? p.lock_android : p.lock_web)) return false;
  const start = Date.parse(p.starts_at);
  return Number.isFinite(start) && sessionStartedAt >= start;
}

// Lock when the app opens? `lastUnlockAt` = this tab's last unlock or login (web: kept in
// sessionStorage, so a reload within the window does not lock again; native: a cold start locks).
// Without a hash on this device the lock can only be checked online, so offline it never locks.
export function lockAtStart({ isArmed, hasHash, online, lastUnlockAt, now, minutes }) {
  if (!isArmed) return false;
  if (!hasHash && !online) return false;
  if (lastUnlockAt && now - lastUnlockAt < minutes * 60000) return false;   // fresh login / recent unlock
  return true;   // a cold start (native) and a new or reopened tab (web) both lock
}

// Lock now, after `idleMs` without a touch/key or `awayMs` in the background?
export function lockAfterIdle({ isArmed, hasHash, online, idleMs, minutes }) {
  if (!isArmed) return false;
  if (!hasHash && !online) return false;
  return idleMs >= minutes * 60000;
}

// After a wrong password: how many are left and must we sign out? `serverLeft` / `serverLogout` come
// from POST /app-lock/verify when online (null offline). The device's own count is authoritative too.
export function afterWrong({ deviceFails, serverLeft = null, serverLogout = false }) {
  const localLeft = Math.max(0, MAX_WRONG - deviceFails);
  const left = serverLeft == null ? localLeft : Math.max(0, Math.min(localLeft, serverLeft));
  return { left, logout: !!serverLogout || deviceFails >= MAX_WRONG || left === 0 };
}

// The stored unlock record must belong to the signed-in user AND org (A3); anything else is refused.
export function recordMatchesSession(rec, user, org) {
  return !!(rec && user && org && rec.v === 1 && rec.user_id === user.id && rec.org_id === org.id
    && typeof rec.salt === "string" && typeof rec.hash === "string" && Number.isInteger(rec.iter) && rec.iter >= 10000);
}

// ── PBKDF2-SHA256 (WebCrypto) ────────────────────────────────────────────────────────────────
const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export async function derive(password, saltBytes, iter) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iter }, key, 256);
  return b64(bits);
}

// → the record kept on the device (never the password).
export async function makeRecord({ password, user, org, iter = PBKDF2_ITERATIONS, now = Date.now() }) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, user_id: user.id, org_id: org.id, salt: b64(salt), iter, hash: await derive(password, salt, iter), at: now };
}

// Constant-time compare of two base64 strings of equal length.
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// → "match" | "mismatch" | "none" (no usable record for this user and org)
export async function checkRecord(rec, { password, user, org }) {
  if (!recordMatchesSession(rec, user, org)) return "none";
  return same(await derive(password, unb64(rec.salt), rec.iter), rec.hash) ? "match" : "mismatch";
}
