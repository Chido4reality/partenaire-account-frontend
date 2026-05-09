// OfflineBanner.jsx — Shows offline status and pending sync count
import { useState, useEffect } from "react";
import { getPendingCount, clearSyncedSales } from "../../utils/offlineStore";
import { syncPendingSales, onSyncUpdate } from "../../utils/syncService";

export default function OfflineBanner({ lang = "fr", collapsed = false }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(null); // null | "syncing" | "done" | "error"
  const [lastSynced, setLastSynced] = useState(null);

  useEffect(() => {
    // Track online/offline status
    const handleOnline = () => { setIsOnline(true); refreshCount(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Track sync updates
    const unsubscribe = onSyncUpdate((status) => {
      setSyncStatus(status.status);
      if (status.status === "done") {
        setLastSynced(new Date());
        refreshCount();
        setTimeout(() => setSyncStatus(null), 3000);
      }
    });

    // Initial count
    refreshCount();

    // Poll pending count every 10s
    const interval = setInterval(refreshCount, 10000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const refreshCount = async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  };

  const handleManualSync = async () => {
    if (!isOnline) return;
    setSyncStatus("syncing");
    await syncPendingSales();
    await clearSyncedSales();
    await refreshCount();
  };

  // Online with no pending — show nothing or minimal
  if (isOnline && pendingCount === 0 && !syncStatus) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", padding: collapsed ? "4px 0" : "4px 0", justifyContent: collapsed ? "center" : "flex-start" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
        {!collapsed && <span>Online</span>}
      </div>
    );
  }

  // Syncing
  if (syncStatus === "syncing") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#60a5fa", padding: "4px 0" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", flexShrink: 0, animation: "pulse 1s infinite" }} />
        {!collapsed && <span>Syncing...</span>}
      </div>
    );
  }

  // Just finished syncing
  if (syncStatus === "done") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#34d399", padding: "4px 0" }}>
        <span>✅</span>
        {!collapsed && <span>Synced!</span>}
      </div>
    );
  }

  // Offline
  if (!isOnline) {
    return (
      <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: collapsed ? "6px" : "8px 10px", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
          {!collapsed && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>
                {lang === "en" ? "Offline" : "Hors ligne"}
              </div>
              {pendingCount > 0 && (
                <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 1 }}>
                  {pendingCount} {lang === "en" ? "sale(s) pending" : "vente(s) en attente"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Online but has pending sales
  if (isOnline && pendingCount > 0) {
    return (
      <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: collapsed ? "6px" : "8px 10px", marginBottom: 4, cursor: "pointer" }}
        onClick={handleManualSync}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12 }}>🔄</span>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>
                {pendingCount} {lang === "en" ? "pending" : "en attente"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                {lang === "en" ? "Tap to sync" : "Appuyer pour sync"}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
