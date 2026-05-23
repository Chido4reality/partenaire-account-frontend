// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 2
//
// Top-of-screen connectivity indicator. Renders on every page via
// Layout.jsx. Reads from utils/network — Capacitor Network on
// native, navigator.onLine + window 'online'/'offline' events on web.
//
// Visual states (Slice 2):
//   🟢 Online   — bar collapses to a 4px stripe so it doesn't waste
//                 vertical space during normal operation.
//   🔴 Offline  — bar expands to a full-width banner with the FR/EN
//                 message. Stays visible until network returns.
//
// Slice 3 will widen the offline / pending vocabulary:
//   🟡 Online · Syncing 3 items
//   🔴 Offline · 5 pending
//   🟢 Online · Synced
// The component already accepts an optional `pendingCount` prop +
// `syncing` boolean so Slice 3 can wire pending_sync state in
// without refactoring this surface.

import { useEffect, useState } from 'react';
import { useLangStore } from '../../store';
import { getNetworkStatus, onNetworkChange } from '../../utils/network';

export default function OnlineOfflineBar({ pendingCount = 0, syncing = false }) {
  const lang = useLangStore(s => s.lang);
  const en   = lang === 'en';
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let mounted = true;
    getNetworkStatus().then(s => { if (mounted) setConnected(s.connected); });
    const unsub = onNetworkChange(s => { if (mounted) setConnected(s.connected); });
    return () => { mounted = false; unsub(); };
  }, []);

  // Three visual tiers (Slice 2 ships with two — online/offline.
  // syncing + pendingCount paths reserved for Slice 3 wire-up).
  const tier = !connected ? 'offline'
             : syncing    ? 'syncing'
             : pendingCount > 0 ? 'pending'
             : 'online';

  const PALETTE = {
    online:  { bg: '#10b981', text: '#0b1220', emoji: '🟢',
               label: en ? 'Online · Synced' : 'En ligne · Synchronisé' },
    syncing: { bg: '#fbbf24', text: '#0b1220', emoji: '🟡',
               label: en ? `Online · Syncing ${pendingCount} item${pendingCount === 1 ? '' : 's'}`
                         : `En ligne · Synchronisation ${pendingCount} élément${pendingCount === 1 ? '' : 's'}` },
    pending: { bg: '#fbbf24', text: '#0b1220', emoji: '🟡',
               label: en ? `Online · ${pendingCount} pending`
                         : `En ligne · ${pendingCount} en attente` },
    offline: { bg: '#ef4444', text: '#ffffff', emoji: '🔴',
               label: en
                 ? (pendingCount > 0
                     ? `Offline · ${pendingCount} pending`
                     : 'Offline')
                 : (pendingCount > 0
                     ? `Hors ligne · ${pendingCount} en attente`
                     : 'Hors ligne') },
  };
  const p = PALETTE[tier];

  // Online with no pending/syncing → collapse to a 4px stripe so the
  // bar doesn't burn vertical space during normal operation. Every
  // other state shows the full banner.
  const collapsed = tier === 'online';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position:   'sticky',
        top:        0,
        zIndex:     200,
        width:      '100%',
        background: p.bg,
        color:      p.text,
        fontSize:   12,
        fontWeight: 700,
        textAlign:  'center',
        padding:    collapsed ? '2px 0' : '6px 12px',
        height:     collapsed ? 4       : 'auto',
        overflow:   'hidden',
        transition: 'height 180ms ease, padding 180ms ease, background 180ms ease',
      }}
    >
      {!collapsed && (
        <span>
          <span aria-hidden="true" style={{ marginRight: 6 }}>{p.emoji}</span>
          {p.label}
        </span>
      )}
    </div>
  );
}
