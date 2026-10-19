// LEARN (2026-10-18): the link to the video lessons (public/learn.html).
// On the web it is a plain anchor to /learn — a full page load, never a router <Link>, because /learn
// is a static page outside the React app.
// In the Android app (vc119+) the lessons open INSIDE the app: Capacitor serves the bundled
// learn.html from the same origin as the app (https://localhost), so a signed-in member's token is
// already there and members-only lessons play without a second login. Tested on the WebView: YouTube
// embeds play (with sound after a tap), Back returns to the screen the user came from. The path must
// be /learn.html — Capacitor answers an extension-less /learn with the app shell (see LearnBounce).
// LEARN_URL (the public site) is kept for anything that must point outside the app.
export const LEARN_URL = "https://book.stenamo.com/learn";
export const IN_APP_LEARN = "/learn.html";

const isNative = () => {
  try { return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
};

// True in the Android app, where the lessons open inside the app (no "opens elsewhere" arrow).
export function learnOpensInApp() { return isNative(); }

export function learnHref() {
  return isNative() ? IN_APP_LEARN : "/learn";
}

export default function LearnLink({ children, style, className }) {
  return (
    <a href={learnHref()} className={className} style={style} data-learn-link="1">
      {children}
    </a>
  );
}
