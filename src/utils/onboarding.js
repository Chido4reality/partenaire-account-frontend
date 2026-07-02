// MP-ONBOARDING-FIRST-RUN — "show the first-run guide once PER USER, PER DEVICE".
//
// Stored as a SET of user ids (not a single boolean): a shared shop phone has
// many staff logging into the same device, and a per-device flag would let the
// first user to log in suppress the guide for everyone else. Persisted via
// Capacitor Preferences (works on native AND web — the web layer is backed by
// localStorage) with a localStorage mirror as a belt-and-suspenders fallback.

import { Preferences } from "@capacitor/preferences";

const KEY = "mp_onboarding_seen_user_ids";

async function readSeenIds() {
  let raw = null;
  try { raw = (await Preferences.get({ key: KEY })).value; } catch { /* fall through */ }
  if (raw == null) { try { raw = localStorage.getItem(KEY); } catch { /* ignore */ } }
  try {
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

// Has THIS user already completed/skipped the guide on THIS device?
// Returns true (suppress) when there's no user id, so a logged-out state never
// pops the guide.
export async function hasSeenOnboarding(userId) {
  if (!userId) return true;
  const ids = await readSeenIds();
  return ids.includes(String(userId));
}

// Record that THIS user has seen the guide (idempotent). Writes to both
// Preferences and localStorage so a later read hits either store.
export async function markOnboardingSeen(userId) {
  if (!userId) return;
  const id = String(userId);
  const ids = await readSeenIds();
  if (!ids.includes(id)) ids.push(id);
  const json = JSON.stringify(ids);
  try { await Preferences.set({ key: KEY, value: json }); } catch { /* best-effort */ }
  try { localStorage.setItem(KEY, json); } catch { /* best-effort */ }
}
