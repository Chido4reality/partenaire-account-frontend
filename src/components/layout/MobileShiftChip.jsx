// MP-MOBILE-UI-PHASE-1-5: mobile-only condensed shift surface for the
// POS page. Replaces the full-width ActiveShiftIndicator banner that
// ate ~50px of vertical space at the top of the cart column. The chip
// is ~32px tall; tapping it opens a Vaul bottom sheet that hosts the
// real ActiveShiftIndicator inside (reuses the open/close modal logic
// and the cashier/expected-drawer rendering — no duplication).
//
// Desktop is unaffected — POSPage gates this behind its existing
// `mobile` variable.
import { useState } from "react";
import { Drawer } from "vaul";
import { useLangStore, useSettingsStore } from "../../store";
import { useActiveShift, ActiveShiftIndicator } from "../common/ShiftWidgets";
import { tapHaptic } from "../../utils/haptics";

export default function MobileShiftChip() {
  const [open, setOpen] = useState(false);
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const { hasShift, isLoading } = useActiveShift();

  // Three visual states. "Off" covers both no-location-selected and
  // loading — the cashier can still open the sheet to see what's wrong.
  const noLocation = !selectedLocation?.id;
  const state = noLocation || isLoading ? "off" : hasShift ? "open" : "closed";
  const palette = {
    open:   { bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.40)", fg: "#34d399", icon: "🟢" },
    closed: { bg: "rgba(100,100,100,0.10)", bd: "rgba(255,255,255,0.10)", fg: "var(--text-muted)", icon: "⚪" },
    off:    { bg: "rgba(239,68,68,0.10)",  bd: "rgba(239,68,68,0.30)",  fg: "#f87171", icon: "🔴" },
  }[state];
  const label = state === "open"   ? (lang === "fr" ? "Poste"      : "Shift")
              : state === "closed" ? (lang === "fr" ? "Aucun poste" : "No Shift")
              : noLocation         ? (lang === "fr" ? "Pas de site" : "No site")
                                   : "…";

  return (
    <>
      <button
        onClick={() => { tapHaptic("light"); setOpen(true); }}
        aria-label={lang === "fr" ? "Ouvrir le panneau du poste" : "Open shift panel"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          minHeight: 34,
          background: palette.bg,
          border: `1px solid ${palette.bd}`,
          borderRadius: 999,
          color: palette.fg,
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>{palette.icon}</span>
        <span>{label}</span>
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 1600,
            }}
          />
          <Drawer.Content
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              background: "var(--bg-surface)",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderTop: "1px solid var(--border)",
              padding: "12px 16px",
              paddingBottom: "max(20px, var(--safe-area-bottom))",
              zIndex: 1601,
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            {/* Drag handle — Vaul recognises clicks/drags on Content
                so we don't need a separate trigger. */}
            <div
              style={{
                width: 40, height: 4,
                background: "var(--border-hover)",
                borderRadius: 2,
                margin: "0 auto 14px",
              }}
            />
            <Drawer.Title
              style={{
                fontWeight: 700, fontSize: 15,
                color: "var(--text-primary)",
                marginBottom: 12,
              }}
            >
              {lang === "fr" ? "Poste de caisse" : "Cash Shift"}
            </Drawer.Title>
            {/* Reuse the existing indicator wholesale — it already
                renders the right state + its open/close modals are
                lifted into its own JSX. */}
            <ActiveShiftIndicator />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
