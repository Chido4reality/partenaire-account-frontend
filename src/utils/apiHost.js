// ORANGE FALLBACK — which API address this app talks to (2026-10-06, v2 2026-11-03).
//
// WHY: Orange Cameroun resets connections to Render-hosted names (measured
// 2026-11-03: api.partenairedozie.com, api.stenamo.com, the onrender.com name
// and a fresh custom name all reset), while book.stenamo.com and
// pos.partenairedozie.com — on Vercel — load. Those names proxy /api/* to the
// same server (vercel.json). The direct address stays FIRST on every build, so
// Vercel only carries the users whose direct calls fail:
//   • Android: the direct address, then VITE_API_FALLBACKS (absolute proxy
//     names on both domains — the APK has them built in).
//   • Web: the direct address, then "/api" on whatever site the page is on.
//
// THE RULES (each one is a red guard in scripts/api-host-check.mjs):
//   • Switch ONLY on a CONNECTION failure — the request got no HTTP response
//     at all (axios ERR_NETWORK: reset, refused, DNS). A 4xx/5xx is an ANSWER
//     from the server and never moves us. A TIMEOUT never moves us either: the
//     request may have reached the server, and a slow link is not a block.
//   • This module NEVER re-sends an app request. It only probes GET <base>/health
//     on the alternatives. The request that failed takes the path it always
//     took — the offline queue (pendingSync), which replays it with its
//     local_id against whatever address is current. No new write path exists.
//   • The choice is remembered (localStorage), and the direct address is
//     re-tried every RETRY_PRIMARY_MS in the background.
//   • On the web a CORS refusal also reaches us as "no response" — the browser
//     hides the difference. When the web leaves the direct address, a no-cors
//     probe tells the two apart and logs a [api-host] DIAG line: a CORS mistake
//     must not hide behind a working fallback.
//
// THE RULES (each one is a red guard in scripts/api-host-check.mjs):
//   • Switch ONLY on a CONNECTION failure — the request got no HTTP response
//     at all (axios ERR_NETWORK: reset, refused, DNS). A 4xx/5xx is an ANSWER
//     from the server and never moves us. A TIMEOUT never moves us either: the
//     request may have reached the server, and a slow link is not a block.
//   • This module NEVER re-sends an app request. It only probes GET <base>/health
//     on the alternatives. The request that failed takes the path it always
//     took — the offline queue (pendingSync), which replays it with its
//     local_id against whatever address is current. No new write path exists.
// Each read on its own, in a try: Vite (and the checks' esbuild defines) replace
// these exact expressions with literals; anything else that loads this module
// without them gets the web default instead of a crash at import time.
let PRIMARY = "/api", FALLBACK_LIST = "";
try { PRIMARY = import.meta.env.VITE_API_URL || "/api"; } catch { /* non-Vite runtime */ }
try { FALLBACK_LIST = import.meta.env.VITE_API_FALLBACKS || ""; } catch { /* non-Vite runtime */ }

const IS_NATIVE = (() => {
  try { return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
})();

// The list for THIS runtime. The web never uses the absolute proxy names (a
// staging page must not fall back to a prod proxy): its one fallback is "/api"
// on its own site, which vercel.json routes to the matching server.
export function candidatesFor({ primary, fallbackList, native }) {
  const fallbacks = native
    ? String(fallbackList || "").split(",").map((s) => s.trim()).filter(Boolean)
    : ["/api"];
  return [primary, ...fallbacks.filter((f) => f !== primary)];
}

export const API_CANDIDATES = candidatesFor({ primary: PRIMARY, fallbackList: FALLBACK_LIST, native: IS_NATIVE });
export const RETRY_PRIMARY_MS = 4 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 6000;
const PROBE_COOLDOWN_MS = 30000;
const STORE_KEY = "mp-api-host-v1";

let _current = PRIMARY;
let _since = 0;
let _probe = null;          // in-flight failover probe (one at a time)
let _lastProbeAt = 0;
let _primaryProbe = null;   // in-flight background re-try of the direct address
const _subs = new Set();
let _lastDiag = null;       // the last "why did the direct address fail" verdict (web)
let IS_NATIVE_FOR_DIAG = () => IS_NATIVE;

// ── test seams (scripts/api-host-check.mjs) ─────────────────────────────────
let _fetch = (...a) => fetch(...a);
let _now = () => Date.now();
let _store = {
  get: () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } },
};
export function __setForTest({ fetchImpl, now, store, candidates, native } = {}) {
  if (fetchImpl) _fetch = fetchImpl;
  if (now) _now = now;
  if (store) _store = store;
  if (typeof native === "boolean") IS_NATIVE_FOR_DIAG = () => native;
  _lastDiag = null;
  if (candidates) { API_CANDIDATES.length = 0; API_CANDIDATES.push(...candidates); }
  _current = API_CANDIDATES[0]; _since = 0; _probe = null; _lastProbeAt = 0; _primaryProbe = null;
  restore();
}

function restore() {
  try {
    const saved = JSON.parse(_store.get() || "null");
    if (saved && API_CANDIDATES.includes(saved.base)) { _current = saved.base; _since = Number(saved.since) || 0; }
  } catch { /* corrupt → stay on primary */ }
}
restore();

function setCurrent(base) {
  if (base === _current) return;
  _current = base; _since = _now();
  _store.set(JSON.stringify({ base, since: _since }));
  for (const fn of _subs) { try { fn(base); } catch { /* a subscriber must not break routing */ } }
}

export function getApiBase() { return _current; }
export function onApiBaseChange(fn) { _subs.add(fn); return () => _subs.delete(fn); }

// Any known base at the start of a URL → stripped (api.js matches endpoint
// paths against its offline-eligible list; the base must not get in the way).
export function stripApiBase(url) {
  const u = String(url || "");
  for (const b of API_CANDIDATES) if (b && u.startsWith(b)) return u.slice(b.length);
  return u;
}

// A connection failure — and ONLY that. axios marks "no response at all" as
// ERR_NETWORK; a timeout is ECONNABORTED / ETIMEDOUT; anything with a response
// is an HTTP answer.
export function isConnectionFailure(err) {
  if (!err || err.response) return false;
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") return false;
  return err.code === "ERR_NETWORK";
}

// The server this build belongs to, read from the DIRECT address (the staging
// server's name says so; every other direct address is production). A candidate
// counts only if its /health reports that same env — so no routing mistake (a
// vercel.json host rule, a stale list) can send a prod page's requests, token or
// queued sales to staging, or the reverse. /health's `env` is additive-only by
// contract (backend index.js).
export function expectedEnvFor(primary) { return /staging/i.test(String(primary || "")) ? "staging" : "production"; }

async function healthy(base) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const r = await _fetch(`${base}/health`, { method: "GET", cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
    if (!r || !r.ok) return false;
    let body = null;
    try { body = await r.json(); } catch { return false; }
    return !!body && body.env === expectedEnvFor(API_CANDIDATES[0]);
  } catch { return false; } finally { if (t) clearTimeout(t); }
}

// Called by api.js's response interceptor for every failed request. Returns
// the probe promise (or null) — the caller never awaits it for its own retry.
export function noteRequestFailure(err) {
  if (API_CANDIDATES.length < 2 || !isConnectionFailure(err)) return null;
  if (_probe) return _probe;
  if (_now() - _lastProbeAt < PROBE_COOLDOWN_MS) return null;
  _lastProbeAt = _now();
  const from = _current;
  _probe = (async () => {
    // The current address just failed to connect; try the others in order.
    for (const base of API_CANDIDATES) {
      if (base === from) continue;
      if (await healthy(base)) {
        setCurrent(base);
        if (from === API_CANDIDATES[0]) noteWhyPrimaryFailed(from);   // not awaited
        return base;
      }
    }
    return null;   // nothing answers: plainly offline — stay put, the queue holds the writes
  })().finally(() => { _probe = null; });
  return _probe;
}

// Web only: the direct address failed with "no response", yet another address
// answers. A reset (Orange) fails a no-cors request too; a CORS refusal does not —
// the server answered, the browser only hid it. Diagnostic only: it never changes
// the choice, and a no-cors request carries no token and reads no body.
export function lastApiHostDiag() { return _lastDiag; }
async function noteWhyPrimaryFailed(primary) {
  if (IS_NATIVE_FOR_DIAG() === true || !/^https?:\/\//.test(primary)) return null;
  let reachable = false;
  try { await _fetch(`${primary}/health`, { method: "GET", mode: "no-cors", cache: "no-store" }); reachable = true; }
  catch { reachable = false; }
  _lastDiag = { at: _now(), primary, reachable_without_cors: reachable,
    verdict: reachable ? "cors" : "blocked" };
  try {
    console.warn(reachable
      ? `[api-host] DIAG: ${primary} ANSWERS but the browser refused it — a CORS mistake, not a network block. Now using ${_current}.`
      : `[api-host] DIAG: ${primary} unreachable (reset/refused/DNS). Now using ${_current}.`);
  } catch { /* no console */ }
  return _lastDiag;
}

// Called before requests: while away from the direct address, re-try it in
// the background every RETRY_PRIMARY_MS and go back as soon as it answers.
export function maybeRetryPrimary() {
  const primary = API_CANDIDATES[0];
  if (_current === primary || _primaryProbe || _now() - _since < RETRY_PRIMARY_MS) return null;
  _primaryProbe = (async () => {
    const ok = await healthy(primary);
    if (ok) setCurrent(primary); else { _since = _now(); _store.set(JSON.stringify({ base: _current, since: _since })); }
    return ok;
  })().finally(() => { _primaryProbe = null; });
  return _primaryProbe;
}
