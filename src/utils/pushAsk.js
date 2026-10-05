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
//
// Everything here is JS bundled INTO the APK (no server.url, no live update): none of it
// reaches a phone until a new APK (vc114+) ships.
import { canUsePush, readPushPermission, askAndRegister, ensureRegisteredOnLogin, getStoredToken } from "./push";
import { readAsk, writeAsk, localDay } from "./pushAskStore";

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
  if (receive === "granted") return { state: "active" };
  if (receive === "prompt-with-rationale") return { state: "refused_once" };
  if (receive === "denied") return { state: "blocked", maybeNotBlocked: (store.dialogsOpened || 0) <= 1 };
  if (receive === "prompt") return store.everGranted ? { state: "blocked", switchedOff: true } : { state: "not_asked" };
  return { state: "unknown" };
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
    (moment === "dashboard_day2" && isOwner && !firstSessionToday && !!store.firstSeenDay && store.firstSeenDay !== localDay(new Date(now)));
  if (!allowed) return { show: false, ...c, reason: "moment" };

  const variant =
    c.state === "blocked" ? "blocked" :
    c.state === "refused_once" ? "refused_once" :
    moment === "request_sent" ? "staff_request" :
    isOwner ? "owner" : "manager";
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

// Record the first day this phone ran the app (the day-2 fallback's clock).
export async function noteAppStart() {
  const s = await readAsk();
  if (!s.firstSeenDay) { sessionSetFirstDay = true; await writeAsk({ firstSeenDay: localDay() }); }
}

export async function evaluateMoment(moment, role) {
  if (!canUsePush() || shownThisSession) return { show: false };
  const [receive, store] = await Promise.all([readPushPermission(), readAsk()]);
  if (receive === "granted" && !store.everGranted) await writeAsk({ everGranted: true });
  const d = decideAsk({ moment, role, receive, store, firstSessionToday: sessionSetFirstDay });
  if (d.show) shownThisSession = true;
  return d;
}

// "Plus tard" / "Non merci" — climbs the ladder. Opens NOTHING on Android.
export async function putOff(now = Date.now()) {
  const s = await readAsk();
  const dismissals = (s.dismissals || 0) + 1;
  return writeAsk({ dismissals, nextAt: now + ladderDays(dismissals) * DAY_MS });
}

// "Oui, me prévenir" / "Réessayer" / "Autoriser maintenant" — the only path to Android's dialog.
// A refusal in the dialog is a put-off too: the next ask waits for the ladder.
export async function sayYes() {
  const outcome = await askAndRegister();
  if (outcome === "granted") await writeAsk({ everGranted: true });
  else if (outcome === "not_granted") await putOff();
  return outcome;
}

// "J'ai activé — vérifier": re-read; if now granted, register silently. Opens nothing.
export async function recheck() {
  const receive = await readPushPermission();
  if (receive === "granted") {
    await writeAsk({ everGranted: true });
    if (!getStoredToken()) await ensureRegisteredOnLogin();
  }
  return { receive, store: await readAsk() };
}

// For the guards.
export function __resetSession() { shownThisSession = false; sessionSetFirstDay = false; }
