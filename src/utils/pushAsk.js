// MP-PUSH-ASK — WHEN to ask for notification permission, and what this phone's state really is.
//
// WHY THIS EXISTS. Android shows its permission dialog at most TWICE per install: the first
// refusal can be recovered, the second blocks it for good and only the phone's Settings can
// undo it. The app used to open that bare dialog at login, while the dashboard loaded, with
// no explanation — so every cold dialog spent one of two lives. Now our own card explains
// first, and Android's dialog opens ONLY when the user taps yes. "Plus tard" never touches
// Android, so it costs nothing and can repeat (the ladder below).
//
// ASK-MOMENTS (approved 2026-10-05) — the moment only decides WHERE the card appears once the
// ladder allows it; it never skips the wait:
//   approvals       owner opens Approvals (/accountant-log); owner/manager opens /team-approvals
//   bell_request    a staff approval request lands in the bell while the app is open (owner/manager)
//   request_sent    a staffer's action came back "held for approval" (api.js interceptor)
//   dashboard_day2  owner on the dashboard, from the SECOND day of use, never the first session
//   app_update      (vc114, Peter's call) the FIRST app start of a new build on a phone that
//                   STARTED SIGNED IN — any role. The four moments above exist for strangers
//                   who don't trust the app yet; people who already use it daily (Paul and his
//                   staff) can simply be asked when the update lands. A phone that started
//                   signed OUT (a new signup, or someone who logged in fresh) consumes the
//                   build silently and keeps the contextual path. Still our card first, never
//                   Android's bare dialog; "Plus tard" still enters the ladder.
//
// Everything here is JS bundled INTO the APK (no server.url, no live update): none of it
// reaches a phone until a new APK (vc114+) ships.
import { canUsePush, readPushPermission, askAndRegister, ensureRegisteredOnLogin, getStoredToken } from "./push";
import { readAsk, writeAsk, localDay } from "./pushAskStore";
import { readNativeAlertStatus } from "./notifSettings";

// Did this app run START already signed in? Read once, when this module loads at app start
// (Layout imports it statically), before any login in this run could write the token.
const STARTED_SIGNED_IN = (() => {
  try { return !!JSON.parse(localStorage.getItem("mp-auth") || "null")?.state?.token; } catch { return false; }
})();

export const MOMENT_EVENT = "mp-push-moment";
export const LADDER_DAYS = [3, 7, 14, 30];
const DAY_MS = 24 * 3600 * 1000;

// After the Nth put-off: 3 days, 7, 14, then every 30.
export const ladderDays = (dismissals) => LADDER_DAYS[Math.min(Math.max(dismissals, 1), LADDER_DAYS.length) - 1];

// THIS phone's honest state from Capacitor's answer plus what we remember about this phone.
//   active        granted
//   not_asked     Android has not been asked (or the answer was a swipe-away that left 'prompt')
//   refused_once  refused once — ONE real dialog left
//   blocked       Capacitor says 'denied', or permission was granted once and is now off
//   unknown       could not read it (web build, plugin failure, timeout)
// `maybeNotBlocked`: 'denied' after we opened at most ONE dialog. A real first refusal yields
// 'prompt-with-rationale', so a 'denied' that early is most likely Capacitor's cached guess
// after a swipe-away (see push.js step 4) — Android may well still ask. Inferred from the
// Capacitor source, not observed on a phone.
export function classify(receive, store = {}) {
  if (receive === "off") return { state: "blocked", switchedOff: true, osOff: true };
  if (receive === "granted") return { state: "active" };
  if (receive === "prompt-with-rationale") return { state: "refused_once" };
  if (receive === "denied") return { state: "blocked", maybeNotBlocked: (store.dialogsOpened || 0) <= 1 };
  if (receive === "prompt") return store.everGranted ? { state: "blocked", switchedOff: true } : { state: "not_asked" };
  return { state: "unknown" };
}

// Capacitor's answer corrected by the phone's real state (vc114 native plugin). The push
// plugin says "granted" on Android 12 and below no matter what, and never looks at our
// channel — so "granted" with the app's notifications OFF, or with just the mp_alerts
// channel set to NONE, becomes 'off': classified as blocked, with the guidance and the
// open-settings button. `native` null (no plugin / unreadable) leaves the answer unchanged.
export function effectiveReceive(receive, native) {
  if (receive === "granted" && native && (native.enabled === false || native.channelBlocked)) return "off";
  return receive;
}

// Both reads, in parallel, time-boxed inside each.
export async function readPhoneState() {
  const [receive, native] = await Promise.all([readPushPermission(), readNativeAlertStatus()]);
  return { receive: effectiveReceive(receive, native), native };
}

// Which card, if any, for this moment. Pure — the guards drive it directly.
export function decideAsk({ moment, role, receive, store, now = Date.now(), firstSessionToday = false }) {
  const c = classify(receive, store);
  if (c.state === "active" || c.state === "unknown") return { show: false, ...c };
  if (now < (store.nextAt || 0)) return { show: false, ...c, reason: "cooldown" };

  const isOwner = role === "owner", isMgr = role === "manager";
  const allowed =
    (moment === "approvals" && (isOwner || isMgr)) ||
    (moment === "bell_request" && (isOwner || isMgr)) ||
    (moment === "request_sent" && !isOwner) ||
    (moment === "dashboard_day2" && isOwner && !firstSessionToday && !!store.firstSeenDay && store.firstSeenDay !== localDay(new Date(now))) ||
    moment === "app_update";
  if (!allowed) return { show: false, ...c, reason: "moment" };

  const variant =
    c.state === "blocked" ? "blocked" :
    c.state === "refused_once" ? "refused_once" :
    moment === "request_sent" ? "staff_request" :
    isOwner ? "owner" : isMgr ? "manager" : "staff";
  return { show: true, variant, ...c };
}

// The Settings badge: THIS phone, never the server's count of the user's devices (another
// phone being live says nothing about this one).
export function settingsBadge({ receive, store, storedToken }) {
  const c = classify(receive, store);
  if (c.state === "active") return { ...c, badge: storedToken ? "active" : "unregistered" };
  return { ...c, badge: c.state };
}

// One card per app session at most, however many moments fire.
let shownThisSession = false;
let sessionSetFirstDay = false;

// This build's versionCode as a string ("114"), or null off-device / unreadable.
async function appBuild() {
  try {
    const { App } = await import("@capacitor/app");
    const info = await Promise.race([App.getInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    return info && info.build ? String(info.build) : null;
  } catch { return null; }
}

// Once per authenticated app start. Records the first day this phone ran the app (the day-2
// fallback's clock) and, the first time a NEW BUILD runs on this phone, returns "app_update"
// if this run started signed in — the caller raises it as a moment. Either way the build is
// consumed, so the update ask happens at most once per build per phone.
export async function noteAppStart({ build, startedSignedIn = STARTED_SIGNED_IN } = {}) {
  const s = await readAsk();
  if (!s.firstSeenDay) { sessionSetFirstDay = true; await writeAsk({ firstSeenDay: localDay() }); }
  const b = build !== undefined ? build : await appBuild();
  if (!b || s.updateAskBuild === b) return null;
  await writeAsk({ updateAskBuild: b });
  return startedSignedIn ? "app_update" : null;
}

export async function evaluateMoment(moment, role) {
  if (!canUsePush() || shownThisSession) return { show: false };
  const [{ receive, native }, store] = await Promise.all([readPhoneState(), readAsk()]);
  if (receive === "granted" && !store.everGranted) await writeAsk({ everGranted: true });
  const d = decideAsk({ moment, role, receive, store, firstSessionToday: sessionSetFirstDay });
  if (d.show) shownThisSession = true;
  return { ...d, channelBlocked: !!(native && native.channelBlocked) };
}

// "Plus tard" / "Non merci" — climbs the ladder. Opens NOTHING on Android.
export async function putOff(now = Date.now()) {
  const s = await readAsk();
  const dismissals = (s.dismissals || 0) + 1;
  return writeAsk({ dismissals, nextAt: now + ladderDays(dismissals) * DAY_MS });
}

// "Oui, me prévenir" / "Réessayer" / "Autoriser maintenant" — the only path to Android's dialog.
// A refusal in the dialog is a put-off too: the next ask waits for the ladder.
// Returns askAndRegister's outcome, or 'os_off' when permission is granted but the phone's
// notifications (or just our channel) are switched off — "Alertes activées" would be a lie then.
export async function sayYes() {
  const outcome = await askAndRegister();
  if (outcome === "granted") {
    await writeAsk({ everGranted: true });
    if (effectiveReceive("granted", await readNativeAlertStatus()) === "off") return "os_off";
  } else if (outcome === "not_granted") await putOff();
  return outcome;
}

// "J'ai activé — vérifier": re-read (permission AND the phone's real state); if now on,
// register silently. Opens nothing.
export async function recheck() {
  const { receive } = await readPhoneState();
  if (receive === "granted") {
    await writeAsk({ everGranted: true });
    if (!getStoredToken()) await ensureRegisteredOnLogin();
  }
  return { receive, store: await readAsk() };
}

// For the guards.
export function __resetSession() { shownThisSession = false; sessionSetFirstDay = false; }
