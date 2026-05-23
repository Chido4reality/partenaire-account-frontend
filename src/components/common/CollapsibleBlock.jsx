// MP-DAILY-REPORT-COLLAPSIBLE-BLOCKS
//
// Generic accordion section. Header with title (left) + summary line
// (right, only visible when collapsed) + chevron. Entire header is the
// click target so the tap area is friendly on mobile. Content area
// animates via max-height + opacity for a smooth open/close.
//
// Modes:
//   uncontrolled — pass `defaultExpanded`; the component owns the
//                  open state. Useful for one-offs.
//   controlled   — pass `expanded` + `onToggle`. State lives in the
//                  parent so it survives child re-renders / tab
//                  switches without resetting. The daily-report uses
//                  this mode (state lifted to ReportsPage so the
//                  Ledger tab remembers expansions within the session).
//
// No new deps — pure inline styles + a CSS transition. The codebase
// uses inline styles throughout (Tailwind is configured but rarely
// applied at the component level), so this matches the prevailing
// pattern.

import { useState } from "react";

export default function CollapsibleBlock({
  title,
  summaryLine,
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
      {/* Header (always rendered; full row is the click target) */}
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
          {!expanded && summaryLine && (
            <span style={{
              fontSize:    12,
              color:       "var(--text-muted)",
              fontWeight:  500,
              minWidth:    0,
              overflow:    "hidden",
              textOverflow: "ellipsis",
              whiteSpace:  "nowrap",
            }}>
              {summaryLine}
            </span>
          )}
          <span
            aria-hidden="true"
            style={{
              fontSize:   14,
              color:      "var(--text-muted)",
              transition: "transform 200ms ease-out",
              transform:  expanded ? "rotate(180deg)" : "rotate(0deg)",
              display:    "inline-block",
              lineHeight: 1,
            }}
          >
            ▾
          </span>
        </span>
      </button>

      {/* Content area — max-height collapse for smooth animation. Using
          a generous max-height (3000px) since real block content rarely
          exceeds that; auto would skip the transition because the
          browser can't interpolate to/from `auto`. */}
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
