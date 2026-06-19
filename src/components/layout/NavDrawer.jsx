// MP-MOBILE-UI-PHASE-1: mobile-only drawer that complements (not
// replaces) the existing bottom tab bar. Renders ALL role-filtered nav
// items grouped into sections so the cashier/owner has discoverable
// access to pages that don't fit the 5-slot bottom bar.
//
// Push behavior: the drawer itself sits at left:0 with width=DRAWER_WIDTH.
// The parent (Layout.jsx mobile branch) animates the main content
// translateX by the same amount so the content shifts right under the
// drawer — Layout owns that animation, not this component.
//
// Gesture: dragging the drawer left past 80px or with sufficient
// leftward velocity dismisses (matches the platform's standard "swipe
// to close" feel without us having to bind to raw touch events).
import { motion, AnimatePresence } from "framer-motion";
import { useLangStore, useAuthStore } from "../../store";
import NavItem from "./NavItem";
import { tapHaptic } from "../../utils/haptics";

export const DRAWER_WIDTH = 280;

// Section grouping by route path. Items not listed in any section are
// dropped from the drawer — by design, every primary route should
// belong to a section. New routes added later get a one-line addition
// here. Sections with zero matching visible items are hidden.
const SECTIONS = [
  // MP-PROPLUS-NAV-DRAWER-FIX: the Pro Plus routes (/assistant, /attendance,
  // /assets) were added to Layout's NAV but never to this mobile SECTIONS map,
  // so the drawer dropped them even when fully entitled (the desktop sidebar
  // maps visibleNav flat, which is why web showed them). /assistant goes at the
  // TOP (prominent), staff Attendance + Assets join PEOPLE & MONEY. Role/feature
  // gates stay in Layout's NAV (already pass for entitled owners).
  { en: "DAILY WORK", fr: "TRAVAIL QUOTIDIEN", routes: ["/assistant", "/", "/pos", "/online-cart", "/shifts", "/refunds"] },
  { en: "INVENTORY",  fr: "INVENTAIRE",        routes: ["/inventory", "/stock-count", "/barcodes", "/transfers"] },
  { en: "PEOPLE & MONEY", fr: "PERSONNES & ARGENT", routes: ["/customers", "/credits", "/expenditures", "/attendance", "/assets"] },
  { en: "REPORTING",  fr: "RAPPORTS",          routes: ["/reports", "/operations"] },
  { en: "SETTINGS",   fr: "PARAMÈTRES",        routes: ["/settings"] },
];

export default function NavDrawer({
  open,
  onClose,
  navItems,           // already role + plan filtered by Layout
  onlineCartPending,
  onLogout,
}) {
  const { lang } = useLangStore();
  const { user, org } = useAuthStore();
  const role = user?.role || "";

  // Index nav items by route for quick lookup when materialising sections.
  // Key on navKey (the ORIGINAL route) when present — locked Pro Plus items
  // have their `to` rewritten to the shared upsell URL, so indexing on `to`
  // would collide them and break SECTIONS lookups by real route.
  const byRoute = new Map((navItems || []).map(n => [n.navKey || n.to, n]));
  const sectioned = SECTIONS
    .map(s => ({
      label: lang === "en" ? s.en : s.fr,
      items: s.routes.map(r => byRoute.get(r)).filter(Boolean),
    }))
    .filter(s => s.items.length > 0);

  const handleNav = () => {
    tapHaptic("light");
    onClose();
  };

  const handleSignOut = () => {
    tapHaptic("medium");
    onClose();
    onLogout?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — fills viewport, lower z than drawer. Tap closes.
              Sits above the translated content so taps on the visible
              80-ish px of content also close (content's pointer-events
              are disabled by the parent while the drawer is open).
              MP-NAVDRAWER-Z-ABOVE-VAUL: z bumped 1500 → 2500 (panel
              1501 → 2501 below) so the drawer clears the Vaul mobile
              cart sheet portal (z:1701). Pre-fix on phones with cart
              items active, the bottom ~80px of the drawer (Sign Out
              + Settings section) was hidden under Vaul's peek bar.
              Still below ModalShell (z:3500) so a modal can stack on
              top of the drawer if both are open. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 2500,
            }}
          />

          {/* Drawer panel — spring physics for the open/close, drag
              binding for swipe-to-close. */}
          <motion.aside
            initial={{ x: -DRAWER_WIDTH }}
            animate={{ x: 0 }}
            exit={{ x: -DRAWER_WIDTH }}
            transition={{ type: "spring", stiffness: 350, damping: 35 }}
            drag="x"
            dragConstraints={{ left: -DRAWER_WIDTH, right: 0 }}
            dragElastic={0.05}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80 || info.velocity.x < -300) {
                onClose();
              }
            }}
            style={{
              position: "fixed",
              top: 0,
              bottom: 0,
              left: 0,
              width: DRAWER_WIDTH,
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--border)",
              zIndex: 2501,
              display: "flex",
              flexDirection: "column",
              paddingTop: "var(--safe-area-top)",
              touchAction: "pan-y",  // let vertical scroll pass through to the nav list
              boxShadow: "4px 0 24px rgba(0,0,0,0.4)",
            }}
          >
            {/* User card */}
            <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "rgba(251,197,3,0.2)",
                    color: "var(--brand-light)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {(user?.full_name || "?").charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user?.full_name || "User"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {org?.name || ""}
                  </div>
                </div>
              </div>
              {role && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span
                    style={{
                      background: "rgba(251,197,3,0.15)",
                      color: "var(--brand-light)",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {role}
                  </span>
                </div>
              )}
            </div>

            {/* Sections */}
            <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {sectioned.map(section => (
                <div key={section.label} style={{ marginBottom: 4 }}>
                  <div
                    style={{
                      padding: "10px 16px 4px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {section.label}
                  </div>
                  {section.items.map(item => (
                    <NavItem
                      key={item.navKey || item.to}
                      to={item.to}
                      icon={item.icon}
                      label={lang === "en" ? item.en : item.fr}
                      badge={
                        item.badge === "online_cart" && onlineCartPending > 0
                          ? onlineCartPending
                          : undefined
                      }
                      onTap={handleNav}
                    />
                  ))}
                </div>
              ))}
            </nav>

            {/* Sign out — separated from nav items, on the bottom */}
            <div
              style={{
                padding: 12,
                paddingBottom: "max(12px, var(--safe-area-bottom))",
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                onClick={handleSignOut}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "#f87171",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 16 }}>🚪</span>
                <span>{lang === "en" ? "Sign Out" : "Déconnexion"}</span>
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
