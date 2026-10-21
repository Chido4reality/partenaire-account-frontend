// LEARN (2026-10-18): /learn is a static page (public/learn.html), not part of this app. The React
// app only renders here when something served it the app shell instead:
//   • a browser still running the PREVIOUS service worker (built before /learn joined its
//     navigateFallbackDenylist). Steps, each at most once per 2 minutes in this tab, so it can never
//     loop: (1) make the newest version take over (utils/swTakeover) and reload; (2) load
//     /learn.html directly; (3) if the old worker answers THAT with the app too, stop and say how to
//     get out (close the app's tabs) — never another redirect;
//   • the Android app (Capacitor serves the shell for every extension-less path) — load the bundled
//     lessons page, /learn.html, inside the app (same origin, so the member's login carries over).
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IN_APP_LEARN } from "../components/common/LearnLink";
import { takeOverAndReload } from "../utils/swTakeover";

const FLAG = "learn-bounce-tried-at";
const WINDOW_MS = 2 * 60 * 1000;

export default function LearnBounce() {
  const location = useLocation();
  const navigate = useNavigate();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const m = /^\/learn\/([a-z0-9-]+)\/?$/.exec(location.pathname);
    const slugQ = new URLSearchParams(location.search).get("l");
    const slug = m ? m[1] : (slugQ && /^[a-z0-9-]+$/.test(slugQ) ? slugQ : null);
    const direct = "/learn.html" + (slug ? "?l=" + slug : "");
    if (window.Capacitor?.isNativePlatform?.()) {
      window.location.replace(IN_APP_LEARN + (slug ? "?l=" + slug : ""));
      return;
    }
    let tried = false;
    try {
      tried = Date.now() - Number(sessionStorage.getItem(FLAG) || 0) < WINDOW_MS;
      if (!tried) sessionStorage.setItem(FLAG, String(Date.now()));
    } catch { /* storage off: treat as tried — never risk a loop */ tried = true; }
    if (!tried) {
      // A waiting version is told to take over and the page reloads once; if nothing could be
      // reloaded (no service worker, or a reload already happened this minute) go straight to the page.
      takeOverAndReload()
        .then((reloading) => { if (!reloading) window.location.replace(direct); })
        .catch(() => window.location.replace(direct));
      return;
    }
    if (!location.pathname.startsWith("/learn.html")) { window.location.replace(direct); return; }
    setStuck(true);   // /learn.html itself came back as the app: stop here
  }, [location.pathname, location.search, navigate]);
  if (stuck) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, textAlign: "center", color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
        <div style={{ maxWidth: 360, display: "grid", gap: 12 }}>
          <p>Une ancienne version de l’application est encore ouverte. Fermez tous les onglets Stenamo Book, puis rouvrez les leçons.</p>
          <p>An older version of the app is still open. Close every Stenamo Book tab, then open the lessons again.</p>
          <a href="/" style={{ color: "var(--brand)", fontWeight: 600 }}>Retour à l’application · Back to the app</a>
        </div>
      </div>
    );
  }
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--text-secondary)", fontSize: 14 }}>
      Chargement des leçons… · Loading the lessons…
    </div>
  );
}
