import InventoryPage from "./pages/InventoryPage";
import { useEffect, useState, Component } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "react-hot-toast";
import { useAuthStore, useOfflineStore } from "./store";
import api from "./utils/api";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import Layout from "./components/common/Layout";
import Dashboard from "./pages/Dashboard";
import POSPage from "./pages/POSPage";
import OnlineCartPage from "./pages/OnlineCartPage";
import ReportsPage from "./pages/ReportsPage";
import RefundsPage from "./pages/RefundsPage";
import TransfersPage from "./pages/TransfersPage";
import ExpenditurePage from "./pages/ExpenditurePage";
import RequestActivationPage from "./pages/RequestActivationPage";
import CreditsPage from "./pages/CreditsPage";
import CustomersPage from "./pages/CustomersPage";
import SettingsPage from "./pages/SettingsPage";
import ShiftsPage from "./pages/ShiftsPage";
import StockCountPage from "./pages/StockCountPage";
import BarcodePage from "./pages/BarcodePage";
import OperationsDashboardPage from "./pages/OperationsDashboardPage"; // MP-OWNER-OPERATIONS-DASHBOARD-V1

// MP-INVALIDATE-AFTER-SALE: refetch stale data when the user returns to
// the tab/app or reconnects (e.g. after making a sale on another device
// or being away). staleTime keeps it from spamming refetches.
//
// MP-SLICE-3-REACT-QUERY-NETWORK-MODE-OVERRIDE: networkMode:'always' on
// mutations is load-bearing. React Query v4+ defaults to 'online', which
// pauses mutations when navigator.onLine is false — the mutationFn never
// runs, so axios never sees the request, so Slice 3's offlineAwareAdapter
// never gets a chance to enqueue + return an optimistic 202. 'always' on
// mutations cedes write-side offline detection to Slice 3 (utils/network.js
// + utils/api.js), which is what owns it by design.
//
// Queries deliberately stay on the default 'online' mode: Slice 3 has no
// read-through cache for arbitrary GETs (notifications, products,
// shifts/current, etc.), so 'always' would let them fail loudly while
// offline and surface error objects to consumers that expect arrays —
// crashing POSPage's filter calls. 'online' pauses them instead, and the
// page renders whatever React Query last cached.
const qc = new QueryClient({
  defaultOptions: {
    queries:   { retry: 1, staleTime: 30000, refetchOnWindowFocus: true, refetchOnReconnect: true },
    mutations: { networkMode: 'always' },
  }
});

class ErrorBoundary extends Component {
  state = { crashed: false, error: null };
  static getDerivedStateFromError(error) { return { crashed: true, error }; }
  componentDidCatch(error, info) { console.error("[ErrorBoundary]", error, info); }
  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: 40, textAlign: "center", background: "#0f0e1a", color: "#f4f3ff" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Something went wrong</div>
        <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 24, maxWidth: 360 }}>{this.state.error?.message || "An unexpected error occurred."}</div>
        <button onClick={() => { this.setState({ crashed: false, error: null }); window.location.href = "/"; }}
          style={{ padding: "10px 24px", borderRadius: 10, background: "var(--brand)", border: "none", color: "#152B52", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
          Reload app
        </button>
      </div>
    );
  }
}

// Route access rules per role.
//
// MP-CASHIER-ROLE-GATING: cashier role is restricted from org-level
// views. Dashboard, Reports, Settings, Credits (debt-aging analytics)
// stay owner+manager only. /customers and /expenditures now allow
// cashier (the former for debt-collection flows, the latter for
// drawer-accounted expenses cashier records during a shift — own-data
// filter applied at backend layer for /expenditures).
const ROUTE_ACCESS = {
  "/":             ["owner", "manager", "warehouse"],
  "/pos":          ["owner", "manager", "cashier"],
  "/online-cart":  ["owner", "manager", "cashier"],
  "/inventory":    ["owner", "manager", "warehouse"],
  "/customers":    ["owner", "manager", "cashier"],
  "/credits":      ["owner", "manager"],
  "/transfers":    ["owner", "manager", "warehouse"],
  "/expenditures": ["owner", "manager", "cashier"],
  "/reports":      ["owner", "manager"],
  // MP-OWNER-OPERATIONS-DASHBOARD-V1: owner statement view (multi-day
  // signals, anomalies, debt aging). Owner + manager only.
  "/operations":   ["owner", "manager"],
  // MP-REFUNDS-STAFF-ACCESS: refunds/exchanges are operational —
  // every role that can sell must also be able to process a return.
  // Backend mirror in returns.js: /return + /exchange open to
  // cashier, /void stays owner/manager.
  "/refunds":      ["owner", "manager", "cashier"],
  "/settings":     ["owner", "manager"],
  "/shifts":       ["owner", "manager", "cashier"],
  "/stock-count":  ["owner", "manager", "warehouse"],
  "/barcodes":     ["owner", "manager", "warehouse"],
};

function Guard({ children }) {
  return useAuthStore(s => s.isAuthenticated) ? children : <Navigate to="/login" replace />;
}

function RoleGuard({ path, children }) {
  const user = useAuthStore(s => s.user);
  const allowed = ROUTE_ACCESS[path] || ["owner"];
  if (!user || !allowed.includes(user.role)) {
    // MP-CASHIER-ROLE-GATING: cashier hitting a gated route is
    // redirected to /pos (their primary workspace) rather than
    // shown the Access Restricted message — they were never
    // supposed to navigate there in the first place (nav items
    // are filtered too). Other roles (warehouse) keep the
    // explanatory page since they have multiple legitimate
    // workspaces and a redirect target isn't obvious.
    if (user?.role === "cashier" && path !== "/pos") {
      return <Navigate to="/pos" replace />;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Access Restricted</div>
        <div style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 300 }}>
          Your role ({user?.role}) does not have permission to access this page. Contact your manager or owner.
        </div>
      </div>
    );
  }
  return children;
}

// MP-REFUNDS-STAFF-ACCESS: /refunds is on the Silver allowlist so
// Silver-tier shops (which don't have the Reports section) can
// still process customer returns. Operational, not analytical.
const SILVER_ALLOWED = ["/", "/pos", "/inventory", "/shifts", "/refunds"];

function PlanGuard({ path, children }) {
  const isAuth = useAuthStore(s => s.isAuthenticated);
  const { data: planData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    enabled: isAuth,
    staleTime: 60000,
    retry: false
  });
  const myPlan = planData?.data;
  const isSilverRestricted = myPlan?.plan_id === "silver" && !myPlan?.trial_active;
  if (isSilverRestricted && !SILVER_ALLOWED.includes(path)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Upgrade Required</div>
        <div style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 320, marginBottom: 20 }}>
          This feature is not available on the Silver plan. Upgrade to Gold or Premium to unlock it.
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Use the <strong>⬆️ Upgrade plan</strong> button in the sidebar to request an upgrade.
        </div>
      </div>
    );
  }
  return children;
}

// Detect ?impersonate=<jwt> (Phase B) set by the admin portal's
// "View as owner" flow. The admin backend mints a short-lived token signed
// with ADMIN_IMPERSONATE_SECRET (NOT a session token); we exchange it via
// GET /api/auth/impersonate-exchange for a real 1h MP user session token,
// then store it with the impersonating flag so the banner renders.
//
// Also handles the older ?impersonate_token=<jwt> path (Item 4 single-token
// flow) for backward compatibility with any in-flight tabs.
async function consumeImpersonateToken() {
  const params = new URLSearchParams(window.location.search);
  const exchangeToken = params.get("impersonate");
  const legacyToken   = params.get("impersonate_token");
  if (!exchangeToken && !legacyToken) return false;

  const apiBase = import.meta.env.VITE_API_URL || "https://partenaire-account-api.onrender.com/api";

  // Strip ASAP so a refresh doesn't re-trigger and the URL bar doesn't
  // display the token; also avoids accidental copy-paste leakage.
  const stripUrl = () => {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, clean);
  };

  try {
    if (exchangeToken) {
      // New flow: exchange the impersonation token for a real session.
      const res = await fetch(apiBase + "/auth/impersonate-exchange?token=" + encodeURIComponent(exchangeToken));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.session_token) {
        toast.error(data?.message || "Impersonation token expired or invalid. Close this tab and try again from the admin portal.", { duration: 8000 });
        stripUrl();
        return false;
      }
      // Fetch the user record so the existing app code (which reads
      // authStore.user / authStore.org) keeps working unchanged.
      const meRes = await fetch(apiBase + "/auth/me", { headers: { Authorization: "Bearer " + data.session_token } });
      const me = await meRes.json().catch(() => ({}));
      const user = me?.user;
      const org = user?.pa_organisations || null;
      if (!user) {
        toast.error("Could not load impersonated user.", { duration: 6000 });
        stripUrl();
        return false;
      }
      useAuthStore.getState().loginImpersonated(user, org, data.session_token, {
        admin_email:      data.admin_email,
        target_org_name:  data.target_org_name,
        target_org_mp_id: data.target_org_mp_id,
        target_user_name: data.target_user_name,
        target_user_role: data.target_user_role
      });
      toast(`🕵️ Admin impersonation — viewing as ${data.target_org_name || "the org"}`,
        { duration: 4000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      stripUrl();
      return true;
    }

    // Legacy single-token flow (Item 4): the URL token is already a real
    // session token signed with JWT_SECRET. Call /auth/me directly.
    const res = await fetch(apiBase + "/auth/me", { headers: { Authorization: "Bearer " + legacyToken } });
    if (!res.ok) {
      toast.error("Impersonation token rejected: " + res.status, { duration: 6000 });
      stripUrl();
      return false;
    }
    const data = await res.json();
    const user = data?.user;
    if (!user) { stripUrl(); return false; }
    const org = user.pa_organisations || null;
    useAuthStore.getState().loginImpersonated(user, org, legacyToken, {
      target_org_name: org?.name,
      target_org_mp_id: org?.user_id_number,
      target_user_name: user.full_name,
      target_user_role: user.role
    });
    toast(`🕵️ Admin impersonation — viewing as ${user.full_name || "owner"}`,
      { duration: 4000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
    stripUrl();
    return true;
  } catch (e) {
    toast.error("Impersonation failed: " + e.message, { duration: 6000 });
    stripUrl();
    return false;
  }
}

export default function App() {
  const { setOnline } = useOfflineStore();
  // MP-IMPERSONATION (Bug #3): when an ?impersonate token is present, hold the
  // router until the async token-exchange resolves — otherwise the auth Guard
  // renders first, sees no session, and redirects to /login before the
  // impersonated login completes, stranding the admin on the login screen.
  const [bootstrapping, setBootstrapping] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.has("impersonate") || p.has("impersonate_token");
    } catch { return false; }
  });
  useEffect(() => {
    // MP-MOBILE-UI-PHASE-1: belt-and-suspenders runtime StatusBar config.
    // capacitor.config.ts already declares Style.Dark + bg #1a1f2e on
    // launch, but a runtime call also lets us re-apply if any plugin
    // ever flips it (e.g. a hypothetical camera plugin that lightens
    // the bar). No-op on web (Capacitor.isNativePlatform false).
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#1a1f2e" });
      } catch (_) { /* native plugin not bundled in web; ignore */ }
    })();

    // Fire the impersonation consumer eagerly. It only does anything when
    // ?impersonate_token= is present in the URL, otherwise it's a quick
    // URLSearchParams check.
    (async () => {
      try { await consumeImpersonateToken(); }
      finally { setBootstrapping(false); }
    })();

    // MP-RENDER-COLDSTART-WARMUP: fire-and-forget HEAD ping at app launch
    // to prime Render's container. Free-tier cold-start is 30-60s when
    // the container has been idle (~15min); Paul (Cameroon, 1 Jun) hit
    // "Exhausted 5 attempts: signal aborted without reason" because his
    // first POST landed on a cold container and every aborted retry
    // killed the in-flight TCP socket before boot completed. The user
    // typically takes 10-60s of UI navigation after launch before their
    // first write (pick location, customer, scan product), so a warm-up
    // ping kicked off here usually completes long before the first
    // user-issued write fires. .catch swallowed because we genuinely
    // don't care about the response — only the side effect of waking
    // Render. Belt-and-suspenders with the 45s timeout bumps in
    // api.js and pendingSync.js for the cases where the user IS faster
    // than the warm-up or the container goes cold mid-session.
    try {
      const apiBase = import.meta.env.VITE_API_URL || "/api";
      fetch(apiBase + "/health", { method: "HEAD", cache: "no-store" })
        .catch(() => { /* fire-and-forget */ });
    } catch (_) { /* SSR / no fetch — ignore */ }

    // MP-SLICE-3-RETIRE-LEGACY-SERVICE-WORKER: drop reg.sync.register +
    // "sw-sync-complete" listener. Both belonged to the retired legacy SW;
    // Slice 3's pendingSync worker now owns reconnect-triggered draining via
    // onNetworkChange (utils/network.js → utils/pendingSync.js startWorker).
    const handleOnline  = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (bootstrapping) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 14 }}>
        Signing in…
      </div>
    );
  }
  return (
    <ErrorBoundary>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Guard><Layout /></Guard>}>
            <Route index               element={<RoleGuard path="/"><Dashboard /></RoleGuard>} />
            <Route path="pos"          element={<RoleGuard path="/pos"><POSPage /></RoleGuard>} />
            <Route path="online-cart"  element={<RoleGuard path="/online-cart"><PlanGuard path="/online-cart"><OnlineCartPage /></PlanGuard></RoleGuard>} />
            <Route path="inventory"    element={<RoleGuard path="/inventory"><InventoryPage /></RoleGuard>} />
            <Route path="customers"    element={<RoleGuard path="/customers"><PlanGuard path="/customers"><CustomersPage /></PlanGuard></RoleGuard>} />
            <Route path="credits"      element={<RoleGuard path="/credits"><PlanGuard path="/credits"><CreditsPage /></PlanGuard></RoleGuard>} />
            <Route path="transfers"    element={<RoleGuard path="/transfers"><PlanGuard path="/transfers"><TransfersPage /></PlanGuard></RoleGuard>} />
            <Route path="expenditures" element={<RoleGuard path="/expenditures"><PlanGuard path="/expenditures"><ExpenditurePage /></PlanGuard></RoleGuard>} />
            <Route path="reports"      element={<RoleGuard path="/reports"><PlanGuard path="/reports"><ReportsPage /></PlanGuard></RoleGuard>} />
            {/* MP-OWNER-OPERATIONS-DASHBOARD-V1: owner/manager deep-view.
                RoleGuard path matches Layout.NAV; PlanGuard reuses the
                reports section gate since the data class is the same. */}
            <Route path="operations"   element={<RoleGuard path="/operations"><PlanGuard path="/reports"><OperationsDashboardPage /></PlanGuard></RoleGuard>} />
            {/* MP-REFUNDS-STAFF-ACCESS: no PlanGuard — refunds are
                operational and must work on every plan tier. */}
            <Route path="refunds"      element={<RoleGuard path="/refunds"><RefundsPage /></RoleGuard>} />
            <Route path="settings"     element={<RoleGuard path="/settings"><PlanGuard path="/settings"><SettingsPage /></PlanGuard></RoleGuard>} />
            {/* MP-RESTRICTED-MODE (B2): reachable even when restricted — no PlanGuard. */}
            <Route path="request-activation" element={<RequestActivationPage />} />
            <Route path="shifts"       element={<RoleGuard path="/shifts"><ShiftsPage /></RoleGuard>} />
            <Route path="stock-count"  element={<RoleGuard path="/stock-count"><PlanGuard path="/stock-count"><StockCountPage /></PlanGuard></RoleGuard>} />
            <Route path="barcodes"     element={<RoleGuard path="/barcodes"><PlanGuard path="/barcodes"><BarcodePage /></PlanGuard></RoleGuard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" toastOptions={{
        style: { background: "#1e1d2e", color: "#f4f3ff", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", fontSize: "13px" }
      }} />
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
