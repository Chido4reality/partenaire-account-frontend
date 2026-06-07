// MP-MOBILE-UI keyboard-inset handler.
//
// Android WebView + Capacitor Keyboard (resize:'native') reliably keeps a
// FOCUSED input visible, but inside fixed-position Vaul drawers two gaps
// remain: (a) the NEXT input below the focused one stays hidden behind the
// IME because there's nothing to scroll into, and (b) switching inputs while
// the keyboard is already up doesn't re-center. This hook closes both:
//
//   • Publishes the live keyboard height as the CSS var `--kb-inset` on
//     <html>. Scroll containers add `var(--kb-inset, 0px)` to paddingBottom
//     so the user can scroll the lower inputs clear of the keyboard.
//   • Re-centers the focused field on keyboardWillShow AND on focusin (the
//     latter covers input-to-input moves that don't refire keyboard events).
//
// Native only — on web the var is never set, so the `0px` fallback applies
// and every consumer is a no-op. Call once from a always-mounted shell
// (Layout); the var is global.
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export function useKeyboardInset() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const root = document.documentElement;
    const setInset = (px) => root.style.setProperty("--kb-inset", `${Math.max(0, px || 0)}px`);

    const scrollFocusedIntoView = () => {
      const el = document.activeElement;
      if (el && typeof el.scrollIntoView === "function" &&
          /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };

    const handles = [];
    let cancelled = false;
    import("@capacitor/keyboard").then(({ Keyboard }) => {
      if (cancelled) return;
      Keyboard.addListener("keyboardWillShow", (info) => {
        setInset(info?.keyboardHeight);
        // Wait a frame so the padding is applied before we scroll.
        requestAnimationFrame(scrollFocusedIntoView);
      }).then((h) => handles.push(h));
      Keyboard.addListener("keyboardWillHide", () => setInset(0)).then((h) => handles.push(h));
    });

    // Input → input moves keep the keyboard up (no new willShow); re-center.
    const onFocusIn = () => requestAnimationFrame(scrollFocusedIntoView);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      cancelled = true;
      handles.forEach((h) => { try { h.remove(); } catch { /* noop */ } });
      document.removeEventListener("focusin", onFocusIn);
      root.style.removeProperty("--kb-inset");
    };
  }, []);
}
