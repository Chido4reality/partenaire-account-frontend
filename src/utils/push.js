// MP-PUSH — client side of lock-screen notifications.
//
// NATIVE ONLY. @capacitor/push-notifications has no web implementation, and the web app
// deliberately runs its own service worker; every function here no-ops off-device so the
// browser build is untouched.
//
// ───────────────────────────────────────────────────────────────────────────────────────
// THERE IS ONE REGISTRATION ROUTINE IN THIS FILE, AND IT IS THE DIAGNOSE SEQUENCE.
//
// The `diagnosePush()` button (vc93) registered a real token 5/5 on the handset where
// login registered 0/5. Every build from vc99 to vc102 tried to fix login by writing a
// path that ALMOST matched Diagnose — listener-first, module-var capture, armed waiters —
// and each one still differed from it somewhere, so each one still failed. That is three
// builds spent maintaining two implementations of the same thing and debugging the one
// that doesn't work.
//
// So the parallel implementation is gone. `registerDeviceToken()` below is Diagnose's
// exact sequence, in Diagnose's exact order, with Diagnose's timeouts. Login calls it.
// The Settings Retry button calls it. Nothing else registers. If it ever breaks again it
// breaks for both, which is the point — one path cannot silently diverge from itself.
//
// What Diagnose did that the login path did not (any one of these is enough to lose the
// token, and vc102 had all four):
//   1. It TIME-BOXED THE PLUGIN IMPORT (8s). vc102 awaited a shared, un-time-boxed import
//      promise; if that never settled, every caller awaited it forever — which is exactly
//      how a card can still read "Trying…" long after every timeout inside it has passed.
//   2. It added the `registration` listener FRESH, immediately before register(), every
//      single time. vc102 bound listeners once per app start, minutes earlier.
//   3. It POLLED a local variable for the token (20 × 500ms) instead of relying on a
//      waiter being armed at the right instant. A poll cannot be raced.
//   4. It POSTed the token inline in the same function, not from inside a listener
//      callback whose result then has to be plumbed back to the caller.
//
// PERMISSION POLICY (Android 13+): we do NOT ask at first launch. A cold prompt with no
// context gets denied, and on Android a denial is effectively permanent — the OS blocks
// re-prompting, so the only way back is System Settings. We ask at the first moment the
// value is obvious (login), and a dismissed prompt costs nothing — we simply ask again.
import api from "./api";

const ASKED_KEY = "mp-push-asked";       // the OS prompt got a definitive answer once
const TOKEN_KEY = "mp-push-token";       // last token we registered, for logout revoke
const LAST_KEY  = "mp-push-last";        // outcome of the last registration attempt

const isNative = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

const readAsked = () => { try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; } };
const markAsked = () => { try { localStorage.setItem(ASKED_KEY, "1"); } catch { /* private mode */ } };
export const getStoredToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const storeToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

// Diagnose's helper, unchanged. Every native bridge call goes through it.
//
// A `try/catch` around `await P.someNativeCall()` protects against a REJECTION. It does
// nothing about a promise that never settles — and an unsettled bridge promise is what
// produced every hang this feature has had. Nothing in the registration path is awaited
// without a ceiling, INCLUDING the dynamic import.
const withTimeout = (p, ms, label) => Promise.race([
  Promise.resolve(p).then((v) => ({ ok: true, value: v })).catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
  new Promise((r) => setTimeout(() => r({ ok: false, error: `TIMED OUT after ${ms}ms`, timedOut: true, label }), ms)),
]);

// Record what an attempt actually hit, so a silent failure can be READ rather than guessed
// at. localStorage (surfaced on the Settings card) + logcat. Deliberately not a server
// round-trip: the diagnostics table and endpoint were removed and this needs no schema.
function rec(outcome, detail) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({
      outcome, detail: detail ?? null, at: new Date().toISOString(),
    }));
  } catch { /* private mode */ }
  try { console.warn("[push] registration:", outcome, detail ?? ""); } catch { /* ignore */ }
  return outcome;
}

// What the last attempt hit. Read by the Settings card.
export function lastRegistrationOutcome() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch { return null; }
}

// ── TAP HANDLING ────────────────────────────────────────────────────────────────────────
// Bound once and separately from registration, because it is a different lifetime: a tap
// can arrive at any point in the app's life, whereas a `registration` listener only needs
// to exist across the few seconds of an actual register() call. Keeping them apart is what
// lets registration re-bind fresh every time without disturbing tap routing.
let tapBound = false;
let tapHandler = null;
async function bindTapListener(P, onTap) {
  if (onTap) tapHandler = onTap;         // keep the newest router callback
  if (tapBound || !P) return;
  tapBound = true;
  try {
    P.addListener("pushNotificationActionPerformed", (action) => {
      try { tapHandler && tapHandler(action?.notification?.data || {}); } catch { /* ignore */ }
    });
  } catch { /* a tap listener that won't bind must never block registration */ }
}

// ── THE ONE REGISTRATION ROUTINE ────────────────────────────────────────────────────────
// Diagnose's sequence verbatim, minus the /devices/diag upload (endpoint is gone).
//
// Returns { outcome, detail } where outcome is one of:
//   granted | blocked | no_token | server_rejected | register_failed | unavailable | skipped
async function registerDeviceToken({ onTap, force = false } = {}) {
  const steps = [];
  const add = (name, result) => { steps.push({ name, ...result }); return result; };

  if (!isNative()) return { outcome: "unavailable", detail: "not a native build" };

  // 1. IMPORT — time-boxed.
  //
  // NEVER RESOLVE A PROMISE WITH A CAPACITOR PLUGIN OBJECT. This one line is the whole
  // bug, in every build from vc99 to vc104.
  //
  // A Capacitor plugin is a Proxy: ANY property read on it becomes a native method call,
  // including `.then`. So JS classifies it as a thenable, and any promise resolved with it
  // tries to unwrap it by calling `PushNotifications.then(resolve, reject)` — which is not
  // implemented on Android. The error is swallowed as an unhandled rejection and the
  // promise NEVER SETTLES. Two ways we hit it:
  //     import(...).then((mod) => mod.PushNotifications)   // vc103/104 — returned from .then
  //     async getPlugin() { ...; return plugin }           // vc102 — returned from async fn
  // Both look completely ordinary. Both hang forever. vc102 had no ceiling on it, so the
  // Settings card sat on "Trying…"; vc103/104 boxed it at 8s and misreported the hang as
  // "the plugin took too long to load", sending us after a cold-start contention problem
  // that did not exist — logcat showed the import starting 1.2s after boot.
  //
  // diagnosePush() never tripped it: it returned Object.keys(mod) (a plain array) across
  // the promise boundary and then took the proxy by DIRECT ASSIGNMENT. That, and nothing
  // about its step order, is why it registered 5/5 while login registered 0/5.
  //
  // So: the proxy is captured by closure and only a boolean crosses the boundary.
  let P = null;
  const imp = add("import", await withTimeout((async () => {
    const mod = await import("@capacitor/push-notifications");
    P = mod.PushNotifications;   // direct assignment — never returned, never awaited
    return !!P;                  // a plain boolean is safe to resolve with
  })(), 8000, "import"));
  if (!imp.ok || !P) {
    return { outcome: "unavailable", detail: imp.timedOut ? "the push plugin took too long to load" : "the push plugin did not load" };
  }

  bindTapListener(P, onTap);   // fire-and-forget; never awaited, never blocks the sequence

  // 2. CHANNEL. The server sends android.notification.channelId = 'mp_alerts'. On Android
  //    8+ a message aimed at a channel that doesn't exist is DROPPED silently, so it must
  //    exist before anything is sent. importance 4 = HIGH: heads-up + sound, which is the
  //    whole point of a lock-screen alert.
  add("createChannel", await withTimeout(P.createChannel({
    id: "mp_alerts",
    name: "Alertes / Alerts",
    description: "Approbations, actions à risque, résumé du jour",
    importance: 4,
    visibility: 1,   // public — readable on the lock screen
    sound: "default",
    vibration: true,
  }), 8000, "createChannel"));

  // 3. CHECK PERMISSIONS.
  const chk = add("checkPermissions", await withTimeout(P.checkPermissions(), 8000, "checkPermissions"));
  let receive = chk.ok ? (chk.value && chk.value.receive) : null;

  // 'denied' → the OS will not show the dialog again. Nothing we call can change that;
  // only System Settings can. Bail before register() so we don't burn 10s for nothing.
  if (receive === "denied") {
    trace(steps, "blocked");
    return { outcome: "blocked", detail: "Android reports notifications DENIED for this app — only phone settings can change it" };
  }

  // 4. REQUEST PERMISSIONS. Diagnose called this UNCONDITIONALLY, including when
  //    permission was already granted, and that is the version that worked — on Android an
  //    already-granted requestPermissions() returns immediately without showing a dialog,
  //    so it costs nothing and it keeps this path identical to the proven one. The one
  //    guard kept is the anti-nag rule: skip the automatic ask if a previous prompt was
  //    definitively answered and the user did not explicitly press Retry.
  if (receive !== "granted") {
    if (readAsked() && !force) { trace(steps, "skipped"); return { outcome: "skipped", detail: "already asked once" }; }
  }
  const req = add("requestPermissions", await withTimeout(P.requestPermissions(), 20000, "requestPermissions"));
  if (req.ok && req.value && req.value.receive) receive = req.value.receive;

  // Mark asked ONLY on a definitive answer. A prompt the user SWIPED AWAY leaves
  // permission at 'prompt' — neither granted nor denied — and must not burn the ask.
  if (receive === "granted" || receive === "denied") markAsked();
  if (receive !== "granted") {
    trace(steps, `not_granted:${receive}`);
    return { outcome: receive === "denied" ? "blocked" : "denied", detail: `permission is '${receive}'` };
  }

  // 5. LISTEN, FRESH, IMMEDIATELY BEFORE register(). Not once per app start — every time,
  //    a beat before the call that triggers the event. Local variables, no module state,
  //    nothing to arm at the right instant and nothing to race.
  //    Deliberately NOT awaited: Diagnose didn't await it either, and the whole point of
  //    this rewrite is to stop introducing differences from the path that works.
  let gotToken = null, gotError = null;
  let hReg = null, hErr = null;
  try {
    hReg = P.addListener("registration", (t) => { gotToken = (t && t.value) || null; });
    hErr = P.addListener("registrationError", (e) => { gotError = String((e && e.error) || JSON.stringify(e)); });
  } catch (e) {
    add("addListener", { ok: false, error: String(e && e.message) });
  }

  try {
    // 6. REGISTER.
    const reg = add("register", await withTimeout(P.register(), 10000, "register"));
    if (!reg.ok) {
      trace(steps, "register_failed");
      return { outcome: "register_failed", detail: reg.timedOut ? "register() timed out" : "register() was rejected by the phone" };
    }

    // 7. POLL for the token. register() resolves as soon as registration is REQUESTED —
    //    the token arrives later on the event. A poll on a local variable cannot miss it,
    //    however fast or slow it lands, which is the entire reason this works and the
    //    armed-waiter versions did not.
    for (let i = 0; i < 20 && !gotToken && !gotError; i++) await new Promise((r) => setTimeout(r, 500));
    add("registration event", { ok: !!gotToken, value: gotToken ? `token len=${gotToken.length}` : null, error: gotError });

    if (!gotToken) {
      trace(steps, gotError ? "registration_error" : "no_token");
      return gotError
        ? { outcome: "no_token", detail: `the phone reported a registration error: ${gotError}` }
        : { outcome: "no_token", detail: "permission is granted and register() succeeded, but the phone returned no token within 10s" };
    }

    // 8. POST it, right here, from the same function that has it.
    try {
      await api.post("/devices/token", { token: gotToken, platform: "android" });
      storeToken(gotToken);
      return { outcome: "granted", detail: "token stored on the server" };
    } catch (e) {
      const detail = e?.response?.status ? `HTTP ${e.response.status}` : (e?.message || "network error");
      trace(steps, "server_rejected");
      return { outcome: "server_rejected", detail: `the phone produced a token but the server refused it: ${detail}` };
    }
  } finally {
    // Remove the two registration listeners so repeated attempts don't stack handlers.
    // AFTER the work, so it cannot affect the timing of the part that matters.
    try { Promise.resolve(hReg).then((h) => h && h.remove && h.remove()).catch(() => {}); } catch { /* ignore */ }
    try { Promise.resolve(hErr).then((h) => h && h.remove && h.remove()).catch(() => {}); } catch { /* ignore */ }
  }
}

// The step trace goes to logcat whenever registration does NOT reach a clean grant, so the
// next failure names itself instead of needing another instrumented build. Silent and
// best-effort — a diagnostic must never become the thing that breaks.
function trace(steps, outcome) {
  try { console.warn("[push] registration did not complete:", outcome, JSON.stringify(steps)); }
  catch { /* ignore */ }
}

// THE single entry point, called once per authenticated app start (Layout).
//
// Registration does not depend on the user visiting any particular screen: tying it to a
// route meant a user who never opened that screen never registered.
export async function ensureRegisteredOnLogin({ onTap } = {}) {
  if (!isNative()) return rec("unavailable", "not a native build");
  const r = await registerDeviceToken({ onTap });
  return rec(r.outcome, r.detail);
}

// The Settings Retry button. Same routine — force skips only the anti-nag guard.
//
// Returns 'granted' | 'blocked' | 'denied' | 'no_token' | 'server_rejected' |
//         'register_failed' | 'unavailable' | 'skipped'.
export async function promptIfSensible({ onTap, force = false } = {}) {
  if (!isNative()) return rec("unavailable", "not a native build");
  const r = await registerDeviceToken({ onTap, force });
  return rec(r.outcome, r.detail);
}

// TIME-BOXED. This is a plain GET, but api.js gives reads a 20s ceiling AND retries a
// timeout with backoff — so the card could sit "checking" for well over a minute (~78s
// measured) with nothing on screen explaining it. A status read is informational; it is
// never worth more than a few seconds. On timeout we return a distinguishable value rather
// than null, because "we couldn't check" and "you have no devices" must not look the same.
export async function pushStatus(ms = 8000) {
  const r = await withTimeout(api.get("/devices/status"), ms, "pushStatus");
  if (!r.ok) return { unknown: true };
  return r.value?.data?.data || null;
}

// Stop THIS handset receiving alerts. Server-side this sets pa_device_tokens.revoked_at,
// and the sender only ever selects tokens where revoked_at IS NULL — so the backend stops
// sending to this device immediately, rather than sending into the void.
//
// Used ONLY by logout — never by a UI toggle. There is no in-app on/off any more: every
// hang this feature produced lived in a native bridge call on that toggle (createChannel,
// register-after-revoke, unregister), so the toggle is gone and alerts are controlled
// where every other Android app controls them — the OS notification settings. What remains
// is the security case: a shared or handed-over phone must stop receiving the previous
// user's approvals, and that is a pure server-side revoke.
async function disableOnThisDevice() {
  const token = getStoredToken();
  let ok = false;
  try {
    let revoked = 0;
    if (token) {
      const r = await api.delete("/devices/token", { data: { token } });
      revoked = r?.data?.revoked ?? 0;
    }
    // FCM rotates tokens silently, so the stored copy can be stale and match nothing.
    // Turning alerts off must never be a no-op that reports success — fall back to
    // retiring every live device for this user, which is what "off" means anyway.
    if (revoked === 0) {
      const r2 = await api.delete("/devices/token", { data: { all: true } });
      revoked = r2?.data?.revoked ?? 0;
    }
    ok = revoked > 0 || !token;
  } catch (e) {
    console.warn("[push] revoke failed:", e && e.message);
  }
  // Clear locally regardless: if the call failed we must not keep claiming this device is
  // registered. The next successful registration re-creates the row.
  storeToken(null);
  // Deliberately NO P.unregister(). Added in vc97 and the OFF path started hanging in the
  // same build; FCM does not expect apps to register/unregister repeatedly, and we no
  // longer need it — the server simply stops selecting a revoked token.
  return ok;
}

// Logout: a shared or handed-over phone must not keep buzzing with the previous user's
// approvals.
export async function revokeOnLogout() {
  await disableOnThisDevice();
}

export function canUsePush() { return isNative(); }
