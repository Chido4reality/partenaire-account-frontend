// v12 - receipt payment status fix
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import OwnerPIN from "../components/common/OwnerPIN";
import api, { formatCFA } from "../utils/api";
import { savePendingSale, generateLocalId, initDB, cacheData, getCachedData } from "../utils/offlineStore";
import { syncPendingSales } from "../utils/syncService";
import CameraScanner from "../components/common/CameraScanner";

const PAYMENT_MODES = [
  { key: "paid",    en: "Full Payment",  fr: "Paiement total",   color: "#10b981", icon: "✓" },
  { key: "partial", en: "Partial",       fr: "Partiel",          color: "#f59e0b", icon: "◑" },
  { key: "credit",  en: "Full Credit",   fr: "Crédit total",     color: "#ef4444", icon: "↗" },
];

const PAY_METHODS = [
  { key: "cash",         en: "Cash",         fr: "Espèces",     icon: "💵" },
  { key: "mobile_money", en: "Mobile Money", fr: "Mobile Money",icon: "📱" },
  { key: "bank",         en: "Bank",         fr: "Virement",    icon: "🏦" },
];

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const s = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const p = pattern.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes(p)) return true;
  let score = 0;
  for (let i = 0; i < p.length - 1; i++) {
    if (s.includes(p.slice(i, i + 2))) score++;
  }
  return score >= Math.floor(p.length * 0.4);
}

export default function POSPage() {
  const { lang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";

  const [cart, setCart]                   = useState([]);
  const [search, setSearch]               = useState("");
  const [customer, setCustomer]           = useState(null);
  const [custSearch, setCustSearch]       = useState("");
  const [showCustDrop, setShowCustDrop]   = useState(false);
  const [payMode, setPayMode]             = useState("paid");
  const [paidAmt, setPaidAmt]             = useState("");
  const [dueDate, setDueDate]             = useState("");
  const [payMethod, setPayMethod]         = useState("cash");
  const [notes, setNotes]                 = useState("");
  const [showPayment, setShowPayment]     = useState(false);
  const [showCamera, setShowCamera]       = useState(false);
  const [scanMode, setScanMode]           = useState(isMobile() ? "camera" : "usb");
  const [scanning, setScanning]           = useState(false);
  const [lastScan, setLastScan]           = useState(null);
  const [showDebtModal, setShowDebtModal]     = useState(false);
  const [showPIN, setShowPIN]               = useState(false);
  const [showReceipt, setShowReceipt]       = useState(false);
  const [lastSale, setLastSale]             = useState(null);
  const [pinItem, setPinItem]               = useState(null); // {idx, price} pending PIN approval
  const [debtInvoices, setDebtInvoices]       = useState([]);
  const [selectedDebtIds, setSelectedDebtIds] = useState(new Set());
  const [debtPayAmt, setDebtPayAmt]           = useState(""); // partial debt payment amount

  const searchRef     = useRef(null);
  const custRef       = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);

  useEffect(() => {
    if (scanMode !== "usb") return;
    const handleKey = async (e) => {
      const active = document.activeElement;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (isTyping && active !== searchRef.current) return;
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (code.length >= 3) {
          setScanning(true);
          await scanBarcode(code);
          setTimeout(() => setScanning(false), 600);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        barcodeBuffer.current += e.key;
        clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 200);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); clearTimeout(barcodeTimer.current); };
  }, [scanMode, selectedLocation]);

  const scanBarcode = async (code) => {
    try {
      const res = await api.get("/products/barcode/" + code + "?location_id=" + (selectedLocation?.id || ""));
      const product = res.data.data;
      addToCart(product);
      setLastScan({ name: product.name, success: true });
      toast.success(`✓ ${product.name}`, { duration: 1500, position: "top-center" });
    } catch {
      setLastScan({ name: code, success: false });
      toast.error(lang === "en" ? `Not found: ${code}` : `Introuvable: ${code}`, { position: "top-center" });
    }
  };

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = await getCachedData("pos-locations");
        return cached || { data: [] };
      }
      const result = await api.get("/locations").then(r => r.data);
      cacheData("pos-locations", result);
      return result;
    }
  });

  const { data: allProducts } = useQuery({
    queryKey: ["pos-products", selectedLocation?.id],
    queryFn: async () => {
      const cacheKey = "pos-products-" + (selectedLocation?.id || "all");
      if (!navigator.onLine) {
        const cached = await getCachedData(cacheKey);
        return cached || { data: [] };
      }
      const result = await api.get("/products?location_id=" + (selectedLocation?.id || "") + "&limit=200").then(r => r.data);
      cacheData(cacheKey, result); // cache for offline use
      return result;
    },
    enabled: true,
    staleTime: 60000
  });

  const { data: allCustomers } = useQuery({
    queryKey: ["pos-customers"],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = await getCachedData("pos-customers");
        return cached || { data: [] };
      }
      const result = await api.get("/customers?limit=300").then(r => r.data);
      cacheData("pos-customers", result);
      return result;
    },
    staleTime: 60000
  });

  // ── ORG SETTINGS (for receipts) ──────────────────────────────────────────
  const { data: orgData } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
    staleTime: 300000
  });
  const orgSettings = orgData?.data || {};

  const { data: customerDebtData, isLoading: debtLoading } = useQuery({
    queryKey: ["customer-debt", customer?.id],
    queryFn: () => api.get(`/sales/customer-debt/${customer.id}`).then(r => r.data),
    enabled: !!customer?.id && (customer?.total_debt || 0) > 0,
    staleTime: 0,
  });

  useEffect(() => {
    if (customerDebtData?.data?.length > 0) {
      setDebtInvoices(customerDebtData.data);
      setSelectedDebtIds(new Set(customerDebtData.data.map(i => i.id)));
      setShowDebtModal(true);
    }
  }, [customerDebtData]);

  const locations = locData?.data || [];

  const filteredProducts = search.length >= 1
    ? (allProducts?.data || []).filter(p =>
        fuzzyMatch(p.name, search) ||
        fuzzyMatch(p.name_en, search) ||
        (p.barcode && p.barcode.includes(search))
      ).slice(0, 10)
    : [];

  const filteredCustomers = custSearch.length >= 1 && !customer
    ? (allCustomers?.data || []).filter(c =>
        fuzzyMatch(c.name, custSearch) ||
        (c.phone && c.phone.includes(custSearch))
      ).slice(0, 8)
    : [];

  // ── PRICE TIER: auto-apply based on customer type ───────────────────────────
  const getPrice = (product) => {
    const customerType = customer?.customer_type || "retail";
    if (customerType === "wholesale" && product.wholesale_price > 0) {
      return product.wholesale_price;
    }
    return product.sell_price;
  };

  const addToCart = (product, qty = 1) => {
    const price = getPrice(product);
    // Low stock warning
    const stockQty = product.stock?.quantity;
    const minQty = product.stock?.min_quantity || 5;
    if (stockQty !== undefined && stockQty <= minQty) {
      toast(`⚠️ ${lang === "en" ? "Low stock:" : "Stock bas:"} ${product.name} — ${stockQty} ${product.unit} ${lang === "en" ? "remaining" : "restant(s)"}`, {
        duration: 3000,
        style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" }
      });
    }
    setCart(prev => {
      const idx = prev.findIndex(i => i.product_id === (product.product_id || product.id));
      if (idx >= 0) {
        const u = [...prev];
        u[idx] = { ...u[idx], quantity: u[idx].quantity + qty };
        return u;
      }
      return [...prev, {
        product_id: product.product_id || product.id,
        name: product.name, unit: product.unit, barcode: product.barcode,
        quantity: qty,
        unit_price: price,
        original_price: price,
        min_price: product.min_price || 0,
        cost_price: product.cost_price,
        stock: product.stock?.quantity
      }];
    });
    setSearch("");
  };

  const addDebtToCart = () => {
    const selected = debtInvoices.filter(i => selectedDebtIds.has(i.id));
    if (!selected.length) { setShowDebtModal(false); return; }
    const totalAmt = selected.reduce((s, i) => s + parseFloat(i.balance_due), 0);
    const refs = selected.map(i => i.sale_number).join(", ");
    setCart(prev => [
      ...prev.filter(i => i.product_id !== "__DEBT__"),
      { product_id: "__DEBT__", name: `${lang === "en" ? "Debt repayment" : "Remboursement"} (${refs})`, unit: "pce", quantity: 1, unit_price: totalAmt, cost_price: 0, isDebt: true, debtSaleIds: selected.map(i => i.id), debtAmount: totalAmt }
    ]);
    setShowDebtModal(false);
    setShowPayment(true);
  };

  const updateQty   = (idx, qty) => qty <= 0
    ? setCart(c => c.filter((_, i) => i !== idx))
    : setCart(c => c.map((it, i) => i === idx ? { ...it, quantity: qty } : it));

  const updatePrice = (idx, price) => {
    const item = cart[idx];
    const newPrice = +price;
    const minPrice = item.min_price || 0;
    // Owner can always change price freely
    if (isOwner) {
      setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: newPrice } : it));
      return;
    }
    // Staff: block below min price, require PIN
    if (minPrice > 0 && newPrice < minPrice) {
      setPinItem({ idx, price: newPrice });
      setShowPIN(true);
      return;
    }
    setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: newPrice } : it));
  };

  const total   = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const hasDebt = cart.some(i => i.product_id === "__DEBT__");
  const paid    = payMode === "paid" ? total : payMode === "credit" ? 0 : (+paidAmt || 0);
  const balance = total - paid;

  const saleMutation = useMutation({
    mutationFn: async () => {
      const debtItem = cart.find(i => i.product_id === "__DEBT__");
      if (debtItem) {
        // If partial debt amount entered, split proportionally across invoices
        const totalDebt = debtItem.debtAmount;
        const amountToPay = debtPayAmt ? Math.min(parseFloat(debtPayAmt), totalDebt) : totalDebt;
        let remaining = amountToPay;
        for (const saleId of debtItem.debtSaleIds) {
          if (remaining <= 0) break;
          const inv = debtInvoices.find(i => i.id === saleId);
          if (!inv) continue;
          const invBalance = parseFloat(inv.balance_due);
          const payThis = Math.min(remaining, invBalance);
          await api.post(`/sales/${saleId}/payment`, { amount: payThis, payment_method: payMethod, notes: notes || null });
          remaining -= payThis;
        }
        return { isDebt: true };
      }
      // If offline, save to local queue
      if (!navigator.onLine) {
        const payload = {
          local_id: generateLocalId(),
          location_id: selectedLocation?.id,
          customer_id: customer?.id || null,
          items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
          payment_method: payMethod, paid_amount: paid, due_date: dueDate || null, notes: notes || null,
          is_offline: true,
          sale_number: `OFFLINE-${Date.now()}`,
          total_amount: total,
          created_at: new Date().toISOString()
        };
        await initDB();
        await savePendingSale(payload);
        return { offline: true, sale_number: payload.sale_number };
      }
      // Test real connectivity with a quick ping (navigator.onLine is unreliable on Windows)
      const isReallyOnline = await (async () => {
        try {
          await fetch(import.meta.env.VITE_API_URL + "/health" || "/api/health", {
            method: "HEAD", cache: "no-store",
            signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined
          });
          return true;
        } catch { return false; }
      })();

      if (!isReallyOnline) {
        const op = {
          local_id: generateLocalId(), location_id: selectedLocation?.id,
          customer_id: customer?.id || null,
          items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
          payment_method: payMethod, paid_amount: paid, due_date: dueDate || null, notes: notes || null,
          is_offline: true, total_amount: cart.reduce((s, i) => s + i.quantity * i.unit_price, 0),
          sale_number: "OFFLINE-" + Date.now(), created_at: new Date().toISOString()
        };
        await savePendingSale(op);
        return { offline: true, sale_number: op.sale_number };
      }

      // Always try to save offline if not online
      const saveOffline = async () => {
        const op = {
          local_id: generateLocalId(), location_id: selectedLocation?.id,
          customer_id: customer?.id || null,
          items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
          payment_method: payMethod, paid_amount: paid, due_date: dueDate || null, notes: notes || null,
          is_offline: true, total_amount: cart.reduce((s, i) => s + i.quantity * i.unit_price, 0),
          sale_number: "OFFLINE-" + Date.now(), created_at: new Date().toISOString()
        };
        await savePendingSale(op);
        return { offline: true, sale_number: op.sale_number };
      };

      try {
        const result = await api.post("/sales", {
          location_id: selectedLocation?.id, customer_id: customer?.id || null,
          items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
          payment_method: payMethod, paid_amount: paid, due_date: dueDate || null, notes: notes || null
        }, { timeout: 8000 }).then(r => r.data);
        return result;
      } catch (err) {
        // Any network error → save offline
        if (!err.response || err.code === "ERR_NETWORK" || err.message?.includes("Network") || err.message?.includes("timeout")) {
          return await saveOffline();
        }
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data?.offline) {
        toast(`📥 ${lang === "en" ? "Saved offline — will sync when connected" : "Sauvé hors ligne — sync à la reconnexion"}`, {
          duration: 4000,
          style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" }
        });
        setCart([]); setCustomer(null); setNotes(""); setPaidAmt(""); setShowPayModal(false);
        return;
      }
      if (data?.isDebt) {
        toast.success(lang === "en" ? "✓ Debt payment recorded!" : "✓ Remboursement enregistré!", { duration: 2000 });
      } else {
        // Show receipt modal
        setLastSale({
          ...data,
          customer,
          items: cart,
          paid_amount: hasDebt ? total : paid,
          balance_due: hasDebt ? 0 : balance,
          payment_method: payMethod,
          payment_status: payMode,
        });
        setShowReceipt(true);
      }
      setCart([]); setCustomer(null); setPayMode("paid");
      setPaidAmt(""); setDueDate(""); setNotes(""); setShowPayment(false);
      setDebtInvoices([]); setSelectedDebtIds(new Set()); setDebtPayAmt("");
      qc.invalidateQueries(["recent-sales"]);
      qc.invalidateQueries(["daily-summary"]);
      qc.invalidateQueries(["pos-customers"]);
      qc.invalidateQueries(["customer-debt"]);
      qc.invalidateQueries(["credits"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const mobile = isMobile();

  return (
    <>
      {/* ── DEBT MODAL ─────────────────────────────────────── */}
      {showDebtModal && debtInvoices.length > 0 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>🧾 {lang === "en" ? "Open Invoices" : "Factures impayées"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {customer?.name} {lang === "en" ? "has unpaid invoices. Select which to collect:" : "a des factures impayées. Choisissez lesquelles encaisser :"}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setSelectedDebtIds(new Set(debtInvoices.map(i => i.id)))} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(79,70,229,0.1)", color: "var(--brand-light)", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Select all" : "Tout sélectionner"}
              </button>
              <button onClick={() => setSelectedDebtIds(new Set())} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
                {lang === "en" ? "Clear" : "Effacer"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20, maxHeight: 280, overflowY: "auto" }}>
              {debtInvoices.map(inv => {
                const checked = selectedDebtIds.has(inv.id);
                return (
                  <div key={inv.id}
                    onClick={() => { const n = new Set(selectedDebtIds); checked ? n.delete(inv.id) : n.add(inv.id); setSelectedDebtIds(n); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "rgba(79,70,229,0.08)" : "var(--bg-card)", cursor: "pointer", transition: "all 0.15s" }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "var(--brand)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontSize: 11, fontWeight: 700 }}>
                      {checked ? "✓" : ""}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{inv.sale_number}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{inv.sale_date}{inv.due_date && ` · Due ${inv.due_date}`}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, color: "#f87171", fontSize: 14 }}>{formatCFA(inv.balance_due)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{inv.payment_status}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedDebtIds.size > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{lang === "en" ? "To collect:" : "À encaisser :"}</span>
                <strong style={{ color: "#f87171" }}>{formatCFA(debtInvoices.filter(i => selectedDebtIds.has(i.id)).reduce((s, i) => s + parseFloat(i.balance_due), 0))}</strong>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowDebtModal(false)} style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Skip" : "Ignorer"}
              </button>
              <button onClick={addDebtToCart} disabled={selectedDebtIds.size === 0}
                style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: selectedDebtIds.size > 0 ? "var(--brand)" : "var(--border)", color: selectedDebtIds.size > 0 ? "#fff" : "var(--text-muted)", cursor: selectedDebtIds.size > 0 ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 14, transition: "all 0.15s" }}>
                {lang === "en" ? "Add to Cart →" : "Ajouter au panier →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCamera && (
        <CameraScanner lang={lang} onScan={(code) => { setShowCamera(false); scanBarcode(code); }} onClose={() => setShowCamera(false)} />
      )}

      <div style={{ display: "flex", height: "100%", flexDirection: mobile ? "column" : "row", background: "var(--bg-base)" }}>

        {/* ██ LEFT PANEL ████████████████████████████████████████ */}
        <div style={{ flex: 1, padding: mobile ? 12 : 20, overflowY: "auto", borderRight: mobile ? "none" : "1px solid var(--border)" }}>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.3px" }}>{lang === "en" ? "New Sale" : "Nouvelle vente"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {cart.length > 0 ? `${cart.length} item${cart.length > 1 ? "s" : ""} in cart` : lang === "en" ? "Search or scan to add items" : "Cherchez ou scannez"}
              </div>
            </div>
            {selectedLocation && (
              <div style={{ fontSize: 11, background: "rgba(79,70,229,0.12)", color: "var(--brand-light)", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>
                📍 {selectedLocation.name}
              </div>
            )}
          </div>

          {!selectedLocation && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#f87171" }}>
              ⚠️ {lang === "en" ? "Select a location to start selling" : "Choisissez un emplacement pour vendre"}
            </div>
          )}
          <select className="input" value={selectedLocation?.id || ""}
            onChange={e => { const loc = locations.find(l => l.id === e.target.value); setLocation(loc || null); }}
            style={{ marginBottom: 14, borderColor: !selectedLocation ? "#ef4444" : "var(--border)", fontWeight: selectedLocation ? 600 : 400 }}>
            <option value="">{lang === "en" ? "— Select location —" : "— Choisir emplacement —"}</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
          </select>

          {/* ── CUSTOMER SEARCH ── */}
          <div style={{ marginBottom: 14, position: "relative" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 5 }}>
              👤 {lang === "en" ? "Customer (optional)" : "Client (optionnel)"}
            </label>
            {customer ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(79,70,229,0.1)", border: "1px solid var(--brand)", borderRadius: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                  {customer.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{customer.name}</div>
                  {customer.phone && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{customer.phone}</div>}
                  {customer.customer_type === "wholesale" && (
                    <div style={{ fontSize: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24", padding: "2px 8px", borderRadius: 10, fontWeight: 700, marginTop: 2, display: "inline-block" }}>
                      🏭 {lang === "en" ? "Wholesale prices applied" : "Prix gros appliqués"}
                    </div>
                  )}
                  {customer.total_debt > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>🧾 Owes {formatCFA(customer.total_debt)}</div>
                      {!debtLoading && customerDebtData?.data?.length > 0 && (
                        <button onClick={() => setShowDebtModal(true)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, border: "1px solid #f87171", background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: "pointer", fontWeight: 700 }}>
                          {lang === "en" ? "Collect" : "Encaisser"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => { setCustomer(null); setDebtInvoices([]); setSelectedDebtIds(new Set()); setCart(c => c.filter(i => i.product_id !== "__DEBT__")); }}
                  style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", cursor: "pointer", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 700 }}>✕</button>
              </div>
            ) : (
              <>
                <input ref={custRef} className="input"
                  placeholder={lang === "en" ? "Type name or phone..." : "Nom ou téléphone..."}
                  value={custSearch}
                  onChange={e => { setCustSearch(e.target.value); setShowCustDrop(true); }}
                  onFocus={() => setShowCustDrop(true)}
                  onBlur={() => setTimeout(() => setShowCustDrop(false), 200)} />
                {showCustDrop && filteredCustomers.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginTop: 4, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}>
                    {filteredCustomers.map(c => (
                      <div key={c.id} onMouseDown={() => { setCustomer(c); setCustSearch(""); setShowCustDrop(false); }}
                        style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(79,70,229,0.2)", color: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                          {c.phone && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.phone}</div>}
                        </div>
                        {c.total_debt > 0 && (
                          <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, background: "rgba(239,68,68,0.1)", padding: "2px 8px", borderRadius: 10 }}>
                            {formatCFA(c.total_debt)}
                          </div>
                        )}
                      </div>
                    ))}
                    {custSearch.length > 0 && filteredCustomers.length === 0 && (
                      <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                        {lang === "en" ? "No customer found" : "Aucun client trouvé"}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── SCANNER SECTION ── */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 8 }}>
              📦 {lang === "en" ? "Add Products" : "Ajouter produits"}
            </label>
            <div style={{ display: "flex", gap: 0, marginBottom: 10, background: "var(--bg-elevated)", borderRadius: 10, padding: 3, border: "1px solid var(--border)" }}>
              <button onClick={() => setScanMode("search")} style={{ flex: 1, padding: "7px 8px", border: "none", borderRadius: 8, background: scanMode === "search" ? "var(--bg-card)" : "transparent", color: scanMode === "search" ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: scanMode === "search" ? 700 : 400, transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                🔍 {lang === "en" ? "Search" : "Chercher"}
              </button>
              <button onClick={() => setScanMode("usb")} style={{ flex: 1, padding: "7px 8px", border: "none", borderRadius: 8, background: scanMode === "usb" ? "var(--bg-card)" : "transparent", color: scanMode === "usb" ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: scanMode === "usb" ? 700 : 400, transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                🔌 USB
              </button>
              <button onClick={() => setScanMode("camera")} style={{ flex: 1, padding: "7px 8px", border: "none", borderRadius: 8, background: scanMode === "camera" ? "var(--bg-card)" : "transparent", color: scanMode === "camera" ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: scanMode === "camera" ? 700 : 400, transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                📷 {lang === "en" ? "Camera" : "Caméra"}
              </button>
            </div>

            {scanMode === "usb" && (
              <div style={{ background: scanning ? "rgba(16,185,129,0.1)" : "rgba(79,70,229,0.08)", border: `1.5px solid ${scanning ? "#10b981" : "var(--brand)"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 8, textAlign: "center", transition: "all 0.3s" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{scanning ? "✓" : "🔌"}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: scanning ? "#10b981" : "var(--brand-light)" }}>
                  {scanning ? (lang === "en" ? "Item added!" : "Article ajouté!") : (lang === "en" ? "USB Scanner Ready" : "Lecteur USB prêt")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                  {lang === "en" ? "Scan barcode directly — no click needed" : "Scannez directement — pas besoin de cliquer"}
                </div>
                {lastScan && (
                  <div style={{ marginTop: 8, fontSize: 12, color: lastScan.success ? "#10b981" : "#f87171", fontWeight: 600 }}>
                    {lastScan.success ? "✓" : "✕"} {lastScan.name}
                  </div>
                )}
              </div>
            )}

            {scanMode === "camera" && (
              <button onClick={() => setShowCamera(true)}
                style={{ width: "100%", padding: "16px", marginBottom: 8, background: "rgba(79,70,229,0.1)", border: "2px dashed var(--brand)", borderRadius: 12, color: "var(--brand-light)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(79,70,229,0.2)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(79,70,229,0.1)"}>
                <span style={{ fontSize: 24 }}>📷</span>
                <div style={{ textAlign: "left" }}>
                  <div>{lang === "en" ? "Tap to Scan Barcode" : "Scanner un code-barres"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginTop: 1 }}>{lang === "en" ? "Uses your phone camera" : "Utilise la caméra"}</div>
                </div>
              </button>
            )}

            {(scanMode === "search" || scanMode === "usb") && (
              <div style={{ position: "relative" }}>
                <input ref={searchRef} className="input"
                  placeholder={lang === "en" ? "Search by name, code, barcode..." : "Nom, code, code-barres..."}
                  value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 14, pointerEvents: "none" }}>🔍</span>
              </div>
            )}

            {scanMode === "camera" && (
              <div style={{ position: "relative", marginTop: 6 }}>
                <input ref={searchRef} className="input"
                  placeholder={lang === "en" ? "Or type to search..." : "Ou tapez pour chercher..."}
                  value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38, fontSize: 12 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 13, pointerEvents: "none" }}>✏️</span>
              </div>
            )}
          </div>

          {filteredProducts.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              {filteredProducts.map((p, i) => (
                <div key={p.id} onClick={() => addToCart(p)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", cursor: "pointer", borderBottom: i < filteredProducts.length - 1 ? "1px solid var(--border)" : "none", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ flex: 1, paddingRight: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8 }}>
                      {p.barcode && <span style={{ fontFamily: "monospace" }}>{p.barcode}</span>}
                      {p.stock?.quantity !== undefined && (
                        <span style={{
                          color: p.stock.quantity <= (p.stock.min_quantity || 5) ? "#f87171" : p.stock.quantity <= (p.stock.min_quantity || 5) * 2 ? "#fbbf24" : "var(--text-muted)",
                          fontWeight: p.stock.quantity <= (p.stock.min_quantity || 5) ? 600 : 400
                        }}>
                          {p.stock.quantity <= (p.stock.min_quantity || 5) ? "⚠️ " : ""}Stock: {p.stock.quantity} {p.unit}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--brand-light)", fontSize: 14 }}>
                      {formatCFA(customer?.customer_type === "wholesale" && p.wholesale_price > 0 ? p.wholesale_price : p.sell_price)}
                      {customer?.customer_type === "wholesale" && p.wholesale_price > 0 && (
                        <span style={{ fontSize: 9, background: "#fbbf24", color: "#000", borderRadius: 4, padding: "1px 4px", marginLeft: 4, fontWeight: 700 }}>GROS</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>/{p.unit}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {search.length > 0 && filteredProducts.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "en" ? `No products matching "${search}"` : `Aucun produit pour "${search}"`}
            </div>
          )}
        </div>

        {/* ██ RIGHT PANEL — Cart ████████████████████████████████ */}
        <div style={{ width: mobile ? "100%" : 340, display: "flex", flexDirection: "column", background: "var(--bg-surface)", borderTop: mobile ? "1px solid var(--border)" : "none", maxHeight: mobile ? "55vh" : "100%" }}>

          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>🛒 {lang === "en" ? "Cart" : "Panier"}</span>
              {cart.length > 0 && <span style={{ background: "var(--brand)", color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{cart.length}</span>}
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6 }}>
                {lang === "en" ? "Clear all" : "Vider"}
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>🛒</div>
                <div style={{ fontSize: 12 }}>{lang === "en" ? "Cart is empty" : "Panier vide"}</div>
              </div>
            ) : cart.map((item, idx) => (
              <div key={idx} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: item.isDebt ? "rgba(239,68,68,0.04)" : "transparent" }}>
                {item.isDebt && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    🧾 {lang === "en" ? "Debt Repayment" : "Remboursement dette"}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: item.isDebt ? 4 : 7 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, paddingRight: 8, lineHeight: 1.3 }}>{item.name}</div>
                  <button onClick={() => updateQty(idx, 0)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✕</button>
                </div>
                {item.isDebt ? (
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171", textAlign: "right" }}>{formatCFA(item.unit_price)}</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => updateQty(idx, item.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    <input type="number" value={item.quantity} onChange={e => updateQty(idx, +e.target.value)} style={{ width: 40, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 4px", fontSize: 13 }} />
                    <button onClick={() => updateQty(idx, item.quantity + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    <div style={{ flex: 1, position: "relative" }}>
                      <input type="number" value={item.unit_price} onChange={e => updatePrice(idx, e.target.value)} style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px 6px 4px 18px", fontSize: 12 }} />
                      <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)" }}>F</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-light)", minWidth: 56, textAlign: "right" }}>{formatCFA(item.quantity * item.unit_price)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: "14px 16px", borderTop: "2px solid var(--border)", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-secondary)" }}>Total</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: "var(--brand-light)", letterSpacing: "-0.5px" }}>{formatCFA(total)}</span>
            </div>

            {!showPayment ? (
              <button className="btn btn-primary btn-block" disabled={cart.length === 0 || !selectedLocation} onClick={() => setShowPayment(true)} style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12 }}>
                {!selectedLocation ? (lang === "en" ? "Select location first" : "Choisir emplacement") : hasDebt ? (lang === "en" ? "Collect Payment →" : "Encaisser →") : (lang === "en" ? "Proceed to Payment →" : "Paiement →")}
              </button>
            ) : (
              <div>
                {hasDebt && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                      {lang === "en" ? "Amount to collect (blank = full balance)" : "Montant à encaisser (vide = tout)"}
                    </div>
                    <input className="input" type="number"
                      placeholder={`${lang === "en" ? "Full balance:" : "Solde total:"} ${(cart.find(i => i.product_id === "__DEBT__")?.unit_price || 0).toLocaleString()} FCFA`}
                      value={debtPayAmt} onChange={e => setDebtPayAmt(e.target.value)}
                      style={{ marginBottom: 4 }} />
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {lang === "en" ? "Leave blank to collect full balance" : "Laissez vide pour encaisser le solde total"}
                    </div>
                  </div>
                )}
                {!hasDebt && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                    {PAYMENT_MODES.map(pm => (
                      <button key={pm.key} onClick={() => setPayMode(pm.key)} style={{ padding: "8px 4px", borderRadius: 10, border: `1.5px solid ${payMode === pm.key ? pm.color : "var(--border)"}`, background: payMode === pm.key ? pm.color + "18" : "transparent", color: payMode === pm.key ? pm.color : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.15s" }}>
                        <div style={{ fontSize: 14 }}>{pm.icon}</div>
                        <div style={{ marginTop: 2 }}>{lang === "en" ? pm.en : pm.fr}</div>
                      </button>
                    ))}
                  </div>
                )}
                {payMode === "partial" && !hasDebt && (
                  <input className="input" type="number" placeholder={lang === "en" ? "Amount paid (FCFA)" : "Montant payé (FCFA)"} value={paidAmt} onChange={e => setPaidAmt(e.target.value)} style={{ marginBottom: 8 }} />
                )}
                {(payMode === "partial" || payMode === "credit") && !hasDebt && (
                  <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ marginBottom: 8 }} title={lang === "en" ? "Due date" : "Date d'échéance"} />
                )}
                <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                  {PAY_METHODS.map(m => (
                    <button key={m.key} onClick={() => setPayMethod(m.key)} style={{ flex: 1, padding: "6px 4px", borderRadius: 8, border: `1.5px solid ${payMethod === m.key ? "var(--brand)" : "var(--border)"}`, background: payMethod === m.key ? "rgba(79,70,229,0.12)" : "transparent", color: payMethod === m.key ? "var(--brand-light)" : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700, transition: "all 0.15s" }}>
                      <div>{m.icon}</div>
                      <div style={{ marginTop: 1 }}>{lang === "en" ? m.en : m.fr}</div>
                    </button>
                  ))}
                </div>
                <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "var(--text-muted)" }}>Total</span><strong>{formatCFA(total)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#10b981" }}>{lang === "en" ? "Paid" : "Payé"}</span>
                    <strong style={{ color: "#10b981" }}>{formatCFA(hasDebt ? total : paid)}</strong>
                  </div>
                  {balance > 0 && !hasDebt && (
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)", marginTop: 3 }}>
                      <span style={{ color: "#f87171", fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste"}</span>
                      <strong style={{ color: "#f87171" }}>{formatCFA(balance)}</strong>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowPayment(false)} className="btn btn-secondary" style={{ flex: 1 }}>← {lang === "en" ? "Back" : "Retour"}</button>
                  {(payMode === "credit" || payMode === "partial") && !customer && (
                    <div style={{ gridColumn: "1/-1", padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, fontSize: 12, color: "#f87171", marginBottom: 8 }}>
                      ⚠️ {lang === "en" ? "A registered customer is required for credit or partial sales." : "Un client enregistré est requis pour les ventes à crédit ou partielles."}
                    </div>
                  )}
                  <button onClick={() => saleMutation.mutate()} disabled={saleMutation.isPending || (!hasDebt && payMode === "partial" && !paidAmt) || ((payMode === "credit" || payMode === "partial") && !customer)} className="btn btn-success" style={{ flex: 2, fontWeight: 700 }}>
                    {saleMutation.isPending ? "⏳" : (lang === "en" ? "✓ Confirm" : "✓ Valider")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* ── RECEIPT MODAL ────────────────────────────────────────────── */}
      {showReceipt && lastSale && (
        <ReceiptModal
          sale={lastSale}
          org={orgSettings}
          lang={lang}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </>
  );
}

// ── RECEIPT MODAL COMPONENT ───────────────────────────────────────────────────
function ReceiptModal({ sale, org, lang, onClose }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = today.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const items = sale.items || [];
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const paid = sale.paid_amount || total;
  const balance = total - paid;

  // Build WhatsApp message
  const buildWhatsAppMessage = () => {
    const shopName = org.name || "Notre boutique";
    const footer = org.receipt_footer || "Merci pour votre achat!";
    const status = sale.payment_status;
    let msg = `🧾 *Reçu — ${shopName}*
`;
    msg += `📅 ${dateStr} à ${timeStr}
`;
    if (sale.sale_number) msg += `N° ${sale.sale_number}
`;
    msg += `─────────────────────
`;
    items.forEach(i => {
      msg += `${i.name} × ${i.quantity} ........ ${(i.quantity * i.unit_price).toLocaleString()} F
`;
    });
    msg += `─────────────────────
`;
    msg += `*Total: ${total.toLocaleString()} FCFA*
`;
    if (status === "paid") {
      msg += `✅ *PAYÉ INTÉGRALEMENT: ${paid.toLocaleString()} FCFA*
`;
    } else if (status === "credit") {
      msg += `🔴 *CRÉDIT TOTAL — Aucun paiement reçu*
`;
      msg += `*Montant dû: ${total.toLocaleString()} FCFA*
`;
    } else if (status === "partial") {
      msg += `🟡 *PAIEMENT PARTIEL*
`;
      msg += `Payé: ${paid.toLocaleString()} FCFA
`;
      msg += `*Reste dû: ${balance.toLocaleString()} FCFA*
`;
    }
    msg += `
${footer}
— ${shopName}`;
    if (org.address) msg += `
📍 ${org.address}, ${org.city || ""}`;
    if (org.phone) msg += `
📞 ${org.phone}`;
    return msg;
  };

  const sendWhatsApp = () => {
    const customer = sale.customer;
    if (!customer?.phone) {
      // No customer phone — open wa.me with shop number
      const msg = buildWhatsAppMessage();
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
      return;
    }
    let phone = customer.phone.toString().replace(/\s+/g, "").replace(/^0/, "");
    if (!phone.startsWith("237")) phone = "237" + phone;
    const msg = buildWhatsAppMessage();
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const printReceipt = () => {
    const status = sale.payment_status;
    const shopName = org.name || "Notre boutique";
    const footer = org.receipt_footer || "Merci pour votre achat!";
    const printContent = `
      <html><head><title>Reçu</title><style>
        body { font-family: monospace; font-size: 12px; width: 300px; margin: 0 auto; }
        h2 { text-align: center; font-size: 14px; margin: 4px 0; }
        .center { text-align: center; }
        .line { border-top: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; }
        .total { font-weight: bold; font-size: 14px; }
        .footer { text-align: center; margin-top: 10px; font-size: 11px; }
      </style></head><body>
        <h2>${shopName}</h2>
        <div class="center">${org.address || ""} ${org.city || ""}</div>
        <div class="center">${org.phone || ""}</div>
        <div class="line"></div>
        <div class="center">${dateStr} ${timeStr}</div>
        ${sale.sale_number ? `<div class="center">N° ${sale.sale_number}</div>` : ""}
        ${sale.customer?.name ? `<div class="center">Client: ${sale.customer.name}</div>` : ""}
        <div class="line"></div>
        ${items.map(i => `<div class="row"><span>${i.name} ×${i.quantity}</span><span>${(i.quantity * i.unit_price).toLocaleString()} F</span></div>`).join("")}
        <div class="line"></div>
        <div class="row total"><span>TOTAL</span><span>${total.toLocaleString()} FCFA</span></div>
        ${status === "paid" ? `<div class="row" style="color:green;font-weight:bold"><span>✅ PAYÉ</span><span>${paid.toLocaleString()} FCFA</span></div>` : ""}
        ${status === "credit" ? `<div class="row" style="color:red;font-weight:bold"><span>🔴 CRÉDIT TOTAL</span><span>${total.toLocaleString()} FCFA DÛ</span></div>` : ""}
        ${status === "partial" ? `<div class="row" style="color:orange;font-weight:bold"><span>🟡 PARTIEL — Payé</span><span>${paid.toLocaleString()} FCFA</span></div>` : ""}
        ${balance > 0 && status !== "credit" ? `<div class="row" style="color:red"><span>Reste dû</span><span>${balance.toLocaleString()} FCFA</span></div>` : ""}
        ${status === "credit" ? `<div class="row" style="color:red"><span>Montant total dû</span><span>${total.toLocaleString()} FCFA</span></div>` : ""}
        <div class="line"></div>
        <div class="footer">${footer}</div>
        <div class="footer">— ${shopName}</div>
      </body></html>
    `;
    const w = window.open("", "_blank", "width=350,height=500");
    w.document.write(printContent);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 400, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>

        {/* Success header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#10b981" }}>
            {lang === "en" ? "Sale Recorded!" : "Vente enregistrée!"}
          </div>
          {sale.sale_number && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sale.sale_number}</div>}
        </div>

        {/* Receipt preview */}
        <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 13 }}>
          <div style={{ fontWeight: 700, textAlign: "center", marginBottom: 8 }}>{org.name || "Boutique"}</div>
          {sale.customer?.name && <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginBottom: 4 }}>👤 {sale.customer.name}</div>}
          {/* Payment status badge */}
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            {sale.payment_status === "paid" && <span style={{ fontSize: 12, fontWeight: 700, background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "3px 12px", borderRadius: 20 }}>✅ PAYÉ INTÉGRALEMENT</span>}
            {sale.payment_status === "credit" && <span style={{ fontSize: 12, fontWeight: 700, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "3px 12px", borderRadius: 20 }}>🔴 CRÉDIT TOTAL — AUCUN PAIEMENT</span>}
            {sale.payment_status === "partial" && <span style={{ fontSize: 12, fontWeight: 700, background: "rgba(245,158,11,0.15)", color: "#fbbf24", padding: "3px 12px", borderRadius: 20 }}>🟡 PAIEMENT PARTIEL</span>}
          </div>
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 8, marginBottom: 8 }}>
            {items.slice(0, 4).map((i, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>{i.name} ×{i.quantity}</span>
                <span style={{ fontWeight: 600 }}>{(i.quantity * i.unit_price).toLocaleString()} F</span>
              </div>
            ))}
            {items.length > 4 && <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>...+{items.length - 4} more</div>}
          </div>
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15 }}>
              <span>Total</span><span style={{ color: "var(--brand-light)" }}>{total.toLocaleString()} F</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#10b981" }}>
              <span>{lang === "en" ? "Paid" : "Payé"}</span><span>{paid.toLocaleString()} F</span>
            </div>
            {balance > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#f87171", fontWeight: 600 }}>
                <span>{lang === "en" ? "Balance due" : "Reste dû"}</span><span>{balance.toLocaleString()} F</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sale.customer?.phone && (
            <button onClick={sendWhatsApp}
              style={{ width: "100%", padding: "12px", background: "#25D366", border: "none", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📱 {lang === "en" ? "Send Receipt via WhatsApp" : "Envoyer reçu par WhatsApp"}
            </button>
          )}
          {!sale.customer?.phone && (
            <button onClick={sendWhatsApp}
              style={{ width: "100%", padding: "12px", background: "#25D366", border: "none", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📱 {lang === "en" ? "Share via WhatsApp" : "Partager par WhatsApp"}
            </button>
          )}
          <button onClick={printReceipt}
            style={{ width: "100%", padding: "12px", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            🖨️ {lang === "en" ? "Print Receipt" : "Imprimer reçu"}
          </button>
          <button onClick={onClose}
            style={{ width: "100%", padding: "10px", background: "transparent", border: "none", color: "var(--text-muted)", borderRadius: 12, fontSize: 13, cursor: "pointer" }}>
            {lang === "en" ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    </div>
  );
}
