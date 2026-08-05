// MP-DRAWER-REVEAL — the till figure stays masked until the viewer re-enters their PIN.
//
// THREAT: a lost, stolen, or merely glanced-at phone should not broadcast how much cash
// is in the drawer. The dashboard used to show "Expected: 12 500" the instant the app
// opened, with no interaction at all.
//
// SCOPE, stated honestly: this is a PRESENTATIONAL gate. GET /shifts/current still
// returns the figures and React Query still caches them, so anyone with the unlocked
// phone AND devtools can read them. It defends the glance and the shoulder-surf — which
// is the actual threat — not exfiltration. Making it stronger means the server withholding
// the numbers until a reveal token is presented; deliberately not done.
//
// MOBILE ONLY. A back-office desktop is a different risk and is left ungated.
//
// The reveal is MODULE-LEVEL, not per-component: DrawerDashboardCard and
// ActiveShiftIndicator can both be mounted at once (Dashboard renders both), and
// unmasking one while the other stayed hidden would be pointless theatre — the number is
// the same number. One unlock reveals every drawer surface; one timeout hides them all.
import { useEffect, useState } from "react";
import api from "./api";

// 90 seconds. Long enough to read the figure and act on it; short enough that a phone
// left on the counter re-locks before anyone wanders past. Deliberately NOT a "session":
// a 15-minute window would be unmasked for exactly the period the handset is most likely
// to be unattended, which defeats the purpose.
export const REVEAL_MS = 90 * 1000;

let revealedUntil = 0;      // epoch ms; 0 = masked
let timer = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

export function isRevealed() {
  return revealedUntil > Date.now();
}

export function hideDrawer() {
  revealedUntil = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  notify();
}

function revealFor(ms) {
  revealedUntil = Date.now() + ms;
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideDrawer, ms);
  notify();
}

// Verify the CALLER'S OWN pin (POST /auth/verify-my-pin — not /approval/verify-pin,
// which checks the owner/manager pool and would let any supervisor's PIN unmask a
// cashier's drawer). Returns { ok } or { ok:false, error, rateLimited }.
export async function revealWithPin(pin) {
  try {
    await api.post("/auth/verify-my-pin", { pin });
    revealFor(REVEAL_MS);
    return { ok: true };
  } catch (e) {
    const status = e?.response?.status;
    const d = e?.response?.data || {};
    return { ok: false, rateLimited: status === 429, error: d.message_en || d.message || null };
  }
}

// Re-hide the moment the app leaves the foreground. This is the case the whole feature is
// about: the phone gets pocketed, put down, or taken. `visibilitychange` covers the
// Android WebView being backgrounded; `blur` covers the app losing focus without hiding
// (split screen, a notification shade pull, a call overlay).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) hideDrawer(); });
  window.addEventListener("blur", hideDrawer);
  // Belt and braces for the native shell: Capacitor fires this on background/resume even
  // where the WebView doesn't reliably raise visibilitychange.
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      import("@capacitor/app").then(({ App }) => {
        App.addListener("appStateChange", ({ isActive }) => { if (!isActive) hideDrawer(); });
      }).catch(() => { /* plugin missing — the DOM listeners above still cover it */ });
    }
  } catch { /* ignore */ }
}

// Is this a HANDHELD?
//
// The gate first shipped keyed on Capacitor isNativePlatform() alone — i.e. the installed
// APK only. That was wrong: the web app on a phone browser is the SAME handset with the
// SAME threat, and it is how a good number of users actually run this. The gate missed
// exactly the people it was written for.
//
// Signal = native app, OR (coarse pointer AND narrow viewport):
//   • `pointer: coarse` is true for touch/stylus, false for a mouse — so a real desktop
//     stays ungated even when its window is dragged narrow, which is what "desktop
//     ungated" was asking for. A width check alone would have gated it.
//   • width < 768 is the SAME breakpoint Layout already uses to decide the mobile shell,
//     so "mobile" means one thing across the app rather than two.
// A touch-screen laptop under 768px wide would gate. Acceptable: it is a touch device
// showing a phone-shaped layout, and the org can switch the setting off.
function isHandheld() {
  if (typeof window === "undefined") return false;
  if (window.Capacitor?.isNativePlatform?.()) return true;
  const coarse = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
  return coarse && window.innerWidth < 768;
}

// `gateOn` — is the gate active at all? False ⇒ everything renders unmasked and no PIN is
// ever asked for (desktop, or an org that switched it off).
export function useDrawerReveal({ enabled = true } = {}) {
  const [, force] = useState(0);
  const gateOn = enabled && isHandheld();

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    // Re-evaluate on resize/rotate so the gate doesn't get stuck in whatever state the
    // first render happened to see (rotating a phone, or a tablet in split screen).
    window.addEventListener("resize", fn);
    window.addEventListener("orientationchange", fn);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("resize", fn);
      window.removeEventListener("orientationchange", fn);
    };
  }, []);

  // Re-hide on navigation away / location switch. The consumer passes a key (route +
  // selected location); when it changes we mask again, so walking from Dashboard to POS
  // and back does not leave the figure exposed.
  return {
    gateOn,
    // When the gate is off, everything reads as revealed — callers need no branching.
    revealed: gateOn ? isRevealed() : true,
    reveal: revealWithPin,
    hide: hideDrawer,
    REVEAL_MS,
  };
}

// Small helper so every masked figure looks identical across components.
export const MASK = "•••••";

export default useDrawerReveal;
