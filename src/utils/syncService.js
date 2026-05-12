import api from './api';
import { getPendingSales, markSaleSynced, markSaleFailed, clearSyncedSales } from './offlineStore';

let isSyncing = false;

export const processPendingQueue = async () => {
  if (isSyncing) return { synced: 0, total: 0 };
  isSyncing = true;

  try {
    const pending = await getPendingSales();
    if (pending.length === 0) return { synced: 0, total: 0 };

    console.log(`Syncing ${pending.length} pending sales...`);
    let synced = 0;

    for (const item of pending) {
      try {
        // The x-replay-sync header signals our service worker to pass this
        // request straight through instead of treating a failure as a new
        // offline queue entry (which would create duplicates on reconnect).
        const res = await api.post('/sales', item.payload, {
          timeout: 12000,
          headers: { 'x-replay-sync': '1' },
        });
        if (res.data?.success) {
          await markSaleSynced(item.local_id, res.data?.data?.id);
          synced++;
        }
      } catch (err) {
        console.error(`Failed to sync ${item.local_id}`, err?.message);
        await markSaleFailed(item.local_id, err?.message || 'Unknown error');
      }
    }

    await clearSyncedSales();
    console.log(`Synced ${synced}/${pending.length}`);
    return { synced, total: pending.length };
  } finally {
    isSyncing = false;
  }
};

export const startAutoSync = () => {
  // Auto sync when browser comes back online
  const handleOnline = () => {
    setTimeout(() => processPendingQueue(), 1000);
  };

  // Auto sync when tab becomes visible
  const handleVisible = () => {
    if (document.visibilityState === 'visible') {
      processPendingQueue();
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisible);

  // Try sync on start
  processPendingQueue();

  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisible);
  };
};

// Backward compat stub
export const onSyncUpdate = (cb) => { return () => {}; };
