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

const ASKED_KEY = "mp-push-asked";       // the OS prompt got a definitive answer once
const TOKEN_KEY = "mp-push-token";       // last token we registered, for logout revoke
const LAST_KEY  = "mp-push-last";        // outcome of the last login registration attempt

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
//
// LISTENER-FIRST, SINGLE-FLIGHT. `listenersBound` used to be set at the TOP of
// bindListeners, before the awaited createChannel and before addListener ran. Two things
// followed: a second concurrent caller returned immediately believing the listeners were
// attached when they were not, and the first caller sat through up to 6s of createChannel
// with no `registration` handler installed. Now every caller awaits the SAME promise, and
// that promise does not resolve until the handlers are actually on.
let bindPromise = null;

// THE RESULT OF THE LAST `registration` EVENT, captured the MOMENT it fires.
//
// This is the fix for the race that cost us the login path. The sequence is:
//   register() → (later) `registration` event → POST /devices/token → done
// The waiter used to be created AFTER register() resolved. register() resolves as soon as
// registration is REQUESTED, but on a warm handset FCM can deliver the token and the POST
// can finish inside that window — draining an EMPTY waiter list. The real result then had
// nowhere to go, the waiter that arrived a moment later waited for an event that had
// already happened, and 12s later the flow recorded `no_token` on a registration that had
// in fact succeeded. The Diagnose button never hit this because it armed everything up
// front and time-boxed each step.
//
// So the outcome is now written to a module var synchronously, before any await, and a
// waiter armed afterwards still finds it. Belt and braces with the waiter list below,
// because we only get one shot per login.
let lastRegistration = null;   // { token, at, posted: "pending"|"ok"|"failed", error }
// Armed BEFORE register() is called. At most one is live at a time.
let pendingWait = null;

// Resolve whatever is waiting on a registration outcome, from either mechanism.
function settleWait(result) {
  const w = pendingWait;
  if (!w || w.done) return;
  w.done = true;
  pendingWait = null;
  clearTimeout(w.timer);
  try { w.resolve(result); } catch { /* ignore */ }
}

// Arm the waiter. MUST be called BEFORE P.register(), never after.
// Resolves { ok } | { ok:false, timedOut:true } | { ok:false, error }.
function armRegistrationWait(ms) {
  settleWait({ ok: false, superseded: true });   // never leave an older wait dangling
  // Clear the previous attempt's result so a stale success (another user's login on this
  // same handset, an earlier attempt in this process) can never be read as this one's.
  lastRegistration = null;
  return new Promise((resolve) => {
    const w = { resolve, done: false, timer: null };
    w.timer = setTimeout(() => settleWait({ ok: false, timedOut: true }), ms);
    pendingWait = w;
  });
}

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

function bindListeners(onTap, trace) {
  if (bindPromise) return bindPromise;
  bindPromise = (async () => {
    const P = await getPlugin();
    if (!P) { bindPromise = null; return; }

    // LISTENERS FIRST — before createChannel, before anything that can stall. A token
    // event arriving during a 6s channel-creation stall used to fall on the floor.
    P.addListener("registration", async (t) => {
      const token = t && t.value;
      if (!token) return;
      // Synchronous, before any await: whoever asks later can still read this.
      lastRegistration = { token, at: Date.now(), posted: "pending", error: null };
      // Waiters are told WHETHER THE POST SUCCEEDED. Both branches used to resolve them
      // identically, so a FAILED upload looked exactly like a successful one: the login
      // flow recorded "granted", the card found no device server-side and showed OFF, and
      // because "granted" has no explanation text there was no amber line either. Silent,
      // and indistinguishable from working.
      try {
        await api.post("/devices/token", { token, platform: "android" });
        storeToken(token);
        lastRegistration = { token, at: Date.now(), posted: "ok", error: null };
        settleWait({ ok: true });
      } catch (e) {
        const detail = e?.response?.status ? `HTTP ${e.response.status}` : (e?.message || "network error");
        console.warn("[push] token POST failed:", detail);
        lastRegistration = { token, at: Date.now(), posted: "failed", error: detail };
        settleWait({ ok: false, error: detail });
      }
    });

    P.addListener("registrationError", (e) => {
      // Almost always a missing/mismatched google-services.json.
      const detail = String((e && e.error) || "registrationError");
      console.warn("[push] registration failed:", detail);
      // Don't make the caller sit out the full timeout for a failure the OS already
      // reported. This is the one case where we KNOW no token is coming.
      settleWait({ ok: false, error: detail });
    });

    // Tapped from the lock screen / tray while the app was backgrounded or killed.
    P.addListener("pushNotificationActionPerformed", (action) => {
      try { onTap && onTap(action?.notification?.data || {}); } catch { /* ignore */ }
    });

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
  })();
  return bindPromise;
}

// register() + wait, in the ONLY order that is race-free: arm, then register, then await.
// Returns { ok } | { ok:false, stage:"register" } | { ok:false, timedOut } | { ok:false, error }.
async function registerAndWait(P, trace, ms = 20000) {
  const wait = armRegistrationWait(ms);
  const reg = await tb(P.register(), 15000, "register", trace);
  if (!reg.ok) {
    settleWait({ ok: false, superseded: true });
    return { ok: false, stage: "register", timedOut: !!reg.timedOut };
  }
  return await wait;
}

// Ask only when the user has just done something that makes alerts obviously useful.
//
// `force` = the user EXPLICITLY asked (the Settings button). The once-only guard exists
// to stop the AUTOMATIC contextual ask nagging; applying it to a deliberate button press
// made that button a silent no-op once the automatic ask had already fired — which is
// exactly what it did. An explicit request must always try.
//
// Returns 'granted' | 'denied' | 'skipped' | 'unavailable' | 'incomplete'.
// 'incomplete' = permission is fine and register() went through, but the token never came
// back or the server refused it. The specific reason is in lastRegistrationOutcome().
export async function promptIfSensible({ onTap, force = false } = {}) {
  const trace = [];
  const P = await getPlugin();
  trace.push({ name: "getPlugin", ok: !!P });
  if (!P) { uploadTrace(trace, "no_plugin"); return "unavailable"; }

  await bindListeners(onTap, trace);

  const chk = await tb(P.checkPermissions(), 6000, "checkPermissions", trace);
  if (!chk.ok) { uploadTrace(trace, "checkPermissions_failed"); return "unavailable"; }
  let receive = chk.value && chk.value.receive;

  if (receive !== "granted") {
    // 'denied' → the OS will not show the dialog again. Nothing we call can change that;
    // only System Settings can.
    if (receive === "denied") { uploadTrace(trace, "denied"); return "denied"; }
    if (readAsked() && !force) return "skipped";

    const req = await tb(P.requestPermissions(), 25000, "requestPermissions", trace);
    if (!req.ok) { uploadTrace(trace, "requestPermissions_failed"); return "unavailable"; }
    receive = req.value && req.value.receive;

    // Mark asked ONLY on a definitive answer. markAsked() used to run BEFORE the dialog,
    // so a prompt the user SWIPED AWAY (permission stays 'prompt', neither granted nor
    // denied) burned the single ask — and with no in-app toggle left there was then no
    // way to register at all, short of reinstalling. A dismissed prompt now costs
    // nothing: we simply ask again next login.
    if (receive === "granted" || receive === "denied") markAsked();

    if (receive !== "granted") { uploadTrace(trace, `not_granted:${receive}`); return "denied"; }
  }

  // Same race-free order as the login path, and it records the same outcome — so the
  // Retry button and the automatic login attempt can no longer disagree about what
  // happened on this handset.
  const r = await registerAndWait(P, trace);
  if (!r.ok) uploadTrace(trace, r.stage === "register" ? "register_failed" : (r.timedOut ? "no_token" : "server_rejected"));
  recordAttempt(r);
  return r.ok ? "granted" : (r.stage === "register" ? "unavailable" : "incomplete");
}

// Turn a registerAndWait result into the stored outcome the Settings card explains.
// One place, so every entry point reports the same thing.
function recordAttempt(r) {
  if (r.ok) return rec("granted", "permission granted, token stored on the server");
  if (r.stage === "register")
    return rec("register_failed", r.timedOut ? "register() timed out" : "register() rejected");
  if (r.timedOut)
    return rec("no_token", "permission granted, register() ok, but the phone returned no token in time");
  return rec("server_rejected", `the phone produced a token but the server refused it: ${r.error || "unknown"}`);
}

// Record what an attempt actually hit, so a silent failure can be READ rather than
// guessed at. Goes to localStorage (surfaced on the Settings card) and to logcat.
// Deliberately not a server round-trip: the diagnostics table and endpoint were removed,
// and this needs no schema to be useful.
function rec(outcome, detail) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({
      outcome, detail: detail ?? null, at: new Date().toISOString(),
    }));
  } catch { /* private mode */ }
  try { console.warn("[push] registration:", outcome, detail ?? ""); } catch { /* ignore */ }
  return outcome;
}

// THE single entry point, called once per authenticated app start.
//
// Registration no longer depends on the user visiting Accountant Log or any other
// screen — tying it to a route meant a user who never opened that screen never
// registered, and a user whose ask had been marked by an earlier build could never
// recover. Behaviour:
//   permission granted   → register silently, EVERY login (re-registers a rotated token,
//                          and rescues anyone whose ask was marked by an older build)
//   permission undecided → show the OS prompt once, register on Allow
//   permission denied    → do nothing; only Android's settings can undo that
export async function ensureRegisteredOnLogin({ onTap } = {}) {
  if (!isNative()) return rec("unavailable", "not a native build");
  const P = await getPlugin();
  if (!P) return rec("unavailable", "push plugin did not load");
  // Listeners are on — really on, not just flagged — before anything else happens.
  await bindListeners(onTap, null);

  const chk = await tb(P.checkPermissions(), 6000, "checkPermissions(login)", null);
  if (!chk.ok) return rec("unavailable", chk.timedOut ? "checkPermissions timed out" : "checkPermissions failed");
  const receive = chk.value ? chk.value.receive : null;

  if (receive === "granted") {
    // Silent path. No prompt, no UI, no dependence on any screen.
    // registerAndWait arms the waiter BEFORE register() — see lastRegistration above for
    // why the old order lost the token on a fast handset and reported no_token.
    return recordAttempt(await registerAndWait(P, null));
  }
  if (receive === "denied") {
    return rec("blocked", "Android reports notifications DENIED for this app — only phone settings can change it");
  }

  // Undecided: prompt once. promptIfSensible records its own outcome via recordAttempt,
  // so the only thing left to note here is the case where it never got that far.
  const r = await promptIfSensible({ onTap });
  if (r === "granted" || r === "incomplete") return r;
  return rec(r, `permission was '${receive}' before prompting`);
}

// What the last login attempt hit. Read by the Settings card.
export function lastRegistrationOutcome() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch { return null; }
}

// Upload the step trace whenever the enable path does NOT reach a clean grant, so the
// next failure names itself instead of needing another instrumented build. Silent and
// best-effort — a diagnostic must never become the thing that breaks.
function uploadTrace(trace, outcome) {
  // Was a POST to /api/devices/diag backed by a pa_push_diagnostics table, added while
  // hunting the enable hangs. Both are gone now that the toggle is gone. The step trace
  // is still worth keeping — it goes to logcat, where it costs nothing and needs no
  // schema, and is there if this path ever misbehaves again.
  try { console.warn("[push] enable did not complete:", outcome, JSON.stringify(trace)); }
  catch { /* ignore */ }
}

// What THIS process's most recent registration attempt produced. Callers that want to
// wait no longer need this — promptIfSensible and ensureRegisteredOnLogin already await
// the real completion internally — but it stays exported as a read-only check.
//
// It reads the module var, NOT localStorage. The old version short-circuited on a stored
// token, which is a lie for a fresh login: the token in localStorage may belong to the
// previous session (or the previous USER of a shared handset) and prove nothing about
// whether the server has a row for whoever just signed in.
export function waitForRegistration(ms = 10000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const check = () => {
      const r = lastRegistration;
      if (r && r.posted === "ok") return resolve({ ok: true });
      if (r && r.posted === "failed") return resolve({ ok: false, error: r.error });
      if (Date.now() >= deadline) return resolve({ ok: false, timedOut: true });
      setTimeout(check, 250);
    };
    check();
  });
}

// NOTE: refreshIfGranted() is gone. It was dead code (nothing imported it once
// ensureRegisteredOnLogin became the single entry point) and it was the last un-time-boxed
// register() left in the file — exactly the shape that produced every hang this feature
// has had. A rotated token is refreshed by the login path, which re-registers every time.

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
// Used ONLY by logout — never by a UI toggle. There is no in-app on/off any more:
// every hang this feature produced lived in a native bridge call on that toggle
// (createChannel, register-after-revoke, unregister), so the toggle is gone and alerts
// are controlled where every other Android app controls them — the OS notification
// settings. What remains here is the security case: a shared or handed-over phone must
// stop receiving the previous user's approvals, and that is a pure server-side revoke.
async function disableOnThisDevice() {
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
  // …and drop this process's registration result, so the next user to log in on this
  // handset cannot read the previous user's success as their own.
  lastRegistration = null;
  settleWait({ ok: false, superseded: true });
  // Deliberately NO P.unregister(). Added in vc97 and the OFF path started hanging in the
  // same build; FCM does not expect apps to register/unregister repeatedly, and we no
  // longer need it — the server simply stops selecting a revoked token.
  return ok;
}

// Logout: same mechanism. A shared or handed-over phone must not keep buzzing with the
// previous user's approvals.
export async function revokeOnLogout() {
  await disableOnThisDevice();
}

// TIME-BOXED. This is a plain GET, but api.js gives reads a 20s ceiling AND retries a
// timeout with backoff — so on a bad link the card could sit "checking" for well over a
// minute (we measured ~78s) with nothing on screen explaining it. A status read is
// informational; it is never worth more than a few seconds. On timeout we return a
// distinguishable value rather than null, because "we couldn't check" and "you have no
// devices" must not look the same to the user.
export async function pushStatus(ms = 8000) {
  const r = await tb(api.get("/devices/status"), ms, "pushStatus", null);
  if (!r.ok) return { unknown: true };
  return r.value?.data?.data || null;
}

export function canUsePush() { return isNative(); }
