import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore } from "../store";
import api, { formatCFA } from "../utils/api";
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

// Detect if running on mobile
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

// Simple fuzzy match for client-side filtering
function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const s = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const p = pattern.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes(p)) return true;
  // Check trigram-style similarity
  let score = 0;
  for (let i = 0; i < p.length - 1; i++) {
    if (s.includes(p.slice(i, i + 2))) score++;
  }
  return score >= Math.floor(p.length * 0.4);
}

export default function POSPage() {
  const { lang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [cart, setCart]               = useState([]);
  const [search, setSearch]           = useState("");
  const [customer, setCustomer]       = useState(null);
  const [custSearch, setCustSearch]   = useState("");
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [payMode, setPayMode]         = useState("paid");
  const [paidAmt, setPaidAmt]         = useState("");
  const [dueDate, setDueDate]         = useState("");
  const [payMethod, setPayMethod]     = useState("cash");
  const [notes, setNotes]             = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [showCamera, setShowCamera]   = useState(false);
  const [scanMode, setScanMode]       = useState(isMobile() ? "camera" : "usb");
  const [scanning, setScanning]       = useState(false);
  const [lastScan, setLastScan]       = useState(null);

  const searchRef  = useRef(null);
  const custRef    = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);

  // ── USB BARCODE SCANNER (keydown listener) ─────────────────
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

  // ── DATA QUERIES ───────────────────────────────────────────
  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: allProducts } = useQuery({
    queryKey: ["pos-products", selectedLocation?.id],
    queryFn: () => api.get("/products?location_id=" + (selectedLocation?.id || "") + "&limit=200").then(r => r.data),
    enabled: !!selectedLocation?.id,
    staleTime: 60000
  });

  const { data: allCustomers } = useQuery({
    queryKey: ["pos-customers"],
    queryFn: () => api.get("/customers?limit=300").then(r => r.data),
    staleTime: 60000
  });

  const locations = locData?.data || [];

  // Client-side fuzzy filter for products
  const filteredProducts = search.length >= 1
    ? (allProducts?.data || []).filter(p =>
        fuzzyMatch(p.name, search) ||
        fuzzyMatch(p.name_en, search) ||
        (p.barcode && p.barcode.includes(search))
      ).slice(0, 10)
    : [];

  // Client-side fuzzy filter for customers
  const filteredCustomers = custSearch.length >= 1 && !customer
    ? (allCustomers?.data || []).filter(c =>
        fuzzyMatch(c.name, custSearch) ||
        (c.phone && c.phone.includes(custSearch))
      ).slice(0, 8)
    : [];

  // ── CART OPERATIONS ────────────────────────────────────────
  const addToCart = (product, qty = 1) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) {
        const u = [...prev];
        u[idx] = { ...u[idx], quantity: u[idx].quantity + qty };
        return u;
      }
      return [...prev, {
        product_id: product.product_id || product.id,
        name: product.name,
        unit: product.unit,
        barcode: product.barcode,
        quantity: qty,
        unit_price: product.sell_price,
        cost_price: product.cost_price,
        stock: product.stock?.quantity
      }];
    });
    setSearch("");
  };

  const updateQty   = (idx, qty) => qty <= 0
    ? setCart(c => c.filter((_, i) => i !== idx))
    : setCart(c => c.map((it, i) => i === idx ? { ...it, quantity: qty } : it));

  const updatePrice = (idx, price) =>
    setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: +price } : it));

  const total = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const paid  = payMode === "paid" ? total : payMode === "credit" ? 0 : (+paidAmt || 0);
  const balance = total - paid;

  // ── SALE MUTATION ──────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: () => api.post("/sales", {
      location_id: selectedLocation?.id,
      customer_id: customer?.id || null,
      items: cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price
      })),
      payment_method: payMethod,
      paid_amount: paid,
      due_date: dueDate || null,
      notes: notes || null
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Sale recorded!" : "✓ Vente enregistrée!", { duration: 2000 });
      setCart([]); setCustomer(null); setPayMode("paid");
      setPaidAmt(""); setDueDate(""); setNotes(""); setShowPayment(false);
      qc.invalidateQueries(["recent-sales"]);
      qc.invalidateQueries(["daily-summary"]);
      qc.invalidateQueries(["pos-customers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const mobile = isMobile();

  return (
    <>
      {showCamera && (
        <CameraScanner lang={lang}
          onScan={(code) => { setShowCamera(false); scanBarcode(code); }}
          onClose={() => setShowCamera(false)} />
      )}

      <div style={{ display: "flex", height: "100%", flexDirection: mobile ? "column" : "row", background: "var(--bg-base)" }}>

        {/* ══ LEFT PANEL — Product Search ══════════════════════ */}
        <div style={{ flex: 1, padding: mobile ? 12 : 20, overflowY: "auto", borderRight: mobile ? "none" : "1px solid var(--border)" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.3px" }}>
                {lang === "en" ? "New Sale" : "Nouvelle vente"}
              </div>
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

          {/* Location Selector */}
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
                  {customer.total_debt > 0 && <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>Owes {formatCFA(customer.total_debt)}</div>}
                </div>
                <button onClick={() => setCustomer(null)} style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", cursor: "pointer", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 700 }}>✕</button>
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

            {/* Scanner mode toggle */}
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

            {/* USB mode indicator */}
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

            {/* Camera mode */}
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

            {/* Search mode / always visible search */}
            {(scanMode === "search" || scanMode === "usb") && (
              <div style={{ position: "relative" }}>
                <input ref={searchRef} className="input"
                  placeholder={lang === "en" ? "Search by name, code, barcode..." : "Nom, code, code-barres..."}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 38 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 14, pointerEvents: "none" }}>🔍</span>
              </div>
            )}

            {/* Also show search in camera mode */}
            {scanMode === "camera" && (
              <div style={{ position: "relative", marginTop: 6 }}>
                <input ref={searchRef} className="input"
                  placeholder={lang === "en" ? "Or type to search..." : "Ou tapez pour chercher..."}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 38, fontSize: 12 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 13, pointerEvents: "none" }}>✏️</span>
              </div>
            )}
          </div>

          {/* ── PRODUCT RESULTS ── */}
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
                        <span style={{ color: p.stock.quantity < 5 ? "#f87171" : "var(--text-muted)" }}>
                          Stock: {p.stock.quantity} {p.unit}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--brand-light)", fontSize: 14 }}>{formatCFA(p.sell_price)}</div>
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

        {/* ══ RIGHT PANEL — Cart ═══════════════════════════════ */}
        <div style={{ width: mobile ? "100%" : 340, display: "flex", flexDirection: "column", background: "var(--bg-surface)", borderTop: mobile ? "1px solid var(--border)" : "none", maxHeight: mobile ? "55vh" : "100%" }}>

          {/* Cart Header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                🛒 {lang === "en" ? "Cart" : "Panier"}
              </span>
              {cart.length > 0 && (
                <span style={{ background: "var(--brand)", color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
                  {cart.length}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6 }}>
                {lang === "en" ? "Clear all" : "Vider"}
              </button>
            )}
          </div>

          {/* Cart Items */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>🛒</div>
                <div style={{ fontSize: 12 }}>{lang === "en" ? "Cart is empty" : "Panier vide"}</div>
              </div>
            ) : cart.map((item, idx) => (
              <div key={idx} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 7 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, paddingRight: 8, lineHeight: 1.3 }}>{item.name}</div>
                  <button onClick={() => updateQty(idx, 0)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={() => updateQty(idx, item.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <input type="number" value={item.quantity} onChange={e => updateQty(idx, +e.target.value)}
                    style={{ width: 40, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 4px", fontSize: 13 }} />
                  <button onClick={() => updateQty(idx, item.quantity + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input type="number" value={item.unit_price} onChange={e => updatePrice(idx, e.target.value)}
                      style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px 6px 4px 18px", fontSize: 12 }} />
                    <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)" }}>F</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-light)", minWidth: 56, textAlign: "right" }}>
                    {formatCFA(item.quantity * item.unit_price)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── PAYMENT SECTION ── */}
          <div style={{ padding: "14px 16px", borderTop: "2px solid var(--border)", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-secondary)" }}>
                {lang === "en" ? "Total" : "Total"}
              </span>
              <span style={{ fontWeight: 800, fontSize: 20, color: "var(--brand-light)", letterSpacing: "-0.5px" }}>
                {formatCFA(total)}
              </span>
            </div>

            {!showPayment ? (
              <button className="btn btn-primary btn-block"
                disabled={cart.length === 0 || !selectedLocation}
                onClick={() => setShowPayment(true)}
                style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12 }}>
                {!selectedLocation
                  ? (lang === "en" ? "Select location first" : "Choisir emplacement")
                  : (lang === "en" ? "Proceed to Payment →" : "Paiement →")}
              </button>
            ) : (
              <div>
                {/* Payment mode */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {PAYMENT_MODES.map(pm => (
                    <button key={pm.key} onClick={() => setPayMode(pm.key)} style={{ padding: "8px 4px", borderRadius: 10, border: `1.5px solid ${payMode === pm.key ? pm.color : "var(--border)"}`, background: payMode === pm.key ? pm.color + "18" : "transparent", color: payMode === pm.key ? pm.color : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.15s" }}>
                      <div style={{ fontSize: 14 }}>{pm.icon}</div>
                      <div style={{ marginTop: 2 }}>{lang === "en" ? pm.en : pm.fr}</div>
                    </button>
                  ))}
                </div>

                {payMode === "partial" && (
                  <input className="input" type="number"
                    placeholder={lang === "en" ? "Amount paid (FCFA)" : "Montant payé (FCFA)"}
                    value={paidAmt} onChange={e => setPaidAmt(e.target.value)}
                    style={{ marginBottom: 8 }} />
                )}

                {(payMode === "partial" || payMode === "credit") && (
                  <input className="input" type="date"
                    value={dueDate} onChange={e => setDueDate(e.target.value)}
                    style={{ marginBottom: 8 }}
                    title={lang === "en" ? "Due date" : "Date d'échéance"} />
                )}

                {/* Payment method */}
                <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                  {PAY_METHODS.map(m => (
                    <button key={m.key} onClick={() => setPayMethod(m.key)} style={{ flex: 1, padding: "6px 4px", borderRadius: 8, border: `1.5px solid ${payMethod === m.key ? "var(--brand)" : "var(--border)"}`, background: payMethod === m.key ? "rgba(79,70,229,0.12)" : "transparent", color: payMethod === m.key ? "var(--brand-light)" : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700, transition: "all 0.15s" }}>
                      <div>{m.icon}</div>
                      <div style={{ marginTop: 1 }}>{lang === "en" ? m.en : m.fr}</div>
                    </button>
                  ))}
                </div>

                {/* Summary */}
                <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "var(--text-muted)" }}>Total</span>
                    <strong>{formatCFA(total)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: balance > 0 ? 3 : 0 }}>
                    <span style={{ color: "#10b981" }}>{lang === "en" ? "Paid" : "Payé"}</span>
                    <strong style={{ color: "#10b981" }}>{formatCFA(paid)}</strong>
                  </div>
                  {balance > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)", marginTop: 3 }}>
                      <span style={{ color: "#f87171", fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste"}</span>
                      <strong style={{ color: "#f87171" }}>{formatCFA(balance)}</strong>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowPayment(false)} className="btn btn-secondary" style={{ flex: 1 }}>
                    ← {lang === "en" ? "Back" : "Retour"}
                  </button>
                  <button onClick={() => saleMutation.mutate()}
                    disabled={saleMutation.isPending || (payMode === "partial" && !paidAmt)}
                    className="btn btn-success" style={{ flex: 2, fontWeight: 700 }}>
                    {saleMutation.isPending ? "⏳" : (lang === "en" ? "✓ Confirm Sale" : "✓ Valider")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
