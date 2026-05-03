# Inventory Module - Full implementation

Set-Content -Path "src\pages\InventoryPage.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore } from "../store";
import api, { formatCFA } from "../utils/api";

export default function InventoryPage() {
  const { t, lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [tab, setTab]             = useState("stock");
  const [search, setSearch]       = useState("");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showReceive, setShowReceive]       = useState(false);
  const [showAdjust, setShowAdjust]         = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [newProduct, setNewProduct] = useState({
    name: "", barcode: "", category_id: "", unit: "pce",
    cost_price: "", sell_price: "", description: ""
  });

  const [receiveForm, setReceiveForm] = useState({
    location_id: "", supplier_name: "", invoice_ref: "", notes: "",
    items: [{ product_id: "", barcode: "", quantity: "", cost_price: "" }]
  });

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock", selectedLocation?.id, search],
    queryFn: () => api.get(`/stock?${selectedLocation ? "location_id=" + selectedLocation.id : ""}`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: alertData } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => api.get("/stock?low_only=true").then(r => r.data),
    refetchInterval: 60000
  });

  const { data: productsData } = useQuery({
    queryKey: ["products", search],
    queryFn: () => api.get(`/products?search=${search}&limit=50`).then(r => r.data),
    enabled: tab === "products"
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/products?limit=1").then(r => r.data)
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const addProductMutation = useMutation({
    mutationFn: () => api.post("/products", {
      ...newProduct,
      cost_price: +newProduct.cost_price || 0,
      sell_price: +newProduct.sell_price
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Product added!" : "Produit ajoute!");
      setShowAddProduct(false);
      setNewProduct({ name: "", barcode: "", category_id: "", unit: "pce", cost_price: "", sell_price: "", description: "" });
      qc.invalidateQueries(["products"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || t("common.error"))
  });

  const receiveMutation = useMutation({
    mutationFn: () => api.post("/stock/arrivals", {
      ...receiveForm,
      items: receiveForm.items.filter(i => i.product_id && i.quantity).map(i => ({
        ...i, quantity: +i.quantity, cost_price: +i.cost_price || 0
      }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Stock received!" : "Stock receptionne!");
      setShowReceive(false);
      setReceiveForm({ location_id: "", supplier_name: "", invoice_ref: "", notes: "", items: [{ product_id: "", barcode: "", quantity: "", cost_price: "" }] });
      qc.invalidateQueries(["stock"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || t("common.error"))
  });

  const stock = stockData?.data || [];
  const alerts = alertData?.data || [];
  const products = productsData?.data || [];
  const locations = locationsData?.data || [];

  const filtered = search
    ? stock.filter(s => s.pa_products?.name?.toLowerCase().includes(search.toLowerCase()) || s.pa_products?.barcode?.includes(search))
    : stock;

  const setRP = (k, v) => setReceiveForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setReceiveForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addItem = () => setReceiveForm(f => ({ ...f, items: [...f.items, { product_id: "", barcode: "", quantity: "", cost_price: "" }] }));

  const UNITS = ["pce", "kg", "litre", "metre", "boite", "set", "paire"];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{lang === "en" ? "Inventory" : "Inventaire"}</h1>
          {alerts.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#fbbf24" }}>
              {alerts.length} {lang === "en" ? "items below minimum stock" : "articles sous le stock minimum"}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowReceive(true)}>
            + {lang === "en" ? "Receive Goods" : "Receptionner"}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddProduct(true)}>
            + {lang === "en" ? "Add Product" : "Ajouter produit"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {[
          { key: "stock",    en: "Stock Levels",  fr: "Niveaux de stock" },
          { key: "products", en: "Products",      fr: "Produits" },
          { key: "alerts",   en: `Alerts (${alerts.length})`, fr: `Alertes (${alerts.length})` },
        ].map(tab_item => (
          <button key={tab_item.key} onClick={() => setTab(tab_item.key)} style={{
            padding: "10px 20px", background: "none", border: "none",
            borderBottom: tab === tab_item.key ? "2px solid var(--brand)" : "2px solid transparent",
            color: tab === tab_item.key ? "var(--text-primary)" : "var(--text-muted)",
            cursor: "pointer", fontSize: 13, fontWeight: tab === tab_item.key ? 600 : 400,
            marginBottom: -1
          }}>
            {lang === "en" ? tab_item.en : tab_item.fr}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input className="input" placeholder={lang === "en" ? "Search products or barcode..." : "Chercher produit ou code-barres..."}
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 400 }} />
      </div>

      {/* Stock tab */}
      {tab === "stock" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {stockLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{t("common.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No stock records yet" : "Aucun stock enregistre"}</div>
              <div style={{ fontSize: 12 }}>{lang === "en" ? "Receive goods to see stock here" : "Receptionnez des marchandises pour voir le stock"}</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                  <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Quantity" : "Quantite"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Min stock" : "Stock min"}</th>
                  <th>{lang === "en" ? "Status" : "Statut"}</th>
                  <th>{lang === "en" ? "Actions" : "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isLow = s.quantity <= s.min_quantity;
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.pa_products?.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{s.pa_products?.barcode || "-"}</td>
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_locations?.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_locations?.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>
                          {s.pa_locations?.type === "warehouse" ? (lang === "en" ? "Warehouse" : "Magasin") : (lang === "en" ? "Shop" : "Boutique")} - {s.pa_locations?.name}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: isLow ? "#f87171" : "var(--text-primary)" }}>
                        {s.quantity} {s.pa_products?.unit}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.min_quantity}</td>
                      <td>
                        {isLow ? (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                            {lang === "en" ? "Low stock" : "Stock bas"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
                            {lang === "en" ? "OK" : "OK"}
                          </span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedProduct(s); setShowAdjust(true); }}>
                          {lang === "en" ? "Adjust" : "Ajuster"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Products tab */}
      {tab === "products" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {products.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No products yet" : "Aucun produit"}</div>
              <button className="btn btn-primary" onClick={() => setShowAddProduct(true)} style={{ marginTop: 12 }}>
                + {lang === "en" ? "Add first product" : "Ajouter le premier produit"}
              </button>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
                  <th>{lang === "en" ? "Category" : "Categorie"}</th>
                  <th>{lang === "en" ? "Unit" : "Unite"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost price" : "Prix achat"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Sell price" : "Prix vente"}</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "-"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{p.pa_categories?.name || "-"}</td>
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

      {/* Alerts tab */}
      {tab === "alerts" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {alerts.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontWeight: 600, color: "#34d399", marginBottom: 6 }}>{lang === "en" ? "All stock levels OK!" : "Tous les stocks sont OK!"}</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Current" : "Actuel"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Minimum" : "Minimum"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Shortage" : "Manque"}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.product_id + a.location_id}>
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

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="modal-overlay" onClick={() => setShowAddProduct(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Add New Product" : "Ajouter un produit"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label>
              <input className="input" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Filtre a huile Honda" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Barcode" : "Code-barres"}</label>
              <input className="input" value={newProduct.barcode} onChange={e => setNewProduct(p => ({ ...p, barcode: e.target.value }))} placeholder="Scan or type barcode" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Cost price (FCFA)" : "Prix achat (FCFA)"}</label>
                <input className="input" type="number" value={newProduct.cost_price} onChange={e => setNewProduct(p => ({ ...p, cost_price: e.target.value }))} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Sell price (FCFA)" : "Prix vente (FCFA)"} *</label>
                <input className="input" type="number" value={newProduct.sell_price} onChange={e => setNewProduct(p => ({ ...p, sell_price: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Unit" : "Unite"}</label>
              <select className="input" value={newProduct.unit} onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))}>
                {["pce","kg","litre","metre","boite","set","paire"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddProduct(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!newProduct.name || !newProduct.sell_price || addProductMutation.isPending}
                onClick={() => addProductMutation.mutate()}>
                {addProductMutation.isPending ? "..." : (lang === "en" ? "Add Product" : "Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Goods Modal */}
      {showReceive && (
        <div className="modal-overlay" onClick={() => setShowReceive(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Receive Goods" : "Receptionner des marchandises"}
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
                <label className="label">{lang === "en" ? "Invoice ref" : "Ref facture"}</label>
                <input className="input" value={receiveForm.invoice_ref} onChange={e => setRP("invoice_ref", e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, marginTop: 4 }}>
              {lang === "en" ? "Items received" : "Articles recus"}
            </div>

            {receiveForm.items.map((item, idx) => (
              <div key={idx} style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <label className="label">{lang === "en" ? "Product" : "Produit"}</label>
                    <select className="input" value={item.product_id} onChange={e => setItem(idx, "product_id", e.target.value)}>
                      <option value="">{lang === "en" ? "Select product" : "Choisir produit"}</option>
                      {(productsData?.data || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{lang === "en" ? "Barcode (optional)" : "Code-barres"}</label>
                    <input className="input" value={item.barcode} onChange={e => setItem(idx, "barcode", e.target.value)} placeholder="Scan barcode" />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label className="label">{lang === "en" ? "Quantity" : "Quantite"} *</label>
                    <input className="input" type="number" value={item.quantity} onChange={e => setItem(idx, "quantity", e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="label">{lang === "en" ? "Cost price" : "Prix achat"}</label>
                    <input className="input" type="number" value={item.cost_price} onChange={e => setItem(idx, "cost_price", e.target.value)} placeholder="FCFA" />
                  </div>
                </div>
              </div>
            ))}

            <button className="btn btn-secondary btn-sm" onClick={addItem} style={{ marginBottom: 16 }}>
              + {lang === "en" ? "Add another item" : "Ajouter un article"}
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowReceive(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!receiveForm.location_id || receiveMutation.isPending}
                onClick={() => receiveMutation.mutate()}>
                {receiveMutation.isPending ? "..." : (lang === "en" ? "Confirm Receipt" : "Confirmer la reception")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {showAdjust && selectedProduct && (
        <AdjustModal
          product={selectedProduct}
          lang={lang}
          t={t}
          onClose={() => { setShowAdjust(false); setSelectedProduct(null); }}
          onSuccess={() => { setShowAdjust(false); setSelectedProduct(null); qc.invalidateQueries(["stock"]); }}
        />
      )}
    </div>
  );
}

function AdjustModal({ product, lang, t, onClose, onSuccess }) {
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
      toast.success(lang === "en" ? "Stock adjusted!" : "Stock ajuste!");
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{lang === "en" ? "Adjust Stock" : "Ajuster le stock"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>{product.pa_products?.name} - {product.pa_locations?.name}</div>
        <div className="form-group">
          <label className="label">{lang === "en" ? "New quantity" : "Nouvelle quantite"}</label>
          <input className="input" type="number" value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">{lang === "en" ? "Reason" : "Raison"}</label>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={lang === "en" ? "e.g. Stock count correction" : "Ex: Correction inventaire"} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={loading} onClick={handleSubmit}>
            {loading ? "..." : (lang === "en" ? "Save adjustment" : "Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}
'@

Write-Host "Inventory module created!" -ForegroundColor Green
Write-Host "Now update App.jsx to use the real InventoryPage..." -ForegroundColor Yellow

# Update App.jsx to use real InventoryPage instead of placeholder
$app = Get-Content "src\App.jsx" -Raw
$app = $app -replace 'import \{ InventoryPage,', 'import { CustomersPage,'
$app = $app -replace 'CustomersPage, CreditsPage, TransfersPage, ExpenditurePage, ReportsPage, SettingsPage \} from "\./pages/Placeholders";', 'CreditsPage, TransfersPage, ExpenditurePage, ReportsPage, SettingsPage } from "./pages/Placeholders";'
$app = 'import InventoryPage from "./pages/InventoryPage";' + "`n" + $app
Set-Content "src\App.jsx" -Value $app -Encoding UTF8

Write-Host "App.jsx updated!" -ForegroundColor Green
Write-Host "Restart npm run dev and go to /inventory" -ForegroundColor Cyan
