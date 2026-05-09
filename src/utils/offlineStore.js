import Dexie from 'dexie';

class OfflineDB extends Dexie {
  constructor() {
    super('POS_OfflineDB');
    this.version(1).stores({
      pendingSales: 'local_id, status, created_at'
    });
  }
}

export const db = new OfflineDB();

export const generateLocalId = () =>
  `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const initDB = async () => { await db.open(); };

export const savePendingSale = async (salePayload) => {
  const pending = {
    local_id: generateLocalId(),
    status: 'pending',
    created_at: new Date().toISOString(),
    payload: salePayload,
  };
  await db.pendingSales.add(pending);
  return pending;
};

export const markSaleSynced = async (local_id, server_id) => {
  await db.pendingSales.update(local_id, {
    status: 'synced',
    server_id: server_id || null,
    synced_at: new Date().toISOString(),
  });
};

export const markSaleFailed = async (local_id, error) => {
  await db.pendingSales.update(local_id, { status: 'failed', error });
};

export const getPendingSales = async () =>
  db.pendingSales.where('status').equals('pending').toArray();

export const getPendingCount = async () =>
  db.pendingSales.where('status').equals('pending').count();

export const clearSyncedSales = async () =>
  db.pendingSales.where('status').equals('synced').delete();

export const cacheData = async (key, data) => {
  try { localStorage.setItem('cache_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
};

export const getCachedData = async (key) => {
  try {
    const raw = localStorage.getItem('cache_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
