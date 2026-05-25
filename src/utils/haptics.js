// MP-MOBILE-UI-PHASE-1: thin wrapper over @capacitor/haptics. No-op on
// web — Capacitor.isNativePlatform() is false in the browser, so the
// dynamic import never resolves and tapHaptic returns immediately.
// Lazy import keeps the web bundle from pulling the native shim.
import { Capacitor } from "@capacitor/core";

let _hapticsPromise = null;
function loadHaptics() {
  if (!_hapticsPromise) {
    _hapticsPromise = import("@capacitor/haptics").catch(() => null);
  }
  return _hapticsPromise;
}

export async function tapHaptic(style = "light") {
  if (!Capacitor.isNativePlatform()) return;
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    const impactStyle =
      style === "heavy"  ? mod.ImpactStyle.Heavy  :
      style === "medium" ? mod.ImpactStyle.Medium :
                           mod.ImpactStyle.Light;
    await mod.Haptics.impact({ style: impactStyle });
  } catch (_) { /* swallow — haptics are nice-to-have, never load-bearing */ }
}
