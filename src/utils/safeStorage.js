// MP-STORAGE-QUOTA-CRASH-FIX
//
// localStorage.setItem throws QuotaExceededError once the device's ~5MB store
// fills up (big cache_* API caches + accumulated POS draft carts). That throw
// was UNGUARDED on the hot path: zustand's persist middleware saves the
// mp-pos-draft-cart store on every cart keystroke via localStorage.setItem, so
// when it overflowed the exception bubbled into React's render and the error
// boundary took down the WHOLE POS ("Failed to execute 'setItem' on 'Storage':
// mp-pos-draft-cart exceeded the quota"). The only user unblock was clearing
// app storage.
//
// A best-effort persist must DEGRADE, never crash: the cart keeps working in
// memory, we just skip the snapshot. This module centralises guarded writes and
// a zustand-compatible Storage shim so no persist write can ever crash the app.

function isQuotaError(e) {
  return !!e && (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||   // Firefox
    e.code === 22 || e.code === 1014
  );
}

// Free space by dropping the most DISPOSABLE keys first — the offline API
// response caches (cache_*). They're re-fetched on demand, so evicting them to
// make room for an important write (a draft cart, the auth token) is safe.
function evictDisposable() {
  let removed = 0;
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("cache_")) drop.push(k);
    }
    for (const k of drop) { try { localStorage.removeItem(k); removed++; } catch { /* ignore */ } }
  } catch { /* ignore */ }
  return removed;
}

let _quotaNotified = false;
function notifyQuotaOnce() {
  if (_quotaNotified) return;
  _quotaNotified = true;
  // Decoupled from i18n/toast: a UI listener (POSPage) localises + shows a
  // quiet, non-fatal toast at most once per session.
  try { window.dispatchEvent(new CustomEvent("mp-storage-quota")); } catch { /* SSR / no window */ }
}

// Guarded write. Returns true if persisted, false if it had to be skipped
// (after a one-shot evict-and-retry). NEVER throws.
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn("[safeStorage] setItem failed:", key, e && e.message);
      return false;
    }
    // Quota hit — free disposable caches and retry once.
    evictDisposable();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      console.warn("[safeStorage] quota exceeded; skipped persisting:", key);
      notifyQuotaOnce();
      return false;
    }
  }
}

export function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// zustand `persist` storage — createJSONStorage(() => safeStorage). getItem /
// removeItem mirror localStorage; setItem is guarded so a quota failure
// degrades to "draft not saved" instead of crashing the app.
export const safeStorage = {
  getItem: (name) => safeGetItem(name),
  setItem: (name, value) => { safeSetItem(name, value); },
  removeItem: (name) => safeRemoveItem(name),
};
