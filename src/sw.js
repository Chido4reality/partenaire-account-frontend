// Referenced so vite-plugin-pwa injects the precache asset list at build time
// eslint-disable-next-line no-undef
const _manifest = self.__WB_MANIFEST; // eslint-disable-line no-unused-vars

const DB_NAME    = 'POS_OfflineDB';
const STORE      = 'pendingSales';
const SYNC_TAG   = 'sync-pending-sales';
const SALE_RE    = /\/api\/sales$/;

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'local_id' });
        store.createIndex('status',     'status',     { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    req.onsuccess  = ({ target: { result } }) => resolve(result);
    req.onerror    = ({ target: { error  } }) => reject(error);
  });
}

function genId() {
  return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

async function savePending(url, authHeader, body) {
  const db = await openDB();
  const record = {
    local_id:   genId(),
    status:     'pending',
    created_at: new Date().toISOString(),
    url,
    headers:    { Authorization: authHeader },
    payload:    JSON.parse(body),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record).onsuccess = () => resolve(record);
    tx.onerror = ({ target: { error } }) => reject(error);
  });
}

async function getPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ({ target: { result } }) =>
      resolve(result.filter(r => r.status === 'pending'));
    req.onerror = ({ target: { error } }) => reject(error);
  });
}

async function markSynced(local_id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get   = store.get(local_id);
    get.onsuccess = ({ target: { result: rec } }) => {
      if (!rec) return resolve();
      rec.status    = 'synced';
      rec.synced_at = new Date().toISOString();
      store.put(rec).onsuccess = () => resolve();
    };
    get.onerror = ({ target: { error } }) => reject(error);
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener('install',  ()  => self.skipWaiting());
self.addEventListener('activate', e   => e.waitUntil(self.clients.claim()));

// ── Fetch interception ────────────────────────────────────────────────────────

self.addEventListener('fetch', e => {
  if (e.request.method !== 'POST') return;
  if (!SALE_RE.test(e.request.url))  return;
  e.respondWith(handleSale(e.request));
});

async function handleSale(request) {
  const body       = await request.clone().text();
  const authHeader = request.headers.get('Authorization') || '';

  // Rebuild request so we can abort it independently
  const headersObj = {};
  request.headers.forEach((v, k) => { headersObj[k] = v; });
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(request.url, {
      method:  'POST',
      headers: headersObj,
      body,
      signal:  controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);

    let localId;
    try {
      const rec = await savePending(request.url, authHeader, body);
      localId   = rec.local_id;
      if ('sync' in self.registration) {
        self.registration.sync.register(SYNC_TAG).catch(() => {});
      }
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'SALE_SAVED_OFFLINE', local_id: localId }));
    } catch (dbErr) {
      console.error('[SW] IndexedDB save failed:', dbErr);
    }

    return new Response(
      JSON.stringify({ success: true, offline: true, local_id: localId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ── Background Sync ───────────────────────────────────────────────────────────

self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG) e.waitUntil(syncAll());
});

async function syncAll() {
  const pending = await getPending();
  if (!pending.length) return;

  let synced = 0;
  for (const rec of pending) {
    try {
      const res = await fetch(rec.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...rec.headers },
        body:    JSON.stringify(rec.payload),
      });
      if (res.ok) {
        await markSynced(rec.local_id);
        synced++;
      }
    } catch {
      // Network still down — leave pending, will retry on next sync event
    }
  }

  if (synced > 0) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', synced }));
  }
}
