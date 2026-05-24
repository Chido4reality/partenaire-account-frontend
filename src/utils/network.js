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
let _isCapacitor = false;

// Web-only: cached online flag kept in sync via window 'online'/'offline'
// events. Needed because Chromium DevTools fires the offline event reliably
// but doesn't always set navigator.onLine = false (crbug 423246 family) —
// so reading navigator.onLine alone makes the adapter miss DevTools-emulated
// offline even when OnlineOfflineBar (which is event-driven) sees it.
let _cachedOnline = typeof navigator !== 'undefined' ? !!navigator.onLine : true;
let _webListenersWired = false;
function wireWebListeners() {
  if (_webListenersWired || typeof window === 'undefined') return;
  window.addEventListener('online',  () => { _cachedOnline = true;  });
  window.addEventListener('offline', () => { _cachedOnline = false; });
  _webListenersWired = true;
}

// Lazy import so the web bundle doesn't pay the Capacitor cost on
// pages where it's not used (defensive — the runtime stub is small,
// but principled).
async function ensureLoaded() {
  if (_capacitorNetwork !== null) return;
  try {
    const cap = await import('@capacitor/core');
    _isCapacitor = cap.Capacitor?.isNativePlatform?.() === true;
    if (_isCapacitor) {
      const net = await import('@capacitor/network');
      _capacitorNetwork = net.Network;
    } else {
      _capacitorNetwork = false; // mark as resolved, web fallback
    }
  } catch {
    _capacitorNetwork = false; // package not installed → web fallback
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
  let webOnline = null;
  let webOffline = null;

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
      webOnline  = () => cb({ connected: true,  connectionType: 'unknown', source: 'web' });
      webOffline = () => cb({ connected: false, connectionType: 'unknown', source: 'web' });
      window.addEventListener('online',  webOnline);
      window.addEventListener('offline', webOffline);
    }
  });

  return () => {
    active = false;
    if (capHandle) { try { capHandle.remove(); } catch { /* noop */ } }
    if (webOnline)  window.removeEventListener('online',  webOnline);
    if (webOffline) window.removeEventListener('offline', webOffline);
  };
}
