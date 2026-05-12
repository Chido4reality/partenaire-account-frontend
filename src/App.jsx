import InventoryPage from "./pages/InventoryPage";
import { useEffect, Component } from "react";
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
import ReportsPage from "./pages/ReportsPage";
import TransfersPage from "./pages/TransfersPage";
import ExpenditurePage from "./pages/ExpenditurePage";
import CreditsPage from "./pages/CreditsPage";
import CustomersPage from "./pages/CustomersPage";
import SettingsPage from "./pages/SettingsPage";
import ShiftsPage from "./pages/ShiftsPage";
import StockCountPage from "./pages/StockCountPage";
import BarcodePage from "./pages/BarcodePage";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

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
          style={{ padding: "10px 24px", borderRadius: 10, background: "#4f46e5", border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
          Reload app
        </button>
      </div>
    );
  }
}

// Route access rules per role
const ROUTE_ACCESS = {
  "/":             ["owner", "manager", "cashier", "warehouse"],
  "/pos":          ["owner", "manager", "cashier"],
  "/inventory":    ["owner", "manager", "warehouse"],
  "/customers":    ["owner", "manager"],
  "/credits":      ["owner", "manager"],
  "/transfers":    ["owner", "manager", "warehouse"],
  "/expenditures": ["owner", "manager"],
  "/reports":      ["owner", "manager"],
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

const SILVER_ALLOWED = ["/", "/pos", "/inventory", "/shifts"];

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

export default function App() {
  const { setOnline } = useOfflineStore();
  useEffect(() => {
    window.addEventListener("online",  () => setOnline(true));
    window.addEventListener("offline", () => setOnline(false));
    const onSync = ({ detail }) => {
      toast.success(
        `✓ ${detail.synced} offline sale${detail.synced > 1 ? "s" : ""} synced`,
        { duration: 4000, style: { background: "#064e3b", color: "#6ee7b7", border: "1px solid #065f46" } }
      );
    };
    window.addEventListener("sw-sync-complete", onSync);
    return () => window.removeEventListener("sw-sync-complete", onSync);
  }, []);

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
            <Route path="inventory"    element={<RoleGuard path="/inventory"><InventoryPage /></RoleGuard>} />
            <Route path="customers"    element={<RoleGuard path="/customers"><PlanGuard path="/customers"><CustomersPage /></PlanGuard></RoleGuard>} />
            <Route path="credits"      element={<RoleGuard path="/credits"><PlanGuard path="/credits"><CreditsPage /></PlanGuard></RoleGuard>} />
            <Route path="transfers"    element={<RoleGuard path="/transfers"><PlanGuard path="/transfers"><TransfersPage /></PlanGuard></RoleGuard>} />
            <Route path="expenditures" element={<RoleGuard path="/expenditures"><PlanGuard path="/expenditures"><ExpenditurePage /></PlanGuard></RoleGuard>} />
            <Route path="reports"      element={<RoleGuard path="/reports"><PlanGuard path="/reports"><ReportsPage /></PlanGuard></RoleGuard>} />
            <Route path="settings"     element={<RoleGuard path="/settings"><PlanGuard path="/settings"><SettingsPage /></PlanGuard></RoleGuard>} />
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
