// BAR LAYOUT (Peter 2026-11-18): /bar is full width like the mockup — the desktop sidebar is hidden
// there, and the bar header's menu button brings it back. Only /bar reads this; every other page's
// layout is untouched (scripts/bar-mode-menu-edits.mjs lists the exact Layout.jsx edits).
import { create } from "zustand";

export const useBarChrome = create((set) => ({
  menuOpen: false,
  setMenuOpen: (v) => set({ menuOpen: !!v }),
}));
