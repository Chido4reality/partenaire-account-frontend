// MP-LANGUAGE-PERSIST — the one way to change language.
//
// THE BUG: the app had FIVE language toggles and only ONE of them (the desktop sidebar in
// Layout.jsx) ever told the server. Settings' "Switch to Français", the mobile NavDrawer,
// Login and Register all called the bare store setter, which writes localStorage and
// nothing else. So the toggles were lying: the display changed, the saved preference
// didn't, and push notifications — which read pa_users.language — kept arriving in the
// old language with no way for the user to fix it. 100% of Nigerian users were on 'fr'.
//
// Everything that changes language now goes through here, so a toggle cannot be added in
// future that forgets to persist.
import api from "./api";
import { useLangStore } from "../store";

// Set when a PATCH fails (offline, dead link). Held so the choice is not silently lost:
// the next login replays it instead of letting server hydration overwrite the user's
// actual, deliberate choice. Without this an offline toggle would appear to work and then
// quietly revert on the next sign-in.
const PENDING_KEY = "mp-lang-pending";
// One-time marker for the upgrade from the pre-fix builds. See syncLanguageOnLogin.
const ADOPTED_KEY = "mp-lang-adopted";
// The zustand persist key for the language store — read directly to tell a FRESH INSTALL
// (key absent) from an existing one (key present). That distinction is the whole of the
// no-surprise-flip rule below.
const STORE_KEY = "mp-lang";

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

const isLang = (v) => v === "en" || v === "fr";

// Change the language: UI first (instant, never blocked on the network), server second.
// Call this from EVERY authenticated toggle.
export async function setLanguage(lang) {
  if (!isLang(lang)) return false;
  useLangStore.getState().setLang(lang);   // UI updates immediately
  try {
    await api.patch("/auth/language", { language: lang });
    write(PENDING_KEY, null);              // server agrees; nothing outstanding
    return true;
  } catch {
    // Offline or the request failed. Keep the UI on the user's choice and remember to
    // push it up at the next opportunity — a language toggle is not worth a toast.
    write(PENDING_KEY, lang);
    return false;
  }
}

// Pre-auth toggles (Login / Register) have no session to PATCH with, so they set the store
// and record the choice as pending. syncLanguageOnLogin flushes it the moment the user
// signs in — "I picked English on the login screen" survives into the account.
export function setLanguageLocalPending(lang) {
  if (!isLang(lang)) return;
  useLangStore.getState().setLang(lang);
  write(PENDING_KEY, lang);
}

// Called once, right after authentication, with the server's stored value.
//
// RESOLVING A DISAGREEMENT between the local setting and the saved row — the three cases,
// in priority order:
//
// 1. PENDING — the user explicitly toggled and the server hasn't got it yet (offline, or
//    they toggled on the login screen). Their deliberate, most recent action wins: push it
//    up and keep it. An explicit choice must never lose to a stale row.
//
// 2. UPGRADING FROM A PRE-FIX BUILD — the store key exists (so this is not a fresh
//    install) but we have never adopted on this device. These users have been looking at a
//    UI in one language while their row says another, purely because four of five toggles
//    didn't persist. Hydrating from the server here is exactly the "surprise flip" to
//    avoid: someone reading an English UI would have it turn French on login through no
//    action of their own. So we do the opposite — we treat WHAT THEY SEE as what they
//    MEAN, and push the local value up to the server. Nothing visibly changes, and the row
//    silently becomes correct. This is also why no backfill is needed: every affected user
//    self-corrects on their next login, including the Nigerian users on English UIs.
//
// 3. NORMAL / FRESH INSTALL — no pending choice, already adopted (or no local state at
//    all, i.e. a reinstall). The server is the source of truth, so hydrate from it. This is
//    what makes a saved language survive a reinstall.
//
// After this runs once per device, the toggles keep the server authoritative, so case 1 is
// rare and case 2 never happens again.
export async function syncLanguageOnLogin(serverLanguage) {
  const store = useLangStore.getState();
  const pending = read(PENDING_KEY);
  const hadLocalState = read(STORE_KEY) != null;
  const adopted = read(ADOPTED_KEY) === "1";

  // 1. An explicit choice the server hasn't seen.
  if (isLang(pending)) {
    store.setLang(pending);
    try {
      await api.patch("/auth/language", { language: pending });
      write(PENDING_KEY, null);
    } catch { /* still offline — stays pending, retried next login */ }
    write(ADOPTED_KEY, "1");
    return pending;
  }

  // 2. First login on a device carried over from a pre-fix build.
  if (!adopted && hadLocalState) {
    write(ADOPTED_KEY, "1");
    const local = store.lang;
    if (isLang(local) && local !== serverLanguage) {
      try { await api.patch("/auth/language", { language: local }); }
      catch { write(PENDING_KEY, local); }
    }
    return local;   // UI unchanged — no flip
  }

  // 3. Server wins.
  write(ADOPTED_KEY, "1");
  if (isLang(serverLanguage) && serverLanguage !== store.lang) store.setLang(serverLanguage);
  return isLang(serverLanguage) ? serverLanguage : store.lang;
}
