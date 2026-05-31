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
// online/offline events and (b) a periodic HEAD /health ping.
//
// MP-PHASE-4 CAMEROON-NETWORK-FLAP: the original design treated the ping
// as the primary signal of "are we online?". On a Cameroon mobile network
// to a US-Render backend, a single round-trip can blow past a 3s budget
// while real connectivity is fine — that flipped the cached flag false
// every poll, which (1) flapped the OnlineOfflineBar red, and (2)
// caused offlineAwareAdapter to enqueue sales as optimistic 202s
// instead of trying the network, confusing the cashier and creating
// double-write risk if they re-submitted.
//
// New model:
//   - navigator.onLine is the PRIMARY signal. It's event-driven, stable,
//     and accurately reports "is this device on a network" — which is
//     the question Paul/Nora actually care about for the indicator and
//     for deciding whether to skip the network in the adapter.
//   - The /health ping demoted to CONFIRMATION. Used only to catch the
//     "connected to AP but upstream is dead" case (captive portal /
//     dead ISP). To avoid flap, we require 3 CONSECUTIVE ping failures
//     before flipping offline despite navigator saying online. A single
//     successful ping at any time resets the counter to zero.
//   - Ping timeout 3s → 6s gives slow Cameroon round-trips room to land.
//   - Poll interval 3s → 10s halves polling overhead and combines with
//     the threshold into a ~30s real-outage detection window — the right
//     trade-off for an offline-first POS where the adapter's own 15s
//     write timeout + response-interceptor enqueue catches the brief
//     false-negative window anyway.
//
// Counter lives in module state — NOT persisted across reloads. After
// refresh, navigator events re-fire and the next ping result re-
// establishes truth from scratch.
let _cachedOnline = typeof navigator !== 'undefined' ? !!navigator.onLine : true;
let _webListenersWired = false;
const _subs = new Set();                                   // onNetworkChange web subscribers
const HEALTH_URL = (import.meta.env.VITE_API_URL || '/api') + '/health';
let _healthTimer = null;
const PING_TIMEOUT_MS    = 6000;
const PING_INTERVAL_MS   = 10000;
const OFFLINE_FAIL_THRESHOLD = 3; // consecutive ping fails required to
                                   // override navigator-says-online
let _consecutiveFails = 0;

// Notify web subscribers on change only.
function _notifyWeb(connected) {
  if (connected === _cachedOnline) return;
  _cachedOnline = connected;
  const status = { connected, connectionType: 'unknown', source: 'web' };
  _subs.forEach(cb => { try { cb(status); } catch { /* noop */ } });
}

// Compute the effective connected state from navigator + the ping fail
// counter. Centralised so wireWebListeners + the periodic tick stay in
// sync on the same decision rule.
function _effectiveOnline() {
  const navOnline = typeof navigator !== 'undefined' ? !!navigator.onLine : true;
  if (!navOnline) return false;                          // event-driven hard offline
  if (_consecutiveFails >= OFFLINE_FAIL_THRESHOLD) return false; // confirmed dead upstream
  return true;                                            // happy path / brief flake
}

// Any HTTP response (even 404/405) proves the backend is reachable; only a
// 6s abort or a network error counts as a failed ping. A success
// immediately resets the consecutive-fail counter so a single recovery
// flips us back online without waiting for additional polls.
async function pingHealth() {
  try {
    const c = new AbortController();
    const tid = setTimeout(() => c.abort(), PING_TIMEOUT_MS);
    await fetch(HEALTH_URL, { method: 'HEAD', cache: 'no-store', signal: c.signal });
    clearTimeout(tid);
    _consecutiveFails = 0;
    return true;
  } catch {
    _consecutiveFails++;
    return false;
  }
}

function wireWebListeners() {
  if (_webListenersWired || typeof window === 'undefined') return;
  // 'online' fires when the OS gains a network interface. Trust it
  // immediately AND reset the ping counter — a single optimistic ping
  // can confirm the upstream, but we shouldn't keep the user offline
  // while the ping completes. 'offline' stays authoritative.
  window.addEventListener('online',  () => {
    _consecutiveFails = 0;
    _notifyWeb(_effectiveOnline());
    pingHealth().then(() => _notifyWeb(_effectiveOnline()));
  });
  window.addEventListener('offline', () => {
    _notifyWeb(false);
  });
  _webListenersWired = true;
}

// Periodic real-connectivity poll (web only — native uses Capacitor
// Network events). Flips _cachedOnline + notifies the bar based on
// _effectiveOnline (which combines navigator state with the consecutive-
// fail counter). The adapter's pre-flight read of getNetworkStatus()
// sees the same state, so writes only skip the network when navigator
// confirms offline OR the ping has failed enough consecutive times to
// indicate a real dead-upstream rather than a slow round-trip.
function startWebHealthMonitor() {
  if (_healthTimer || IS_NATIVE) return;
  wireWebListeners();
  const tick = async () => {
    await pingHealth();
    _notifyWeb(_effectiveOnline());
  };
  tick();
  _healthTimer = setInterval(tick, PING_INTERVAL_MS);
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
