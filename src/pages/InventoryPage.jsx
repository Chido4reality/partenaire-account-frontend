import BarcodeInput from "../components/common/BarcodeInput";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore } from "../store";
import api, { formatCFA } from "../utils/api";

// Client-side fuzzy match (same as POS)
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

export default function InventoryPage() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({ name: "", barcode: "", category_id: "", unit: "pce", cost_price: "", sell_price: "", description: "" });
  const [receiveForm, setReceiveForm] = useState({ location_id: "", supplier_name: "", invoice_ref: "", notes: "", items: [{ product_id: "", barcode: "", quantity: "", cost_price: "" }] });

  const searchRef = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef(null);

  // ── USB BARCODE SCANNER ────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      const active = document.activeElement;
      const isModal = showAddProduct || showReceive || showAdjust;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (isTyping && active !== searchRef.current) return;
      if (isModal) return;

      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (code.length >= 3) {
          setSearch(code);
          setScanning(true);
          setLastScan({ name: code, success: true });
          setTimeout(() => setScanning(false), 800);
          toast.success(`🔍 ${code}`, { duration: 1200, position: "top-center" });
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
  }, [showAddProduct, showReceive, showAdjust]);

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock", selectedLocation?.id],
    queryFn: () => api.get("/stock" + (selectedLocation ? "?location_id=" + selectedLocation.id : "")).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: alertData } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => api.get("/stock?low_only=true").then(r => r.data),
    refetchInterval: 60000
  });

  const { data: productsData } = useQuery({
    queryKey: ["products-all"],
    queryFn: () => api.get("/products?limit=200").then(r => r.data),
    enabled: tab === "products" || tab === "overview" || tab === "stock"
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: allStockData } = useQuery({
    queryKey: ["stock-all"],
    queryFn: () => api.get("/stock").then(r => r.data),
    enabled: tab === "overview"
  });

  const addProductMutation = useMutation({
    mutationFn: () => api.post("/products", { ...newProduct, category_id: newProduct.category_id || null, cost_price: +newProduct.cost_price || 0, sell_price: +newProduct.sell_price }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Product added!" : "Produit ajouté!");
      setShowAddProduct(false);
      setNewProduct({ name: "", barcode: "", category_id: "", unit: "pce", cost_price: "", sell_price: "", description: "" });
      qc.invalidateQueries(["products-all"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const receiveMutation = useMutation({
    mutationFn: () => api.post("/stock/arrivals", { ...receiveForm, items: receiveForm.items.filter(i => i.product_id && i.quantity).map(i => ({ ...i, quantity: +i.quantity, cost_price: +i.cost_price || 0 })) }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Stock received!" : "Stock réceptionné!");
      setShowReceive(false);
      setReceiveForm({ location_id: "", supplier_name: "", invoice_ref: "", notes: "", items: [{ product_id: "", barcode: "", quantity: "", cost_price: "" }] });
      qc.invalidateQueries(["stock"]);
      qc.invalidateQueries(["stock-all"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const stock = stockData?.data || [];
  const alerts = alertData?.data || [];
  const products = productsData?.data || [];
  const locations = locationsData?.data || [];
  const allStock = allStockData?.data || [];

  // Fuzzy filter for stock tab
  const filtered = search
    ? stock.filter(s =>
        fuzzyMatch(s.pa_products?.name, search) ||
        (s.pa_products?.barcode && s.pa_products.barcode.includes(search))
      )
    : stock;

  // Fuzzy filter for products tab
  const filteredProducts = search
    ? products.filter(p =>
        fuzzyMatch(p.name, search) ||
        fuzzyMatch(p.name_en, search) ||
        (p.barcode && p.barcode.includes(search))
      )
    : products;

  const setRP = (k, v) => setReceiveForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setReceiveForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addItem = () => setReceiveForm(f => ({ ...f, items: [...f.items, { product_id: "", barcode: "", quantity: "", cost_price: "" }] }));

  const TABS = [
    { key: "stock",    en: "Stock Levels",  fr: "Niveaux de stock" },
    { key: "overview", en: "Overview",      fr: "Vue ensemble" },
    { key: "products", en: "Products",      fr: "Produits" },
    { key: "alerts",   en: `Alerts (${alerts.length})`, fr: `Alertes (${alerts.length})` },
  ];

  // Build overview data
  const byProduct = {};
  allStock.forEach(s => {
    const pid = s.product_id;
    if (!byProduct[pid]) byProduct[pid] = { name: s.pa_products?.name || "Unknown", unit: s.pa_products?.unit || "pce", barcode: s.pa_products?.barcode || "", locs: {}, total: 0 };
    byProduct[pid].locs[s.location_id] = s.quantity;
    byProduct[pid].total += +s.quantity;
  });
  const overviewProducts = Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{lang === "en" ? "Inventory" : "Inventaire"}</h1>
          {alerts.length > 0 && <div style={{ marginTop: 4, fontSize: 12, color: "#fbbf24" }}>{alerts.length} {lang === "en" ? "items below minimum" : "articles sous le minimum"}</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowReceive(true)}>+ {lang === "en" ? "Receive Goods" : "Réceptionner"}</button>
          <button className="btn btn-primary" onClick={() => setShowAddProduct(true)}>+ {lang === "en" ? "Add Product" : "Ajouter produit"}</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? t.en : t.fr}
          </button>
        ))}
      </div>

      {/* ── SEARCH BAR WITH USB INDICATOR ── */}
      {(tab === "stock" || tab === "products") && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, maxWidth: 600 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input ref={searchRef} className="input"
              placeholder={lang === "en" ? "Search by name, barcode... (or scan with USB scanner)" : "Chercher par nom, code-barres... (ou scanner USB)"}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 36, paddingRight: search ? 36 : 12 }} />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: scanning ? "#10b981" : "var(--text-muted)", transition: "color 0.3s" }}>
              {scanning ? "✓" : "🔍"}
            </span>
            {search && (
              <button onClick={() => { setSearch(""); setLastScan(null); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>✕</button>
            )}
          </div>
          {/* USB Scanner indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: scanning ? "rgba(16,185,129,0.1)" : "rgba(79,70,229,0.08)", border: `1px solid ${scanning ? "#10b981" : "var(--border)"}`, borderRadius: 8, fontSize: 11, color: scanning ? "#10b981" : "var(--text-muted)", fontWeight: 600, transition: "all 0.3s", whiteSpace: "nowrap" }}>
            🔌 {scanning ? (lang === "en" ? "Scanned!" : "Scanné!") : "USB"}
          </div>
        </div>
      )}

      {/* ── STOCK TAB ── */}
      {tab === "stock" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {stockLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.4 }}>📦</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {search ? (lang === "en" ? `No results for "${search}"` : `Aucun résultat pour "${search}"`) : (lang === "en" ? "No stock records yet" : "Aucun stock")}
              </div>
              {!search && <div style={{ fontSize: 12 }}>{lang === "en" ? "Receive goods to see stock here" : "Réceptionnez des marchandises"}</div>}
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>{lang === "en" ? "Product" : "Produit"}</th>
                <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Quantity" : "Quantité"}</th>
                <th style={{ textAlign: "right" }}>Min</th>
                <th>Status</th>
                <th>{lang === "en" ? "Actions" : "Actions"}</th>
              </tr></thead>
              <tbody>
                {filtered.map(s => {
                  const isLow = s.quantity <= s.min_quantity;
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.pa_products?.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{s.pa_products?.barcode || "-"}</td>
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_locations?.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_locations?.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>{s.pa_locations?.name}</span></td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: isLow ? "#f87171" : "var(--text-primary)" }}>{s.quantity} {s.pa_products?.unit}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.min_quantity}</td>
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: isLow ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color: isLow ? "#f87171" : "#34d399" }}>{isLow ? (lang === "en" ? "Low" : "Bas") : "OK"}</span></td>
                      <td><button className="btn btn-secondary btn-sm" onClick={() => { setSelectedProduct(s); setShowAdjust(true); }}>{lang === "en" ? "Adjust" : "Ajuster"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            {lang === "en" ? "All products with quantities at each location." : "Tous les produits avec quantités par emplacement."}
          </div>
          {overviewProducts.length === 0 ? (
            <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No stock yet" : "Aucun stock"}</div></div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 500 }}>
                <thead><tr>
                  <th style={{ minWidth: 160 }}>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                  {locations.map(l => <th key={l.id} style={{ textAlign: "right", minWidth: 110 }}><div>{l.name}</div><div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{l.type}</div></th>)}
                  <th style={{ textAlign: "right", color: "var(--brand-light)" }}>TOTAL</th>
                </tr></thead>
                <tbody>
                  {overviewProducts.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "-"}</td>
                      {locations.map(l => {
                        const qty = p.locs[l.id];
                        return <td key={l.id} style={{ textAlign: "right" }}>{qty != null ? <span style={{ fontWeight: qty > 0 ? 500 : 400, color: qty > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>{qty} {p.unit}</span> : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>-</span>}</td>;
                      })}
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{p.total} {p.unit}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)" }}>
                    <td colSpan={2} style={{ fontWeight: 600, padding: "12px 16px" }}>{overviewProducts.length} {lang === "en" ? "products" : "produits"}</td>
                    {locations.map(l => { const t = allStock.filter(s => s.location_id === l.id).reduce((sum, s) => sum + +s.quantity, 0); return <td key={l.id} style={{ textAlign: "right", fontWeight: 600, padding: "12px 16px" }}>{t}</td>; })}
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)", padding: "12px 16px" }}>{allStock.reduce((sum, s) => sum + +s.quantity, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── PRODUCTS TAB ── */}
      {tab === "products" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {filteredProducts.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {search ? (lang === "en" ? `No products matching "${search}"` : `Aucun produit pour "${search}"`) : (lang === "en" ? "No products yet" : "Aucun produit")}
              </div>
              {!search && <button className="btn btn-primary" onClick={() => setShowAddProduct(true)} style={{ marginTop: 12 }}>+ {lang === "en" ? "Add product" : "Ajouter"}</button>}
            </div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>{lang === "en" ? "Product" : "Produit"}</th>
                <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                <th>{lang === "en" ? "Unit" : "Unité"}</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost price" : "Prix achat"}</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Sell price" : "Prix vente"}</th>
              </tr></thead>
              <tbody>
                {filteredProducts.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "-"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{p.unit}</td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{formatCFA(p.cost_price)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p.sell_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── ALERTS TAB ── */}
      {tab === "alerts" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {alerts.length === 0 ? (
            <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>{lang === "en" ? "✓ All stock levels OK!" : "✓ Tous les stocks sont OK!"}</div></div>
          ) : (
            <table className="table">
              <thead><tr>
                <th>{lang === "en" ? "Product" : "Produit"}</th>
                <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Current" : "Actuel"}</th>
                <th style={{ textAlign: "right" }}>Min</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Shortage" : "Manque"}</th>
              </tr></thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{a.location_name}</td>
                    <td style={{ textAlign: "right", color: "#f87171", fontWeight: 600 }}>{a.quantity} {a.unit}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{a.min_quantity}</td>
                    <td style={{ textAlign: "right", color: "#fbbf24" }}>{a.shortage} {a.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── ADD PRODUCT MODAL ── */}
      {showAddProduct && (
        <div className="modal-overlay" onClick={() => setShowAddProduct(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{lang === "en" ? "Add New Product" : "Ajouter un produit"}</div>
            <div className="form-group"><label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label><input className="input" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Filtre a huile Honda" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Barcode" : "Code-barres"}</label><BarcodeInput lang={lang} value={newProduct.barcode} onChange={v => setNewProduct(p => ({ ...p, barcode: v }))} placeholder={lang === "en" ? "Scan or type barcode" : "Scanner ou saisir code-barres"} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group"><label className="label">{lang === "en" ? "Cost price (FCFA)" : "Prix achat (FCFA)"}</label><input className="input" type="number" value={newProduct.cost_price} onChange={e => setNewProduct(p => ({ ...p, cost_price: e.target.value }))} placeholder="0" /></div>
              <div className="form-group"><label className="label">{lang === "en" ? "Sell price (FCFA)" : "Prix vente (FCFA)"} *</label><input className="input" type="number" value={newProduct.sell_price} onChange={e => setNewProduct(p => ({ ...p, sell_price: e.target.value }))} placeholder="0" /></div>
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Unit" : "Unité"}</label><select className="input" value={newProduct.unit} onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))}>{["pce", "kg", "litre", "metre", "boite", "set", "paire"].map(u => <option key={u} value={u}>{u}</option>)}</select></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddProduct(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!newProduct.name || !newProduct.sell_price || addProductMutation.isPending} onClick={() => addProductMutation.mutate()}>{addProductMutation.isPending ? "..." : (lang === "en" ? "Add Product" : "Ajouter")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIVE GOODS MODAL ── */}
      {showReceive && (
        <div className="modal-overlay" onClick={() => setShowReceive(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{lang === "en" ? "Receive Goods" : "Réceptionner des marchandises"}</div>
            <div className="form-group"><label className="label">{lang === "en" ? "Destination" : "Destination"} *</label><select className="input" value={receiveForm.location_id} onChange={e => setRP("location_id", e.target.value)}><option value="">{lang === "en" ? "Select warehouse/shop" : "Choisir magasin/boutique"}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}</select></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group"><label className="label">{lang === "en" ? "Supplier" : "Fournisseur"}</label><input className="input" value={receiveForm.supplier_name} onChange={e => setRP("supplier_name", e.target.value)} placeholder="Optional" /></div>
              <div className="form-group"><label className="label">{lang === "en" ? "Invoice ref" : "Réf facture"}</label><input className="input" value={receiveForm.invoice_ref} onChange={e => setRP("invoice_ref", e.target.value)} placeholder="Optional" /></div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{lang === "en" ? "Items received" : "Articles reçus"}</div>
            {receiveForm.items.map((item, idx) => (
              <div key={idx} style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div><label className="label">{lang === "en" ? "Product" : "Produit"}</label><select className="input" value={item.product_id} onChange={e => setItem(idx, "product_id", e.target.value)}><option value="">{lang === "en" ? "Select product" : "Choisir produit"}</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                  <div><label className="label">{lang === "en" ? "Barcode" : "Code-barres"}</label><BarcodeInput lang={lang} value={item.barcode} onChange={v => setItem(idx, "barcode", v)} placeholder={lang === "en" ? "Scan barcode" : "Scanner code-barres"} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label className="label">{lang === "en" ? "Quantity" : "Quantité"} *</label><input className="input" type="number" value={item.quantity} onChange={e => setItem(idx, "quantity", e.target.value)} placeholder="0" /></div>
                  <div><label className="label">{lang === "en" ? "Cost price" : "Prix achat"}</label><input className="input" type="number" value={item.cost_price} onChange={e => setItem(idx, "cost_price", e.target.value)} placeholder="FCFA" /></div>
                </div>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={addItem} style={{ marginBottom: 16 }}>+ {lang === "en" ? "Add another item" : "Ajouter un article"}</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowReceive(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!receiveForm.location_id || receiveMutation.isPending} onClick={() => receiveMutation.mutate()}>{receiveMutation.isPending ? "..." : (lang === "en" ? "Confirm Receipt" : "Confirmer la réception")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADJUST MODAL ── */}
      {showAdjust && selectedProduct && (
        <AdjustModal product={selectedProduct} lang={lang}
          onClose={() => { setShowAdjust(false); setSelectedProduct(null); }}
          onSuccess={() => { setShowAdjust(false); setSelectedProduct(null); qc.invalidateQueries(["stock"]); qc.invalidateQueries(["stock-all"]); }} />
      )}
    </div>
  );
}

function AdjustModal({ product, lang, onClose, onSuccess }) {
  const [qty, setQty] = useState(product.quantity);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.patch("/stock/adjust", { product_id: product.product_id, location_id: product.location_id, new_quantity: +qty, reason });
      toast.success(lang === "en" ? "Stock adjusted!" : "Stock ajusté!");
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{lang === "en" ? "Adjust Stock" : "Ajuster le stock"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>{product.pa_products?.name} - {product.pa_locations?.name}</div>
        <div className="form-group"><label className="label">{lang === "en" ? "New quantity" : "Nouvelle quantité"}</label><input className="input" type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
        <div className="form-group"><label className="label">{lang === "en" ? "Reason" : "Raison"}</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={lang === "en" ? "e.g. Stock count correction" : "Ex: Correction inventaire"} /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{lang === "en" ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={loading} onClick={handleSubmit}>{loading ? "..." : (lang === "en" ? "Save" : "Enregistrer")}</button>
        </div>
      </div>
    </div>
  );
}
 
