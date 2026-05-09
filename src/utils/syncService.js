import api from './api';
import { getPendingSales, markSaleSynced, markSaleFailed, clearSyncedSales } from './offlineStore';

export const processPendingQueue = async () => {
  const pending = await getPendingSales();
  if (pending.length === 0) return { synced: 0, total: 0 };

  console.log(`Syncing ${pending.length} pending sales...`);
  let synced = 0;

  for (const item of pending) {
    try {
      const res = await api.post('/sales', item.payload, { timeout: 12000 });
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
};

export const startAutoSync = () => {
  const handleOnline = () => processPendingQueue();
  const handleVisible = () => {
    if (document.visibilityState === 'visible') processPendingQueue();
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

// Keep backward compat
export const onSyncUpdate = (cb) => { return () => {}; };
