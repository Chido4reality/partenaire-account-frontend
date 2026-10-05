// MP-PUSH-ASK (vc114) — JS side of the in-repo NotificationSettings plugin
// (android/.../NotificationSettingsPlugin.java). Exists only in APKs from vc114 on; every
// function degrades to "unknown" anywhere else, so the rest of the app never depends on it.
//
// The plugin object is a Capacitor Proxy: it is only ever called, never returned from an
// async function or resolved through a promise (see push.js — that is what hung vc99–vc104).
import { registerPlugin, Capacitor } from "@capacitor/core";

const NS = registerPlugin("NotificationSettings");

export function hasNativeSettings() {
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("NotificationSettings"); }
  catch { return false; }
}

const boxed = (p, ms) => Promise.race([
  Promise.resolve(p).then((v) => ({ ok: true, v }), () => ({ ok: false })),
  new Promise((r) => setTimeout(() => r({ ok: false }), ms)),
]);

// { enabled, channelExists, channelBlocked } — or null when it cannot be read.
export async function readNativeAlertStatus() {
  if (!hasNativeSettings()) return null;
  const r = await boxed(NS.getStatus(), 4000);
  if (!r.ok || !r.v) return null;
  return { enabled: r.v.enabled !== false, channelExists: !!r.v.channelExists, channelBlocked: !!r.v.channelBlocked };
}

// Opens this app's notification settings ("channel" → just the Alertes / Alerts channel).
// Returns what was opened ('app_notifications' | 'channel' | 'app_details') or null.
export async function openNotificationSettings(target = "app") {
  if (!hasNativeSettings()) return null;
  const r = await boxed(NS.openSettings({ target }), 4000);
  return r.ok && r.v ? r.v.opened || null : null;
}
