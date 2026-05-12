import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

// Activate immediately — no waiting for all tabs to close
self.skipWaiting();
clientsClaim();

// Precache the app shell (vite-plugin-pwa injects the asset list here)
precacheAndRoute(self.__WB_MANIFEST);

// ── Constants ────────────────────────────────────────────────────────────────

const SALE_RE     = /\/api\/sales$/;
const DB_NAME     = "POS_OfflineDB";
const STORE       = "pendingSales";
const SYNC_TAG    = "sync-pending-sales";
const REPLAY_HDR  = "x-replay-sync"; // request header set by syncService when replaying
const API_URL     = "https://partenaire-account-api.onrender.com/api/sales";
const ABORT_MS    = 4000;

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "POST") return;
  if (!SALE_RE.test(event.request.url)) return;
  // Replay requests from syncService.js — pass straight through. Without this,
  // a flaky reconnect would re-queue every replayed sale and create duplicates.
  if (event.request.headers.get(REPLAY_HDR)) {
    console.log("[SW] replay POST → passthrough", event.request.url);
    return;
  }
  console.log("[SW] intercepting sale POST", event.request.url);
  event.respondWith(handleSaleRequest(event.request));
});

async function handleSaleRequest(request) {
  // Read body up-front so we have it available in the offline branch.
  const body       = await request.clone().text();
  const authHeader = request.headers.get("Authorization") || "";

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), ABORT_MS);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    console.log("[SW] sale POST online → forwarding response", response.status);
    return response;
  } catch (err) {
    clearTimeout(timer);
    console.log("[SW] sale POST offline → queuing", err && err.name);

    let localId;
    try {
      localId = await saveToOfflineQueue(JSON.parse(body), authHeader);
      console.log("[SW] queued sale", localId);

      // Register background sync (browsers that support it will retry on reconnect)
      if ("sync" in self.registration) {
        self.registration.sync.register(SYNC_TAG).catch(() => {});
      }

      // Notify open tabs so the UI can refresh the offline-pending count immediately
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

// ── Client message handler ───────────────────────────────────────────────────

self.addEventListener("message", async (event) => {
  if (event.data?.type === "GET_PENDING_COUNT") {
    try {
      const sales = await getPending();
      event.source && event.source.postMessage({ type: "PENDING_COUNT", count: sales.length });
    } catch (e) {
      console.error("[SW] GET_PENDING_COUNT failed", e);
    }
  }
});

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
  const db = await openDB();
  // 9 chars of base36 entropy — matches client-side offlineStore.generateLocalId.
  // Avoids same-millisecond collisions on rapid offline sales.
  const localId = "local_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
  try {
    return await new Promise((resolve, reject) => {
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
  } finally {
    db.close();
  }
}

async function getPending() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).filter(r => r.status === "pending"));
      req.onerror   = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function markSynced(localId) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
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
  } finally {
    db.close();
  }
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
          // Mark as replay so our own fetch handler passes it through
          [REPLAY_HDR]: "1",
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
