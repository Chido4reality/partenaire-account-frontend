// MP-PUSH-ASK — the per-PHONE memory of how we have asked for notification permission.
//
// Kept in Capacitor Preferences (Android SharedPreferences), NOT localStorage: logout runs
// localStorage.clear() (authReset.js), and both things stored here must survive a logout —
// the "Plus tard" ladder (or a user who logs out daily is asked daily) and the count of
// Android dialogs actually opened (Android allows TWO real ones, per phone, whoever is
// logged in).
//
//   dismissals     how many times the ask was put off ("Plus tard", or a refusal in the dialog)
//   nextAt         epoch ms before which no ask card is shown
//   dialogsOpened  how many times we called requestPermissions while NOT granted
//   everGranted    this phone has been granted at least once (so "prompt" now = switched off)
//   firstSeenDay   local YYYY-MM-DD of the first app start we recorded (day-2 fallback)
import { Preferences } from "@capacitor/preferences";

const KEY = "mp-push-ask-v1";
const DEFAULTS = { dismissals: 0, nextAt: 0, dialogsOpened: 0, everGranted: false, firstSeenDay: null };

// A Preferences call is a native bridge call; nothing here may hang the UI behind it.
const ceiling = (p, ms = 3000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function readAsk() {
  try {
    const { value } = await ceiling(Preferences.get({ key: KEY }));
    return { ...DEFAULTS, ...(value ? JSON.parse(value) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeAsk(patch) {
  const next = { ...(await readAsk()), ...patch };
  try { await ceiling(Preferences.set({ key: KEY, value: JSON.stringify(next) })); } catch { /* best-effort */ }
  return next;
}

// Called immediately before requestPermissions() on a phone that is NOT granted.
export async function noteDialogOpened() {
  const cur = await readAsk();
  return writeAsk({ dialogsOpened: (cur.dialogsOpened || 0) + 1 });
}

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
