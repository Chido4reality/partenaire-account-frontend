// syncService.js — Syncs offline sales to server when internet returns
import { getPendingSales, markSaleSynced, incrementSyncAttempt } from "./offlineStore";
import api from "./api";

let isSyncing = false;
let syncListeners = [];

export function onSyncUpdate(callback) {
  syncListeners.push(callback);
  return () => { syncListeners = syncListeners.filter(l => l !== callback); };
}

function notifyListeners(status) {
  syncListeners.forEach(l => l(status));
}

export async function syncPendingSales() {
  if (isSyncing) return { synced: 0, failed: 0 };
  isSyncing = true;

  try {
    const pending = await getPendingSales();
    if (pending.length === 0) {
      isSyncing = false;
      return { synced: 0, failed: 0 };
    }

    notifyListeners({ status: "syncing", count: pending.length });

    let synced = 0;
    let failed = 0;

    for (const sale of pending) {
      // Skip if too many failed attempts
      if (sale.sync_attempts >= 5) {
        failed++;
        continue;
      }

      try {
        // Try to submit the sale to server
        const response = await api.post("/sales", {
          ...sale,
          local_id: sale.local_id, // Server stores this for deduplication
        });

        if (response?.data?.success) {
          await markSaleSynced(sale.local_id, response.data.data?.id);
          synced++;
        } else {
          await incrementSyncAttempt(sale.local_id);
          failed++;
        }
      } catch (err) {
        await incrementSyncAttempt(sale.local_id);
        failed++;
        // If it's a 409 conflict (already exists), mark as synced
        if (err.response?.status === 409) {
          await markSaleSynced(sale.local_id, null);
          synced++;
          failed--;
        }
      }
    }

    notifyListeners({ status: "done", synced, failed });
    return { synced, failed };
  } catch (err) {
    notifyListeners({ status: "error", error: err.message });
    return { synced: 0, failed: 0 };
  } finally {
    isSyncing = false;
  }
}

// Auto-sync when browser comes online
export function startAutoSync() {
  const handleOnline = async () => {
    console.log("🔵 Back online — syncing pending sales...");
    await syncPendingSales();
  };

  window.addEventListener("online", handleOnline);

  // Also try to sync immediately if online
  if (navigator.onLine) {
    syncPendingSales();
  }

  return () => window.removeEventListener("online", handleOnline);
}
