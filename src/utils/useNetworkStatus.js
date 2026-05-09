import { useState, useEffect, useCallback } from 'react';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  const checkRealConnection = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('/api/health', {
        method: 'HEAD', cache: 'no-store', signal: controller.signal
      });
      clearTimeout(tid);
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Real check every 7 seconds
    const interval = setInterval(async () => {
      const real = await checkRealConnection();
      setIsOnline(real);
    }, 7000);

    // Initial check
    checkRealConnection().then(setIsOnline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
  }, [checkRealConnection]);

  return { isOnline };
}
