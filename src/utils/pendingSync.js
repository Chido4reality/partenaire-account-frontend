// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 3
//
// Offline write queue + worker. Persists queued POSTs in
// localDb.pending_sync (real SQLite on native, in-memory shim on
// web). Replays them against the backend when network returns.
//
// Why a queue at all: the cashier rings a sale offline → we don't
// want to lose that write because the device's POST attempt failed.
// We stamp a local_id on the request, store it, and keep retrying
// with the same local_id. Backend dedupe (Slice 1) ensures replays
// are idempotent — multiple retries land at most one canonical row.
//
// State machine per row:
//
//   queued ──► sending ──► sent          (200/201 fresh insert
//                │                        OR 200 dedup_replay=true)
//                ├──► failed_transient   (5xx, network error)
//                │     │
//                │     └──► queued       (after backoff delay)
//                │     OR
//                │     └──► failed_permanent (5 attempts exhausted)
//                └──► failed_permanent   (4xx other than 409 dedupe)
//                                         OR 409 conflict that the
//                                         cashier has to resolve
//
// Backoff: 1s, 5s, 30s, 5m, 30m, then failed_permanent.
//
// SYNC-AFTER-LOGOUT (2026-10-21): a logout used to strand queued sales. On the login page the worker
// kept replaying with NO token → 401 "Token manquant" → the generic 4xx branch → failed_permanent, so
// the sale waited for a manual "Tout réessayer". And whoever logged in next replayed the row with THEIR
// token, so the server booked another cashier's sale to them. Now:
//   - each row records its AUTHOR (user + org from the session token) and that author's token;
//   - no session → nothing is sent (rows keep their status);
//   - the author's own session → sent with it; another user's session → sent with the author's stored
//     token, so the server books it to the original cashier; that token expired or refused → the row
//     waits for its author to log in again;
//   - a session 401 ("Token manquant" / "Token invalide") is retry-later, never failed_permanent;
//   - rows a logout already stranded (failed_permanent, 401 "Token manquant") go back to the queue once
//     a session exists — only that cause; every other failed_permanent rule is unchanged;
//   - the stored token is cleared as soon as the row is sent.
// Follow-up (Peter, 2026-10-21):
//   - the stored token is ALSO cleared on "Token manquant"/"Token invalide", account_disabled, ANY
//     permanent failure, and after OWNER_TOKEN_MAX_AGE_MS (72 h); list functions never return it;
//   - a queued SALE whose author was refused as account_disabled, or that has waited for its author
//     more than AUTHOR_WAIT_MS (24 h), can be sent by the owner / a staff-managing manager "on behalf
//     of" the author (sendOnBehalf → POST /sales { on_behalf_of_user_id }); the server books it to the
//     author and judges every approval as the author;
//   - a queued SALE with no recorded author (queued before this fix) is never sent by itself: the
//     owner / staff-managing manager sends it as themself (sendAuthorUnknown) or discards it
//     (discardAuthorUnknown — the server is asked first whether it already has that local_id).
//
// Worker triggers:
//   - online event (from utils/network.onNetworkChange)
//   - app foreground (@capacitor/app appStateChange or page
//     visibilitychange on web)
//   - 30s timer while there are queued/transient rows

import { exec, query } from './localDb';
import { onNetworkChange, getNetworkStatus } from './network';
import { ownerMismatchOf } from './ownerMismatch';

// MP-RENDER-COLDSTART-WARMUP: per-attempt fetch timeout. 12s → 45s
// because Render free-tier cold-start can take 30-60s. Paul (Cameroon,
// 1 Jun) hit "Exhausted 5 attempts: signal aborted without reason" on
// POST /products because every aborted-at-12s queue retry killed the
// in-flight TCP socket before Render finished booting, so subsequent
// retries kept hitting cold containers in a doom loop. 45s covers the
// typical cold-start window with headroom for slow Cameroon RTT.
const ENDPOINT_TIMEOUTS_MS = 45000;
const BACKOFF_MS  = [1_000, 5_000, 30_000, 300_000, 1_800_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
const POLL_INTERVAL_MS = 30_000;
const SENT_RETENTION_MS = 5 * 60_000;
// SYNC-AFTER-LOGOUT follow-up: a stored author token is kept at most 72 h; a sale waiting for its author
// more than 24 h can be sent on the author's behalf.
export const OWNER_TOKEN_MAX_AGE_MS = 72 * 3600_000;
export const AUTHOR_WAIT_MS = 24 * 3600_000;

// ── uuid ────────────────────────────────────────────────────────
// Minimal RFC4122 v4-shaped id — fine for client-stamped local_id.
// We don't need crypto-grade randomness; the backend unique index
// is the real collision guard.
export function genLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const hex = (n) => Math.floor(Math.random() * 0xffff * n).toString(16).padStart(4, '0').slice(0, 4);
  return `${hex(1)}${hex(1)}-${hex(1)}-4${hex(1).slice(1)}-a${hex(1).slice(1)}-${hex(1)}${hex(1)}${hex(1)}`;
}

// ── In-process state ───────────────────────────────────────────
const _listeners = new Set();
// MP-PHASE-4.0 + Issue A: per-row sync events (separate channel from
// the aggregate-stats subscribe above). Consumers — most importantly
// Layout — react to a specific row reaching 'sent' by invalidating the
// React Query slot that was being served by an optimistic seed (e.g.
// ['current-shift'] after an offline /shifts/open lands), so the next
// refetch picks up the real server row instead of the seed lingering.
const _syncEventListeners = new Set();
export function onSyncEvent(cb) { _syncEventListeners.add(cb); return () => _syncEventListeners.delete(cb); }
function emitSyncEvent(evt) {
  // [Wave 4.0 debug instrumentation — Peter will paste traces.]
  console.log('[sync] emit sent', { endpoint: evt.endpoint, localId: evt.localId });
  for (const cb of _syncEventListeners) {
    try { cb(evt); } catch { /* listener errors are not our problem */ }
  }
}
let _workerStarted = false;
let _workerRunning = false;
let _pollTimer = null;
let _lastStatsCache = { queued: 0, sending: 0, failed_transient: 0, failed_permanent: 0, total: 0 };
// Backend baseURL — needed because the interceptor delegates the
// "send" path here, so the queue worker has to know where to POST.
// Lazily resolved on first send to keep this module decoupled from
// axios/api.js (otherwise we'd circular-import).
let _apiBaseUrl = null;
let _authToken  = null;

// Public: api.js calls this once at startup to hand us the baseURL +
// a getter for the current auth token. Auth changes hot-swap without
// requiring a worker restart.
let _client = null;   // OLD-APP SAFETY: the X-App-Client marker for replays
export function configureSync({ baseUrl, getAuthToken, getClient }) {
  _apiBaseUrl = baseUrl;
  _authToken  = getAuthToken;
  if (getClient) _client = getClient;
}

// ── SYNC-AFTER-LOGOUT: whose session, and whose row ───────────────
// The session token is a JWT; its claims (sub = user, org_id, exp) are read here without trusting them
// for anything but routing — the server verifies every request as before.
function tokenClaims(tok) {
  if (typeof tok !== 'string') return null;
  const part = tok.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
  } catch { return null; }
}
const currentToken = () => (typeof _authToken === 'function' ? _authToken() : _authToken) || null;
const tokenExpired = (tok, now = Date.now()) => { const c = tokenClaims(tok); return !c || (c.exp && c.exp * 1000 <= now); };

const isSaleCreate = (ep) => /^\/sales\/?$/.test(ep || '');
const rowAgeMs = (row, now) => { const t = Date.parse(row.created_at || ''); return Number.isNaN(t) ? 0 : now - t; };
// The author's stored token is usable while it is present, not expired, and not older than 72 h.
const ownerTokenUsable = (row, now) => !!row.owner_token && !tokenExpired(row.owner_token, now)
  && rowAgeMs(row, now) < OWNER_TOKEN_MAX_AGE_MS;

// Which token replays this row now →
//   { token, asOwner?, sendAs? } | { wait: 'no_session' | 'author' | 'author_unknown' | 'sender' }
export function tokenForRow(row, sessionToken = currentToken(), now = Date.now()) {
  if (!sessionToken) return { wait: 'no_session' };
  const me = tokenClaims(sessionToken);
  // Sent on purpose by an owner / staff-managing manager: only with THAT person's session.
  if (row.send_as) return me && me.sub === row.send_as_user_id ? { token: sessionToken, sendAs: row.send_as } : { wait: 'sender' };
  if (!row.owner_user_id) {
    // A sale queued before authors were recorded: whose it is cannot be known — never sent by itself.
    // Other queued actions keep the earlier behaviour (sent with the session).
    return isSaleCreate(row.endpoint) ? { wait: 'author_unknown' } : { token: sessionToken };
  }
  if (me && me.sub === row.owner_user_id) return { token: sessionToken };
  if (ownerTokenUsable(row, now)) return { token: row.owner_token, asOwner: true };
  return { wait: 'author' };
}

// What the owner / a staff-managing manager may do with this row now (the sync screen's buttons) →
//   { kind: 'on_behalf', reason: 'account_disabled'|'author_waiting', author_name }
//   { kind: 'author_unknown' }
//   { kind: 'waiting_author', author_name }      (shown, no button yet)
//   null
export function rowAction(row, sessionToken = currentToken(), now = Date.now()) {
  if (!row || row.status === 'sent' || !isSaleCreate(row.endpoint)) return null;
  if (row.send_as) {
    // Already being sent by the person signed in → nothing to offer. Marked by someone who has since
    // signed out → offered again to whoever is signed in now (the server still decides who may).
    const me = tokenClaims(sessionToken);
    if (me && me.sub === row.send_as_user_id) return null;
    row = { ...row, send_as: null, send_as_user_id: null };
  }
  if (!row.owner_user_id) return { kind: 'author_unknown' };
  const name = row.owner_name || null;
  if (row.owner_refused === 'account_disabled') return { kind: 'on_behalf', reason: 'account_disabled', author_name: name };
  const pick = tokenForRow(row, sessionToken, now);
  if (pick.wait !== 'author') return null;
  return rowAgeMs(row, now) > AUTHOR_WAIT_MS
    ? { kind: 'on_behalf', reason: 'author_waiting', author_name: name }
    : { kind: 'waiting_author', author_name: name };
}

// A refusal that means "this author's account is disabled".
const isAccountDisabled = (status, body) => status === 401 && body && body.error === 'account_disabled';

// A 401 that means "this session is missing / no longer valid" — never a business refusal
// (approval / PIN errors carry an `error` code; a disabled account keeps its own handling).
const isSession401 = (status, body) => status === 401 && !(body && body.error)
  && /Token manquant|Token invalide/.test(String((body && body.message) || ''));

// ── Public: enqueue ────────────────────────────────────────────

export async function enqueue({ endpoint, method = 'POST', payload }) {
  const local_id = payload?.local_id || genLocalId();
  const stamped  = { ...payload, local_id };
  const sessionToken = currentToken();
  const claims = tokenClaims(sessionToken);
  const row = {
    id:          genLocalId(),
    local_id,
    endpoint,
    method,
    payload_json: JSON.stringify(stamped),
    status:      'queued',
    attempts:    0,
    last_error:  null,
    server_id:   null,
    created_at:  new Date().toISOString(),
    last_attempted_at: null,
    owner_user_id: (claims && claims.sub) || null,
    owner_org_id:  (claims && claims.org_id) || null,
    owner_token:   claims ? sessionToken : null,
    owner_name:    (claims && claims.name) || null,     // for "Envoyer au nom de <author>"
  };
  await exec(
    `INSERT INTO pending_sync (id, local_id, endpoint, method, payload_json, status, attempts, last_error, server_id, created_at, last_attempted_at, owner_user_id, owner_org_id, owner_token, owner_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.local_id, row.endpoint, row.method, row.payload_json,
     row.status, row.attempts, row.last_error, row.server_id, row.created_at, row.last_attempted_at,
     row.owner_user_id, row.owner_org_id, row.owner_token, row.owner_name]
  );
  notify();
  // Best-effort immediate flush — if we're online, the user expects
  // the queue to drain immediately and not wait for the poll tick.
  flushIfOnline();
  return { local_id, queuedAt: row.created_at };
}

// ── Stats + subscriptions ──────────────────────────────────────

export async function getStats() {
  // Full table scan + JS tally rather than SELECT status, COUNT(*) … GROUP BY status:
  // the web localDb shim's SELECT regex doesn't accept GROUP BY, and queue size is
  // bounded (unflushed rows + 5-min retention on sent rows) so a scan is trivial.
  try {
    const rows = await query(`SELECT * FROM pending_sync`);
    const out = { queued: 0, sending: 0, sent: 0, failed_transient: 0, failed_permanent: 0, total: 0 };
    for (const r of rows) { if (out[r.status] !== undefined) out[r.status]++; }
    out.total = out.queued + out.sending + out.failed_transient + out.failed_permanent;
    _lastStatsCache = out;
    return out;
  } catch {
    return _lastStatsCache;
  }
}

export function subscribe(cb) {
  _listeners.add(cb);
  // Push current stats immediately so subscribers don't render a
  // zero-state until the next change.
  getStats().then(s => cb(s));
  return () => _listeners.delete(cb);
}

async function notify() {
  const s = await getStats();
  for (const cb of _listeners) {
    try { cb(s); } catch { /* listener errors are not our problem */ }
  }
}

// ── Worker loop ─────────────────────────────────────────────────

export function startWorker() {
  if (_workerStarted) return;
  _workerStarted = true;
  // Online → flush immediately, FORCING past backoff so a transient that
  // escalated to its 30-min step retries the moment the network returns.
  onNetworkChange((s) => { if (s.connected) flushIfOnline(true); });
  // Foreground (web tab + native app resume). visibilitychange covers
  // both via the document API; @capacitor/app appStateChange would
  // be the native-pure path, deferred to a follow-up if needed. Also
  // forced — the user reopening the app expects a fresh drain attempt.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flushIfOnline(true);
    });
  }
  // Periodic safety net for rows in failed_transient state. NOT forced —
  // respects backoff so a persistently-failing server isn't hammered every
  // 30s; reconnect/foreground are the immediate-retry paths.
  _pollTimer = setInterval(() => flushIfOnline(false), POLL_INTERVAL_MS);
  // Crash/reload recovery (web + native), THEN first flush. A row left
  // in 'sending' (process died mid-attempt — e.g. browser reload on web
  // now that the queue persists, or app kill on native) is never
  // re-picked: flushOnce only scans 'queued' + 'failed_transient'.
  // Reset stranded 'sending' → 'queued' so it retries. Safe: the stamped
  // local_id + backend dedupe make replay idempotent (a row that did
  // land returns dedup_replay → sent, no duplicate).
  // MP-REFUNDS-ONLINE-ONLY: drop any stale offline refund/exchange/void ops
  // BEFORE the first flush so they can never POST as real data.
  purgeOnlineOnlyOps().then(() => recoverStranded()).then(() => flushIfOnline(true));
}

async function recoverStranded() {
  try {
    await exec(`UPDATE pending_sync SET status = ? WHERE status = ?`, ['queued', 'sending']);
    notify();
  } catch { /* best-effort; queued rows still flush regardless */ }
}

// MP-REFUNDS-ONLINE-ONLY: refunds / exchanges / voids rely on a server-side
// atomic RPC (process_return_exchange / void_sale) and can NEVER be replayed
// safely from an offline queue — an offline-created one can't resolve the
// original sale line (product + net_amount), producing malformed "Refund 0"
// rows. They are now online-only, so any such op already sitting in the queue
// (e.g. the malformed OFFLINE-… refund from before this change) must be DROPPED,
// never POSTed. The shim has no LIKE, so we scan + delete by id.
//
// MP-CASHIER-PHASE-1b: the ticket endpoints join them, and this is a CORRECTION.
// routes/saleTickets.js on the server has always claimed "pay and release are
// excluded from the offline queue (see ONLINE_ONLY_RX in the client's
// pendingSync)" — that was not true. The pattern matched /returns/ only, so a
// queued pay or release would have synced later, which is precisely the offline
// hazard the phase deferred, arriving anyway through a comment nobody checked.
//
// Why they can never be queued: a ticket transition is a compare-and-set on
// (status, version). A replay minutes or hours later carries a version the row
// has long left behind, so at BEST it 409s — and at worst it settles a ticket a
// second person already paid, released or cancelled in the meantime. Payment is
// also the moment stock moves and the damaged pile is consumed, so a stale replay
// is a stock event, not just a status flip. Raising a ticket (POST /sales/ticket)
// is matched too: it mints a sale number that goes on a customer's order slip,
// and a slip printed from a queued write nobody has accepted yet is a promise the
// shop may not be able to keep.
const ONLINE_ONLY_RX = /^\/(returns\/(return|exchange|void)|sales\/tickets?)\b/i;
async function purgeOnlineOnlyOps() {
  try {
    const all = await query(`SELECT * FROM pending_sync`, []);
    const doomed = (all || []).filter(r => ONLINE_ONLY_RX.test(String(r.endpoint || '')));
    if (!doomed.length) return 0;
    for (const r of doomed) {
      await exec(`DELETE FROM pending_sync WHERE id = ?`, [r.id]);
      console.warn('[pendingSync] purged online-only op (refunds/exchanges/voids are online-only, never queued):', {
        id: r.id, endpoint: r.endpoint, local_id: r.local_id, status: r.status,
      });
    }
    notify();
    return doomed.length;
  } catch (e) {
    console.warn('[pendingSync] purgeOnlineOnlyOps failed (best-effort):', e?.message || e);
    return 0;
  }
}

// force=true ignores per-row backoff cooldowns for this pass — used on
// reconnect / app-foreground so a transient that backed off to its 30-min step
// retries the instant connectivity returns, instead of waiting out the timer.
async function flushIfOnline(force = false) {
  if (_workerRunning) return;
  await purgeExpiredOwnerTokens();    // every tick, signed in or not: a stored author token never outlives 72 h
  if (!currentToken()) return;        // SYNC-AFTER-LOGOUT: signed out → nothing is sent; rows wait as they are
  const net = await getNetworkStatus();
  if (!net.connected) return;
  _workerRunning = true;
  try {
    await flushOnce(force);
  } finally {
    _workerRunning = false;
  }
}

// SYNC-AFTER-LOGOUT recovery: rows an earlier logout stranded — failed_permanent ONLY because they were
// replayed with no session (401 "Token manquant") — go back to the queue. Nothing else is touched.
export function strandedByLogout(row) {
  if (!row || row.status !== 'failed_permanent') return false;
  let err = null; try { err = JSON.parse(row.last_error || 'null'); } catch { err = null; }
  return !!(err && err.status === 401 && err.body && !err.body.error && /Token manquant/.test(String(err.body.message || '')));
}
// A stored author token older than 72 h is deleted (the row then waits for its author, and after 24 h
// the owner can send it on the author's behalf).
export async function purgeExpiredOwnerTokens(now = Date.now()) {
  try {
    const rows = await query(`SELECT * FROM pending_sync`);
    for (const r of rows) {
      if (r.owner_token && rowAgeMs(r, now) >= OWNER_TOKEN_MAX_AGE_MS) {
        await exec(`UPDATE pending_sync SET owner_token = ? WHERE id = ?`, [null, r.id]);
      }
    }
  } catch { /* best effort — tokenForRow ignores an over-age token anyway */ }
}

async function recoverStrandedByLogout() {
  try {
    const rows = await query(`SELECT * FROM pending_sync WHERE status = ?`, ['failed_permanent']);
    for (const r of rows.filter(strandedByLogout)) {
      await exec(`UPDATE pending_sync SET status = ?, last_error = ?, attempts = ? WHERE id = ?`, ['queued', null, 0, r.id]);
    }
  } catch { /* best effort — the manual Retry stays available */ }
}

async function flushOnce(force = false) {
  // MP-REFUNDS-ONLINE-ONLY: belt-and-suspenders — never attempt a refund/
  // exchange/void op from the queue (they're online-only). Drop them first.
  await purgeOnlineOnlyOps();
  await recoverStrandedByLogout();
  // MP-PAUL-FIX-2 (3 Jun): watchdog log for stale 'sending' rows. If a
  // row has been in 'sending' for >2 min, attempt() probably crashed
  // mid-fetch in a way recoverStranded didn't catch (or the device
  // resumed mid-attempt). Log so the next bug report has a concrete
  // attribution; the row stays in 'sending' for now to avoid double-
  // attempts during a real in-flight fetch — startWorker's
  // recoverStranded path resets it on next worker bootstrap.
  try {
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    const stale = await query(
      `SELECT * FROM pending_sync WHERE status = ? ORDER BY last_attempted_at ASC`,
      ['sending']
    );
    for (const r of stale) {
      if (r.last_attempted_at && r.last_attempted_at < cutoff) {
        console.warn('[pendingSync watchdog] stale sending row', {
          id: r.id, endpoint: r.endpoint, attempts: r.attempts,
          last_attempted_at: r.last_attempted_at,
        });
      }
    }
  } catch { /* watchdog is best-effort; don't crash the worker */ }

  // Pull all rows we should attempt this pass: queued + transients
  // whose backoff has elapsed. We sort by created_at so the cashier
  // sees their earliest action settle first.
  const rows = await query(
    `SELECT * FROM pending_sync WHERE status = ? ORDER BY created_at ASC`,
    ['queued']
  );
  const transients = await query(
    `SELECT * FROM pending_sync WHERE status = ? ORDER BY created_at ASC`,
    ['failed_transient']
  );
  const now = Date.now();
  const elig = [...rows];
  for (const t of transients) {
    // force (reconnect / foreground) → retry now, ignore backoff. Otherwise
    // respect the backoff step (index clamped so it never exceeds the longest
    // BACKOFF_MS entry — transients retry forever at that ceiling, never drop).
    if (force) { elig.push(t); continue; }
    const lastAtt = t.last_attempted_at ? Date.parse(t.last_attempted_at) : 0;
    const idx = Math.min(MAX_ATTEMPTS - 1, Math.max(0, t.attempts - 1));
    const cooldown = BACKOFF_MS[idx];
    if (now - lastAtt >= cooldown) elig.push(t);
  }
  // MP-PHASE-3-OFFLINE-SHIFT + MP-PAUL-FIX-2 (3 Jun): shift-before-sales
  // ordering guard. A sale that replays before its (offline-opened) shift
  // has synced would hit the backend's NO_OPEN_SHIFT 400 → failed_permanent
  // (replay uses raw fetch, so the axios interceptor's softening doesn't
  // apply). So attempt /shifts/open rows FIRST.
  //
  // 3 Jun NARROWING: the original guard held the ENTIRE queue behind a
  // stuck shift-open — products, expenses, transfers, collect-debt,
  // stock-counts, inventory edits all paused for the ~35 min worst-case
  // shift-open backoff schedule even though NONE of them depend on a
  // shift. Paul reported "1 pending sync forever" in Cameroon network
  // testing because of this. Now the guard ONLY holds /sales and
  // /sales/:id/payment rows. Everything else flushes regardless of
  // shift-open state. Risk: a sale replaying before its shift lands
  // hits NO_OPEN_SHIFT → failed_permanent → ConflictModal — the
  // cashier discards/retries explicitly. Trade is "mysterious 35-min
  // stuck queue" → "explicit conflict surface for the niche sequence."
  // (No SQL LIKE — the web shim's WHERE grammar doesn't support it —
  // so re-scan and filter in JS.)
  const isShiftOpen = (ep) => /\/shifts\/open\/?$/.test(ep || '');
  const isSaleRow = (ep) => /^\/sales\/?$/.test(ep || '') || /^\/sales\/[^/]+\/payment\/?$/.test(ep || '');
  for (const r of elig.filter(r => isShiftOpen(r.endpoint))) await attempt(r);
  const all = await query(`SELECT * FROM pending_sync`);
  // Hold ONLY sales while a shift-open is actively trying (queued /
  // sending / failed_transient). A 'failed_permanent' shift-open is
  // a terminal conflict (e.g. 409 — another shift already open);
  // don't freeze even the sales subset forever on it — let them
  // attempt, fail NO_OPEN_SHIFT, and surface alongside it in
  // ConflictModal for the cashier to resolve together.
  // SYNC-AFTER-LOGOUT: a shift-open that is WAITING (for its author, or for a sender) is not trying —
  // it must not hold every sale behind it.
  const shiftStillTrying = all.some(r =>
    isShiftOpen(r.endpoint) && r.status !== 'sent' && r.status !== 'failed_permanent' && !tokenForRow(r).wait);
  for (const r of elig.filter(r => !isShiftOpen(r.endpoint))) {
    if (shiftStillTrying && isSaleRow(r.endpoint)) continue;
    await attempt(r);
  }
  // Garbage-collect sent rows older than retention.
  const cutoff = new Date(now - SENT_RETENTION_MS).toISOString();
  await exec(
    `DELETE FROM pending_sync WHERE status = ? AND last_attempted_at < ?`,
    ['sent', cutoff]
  );
  notify();
}

async function attempt(row) {
  if (!_apiBaseUrl) {
    console.warn('[pendingSync] no baseUrl configured; skipping');
    return;
  }
  // SYNC-AFTER-LOGOUT: no session, or another user's session with the author's token gone → the row
  // waits (status unchanged) — it is never sent without a session nor booked to the wrong cashier.
  const pick = tokenForRow(row);
  if (pick.wait) return;
  await exec(
    `UPDATE pending_sync SET status = ?, attempts = ?, last_attempted_at = ? WHERE id = ?`,
    ['sending', (Number(row.attempts) || 0) + 1, new Date().toISOString(), row.id]
  );
  notify();

  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { payload = {}; }
  // Sent on purpose by the owner / a staff-managing manager (the queued payload itself is unchanged).
  if (pick.sendAs === 'on_behalf') {
    payload = { ...payload, on_behalf_of_user_id: row.owner_user_id, on_behalf_reason: row.send_as_reason || 'author_waiting' };
  } else if (pick.sendAs === 'author_unknown' && isSaleCreate(row.endpoint)) {
    payload = { ...payload, author_unknown: true };
  }

  const url = `${_apiBaseUrl}${row.endpoint}`;
  const token = pick.token;
  // A refusal ends this row's use of the stored author token, and an on-purpose send goes back to the
  // owner's screen (another permitted person may try).
  const clearOnRefusal = async () => {
    await exec(`UPDATE pending_sync SET owner_token = ?, send_as = ?, send_as_user_id = ?, send_as_reason = ? WHERE id = ?`,
      [null, null, null, null, row.id]);
  };

  let res, body;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ENDPOINT_TIMEOUTS_MS);
    res = await fetch(url, {
      method:  row.method || 'POST',
      headers: {
        'Content-Type':  'application/json',
        // MP-OFFLINE-COLLECT-NEVER-DROP: mark this as a SYNCED replay + carry the
        // original collection time (row.created_at = when the cashier collected while
        // offline) so the debt-collection endpoint can attribute the drawer shift that
        // was open THEN, and never drop the cash if none resolves now.
        'X-Offline-Replay': '1',
        // OLD-APP SAFETY: a replay is this app, not a legacy one.
        ...(typeof _client === 'function' ? { 'X-App-Client': _client() } : {}),
        ...(row.created_at ? { 'X-Collected-At': row.created_at } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body:   JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    body = await res.json().catch(() => ({}));
  } catch (e) {
    // Network failure / abort → transient. Will retry on next backoff.
    await markTransient(row, e.message || 'network error');
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    // Success — either a fresh insert OR a dedup_replay. Same
    // outcome from the queue's perspective: the row is on the server.
    const serverId = body?.data?.server_id || body?.data?.id || null;
    await exec(
      `UPDATE pending_sync SET status = ?, server_id = ?, last_error = ?, owner_token = ? WHERE id = ?`,
      ['sent', serverId, null, null, row.id]
    );
    // MP-OFFLINE-COLLECT-NEVER-DROP: a synced debt collection that needed shift
    // FALLBACK (attributed to the shift open at collection time / current) or that had
    // NO shift ('needs_review' → recorded with a null shift, cash preserved) must be
    // surfaced — never a silent success. Consumers (Layout) toast on this event.
    const attr = body?.shift_attribution;
    if (attr && attr !== 'live' && !body?.dedup_replay) { // don't re-surface an idempotent replay
      emitSyncEvent({ type: 'shift_fallback', endpoint: row.endpoint, localId: row.local_id, attribution: attr });
    }
    emitSyncEvent({ type: 'sent', endpoint: row.endpoint, localId: row.local_id });
    notify();
    return;
  }

  if (res.status === 409) {
    // Server-side conflict (stock / debt / shift). Cashier must
    // resolve manually — surface via ConflictModal.
    await clearOnRefusal();
    await exec(
      `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
      ['failed_permanent', JSON.stringify({ status: 409, body }), row.id]
    );
    notify();
    // OWNER CONFIRM-IN-PLACE on replay: the owner's queued short count was refused
    // BEFORE anything was written. It must be ANSWERED (Recount / Continue anyway),
    // not retried as-is (it would 409 forever) — surface it loudly.
    if (body?.code === 'owner_mismatch_confirm') {
      emitSyncEvent({ type: 'owner_mismatch', rowId: row.id, ...ownerMismatchOf({ ...row, last_error: JSON.stringify({ status: 409, body }) }) });
    }
    return;
  }

  if (isSession401(res.status, body)) {
    // SYNC-AFTER-LOGOUT: the session (or the author's stored token) is missing or no longer valid —
    // retry later with a valid one, never failed_permanent. The stored token is dropped either way, so
    // the row waits for its author's next login instead of being re-sent with it.
    await exec(`UPDATE pending_sync SET owner_token = ? WHERE id = ?`, [null, row.id]);
    await markTransient(row, `401 ${body?.message || ''} (waiting for a valid session)`);
    return;
  }

  if (res.status >= 400 && res.status < 500) {
    // Other 4xx (validation, auth, plan gate). These won't get better
    // by replaying. Surface as failed_permanent so the cashier sees
    // the actual server message.
    await clearOnRefusal();
    // The AUTHOR's account is disabled: remembered (a Retry clears last_error), so the owner's
    // "send on behalf" stays offered for this sale.
    if (isAccountDisabled(res.status, body) && !pick.sendAs) {
      await exec(`UPDATE pending_sync SET owner_refused = ? WHERE id = ?`, ['account_disabled', row.id]);
    }
    await exec(
      `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
      ['failed_permanent', JSON.stringify({ status: res.status, body }), row.id]
    );
    notify();
    return;
  }

  // 5xx → transient
  await markTransient(row, `${res.status} ${body?.message || ''}`);
}

// MP-PAUL-SHIFT-NEVER-STRAND (supersedes the 2-attempt shift-open cap):
// network failures ("Failed to fetch") and 5xx are inherently TRANSIENT — a
// patch of offline must never strand a queued action, least of all
// /shifts/open, which dependent sales wait behind. So a transient failure
// stays failed_transient and keeps retrying INDEFINITELY: BACKOFF_MS governs
// the autonomous poll cadence (clamped to its longest step via the idx clamp
// in flushOnce), while a reconnect or app-foreground forces an immediate retry
// regardless of backoff (flushIfOnline(true)). Only genuine server REJECTIONS
// — 4xx / 409, handled in attempt() — become failed_permanent, because those
// won't fix themselves and need the user to resolve. attempts is already
// incremented in attempt() when the row flips to 'sending', so we only set
// status + reason here. MAX_ATTEMPTS is retained solely as the backoff-index
// clamp; it is no longer a give-up threshold.
async function markTransient(row, msg) {
  await exec(
    `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
    ['failed_transient', msg, row.id]
  );
  notify();
}

// ── Manual actions for ConflictModal ────────────────────────────

export async function retry(rowId) {
  await exec(
    `UPDATE pending_sync SET status = ?, last_error = ?, attempts = ? WHERE id = ?`,
    ['queued', null, 0, rowId]
  );
  notify();
  flushIfOnline();
}

// OWNER CONFIRM-IN-PLACE (Peter, 2026-10-04): ownerMismatchOf (utils/ownerMismatch)
// recognises a queued owner count the server refused — re-exported for the screens.
export { ownerMismatchOf };

// "Continue anyway" for a queued owner short count: the SAME request (same local_id —
// the refusal came before the server's dedupe, so nothing is cached against it) with
// the owner's confirmation added, then sent again.
export async function continueWithConfirm(rowId) {
  const rows = await query(`SELECT * FROM pending_sync WHERE id = ?`, [rowId]);
  const row = rows && rows[0];
  if (!row) return false;
  let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
  payload.owner_mismatch_confirmed = true;
  await exec(
    `UPDATE pending_sync SET payload_json = ?, status = ?, last_error = ?, attempts = ? WHERE id = ?`,
    [JSON.stringify(payload), 'queued', null, 0, rowId]
  );
  notify();
  flushIfOnline();
  return true;
}

export async function discard(rowId) {
  await exec(`DELETE FROM pending_sync WHERE id = ?`, [rowId]);
  notify();
}

// SYNC-AFTER-LOGOUT: no screen ever receives a stored author token — every list goes through this.
// The row's owner action (rowAction) is attached here, while the token is still known.
function forScreen(r, session = currentToken(), now = Date.now()) {
  const queue_action = rowAction(r, session, now);
  const { owner_token: _drop, ...rest } = r;
  return { ...rest, queue_action };
}

export async function listFailedPermanent() {
  const rows = await query(
    `SELECT * FROM pending_sync WHERE status = ? ORDER BY created_at DESC`,
    ['failed_permanent']
  );
  return rows.map((r) => forScreen(r));
}

// Every row that is NOT yet confirmed-on-server, for the visible sync queue
// view: failed_permanent (needs attention) first, then failed_transient
// (retrying), then queued (waiting), then sending (in flight). Within a status
// group, oldest first so the cashier's earliest action is on top. 'sent' rows
// are excluded (they're GC'd after a short retention anyway).
export async function listPending() {
  let rows = [];
  try { rows = await query(`SELECT * FROM pending_sync`); } catch { rows = []; }
  const rank = { failed_permanent: 0, failed_transient: 1, queued: 2, sending: 3 };
  const isSale = (ep) => /^\/sales(\/|$)/.test(ep || '');
  return rows
    .filter(r => r.status !== 'sent')
    .sort((a, b) => {
      // Sales first (accounting-critical), then by status (failed → waiting),
      // then oldest first within a group.
      const sa = isSale(a.endpoint) ? 0 : 1, sb = isSale(b.endpoint) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ra = rank[a.status] ?? 9, rb = rank[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return String(a.created_at).localeCompare(String(b.created_at));
    })
    .map((r) => forScreen(r));
}

// ── SYNC-AFTER-LOGOUT: the owner / a staff-managing manager acts on a queued sale ──────────────────
// The server is the gate (403 for anyone else); these only mark the row and let the worker send it with
// the CURRENT session — and only that person's session (tokenForRow: send_as_user_id).
async function markSendAs(rowId, kind, allowed) {
  const me = tokenClaims(currentToken());
  if (!me || !me.sub) return false;
  const rows = await query(`SELECT * FROM pending_sync WHERE id = ?`, [rowId]);
  const row = rows && rows[0];
  const action = row && rowAction(row);
  if (!row || !action || !allowed(action)) return false;
  await exec(
    `UPDATE pending_sync SET send_as = ?, send_as_user_id = ?, send_as_reason = ?, status = ?, last_error = ?, attempts = ? WHERE id = ?`,
    [kind, me.sub, action.reason || null, 'queued', null, 0, rowId]
  );
  notify();
  flushIfOnline(true);
  return true;
}
// "Envoyer au nom de <author>": booked to the author, judged as the author (server side).
export const sendOnBehalf = (rowId) => markSendAs(rowId, 'on_behalf', (a) => a.kind === 'on_behalf');
// "Auteur inconnu — envoyer": booked to the person sending it, audited.
export const sendAuthorUnknown = (rowId) => markSendAs(rowId, 'author_unknown', (a) => a.kind === 'author_unknown');

// "Auteur inconnu — supprimer": ask the server first. If it already has this local_id the sale is NOT
// deleted (it is marked sent); otherwise the server audits the discard and the row is deleted.
// → { discarded: true } | { kept: true, sale_number } | { error }
export async function discardAuthorUnknown(rowId) {
  const session = currentToken();
  if (!session || !_apiBaseUrl) return { error: 'no_session' };
  const rows = await query(`SELECT * FROM pending_sync WHERE id = ?`, [rowId]);
  const row = rows && rows[0];
  const action = row && rowAction(row);
  if (!row || !action || action.kind !== 'author_unknown') return { error: 'not_author_unknown' };
  let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
  const items = Array.isArray(payload.items) ? payload.items : [];
  let res, body;
  try {
    res = await fetch(`${_apiBaseUrl}/sales/queue/discard-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}`,
        ...(typeof _client === 'function' ? { 'X-App-Client': _client() } : {}) },
      body: JSON.stringify({ local_id: row.local_id, item_count: items.length, collected_at: row.created_at || null,
        total: items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0) }),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    return { error: 'offline' };                          // cannot check → never delete
  }
  if (!(res.status >= 200 && res.status < 300) || !body?.data) {
    return { error: body?.message_en || body?.message || `HTTP ${res.status}`, status: res.status, body };
  }
  if (body.data.exists) {
    await exec(`UPDATE pending_sync SET status = ?, server_id = ?, last_error = ?, owner_token = ?, last_attempted_at = ? WHERE id = ?`,
      ['sent', body.data.server_id || null, null, null, new Date().toISOString(), rowId]);
    notify();
    return { kept: true, sale_number: body.data.sale_number || null };
  }
  await exec(`DELETE FROM pending_sync WHERE id = ?`, [rowId]);
  notify();
  return { discarded: true };
}

// Re-queue every failed row (permanent + transient) in one shot for "Retry
// all". attempts reset to 0 so the full backoff budget is available again,
// then kick the worker. Returns how many rows were re-queued.
export async function retryAll() {
  let n = 0;
  try {
    const rows = await query(`SELECT * FROM pending_sync`);
    // An owner short count refused on replay is ANSWERED (Recount / Continue anyway),
    // never re-sent as-is: it would be refused again, forever.
    const failed = rows.filter(r => (r.status === 'failed_permanent' || r.status === 'failed_transient') && !ownerMismatchOf(r));
    for (const r of failed) {
      await exec(
        `UPDATE pending_sync SET status = ?, last_error = ?, attempts = ? WHERE id = ?`,
        ['queued', null, 0, r.id]
      );
      n++;
    }
  } catch { /* best-effort; per-row Retry remains available */ }
  notify();
  flushIfOnline();
  return n;
}
