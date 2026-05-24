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

const ENDPOINT_TIMEOUTS_MS = 12000;
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
  // Online → flush immediately.
  onNetworkChange((s) => { if (s.connected) flushIfOnline(); });
  // Foreground (web tab + native app resume). visibilitychange covers
  // both via the document API; @capacitor/app appStateChange would
  // be the native-pure path, deferred to a follow-up if needed.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flushIfOnline();
    });
  }
  // Periodic safety net for rows in failed_transient state that the
  // online event didn't catch (rare — usually online fires first).
  _pollTimer = setInterval(() => flushIfOnline(), POLL_INTERVAL_MS);
  // First boot — try once.
  flushIfOnline();
}

async function flushIfOnline() {
  if (_workerRunning) return;
  const net = await getNetworkStatus();
  if (!net.connected) return;
  _workerRunning = true;
  try {
    await flushOnce();
  } finally {
    _workerRunning = false;
  }
}

async function flushOnce() {
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
    const lastAtt = t.last_attempted_at ? Date.parse(t.last_attempted_at) : 0;
    const idx = Math.min(MAX_ATTEMPTS - 1, Math.max(0, t.attempts - 1));
    const cooldown = BACKOFF_MS[idx];
    if (now - lastAtt >= cooldown) elig.push(t);
  }
  for (const r of elig) {
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

async function markTransient(row, msg) {
  const next = (Number(row.attempts) || 0) + 1;
  if (next >= MAX_ATTEMPTS) {
    await exec(
      `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
      ['failed_permanent', `Exhausted ${MAX_ATTEMPTS} attempts: ${msg}`, row.id]
    );
  } else {
    await exec(
      `UPDATE pending_sync SET status = ?, last_error = ? WHERE id = ?`,
      ['failed_transient', msg, row.id]
    );
  }
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
