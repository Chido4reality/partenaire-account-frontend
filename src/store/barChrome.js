// BAR LAYOUT (Peter 2026-11-18): /bar is full width like the mockup — the desktop sidebar is hidden
// there, and the bar header's menu button brings it back. Only /bar reads this; every other page's
// layout is untouched (scripts/bar-mode-menu-edits.mjs lists the exact Layout.jsx edits).
import { create } from "zustand";

export const useBarChrome = create((set) => ({
  menuOpen: false,
  setMenuOpen: (v) => set({ menuOpen: !!v }),
  // BAR OPENS ON THE FLOOR (Peter 2026-11-28): "Bar Mode" tapped while already in the bar re-opens it —
  // the floor + Home cart in its normal step (no payment step, no bill, no panel). BarPage watches openSeq.
  openSeq: 0,
  reopen: () => set((s) => ({ openSeq: s.openSeq + 1, menuOpen: false })),
}));
