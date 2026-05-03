import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore } from "../store";
import api, { formatCFA } from "../utils/api";
import CameraScanner from "../components/common/CameraScanner";

const PAYMENT_MODES = [
  { key: "paid",    en: "Full payment",   fr: "Paiement complet", color: "#10b981" },
  { key: "partial", en: "Partial",        fr: "Partiel",          color: "#f59e0b" },
  { key: "credit",  en: "Full credit",    fr: "Credit total",     color: "#ef4444" },
];

const PAY_METHODS = [
  { key: "cash",         en: "Cash",         fr: "Especes" },
  { key: "mobile_money", en: "Mobile Money", fr: "Mobile Money" },
  { key: "bank",         en: "Bank",         fr: "Virement" },
];

export default function POSPage() {
  const { lang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [cart, setCart]             = useState([]);
  const [search, setSearch]         = useState("");
  const [customer, setCustomer]     = useState(null);
  const [custSearch, setCustSearch] = useState("");
  const [payMode, setPayMode]       = useState("paid");
  const [paidAmt, setPaidAmt]       = useState("");
  const [dueDate, setDueDate]       = useState("");
  const [payMethod, setPayMethod]   = useState("cash");
  const [notes, setNotes]           = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [showCamera, setShowCamera]   = useState(false);
  const searchRef = useRef(null);

  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);

  useEffect(() => {
    const handleKey = async (e) => {
      if (document.activeElement === searchRef.current) return;
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        if (code.length >= 4) await scanBarcode(code);
        barcodeBuffer.current = "";
        return;
      }
      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = ""; }, 300);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); clearTimeout(barcodeTimer.current); };
  }, [selectedLocation]);

  const scanBarcode = async (code) => {
    try {
      const res = await api.get("/products/barcode/" + code + "?location_id=" + (selectedLocation?.id || ""));
      addToCart(res.data.data);
      toast.success("Found: " + res.data.data.name);
    } catch {
      toast.error(lang === "en" ? "Barcode not found: " + code : "Code-barres introuvable: " + code);
    }
  };

  const { data: locData } = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data) });
  const { data: products } = useQuery({
    queryKey: ["pos-search", search],
    queryFn: () => search.length >= 2 ? api.get("/products?search=" + search + "&location_id=" + (selectedLocation?.id || "")).then(r => r.data) : { data: [] },
    enabled: search.length >= 2
  });
  const { data: customers } = useQuery({
    queryKey: ["pos-cust", custSearch],
    queryFn: () => custSearch.length >= 2 ? api.get("/customers?search=" + custSearch + "&limit=8").then(r => r.data) : { data: [] },
    enabled: custSearch.length >= 2
  });

  const locations = locData?.data || [];

  const addToCart = (product, qty = 1) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], quantity: u[idx].quantity + qty }; return u; }
      return [...prev, { product_id: product.id, name: product.name, unit: product.unit, barcode: product.barcode, quantity: qty, unit_price: product.sell_price, cost_price: product.cost_price, stock: product.stock?.quantity }];
    });
    setSearch("");
  };

  const updateQty   = (idx, qty) => qty <= 0 ? setCart(c => c.filter((_, i) => i !== idx)) : setCart(c => c.map((it, i) => i === idx ? { ...it, quantity: qty } : it));
  const updatePrice = (idx, price) => setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: +price } : it));

  const total = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const paid  = payMode === "paid" ? total : payMode === "credit" ? 0 : (+paidAmt || 0);

  const saleMutation = useMutation({
    mutationFn: () => api.post("/sales", {
      location_id: selectedLocation?.id, customer_id: customer?.id || null,
      items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
      payment_method: payMethod, paid_amount: paid, due_date: dueDate || null, notes: notes || null
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Sale recorded!" : "Vente enregistree!");
      setCart([]); setCustomer(null); setPayMode("paid"); setPaidAmt(""); setDueDate(""); setNotes(""); setShowPayment(false);
      qc.invalidateQueries(["recent-sales"]); qc.invalidateQueries(["daily-summary"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  return (
    <>
      {showCamera && (
        <CameraScanner lang={lang}
          onScan={(code) => { setShowCamera(false); scanBarcode(code); }}
          onClose={() => setShowCamera(false)} />
      )}

      <div style={{ display: "flex", height: "100%", flexDirection: window.innerWidth < 768 ? "column" : "row" }}>
        {/* LEFT - search */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto", borderRight: window.innerWidth >= 768 ? "1px solid var(--border)" : "none" }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>{lang === "en" ? "New Sale" : "Nouvelle vente"}</div>

          {/* Location */}
          <div style={{ marginBottom: 10 }}>
            <select className="input" value={selectedLocation?.id || ""} onChange={e => { const loc = locations.find(l => l.id === e.target.value); setLocation(loc || null); }} style={{ borderColor: !selectedLocation ? "#ef4444" : "var(--border)" }}>
              <option value="">{lang === "en" ? "-- Select location --" : "-- Choisir emplacement --"}</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </div>

          {/* Customer */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <input className="input" placeholder={lang === "en" ? "Search customer (optional)..." : "Chercher client..."}
              value={customer ? customer.name : custSearch} onChange={e => { setCustSearch(e.target.value); setCustomer(null); }} />
            {customers?.data?.length > 0 && !customer && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                {customers.data.map(c => (
                  <div key={c.id} onClick={() => { setCustomer(c); setCustSearch(""); }} style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <strong>{c.name}</strong>{c.phone && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>{c.phone}</span>}
                    {c.total_debt > 0 && <span style={{ color: "#f87171", marginLeft: 8, fontSize: 11 }}>owes {formatCFA(c.total_debt)}</span>}
                  </div>
                ))}
              </div>
            )}
            {customer && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <span style={{ background: "rgba(79,70,229,0.15)", color: "var(--brand-light)", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{customer.name}</span>
                <button onClick={() => setCustomer(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>x</button>
              </div>
            )}
          </div>

          {/* Camera scan button */}
          <button onClick={() => setShowCamera(true)} style={{ width: "100%", padding: 14, marginBottom: 10, background: "rgba(79,70,229,0.15)", border: "2px solid var(--brand)", borderRadius: 12, color: "var(--brand-light)", cursor: "pointer", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>[ ]</span>
            {lang === "en" ? "Scan Barcode with Camera" : "Scanner avec la camera"}
          </button>

          {/* Text search */}
          <input ref={searchRef} className="input" placeholder={lang === "en" ? "Or search product by name..." : "Ou chercher par nom..."}
            value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
            {lang === "en" ? "USB scanner: just scan directly" : "Lecteur USB: scannez directement"}
          </div>

          {/* Results */}
          {products?.data?.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {products.data.map(p => (
                <div key={p.id} onClick={() => addToCart(p)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.barcode && p.barcode + " - "}{p.pa_categories?.name}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p.sell_price)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.unit}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT - Cart */}
        <div style={{ width: window.innerWidth < 768 ? "100%" : 320, display: "flex", flexDirection: "column", background: "var(--bg-surface)", borderTop: window.innerWidth < 768 ? "1px solid var(--border)" : "none" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{lang === "en" ? "Cart" : "Panier"}{cart.length > 0 && <span style={{ color: "var(--brand-light)", marginLeft: 6 }}>({cart.length})</span>}</span>
            {cart.length > 0 && <button onClick={() => setCart([])} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>{lang === "en" ? "Clear" : "Vider"}</button>}
          </div>

          <div style={{ flex: 1, overflowY: "auto", maxHeight: window.innerWidth < 768 ? 200 : "none" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 12 }}>{lang === "en" ? "Cart is empty" : "Panier vide"}</div>
            ) : cart.map((item, idx) => (
              <div key={idx} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, flex: 1, paddingRight: 8 }}>{item.name}</div>
                  <button onClick={() => updateQty(idx, 0)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>x</button>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button onClick={() => updateQty(idx, item.quantity - 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 15 }}>-</button>
                  <input type="number" value={item.quantity} onChange={e => updateQty(idx, +e.target.value)} style={{ width: 44, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 4px", fontSize: 13 }} />
                  <button onClick={() => updateQty(idx, item.quantity + 1)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 15 }}>+</button>
                  <input type="number" value={item.unit_price} onChange={e => updatePrice(idx, e.target.value)} style={{ flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px 6px", fontSize: 12 }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-light)", minWidth: 60, textAlign: "right" }}>{formatCFA(item.quantity * item.unit_price)}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{lang === "en" ? "Total" : "Total"}</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: "var(--brand-light)" }}>{formatCFA(total)}</span>
            </div>

            {!showPayment ? (
              <button className="btn btn-primary btn-block" disabled={cart.length === 0 || !selectedLocation} onClick={() => setShowPayment(true)}>
                {!selectedLocation ? (lang === "en" ? "Select location first" : "Choisir emplacement") : (lang === "en" ? "Proceed to payment" : "Proceder au paiement")}
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {PAYMENT_MODES.map(pm => (
                    <button key={pm.key} onClick={() => setPayMode(pm.key)} style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: "1.5px solid " + (payMode === pm.key ? pm.color : "var(--border)"), background: payMode === pm.key ? pm.color + "20" : "transparent", color: payMode === pm.key ? pm.color : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                      {lang === "en" ? pm.en : pm.fr}
                    </button>
                  ))}
                </div>
                {payMode === "partial" && <input className="input" type="number" placeholder={lang === "en" ? "Amount paid" : "Montant paye"} value={paidAmt} onChange={e => setPaidAmt(e.target.value)} style={{ marginBottom: 8 }} />}
                {(payMode === "partial" || payMode === "credit") && <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ marginBottom: 8 }} />}
                <select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ marginBottom: 10, cursor: "pointer" }}>
                  {PAY_METHODS.map(m => <option key={m.key} value={m.key}>{lang === "en" ? m.en : m.fr}</option>)}
                </select>
                <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "var(--text-secondary)" }}>Total</span><strong>{formatCFA(total)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: paid < total ? 4 : 0 }}><span style={{ color: "#10b981" }}>{lang === "en" ? "Paid" : "Paye"}</span><strong style={{ color: "#10b981" }}>{formatCFA(paid)}</strong></div>
                  {paid < total && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#ef4444" }}>{lang === "en" ? "Balance" : "Reste"}</span><strong style={{ color: "#ef4444" }}>{formatCFA(total - paid)}</strong></div>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowPayment(false)} className="btn btn-secondary" style={{ flex: 1 }}>{lang === "en" ? "Back" : "Retour"}</button>
                  <button onClick={() => saleMutation.mutate()} disabled={saleMutation.isPending || (payMode === "partial" && !paidAmt)} className="btn btn-success" style={{ flex: 2 }}>
                    {saleMutation.isPending ? "..." : (lang === "en" ? "Confirm Sale" : "Valider")}
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

