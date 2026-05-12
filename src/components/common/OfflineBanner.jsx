// OfflineBanner.jsx — Shows offline status and pending sync count
import { useState, useEffect } from "react";
import { getPendingCount, clearSyncedSales } from "../../utils/offlineStore";
import { processPendingQueue } from "../../utils/syncService";

export default function OfflineBanner({ lang = "fr", collapsed = false }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(null);

  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);
      refreshCount();
      const result = await processPendingQueue();
      if (result.synced > 0) { await clearSyncedSales(); refreshCount(); }
    };
    const goOffline = () => setIsOnline(false);
    // The service worker posts these messages from sw.js — refresh immediately
    // instead of waiting for the next poll tick so the badge reflects each
    // offline sale as it happens.
    const onSWMessage = (e) => {
      if (e.data?.type === "SALE_SAVED_OFFLINE" || e.data?.type === "SYNC_COMPLETE") {
        refreshCount();
      }
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    navigator.serviceWorker?.addEventListener("message", onSWMessage);
    refreshCount();
    const interval = setInterval(refreshCount, 3000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
      clearInterval(interval);
    };
  }, []);

  const refreshCount = async () => { const count = await getPendingCount(); setPendingCount(count); };

  const handleManualSync = async () => {
    if (!isOnline) return;
    setSyncStatus("syncing");
    await processPendingQueue();
    await clearSyncedSales();
    await refreshCount();
    setSyncStatus("done");
    setTimeout(() => setSyncStatus(null), 3000);
  };

  if (syncStatus === "syncing") return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#60a5fa", padding: "4px 0" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", flexShrink: 0 }} />
      {!collapsed && <span>Syncing...</span>}
    </div>
  );

  if (syncStatus === "done") return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#34d399", padding: "4px 0" }}>
      <span>✅</span>{!collapsed && <span>Synced!</span>}
    </div>
  );

  if (!isOnline) return (
    <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: collapsed ? "6px" : "8px 10px", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
        {!collapsed && <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>🔴 {lang === "en" ? "Offline" : "Hors ligne"}</div>
          {pendingCount > 0 && <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 1 }}>{pendingCount} {lang === "en" ? "sale(s) pending" : "vente(s) en attente"}</div>}
        </div>}
      </div>
    </div>
  );

  if (pendingCount > 0) return (
    <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: collapsed ? "6px" : "8px 10px", marginBottom: 4, cursor: "pointer" }} onClick={handleManualSync}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12 }}>🔄</span>
        {!collapsed && <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>{pendingCount} {lang === "en" ? "pending" : "en attente"}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{lang === "en" ? "Tap to sync" : "Appuyer pour sync"}</div>
        </div>}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", padding: "4px 0" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
      {!collapsed && <span>Online</span>}
    </div>
  );
}
