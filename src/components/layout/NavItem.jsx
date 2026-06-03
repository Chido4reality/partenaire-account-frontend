// MP-MOBILE-UI-PHASE-1: single row inside the NavDrawer. Wraps NavLink
// so the active route highlights automatically; calls onTap after the
// route navigation kicks off so the parent can close the drawer +
// fire a haptic.
import { NavLink } from "react-router-dom";

export default function NavItem({ to, icon, label, badge, onTap }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onTap}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 48,
        padding: "10px 16px",
        color: isActive ? "#fff" : "var(--text-secondary)",
        background: isActive ? "rgba(251,197,3,0.18)" : "transparent",
        borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        textDecoration: "none",
        transition: "background 0.15s",
      })}
    >
      <span style={{ fontSize: 18, width: 24, textAlign: "center", flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {badge != null && badge !== 0 && (
        <span
          style={{
            background: "#ef4444", color: "#fff",
            borderRadius: 12, padding: "1px 8px",
            fontSize: 11, fontWeight: 700,
            minWidth: 22, textAlign: "center", flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}
