// MP-ONBOARDING-DB-FLAG — the first-run guide is gated by the AUTHORITATIVE
// server flag pa_users.has_seen_onboarding (returned on login + /auth/me, in the
// auth-store user). The device Capacitor Preferences set is a SECONDARY cache
// (belt-and-suspenders) so a session whose server write failed still doesn't
// re-show. The DB flag always wins: if the DB says seen, never show.
//
// Root cause of the "shows every login" bug it replaces: the old scheme was
// device-only, and its best-effort Preferences write / user-id-keyed set was
// never authoritative — and crucially has_seen_onboarding never even reached the
// client (login omitted it; the /auth/me refresh only patched name/role), so the
// gate had no durable source of truth. The server flag fixes that.

import { Preferences } from "@capacitor/preferences";
import api from "./api";
import { useAuthStore } from "../store";

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

// Device-cache read (secondary): has THIS user been marked seen on THIS device?
export async function hasSeenOnboardingLocally(userId) {
  if (!userId) return true;
  const ids = await readSeenIds();
  return ids.includes(String(userId));
}

async function markSeenLocally(userId) {
  if (!userId) return;
  const id = String(userId);
  const ids = await readSeenIds();
  if (!ids.includes(id)) ids.push(id);
  const json = JSON.stringify(ids);
  try { await Preferences.set({ key: KEY, value: json }); } catch { /* best-effort */ }
  try { localStorage.setItem(KEY, json); } catch { /* best-effort */ }
}

// Authoritative mark: flip the SERVER flag (awaited), update the in-memory auth
// user so the trigger can't re-fire this session, and cache locally as a
// fallback. Called on the guide's finish/skip.
export async function markOnboardingSeen(userId) {
  let serverOk = false;
  try { await api.post("/auth/onboarding-seen"); serverOk = true; }
  catch (e) { /* offline/transient — the local cache + in-memory flag still hold */ }
  try { useAuthStore.getState().patchUser({ has_seen_onboarding: true }); } catch { /* ignore */ }
  await markSeenLocally(userId);
  try { console.info("[onboarding] marked seen", { userId: String(userId), serverOk }); } catch { /* ignore */ }
}

// Best-effort reconcile: DB says false but this device already showed it (a prior
// server write failed) — retry the server write so the flag eventually flips.
export function reconcileOnboardingSeen() {
  try { api.post("/auth/onboarding-seen").catch(() => {}); } catch { /* ignore */ }
  try { useAuthStore.getState().patchUser({ has_seen_onboarding: true }); } catch { /* ignore */ }
}
