import InventoryPage from "./pages/InventoryPage";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useAuthStore, useOfflineStore } from "./store";
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

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

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

export default function App() {
  const { setOnline } = useOfflineStore();
  useEffect(() => {
    window.addEventListener("online",  () => setOnline(true));
    window.addEventListener("offline", () => setOnline(false));
  }, []);

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Guard><Layout /></Guard>}>
            <Route index               element={<RoleGuard path="/"><Dashboard /></RoleGuard>} />
            <Route path="pos"          element={<RoleGuard path="/pos"><POSPage /></RoleGuard>} />
            <Route path="inventory"    element={<RoleGuard path="/inventory"><InventoryPage /></RoleGuard>} />
            <Route path="customers"    element={<RoleGuard path="/customers"><CustomersPage /></RoleGuard>} />
            <Route path="credits"      element={<RoleGuard path="/credits"><CreditsPage /></RoleGuard>} />
            <Route path="transfers"    element={<RoleGuard path="/transfers"><TransfersPage /></RoleGuard>} />
            <Route path="expenditures" element={<RoleGuard path="/expenditures"><ExpenditurePage /></RoleGuard>} />
            <Route path="reports"      element={<RoleGuard path="/reports"><ReportsPage /></RoleGuard>} />
            <Route path="settings"     element={<RoleGuard path="/settings"><SettingsPage /></RoleGuard>} />
            <Route path="shifts"       element={<RoleGuard path="/shifts"><ShiftsPage /></RoleGuard>} />
            <Route path="stock-count"  element={<RoleGuard path="/stock-count"><StockCountPage /></RoleGuard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" toastOptions={{
        style: { background: "#1e1d2e", color: "#f4f3ff", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", fontSize: "13px" }
      }} />
    </QueryClientProvider>
  );
}
