import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useLangStore, useOfflineStore } from "../../store";
import api from "../../utils/api";
import UpgradeModal from "./UpgradeModal";
import OfflineBanner from "./OfflineBanner";
import { startAutoSync, processPendingQueue } from "../../utils/syncService";
import toast from "react-hot-toast";

// Nav items with role restrictions
const NAV = [
  { to: "/",             en: "Dashboard",  fr: "Tableau de bord", icon: "📊", roles: ["owner","manager","cashier","warehouse"] },
  { to: "/pos",          en: "Sales",      fr: "Ventes",          icon: "🛒", roles: ["owner","manager","cashier"] },
  { to: "/shifts",       en: "Cash",       fr: "Caisse",          icon: "💰", roles: ["owner","manager","cashier"] },
  { to: "/stock-count",  en: "Count",      fr: "Comptage",        icon: "🔢", roles: ["owner","manager","warehouse"] },
  { to: "/barcodes",     en: "Labels",     fr: "Étiquettes",      icon: "🏷️", roles: ["owner","manager","warehouse"] },
  { to: "/inventory",    en: "Inventory",  fr: "Inventaire",      icon: "📦", roles: ["owner","manager","warehouse"] },
  { to: "/customers",    en: "Customers",  fr: "Clients",         icon: "👥", roles: ["owner","manager"] },
  { to: "/credits",      en: "Credits",    fr: "Crédits",         icon: "💳", roles: ["owner","manager"] },
  { to: "/transfers",    en: "Transfers",  fr: "Transferts",      icon: "🔄", roles: ["owner","manager","warehouse"] },
  { to: "/expenditures", en: "Expenses",   fr: "Dépenses",        icon: "💸", roles: ["owner","manager"] },
  { to: "/reports",      en: "Reports",    fr: "Rapports",        icon: "📋", roles: ["owner","manager"] },
  { to: "/settings",     en: "Settings",   fr: "Paramètres",      icon: "⚙️", roles: ["owner","manager"] },
];

// Persistent banner shown above the header while an admin is impersonating
// this org. Click "End session" wipes the impersonated session and reloads
// the tab back to a normal login screen. Lives here (not in each page) so
// it stays put as the user navigates inside the POS.
function ImpersonationBanner() {
  const { impersonating, impersonation, endImpersonation } = useAuthStore();
  if (!impersonating) return null;
  const meta = impersonation || {};
  const handleEnd = () => {
    endImpersonation();
    window.location.replace("/");
  };
  return (
    <div style={{
      width: "100%", minHeight: 40, padding: "8px 16px",
      background: "rgba(245,158,11,0.18)", color: "#fbbf24",
      borderBottom: "1px solid rgba(245,158,11,0.45)",
      display: "flex", alignItems: "center", gap: 12,
      fontSize: 13, fontWeight: 600, flexShrink: 0
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        Admin impersonation — viewing as <strong>{meta.target_org_name || "this org"}</strong>
        {meta.target_org_mp_id ? <span style={{ opacity: 0.85 }}> ({meta.target_org_mp_id})</span> : null}
        {meta.admin_email ? <span style={{ opacity: 0.85 }}> · by {meta.admin_email}</span> : null}
      </span>
      <button onClick={handleEnd}
        style={{ background: "transparent", border: "1px solid rgba(245,158,11,0.55)",
                 color: "#fbbf24", padding: "5px 12px", borderRadius: 8,
                 fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
        End session →
      </button>
    </div>
  );
}

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang }     = useLangStore();
  const { isOnline: storeOnline } = useOfflineStore();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { data: planData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    refetchInterval: 300000,
    retry: 1,
    onError: () => {} // silent fail
  });
  const myPlan = planData?.data;
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

  useEffect(() => {
    const stopAutoSync = startAutoSync();
    return () => stopAutoSync();
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

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post("/notifications/mark-all-read"),
    onSuccess: () => {
      qc.invalidateQueries(["notifications"]);
      toast.success(lang === "en" ? "All alerts marked as read" : "Toutes les alertes marquées comme lues");
    },
    onError: (err) => toast.error(err?.response?.data?.message || (lang === "en" ? "Could not mark all read" : "Échec — réessayez"))
  });

  const notifications = notifData?.data || [];
  const unread = notifications.filter(n => !n.is_read).length;
  const role = user?.role || "cashier";

  const isSilverRestricted = myPlan?.plan_id === "silver" && !myPlan?.trial_active;
  const SILVER_ALLOWED = ["/", "/pos", "/inventory", "/shifts"];

  const visibleNav = NAV.filter(item => {
    if (!item.roles.includes(role)) return false;
    if (isSilverRestricted && !SILVER_ALLOWED.includes(item.to)) return false;
    return true;
  });
  const mobileNav = visibleNav.slice(0, 5);

  const notifColor = (type) => {
    if (type === "low_stock") return "#fbbf24";
    if (type === "debt_due")  return "#f87171";
    return "var(--brand-light)";
  };

  const roleLabel = () => {
    const icons = { owner: "👑", manager: "🔑", cashier: "🛒", warehouse: "📦" };
    const roleNames = { owner: "Owner", manager: "Manager", cashier: "Cashier", warehouse: "Warehouse" };
    const firstName = user?.full_name?.split(" ")[0] || "";
    const icon = icons[role] || "👤";
    const roleName = roleNames[role] || role;
    return `${icon} ${firstName} · ${roleName}`;
  };

  const NotifPanel = () => (
    <div style={{ position: "absolute", bottom: isMobile ? "auto" : "100%", top: isMobile ? 52 : "auto", right: isMobile ? 0 : "auto", left: isMobile ? 0 : 0, width: isMobile ? "100%" : 280, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 200, marginBottom: isMobile ? 0 : 4 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications {unread > 0 && `(${unread})`}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {unread > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isLoading}
              style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}
            >
              {markAllReadMutation.isLoading
                ? (lang === "en" ? "Marking…" : "En cours…")
                : (lang === "en" ? "Mark all read" : "Tout marquer lu")}
            </button>
          )}
          <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
        </div>
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
        <ImpersonationBanner />
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <ImpersonationBanner />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <aside style={{ width: collapsed ? 60 : 220, flexShrink: 0, height: "100%", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0, overflow: "hidden" }}>

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ background: "rgba(79,70,229,0.15)", color: "var(--brand-light)", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
                {roleLabel()}
              </span>
              {myPlan && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                  background: myPlan.plan_id === "premium" ? "rgba(251,191,36,0.15)" : myPlan.plan_id === "gold" ? "rgba(251,191,36,0.1)" : "rgba(100,100,100,0.1)",
                  color: myPlan.plan_id === "premium" ? "#fbbf24" : myPlan.plan_id === "gold" ? "#f59e0b" : "var(--text-muted)" }}>
                  {myPlan.plan?.badge_icon} {myPlan.plan?.name}
                </span>
              )}
            </div>
            {myPlan?.trial_active && myPlan?.trial_ends_at && (() => {
              const daysLeft = Math.max(0, Math.ceil((new Date(myPlan.trial_ends_at) - new Date()) / 86400000));
              return (
                <div style={{ marginTop: 5, padding: "3px 10px", borderRadius: 8, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--brand-light)", fontSize: 10, fontWeight: 700, textAlign: "center" }}>
                  💎 Trial — {daysLeft} {lang === "en" ? (daysLeft === 1 ? "day left" : "days left") : (daysLeft === 1 ? "jour restant" : "jours restants")}
                </div>
              );
            })()}
            {myPlan?.user_id_number && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, fontFamily: "monospace" }}>
                ID: {myPlan.user_id_number}
              </div>
            )}
            {myPlan?.plan_id === "silver" && role === "owner" && (
              myPlan?.status === "pending"
                ? (
                  <div style={{ marginTop: 6, width: "100%", padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#fbbf24", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                    ⏳ {lang === "en" ? "Pending approval — awaiting admin" : "En attente d'approbation admin"}
                  </div>
                ) : (
                  <button onClick={() => setShowUpgrade(true)}
                    style={{ marginTop: 6, width: "100%", padding: "5px 10px", borderRadius: 8, border: "1px solid var(--brand)", background: "rgba(79,70,229,0.1)", color: "var(--brand-light)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                    ⬆️ {lang === "en" ? "Upgrade plan" : "Améliorer le plan"}
                  </button>
                )
            )}
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
          <OfflineBanner lang={lang} collapsed={collapsed} />

          {!collapsed && (
            <div style={{ position: "relative", marginBottom: 6 }}>
              <button onClick={() => setShowNotif(s => !s)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", display: "flex", justifyContent: "space-between" }}>
                <span>🔔 {lang === "en" ? "Alerts" : "Alertes"}</span>
                {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{unread}</span>}
              </button>
              {showNotif && <NotifPanel />}
            </div>
          )}

          {!collapsed && (() => {
            // Pre-fill the WhatsApp message per Peter's T1.3 spec. Tier label
            // prefers the plan's display name; falls back to the slug
            // capitalized. Trial wins over plan name so the support agent
            // sees the trial state up-front.
            const tier = myPlan?.trial_active
              ? "Trial"
              : (myPlan?.plan?.name ||
                 (myPlan?.plan_id ? myPlan.plan_id.charAt(0).toUpperCase() + myPlan.plan_id.slice(1) : ""));
            const supportBody =
              "Bonjour Partenaire Support,\n" +
              "Mon ID: " + (myPlan?.user_id_number || org?.user_id_number || "") + "\n" +
              "Nom: " + (org?.name || "") + "\n" +
              "Plan: " + tier + "\n" +
              "Message:\n";
            const href = "https://wa.me/237675995524?text=" + encodeURIComponent(supportBody);
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.2)", color: "#25d366", fontSize: 11, textAlign: "left", textDecoration: "none", marginBottom: 6 }}>
                💬 {lang === "en" ? "Contact Support" : "Contacter le Support"}
              </a>
            );
          })()}

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

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} currentPlan={myPlan?.plan} />}
      </div>
    </div>
  );
}
