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
// Worker triggers:
//   - online event (from utils/network.onNetworkChange)
//   - app foreground (@capacitor/app appStateChange or page
//     visibilitychange on web)
//   - 30s timer while there are queued/transient rows

import { exec, query } from './localDb';
import { onNetworkChange, getNetworkStatus } from './network';

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
export function configureSync({ baseUrl, getAuthToken }) {
  _apiBaseUrl = baseUrl;
  _authToken  = getAuthToken;
}

// ── Public: enqueue ────────────────────────────────────────────

export async function enqueue({ endpoint, method = 'POST', payload }) {
  const local_id = payload?.local_id || genLocalId();
  const stamped  = { ...payload, local_id };
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
  };
  await exec(
    `INSERT INTO pending_sync (id, local_id, endpoint, method, payload_json, status, attempts, last_error, server_id, created_at, last_attempted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.local_id, row.endpoint, row.method, row.payload_json,
     row.status, row.attempts, row.last_error, row.server_id, row.created_at, row.last_attempted_at]
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
const ONLINE_ONLY_RX = /^\/returns\/(return|exchange|void)\//i;
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
  const net = await getNetworkStatus();
  if (!net.connected) return;
  _workerRunning = true;
  try {
    await flushOnce(force);
  } finally {
    _workerRunning = false;
  }
}

async function flushOnce(force = false) {
  // MP-REFUNDS-ONLINE-ONLY: belt-and-suspenders — never attempt a refund/
  // exchange/void op from the queue (they're online-only). Drop them first.
  await purgeOnlineOnlyOps();
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
  const shiftStillTrying = all.some(r =>
    isShiftOpen(r.endpoint) && r.status !== 'sent' && r.status !== 'failed_permanent');
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
  await exec(
    `UPDATE pending_sync SET status = ?, attempts = ?, last_attempted_at = ? WHERE id = ?`,
    ['sending', (Number(row.attempts) || 0) + 1, new Date().toISOString(), row.id]
  );
  notify();

  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { payload = {}; }

  const url = `${_apiBaseUrl}${row.endpoint}`;
  const token = typeof _authToken === 'function' ? _authToken() : _authToken;

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
      `UPDATE pending_sync SET status = ?, server_id = ?, last_error = ? WHERE id = ?`,
      ['sent', serverId, null, row.id]
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
    await exec(
      `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
      ['failed_permanent', JSON.stringify({ status: 409, body }), row.id]
    );
    notify();
    return;
  }

  if (res.status >= 400 && res.status < 500) {
    // Other 4xx (validation, auth, plan gate). These won't get better
    // by replaying. Surface as failed_permanent so the cashier sees
    // the actual server message.
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

export async function discard(rowId) {
  await exec(`DELETE FROM pending_sync WHERE id = ?`, [rowId]);
  notify();
}

export async function listFailedPermanent() {
  return query(
    `SELECT * FROM pending_sync WHERE status = ? ORDER BY created_at DESC`,
    ['failed_permanent']
  );
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
    });
}

// Re-queue every failed row (permanent + transient) in one shot for "Retry
// all". attempts reset to 0 so the full backoff budget is available again,
// then kick the worker. Returns how many rows were re-queued.
export async function retryAll() {
  let n = 0;
  try {
    const rows = await query(`SELECT * FROM pending_sync`);
    const failed = rows.filter(r => r.status === 'failed_permanent' || r.status === 'failed_transient');
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
