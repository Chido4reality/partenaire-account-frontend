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

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

function Guard({ children }) {
  return useAuthStore(s => s.isAuthenticated) ? children : <Navigate to="/login" replace />;
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
            <Route index               element={<Dashboard />} />
            <Route path="pos"          element={<POSPage />} />
            <Route path="inventory"    element={<InventoryPage />} />
            <Route path="customers"    element={<CustomersPage />} />
            <Route path="credits"      element={<CreditsPage />} />
            <Route path="transfers"    element={<TransfersPage />} />
            <Route path="expenditures" element={<ExpenditurePage />} />
            <Route path="reports"      element={<ReportsPage />} />
            <Route path="settings"     element={<SettingsPage />} />
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







