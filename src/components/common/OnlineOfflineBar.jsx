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
  // MP-DEGRADED-ROUTING: subtle ⚠ visual cue when the adapter has flipped
  // to "route writes through queue" but the indicator is still green
  // (connectivity isn't confirmed dead yet). Drives a small amber stripe
  // / icon — see PALETTE.degraded below. Set from the network status
  // shape's new `degraded` field; cleared the same way.
  const [degraded, setDegraded]   = useState(false);
  // MP-CAPACITOR Slice 3: live pending_sync stats. Drives the
  // pending count badge, the syncing pulse, and the failed_permanent
  // amber-state badge that opens ConflictModal.
  const [stats, setStats] = useState({ queued: 0, sending: 0, failed_permanent: 0, failed_transient: 0 });
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    let mounted = true;
    getNetworkStatus().then(s => {
      if (!mounted) return;
      setConnected(s.connected);
      setDegraded(!!s.degraded);
    });
    const unsubNet  = onNetworkChange(s => {
      if (!mounted) return;
      setConnected(s.connected);
      setDegraded(!!s.degraded);
    });
    const unsubSync = subscribePendingSync(s => { if (mounted) setStats(s); });
    return () => { mounted = false; unsubNet(); unsubSync(); };
  }, []);

  const pendingCount    = (stats.queued || 0) + (stats.failed_transient || 0);
  const syncing         = (stats.sending || 0) > 0;
  const conflictCount   = stats.failed_permanent || 0;

  // Five visual tiers (degraded added). failed_permanent takes
  // precedence over the pure-pending state because the cashier needs to
  // know that something needs their attention NOW. Degraded sits ABOVE
  // pure 'online' (so a flake without queue rows still gets a hint)
  // but BELOW syncing/pending (so when the queue has content the count
  // takes the spotlight). degraded label is intentionally small/
  // non-alarming — Paul's pain was the app "feels stuck", a subtle
  // amber stripe gives him awareness without crying wolf.
  const tier = conflictCount > 0 ? 'conflict'
             : !connected ? 'offline'
             : syncing    ? 'syncing'
             : pendingCount > 0 ? 'pending'
             : degraded   ? 'degraded'
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
    // MP-DEGRADED-ROUTING: muted amber, ⚠ icon, short non-alarming
    // copy. Same height as 'pending' (full bar, not collapsed)
    // because the cashier should glance and know writes are being
    // saved locally — but the wording is "saving" not "offline" so
    // they don't panic.
    degraded: { bg: '#f59e0b', text: '#0b1220', emoji: '⚠',
                label: en ? 'Connection unstable · saving locally'
                          : 'Connexion instable · enregistrement local' },
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

  // MP-PAUL-SYNC-VISIBILITY: the bar is ALWAYS tappable now — tapping opens the
  // sync-queue view in every state. When synced it confirms "nothing pending";
  // when there are queued/failed rows it's how the cashier sees and retries
  // them (previously the bar only opened on the conflict tier, so queued/
  // transient sales were invisible). Synced renders as a slim-but-visible bar
  // (not a 4px dead stripe) so there's a clear positive "Synced" confirmation.
  const slim = tier === 'online';
  const clickable = true;

  return (
    <>
      <div
        role="button"
        aria-live="polite"
        title={en ? 'View sync queue' : 'Voir la file de synchronisation'}
        onClick={() => setShowConflicts(true)}
        style={{
          position:   'sticky',
          top:        0,
          zIndex:     200,
          width:      '100%',
          background: p.bg,
          color:      p.text,
          fontSize:   slim ? 11 : 12,
          fontWeight: 700,
          textAlign:  'center',
          padding:    slim ? '3px 8px' : '6px 12px',
          height:     'auto',
          overflow:   'hidden',
          cursor:     'pointer',
          transition: 'padding 180ms ease, background 180ms ease',
        }}
      >
        <span>
          <span aria-hidden="true" style={{
            marginRight: 6,
            display: 'inline-block',
            animation: syncing ? 'mpSyncSpin 1s linear infinite' : undefined,
          }}>{p.emoji}</span>
          {p.label}
        </span>
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
