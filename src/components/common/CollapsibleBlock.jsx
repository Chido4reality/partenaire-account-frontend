// MP-DAILY-REPORT-COLLAPSIBLE-BLOCKS (revised)
//
// Generic accordion section. Header with title (left) + a single
// subtotal number (right, collapsed only) + chevron / ✕ icon. Entire
// header row is the click target so the tap area is friendly on
// mobile. Content area animates via max-height + opacity for smooth
// open/close.
//
// Visual contract:
//   collapsed:  [Title]                       [subtotalValue] [▾]
//   expanded:   [Title]                                       [✕]
//   ──────────────────────────────────────────────────────────────
//   {children}
//
// The whole header row toggles either way; the ✕ when expanded just
// gives the user a more obvious "close this" affordance than a
// chevron alone.
//
// Modes:
//   uncontrolled — pass `defaultExpanded`; the component owns the
//                  open state.
//   controlled   — pass `expanded` + `onToggle`. State lives in the
//                  parent so it survives child re-renders / tab
//                  switches without resetting. The daily-report uses
//                  this mode (state lifted to ReportsPage so the
//                  Ledger tab remembers expansions within the session).
//
// No new deps — pure inline styles + CSS transitions. Inline-styled
// to match the prevailing pattern in this codebase (Tailwind is
// configured but rarely applied at the component level).

import { useState } from "react";

export default function CollapsibleBlock({
  title,
  subtotalValue,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  children,
}) {
  const isControlled = typeof controlledExpanded === "boolean";
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = () => {
    if (isControlled) onToggle && onToggle(!expanded);
    else setInternalExpanded(v => !v);
  };

  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      marginBottom: 14,
      overflow: "hidden",
    }}>
      {/* Header — always rendered; full row is the click target. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        style={{
          width:      "100%",
          background: "transparent",
          border:     "none",
          padding:    "12px 16px",
          display:    "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap:        12,
          cursor:     "pointer",
          color:      "var(--text-primary)",
          fontFamily: "inherit",
          textAlign:  "left",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 13, color: "var(--brand-light)" }}>
          {title}
        </span>
        <span style={{
          display:    "flex",
          alignItems: "center",
          gap:        10,
          minWidth:   0,
        }}>
          {!expanded && subtotalValue && (
            // Subtotal — single number, right-aligned, prominent enough
            // to read at a glance but doesn't overshadow the title.
            <span style={{
              fontSize:    13,
              fontWeight:  700,
              color:       "var(--text-primary)",
              minWidth:    0,
              overflow:    "hidden",
              textOverflow: "ellipsis",
              whiteSpace:  "nowrap",
            }}>
              {subtotalValue}
            </span>
          )}
          {expanded ? (
            // ✕ when expanded — explicit "close this" affordance per
            // the revised spec. Same click target as the rest of the
            // header (the parent button handles it).
            <span
              aria-hidden="true"
              style={{
                fontSize:    16,
                color:       "var(--text-muted)",
                lineHeight:  1,
                display:     "inline-block",
                width:       18,
                textAlign:   "right",
              }}
            >
              ✕
            </span>
          ) : (
            <span
              aria-hidden="true"
              style={{
                fontSize:   14,
                color:      "var(--text-muted)",
                display:    "inline-block",
                lineHeight: 1,
              }}
            >
              ▾
            </span>
          )}
        </span>
      </button>

      {/* Content area — max-height collapse for smooth animation. The
          3000px ceiling is generous since real block content rarely
          exceeds that; using auto would skip the transition because
          the browser can't interpolate to/from `auto`. */}
      <div
        style={{
          maxHeight:  expanded ? 3000 : 0,
          opacity:    expanded ? 1 : 0,
          transition: "max-height 220ms ease-out, opacity 180ms ease-out",
          overflow:   "hidden",
        }}
      >
        <div style={{ padding: "0 16px 14px 16px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
