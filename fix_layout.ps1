Set-Content -Path "src\components\common\Layout.jsx" -Encoding UTF8 -Value @'
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuthStore, useLangStore, useOfflineStore } from "../../store";
import api from "../../utils/api";

const NAV = [
  { to: "/",             label: "Dashboard" },
  { to: "/pos",          label: "Sales" },
  { to: "/inventory",    label: "Inventory" },
  { to: "/customers",    label: "Customers" },
  { to: "/credits",      label: "Credits" },
  { to: "/transfers",    label: "Transfers" },
  { to: "/expenditures", label: "Expenses" },
  { to: "/reports",      label: "Reports" },
];

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang, t }  = useLangStore();
  const { isOnline }          = useOfflineStore();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate("/login"); };
  const toggleLang   = () => {
    const nl = lang === "en" ? "fr" : "en";
    setLang(nl);
    api.patch("/auth/language", { language: nl }).catch(() => {});
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: collapsed ? 60 : 220, flexShrink: 0, height: "100vh", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0, overflow: "hidden" }}>
        
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 60 }}>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>Mon Partenaire</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{org?.name}</div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, flexShrink: 0 }}>
            {collapsed ? ">>" : "<<"}
          </button>
        </div>

        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center",
                padding: collapsed ? "12px 0" : "10px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                color: isActive ? "#fff" : "var(--text-secondary)",
                textDecoration: "none",
                background: isActive ? "rgba(79,70,229,0.2)" : "transparent",
                borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s"
              })}>
              {collapsed ? item.label.substring(0, 2) : item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444", flexShrink: 0 }} />
            <span style={{ color: "var(--text-muted)" }}>{isOnline ? "Online" : "Offline"}</span>
          </div>
          <button onClick={toggleLang} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", marginBottom: 6 }}>
            {lang === "en" ? "Switch to Francais" : "Switch to English"}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{user?.full_name} - {user?.role}</div>
          <button onClick={handleLogout} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 11, textAlign: "left" }}>
            Sign Out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
        <Outlet />
      </main>
    </div>
  );
}
'@
Write-Host "Layout fixed!" -ForegroundColor Green
