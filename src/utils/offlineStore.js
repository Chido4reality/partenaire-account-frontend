// offlineStore.js — IndexedDB-based offline queue for sales
// This runs in the browser and persists data across page refreshes

const DB_NAME = "mon_partenaire_offline";
const DB_VERSION = 1;
const STORE_SALES = "pending_sales";
const STORE_CACHE = "cache";

let db = null;

// Initialize IndexedDB
export async function initDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_SALES)) {
        const store = database.createObjectStore(STORE_SALES, { keyPath: "local_id" });
        store.createIndex("created_at", "created_at");
        store.createIndex("synced", "synced");
      }
      if (!database.objectStoreNames.contains(STORE_CACHE)) {
        database.createObjectStore(STORE_CACHE, { keyPath: "key" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// Generate a local ID for offline sales
export function generateLocalId() {
  return `LOCAL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// Save a pending sale to IndexedDB
export async function savePendingSale(saleData) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SALES, "readwrite");
    const store = tx.objectStore(STORE_SALES);
    const record = {
      ...saleData,
      local_id: saleData.local_id || generateLocalId(),
      created_at: new Date().toISOString(),
      synced: false,
      sync_attempts: 0
    };
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Get all pending (unsynced) sales
export async function getPendingSales() {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SALES, "readonly");
    const store = tx.objectStore(STORE_SALES);
    const index = store.index("synced");
    const request = index.getAll(IDBKeyRange.only(false));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Mark a sale as synced
export async function markSaleSynced(local_id, server_id) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SALES, "readwrite");
    const store = tx.objectStore(STORE_SALES);
    const getReq = store.get(local_id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.synced = true;
        record.server_id = server_id;
        record.synced_at = new Date().toISOString();
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

// Increment sync attempt count (for failed syncs)
export async function incrementSyncAttempt(local_id) {
  const database = await initDB();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_SALES, "readwrite");
    const store = tx.objectStore(STORE_SALES);
    const getReq = store.get(local_id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.sync_attempts = (record.sync_attempts || 0) + 1;
        record.last_sync_error = new Date().toISOString();
        store.put(record);
      }
      resolve();
    };
  });
}

// Get count of pending sales
export async function getPendingCount() {
  try {
    const pending = await getPendingSales();
    return pending.length;
  } catch {
    return 0;
  }
}

// Cache products/stock data for offline use
export async function cacheData(key, data) {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const tx = database.transaction(STORE_CACHE, "readwrite");
      const store = tx.objectStore(STORE_CACHE);
      store.put({ key, data, cached_at: new Date().toISOString() });
      resolve();
    });
  } catch (e) {
    console.warn("Cache write failed:", e);
  }
}

// Get cached data
export async function getCachedData(key) {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const tx = database.transaction(STORE_CACHE, "readonly");
      const store = tx.objectStore(STORE_CACHE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// Clear all synced sales (cleanup)
export async function clearSyncedSales() {
  const database = await initDB();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_SALES, "readwrite");
    const store = tx.objectStore(STORE_SALES);
    const index = store.index("synced");
    const request = index.openCursor(IDBKeyRange.only(true));
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}
