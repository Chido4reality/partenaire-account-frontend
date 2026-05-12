import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

// Activate immediately — no waiting for all tabs to close
self.skipWaiting();
clientsClaim();

// Precache the app shell (vite-plugin-pwa injects the asset list here)
precacheAndRoute(self.__WB_MANIFEST);

// ── Constants ────────────────────────────────────────────────────────────────

const SALE_RE  = /\/api\/sales$/;
const DB_NAME  = "POS_OfflineDB";
const STORE    = "pendingSales";
const SYNC_TAG = "sync-pending-sales";
// Full URL used when replaying offline sales in syncPendingSales()
const API_URL  = "https://partenaire-account-api.onrender.com/api/sales";

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "POST") return;
  if (!SALE_RE.test(event.request.url)) return;
  event.respondWith(handleSaleRequest(event.request));
});

async function handleSaleRequest(request) {
  // Read body once up-front so we can use it in the catch block
  const body       = await request.clone().text();
  const authHeader = request.headers.get("Authorization") || "";

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);

    let localId;
    try {
      localId = await saveToOfflineQueue(JSON.parse(body), authHeader);

      // Register background sync so the sale replays when connection returns
      if ("sync" in self.registration) {
        self.registration.sync.register(SYNC_TAG).catch(() => {});
      }

      // Notify open app tabs so the UI can reflect the offline state
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: "SALE_SAVED_OFFLINE", local_id: localId }));
    } catch (dbErr) {
      console.error("[SW] IndexedDB save failed:", dbErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        offline: true,
        local_id: localId,
        data: { sale_number: "OFFLINE-" + Date.now() },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "local_id" });
      }
    };
    req.onsuccess = ({ target: { result } }) => resolve(result);
    req.onerror   = ({ target: { error  } }) => reject(error);
  });
}

async function saveToOfflineQueue(payload, authToken) {
  const db      = await openDB();
  const localId = "local_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add({
      local_id:   localId,
      payload,
      auth_token: authToken,
      status:     "pending",
      created_at: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(localId);
    req.onerror   = () => reject(req.error);
    tx.onerror    = () => reject(tx.error);
  });
}

async function getPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).filter(r => r.status === "pending"));
    req.onerror   = () => reject(req.error);
  });
}

async function markSynced(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get   = store.get(localId);
    get.onsuccess = () => {
      const rec = get.result;
      if (!rec) return resolve();
      rec.status    = "synced";
      rec.synced_at = new Date().toISOString();
      store.put(rec).onsuccess = () => resolve();
    };
    get.onerror = () => reject(get.error);
  });
}

// ── Background sync ──────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(syncPendingSales());
});

async function syncPendingSales() {
  const sales = await getPending();
  if (!sales.length) return;

  let synced = 0;
  for (const sale of sales) {
    try {
      const res = await fetch(API_URL, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": sale.auth_token,
        },
        body: JSON.stringify(sale.payload),
      });
      if (res.ok) {
        await markSynced(sale.local_id);
        synced++;
      }
    } catch { /* still offline — leave pending, retry on next sync event */ }
  }

  if (synced > 0) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: "SYNC_COMPLETE", synced }));
  }
}
