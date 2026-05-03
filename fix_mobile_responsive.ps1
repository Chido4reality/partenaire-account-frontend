# Fix mobile responsiveness and add camera barcode scanning
# Run from frontend folder

# First install the barcode scanner library
Write-Host "Installing barcode scanner..." -ForegroundColor Yellow
npm install @zxing/library --save
Write-Host "Done!" -ForegroundColor Green

# Update Layout.jsx for mobile
Set-Content -Path "src\components\common\Layout.jsx" -Encoding UTF8 -Value @'
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useLangStore, useOfflineStore } from "../../store";
import api from "../../utils/api";

const NAV = [
  { to: "/",             label: "Dashboard",  icon: "H" },
  { to: "/pos",          label: "Sales",      icon: "S" },
  { to: "/inventory",    label: "Inventory",  icon: "I" },
  { to: "/customers",    label: "Customers",  icon: "C" },
  { to: "/credits",      label: "Credits",    icon: "D" },
  { to: "/transfers",    label: "Transfers",  icon: "T" },
  { to: "/expenditures", label: "Expenses",   icon: "E" },
  { to: "/reports",      label: "Reports",    icon: "R" },
  { to: "/settings",     label: "Settings",   icon: "G" },
];

// Bottom 5 for mobile nav bar
const MOBILE_NAV = [
  { to: "/",          label: "Home",      icon: "H" },
  { to: "/pos",       label: "Sales",     icon: "S" },
  { to: "/inventory", label: "Stock",     icon: "I" },
  { to: "/credits",   label: "Credits",   icon: "D" },
  { to: "/settings",  label: "More",      icon: "G" },
];

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang, t }  = useLangStore();
  const { isOnline }          = useOfflineStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };
  const toggleLang = () => {
    const nl = lang === "en" ? "fr" : "en";
    setLang(nl);
    api.patch("/auth/language", { language: nl }).catch(() => {});
  };

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then(r => r.data),
    refetchInterval: 30000
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => api.patch("/notifications/" + id + "/read"),
    onSuccess: () => qc.invalidateQueries(["notifications"])
  });

  const notifications = notifData?.data || [];
  const unread = notifications.filter(n => !n.is_read).length;

  const notifColor = (type) => {
    if (type === "low_stock") return "#fbbf24";
    if (type === "debt_due") return "#f87171";
    return "var(--brand-light)";
  };

  // Mobile layout - bottom nav bar
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Mobile top bar */}
        <div style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>Mon Partenaire</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{org?.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444" }} />
            <button onClick={() => setShowNotif(s => !s)} style={{ position: "relative", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--text-primary)", fontSize: 12 }}>
              {lang === "en" ? "Alerts" : "Alertes"}
              {unread > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{unread}</span>}
            </button>
          </div>
        </div>

        {/* Notification panel */}
        {showNotif && (
          <div style={{ position: "fixed", top: 52, right: 0, left: 0, background: "var(--bg-card)", border: "1px solid var(--border)", zIndex: 100, maxHeight: "60vh", overflowY: "auto" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>Notifications</span>
              <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>x</button>
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No notifications</div>
            ) : notifications.slice(0, 10).map(n => (
              <div key={n.id} onClick={() => { if (!n.is_read) markReadMutation.mutate(n.id); setShowNotif(false); }}
                style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: n.is_read ? "transparent" : "rgba(79,70,229,0.05)" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: notifColor(n.type), marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600 }}>{n.title_en || n.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{n.body_en || n.body}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main content */}
        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
          <Outlet />
        </main>

        {/* Bottom nav */}
        <div style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)", display: "flex", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {MOBILE_NAV.map(item => {
            const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <NavLink key={item.to} to={item.to}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", textDecoration: "none", color: isActive ? "var(--brand-light)" : "var(--text-muted)", fontSize: 10, fontWeight: isActive ? 600 : 400, borderTop: isActive ? "2px solid var(--brand)" : "2px solid transparent", gap: 3 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: isActive ? "rgba(79,70,229,0.2)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: isActive ? "var(--brand-light)" : "var(--text-muted)" }}>
                  {item.icon}
                </div>
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop layout - sidebar
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: collapsed ? 60 : 220, flexShrink: 0, height: "100vh", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 60 }}>
          {!collapsed && (<div><div style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>Mon Partenaire</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{org?.name}</div></div>)}
          <button onClick={() => setCollapsed(c => !c)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, flexShrink: 0 }}>{collapsed ? ">>" : "<<"}</button>
        </div>

        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              style={({ isActive }) => ({ display: "flex", alignItems: "center", padding: collapsed ? "12px 0" : "10px 16px", justifyContent: collapsed ? "center" : "flex-start", color: isActive ? "#fff" : "var(--text-secondary)", textDecoration: "none", background: isActive ? "rgba(79,70,229,0.2)" : "transparent", borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent", fontSize: 13, fontWeight: isActive ? 600 : 400, transition: "all 0.15s" })}>
              {collapsed ? item.icon : item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444", flexShrink: 0 }} />
            <span style={{ color: "var(--text-muted)" }}>{isOnline ? "Online" : "Offline"}</span>
          </div>

          {/* Notifications */}
          <div style={{ position: "relative", marginBottom: 6 }}>
            <button onClick={() => setShowNotif(s => !s)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", display: "flex", justifyContent: "space-between" }}>
              <span>{lang === "en" ? "Alerts" : "Alertes"}</span>
              {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{unread}</span>}
            </button>
            {showNotif && (
              <div style={{ position: "absolute", bottom: "100%", left: 0, width: 280, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 100, marginBottom: 4 }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
                  <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>x</button>
                </div>
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>No notifications</div>
                  ) : notifications.slice(0, 15).map(n => (
                    <div key={n.id} onClick={() => { if (!n.is_read) markReadMutation.mutate(n.id); }}
                      style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: n.is_read ? "transparent" : "rgba(79,70,229,0.05)" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: notifColor(n.type), marginTop: 4, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: n.is_read ? 400 : 600 }}>{n.title_en || n.title}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{n.body_en || n.body}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={toggleLang} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", marginBottom: 6 }}>
            {lang === "en" ? "Switch to Francais" : "Switch to English"}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{user?.full_name} - {user?.role}</div>
          <button onClick={handleLogout} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 11, textAlign: "left" }}>Sign Out</button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
        <Outlet />
      </main>
    </div>
  );
}
'@

Write-Host "Mobile layout done!" -ForegroundColor Green
Write-Host "Now run: npm run dev to test locally" -ForegroundColor Cyan
