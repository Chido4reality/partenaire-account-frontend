import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Drawer } from "vaul";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useLangStore, useOfflineStore, useSettingsStore } from "../../store";
import { useLiteMode } from "../../hooks/useLiteMode";
import { useTrialState } from "../../hooks/useTrialState";
import api from "../../utils/api";
import { cacheData } from "../../utils/offlineStore";
import { cacheKeyFor } from "../../utils/offlineQuery";
import { openWhatsApp } from "../../utils/whatsapp";
import { nukeClientState, hardRedirectToLogin } from "../../utils/authReset";
import UpgradeModal from "./UpgradeModal";
import PaywallModal from "./PaywallModal";
import OnlineOfflineBar from "./OnlineOfflineBar";
import { onSyncEvent } from "../../utils/pendingSync";
import { hasSection } from "../../utils/planCapabilities";
import NavDrawer, { DRAWER_WIDTH } from "../layout/NavDrawer";
import { tapHaptic } from "../../utils/haptics";
import toast from "react-hot-toast";

// Sprint A: each nav item declares the capability section it belongs to.
// `section: 'sales'` and `section: 'settings'` are always visible (every
// tier includes them). Other sections are filtered against the effective
// plan via hasSection(). `cashier` and `warehouse` role-restricts apply
// on top of the plan filter.
// MP-CASHIER-ROLE-GATING: cashier role is restricted from org-level
// views (Dashboard, Reports, Settings, Credits-analytics) but
// retains access to operational screens needed for daily till
// work — POS, Online Cart, Shifts (own only), Refunds, Customers
// (incl. debt-collection paths), Expenses (own-data only at the
// backend layer).
const NAV = [
  { to: "/",             en: "Dashboard",  fr: "Tableau de bord", icon: "📊", roles: ["owner","manager","warehouse"],          section: "dashboard" },
  { to: "/pos",          en: "Sales",      fr: "Ventes",          icon: "🛒", roles: ["owner","manager","cashier"],            section: "sales" },
  { to: "/online-cart",  en: "Online Cart",fr: "Panier en ligne", icon: "📥", roles: ["owner","manager","cashier"],            section: "online_cart", badge: "online_cart" },
  { to: "/shifts",       en: "Cash",       fr: "Caisse",          icon: "💰", roles: ["owner","manager","cashier"],            section: "cashflow" },
  // MP-REFUNDS-STAFF-ACCESS: refunds are operational (cashier
  // hands back cash to a customer returning goods). Visible to all
  // sale-capable roles, not gated by plan section (refunds work
  // on every tier — see SILVER_ALLOWED in App.jsx).
  { to: "/refunds",      en: "Refunds",    fr: "Remboursements",  icon: "↩",  roles: ["owner","manager","cashier"],            section: "sales" },
  { to: "/stock-count",  en: "Count",      fr: "Comptage",        icon: "🔢", roles: ["owner","manager","warehouse"],          section: "count" },
  { to: "/barcodes",     en: "Labels",     fr: "Étiquettes",      icon: "🏷️", roles: ["owner","manager","warehouse"],          section: "labels" },
  { to: "/inventory",    en: "Inventory",  fr: "Inventaire",      icon: "📦", roles: ["owner","manager","warehouse"],          section: "inventory" },
  // MP-CASHIER-ROLE-GATING: cashier needs Customers for the
  // Encaisser-dette flow + on-the-fly customer creation during
  // sales. Backend collect-debt route already cashier-eligible.
  { to: "/customers",    en: "Customers",  fr: "Clients",         icon: "👥", roles: ["owner","manager","cashier"],            section: "customers" },
  { to: "/credits",      en: "Credits",    fr: "Crédits",         icon: "💳", roles: ["owner","manager"],                       section: "credits" },
  { to: "/transfers",    en: "Transfers",  fr: "Transferts",      icon: "🔄", roles: ["owner","manager","warehouse"],          section: "transfers" },
  // MP-CASHIER-ROLE-GATING: cashier records petty-cash expenses
  // (boss errands, drawer outflows, personal). Backend filters
  // GET /expenditures by recorded_by=req.user.id for cashier role
  // so they only see their own history (not org-wide).
  { to: "/expenditures", en: "Expenses",   fr: "Dépenses",        icon: "💸", roles: ["owner","manager","cashier"],            section: "cashflow" },
  { to: "/reports",      en: "Reports",    fr: "Rapports",        icon: "📋", roles: ["owner","manager"],                       section: "reports" },
  // MP-OWNER-OPERATIONS-DASHBOARD-V1: multi-day deep view sidecar
  // to the existing Dashboard at "/". Owner + manager only; reuses
  // the reports plan-section gate since the data class is the same.
  { to: "/operations",   en: "Operations", fr: "Opérations",      icon: "📈", roles: ["owner","manager"],                       section: "reports" },
  { to: "/settings",     en: "Settings",   fr: "Paramètres",      icon: "⚙️", roles: ["owner","manager"],                       section: "settings" },
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

// BUG B: MP POS never surfaced admin broadcasts. This shows the most
// recent active one targeted at the caller's org as a dismissible
// banner (dismissals remembered per-broadcast in localStorage so it
// doesn't nag, but a NEW broadcast still shows).
const BCAST_DISMISS_KEY = "mp-bcast-dismissed";
// MP-LITE-PRO-VISUAL-POLISH (2 Jun): tiny inline badge next to the org
// name in the sidebar/topbar. Two muted palettes so the cashier reads
// the mode at a glance without the UI feeling shiny — warm gray for
// Lite (calm, free-tier), soft purple for Pro (premium without
// shouting). Live-updates via useLiteMode on the Settings flip.
function ModeBadge() {
  const lite = useLiteMode();
  const isLite = lite;
  return (
    <span
      aria-label={isLite ? "Lite Mode" : "Pro Mode"}
      style={{
        display: "inline-block",
        marginLeft: 6,
        background: isLite ? "rgba(255,255,255,0.06)" : "#152B52",
        color:      isLite ? "var(--text-secondary)" : "#FBC503",
        fontSize: 10, padding: "2px 6px",
        borderRadius: 4, fontWeight: 500,
        letterSpacing: 0.3,
        verticalAlign: "middle",
      }}
    >
      {isLite ? "LITE" : "PRO"}
    </span>
  );
}

// MP-LITE-PRO-VISUAL-POLISH (2 Jun): 2px accent strip at the very top
// of the app shell. First thing the eye catches. Same two palettes as
// ModeBadge so the two reinforce each other — warm gray = Lite, soft
// purple = Pro. Kept 2px max per "not too shiny" direction; appears
// ABOVE OnlineOfflineBar (which itself collapses to a 4px stripe when
// connectivity is clean).
function ModeAccent() {
  const lite = useLiteMode();
  return (
    <div
      role="presentation"
      style={{
        width: "100%",
        height: 2,
        background: lite ? "rgba(255,255,255,0.14)" : "#FBC503",
        flexShrink: 0,
      }}
    />
  );
}

// MP-BILLING-V2 (2 Jun): two narrow status strips for the trial states.
// LiteTrialStrip — countdown days 8-14 of the 14-day Lite trial.
// ProTrialStrip — always visible mini-badge while Pro trial is active.
// Both render slim (28px) so they don't crowd the main app chrome; they
// share the same horizontal slot as ImpersonationBanner and
// BroadcastBanner. Lite uses muted amber so a normal trial reads as
// informational, not alarming; Pro uses brand-indigo so the badge
// blends with the Pro UI shape it gates.
function TrialBanner() {
  const { lang } = useLangStore();
  const trial = useTrialState();
  // Lite strip wins when both could render (cashier shouldn't be
  // confused by stacked banners); the Pro mini-badge is small enough
  // to sit on top in a follow-up if we want both visible together.
  if (trial.show_lite_trial_countdown) {
    const n = trial.lite_trial_days_remaining;
    const label = lang === "en"
      ? `⏳ Trial ends in ${n} day${n === 1 ? '' : 's'} — upgrade to Lite or Pro to keep all features.`
      : `⏳ Essai se termine dans ${n} jour${n === 1 ? '' : 's'} — passez à Lite ou Pro pour garder toutes les fonctionnalités.`;
    return (
      <div role="status" style={{
        width: "100%", padding: "6px 12px",
        background: "rgba(245,158,11,0.14)", color: "#fbbf24",
        borderBottom: "1px solid rgba(245,158,11,0.35)",
        fontSize: 12, fontWeight: 700, textAlign: "center",
      }}>
        {label}
      </div>
    );
  }
  if (trial.pro_trial_state === 'active') {
    const n = trial.pro_trial_days_remaining;
    const label = lang === "en"
      ? `✦ Pro trial: ${n} day${n === 1 ? '' : 's'} left`
      : `✦ Essai Pro : ${n} jour${n === 1 ? '' : 's'} restant${n === 1 ? '' : 's'}`;
    return (
      <div role="status" style={{
        width: "100%", padding: "6px 12px",
        background: "rgba(251,197,3,0.14)", color: "var(--brand-light)",
        borderBottom: "1px solid rgba(251,197,3,0.35)",
        fontSize: 12, fontWeight: 700, textAlign: "center",
      }}>
        {label}
      </div>
    );
  }
  return null;
}

function BroadcastBanner() {
  const { lang } = useLangStore();
  const lite = useLiteMode();
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BCAST_DISMISS_KEY) || "[]"); }
    catch { return []; }
  });
  const { data } = useQuery({
    queryKey: ["mp-broadcasts"],
    queryFn: () => api.get("/notifications/broadcasts").then(r => r.data),
    refetchInterval: 300000,
    retry: 1,
    enabled: !lite, // MP-LITE-MODE-PHASE-1: skip in Lite (no broadcasts UI)
    onError: () => {}
  });
  if (lite) return null;
  const list = (data?.data || []).filter(b => !dismissed.includes(b.id));
  if (!list.length) return null;
  const b = list[0];
  const palette = b.severity === "critical"
    ? { bg: "rgba(239,68,68,0.16)", bd: "rgba(239,68,68,0.5)", fg: "#fca5a5", icon: "⛔" }
    : b.severity === "warning"
    ? { bg: "rgba(245,158,11,0.16)", bd: "rgba(245,158,11,0.5)", fg: "#fbbf24", icon: "⚠" }
    : { bg: "rgba(251,197,3,0.16)", bd: "rgba(251,197,3,0.5)", fg: "var(--brand-light)", icon: "📢" };
  const dismiss = () => {
    const next = [...dismissed, b.id];
    setDismissed(next);
    try { localStorage.setItem(BCAST_DISMISS_KEY, JSON.stringify(next.slice(-100))); } catch {}
  };
  return (
    <div style={{
      width: "100%", padding: "8px 16px", background: palette.bg, color: palette.fg,
      borderBottom: `1px solid ${palette.bd}`, display: "flex", alignItems: "center",
      gap: 12, fontSize: 13, flexShrink: 0
    }}>
      <span style={{ fontSize: 16 }}>{palette.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>{b.title}</strong>
        {b.body ? <span style={{ opacity: 0.9 }}> — {b.body}</span> : null}
      </span>
      <button onClick={dismiss}
        style={{ background: "transparent", border: `1px solid ${palette.bd}`,
                 color: palette.fg, padding: "4px 10px", borderRadius: 8,
                 fontWeight: 700, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
        {lang === "en" ? "Dismiss" : "Fermer"}
      </button>
    </div>
  );
}

// MP-RESTRICTED-MODE (B1): top banner shown whenever the org is locked out
// (expired/suspended, no active plan). Tap → /request-activation. Copy flips
// to "awaiting approval" once a request is pending. Self-contained so it can
// drop into both the mobile and desktop layout branches.
function RestrictedBanner() {
  const { lang } = useLangStore();
  const navigate = useNavigate();
  const isAuth = useAuthStore(s => s.isAuthenticated);
  const { data } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    enabled: isAuth, staleTime: 60000, retry: false,
  });
  const plan = data?.data;
  if (!plan?.is_restricted) return null;
  const pending = !!plan.has_pending_request;
  return (
    <div role="status" onClick={() => navigate("/request-activation")}
      style={{ cursor: "pointer", flexShrink: 0, width: "100%", textAlign: "center", padding: "8px 12px", fontSize: 12, fontWeight: 700,
        background: pending ? "rgba(245,158,11,0.16)" : "rgba(239,68,68,0.16)",
        color: pending ? "#fbbf24" : "#fca5a5",
        borderBottom: `1px solid ${pending ? "rgba(245,158,11,0.4)" : "rgba(239,68,68,0.4)"}` }}>
      {pending
        ? (lang === "en" ? "⏳ Activation request awaiting approval." : "⏳ Demande d'activation en attente d'approbation.")
        : (lang === "en" ? "🔒 Subscription expired. Tap to request activation to resume." : "🔒 Abonnement expiré. Appuyez pour demander l'activation.")}
    </div>
  );
}

// Locked content shown in place of a blocked page's <Outlet/> when restricted.
function RestrictedLock({ lang, hasPending, onRequest }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
        {lang === "en" ? "Subscription expired" : "Abonnement expiré"}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 340, marginBottom: 20 }}>
        {hasPending
          ? (lang === "en" ? "Your activation request is awaiting admin approval. Access returns as soon as it's approved." : "Votre demande d'activation est en attente d'approbation. L'accès reviendra dès l'approbation.")
          : (lang === "en" ? "Request activation to resume using the app." : "Demandez l'activation pour reprendre l'utilisation de l'application.")}
      </div>
      {!hasPending && (
        <button className="btn btn-primary" onClick={onRequest}>
          {lang === "en" ? "Request activation" : "Demander l'activation"}
        </button>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  // MP-LITE-MODE-PHASE-1: tightens visible NAV + skips polled queries
  // that don't surface in Lite. Reads from authStore.org.lite_mode
  // (default true) — owners flip via Settings → Mode.
  const lite = useLiteMode();
  const { lang, setLang }     = useLangStore();
  const queryClient           = useQueryClient(); // MP-AUTH-STATE-HYGIENE
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
  // Sprint A: paywall state — { feature, mpId } when something gated was
  // clicked. PaywallModal owns the upgrade flow from there.
  const [paywall, setPaywall] = useState(null);

  const { data: planData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    refetchInterval: 300000,
    retry: 1,
    enabled: !lite, // MP-LITE-MODE-PHASE-1: subscription banner hidden in Lite
    onError: () => {} // silent fail
  });
  const myPlan = planData?.data;
  const [showNotif, setShowNotif] = useState(false);
  const [isMobile, setIsMobile]   = useState(window.innerWidth < 768);
  // MP-MOBILE-UI-PHASE-1: drawer state lives at Layout level so the
  // hamburger button (inside the mobile top bar) and the NavDrawer
  // component can share it. Desktop branch is unaffected.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const qc        = useQueryClient();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // MP-PHASE-4.0 + Issue A: subscribe to pendingSync sync events. When
  // an offline-queued row reaches 'sent' (which happens ONLINE, so a
  // refetch will actually succeed), invalidate the React Query slots
  // whose data was being served by an optimistic seed — most importantly
  // ['current-shift'], which OpenShiftModal seeds during the offline
  // window so the POS can ring sales. Without this invalidation the
  // seed kept serving even after the real shift row landed.
  useEffect(() => onSyncEvent((e) => {
    if (e.type !== 'sent') return;
    // [Wave 4.0 debug instrumentation — Peter pastes these traces.]
    console.log('[sync] handler fired', { type: e.type, endpoint: e.endpoint });
    const ep = e.endpoint || '';
    const isOpen  = /^\/shifts\/open\/?$/.test(ep);
    const isClose = /^\/shifts\/[^/]+\/close\/?$/.test(ep);
    const isSale  = /^\/sales\/?$/.test(ep);
    if (isOpen || isClose || isSale) {
      console.log('[sync] invalidate', ['current-shift']);
      qc.invalidateQueries({ queryKey: ['current-shift'] });
    }
    if (isClose) {
      for (const k of ['shifts-history', 'my-shift', 'all-shifts']) {
        console.log('[sync] invalidate', [k]);
        qc.invalidateQueries({ queryKey: [k] });
      }
    }
  }), [qc]);

  // MP-PAUL-FIX-16 (3 Jun): eager warm-up of pos-customers + per-debtor
  // customer-debt cache. POSPage's own prefetch (cbc5ccd) only fires
  // once the cashier reaches POS — if Paul opens the app, drops to
  // offline before navigating to POS, then picks a customer with debt,
  // the debt modal never appears because the per-customer detail was
  // never fetched. Doing this at Layout level means the cache fills
  // during the brief online window between login and the first user
  // action. Best-effort: failures swallowed, no UI spinner. Re-runs
  // if user.id changes (different login session).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/customers?limit=300").then(res => res.data);
        if (cancelled) return;
        qc.setQueryData(["pos-customers"], r);
        try { cacheData("pos-customers", r); } catch { /* swallow storage errors */ }
        const debtors = (r?.data || []).filter(c => c?.id && Number(c?.total_debt || 0) > 0);
        await Promise.all(debtors.map(async (c) => {
          if (cancelled) return;
          try {
            const dr = await api.get(`/sales/customer-debt/${c.id}`).then(res => res.data);
            if (cancelled) return;
            try { cacheData(cacheKeyFor(["customer-debt", c.id]), dr); } catch { /* swallow */ }
            qc.setQueryData(["customer-debt", c.id], dr);
          } catch { /* silent — best-effort warm-up */ }
        }));
      } catch { /* silent — Layout warm-up is opportunistic */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, qc]);

  // MP-SLICE-3-RETIRE-LEGACY-SERVICE-WORKER: startAutoSync removed. The legacy
  // replay loop is superseded by pendingSync.startWorker (called once at api.js
  // module load), which drains via onNetworkChange + a 30s safety-net poll —
  // no per-Layout-mount hook needed.

  // Sprint A: any 403 with error='upgrade_required' from the axios
  // interceptor fires this event. Layout owns the paywall state, so
  // listening here pops the modal regardless of which page the request
  // originated from.
  useEffect(() => {
    const handler = (e) => {
      setPaywall({
        feature: e.detail && e.detail.feature,
        mpId:    null
      });
    };
    window.addEventListener("partenaire:paywall", handler);
    return () => window.removeEventListener("partenaire:paywall", handler);
  }, []);

  // MP-AUTH-STATE-HYGIENE — FIX 1: a real logout nukes EVERYTHING
  // (React Query cache, all zustand persist stores, local/sessionStorage)
  // then hard-navigates so React state is fresh. Backend logout call is
  // best-effort (stateless JWT — it just audits) and must run BEFORE the
  // nuke since the api interceptor reads the token from the auth store.
  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch (_) { /* audit-only; proceed */ }
    logout();
    nukeClientState(queryClient);
    hardRedirectToLogin();
  };

  // MP-AUTH-STATE-HYGIENE — FIX 2: user-change tripwire. If the persisted
  // last-user id doesn't match the authenticated user (different person
  // on a shared device, stale state from before logout was fixed), nuke
  // and bounce to login. Otherwise record the current user. Runs on every
  // authenticated mount — Layout wraps every protected route.
  useEffect(() => {
    const cur = user?.id ? String(user.id) : null;
    if (!cur) return;
    const last = localStorage.getItem("mp_last_user_id");
    if (last && last !== cur) {
      nukeClientState(queryClient);
      hardRedirectToLogin("session_changed");
      return;
    }
    if (last !== cur) localStorage.setItem("mp_last_user_id", cur);
  }, [user?.id, queryClient]);
  const toggleLang = () => {
    const nl = lang === "en" ? "fr" : "en";
    setLang(nl);
    api.patch("/auth/language", { language: nl }).catch(() => {});
  };

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then(r => r.data),
    refetchInterval: 30000,
    enabled: !lite, // MP-LITE-MODE-PHASE-1: notifications dropdown hidden in Lite
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

  // Sprint A: effective plan drives section visibility. Falls back to
  // 'silver' if my-plan hasn't loaded yet (defensive — better to hide
  // sections briefly than flash them then yank them away on load).
  const effectivePlan = myPlan?.effective_plan || "silver";
  const isGrace        = !!myPlan?.is_grace;
  const trialDaysLeft  = myPlan?.days_remaining_in_trial;
  const graceDaysLeft  = myPlan?.days_remaining_in_grace;
  // MP-RESTRICTED-MODE (B1): hard lock for expired/suspended orgs. Only the
  // dashboard, settings, and the activation page stay reachable.
  const isRestricted       = !!myPlan?.is_restricted;
  const hasPendingRequest  = !!myPlan?.has_pending_request;
  const RESTRICTED_ALLOWED = ["/", "/settings", "/request-activation"];
  const restrictedBlock    = isRestricted && !RESTRICTED_ALLOWED.includes(location.pathname);
  // MP-LITE-MODE-PHASE-1: hide Online Cart, Operations dashboard nav
  // entries in Lite. Settings, POS, Inventory, Customers, Credits,
  // Reports etc. stay — per directive amendment, multi-location and
  // basic Transfers remain first-class in Lite.
  const LITE_HIDDEN_ROUTES = new Set(["/online-cart", "/operations"]);
  const visibleNav = NAV.filter(item => {
    if (!item.roles.includes(role)) return false;
    if (!hasSection(effectivePlan, item.section)) return false;
    if (lite && LITE_HIDDEN_ROUTES.has(item.to)) return false;
    return true;
  });
  // MP-MOBILE-NAV-FIX: mobile has only this 5-slot bottom bar (no
  // hamburger). /inventory sits at NAV index 7 so it never made the
  // slice(0,5) — leaving mobile-first sellers unable to reach it. Swap
  // the /stock-count slot for /inventory in the MOBILE bar only: stock
  // counting is a subset of inventory management and stays reachable on
  // the desktop sidebar (which maps the untouched visibleNav) and by
  // direct URL. Desktop nav is unaffected. The map keeps positions/order;
  // the post-filter dedupes the later /inventory entry so it can't appear
  // twice; the `|| item` fallback is role-safe (e.g. a role with no
  // inventory access keeps its original slot).
  const _invItem = visibleNav.find(n => n.to === "/inventory");
  const mobileNav = visibleNav
    .map(item => (item.to === "/stock-count" && _invItem) ? _invItem : item)
    .filter((item, idx, arr) => arr.findIndex(x => x.to === item.to) === idx)
    .slice(0, 5);

  // D-2: Online Cart sidebar badge — pending count, 30s poll. Only
  // fetched when the plan actually exposes the section (silver doesn't),
  // so we don't spam 403s into the paywall interceptor.
  const { data: ocPending } = useQuery({
    queryKey: ["online-cart-pending-count"],
    queryFn: () => api.get("/online-cart/pending-count").then(r => r.data),
    refetchInterval: 30000,
    // MP-LITE-MODE-PHASE-1: Online Cart nav entry is hidden in Lite,
    // so the badge poll has nothing to drive. Skip the request.
    enabled: !lite && hasSection(effectivePlan, "online_cart"),
    retry: 1,
    onError: () => {}
  });
  const onlineCartPending = ocPending?.count || 0;

  // STOCK-UX-PASS Part A — cross-account location leak fix.
  // selectedLocation is persisted (zustand `mp-settings`) and survives a
  // logout→login on the same device/wrapper, so user B can inherit user
  // A's location_id and see empty/foreign stock ("No stock records yet"
  // despite DB rows). Layout wraps every location-scoped page, so we
  // validate the stored selection ONCE here against the current user's
  // accessible locations and clear it if it doesn't belong to them. Pages
  // then fall back to their own default. The ["locations"] query key is
  // shared with the pages, so React Query dedupes — no extra network call.
  const { selectedLocation, setLocation } = useSettingsStore();
  const { data: _locsResp } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    retry: 1,
    onError: () => {}
  });
  useEffect(() => {
    const list = _locsResp?.data;
    if (!Array.isArray(list) || list.length === 0) return; // not loaded yet
    if (selectedLocation && !list.some(l => l.id === selectedLocation.id)) {
      setLocation(null); // stale/foreign selection → clear it
    }
  }, [_locsResp, selectedLocation, setLocation]);

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

  // Desktop bell trigger lives inside the sidebar, which has
  // overflow:hidden. position:absolute on the panel gets clipped at
  // the sidebar boundary (~220px wide), so the action group at flex-end
  // — including the "Mark all" button — was rendered offscreen and
  // looked missing. Fix: use position:fixed on desktop and read the
  // trigger's getBoundingClientRect to anchor the panel. Mobile keeps
  // absolute positioning since the mobile header has no overflow clip.
  // Shared body — notification list. Used by both the desktop
  // dropdown and the mobile Vaul sheet so behaviour stays in lockstep.
  const renderNotifBody = () => (
    notifications.length === 0 ? (
      <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
        {lang === "en" ? "No notifications" : "Aucune notification"}
      </div>
    ) : notifications.slice(0, 15).map(n => {
      // Map ref_type → in-app route. Older notifications with NULL
      // refs (the existing 122 low-stock rows generated before the
      // backend fix) just mark-read on click — no navigation,
      // panel stays open.
      const focusUrlFor = (n) => {
        if (!n.ref_type || !n.ref_id) return null;
        switch (n.ref_type) {
          case "product":  return `/inventory?focus=${n.ref_id}`;
          case "customer": return `/customers?focus=${n.ref_id}`;
          case "sale":     return `/pos?focus=${n.ref_id}`;
          case "credit":   return `/credits?focus=${n.ref_id}`;
          default:         return null;
        }
      };
      const focusUrl = focusUrlFor(n);
      return (
      <div key={n.id} onClick={() => {
            if (!n.is_read) markReadMutation.mutate(n.id);
            if (focusUrl) { setShowNotif(false); navigate(focusUrl); }
          }}
        style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: focusUrl ? "pointer" : "default", background: n.is_read ? "transparent" : "rgba(251,197,3,0.05)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: notifColor(n.type), marginTop: 5, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: n.is_read ? 400 : 600 }}>{lang === "en" ? (n.title_en || n.title) : (n.title_fr || n.title_en || n.title)}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? (n.body_en || n.body) : (n.body_fr || n.body_en || n.body)}</div>
          </div>
        </div>
      </div>
      );
    })
  );

  const NotifPanel = () => {
    // ── MOBILE: Vaul bottom sheet ─────────────────────────────────
    // The previous absolute-positioned panel inherited width:100%
    // from the bell's ~50px relative wrapper and rendered squeezed.
    // Bottom sheet escapes the wrapper via portal and gets full
    // viewport width.
    if (isMobile) {
      return (
        <Drawer.Root open={true} onOpenChange={(o) => { if (!o) setShowNotif(false); }}>
          <Drawer.Portal>
            <Drawer.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1700 }} />
            <Drawer.Content
              style={{
                position: "fixed", bottom: 0, left: 0, right: 0,
                maxHeight: "85vh",
                background: "var(--bg-surface)",
                borderTopLeftRadius: 20, borderTopRightRadius: 20,
                borderTop: "1px solid var(--border)",
                zIndex: 1701,
                display: "flex", flexDirection: "column",
                outline: "none",
              }}
            >
              <div style={{ width: 40, height: 4, background: "var(--border-hover)", borderRadius: 2, margin: "10px auto 6px", flexShrink: 0 }} />
              <div style={{ padding: "8px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
                <Drawer.Title style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
                  🔔 {lang === "en" ? "Notifications" : "Notifications"}{unread > 0 && ` (${unread})`}
                </Drawer.Title>
                {unread > 0 && (
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    disabled={markAllReadMutation.isLoading}
                    style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "4px 8px", whiteSpace: "nowrap" }}
                  >
                    {markAllReadMutation.isLoading
                      ? (lang === "en" ? "Marking…" : "En cours…")
                      : (lang === "en" ? "Mark all" : "Tout marquer")}
                  </button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", paddingBottom: "var(--safe-area-bottom)" }}>
                {renderNotifBody()}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      );
    }

    // ── DESKTOP: existing fixed-position dropdown ─────────────────
    const panelRef = useRef(null);
    useLayoutEffect(() => {
      if (!panelRef.current) return;
      const trigger = document.getElementById("notif-bell-desktop");
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      // Anchor below the trigger, aligned to its left edge. Clamp so
      // the 320px panel never runs off the right of the viewport on
      // narrow desktops.
      const left = Math.min(r.left, window.innerWidth - 320 - 8);
      panelRef.current.style.top  = (r.bottom + 4) + "px";
      panelRef.current.style.left = Math.max(8, left) + "px";
    });

    // Close on outside-click / Esc / scroll / resize. The click and
    // scroll handlers use closest() on stable DOM ids so they survive
    // any unmount/remount of NotifPanel between Layout renders.
    useEffect(() => {
      const isInsidePanel = (target) =>
        target && target.closest && target.closest("#notif-panel-pos");
      const isInsideBell = (target) =>
        target && target.closest && (target.closest("#notif-bell-desktop") || target.closest("#notif-bell-mobile"));
      const onMouseDown = (e) => {
        if (isInsidePanel(e.target)) return;
        if (isInsideBell(e.target)) return;
        setShowNotif(false);
      };
      const onKey = (e) => { if (e.key === "Escape") setShowNotif(false); };
      const onScroll = (e) => {
        if (isInsidePanel(e.target)) return;
        setShowNotif(false);
      };
      const onResize = () => setShowNotif(false);
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
      return () => {
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      };
    }, []);
    return (
      <div id="notif-panel-pos" ref={panelRef}
        style={{ position: "fixed", top: 0, left: -9999, width: 320, marginBottom: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 1000 }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Notifications {unread > 0 && `(${unread})`}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {unread > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isLoading}
                style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0, flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {markAllReadMutation.isLoading
                  ? (lang === "en" ? "Marking…" : "En cours…")
                  : (lang === "en" ? "Mark all" : "Tout marquer")}
              </button>
            )}
            <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}>✕</button>
          </div>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {renderNotifBody()}
        </div>
      </div>
    );
  };

  // Fix 2: global order search (VNT-* sales + QOF-* Dozie orders,
  // partial refs). Debounced 300ms. Lives in the sidebar / mobile
  // header; the results panel is position:fixed + anchored to the
  // input via getBoundingClientRect because the sidebar is
  // overflow:hidden (same constraint NotifPanel works around).
  const OrderSearchBox = ({ idSuffix }) => {
    const inputId = "order-search-" + idSuffix;
    const [term, setTerm] = useState("");
    const [debounced, setDebounced] = useState("");
    const [open, setOpen] = useState(false);
    const panelRef = useRef(null);

    useEffect(() => {
      const id = setTimeout(() => setDebounced(term.trim()), 300);
      return () => clearTimeout(id);
    }, [term]);

    const { data, isFetching } = useQuery({
      queryKey: ["order-search", debounced],
      queryFn: () => api.get("/orders/search?ref=" + encodeURIComponent(debounced)).then(r => r.data),
      enabled: debounced.length >= 2,
      staleTime: 10000,
      onError: () => {}
    });
    const results = data?.data || [];
    const showPanel = open && debounced.length >= 2;

    useLayoutEffect(() => {
      if (!showPanel || isMobile || !panelRef.current) return;
      const trigger = document.getElementById(inputId);
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      panelRef.current.style.top = (r.bottom + 4) + "px";
      panelRef.current.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340 - 8)) + "px";
    });

    useEffect(() => {
      const onDown = (e) => {
        if (e.target.closest && (e.target.closest("#order-search-panel") || e.target.closest("#" + inputId))) return;
        setOpen(false);
      };
      document.addEventListener("mousedown", onDown, true);
      return () => document.removeEventListener("mousedown", onDown, true);
    }, [inputId]);

    const go = (res) => {
      setOpen(false); setTerm("");
      if (res.link_to) navigate(res.link_to);
      else toast(lang === "en"
        ? `${res.ref} — ${res.type === "sale" ? "Sale" : "Dozie order"} · ${Number(res.total).toLocaleString()} FCFA · ${res.status}`
        : `${res.ref} — ${res.type === "sale" ? "Vente" : "Commande Dozie"} · ${Number(res.total).toLocaleString()} FCFA · ${res.status}`,
        { duration: 4000 });
    };

    const panelBase = isMobile
      ? { position: "absolute", top: 44, left: 0, right: 0, width: "100%" }
      : { position: "fixed", top: 0, left: -9999, width: 340 };

    return (
      <div style={{ position: "relative", width: "100%" }}>
        <input id={inputId} value={term}
          onChange={e => {
            // Some Code128 scanners round-trip '-' as '+'. Only for
            // ref-shaped input (VNT/RET/QOF prefix) restore '-' so
            // the scan finds the sale; never touch free-text search.
            let v = e.target.value;
            if (/^(vnt|ret|qof|hld)/i.test(v.trim())) v = v.replace(/\+/g, "-");
            setTerm(v); setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            // Sprint K scan-to-find: a USB scanner / phone-camera
            // scan types the ref and sends Enter. Jump straight to
            // an exact ref match (or the sole result) so the cashier
            // doesn't have to click the dropdown.
            if (e.key !== "Enter") return;
            let q = term.trim().toLowerCase();
            if (/^(vnt|ret|qof|hld)/.test(q)) q = q.replace(/\+/g, "-");
            // Hold Sale: HLD-* isn't a completed order so it isn't in
            // /orders/search. Hand it to POS, which looks it up by-ref
            // and opens the Resume modal (so the cashier confirms).
            if (/^hld-/.test(q)) {
              setOpen(false); setTerm("");
              navigate("/pos?hold=" + encodeURIComponent(q.toUpperCase()));
              return;
            }
            const exact = results.find(r => String(r.ref || "").toLowerCase() === q);
            if (exact) go(exact);
            else if (results.length === 1) go(results[0]);
          }}
          placeholder={lang === "en" ? "🔎 Find / scan (VNT / QOF / HLD / digits)" : "🔎 Chercher / scanner (VNT / QOF / HLD / chiffres)"}
          style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 11 }} />
        {showPanel && (
          <div id="order-search-panel" ref={panelRef}
            style={{ ...panelBase, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden", zIndex: 1000, maxHeight: 320, overflowY: "auto" }}>
            {isFetching && !results.length ? (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>{lang === "en" ? "Searching…" : "Recherche…"}</div>
            ) : results.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                {lang === "en" ? `No order found with reference: ${debounced}` : `Aucune commande pour la référence : ${debounced}`}
              </div>
            ) : results.map(res => (
              <div key={res.type + res.id} onClick={() => go(res)}
                style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{res.ref}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 9, background: res.type === "sale" ? "rgba(251,197,3,0.15)" : "rgba(245,158,11,0.15)", color: res.type === "sale" ? "var(--brand-light)" : "#fbbf24" }}>
                    {res.type === "sale" ? (lang === "en" ? "MP Sale" : "Vente MP") : (lang === "en" ? "Dozie" : "Dozie")}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {Number(res.total || 0).toLocaleString()} FCFA · {res.status}
                  {res.date ? " · " + new Date(res.date).toLocaleDateString() : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      // MP-MOBILE-UI-PHASE-1: outer relative container hosts the drawer
      // (fixed-positioned overlay) and the content (push-animated). The
      // bottom tab bar is intentionally inside the animated content so
      // it slides off-screen with the rest of the shell when the drawer
      // opens — keeps the visual hierarchy consistent and avoids the
      // backdrop having to dodge a sticky element.
      <div style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navItems={visibleNav}
          onlineCartPending={onlineCartPending}
          onLogout={handleLogout}
        />
        <motion.div
          animate={{ x: drawerOpen ? DRAWER_WIDTH : 0 }}
          transition={{ type: "spring", stiffness: 350, damping: 35 }}
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            overflow: "hidden",
            // Disable interaction with the content while the drawer is
            // open so the visible-but-shifted strip on the right routes
            // taps through to the backdrop (= closes the drawer).
            pointerEvents: drawerOpen ? "none" : "auto",
          }}
        >
        {/* MP-CAPACITOR Slice 2: connectivity bar at very top of every
            screen. Collapses to 4px stripe when online+synced so it
            doesn't burn vertical space; expands to a banner when
            offline. Slice 3 will pass pendingCount/syncing as the
            offline queue wakes up. */}
        <ModeAccent />
        <OnlineOfflineBar />
        <ImpersonationBanner />
        <TrialBanner />
        <BroadcastBanner /><RestrictedBanner />
        <div style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 10 }}>
          {/* MP-MOBILE-UI-PHASE-1: hamburger trigger added inline to the
              existing mobile top bar so we don't fork the bar layout.
              48px hit target meets touch-target guidelines. */}
          <button
            onClick={() => { tapHaptic("light"); setDrawerOpen(true); }}
            aria-label="Open menu"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              width: 40, height: 40,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0,
              color: "var(--text-primary)",
              fontSize: 18,
            }}
          >
            ☰
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Mon Partenaire Dozie</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {org?.name}<ModeBadge />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444" }} />
            {/* MP-LITE-MODE-PHASE-1: notifications bell hidden in Lite. */}
            {!lite && (
              <div style={{ position: "relative" }}>
                <button id="notif-bell-mobile" onClick={() => setShowNotif(s => !s)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--text-primary)", fontSize: 12 }}>
                  🔔 {unread > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 5px", fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{unread}</span>}
                </button>
                {showNotif && <NotifPanel />}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "8px 16px", flexShrink: 0, position: "relative" }}>
          <OrderSearchBox idSuffix="m" />
        </div>

        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
          {restrictedBlock ? <RestrictedLock lang={lang} hasPending={hasPendingRequest} onRequest={() => navigate("/request-activation")} /> : <Outlet />}
        </main>

        <div style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)", display: "flex", flexShrink: 0, paddingBottom: "var(--safe-area-bottom)" }}>
          {mobileNav.map(item => {
            const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <NavLink key={item.to} to={item.to}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px", textDecoration: "none", color: isActive ? "var(--brand-light)" : "var(--text-muted)", fontSize: 10, fontWeight: isActive ? 600 : 400, borderTop: isActive ? "2px solid var(--brand)" : "2px solid transparent", gap: 2 }}>
                <div style={{ fontSize: 16, position: "relative" }}>
                  {item.icon}
                  {item.badge === "online_cart" && onlineCartPending > 0 && (
                    <span style={{ position: "absolute", top: -4, right: -10, background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 4px", fontSize: 9, fontWeight: 700 }}>{onlineCartPending}</span>
                  )}
                </div>
                {lang === "en" ? item.en : item.fr}
              </NavLink>
            );
          })}
        </div>
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} currentPlan={myPlan?.plan} />}
        {paywall && <PaywallModal feature={paywall.feature} currentPlan={effectivePlan} mpId={myPlan?.user_id_number} onClose={() => setPaywall(null)} />}
        </motion.div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* MP-CAPACITOR Slice 2: connectivity bar at very top — same
          placement as mobile so the cashier sees the same indicator
          regardless of viewport. */}
      <OnlineOfflineBar />
      <ImpersonationBanner />
      <BroadcastBanner /><RestrictedBanner />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <aside style={{ width: collapsed ? 60 : 220, flexShrink: 0, height: "100%", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0, overflow: "hidden" }}>

        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 60 }}>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Mon Partenaire Dozie</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                {org?.name}<ModeBadge />
              </div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, flexShrink: 0 }}>
            {collapsed ? ">>" : "<<"}
          </button>
        </div>

        {!collapsed && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ background: "rgba(251,197,3,0.15)", color: "var(--brand-light)", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
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
            {/* Sprint A: trial countdown / grace banner. Color tiers:
                  >=7 days remaining  → green
                  3-6 days remaining  → amber
                  <3 days remaining   → red
                  in grace            → red + pulse animation. */}
            {effectivePlan === "trial" && !isGrace && trialDaysLeft != null && (() => {
              let bg, border, color;
              if (trialDaysLeft >= 7)      { bg = "rgba(16,185,129,0.15)"; border = "rgba(16,185,129,0.4)"; color = "#10b981"; }
              else if (trialDaysLeft >= 3) { bg = "rgba(245,158,11,0.15)"; border = "rgba(245,158,11,0.4)"; color = "#fbbf24"; }
              else                          { bg = "rgba(239,68,68,0.15)";  border = "rgba(239,68,68,0.4)";  color = "#fca5a5"; }
              return (
                <button onClick={() => setPaywall({ feature: "trial_countdown", mpId: myPlan?.user_id_number })}
                  style={{ marginTop: 5, width: "100%", padding: "4px 10px", borderRadius: 8, background: bg, border: `1px solid ${border}`, color, fontSize: 10, fontWeight: 700, textAlign: "center", cursor: "pointer" }}>
                  💎 {lang === "en" ? `Trial — ${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left` : `Essai — ${trialDaysLeft} ${trialDaysLeft === 1 ? "jour" : "jours"}`}
                </button>
              );
            })()}
            {effectivePlan === "trial" && isGrace && graceDaysLeft != null && (
              <button onClick={() => setPaywall({ feature: "trial_countdown", mpId: myPlan?.user_id_number })}
                style={{ marginTop: 5, width: "100%", padding: "5px 10px", borderRadius: 8, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.5)", color: "#fca5a5", fontSize: 10, fontWeight: 700, textAlign: "center", cursor: "pointer", animation: "pulse 1.6s ease-in-out infinite" }}>
                ⚠ {lang === "en"
                  ? `Trial ended — Day ${7 - graceDaysLeft}/7 of grace`
                  : `Essai terminé — Jour ${7 - graceDaysLeft}/7 de grâce`}
              </button>
            )}
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
                    style={{ marginTop: 6, width: "100%", padding: "5px 10px", borderRadius: 8, border: "1px solid var(--brand)", background: "rgba(251,197,3,0.1)", color: "var(--brand-light)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                    ⬆️ {lang === "en" ? "Upgrade plan" : "Améliorer le plan"}
                  </button>
                )
            )}
          </div>
        )}

        {!collapsed && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <OrderSearchBox idSuffix="d" />
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
                background: isActive ? "rgba(251,197,3,0.2)" : "transparent",
                borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                transition: "all 0.15s"
              })}>
              <span style={{ fontSize: 15, flexShrink: 0, position: "relative" }}>
                {item.icon}
                {collapsed && item.badge === "online_cart" && onlineCartPending > 0 && (
                  <span style={{ position: "absolute", top: -6, right: -8, background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 5px", fontSize: 9, fontWeight: 700 }}>{onlineCartPending}</span>
                )}
              </span>
              {!collapsed && <span style={{ flex: 1 }}>{lang === "en" ? item.en : item.fr}</span>}
              {!collapsed && item.badge === "online_cart" && onlineCartPending > 0 && (
                <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{onlineCartPending}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          {/* MP-LITE-MODE-PHASE-1: notifications bell hidden in Lite. */}
          {!collapsed && !lite && (
            <div style={{ position: "relative", marginBottom: 6 }}>
              <button id="notif-bell-desktop" onClick={() => setShowNotif(s => !s)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, textAlign: "left", display: "flex", justifyContent: "space-between" }}>
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
            const href = "https://wa.me/237621840952?text=" + encodeURIComponent(supportBody);
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                onClick={(e) => openWhatsApp(e, "237621840952", supportBody)}
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
        {restrictedBlock ? <RestrictedLock lang={lang} hasPending={hasPendingRequest} onRequest={() => navigate("/request-activation")} /> : <Outlet />}
      </main>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} currentPlan={myPlan?.plan} />}
      {paywall && <PaywallModal feature={paywall.feature} currentPlan={effectivePlan} mpId={myPlan?.user_id_number} onClose={() => setPaywall(null)} />}
      </div>
    </div>
  );
}
