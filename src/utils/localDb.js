// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 3
//
// SQLite wrapper. On native (Capacitor), lazy-imports
// @capacitor-community/sqlite and persists into a real on-device DB.
// On web (npm run dev), falls back to an in-memory shim so the queue
// + interceptor code paths can be developed and tested in a browser
// without needing a physical device — the shim's data doesn't survive
// a page reload, which is the correct dev-mode trade-off.
//
// API:
//   openDb()                      — idempotent; first call initializes schema.
//   exec(sql, params)             — DDL / writes; returns { changes }.
//   query(sql, params)            — SELECT; returns rows[].
//   close()                       — closes the DB; the next openDb() reopens.
//
// Schema is defined once in createSchema() and the same schema runs on
// native + the web shim (the shim implements a minimal SQL subset
// covering INSERT / SELECT / UPDATE / DELETE with WHERE on equality).
//
// The mirror_* tables are pull-down caches of the org's catalog +
// stock + customers + open shifts. They are NOT authoritative — the
// server is the source of truth. They exist so the cashier can ring
// up sales while offline against a recently-cached view of inventory.
//
// pending_sync is the offline write queue. Each row represents one
// queued POST waiting to be replayed against the backend. The worker
// in pendingSync.js owns the state transitions; this file just gives
// it durable storage.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mirror_pa_products (
  id TEXT PRIMARY KEY,
  name TEXT,
  sell_price REAL,
  wholesale_price REAL,
  min_price REAL,
  cost_price REAL,
  category_id TEXT,
  unit TEXT,
  barcode TEXT,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_products_updated ON mirror_pa_products(updated_at);

CREATE TABLE IF NOT EXISTS mirror_pa_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  location_id TEXT,
  quantity REAL,
  min_quantity REAL,
  slot_code TEXT,
  last_moved_at TEXT,
  last_movement_type TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_stock_product ON mirror_pa_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_mirror_stock_updated ON mirror_pa_stock(updated_at);

CREATE TABLE IF NOT EXISTS mirror_pa_customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  total_debt REAL,
  customer_type TEXT,
  credit_limit REAL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_customers_updated ON mirror_pa_customers(updated_at);

CREATE TABLE IF NOT EXISTS mirror_pa_categories (
  id TEXT PRIMARY KEY,
  name TEXT,
  name_en TEXT,
  icon TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mirror_pa_locations (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mirror_pa_cash_shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT,
  location_id TEXT,
  opening_float REAL,
  status TEXT,
  opened_at TEXT,
  closed_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_sync (
  id TEXT PRIMARY KEY,
  local_id TEXT,
  endpoint TEXT,
  method TEXT,
  payload_json TEXT,
  status TEXT DEFAULT 'queued',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  server_id TEXT,
  created_at TEXT,
  last_attempted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_sync(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_sync(created_at);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// ── Capability + lazy import ────────────────────────────────────

let _impl = null; // 'native' | 'web' | null (uninitialised)
let _db = null;   // native: SQLiteDBConnection; web: in-memory shim instance

async function detectImpl() {
  if (_impl) return _impl;
  try {
    const cap = await import('@capacitor/core');
    if (cap.Capacitor?.isNativePlatform?.()) {
      _impl = 'native';
      return _impl;
    }
  } catch { /* @capacitor/core missing; treat as web */ }
  _impl = 'web';
  return _impl;
}

// ── Native (SQLite) implementation ──────────────────────────────

async function openNative() {
  if (_db) return _db;
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const DB_NAME = 'mp_local';
  // isConnection prevents a double-open after the user navigates back
  // to a page that calls openDb() again.
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
  _db = isConn
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await _db.open();
  // Apply schema. SQLite tolerates the multiple-statement payload
  // when wrapped in execute(); each CREATE IF NOT EXISTS is a no-op
  // on subsequent boots.
  await _db.execute(SCHEMA_SQL);
  return _db;
}

async function execNative(sql, params = []) {
  if (!_db) await openNative();
  const res = await _db.run(sql, params, false);
  return { changes: res.changes?.changes ?? 0, lastId: res.changes?.lastId };
}

async function queryNative(sql, params = []) {
  if (!_db) await openNative();
  const res = await _db.query(sql, params);
  return res.values || [];
}

async function closeNative() {
  if (!_db) return;
  try { await _db.close(); } catch { /* ignore */ }
  _db = null;
}

// ── Web shim — in-memory + tiny SQL parser ──────────────────────
//
// The shim covers the SQL patterns this codebase actually uses:
//   - INSERT INTO t (cols) VALUES (?, ?, ...)
//   - INSERT OR REPLACE INTO t (cols) VALUES (?, ?, ...)
//   - SELECT cols FROM t [WHERE clause [AND clause]...]
//                        [ORDER BY col ASC|DESC]
//                        [LIMIT n]
//   - UPDATE t SET col=?, col=? WHERE clause [AND clause]...
//   - DELETE FROM t WHERE clause [AND clause]...
//   Clause grammar:  col OP ?       (OP ∈ =, !=, <>, <, >, <=, >=)
//                    col IS NULL  |  col IS NOT NULL
//   - CREATE TABLE IF NOT EXISTS — recognised + treated as a no-op
//     (the shim is schemaless; columns are accepted by name)
//   - CREATE INDEX IF NOT EXISTS — no-op
//
// Anything beyond that throws so the developer learns to extend
// the shim or test on a real device. The shim isn't trying to be a
// SQLite reimplementation — it's a developer-loop aid.

const _shimTables = new Map(); // name → rows[]

function shimEnsureTable(name) {
  if (!_shimTables.has(name)) _shimTables.set(name, []);
  return _shimTables.get(name);
}

// Evaluate `clauses` (already split on AND) against a row, consuming params
// starting at `baseIdx`. Re-evaluating per row from the same baseIdx is
// intentional — earlier in-place paramIdx bookkeeping was both per-row buggy
// (SELECT used an outer accumulator) and forced single-row callers to thread
// the index manually. Centralising both quirks here.
function shimEvalWhere(clauses, row, params, baseIdx) {
  let idx = baseIdx;
  for (const cl of clauses) {
    const cmp     = /^(\w+)\s*(=|!=|<>|<=|>=|<|>)\s*\?$/.exec(cl);
    const isNull  = /^(\w+)\s+IS\s+NULL$/i.exec(cl);
    const notNull = /^(\w+)\s+IS\s+NOT\s+NULL$/i.exec(cl);
    let ok;
    if (cmp) {
      const col = cmp[1], op = cmp[2], v = params[idx++], lhs = row[col];
      switch (op) {
        case '=':  ok = lhs === v; break;
        case '!=':
        case '<>': ok = lhs !== v; break;
        case '<':  ok = lhs <  v;  break;
        case '>':  ok = lhs >  v;  break;
        case '<=': ok = lhs <= v;  break;
        case '>=': ok = lhs >= v;  break;
      }
    } else if (isNull)  { ok = row[isNull[1]]  == null; }
    else if (notNull)   { ok = row[notNull[1]] != null; }
    else throw new Error(`[localDb shim] unsupported WHERE clause: ${cl}`);
    if (!ok) return false;
  }
  return true;
}

function shimParseInsert(sql, params) {
  const m = /^INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
  if (!m) throw new Error(`[localDb shim] cannot parse INSERT: ${sql}`);
  const table = m[1];
  const cols  = m[2].split(',').map(s => s.trim());
  const placeholders = m[3].split(',').map(s => s.trim());
  if (placeholders.length !== params.length) {
    throw new Error(`[localDb shim] placeholder/param count mismatch on INSERT`);
  }
  const row = {};
  cols.forEach((c, i) => { row[c] = params[i]; });
  const isReplace = /OR\s+REPLACE/i.test(sql);
  const rows = shimEnsureTable(table);
  if (isReplace && row.id != null) {
    const existing = rows.findIndex(r => r.id === row.id);
    if (existing >= 0) { rows[existing] = row; return; }
  }
  rows.push(row);
}

function shimParseSelect(sql, params) {
  const m = /^SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+(\w+)(\s+ASC|\s+DESC)?)?(?:\s+LIMIT\s+(\d+))?\s*;?\s*$/i.exec(sql);
  if (!m) throw new Error(`[localDb shim] cannot parse SELECT: ${sql}`);
  const cols    = m[1].trim();
  const table   = m[2];
  const where   = m[3];
  const orderBy = m[4];
  const orderDir = (m[5] || '').trim().toUpperCase() || 'ASC';
  const limit   = m[6] ? Number(m[6]) : null;
  let rows = (_shimTables.get(table) || []).slice();
  if (where) {
    const clauses = where.split(/\s+AND\s+/i).map(c => c.trim());
    rows = rows.filter(r => shimEvalWhere(clauses, r, params, 0));
  }
  if (orderBy) {
    rows.sort((a, b) => {
      const av = a[orderBy], bv = b[orderBy];
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * (orderDir === 'DESC' ? -1 : 1);
    });
  }
  if (limit != null) rows = rows.slice(0, limit);
  if (cols === '*') return rows.map(r => ({ ...r }));
  const colList = cols.split(',').map(s => s.trim());
  return rows.map(r => {
    const out = {};
    for (const c of colList) out[c] = r[c];
    return out;
  });
}

function shimParseUpdate(sql, params) {
  const m = /^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?\s*;?\s*$/i.exec(sql);
  if (!m) throw new Error(`[localDb shim] cannot parse UPDATE: ${sql}`);
  const table = m[1];
  const setClause = m[2];
  const where = m[3];
  const sets = setClause.split(',').map(s => s.trim());
  const setOps = sets.map(s => {
    const sm = /^(\w+)\s*=\s*\?$/.exec(s);
    if (!sm) throw new Error(`[localDb shim] unsupported SET: ${s}`);
    return sm[1];
  });
  const setValues = setOps.map((_, i) => params[i]);
  const whereStart = setOps.length;
  const rows = shimEnsureTable(table);
  let changes = 0;
  const whereClauses = where
    ? where.split(/\s+AND\s+/i).map(c => c.trim())
    : [];
  for (const r of rows) {
    if (whereClauses.length && !shimEvalWhere(whereClauses, r, params, whereStart)) continue;
    setOps.forEach((col, i) => { r[col] = setValues[i]; });
    changes++;
  }
  return { changes };
}

function shimParseDelete(sql, params) {
  const m = /^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?\s*;?\s*$/i.exec(sql);
  if (!m) throw new Error(`[localDb shim] cannot parse DELETE: ${sql}`);
  const table = m[1];
  const where = m[2];
  const rows = shimEnsureTable(table);
  if (!where) { const n = rows.length; rows.length = 0; return { changes: n }; }
  const clauses = where.split(/\s+AND\s+/i).map(c => c.trim());
  const keep = [];
  let changes = 0;
  for (const r of rows) {
    if (shimEvalWhere(clauses, r, params, 0)) changes++;
    else keep.push(r);
  }
  rows.length = 0;
  rows.push(...keep);
  return { changes };
}

async function execWeb(sql, params = []) {
  const trimmed = sql.trim();
  // CREATE TABLE / INDEX / multi-statement schema → recognised as no-op.
  if (/^\s*(CREATE\s+(TABLE|INDEX)|DROP|PRAGMA|BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
    return { changes: 0 };
  }
  if (/^\s*INSERT/i.test(trimmed))  { shimParseInsert(trimmed, params); return { changes: 1 }; }
  if (/^\s*UPDATE/i.test(trimmed))  { return shimParseUpdate(trimmed, params); }
  if (/^\s*DELETE/i.test(trimmed))  { return shimParseDelete(trimmed, params); }
  if (/^\s*SELECT/i.test(trimmed))  { return { changes: 0, rows: shimParseSelect(trimmed, params) }; }
  throw new Error(`[localDb shim] unsupported SQL: ${trimmed.slice(0, 60)}`);
}

async function queryWeb(sql, params = []) {
  return shimParseSelect(sql, params);
}

async function openWeb() {
  // Apply the schema_sql so any future statement validation works,
  // but it's all no-ops in the shim.
  for (const stmt of SCHEMA_SQL.split(';')) {
    const s = stmt.trim();
    if (s) await execWeb(s + ';');
  }
}

// ── Public API ─────────────────────────────────────────────────

export async function openDb() {
  const impl = await detectImpl();
  if (impl === 'native') return openNative();
  return openWeb();
}

export async function exec(sql, params = []) {
  const impl = await detectImpl();
  return impl === 'native' ? execNative(sql, params) : execWeb(sql, params);
}

export async function query(sql, params = []) {
  const impl = await detectImpl();
  return impl === 'native' ? queryNative(sql, params) : queryWeb(sql, params);
}

export async function close() {
  const impl = await detectImpl();
  if (impl === 'native') return closeNative();
  _shimTables.clear();
}

export async function impl() {
  return detectImpl();
}
