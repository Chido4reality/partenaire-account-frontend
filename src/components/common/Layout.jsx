import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  { to: "/settings",     label: "Settings" },
];

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang, t }  = useLangStore();
  const { isOnline }          = useOfflineStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleLogout = () => { logout(); navigate("/login"); };
  const toggleLang   = () => { const nl = lang === "en" ? "fr" : "en"; setLang(nl); api.patch("/auth/language", { language: nl }).catch(() => {}); };

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
    if (type === "debt_due")  return "#f87171";
    return "var(--brand-light)";
  };

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
          <button onClick={handleLogout} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 11, textAlign: "left" }}>Sign Out</button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)", position: "relative" }}>
        {/* Notification bell */}
        <div style={{ position: "absolute", top: 16, right: 20, zIndex: 50 }}>
          <button onClick={() => setShowNotif(s => !s)} style={{ position: "relative", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", cursor: "pointer", color: "var(--text-primary)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {lang === "en" ? "Alerts" : "Alertes"}
            {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: "50%", width: 18, height: 18, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{unread}</span>}
          </button>

          {showNotif && (
            <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, width: 340, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 100 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{lang === "en" ? "Notifications" : "Notifications"}</span>
                <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>x</button>
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    {lang === "en" ? "No notifications" : "Aucune notification"}
                  </div>
                ) : notifications.slice(0, 20).map(n => (
                  <div key={n.id} onClick={() => { if (!n.is_read) markReadMutation.mutate(n.id); }}
                    style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: n.is_read ? "transparent" : "rgba(79,70,229,0.05)", transition: "background 0.1s" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: notifColor(n.type), flexShrink: 0, marginTop: 4 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: "var(--text-primary)", marginBottom: 2 }}>
                          {lang === "en" ? (n.title_en || n.title) : n.title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {lang === "en" ? (n.body_en || n.body) : n.body}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Outlet />
      </main>
    </div>
  );
}
