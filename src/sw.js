import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

// Bump this string whenever the offline behaviour changes so it's easy to
// confirm in DevTools which SW the browser is actually running. Open the
// service worker console and look for "[SW] booting vN".
const SW_VERSION = "v5-put-not-add";
console.log("[SW] booting", SW_VERSION);

// Activate immediately — no waiting for all tabs to close
self.skipWaiting();
clientsClaim();

// Precache the app shell (vite-plugin-pwa injects the asset list here)
precacheAndRoute(self.__WB_MANIFEST);

// ── Constants ────────────────────────────────────────────────────────────────

const SALE_RE       = /\/api\/sales$/;
const DB_NAME       = "POS_OfflineDB";
const STORE         = "pendingSales";
const SYNC_TAG      = "sync-pending-sales";
const REPLAY_HDR    = "x-replay-sync"; // request header set by syncService when replaying
const API_URL       = "https://partenaire-account-api.onrender.com/api/sales";
const HEALTH_URL    = "https://partenaire-account-api.onrender.com/api/health";
const HEALTH_MS     = 2000; // pre-flight timeout — fail fast when offline
const ABORT_MS      = 4000;

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
  // safeHandleSaleRequest wraps the real handler so an unexpected throw still
  // resolves the respondWith with a 200 offline response. Without this, a
  // single thrown error inside handleSaleRequest leaves the fetch event hung
  // forever — that's the "second sale never returns" symptom.
  event.respondWith(safeHandleSaleRequest(event.request));
});

async function safeHandleSaleRequest(request) {
  try {
    return await handleSaleRequest(request);
  } catch (err) {
    console.error("[SW] handleSaleRequest threw — falling back to offline response:", err);
    return new Response(
      JSON.stringify({
        success: true,
        offline: true,
        local_id: null,
        data: { sale_number: "OFFLINE-" + Date.now() },
        note: "SW handler crashed but did not hang"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Cheap HEAD probe — returns true if the API is reachable within HEALTH_MS,
// false otherwise. Lets us short-circuit straight to the offline queue without
// burning the full ABORT_MS budget on every sale when the network is down.
async function isServerReachable() {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), HEALTH_MS);
  try {
    // GET (not HEAD) — some hosts/proxies return 405 or strip CORS headers on
    // HEAD, which would falsely report unreachable. /api/health is small.
    const r = await fetch(HEALTH_URL, { signal: ctrl.signal, cache: "no-store" });
    return r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(tid);
  }
}

async function handleSaleRequest(request) {
  // Read body up-front so we have it available in the offline branch.
  const body       = await request.clone().text();
  const authHeader = request.headers.get("Authorization") || "";

  // Pre-flight health check. If the API is unreachable, queue the sale
  // immediately instead of waiting out the full ABORT_MS budget on the real POST.
  const reachable = await isServerReachable();
  if (!reachable) {
    console.log("[SW] pre-flight failed → queuing offline");
    return queueOfflineSale(body, authHeader);
  }

  // Reachable: try the real POST. Still race against ABORT_MS — server might
  // accept the connection but stall on processing, in which case we'd rather
  // queue than hang the UI indefinitely.
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error("SW-fetch-timeout")), ABORT_MS))
    ]);
    console.log("[SW] sale POST online → forwarding response", response.status);
    return response;
  } catch (err) {
    console.log("[SW] sale POST raced/failed after pre-flight passed → queuing", err && err.message);
    return queueOfflineSale(body, authHeader);
  }
}

// Persist a sale to IndexedDB and return the standard offline 200 response.
// Extracted so both the pre-flight-failed and post-flight-timeout paths share it.
async function queueOfflineSale(body, authHeader) {
  let localId;
  try {
    localId = await saveToOfflineQueue(JSON.parse(body), authHeader);
    console.log("[SW] queued sale", localId);

    if ("sync" in self.registration) {
      self.registration.sync.register(SYNC_TAG).catch(() => {});
    }

    // Notify open tabs so the UI can refresh the offline-pending count immediately.
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: "SALE_SAVED_OFFLINE", local_id: localId }));
    } catch (msgErr) { console.warn("[SW] postMessage failed (non-fatal):", msgErr); }
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
      // put() not add() — if the millisecond-resolution clock collides with a
      // prior local_id (extremely rare, but happens on rapid-fire sales),
      // add() throws ConstraintError and the second sale appears to hang from
      // the UI's perspective. put() overwrites instead.
      const req = tx.objectStore(STORE).put({
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
