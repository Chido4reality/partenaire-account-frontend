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
// Resolved by the `registration` handler once the token has actually been stored, so
// callers can wait for the real completion instead of guessing.
let tokenWaiters = [];

// Every native bridge call in the enable path goes through this.
//
// A `try/catch` around `await P.someNativeCall()` protects against a REJECTION. It does
// nothing about a promise that never settles — and that is what left "Turn on alerts"
// spinning forever: one stalled bridge call meant bindListeners never returned, so
// promptIfSensible never proceeded and enable() never reached its toast. Diagnose was
// immune only because it time-boxed everything. Now the real path does too: a stall
// becomes a recorded, reported failure instead of an infinite spinner.
function tb(promise, ms, label, trace) {
  const started = Date.now();
  return Promise.race([
    Promise.resolve(promise)
      .then((value) => { trace && trace.push({ name: label, ok: true, ms: Date.now() - started, value: value ?? null }); return { ok: true, value }; })
      .catch((e) => { trace && trace.push({ name: label, ok: false, ms: Date.now() - started, error: String((e && e.message) || e) }); return { ok: false, error: e }; }),
    new Promise((r) => setTimeout(() => {
      trace && trace.push({ name: label, ok: false, ms: Date.now() - started, error: `TIMED OUT after ${ms}ms` });
      r({ ok: false, timedOut: true });
    }, ms)),
  ]);
}

async function bindListeners(onTap, trace) {
  const P = await getPlugin();
  if (!P || listenersBound) return;
  listenersBound = true;

  // The server sends android.notification.channelId = 'mp_alerts'. On Android 8+ a
  // message aimed at a channel that doesn't exist is DROPPED silently, so create it
  // before registering. importance 4 = HIGH: heads-up + sound, which is the whole point
  // of a lock-screen alert.
  // Time-boxed: a stalled createChannel used to hang the whole enable path.
  await tb(P.createChannel({
    id: "mp_alerts",
    name: "Alertes / Alerts",
    description: "Approbations, actions à risque, résumé du jour",
    importance: 4,
    visibility: 1,   // public — readable on the lock screen
    sound: "default",
    vibration: true,
  }), 6000, "createChannel", trace);

  P.addListener("registration", async (t) => {
    const token = t && t.value;
    if (!token) return;
    try {
      await api.post("/devices/token", { token, platform: "android" });
      storeToken(token);
      tokenWaiters.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    } catch (e) {
      // Offline, or the backend rejected it. The next app start re-registers. Release
      // any waiter so the UI reports honestly instead of hanging on the timeout.
      console.warn("[push] token POST failed:", e && e.message);
      tokenWaiters.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    }
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
//
// `force` = the user EXPLICITLY asked (the Settings button). The once-only guard exists
// to stop the AUTOMATIC contextual ask nagging; applying it to a deliberate button press
// made that button a silent no-op once the automatic ask had already fired — which is
// exactly what it did. An explicit request must always try.
//
// Returns 'granted' | 'denied' | 'skipped' | 'unavailable'.
export async function promptIfSensible({ onTap, force = false } = {}) {
  const trace = [];
  const P = await getPlugin();
  trace.push({ name: "getPlugin", ok: !!P });
  if (!P) { await uploadTrace(trace, "no_plugin"); return "unavailable"; }

  await bindListeners(onTap, trace);

  const chk = await tb(P.checkPermissions(), 6000, "checkPermissions", trace);
  if (!chk.ok) { await uploadTrace(trace, "checkPermissions_failed"); return "unavailable"; }
  let receive = chk.value && chk.value.receive;

  if (receive !== "granted") {
    // 'denied' → the OS will not show the dialog again. Nothing we call can change that;
    // only System Settings can.
    if (receive === "denied") { await uploadTrace(trace, "denied"); return "denied"; }
    if (readAsked() && !force) return "skipped";
    markAsked();
    const req = await tb(P.requestPermissions(), 25000, "requestPermissions", trace);
    if (!req.ok) { await uploadTrace(trace, "requestPermissions_failed"); return "unavailable"; }
    receive = req.value && req.value.receive;
    if (receive !== "granted") { await uploadTrace(trace, "not_granted"); return "denied"; }
  }

  const reg = await tb(P.register(), 15000, "register", trace);
  if (!reg.ok) { await uploadTrace(trace, "register_failed"); return "unavailable"; }
  return "granted";
}

// Upload the step trace whenever the enable path does NOT reach a clean grant, so the
// next failure names itself instead of needing another instrumented build. Silent and
// best-effort — a diagnostic must never become the thing that breaks.
async function uploadTrace(trace, outcome) {
  try { await api.post("/devices/diag", { steps: [...trace, { name: "outcome", ok: false, value: outcome }] }); }
  catch { /* ignore */ }
}

// P.register() resolves as soon as registration is REQUESTED — the token arrives later on
// the `registration` event, and only then is it POSTed. Callers that re-read status
// immediately therefore saw zero devices and reported failure on a success. Await this
// between the two.
export function waitForRegistration(ms = 10000) {
  return new Promise((resolve) => {
    if (getStoredToken()) return resolve(true);
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    const timer = setTimeout(() => finish(false), ms);
    tokenWaiters.push(() => { clearTimeout(timer); finish(true); });
  });
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

// Stop THIS handset receiving alerts. Server-side this sets pa_device_tokens.revoked_at,
// and the sender only ever selects tokens where revoked_at IS NULL — so the backend stops
// sending to this device immediately, rather than sending into the void.
//
// NOTE what this deliberately does NOT do: an Android app cannot revoke its own
// notification permission. So "off" means "this device is deregistered from our push",
// not "Android permission withdrawn". That is the honest and useful meaning — the user
// wants to stop being buzzed, and re-enabling later needs no trip to system settings
// because the OS permission is still granted.
//
// Returns true when the server confirmed the revoke.
export async function disableOnThisDevice() {
  const token = getStoredToken();
  let ok = false;
  try {
    // Try the precise revoke first when we have a token.
    let revoked = 0;
    if (token) {
      const r = await api.delete("/devices/token", { data: { token } });
      revoked = r?.data?.revoked ?? 0;
    }
    // FCM rotates tokens silently, so the stored copy can be stale and match nothing.
    // Turning alerts off must never be a no-op that reports success — fall back to
    // retiring every live device for this user, which is what "turn my alerts off"
    // means anyway.
    if (revoked === 0) {
      const r2 = await api.delete("/devices/token", { data: { all: true } });
      revoked = r2?.data?.revoked ?? 0;
    }
    ok = revoked > 0 || !token; // nothing registered at all also counts as "off"
  } catch (e) {
    console.warn("[push] revoke failed:", e && e.message);
  }
  // Clear locally regardless: if the call failed we must not keep claiming this device
  // is registered. The next successful registration re-creates the row.
  storeToken(null);

  // Also drop the FCM registration itself. Revoking server-side only stops US sending;
  // the handset stays registered with Google, so a later register() can be a no-op that
  // never re-fires `registration` — leaving the enable path waiting for an event that
  // will not come. Time-boxed, best-effort: failing to unregister must not block the OFF.
  try {
    const P = await getPlugin();
    if (P && typeof P.unregister === "function") await tb(P.unregister(), 6000, "unregister", null);
  } catch { /* best-effort */ }

  return ok;
}

// Logout: same mechanism. A shared or handed-over phone must not keep buzzing with the
// previous user's approvals.
export async function revokeOnLogout() {
  await disableOnThisDevice();
}

export async function pushStatus() {
  try { return (await api.get("/devices/status")).data?.data || null; } catch { return null; }
}

export function canUsePush() { return isNative(); }

// ── TEMPORARY DIAGNOSTIC ────────────────────────────────────────────────────────
// Walks the ENTIRE registration path step by step, recording what each call actually
// returned instead of inferring it. Every step is individually try/caught and time-
// boxed, so one hanging native call cannot swallow the trace — which is the failure
// mode that would otherwise produce "nothing happens at all" with no toast.
// Remove together with /api/devices/diag once registration is understood.
const withTimeout = (p, ms, label) => Promise.race([
  Promise.resolve(p).then((v) => ({ ok: true, value: v })).catch((e) => ({ ok: false, error: String(e && e.message || e) })),
  new Promise((r) => setTimeout(() => r({ ok: false, error: `TIMED OUT after ${ms}ms`, timedOut: true, label }), ms)),
]);

export async function diagnosePush() {
  const steps = [];
  const add = (name, result) => steps.push({ name, ...result, at: new Date().toISOString() });

  add("isNativePlatform", { ok: true, value: isNative() });
  add("userAgent", { ok: true, value: (typeof navigator !== "undefined" && navigator.userAgent) || "?" });

  let P = null;
  const imp = await withTimeout((async () => {
    const mod = await import("@capacitor/push-notifications");
    return Object.keys(mod || {});
  })(), 8000, "import");
  add("import @capacitor/push-notifications", imp);
  if (imp.ok) {
    try { P = (await import("@capacitor/push-notifications")).PushNotifications; } catch (e) { /* recorded above */ }
  }
  add("plugin object present", { ok: !!P, value: P ? Object.keys(P).slice(0, 12) : null });
  if (!P) return finish(steps);

  add("createChannel", await withTimeout(P.createChannel({
    id: "mp_alerts", name: "Alertes / Alerts", importance: 4, visibility: 1, sound: "default", vibration: true,
  }), 8000, "createChannel"));

  const chk = await withTimeout(P.checkPermissions(), 8000, "checkPermissions");
  add("checkPermissions", chk);

  const req = await withTimeout(P.requestPermissions(), 20000, "requestPermissions");
  add("requestPermissions", req);

  // Listen BEFORE register so we cannot miss the event.
  let gotToken = null, gotError = null;
  try {
    P.addListener("registration", (t) => { gotToken = t && t.value; });
    P.addListener("registrationError", (e) => { gotError = JSON.stringify(e); });
  } catch (e) { add("addListener", { ok: false, error: String(e && e.message) }); }

  add("register()", await withTimeout(P.register(), 10000, "register"));

  // The token arrives on the event, not from register() — give it a real window.
  for (let i = 0; i < 20 && !gotToken && !gotError; i++) await new Promise((r) => setTimeout(r, 500));
  add("registration event", { ok: !!gotToken, value: gotToken ? `token len=${gotToken.length}` : null, error: gotError });

  if (gotToken) {
    try {
      const r = await api.post("/devices/token", { token: gotToken, platform: "android", device_label: "diag" });
      add("POST /devices/token", { ok: true, value: `HTTP ${r.status} ${JSON.stringify(r.data)}` });
    } catch (e) {
      add("POST /devices/token", { ok: false, error: `HTTP ${e?.response?.status} ${JSON.stringify(e?.response?.data || e?.message)}` });
    }
  }
  return finish(steps);
}

async function finish(steps) {
  let stored = null;
  try { stored = (await api.post("/devices/diag", { steps })).data; } catch (e) { stored = { error: String(e && e.message) }; }
  return { steps, stored };
}
