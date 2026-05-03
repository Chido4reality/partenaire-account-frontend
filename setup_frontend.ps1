# Mon Partenaire Frontend Setup
# Double-click this file or run: powershell -ExecutionPolicy Bypass -File setup_frontend.ps1
# Run from inside: C:\Users\Admin\Desktop\partenaire_account\frontend\

Write-Host "Setting up Mon Partenaire frontend..." -ForegroundColor Cyan

# Create folders
foreach ($dir in @("src\pages","src\components\common","src\store","src\utils","src\i18n")) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# Move any loose files
if (Test-Path "Dashboard.jsx") { Move-Item "Dashboard.jsx" "src\pages\Dashboard.jsx" -Force }
if (Test-Path "POSPage.jsx")   { Move-Item "POSPage.jsx"   "src\pages\POSPage.jsx"   -Force }

# index.html
@'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mon Partenaire</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
'@ | Set-Content -Path "index.html" -Encoding UTF8

# vite.config.js
@'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
});
'@ | Set-Content -Path "vite.config.js" -Encoding UTF8

# postcss.config.js
@'
export default { plugins: { autoprefixer: {} } };
'@ | Set-Content -Path "postcss.config.js" -Encoding UTF8

# .env
@'
VITE_API_URL=http://localhost:3001/api
'@ | Set-Content -Path ".env" -Encoding UTF8

# src/main.jsx
@'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
'@ | Set-Content -Path "src\main.jsx" -Encoding UTF8

# src/index.css
@'
@import url("https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap");
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#4f46e5;--brand-light:#818cf8;--brand-dark:#3730a3;
  --success:#10b981;--warning:#f59e0b;--danger:#ef4444;
  --bg-base:#0f0e17;--bg-surface:#1a1928;--bg-elevated:#232235;--bg-card:#1e1d2e;
  --text-primary:#f4f3ff;--text-secondary:#a09fbe;--text-muted:#6b6a8a;
  --border:rgba(255,255,255,0.08);--border-hover:rgba(255,255,255,0.16);
  --radius-md:10px;--radius-lg:16px;
  --font-display:"Syne",sans-serif;--font-body:"DM Sans",sans-serif;
}
html,body,#root{height:100%;background:var(--bg-base);color:var(--text-primary);font-family:var(--font-body);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased;}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border-hover);border-radius:4px}
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border-radius:var(--radius-md);font-family:var(--font-body);font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all 0.15s;white-space:nowrap}
.btn-primary{background:var(--brand);color:#fff}.btn-primary:hover{background:var(--brand-dark)}
.btn-secondary{background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border)}
.btn-success{background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.2)}
.btn-danger{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.2)}
.btn:disabled{opacity:0.4;cursor:not-allowed}.btn-sm{padding:6px 12px;font-size:12px}.btn-lg{padding:12px 24px;font-size:15px}.btn-block{width:100%}
.input{width:100%;padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-md);color:var(--text-primary);font-family:var(--font-body);font-size:14px;transition:border-color 0.15s;outline:none}
.input:focus{border-color:var(--brand)}.input::placeholder{color:var(--text-muted)}
select.input{cursor:pointer}
.label{display:block;font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;letter-spacing:0.04em;text-transform:uppercase}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600}
.stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px 24px;transition:border-color 0.2s}
.stat-card:hover{border-color:var(--border-hover)}
.stat-label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
.stat-value{font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text-primary)}
.stat-sub{font-size:12px;color:var(--text-secondary);margin-top:4px}
.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.page-title{font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text-primary)}
.page-sub{font-size:13px;color:var(--text-secondary);margin-top:2px}
.table{width:100%;border-collapse:collapse}
.table th{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;padding:10px 16px;text-align:left;border-bottom:1px solid var(--border)}
.table td{padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-primary)}
.table tr:last-child td{border-bottom:none}
.form-group{margin-bottom:16px}
.empty-state{text-align:center;padding:48px 24px;color:var(--text-muted)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px;backdrop-filter:blur(4px)}
.modal{background:var(--bg-card);border:1px solid var(--border);border-radius:20px;padding:28px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.fade-up{animation:fadeUp 0.3s ease both}
'@ | Set-Content -Path "src\index.css" -Encoding UTF8

# src/i18n/translations.js
@'
export const translations = {
  en: {
    nav:{dashboard:"Dashboard",sales:"Sales",inventory:"Inventory",customers:"Customers",credits:"Credits",transfers:"Transfers",expenditures:"Expenses",reports:"Reports",settings:"Settings"},
    auth:{login:"Sign In",logout:"Sign Out",phone:"Phone number",password:"Password",loginBtn:"Sign In",register:"Create account",creating:"Creating...",logging:"Signing in..."},
    pos:{title:"New Sale",scanOrSearch:"Scan barcode or search product...",cart:"Cart",total:"Total",paid:"Paid",balance:"Balance due",confirmSale:"Confirm Sale",saleSuccess:"Sale recorded!",selectCustomer:"Select customer (optional)",noCustomer:"Walk-in sale",emptyCart:"Cart is empty",proceedPayment:"Proceed to payment",back:"Back"},
    dashboard:{todaySales:"Today Sales",cashCollected:"Cash Collected",creditSales:"Credit Sales",totalExpenses:"Expenses",netCash:"Net Cash",netProfit:"Net Profit",profitMargin:"Margin",transactions:"transactions",lowStockAlert:"low stock items",overdueCredits:"overdue credits",recentSales:"Recent Sales",quickActions:"Quick Actions"},
    common:{save:"Save",cancel:"Cancel",delete:"Delete",edit:"Edit",search:"Search...",loading:"Loading...",error:"Something went wrong",back:"Back",add:"Add",total:"Total",date:"Date",status:"Status",noData:"No data",currency:"FCFA",all:"All",paid:"Paid",unpaid:"Unpaid",partial:"Partial",credit:"Credit"}
  },
  fr: {
    nav:{dashboard:"Tableau de bord",sales:"Ventes",inventory:"Stock",customers:"Clients",credits:"Credits",transfers:"Transferts",expenditures:"Depenses",reports:"Rapports",settings:"Parametres"},
    auth:{login:"Connexion",logout:"Deconnexion",phone:"Telephone",password:"Mot de passe",loginBtn:"Se connecter",register:"Creer un compte",creating:"Creation...",logging:"Connexion..."},
    pos:{title:"Nouvelle vente",scanOrSearch:"Scanner ou rechercher...",cart:"Panier",total:"Total",paid:"Paye",balance:"Reste",confirmSale:"Valider la vente",saleSuccess:"Vente enregistree!",selectCustomer:"Choisir un client",noCustomer:"Vente anonyme",emptyCart:"Le panier est vide",proceedPayment:"Proceder au paiement",back:"Retour"},
    dashboard:{todaySales:"Ventes du jour",cashCollected:"Especes encaissees",creditSales:"Ventes a credit",totalExpenses:"Depenses",netCash:"Solde net",netProfit:"Benefice net",profitMargin:"Marge",transactions:"transactions",lowStockAlert:"articles en rupture",overdueCredits:"credits en retard",recentSales:"Ventes recentes",quickActions:"Actions rapides"},
    common:{save:"Enregistrer",cancel:"Annuler",delete:"Supprimer",edit:"Modifier",search:"Rechercher...",loading:"Chargement...",error:"Une erreur est survenue",back:"Retour",add:"Ajouter",total:"Total",date:"Date",status:"Statut",noData:"Aucune donnee",currency:"FCFA",all:"Tous",paid:"Paye",unpaid:"Non paye",partial:"Partiel",credit:"Credit"}
  }
};
'@ | Set-Content -Path "src\i18n\translations.js" -Encoding UTF8

# src/store/index.js
@'
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { translations } from "../i18n/translations";

export const useAuthStore = create(persist(
  (set) => ({
    user: null, org: null, token: null, isAuthenticated: false,
    login: (user, org, token) => set({ user, org, token, isAuthenticated: true }),
    logout: () => set({ user: null, org: null, token: null, isAuthenticated: false }),
  }),
  { name: "mp-auth" }
));

export const useLangStore = create(persist(
  (set, get) => ({
    lang: "en",
    setLang: (lang) => set({ lang }),
    t: (key) => {
      const dict = translations[get().lang];
      const keys = key.split(".");
      let val = dict;
      for (const k of keys) val = val?.[k];
      return val || key;
    }
  }),
  { name: "mp-lang" }
));

export const useOfflineStore = create(persist(
  (set) => ({
    queue: [], isOnline: true,
    setOnline: (v) => set({ isOnline: v }),
  }),
  { name: "mp-offline" }
));

export const useSettingsStore = create(persist(
  (set) => ({
    selectedLocation: null,
    setLocation: (loc) => set({ selectedLocation: loc }),
  }),
  { name: "mp-settings" }
));
'@ | Set-Content -Path "src\store\index.js" -Encoding UTF8

# src/utils/api.js
@'
import axios from "axios";
import { useAuthStore } from "../store";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 12000 });

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(res => res, err => {
  if (err.response?.status === 401) { useAuthStore.getState().logout(); window.location.href = "/login"; }
  return Promise.reject(err);
});

export default api;

export const formatCFA = (amount) => {
  if (!amount && amount !== 0) return "—";
  return new Intl.NumberFormat("fr-CM").format(Math.round(amount)) + " FCFA";
};

export const formatDate = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
'@ | Set-Content -Path "src\utils\api.js" -Encoding UTF8

# src/App.jsx
@'
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
import { InventoryPage, CustomersPage, CreditsPage, TransfersPage, ExpenditurePage, ReportsPage, SettingsPage } from "./pages/Placeholders";

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
'@ | Set-Content -Path "src\App.jsx" -Encoding UTF8

# src/components/common/Layout.jsx
@'
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuthStore, useLangStore, useOfflineStore } from "../../store";
import api from "../../utils/api";

const NAV = [
  { to: "/",             icon: "◈", key: "dashboard" },
  { to: "/pos",          icon: "⊕", key: "sales" },
  { to: "/inventory",    icon: "⊟", key: "inventory" },
  { to: "/customers",    icon: "◉", key: "customers" },
  { to: "/credits",      icon: "◎", key: "credits" },
  { to: "/transfers",    icon: "⇄", key: "transfers" },
  { to: "/expenditures", icon: "⊖", key: "expenditures" },
  { to: "/reports",      icon: "▦", key: "reports" },
];

export default function Layout() {
  const { user, org, logout } = useAuthStore();
  const { lang, setLang, t }  = useLangStore();
  const { isOnline }          = useOfflineStore();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate("/login"); };
  const toggleLang   = () => { const nl = lang === "en" ? "fr" : "en"; setLang(nl); api.patch("/auth/language", { language: nl }).catch(() => {}); };

  const sideW = collapsed ? 60 : 220;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={{ width: sideW, flexShrink: 0, height: "100vh", background: "var(--bg-surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s ease", position: "sticky", top: 0 }}>
        <div style={{ padding: collapsed ? "16px 0" : "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", minHeight: 60 }}>
          {!collapsed && (
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>Mon Partenaire</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{org?.name}</div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, padding: 4, flexShrink: 0 }}>
            {collapsed ? "▷" : "◁"}
          </button>
        </div>

        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              title={collapsed ? t("nav." + item.key) : ""}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? "center" : "flex-start",
                padding: collapsed ? "12px 0" : "10px 16px",
                color: isActive ? "#fff" : "var(--text-secondary)",
                textDecoration: "none",
                background: isActive ? "rgba(79,70,229,0.2)" : "transparent",
                borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                fontSize: 13, fontWeight: isActive ? 500 : 400, transition: "all 0.15s"
              })}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && t("nav." + item.key)}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: collapsed ? "12px 0" : "12px 16px", borderTop: "1px solid var(--border)" }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#10b981" : "#ef4444", flexShrink: 0 }} />
              <span style={{ color: "var(--text-muted)" }}>{isOnline ? "Online" : "Offline"}</span>
            </div>
          )}
          <button onClick={toggleLang} style={{ width: "100%", padding: collapsed ? "8px 0" : "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 6, marginBottom: 6 }}>
            <span>🌐</span>{!collapsed && (lang === "en" ? "Francais" : "English")}
          </button>
          {!collapsed && <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, paddingLeft: 4 }}>{user?.full_name} · <span style={{ color: "var(--brand-light)" }}>{user?.role}</span></div>}
          <button onClick={handleLogout} style={{ width: "100%", padding: collapsed ? "8px 0" : "7px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 6 }}>
            <span>⏻</span>{!collapsed && t("auth.logout")}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-base)" }}>
        <Outlet />
      </main>
    </div>
  );
}
'@ | Set-Content -Path "src\components\common\Layout.jsx" -Encoding UTF8

# src/pages/LoginPage.jsx
@'
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

export default function LoginPage() {
  const [phone, setPhone]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuthStore();
  const { t, lang, setLang }    = useLangStore();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { phone, password });
      login(res.data.user, res.data.org, res.data.token);
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 14px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🤝</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)" }}>Mon Partenaire</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>{lang === "en" ? "Manage your shop, grow your business" : "Gerez votre boutique, developpez votre business"}</p>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{t("auth.login")}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="label">{t("auth.phone")}</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{t("auth.password")}</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? t("auth.logging") : t("auth.loginBtn")}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "var(--text-secondary)" }}>
            {lang === "en" ? "No account yet? " : "Pas encore de compte? "}
            <Link to="/register" style={{ color: "var(--brand-light)", fontWeight: 500, textDecoration: "none" }}>{t("auth.register")}</Link>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Francais" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
'@ | Set-Content -Path "src\pages\LoginPage.jsx" -Encoding UTF8

# src/pages/RegisterPage.jsx
@'
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

const CATS = [
  { value: "moto_parts",  en: "Motorcycle parts",  fr: "Pieces moto" },
  { value: "electronics", en: "Electronics",        fr: "Electronique" },
  { value: "general",     en: "General trade",      fr: "Commerce general" },
  { value: "food",        en: "Food & grocery",     fr: "Alimentation" },
  { value: "hardware",    en: "Hardware & tools",   fr: "Quincaillerie" },
];

export default function RegisterPage() {
  const [form, setForm] = useState({ org_name: "", full_name: "", phone: "", password: "", category: "moto_parts" });
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const navigate = useNavigate();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/register", form);
      login(res.data.user, res.data.org, res.data.token);
      toast.success(lang === "en" ? "Account created!" : "Compte cree!");
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏪</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{lang === "en" ? "Create your account" : "Creer votre compte"}</h1>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <form onSubmit={handleSubmit}>
            {[
              { key: "org_name",  en: "Business name",  fr: "Nom de la boutique", type: "text",     ph: "Ex: Moto Parts Akwa" },
              { key: "full_name", en: "Your full name", fr: "Votre nom complet",  type: "text",     ph: "Jean Dupont" },
              { key: "phone",     en: "Phone number",   fr: "Telephone",          type: "tel",      ph: "6XXXXXXXX" },
              { key: "password",  en: "Password",       fr: "Mot de passe",       type: "password", ph: "Min. 6 characters" },
            ].map(f => (
              <div className="form-group" key={f.key}>
                <label className="label">{lang === "en" ? f.en : f.fr}</label>
                <input className="input" type={f.type} value={form[f.key]} onChange={e => set(f.key, e.target.value)} required placeholder={f.ph} />
              </div>
            ))}
            <div className="form-group">
              <label className="label">{lang === "en" ? "Business category" : "Secteur d activite"}</label>
              <select className="input" value={form.category} onChange={e => set("category", e.target.value)}>
                {CATS.map(c => <option key={c.value} value={c.value}>{lang === "en" ? c.en : c.fr}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? "Creating..." : (lang === "en" ? "Create my account" : "Creer mon compte")}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
            <Link to="/login" style={{ color: "var(--brand-light)", textDecoration: "none" }}>
              {lang === "en" ? "Already have an account? Sign in" : "Deja un compte? Se connecter"}
            </Link>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Francais" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
'@ | Set-Content -Path "src\pages\RegisterPage.jsx" -Encoding UTF8

# src/pages/Placeholders.jsx
@'
import { useLangStore } from "../store";

const Shell = ({ icon, titleKey, children }) => {
  const { t } = useLangStore();
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{icon} {t(titleKey)}</h1>
      </div>
      {children}
    </div>
  );
};

const Soon = ({ name }) => (
  <div style={{ border: "2px dashed var(--border)", borderRadius: 16, padding: 64, textAlign: "center", color: "var(--text-muted)" }}>
    <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.4 }}>⊟</div>
    <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>{name} — Coming next</div>
    <div style={{ fontSize: 13 }}>Database and API fully ready. UI module building next.</div>
  </div>
);

export const InventoryPage   = () => <Shell icon="⊟" titleKey="nav.inventory"><Soon name="Inventory" /></Shell>;
export const CustomersPage   = () => <Shell icon="◉" titleKey="nav.customers"><Soon name="Customers" /></Shell>;
export const CreditsPage     = () => <Shell icon="◎" titleKey="nav.credits"><Soon name="Credits" /></Shell>;
export const TransfersPage   = () => <Shell icon="⇄" titleKey="nav.transfers"><Soon name="Transfers" /></Shell>;
export const ExpenditurePage = () => <Shell icon="⊖" titleKey="nav.expenditures"><Soon name="Expenses" /></Shell>;
export const ReportsPage     = () => <Shell icon="▦" titleKey="nav.reports"><Soon name="Reports" /></Shell>;
export const SettingsPage    = () => <Shell icon="⚙" titleKey="nav.settings"><Soon name="Settings" /></Shell>;
'@ | Set-Content -Path "src\pages\Placeholders.jsx" -Encoding UTF8

Write-Host ""
Write-Host "All files created successfully!" -ForegroundColor Green
Write-Host "Now run: npm run dev" -ForegroundColor Cyan
