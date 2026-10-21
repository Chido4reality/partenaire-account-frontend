// APP LOCK (2026-10-21) — JS side of the in-repo AppLockBiometric plugin
// (android/.../BiometricPlugin.java, from vc120). BIOMETRIC_STRONG only, one Keystore key per user,
// cancelled by Android when a new finger/face is enrolled. Anywhere else (web, an older APK) every
// function answers "not available", so the lock falls back to the password.
//
// The plugin object is a Capacitor Proxy: it is only ever called, never returned from an async
// function or resolved through a promise (see push.js — that is what hung vc99–vc104).
import { registerPlugin, Capacitor } from "@capacitor/core";

const BIO = registerPlugin("AppLockBiometric");

export function hasBiometricPlugin() {
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("AppLockBiometric"); }
  catch { return false; }
}

const boxed = (p, ms) => Promise.race([
  Promise.resolve(p).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
  new Promise((r) => setTimeout(() => r({ ok: false, timeout: true }), ms)),
]);
const alias = (userId) => String(userId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

// → { available, reason }   reason: ok | no_hardware | none_enrolled | old_android | unsupported | unavailable | no_plugin
export async function biometricStatus() {
  if (!hasBiometricPlugin()) return { available: false, reason: "no_plugin" };
  const r = await boxed(BIO.status(), 4000);
  if (!r.ok || !r.v) return { available: false, reason: "unavailable" };
  return { available: r.v.available === true, reason: r.v.reason || "unavailable" };
}

export async function createBiometricKey(userId) {
  if (!hasBiometricPlugin() || !alias(userId)) return false;
  const r = await boxed(BIO.createKey({ alias: alias(userId) }), 8000);
  return !!(r.ok && r.v && r.v.ok);
}

export async function hasBiometricKey(userId) {
  if (!hasBiometricPlugin() || !alias(userId)) return false;
  const r = await boxed(BIO.hasKey({ alias: alias(userId) }), 4000);
  return !!(r.ok && r.v && r.v.exists);
}

export async function deleteBiometricKey(userId) {
  if (!hasBiometricPlugin() || !alias(userId)) return false;
  const r = await boxed(BIO.deleteKey({ alias: alias(userId) }), 4000);
  return !!(r.ok && r.v && r.v.ok);
}

// → { ok: true } | { ok: false, code }   code: no_key | invalidated | cancelled | lockout | lockout_permanent | error | timeout
// The prompt stays up while the person tries; 2 minutes is the outer limit.
export async function biometricUnlock(userId, { title, subtitle, cancel }) {
  if (!hasBiometricPlugin() || !alias(userId)) return { ok: false, code: "no_plugin" };
  const r = await boxed(BIO.authenticate({ alias: alias(userId), title, subtitle, cancel }), 120000);
  if (!r.ok) return { ok: false, code: r.timeout ? "timeout" : "error" };
  return r.v && r.v.ok ? { ok: true } : { ok: false, code: (r.v && r.v.code) || "error" };
}
