// LEARN (2026-10-18): the link to the public video lessons (public/learn.html, served at /learn).
// On the web it is a plain anchor — a full page load, never a router <Link>, because /learn is a
// static page outside the React app. In the Android app it points at book.stenamo.com: Capacitor
// hands any link to another host to Android (Bridge.launchIntent → ACTION_VIEW), so the lessons
// open in the phone's browser and the app stays where it was.
export const LEARN_URL = "https://book.stenamo.com/learn";

export function learnHref() {
  try { if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) return LEARN_URL; } catch { /* web */ }
  return "/learn";
}

export default function LearnLink({ children, style, className }) {
  return (
    <a href={learnHref()} className={className} style={style} data-learn-link="1">
      {children}
    </a>
  );
}
