// MP-PUSH — client side of lock-screen notifications.
//
// NATIVE ONLY. @capacitor/push-notifications has no web implementation, and the web app
// deliberately runs its own service worker; every function here no-ops off-device so the
// browser build is untouched.
//
// PERMISSION POLICY (Android 13+): we do NOT ask at first launch. A cold prompt with no
// context gets denied, and on Android a denial is effectively permanent — the OS blocks
// re-prompting, so the only way back is System Settings. We ask ONCE, at the first moment
// the value is obvious (see promptIfSensible), and never nag again.
import api from "./api";

const ASKED_KEY = "mp-push-asked";       // we have shown the OS prompt once
const TOKEN_KEY = "mp-push-token";       // last token we registered, for logout revoke

const isNative = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

let plugin = null;
async function getPlugin() {
  if (!isNative()) return null;
  if (plugin) return plugin;
  try {
    const mod = await import("@capacitor/push-notifications");
    plugin = mod.PushNotifications;
    return plugin;
  } catch { return null; }
}

const readAsked = () => { try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; } };
const markAsked = () => { try { localStorage.setItem(ASKED_KEY, "1"); } catch { /* private mode */ } };
export const getStoredToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const storeToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

// Wire the listeners ONCE per app start. `registration` fires on first grant AND whenever
// FCM silently rotates the token, so this is also the refresh path — we just re-POST.
let listenersBound = false;
async function bindListeners(onTap) {
  const P = await getPlugin();
  if (!P || listenersBound) return;
  listenersBound = true;

  // The server sends android.notification.channelId = 'mp_alerts'. On Android 8+ a
  // message aimed at a channel that doesn't exist is DROPPED silently, so create it
  // before registering. importance 4 = HIGH: heads-up + sound, which is the whole point
  // of a lock-screen alert.
  try {
    await P.createChannel({
      id: "mp_alerts",
      name: "Alertes / Alerts",
      description: "Approbations, actions à risque, résumé du jour",
      importance: 4,
      visibility: 1,   // public — readable on the lock screen
      sound: "default",
      vibration: true,
    });
  } catch { /* older Android or already exists */ }

  P.addListener("registration", async (t) => {
    const token = t && t.value;
    if (!token) return;
    try {
      await api.post("/devices/token", { token, platform: "android" });
      storeToken(token);
    } catch { /* offline — the next app start re-registers */ }
  });

  P.addListener("registrationError", (e) => {
    // Almost always a missing/mismatched google-services.json. Never surface to the user.
    console.warn("[push] registration failed:", e && e.error);
  });

  // Tapped from the lock screen / tray while the app was backgrounded or killed.
  P.addListener("pushNotificationActionPerformed", (action) => {
    try { onTap && onTap(action?.notification?.data || {}); } catch { /* ignore */ }
  });
}

// Ask only when the user has just done something that makes alerts obviously useful.
// Returns 'granted' | 'denied' | 'skipped' | 'unavailable'.
export async function promptIfSensible({ onTap } = {}) {
  const P = await getPlugin();
  if (!P) return "unavailable";
  await bindListeners(onTap);
  try {
    let perm = await P.checkPermissions();
    if (perm.receive === "granted") { await P.register(); return "granted"; }
    // 'denied' → the OS will not show the dialog again; asking would be a no-op that
    // burns our one chance to look responsive. Settings deep-link is the only route.
    if (perm.receive === "denied") return "denied";
    if (readAsked()) return "skipped";
    markAsked();
    perm = await P.requestPermissions();
    if (perm.receive === "granted") { await P.register(); return "granted"; }
    return "denied";
  } catch (e) {
    console.warn("[push] permission flow failed:", e && e.message);
    return "unavailable";
  }
}

// Called at app start for an already-granted user: re-register so a rotated token is
// refreshed. Never prompts.
export async function refreshIfGranted({ onTap } = {}) {
  const P = await getPlugin();
  if (!P) return false;
  await bindListeners(onTap);
  try {
    const perm = await P.checkPermissions();
    if (perm.receive !== "granted") return false;
    await P.register();
    return true;
  } catch { return false; }
}

// Logout: stop this handset receiving the shop's alerts. A shared or handed-over phone
// must not keep buzzing with the previous user's approvals.
export async function revokeOnLogout() {
  const token = getStoredToken();
  if (!token) return;
  try { await api.delete("/devices/token", { data: { token } }); } catch { /* best-effort */ }
  storeToken(null);
}

export async function pushStatus() {
  try { return (await api.get("/devices/status")).data?.data || null; } catch { return null; }
}

export function canUsePush() { return isNative(); }
