// MP-MOBILE-UI-PHASE-2A: bottom-sheet host for the POS cart pane on
// mobile. Composed of two pieces:
//
//   1. A persistent bottom STRIP — visible whenever the cart is
//      non-empty. Shows item count + total + ↑ chevron. Tapping it
//      opens the sheet. Sits ABOVE the mobile bottom-nav tabs so it
//      never overlaps cashier nav.
//
//   2. A Vaul Drawer — opens to ~92vh on tap, drag-down to dismiss.
//      Hosts the existing cart-pane JSX wholesale (header, line
//      items, debt rows, online-cart prefill banner, payment form,
//      Confirm button). All cart logic stays where it lives in
//      POSPage; this is purely a container.
//
// Desktop is unaffected — POSPage gates this behind its `mobile`
// flag and keeps the right-pane layout for >= md.
import { Drawer } from "vaul";
import { tapHaptic } from "../../utils/haptics";

// Matches the bottom-nav height in Layout.jsx mobile branch
// (5 NavLink slots @ padding:8px + ~28px icon/label + safe-area).
const BOTTOM_NAV_HEIGHT = 60;

export default function MobileCartSheet({
  open,
  onOpenChange,
  itemCount,
  heldCount = 0,
  total,
  formatTotal,
  lang = "en",
  children,
}) {
  // Strip is visible when EITHER cart has items OR there are held
  // sales to resume. The Resume button lives inside the cart-pane
  // children, so without holds-aware visibility, cashiers couldn't
  // reach it once their working cart emptied.
  const hasItems = itemCount > 0;
  const hasHolds = heldCount > 0;
  const showStrip = hasItems || hasHolds;
  // Display variants per holds + items combination.
  const heldLabel = lang === "fr"
    ? `${heldCount} ${heldCount === 1 ? "vente en attente" : "ventes en attente"}`
    : `${heldCount} held ${heldCount === 1 ? "sale" : "sales"}`;
  // Background tone shifts when only holds (no live cart) so the
  // strip reads as a "resume" affordance, not a sale total.
  const stripBg = hasItems ? "var(--brand)" : "rgba(245,158,11,0.95)";
  const stripFg = "#152B52";

  return (
    <>
      {showStrip && (
        <button
          onClick={() => { tapHaptic("light"); onOpenChange(true); }}
          aria-label={lang === "fr" ? "Ouvrir le panier" : "Open cart"}
          style={{
            position: "fixed",
            left: 0, right: 0,
            // Strip sits above the bottom nav. The nav already pads
            // for safe-area-inset-bottom, so we offset by the nominal
            // 60px + the safe-area value combined.
            bottom: `calc(${BOTTOM_NAV_HEIGHT}px + var(--safe-area-bottom))`,
            height: 56,
            padding: "0 16px",
            background: stripBg,
            color: stripFg,
            border: "none",
            borderTop: "1px solid rgba(255,255,255,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            zIndex: 200,
            boxShadow: "0 -6px 24px rgba(0,0,0,0.35)",
          }}
        >
          {hasItems ? (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ flexShrink: 0 }}>
                  🛒 {itemCount}{" "}
                  {itemCount === 1
                    ? (lang === "fr" ? "article" : "item")
                    : (lang === "fr" ? "articles" : "items")}
                </span>
                {hasHolds && (
                  <span
                    style={{
                      fontSize: 11, fontWeight: 700,
                      background: "rgba(0,0,0,0.25)",
                      padding: "2px 8px", borderRadius: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    📋 {heldCount} {lang === "fr" ? "en attente" : "held"}
                  </span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span>{formatTotal ? formatTotal(total) : total}</span>
                <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span>
              </span>
            </>
          ) : (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                📋 <span>{heldLabel}</span>
                <span style={{ opacity: 0.85, fontWeight: 500 }}>
                  · {lang === "fr" ? "appuyer pour reprendre" : "tap to resume"}
                </span>
              </span>
              <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span>
            </>
          )}
        </button>
      )}

      <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        <Drawer.Portal>
          <Drawer.Overlay
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 1700,
            }}
          />
          <Drawer.Content
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              height: "92vh",
              background: "var(--bg-surface)",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderTop: "1px solid var(--border)",
              zIndex: 1701,
              display: "flex",
              flexDirection: "column",
              outline: "none",
            }}
          >
            {/* Drag handle */}
            <div
              style={{
                width: 40, height: 4,
                background: "var(--border-hover)",
                borderRadius: 2,
                margin: "10px auto 6px",
                flexShrink: 0,
              }}
            />
            {/* a11y title for Vaul (visually hidden but readable to ATs) */}
            <Drawer.Title
              style={{
                position: "absolute",
                width: 1, height: 1, padding: 0, margin: -1,
                overflow: "hidden", clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap", border: 0,
              }}
            >
              {lang === "fr" ? "Panier" : "Cart"}
            </Drawer.Title>
            {/* Children — the cart-pane JSX from POSPage. The parent
                container is flex-column, so the children's own flex
                layout (header / scroll list / bottom panel) works
                exactly like in the desktop right-pane. */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                paddingBottom: "var(--safe-area-bottom)",
              }}
            >
              {children}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
