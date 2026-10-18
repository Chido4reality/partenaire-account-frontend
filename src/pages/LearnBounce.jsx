// LEARN (2026-10-18): /learn is a static page (public/learn.html), not part of this app. The React
// app only renders here when something served it the app shell instead:
//   • a browser still running the PREVIOUS service worker (built before /learn joined its
//     navigateFallbackDenylist) — ask it to update, then reload once; if that does not help,
//     load /learn.html directly;
//   • the Android app (Capacitor serves the shell for every extension-less path) — load the bundled
//     lessons page, /learn.html, inside the app (same origin, so the member's login carries over).
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IN_APP_LEARN } from "../components/common/LearnLink";

const FLAG = "learn-bounce-tried";

export default function LearnBounce() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const m = /^\/learn\/([a-z0-9-]+)\/?$/.exec(location.pathname);
    const slug = m ? m[1] : null;
    const direct = "/learn.html" + (slug ? "?l=" + slug : "");
    if (window.Capacitor?.isNativePlatform?.()) {
      window.location.replace(IN_APP_LEARN + (slug ? "?l=" + slug : ""));
      return;
    }
    let tried = false;
    try { tried = sessionStorage.getItem(FLAG) === "1"; sessionStorage.setItem(FLAG, "1"); } catch { /* storage off */ }
    if (tried || location.pathname.startsWith("/learn.html")) { window.location.replace(direct); return; }
    const reload = () => window.location.reload();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => (reg ? reg.update() : null))
        .catch(() => null)
        .finally(reload);
    } else {
      window.location.replace(direct);
    }
  }, [location.pathname, navigate]);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--text-secondary)", fontSize: 14 }}>
      Chargement des leçons… · Loading the lessons…
    </div>
  );
}
