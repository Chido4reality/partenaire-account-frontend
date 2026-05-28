// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 2
//
// Network status — one unified API across native (Capacitor) and
// web (npm run dev / vercel) so components don't have to branch.
//
// On native: @capacitor/network gives accurate Wi-Fi/cellular state
// and connectivity-type info, with event-driven changes.
// On web: falls back to navigator.onLine + window 'online'/'offline'
// listeners. Browsers don't expose connection type reliably, so we
// just report 'unknown' on web.
//
// Slice 3 (the offline sync engine) will subscribe to onChange() to
// trigger the pending_sync flush as soon as the device reconnects.

let _capacitorNetwork = null;

// Detect native synchronously via the window.Capacitor global the native runtime
// injects BEFORE our JS bundle executes. We can't use `import('@capacitor/core')`
// here: Vite ships dynamic imports as separate chunks, and that chunk fetch hangs
// when the device is offline — which blocks ensureLoaded(), which blocks
// getNetworkStatus(), which blocks the offlineAwareAdapter from ever returning,
// which keeps the POS Pay button spinning until the network comes back. On web
// window.Capacitor is undefined; skip the @capacitor/network import entirely and
// fall through to the navigator.onLine + cached-event-flag path below.
const IS_NATIVE = typeof window !== 'undefined'
                  && typeof window.Capacitor !== 'undefined'
                  && typeof window.Capacitor.isNativePlatform === 'function'
                  && window.Capacitor.isNativePlatform();

// Web-only: cached REAL-connectivity flag. Updated by (a) window
// online/offline events and (b) a periodic HEAD /health ping. The ping is
// the important bit: navigator.onLine only knows whether a network interface
// exists — it reports "online" on a router/hotspot whose upstream is dead
// (the common Cameroon flaky-network case), so a request fires and hangs.
// The ping closes that blind spot for BOTH the OnlineOfflineBar (via _subs)
// and getNetworkStatus (which reads _cachedOnline). Also catches
// DevTools-emulated offline (crbug 423246: event fires but navigator.onLine
// can stay true).
let _cachedOnline = typeof navigator !== 'undefined' ? !!navigator.onLine : true;
let _webListenersWired = false;
const _subs = new Set();                                   // onNetworkChange web subscribers
const HEALTH_URL = (import.meta.env.VITE_API_URL || '/api') + '/health';
let _healthTimer = null;

// Notify web subscribers on change only.
function _notifyWeb(connected) {
  if (connected === _cachedOnline) return;
  _cachedOnline = connected;
  const status = { connected, connectionType: 'unknown', source: 'web' };
  _subs.forEach(cb => { try { cb(status); } catch { /* noop */ } });
}

// Any HTTP response (even 404/405) proves the backend is reachable; only a
// 3s abort or a network error counts as offline.
async function pingHealth() {
  try {
    const c = new AbortController();
    const tid = setTimeout(() => c.abort(), 3000);
    await fetch(HEALTH_URL, { method: 'HEAD', cache: 'no-store', signal: c.signal });
    clearTimeout(tid);
    return true;
  } catch { return false; }
}

function wireWebListeners() {
  if (_webListenersWired || typeof window === 'undefined') return;
  // 'online' can fire optimistically before upstream is truly reachable —
  // confirm with a ping. 'offline' is authoritative → go offline now.
  window.addEventListener('online',  () => { pingHealth().then(_notifyWeb); });
  window.addEventListener('offline', () => { _notifyWeb(false); });
  _webListenersWired = true;
}

// Periodic 3s real-connectivity poll (web only — native uses Capacitor
// Network events). Flips _cachedOnline + notifies the bar, and (since
// getNetworkStatus reads _cachedOnline) lets the write adapter enqueue
// immediately on dead-upstream instead of waiting out the 15s write timeout.
function startWebHealthMonitor() {
  if (_healthTimer || IS_NATIVE) return;
  wireWebListeners();
  const tick = async () => { _notifyWeb(await pingHealth()); };
  tick();
  _healthTimer = setInterval(tick, 3000);
}

// On native, lazy-load @capacitor/network on first use. Web short-circuits to
// the navigator/event fallback without any dynamic import.
async function ensureLoaded() {
  if (_capacitorNetwork !== null) return;
  if (!IS_NATIVE) { _capacitorNetwork = false; return; }
  try {
    const net = await import('@capacitor/network');
    _capacitorNetwork = net.Network;
  } catch {
    _capacitorNetwork = false;
  }
}

// Current status — async because Capacitor's getStatus is async on
// native; web path resolves synchronously but kept async-shaped for
// caller uniformity.
export async function getNetworkStatus() {
  await ensureLoaded();
  if (_capacitorNetwork) {
    try {
      const s = await _capacitorNetwork.getStatus();
      return {
        connected:      !!s.connected,
        connectionType: s.connectionType || 'unknown',
        source:         'capacitor',
      };
    } catch {
      // Native plugin failed — fall through to navigator
    }
  }
  wireWebListeners();
  const navOnline = typeof navigator !== 'undefined' ? !!navigator.onLine : true;
  return {
    // Either signal saying "offline" wins: cached catches DevTools-only
    // emulation (which fires the event but leaves navigator.onLine true);
    // navOnline catches a true OS-level disconnect that races listener wiring.
    connected:      _cachedOnline && navOnline,
    connectionType: 'unknown',
    source:         'web',
  };
}

// Subscribe to network changes. Returns an unsubscribe function.
// Both surfaces hand the same { connected, connectionType, source }
// shape to the callback.
export function onNetworkChange(cb) {
  let active = true;
  let capHandle = null;

  ensureLoaded().then(() => {
    if (!active) return;
    if (_capacitorNetwork) {
      try {
        // Capacitor 6's addListener returns a Promise<PluginListenerHandle>
        const handlePromise = _capacitorNetwork.addListener(
          'networkStatusChange',
          (s) => cb({
            connected:      !!s.connected,
            connectionType: s.connectionType || 'unknown',
            source:         'capacitor',
          }),
        );
        Promise.resolve(handlePromise).then(h => { if (active) capHandle = h; });
        return;
      } catch {
        // fall through to web fallback
      }
    }
    if (typeof window !== 'undefined') {
      // Web: subscribe to the shared health-monitor channel. The monitor
      // (window online/offline events + 3s HEAD /health poll) calls every
      // subscriber via _notifyWeb on a real-connectivity change.
      _subs.add(cb);
      startWebHealthMonitor();
    }
  });

  return () => {
    active = false;
    _subs.delete(cb);
    if (capHandle) { try { capHandle.remove(); } catch { /* noop */ } }
  };
}
