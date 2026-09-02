import { useState, useEffect } from 'react';
import { getNetworkStatus, onNetworkChange } from './network';

// MP-ONE-HEALTH-SIGNAL: this hook used to run its OWN health poll — a HEAD
// /health every 3 seconds with a 2.5s abort. That was 20 requests/minute for as
// long as VoidReturnModal or TicketListPage was mounted, i.e. exactly while a
// cashier is mid-void on a bad link and the real request needs the bandwidth.
//
// It was also a SECOND, independent notion of "online", with its own URL and its
// own threshold, and its result never fed `degraded` in network.js. So the app
// could believe it was online here while the write path had already decided the
// link was degraded, or the reverse. One signal, one source of truth.
//
// Now it reads the shared status from utils/network.js: one read on mount, then
// event-driven updates via onNetworkChange (Capacitor Network events on native,
// the navigator/ping path on web). No timer of its own.
//
// API is unchanged on purpose — consumers still destructure { isOnline } — so
// this is a transport swap, not a behaviour change at the call sites.
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let alive = true;

    // Seed from the shared status rather than assuming online, so a screen
    // opened while already offline renders its blocked state on first paint.
    getNetworkStatus()
      .then((s) => { if (alive) setIsOnline(!!s.connected); })
      .catch(() => { /* shared status unavailable: leave the optimistic default */ });

    const unsub = onNetworkChange((s) => { if (alive) setIsOnline(!!s.connected); });

    return () => {
      alive = false;
      // onNetworkChange returns its unsubscribe; guard in case that ever changes.
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  return { isOnline };
}

export default useNetworkStatus;
