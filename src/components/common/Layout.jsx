import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useLangStore, useOfflineStore } from "../../store";
import api from "../../utils/api";

// Nav items with role restrictions
const NAV = [
  { to: "/",             en: "Dashboard",  fr: "Tableau de bord", icon: "📊", roles: ["owner","manager","cashier","warehouse"] },
  { to: "/pos",          en: "Sales",      fr: "Ventes",          icon: "🛒", roles: ["owner","manager","cashier"] },
  { to: "/shifts",       en: "Cash",       fr: "Caisse",          icon: "💰", roles: ["owner","manager","cashier"] },
  { to: "/inventory",    en: "Inventory",  fr: "Inventaire",      icon: "📦", roles: ["owner","manager","warehouse"] },
  { to: "/customers",    en: "Customers",  fr: "Clients",         icon: "👥", roles: ["owner","manager"] },
  { to: "/credits",      en: "Credits",    fr: "Crédits",         icon: "💳", roles: ["owner","manager"] },
  { to: "/transfers",    en: "Transfers",  fr: "Transferts",      icon: "🔄", roles: ["owner","manager","warehouse"] },
  { to: "/expenditures", en: "Expenses",   fr: "Dépenses",        icon: "💸", roles: ["owner","manager"] },
  { to: "/reports",      en: "Reports",    fr: "Rapports",        icon: "📋", roles: ["owner","manager"] },
  { to: "/settings",     en: "Settings",   fr: "Paramètres",      icon: "⚙️", roles: ["owner","manager"] },
];

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang }     = useLangStore();
  const { isOnline }          = useOfflineStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [isMobile, setIsMobile]   = useState(window.innerWidth < 768);
  const navigate  = useNavigate();
  const location  = useLocation();
  const qc        = useQueryClient();

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
  const role = user?.role || "cashier";

  const visibleNav = NAV.filter(item => item.roles.includes(role));
  const mobileNav = visibleNav.slice(0, 5);

  const notifColor = (type) => {
    if (type === "low_stock") return "#fbbf24";
    if (type === "debt_due")  return "#f87171";
    return "var(--brand-light)";
  };

  const roleLabel = () => {
    const labels = { owner: "👑 Owner", manager: "🔑 Manager", cashier: "🛒 Cashier", warehouse: "📦 Warehouse" };
    return labels[role] || role;
  };

  const NotifPanel = () => (
    <div style={{ position: "absolute", bottom: isMobile ? "auto" : "100%", top: isMobile ? 52 : "auto", right: isMobile ? 0 : "auto", left: isMobile ? 0 : 0, width: isMobile ? "100%" : 280, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 200, marginBottom: isMobile ? 0 : 4 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications {unread > 0 && `(${unread})`}</span>
        <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {notifications.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            {lang === "en" ? "No notifications" : "Aucune notification"}
          </div>
        ) : notifications.slice(0, 15).map(n => (
          <div key={n.id} onClick={() => { if (!n.is_read) markReadMutation.mutate(n.id); setShowNotif(false); }}
            style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: n.is_read ? "transparent" : "rgba(79,70,229,0.05)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: notifColor(n.type), marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: n.is_read ? 400 : 600 }}>{lang === "en" ? (n.title_en || n.title) : (n.title_fr || n.title_en || n.title)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? (n.body_en || n.body) : (n.body_fr || n.body_en || n.body)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <div style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Mon Partenaire</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{org?.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444" }} />
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowNotif(s => !s)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--text-primary)", fontSize: 12 }}>
                🔔 {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 5px", fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{unread}</span>}
              </button>
              {showNotif && <NotifPanel />}
            </div>
          </div>
        </div>

        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
          <Outlet />
        </main>

        <div style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)", display: "flex", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {mobileNav.map(item => {
            const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <NavLink key={item.to} to={item.to}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", textDecoration: "none", color: isActive ? "var(--brand-light)" : "var(--text-muted)", fontSize: 10, fontWeight: isActive ? 600 : 400, borderTop: isActive ? "2px solid var(--brand)" : "2px solid transparent", gap: 2 }}>
                <div style={{ fontSize: 16 }}>{item.icon}</div>
                {lang === "en" ? item.en : item.fr}
              </NavLink>
            );
          })}
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: collapsed ? 60 : 220, flexShrink: 0, height: "100vh", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0, overflow: "hidden" }}>

        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 60 }}>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Mon Partenaire</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{org?.name}</div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, flexShrink: 0 }}>
            {collapsed ? ">>" : "<<"}
          </button>
        </div>

        {!collapsed && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
            <span style={{ background: "rgba(79,70,229,0.15)", color: "var(--brand-light)", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
              {roleLabel()}
            </span>
          </div>
        )}

        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {visibleNav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10,
                padding: collapsed ? "12px 0" : "10px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                color: isActive ? "#fff" : "var(--text-secondary)",
                textDecoration: "none",
                background: isActive ? "rgba(79,70,229,0.2)" : "transparent",
                borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s"
              })}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{lang === "en" ? item.en : item.fr}</span>}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444", flexShrink: 0 }} />
            {!collapsed && <span style={{ color: "var(--text-muted)" }}>{isOnline ? "Online" : "Offline"}</span>}
          </div>

          {!collapsed && (
            <div style={{ position: "relative", marginBottom: 6 }}>
              <button onClick={() => setShowNotif(s => !s)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", display: "flex", justifyContent: "space-between" }}>
                <span>🔔 {lang === "en" ? "Alerts" : "Alertes"}</span>
                {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{unread}</span>}
              </button>
              {showNotif && <NotifPanel />}
            </div>
          )}

          {!collapsed && (
            <button onClick={toggleLang} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", marginBottom: 6 }}>
              🌐 {lang === "en" ? "Français" : "English"}
            </button>
          )}

          {!collapsed && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, padding: "4px 0" }}>
              {user?.full_name}
            </div>
          )}

          <button onClick={handleLogout} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 11, textAlign: collapsed ? "center" : "left" }}>
            {collapsed ? "⏻" : (lang === "en" ? "Sign Out" : "Déconnexion")}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
        <Outlet />
      </main>
    </div>
  );
}
  
