import { useState, useEffect, useCallback } from 'react';

const HEALTH_URL = "https://partenaire-server.onrender.com/api/health";

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  const checkRealConnection = useCallback(async () => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(HEALTH_URL, {
        method: 'HEAD', cache: 'no-store', signal: controller.signal
      });
      clearTimeout(tid);
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const goOnline = async () => {
      const real = await checkRealConnection();
      setIsOnline(real);
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Check every 3 seconds for faster detection
    const interval = setInterval(async () => {
      const real = await checkRealConnection();
      setIsOnline(real);
    }, 3000);

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
