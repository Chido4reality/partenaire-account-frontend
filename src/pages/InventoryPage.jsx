import BarcodeInput from "../components/common/BarcodeInput";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api, { formatCFA } from "../utils/api";
import OwnerPIN from "../components/common/OwnerPIN";

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
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const role = user?.role || "cashier";
  const isOwner = role === "owner";
  const isManager = role === "manager";
  const isWarehouse = role === "warehouse";
  const isCashier = role === "cashier";

  // Cashier blocked entirely
  if (isCashier) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📦</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
        {lang === "en" ? "Access Restricted" : "Accès restreint"}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {lang === "en" ? "Inventory is not accessible for cashiers." : "L'inventaire n'est pas accessible aux caissiers."}
      </div>
    </div>
  );

  const canSeePrices = isOwner;
  const canAddProduct = isOwner || isManager;
  const canReceiveGoods = isOwner || isManager || isWarehouse;
  const canAdjustStock = isOwner || isManager || isWarehouse;
  const canEditPrices = isOwner;
  const canSetMinPrice = isOwner;

  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showEditProduct, setShowEditProduct] = useState(false);
  const [showPIN, setShowPIN] = useState(false);
  const [pinAction, setPinAction] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedStockRow, setSelectedStockRow] = useState(null);

  const [newProduct, setNewProduct] = useState({
    name: "", barcode: "", unit: "pce", cost_price: "", sell_price: "",
    wholesale_price: "", min_price: "", description: "",
    initial_location_id: "", initial_quantity: ""
  });

  const [editProduct, setEditProduct] = useState(null);

  const [receiveForm, setReceiveForm] = useState({
    location_id: "", supplier_name: "", invoice_ref: "", notes: "",
    items: [{ product_id: "", quantity: "", cost_price: "" }]
  });

  const searchRef = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      const active = document.activeElement;
      const isModal = showAddProduct || showReceive || showAdjust || showEditProduct;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (isTyping && active !== searchRef.current) return;
      if (isModal) return;
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (code.length >= 3) {
          setSearch(code);
          setScanning(true);
          setTimeout(() => setScanning(false), 800);
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
  }, [showAddProduct, showReceive, showAdjust, showEditProduct]);

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
    mutationFn: async () => {
      const res = await api.post("/products", {
        name: newProduct.name,
        barcode: newProduct.barcode || null,
        unit: newProduct.unit,
        cost_price: +newProduct.cost_price || 0,
        sell_price: +newProduct.sell_price,
        wholesale_price: +newProduct.wholesale_price || 0,
        min_price: +newProduct.min_price || 0,
        description: newProduct.description || null,
      });
      const product = res.data.data;
      // If initial stock provided, create stock record
      if (newProduct.initial_location_id && newProduct.initial_quantity) {
        await api.post("/stock/arrivals", {
          location_id: newProduct.initial_location_id,
          items: [{ product_id: product.id, quantity: +newProduct.initial_quantity, cost_price: +newProduct.cost_price || 0 }]
        });
      }
      return res.data;
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product added!" : "✓ Produit ajouté!");
      setShowAddProduct(false);
      setNewProduct({ name: "", barcode: "", unit: "pce", cost_price: "", sell_price: "", wholesale_price: "", min_price: "", description: "", initial_location_id: "", initial_quantity: "" });
      qc.invalidateQueries(["products-all"]);
      qc.invalidateQueries(["stock"]);
      qc.invalidateQueries(["stock-all"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const editProductMutation = useMutation({
    mutationFn: () => api.patch(`/products/${editProduct.id}`, {
      name: editProduct.name,
      barcode: editProduct.barcode || null,
      unit: editProduct.unit,
      cost_price: +editProduct.cost_price || 0,
      sell_price: +editProduct.sell_price,
      wholesale_price: +editProduct.wholesale_price || 0,
      min_price: +editProduct.min_price || 0,
      description: editProduct.description || null,
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product updated!" : "✓ Produit mis à jour!");
      setShowEditProduct(false);
      setEditProduct(null);
      qc.invalidateQueries(["products-all"]);
      qc.invalidateQueries(["stock"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const receiveMutation = useMutation({
    mutationFn: () => api.post("/stock/arrivals", {
      ...receiveForm,
      items: receiveForm.items.filter(i => i.product_id && i.quantity).map(i => ({
        ...i, quantity: +i.quantity, cost_price: +i.cost_price || 0
      }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Stock received!" : "✓ Stock réceptionné!");
      setShowReceive(false);
      setReceiveForm({ location_id: "", supplier_name: "", invoice_ref: "", notes: "", items: [{ product_id: "", quantity: "", cost_price: "" }] });
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

  const filtered = search
    ? stock.filter(s => fuzzyMatch(s.pa_products?.name, search) || (s.pa_products?.barcode && s.pa_products.barcode.includes(search)))
    : stock;

  const filteredProducts = search
    ? products.filter(p => fuzzyMatch(p.name, search) || fuzzyMatch(p.name_en, search) || (p.barcode && p.barcode.includes(search)))
    : products;

  const setRP = (k, v) => setReceiveForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setReceiveForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addItem = () => setReceiveForm(f => ({ ...f, items: [...f.items, { product_id: "", quantity: "", cost_price: "" }] }));

  // Total stock value (owner only)
  const totalStockValue = isOwner
    ? stock.reduce((sum, s) => sum + (+s.quantity * +(s.pa_products?.cost_price || 0)), 0)
    : 0;

  const TABS = [
    { key: "stock",    en: "Stock Levels",  fr: "Niveaux de stock" },
    { key: "overview", en: "Overview",      fr: "Vue ensemble" },
    { key: "products", en: "Products",      fr: "Produits" },
    { key: "alerts",   en: `Alerts (${alerts.length})`, fr: `Alertes (${alerts.length})` },
  ];

  const byProduct = {};
  allStock.forEach(s => {
    const pid = s.product_id;
    if (!byProduct[pid]) byProduct[pid] = { name: s.pa_products?.name || "Unknown", unit: s.pa_products?.unit || "pce", barcode: s.pa_products?.barcode || "", locs: {}, total: 0 };
    byProduct[pid].locs[s.location_id] = s.quantity;
    byProduct[pid].total += +s.quantity;
  });
  const overviewProducts = Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));

  const requireOwnerPIN = (action) => {
    setPinAction(() => action);
    setShowPIN(true);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>

      {/* ── OWNER PIN MODAL ── */}
      <OwnerPIN
        open={showPIN}
        onSuccess={() => { setShowPIN(false); pinAction?.(); }}
        onCancel={() => { setShowPIN(false); setPinAction(null); }}
        lang={lang}
        reason={lang === "en" ? "Owner verification required" : "Vérification propriétaire requise"}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">{lang === "en" ? "Inventory" : "Inventaire"}</h1>
          <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
            {alerts.length > 0 && (
              <div style={{ fontSize: 12, color: "#fbbf24" }}>
                ⚠️ {alerts.length} {lang === "en" ? "items below minimum" : "articles sous le minimum"}
              </div>
            )}
            {isOwner && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {lang === "en" ? "Stock value:" : "Valeur stock:"} <strong style={{ color: "var(--brand-light)" }}>{formatCFA(totalStockValue)}</strong>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canReceiveGoods && (
            <button className="btn btn-secondary" onClick={() => setShowReceive(true)}>
              📦 {lang === "en" ? "Receive Goods" : "Réceptionner"}
            </button>
          )}
          {canAddProduct && (
            <button className="btn btn-primary" onClick={() => setShowAddProduct(true)}>
              + {lang === "en" ? "Add Product" : "Ajouter produit"}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? t.en : t.fr}
          </button>
        ))}
      </div>

      {/* Search bar */}
      {(tab === "stock" || tab === "products") && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, maxWidth: 600 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input ref={searchRef} className="input"
              placeholder={lang === "en" ? "Search by name or barcode..." : "Chercher par nom ou code-barres..."}
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 36, paddingRight: search ? 36 : 12 }} />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: scanning ? "#10b981" : "var(--text-muted)" }}>
              {scanning ? "✓" : "🔍"}
            </span>
            {search && (
              <button onClick={() => setSearch("")}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>✕</button>
            )}
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
              <div style={{ fontWeight: 600 }}>{search ? `No results for "${search}"` : (lang === "en" ? "No stock records yet" : "Aucun stock")}</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Quantity" : "Quantité"}</th>
                  <th style={{ textAlign: "right" }}>Min</th>
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost" : "Achat"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Walk-in" : "Détail"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Wholesale" : "Gros"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Min floor" : "Prix min"}</th>}
                  <th>Status</th>
                  {canAdjustStock && <th>{lang === "en" ? "Actions" : "Actions"}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isLow = s.quantity <= s.min_quantity;
                  const p = s.pa_products;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p?.name}</div>
                        {p?.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.barcode}</div>}
                      </td>
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_locations?.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_locations?.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>
                          {s.pa_locations?.name}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: isLow ? "#f87171" : "var(--text-primary)" }}>
                        {s.quantity} {p?.unit}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.min_quantity}</td>
                      {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{formatCFA(p?.cost_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p?.sell_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p?.wholesale_price > 0 ? formatCFA(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p?.min_price > 0 ? formatCFA(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: isLow ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color: isLow ? "#f87171" : "#34d399" }}>
                          {isLow ? (lang === "en" ? "Low" : "Bas") : "OK"}
                        </span>
                      </td>
                      {canAdjustStock && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-secondary btn-sm"
                              onClick={() => { setSelectedStockRow(s); setShowAdjust(true); }}>
                              {lang === "en" ? "Adjust" : "Ajuster"}
                            </button>
                            {isOwner && (
                              <button className="btn btn-secondary btn-sm"
                                onClick={() => { setEditProduct({ ...p, id: s.product_id }); setShowEditProduct(true); }}
                                style={{ color: "var(--brand-light)", borderColor: "var(--brand)" }}>
                                ✏️
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {isOwner && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-elevated)" }}>
                    <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>
                      {lang === "en" ? "Total inventory value (at cost)" : "Valeur totale inventaire (au coût)"}
                    </td>
                    <td colSpan={5} style={{ textAlign: "right", padding: "12px 16px", fontWeight: 800, color: "var(--brand-light)", fontSize: 15 }}>
                      {formatCFA(totalStockValue)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div>
          {overviewProducts.length === 0 ? (
            <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No stock yet" : "Aucun stock"}</div></div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 500 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 160 }}>{lang === "en" ? "Product" : "Produit"}</th>
                    <th>{lang === "en" ? "Unit" : "Unité"}</th>
                    {locations.map(l => (
                      <th key={l.id} style={{ textAlign: "right", minWidth: 110 }}>
                        <div>{l.name}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{l.type}</div>
                      </th>
                    ))}
                    <th style={{ textAlign: "right", color: "var(--brand-light)" }}>TOTAL</th>
                    {isOwner && <th style={{ textAlign: "right", color: "#fbbf24" }}>{lang === "en" ? "Value" : "Valeur"}</th>}
                  </tr>
                </thead>
                <tbody>
                  {overviewProducts.map((p, i) => {
                    const product = products.find(pr => pr.name === p.name);
                    const value = isOwner ? p.total * (product?.cost_price || 0) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                        <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{p.unit}</td>
                        {locations.map(l => {
                          const qty = p.locs[l.id];
                          return (
                            <td key={l.id} style={{ textAlign: "right" }}>
                              {qty != null ? <span style={{ fontWeight: qty > 0 ? 500 : 400, color: qty > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>{qty}</span> : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{p.total} {p.unit}</td>
                        {isOwner && <td style={{ textAlign: "right", fontSize: 12, color: "#fbbf24" }}>{formatCFA(value)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)" }}>
                    <td colSpan={2} style={{ fontWeight: 600, padding: "12px 16px" }}>{overviewProducts.length} {lang === "en" ? "products" : "produits"}</td>
                    {locations.map(l => {
                      const t = allStock.filter(s => s.location_id === l.id).reduce((sum, s) => sum + +s.quantity, 0);
                      return <td key={l.id} style={{ textAlign: "right", fontWeight: 600, padding: "12px 16px" }}>{t}</td>;
                    })}
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)", padding: "12px 16px" }}>
                      {allStock.reduce((sum, s) => sum + +s.quantity, 0)}
                    </td>
                    {isOwner && (
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#fbbf24", padding: "12px 16px" }}>
                        {formatCFA(totalStockValue)}
                      </td>
                    )}
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
                {search ? `No products matching "${search}"` : (lang === "en" ? "No products yet" : "Aucun produit")}
              </div>
              {!search && canAddProduct && (
                <button className="btn btn-primary" onClick={() => setShowAddProduct(true)} style={{ marginTop: 12 }}>
                  + {lang === "en" ? "Add product" : "Ajouter"}
                </button>
              )}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                  <th>{lang === "en" ? "Unit" : "Unité"}</th>
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost" : "Achat"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Walk-in" : "Détail"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Wholesale" : "Gros"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Min floor" : "Prix min"}</th>}
                  {isOwner && <th>{lang === "en" ? "Edit" : "Modifier"}</th>}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "—"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{p.unit}</td>
                    {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{formatCFA(p.cost_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p.sell_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p.wholesale_price > 0 ? formatCFA(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p.min_price > 0 ? formatCFA(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                    {isOwner && (
                      <td>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => { setEditProduct({ ...p }); setShowEditProduct(true); }}
                          style={{ color: "var(--brand-light)" }}>
                          ✏️ {lang === "en" ? "Edit" : "Modifier"}
                        </button>
                      </td>
                    )}
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
            <div className="empty-state">
              <div style={{ fontWeight: 600, color: "#34d399" }}>✓ {lang === "en" ? "All stock levels OK!" : "Tous les stocks sont OK!"}</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Current" : "Actuel"}</th>
                  <th style={{ textAlign: "right" }}>Min</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Shortage" : "Manque"}</th>
                  {isOwner && <th>{lang === "en" ? "WhatsApp Alert" : "Alerte WhatsApp"}</th>}
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{a.location_name}</td>
                    <td style={{ textAlign: "right", color: "#f87171", fontWeight: 600 }}>{a.quantity} {a.unit}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{a.min_quantity}</td>
                    <td style={{ textAlign: "right", color: "#fbbf24" }}>{a.shortage} {a.unit}</td>
                    {isOwner && (
                      <td>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {lang === "en" ? "Alert me" : "M'alerter"}
                          </span>
                          <div style={{ position: "relative", width: 36, height: 20 }}>
                            <input type="checkbox" checked={a.alert_enabled || false}
                              onChange={() => { /* TODO: toggle alert */ }}
                              style={{ opacity: 0, width: 0, height: 0 }} />
                            <span style={{ position: "absolute", inset: 0, borderRadius: 10, background: a.alert_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                              <span style={{ position: "absolute", width: 14, height: 14, borderRadius: "50%", background: "#fff", top: 3, left: a.alert_enabled ? 19 : 3, transition: "0.2s" }} />
                            </span>
                          </div>
                        </label>
                      </td>
                    )}
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
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              + {lang === "en" ? "Add New Product" : "Ajouter un produit"}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label>
              <input className="input" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Tube, Huile palme..." />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Barcode" : "Code-barres"}</label>
                <BarcodeInput lang={lang} value={newProduct.barcode} onChange={v => setNewProduct(p => ({ ...p, barcode: v }))} placeholder="Scan or type" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Unit" : "Unité"}</label>
                <select className="input" value={newProduct.unit} onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))}>
                  {["pce", "kg", "litre", "metre", "boite", "set", "paire", "carton"].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                💰 {lang === "en" ? "Pricing" : "Tarification"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Cost price (FCFA)" : "Prix achat (FCFA)"}</label>
                  <input className="input" type="number" value={newProduct.cost_price} onChange={e => setNewProduct(p => ({ ...p, cost_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "var(--brand-light)" }}>{lang === "en" ? "Walk-in price (FCFA) *" : "Prix détail (FCFA) *"}</label>
                  <input className="input" type="number" value={newProduct.sell_price} onChange={e => setNewProduct(p => ({ ...p, sell_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "#fbbf24" }}>{lang === "en" ? "Wholesale price (FCFA)" : "Prix gros (FCFA)"}</label>
                  <input className="input" type="number" value={newProduct.wholesale_price} onChange={e => setNewProduct(p => ({ ...p, wholesale_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "#f87171" }}>{lang === "en" ? "Min price floor (FCFA)" : "Prix minimum (FCFA)"}</label>
                  <input className="input" type="number" value={newProduct.min_price} onChange={e => setNewProduct(p => ({ ...p, min_price: e.target.value }))} placeholder="0" />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                🔒 {lang === "en" ? "Min price floor: staff cannot sell below this price" : "Prix min: le personnel ne peut pas vendre en dessous"}
              </div>
            </div>

            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                📦 {lang === "en" ? "Initial Stock (optional)" : "Stock initial (optionnel)"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Location" : "Emplacement"}</label>
                  <select className="input" value={newProduct.initial_location_id || ""} onChange={e => setNewProduct(p => ({ ...p, initial_location_id: e.target.value }))}>
                    <option value="">{lang === "en" ? "Skip (add stock later)" : "Ignorer (ajouter stock plus tard)"}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Initial quantity" : "Quantité initiale"}</label>
                  <input className="input" type="number" value={newProduct.initial_quantity || ""} onChange={e => setNewProduct(p => ({ ...p, initial_quantity: e.target.value }))} placeholder="0" disabled={!newProduct.initial_location_id} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddProduct(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!newProduct.name || !newProduct.sell_price || addProductMutation.isPending}
                onClick={() => addProductMutation.mutate()}>
                {addProductMutation.isPending ? "..." : (lang === "en" ? "✓ Add Product" : "✓ Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT PRODUCT MODAL (owner only) ── */}
      {showEditProduct && editProduct && (
        <div className="modal-overlay" onClick={() => setShowEditProduct(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
              ✏️ {lang === "en" ? "Edit Product" : "Modifier le produit"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{editProduct.name}</div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label>
              <input className="input" value={editProduct.name} onChange={e => setEditProduct(p => ({ ...p, name: e.target.value }))} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Barcode" : "Code-barres"}</label>
                <input className="input" value={editProduct.barcode || ""} onChange={e => setEditProduct(p => ({ ...p, barcode: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Unit" : "Unité"}</label>
                <select className="input" value={editProduct.unit} onChange={e => setEditProduct(p => ({ ...p, unit: e.target.value }))}>
                  {["pce", "kg", "litre", "metre", "boite", "set", "paire", "carton"].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                💰 {lang === "en" ? "Pricing — update as market changes" : "Tarification — mettez à jour selon le marché"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Cost price (FCFA)" : "Prix achat (FCFA)"}</label>
                  <input className="input" type="number" value={editProduct.cost_price || ""} onChange={e => setEditProduct(p => ({ ...p, cost_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "var(--brand-light)" }}>{lang === "en" ? "Walk-in price (FCFA)" : "Prix détail (FCFA)"}</label>
                  <input className="input" type="number" value={editProduct.sell_price || ""} onChange={e => setEditProduct(p => ({ ...p, sell_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "#fbbf24" }}>{lang === "en" ? "Wholesale price (FCFA)" : "Prix gros (FCFA)"}</label>
                  <input className="input" type="number" value={editProduct.wholesale_price || ""} onChange={e => setEditProduct(p => ({ ...p, wholesale_price: e.target.value }))} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="label" style={{ color: "#f87171" }}>{lang === "en" ? "Min price floor (FCFA)" : "Prix minimum (FCFA)"}</label>
                  <input className="input" type="number" value={editProduct.min_price || ""} onChange={e => setEditProduct(p => ({ ...p, min_price: e.target.value }))} placeholder="0" />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                🔒 {lang === "en" ? "Min floor: staff cannot sell below this. Owner PIN required to override." : "Prix min: le personnel ne peut pas vendre en dessous. PIN propriétaire requis pour forcer."}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowEditProduct(false); setEditProduct(null); }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!editProduct.name || !editProduct.sell_price || editProductMutation.isPending}
                onClick={() => editProductMutation.mutate()}>
                {editProductMutation.isPending ? "..." : (lang === "en" ? "✓ Save Changes" : "✓ Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIVE GOODS MODAL ── */}
      {showReceive && (
        <div className="modal-overlay" onClick={() => setShowReceive(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              📦 {lang === "en" ? "Receive Goods" : "Réceptionner des marchandises"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Destination" : "Destination"} *</label>
              <select className="input" value={receiveForm.location_id} onChange={e => setRP("location_id", e.target.value)}>
                <option value="">{lang === "en" ? "Select warehouse/shop" : "Choisir magasin/boutique"}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Supplier" : "Fournisseur"}</label>
                <input className="input" value={receiveForm.supplier_name} onChange={e => setRP("supplier_name", e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Invoice ref" : "Réf facture"}</label>
                <input className="input" value={receiveForm.invoice_ref} onChange={e => setRP("invoice_ref", e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{lang === "en" ? "Items received" : "Articles reçus"}</div>
            {receiveForm.items.map((item, idx) => (
              <ReceiveItemRow key={idx} idx={idx} item={item} products={products} lang={lang} setItem={setItem} />
            ))}
            <button className="btn btn-secondary btn-sm" onClick={addItem} style={{ marginBottom: 16 }}>
              + {lang === "en" ? "Add another item" : "Ajouter un article"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowReceive(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!receiveForm.location_id || receiveMutation.isPending}
                onClick={() => receiveMutation.mutate()}>
                {receiveMutation.isPending ? "..." : (lang === "en" ? "✓ Confirm Receipt" : "✓ Confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADJUST STOCK MODAL ── */}
      {showAdjust && selectedStockRow && (
        <AdjustModal
          product={selectedStockRow} lang={lang}
          onClose={() => { setShowAdjust(false); setSelectedStockRow(null); }}
          onSuccess={() => { setShowAdjust(false); setSelectedStockRow(null); qc.invalidateQueries(["stock"]); qc.invalidateQueries(["stock-all"]); }}
        />
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
      await api.patch("/stock/adjust", {
        product_id: product.product_id,
        location_id: product.location_id,
        new_quantity: +qty,
        reason
      });
      toast.success(lang === "en" ? "✓ Stock adjusted!" : "✓ Stock ajusté!");
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
          {lang === "en" ? "Adjust Stock" : "Ajuster le stock"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
          {product.pa_products?.name} — {product.pa_locations?.name}
        </div>
        <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{lang === "en" ? "Current quantity" : "Quantité actuelle"}</span>
          <strong>{product.quantity} {product.pa_products?.unit}</strong>
        </div>
        <div className="form-group">
          <label className="label">{lang === "en" ? "New quantity" : "Nouvelle quantité"}</label>
          <input className="input" type="number" value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">{lang === "en" ? "Reason for adjustment" : "Raison de l'ajustement"}</label>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={lang === "en" ? "e.g. Stock count, damaged goods..." : "Ex: Comptage, marchandises endommagées..."} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            {lang === "en" ? "Cancel" : "Annuler"}
          </button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={loading} onClick={handleSubmit}>
            {loading ? "..." : (lang === "en" ? "✓ Save" : "✓ Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiveItemRow({ idx, item, products, lang, setItem }) {
  const [search, setSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [selectedName, setSelectedName] = useState("");

  function fuzzyMatch(str, pattern) {
    if (!str || !pattern) return false;
    const s = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const p = pattern.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.includes(p);
  }

  const filtered = search.length >= 1
    ? products.filter(p => fuzzyMatch(p.name, search) || (p.barcode && p.barcode.includes(search))).slice(0, 6)
    : [];

  const selectProduct = (p) => {
    setItem(idx, "product_id", p.id);
    setSelectedName(p.name);
    setSearch("");
    setShowDrop(false);
  };

  return (
    <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <label className="label">{lang === "en" ? "Product" : "Produit"} *</label>
          {item.product_id && selectedName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(79,70,229,0.1)", border: "1px solid var(--brand)", borderRadius: 8, fontSize: 13 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{selectedName}</span>
              <button onClick={() => { setItem(idx, "product_id", ""); setSelectedName(""); }}
                style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          ) : (
            <>
              <input className="input"
                placeholder={lang === "en" ? "Type name or scan barcode..." : "Tapez le nom ou scannez..."}
                value={search}
                onChange={e => { setSearch(e.target.value); setShowDrop(true); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 200)} />
              {showDrop && filtered.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", marginTop: 2 }}>
                  {filtered.map(p => (
                    <div key={p.id} onMouseDown={() => selectProduct(p)}
                      style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 13 }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.barcode}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label className="label">{lang === "en" ? "Quantity" : "Quantité"} *</label>
          <input className="input" type="number" value={item.quantity} onChange={e => setItem(idx, "quantity", e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">{lang === "en" ? "Cost price" : "Prix achat"}</label>
          <input className="input" type="number" value={item.cost_price} onChange={e => setItem(idx, "cost_price", e.target.value)} placeholder="FCFA" />
        </div>
      </div>
    </div>
  );
}
