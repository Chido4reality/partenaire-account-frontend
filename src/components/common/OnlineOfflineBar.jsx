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
import { subscribe as subscribePendingSync } from '../../utils/pendingSync';
import ConflictModal from './ConflictModal';

export default function OnlineOfflineBar() {
  const lang = useLangStore(s => s.lang);
  const en   = lang === 'en';
  const [connected, setConnected] = useState(true);
  // MP-CAPACITOR Slice 3: live pending_sync stats. Drives the
  // pending count badge, the syncing pulse, and the failed_permanent
  // amber-state badge that opens ConflictModal.
  const [stats, setStats] = useState({ queued: 0, sending: 0, failed_permanent: 0, failed_transient: 0 });
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    let mounted = true;
    getNetworkStatus().then(s => { if (mounted) setConnected(s.connected); });
    const unsubNet  = onNetworkChange(s => { if (mounted) setConnected(s.connected); });
    const unsubSync = subscribePendingSync(s => { if (mounted) setStats(s); });
    return () => { mounted = false; unsubNet(); unsubSync(); };
  }, []);

  const pendingCount    = (stats.queued || 0) + (stats.failed_transient || 0);
  const syncing         = (stats.sending || 0) > 0;
  const conflictCount   = stats.failed_permanent || 0;

  // Four visual tiers. failed_permanent takes precedence over the
  // pure-pending state because the cashier needs to know that
  // something needs their attention NOW.
  const tier = conflictCount > 0 ? 'conflict'
             : !connected ? 'offline'
             : syncing    ? 'syncing'
             : pendingCount > 0 ? 'pending'
             : 'online';

  const PALETTE = {
    online:  { bg: '#10b981', text: '#0b1220', emoji: '🟢',
               label: en ? 'Online · Synced' : 'En ligne · Synchronisé' },
    syncing: { bg: '#fbbf24', text: '#0b1220', emoji: '↻',
               label: en ? `Syncing ${stats.sending} item${stats.sending === 1 ? '' : 's'}…`
                         : `Synchronisation ${stats.sending} élément${stats.sending === 1 ? '' : 's'}…` },
    pending: { bg: '#fbbf24', text: '#0b1220', emoji: '↻',
               label: en ? `Online · ${pendingCount} pending sync`
                         : `En ligne · ${pendingCount} en attente` },
    offline: { bg: '#ef4444', text: '#ffffff', emoji: '🔴',
               label: en
                 ? (pendingCount > 0
                     ? `Offline · ${pendingCount} queued`
                     : 'Offline')
                 : (pendingCount > 0
                     ? `Hors ligne · ${pendingCount} en attente`
                     : 'Hors ligne') },
    conflict: { bg: '#fbbf24', text: '#0b1220', emoji: '⚠',
               label: en
                 ? `${conflictCount} sync conflict${conflictCount === 1 ? '' : 's'} — tap to review`
                 : `${conflictCount} conflit${conflictCount === 1 ? '' : 's'} — appuyez pour revoir` },
  };
  const p = PALETTE[tier];

  // Online with no pending/syncing/conflicts → collapse to a 4px
  // stripe so the bar doesn't burn vertical space during normal
  // operation. Every other state shows the full banner.
  const collapsed = tier === 'online';
  const clickable = tier === 'conflict';

  return (
    <>
      <div
        role={clickable ? 'button' : 'status'}
        aria-live="polite"
        onClick={clickable ? () => setShowConflicts(true) : undefined}
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
          cursor:     clickable ? 'pointer' : 'default',
          transition: 'height 180ms ease, padding 180ms ease, background 180ms ease',
        }}
      >
        {!collapsed && (
          <span>
            <span aria-hidden="true" style={{
              marginRight: 6,
              display: 'inline-block',
              animation: syncing ? 'mpSyncSpin 1s linear infinite' : undefined,
            }}>{p.emoji}</span>
            {p.label}
          </span>
        )}
        <style>{`
          @keyframes mpSyncSpin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
        `}</style>
      </div>
      {showConflicts && <ConflictModal onClose={() => setShowConflicts(false)} />}
    </>
  );
}
