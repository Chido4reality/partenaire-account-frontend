// v20260509_0045 - slot + last_moved_by + global_search
import BarcodeInput from "../components/common/BarcodeInput";
import CameraScanner from "../components/common/CameraScanner";
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api, { formatCFA } from "../utils/api";
import OwnerPIN from "../components/common/OwnerPIN";
import PaywallModal from "../components/common/PaywallModal";
import { getCapabilities, isAtCap } from "../utils/planCapabilities";

// Sprint C — shared helper for the 4 product entry paths. Reads a File
// from the camera/file picker, resizes if larger than 1920px on the
// long side, and returns a base64 data URL. Backend accepts the URL
// directly and uploads to Supabase Storage.
async function readPhotoToDataUrl(file, lang) {
  if (!file) return null;
  if (!/^image\//.test(file.type)) {
    const msg = lang === "en" ? "Please pick an image" : "Veuillez choisir une image";
    throw new Error(msg);
  }
  if (file.size > 8 * 1024 * 1024) {
    const msg = lang === "en" ? "Image too large (max 8MB before resize)" : "Image trop grande (8MB max)";
    throw new Error(msg);
  }
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
  // Resize via canvas to cap long-side at 1920px (keeps storage costs
  // sane). Skip if already small enough.
  const img = new Image();
  await new Promise((resolve) => { img.onload = resolve; img.src = dataUrl; });
  const maxSide = 1920;
  if (img.width <= maxSide && img.height <= maxSide && file.size < 1_500_000) return dataUrl;
  const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(mime, 0.85);
}

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

const UNITS = ["pce", "kg", "litre", "metre", "boite", "set", "paire", "carton", "sac", "fût"];

const EMPTY_PRODUCT = {
  name: "", barcode: "", unit: "pce",
  cost_price: "", sell_price: "", wholesale_price: "", min_price: "",
  description: "", initial_location_id: "", initial_quantity: "", initial_slot: ""
};

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

  const [tab, setTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  // Modal states
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showCameraAdd, setShowCameraAdd] = useState(false);
  const [showCameraRapid, setShowCameraRapid] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showEditProduct, setShowEditProduct] = useState(false);
  const [showRapidEntry, setShowRapidEntry] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);   // Sprint C — photo backfill modal
  const [backfillUploading, setBackfillUploading] = useState(null); // id of product currently uploading
  const [showPIN, setShowPIN] = useState(false);
  const [pinAction, setPinAction] = useState(null);

  const [selectedStockRow, setSelectedStockRow] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT);

  // Receive Goods state
  const [receiveForm, setReceiveForm] = useState({
    location_id: "", supplier_name: "", invoice_ref: "", notes: "",
    items: [{ product_id: "", product_name: "", quantity: "", slot_code: "", cost_price: "", sell_price: "", wholesale_price: "", min_price: "", currentPrices: null }]
  });

  // Rapid entry state
  const [rapidItem, setRapidItem] = useState(EMPTY_PRODUCT);
  const [rapidCount, setRapidCount] = useState(0);
  const rapidNameRef = useRef(null);

  // Import state
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState([]);
  const [importError, setImportError] = useState("");

  const searchRef = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      const active = document.activeElement;
      const isModal = showAddProduct || showReceive || showAdjust || showEditProduct || showRapidEntry || showImport;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (isTyping && active !== searchRef.current) return;
      if (isModal) return;
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        barcodeBuffer.current = "";
        if (code.length >= 3) { setSearch(code); setScanning(true); setTimeout(() => setScanning(false), 800); }
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
  }, [showAddProduct, showReceive, showAdjust, showEditProduct, showRapidEntry, showImport]);

  // ── DATA QUERIES ────────────────────────────────────────────────────────────
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock", selectedLocation?.id, search],
    queryFn: () => {
      // When searching, search across ALL locations
      const params = new URLSearchParams();
      if (selectedLocation && !search) params.append("location_id", selectedLocation.id);
      if (search) params.append("search", search);
      return api.get("/stock?" + params.toString()).then(r => r.data);
    },
    refetchInterval: 30000
  });

  const { data: alertData } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => api.get("/stock?low_only=true").then(r => r.data),
    refetchInterval: 60000
  });

  const { data: productsData } = useQuery({
    queryKey: ["products-all"],
    queryFn: () => api.get("/products?limit=500").then(r => r.data),
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

  const stock = stockData?.data || [];
  const alerts = alertData?.data || [];
  const products = productsData?.data || [];
  const locations = locationsData?.data || [];
  const allStock = allStockData?.data || [];

  // Backend handles search globally, just use data as-is
  const filtered = stock;
  const filteredProducts = search ? products.filter(p => fuzzyMatch(p.name, search) || (p.barcode && p.barcode.includes(search))) : products;

  const totalStockValue = isOwner ? stock.reduce((sum, s) => sum + (+s.quantity * +(s.pa_products?.cost_price || 0)), 0) : 0;

  const invalidateAll = () => {
    qc.invalidateQueries(["stock"]);
    qc.invalidateQueries(["stock-all"]);
    qc.invalidateQueries(["products-all"]);
    qc.invalidateQueries(["stock-alerts"]);
  };

  // ── ADD PRODUCT MUTATION ────────────────────────────────────────────────────
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  // Sprint A: paywall state when an inventory cap action is blocked.
  const [paywall, setPaywall] = useState(null);
  // Sprint A: pull effective plan + capabilities. We already have the
  // legacy /my-plan query cached by Layout — re-using the same key
  // skips an extra round-trip on page load.
  const { data: planData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    refetchInterval: 300000,
    retry: 1
  });
  const myPlan = planData?.data;
  const effectivePlan = myPlan?.effective_plan || "silver";
  const planCaps = getCapabilities(effectivePlan);
  const productsCount = products.length || 0;
  const atInventoryCap = isAtCap(effectivePlan, "inventory_cap", productsCount);
  const guardAdd = (continueAction) => {
    if (atInventoryCap) {
      setPaywall({ feature: "inventory_cap", mpId: myPlan?.user_id_number });
      return;
    }
    continueAction();
  };

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
      // Sprint C: if the user attached a photo, upload it now that we
      // have the product id. Photo upload is non-blocking for stock
      // arrival — a failed upload doesn't roll back the product.
      if (newProduct.photo_data_url) {
        try {
          await api.post(`/products/${product.id}/photo`, { data_url: newProduct.photo_data_url });
        } catch (e) {
          toast.error(lang === "en" ? "Product saved but photo upload failed" : "Produit créé mais l'envoi de la photo a échoué");
        }
      }
      if (newProduct.initial_location_id && newProduct.initial_quantity) {
        await api.post("/stock/arrivals", {
          location_id: newProduct.initial_location_id,
          items: [{ product_id: product.id, quantity: +newProduct.initial_quantity, slot_code: newProduct.initial_slot || null, cost_price: +newProduct.cost_price || 0 }]
        });
      }
      return res.data;
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product added!" : "✓ Produit ajouté!");
      setShowAddProduct(false);
      setNewProduct(EMPTY_PRODUCT);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── EDIT PRODUCT MUTATION ───────────────────────────────────────────────────
  const editProductMutation = useMutation({
    mutationFn: () => api.patch(`/products/${editProduct.id}`, {
      name: editProduct.name,
      barcode: editProduct.barcode || null,
      unit: editProduct.unit,
      cost_price: +editProduct.cost_price || 0,
      sell_price: +editProduct.sell_price,
      wholesale_price: +editProduct.wholesale_price || 0,
      min_price: +editProduct.min_price || 0,
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product updated!" : "✓ Produit mis à jour!");
      setShowEditProduct(false); setEditProduct(null);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── RECEIVE GOODS MUTATION ──────────────────────────────────────────────────
  const receiveMutation = useMutation({
    mutationFn: async () => {
      const validItems = receiveForm.items.filter(i => i.product_id && i.quantity);
      if (!validItems.length) throw new Error("No valid items");

      // Update prices for each product first
      for (const item of validItems) {
        const priceUpdate = {};
        if (item.cost_price) priceUpdate.cost_price = +item.cost_price;
        if (item.sell_price) priceUpdate.sell_price = +item.sell_price;
        if (item.wholesale_price) priceUpdate.wholesale_price = +item.wholesale_price;
        if (item.min_price) priceUpdate.min_price = +item.min_price;
        if (Object.keys(priceUpdate).length > 0) {
          await api.patch(`/products/${item.product_id}`, priceUpdate);
        }
      }

      // Then add stock
      return api.post("/stock/arrivals", {
        location_id: receiveForm.location_id,
        supplier_name: receiveForm.supplier_name || null,
        invoice_ref: receiveForm.invoice_ref || null,
        notes: receiveForm.notes || null,
        items: validItems.map(i => ({ product_id: i.product_id, quantity: +i.quantity, slot_code: i.slot_code || null, cost_price: +i.cost_price || 0 }))
      });
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Stock received & prices updated!" : "✓ Stock reçu et prix mis à jour!");
      setShowReceive(false);
      setReceiveForm({ location_id: "", supplier_name: "", invoice_ref: "", notes: "", items: [{ product_id: "", product_name: "", quantity: "", cost_price: "", sell_price: "", wholesale_price: "", min_price: "", currentPrices: null }] });
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── RAPID ENTRY MUTATION ────────────────────────────────────────────────────
  const rapidMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/products", {
        name: rapidItem.name, barcode: rapidItem.barcode || null, unit: rapidItem.unit,
        cost_price: +rapidItem.cost_price || 0, sell_price: +rapidItem.sell_price,
        wholesale_price: +rapidItem.wholesale_price || 0, min_price: +rapidItem.min_price || 0,
      });
      const product = res.data.data;
      if (rapidItem.initial_location_id && rapidItem.initial_quantity) {
        await api.post("/stock/arrivals", {
          location_id: rapidItem.initial_location_id,
          items: [{ product_id: product.id, quantity: +rapidItem.initial_quantity, slot_code: rapidItem.initial_slot || null, cost_price: +rapidItem.cost_price || 0 }]
        });
      }
      return res.data;
    },
    onSuccess: () => {
      setRapidCount(c => c + 1);
      toast.success(lang === "en" ? `✓ ${rapidItem.name} added!` : `✓ ${rapidItem.name} ajouté!`, { duration: 1500 });
      setRapidItem(prev => ({ ...EMPTY_PRODUCT, initial_location_id: prev.initial_location_id, unit: prev.unit }));
      setTimeout(() => rapidNameRef.current?.focus(), 100);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── IMPORT MUTATION ─────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const row of importPreview) {
        if (!row.name || !row.sell_price) continue;
        try {
          const res = await api.post("/products", {
            name: row.name, barcode: row.barcode || null, unit: row.unit || "pce",
            cost_price: +row.cost_price || 0, sell_price: +row.sell_price,
            wholesale_price: +row.wholesale_price || 0, min_price: +row.min_price || 0,
          });
          const product = res.data.data;
          if (row.location_id && row.initial_quantity) {
            await api.post("/stock/arrivals", {
              location_id: row.location_id,
              items: [{ product_id: product.id, quantity: +row.initial_quantity, cost_price: +row.cost_price || 0 }]
            });
          }
          results.push({ name: row.name, success: true });
        } catch (e) {
          results.push({ name: row.name, success: false, error: e.response?.data?.message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      toast.success(`✓ ${ok} products imported${fail > 0 ? `, ${fail} failed` : ""}`, { duration: 4000 });
      setShowImport(false); setImportFile(null); setImportPreview([]);
      invalidateAll();
    },
    onError: (err) => toast.error(err.message || "Import failed")
  });

  // ── CSV PARSER ──────────────────────────────────────────────────────────────
  const parseCSV = (text) => {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
      // Map location name to id
      const loc = locations.find(l => l.name.toLowerCase() === (row.location || "").toLowerCase());
      row.location_id = loc?.id || "";
      row.initial_quantity = row.qty || row.quantity || row.initial_quantity || "";
      if (row.name) rows.push(row);
    }
    return rows;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    setImportError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (rows.length === 0) { setImportError("No valid rows found. Check your file format."); return; }
        setImportPreview(rows);
      } catch (err) {
        setImportError("Could not parse file. Make sure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const headers = "name,barcode,unit,cost_price,sell_price,wholesale_price,min_price,qty,location";
    const example1 = `Tube,1234567890,pce,2500,4000,3500,2500,100,${locations[0]?.name || "Bonaberri Store"}`;
    const example2 = `Huile palme,0987654321,litre,1800,3000,2500,1800,50,${locations[0]?.name || "Bonaberri Store"}`;
    const csv = [headers, example1, example2].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "inventory_import_template.csv";
    a.click(); URL.revokeObjectURL(url);
  };

  // ── RECEIVE GOODS HELPERS ───────────────────────────────────────────────────
  const setReceiveItem = (idx, k, v) => setReceiveForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addReceiveItem = () => setReceiveForm(f => ({ ...f, items: [...f.items, { product_id: "", product_name: "", quantity: "", slot_code: "", cost_price: "", sell_price: "", wholesale_price: "", min_price: "", currentPrices: null }] }));
  const removeReceiveItem = (idx) => setReceiveForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const selectReceiveProduct = (idx, product) => {
    setReceiveForm(f => ({
      ...f,
      items: f.items.map((it, i) => i === idx ? {
        ...it,
        product_id: product.id,
        product_name: product.name,
        cost_price: product.cost_price || "",
        sell_price: product.sell_price || "",
        wholesale_price: product.wholesale_price || "",
        min_price: product.min_price || "",
        currentPrices: {
          cost: product.cost_price,
          sell: product.sell_price,
          wholesale: product.wholesale_price,
          min: product.min_price
        }
      } : it)
    }));
  };

  const TABS = [
    { key: "stock",    en: "Stock Levels",  fr: "Niveaux de stock" },
    { key: "overview", en: "Overview",      fr: "Vue ensemble" },
    { key: "products", en: "Products",      fr: "Produits" },
    { key: "alerts",   en: `Alerts (${alerts.length})`, fr: `Alertes (${alerts.length})` },
  ];

  const byProduct = {};
  allStock.forEach(s => {
    const pid = s.product_id;
    if (!byProduct[pid]) byProduct[pid] = { name: s.pa_products?.name || "?", unit: s.pa_products?.unit || "pce", barcode: s.pa_products?.barcode || "", locs: {}, total: 0 };
    byProduct[pid].locs[s.location_id] = s.quantity;
    byProduct[pid].total += +s.quantity;
  });
  const overviewProducts = Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>

      <OwnerPIN open={showPIN} onSuccess={() => { setShowPIN(false); pinAction?.(); }} onCancel={() => { setShowPIN(false); setPinAction(null); }} lang={lang} />

      {/* Sprint C: backfill banner for products that pre-date photo
          capture. Hidden when every product already has photo_url set. */}
      {(() => {
        const photoless = products.filter(p => !p.photo_url && !p.image_url).length;
        if (photoless === 0) return null;
        return (
          <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#fbbf24" }}>
              📷 {lang === "en"
                  ? `You have ${photoless} product${photoless === 1 ? "" : "s"} without photos.`
                  : `Vous avez ${photoless} produit${photoless === 1 ? "" : "s"} sans photo.`}
            </span>
            <button onClick={() => setShowBackfill(true)}
              style={{ background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.5)", color: "#fbbf24", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {lang === "en" ? "Add photos now →" : "Ajouter les photos →"}
            </button>
          </div>
        );
      })()}

      {/* ── HEADER ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{lang === "en" ? "Inventory" : "Inventaire"}</h1>
          <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
            {alerts.length > 0 && <div style={{ fontSize: 12, color: "#fbbf24" }}>⚠️ {alerts.length} {lang === "en" ? "items below minimum" : "articles sous le minimum"}</div>}
            {isOwner && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{lang === "en" ? "Stock value:" : "Valeur stock:"} <strong style={{ color: "var(--brand-light)" }}>{formatCFA(totalStockValue)}</strong></div>}
            {/* Sprint A: inventory cap usage badge. Hidden on plans with
                unlimited inventory (Trial/Gold/Premium). */}
            {planCaps.inventory_cap != null && (
              <div style={{
                fontSize: 12, padding: "3px 10px", borderRadius: 12,
                background: atInventoryCap ? "rgba(239,68,68,0.15)" : "rgba(99,102,241,0.15)",
                color: atInventoryCap ? "#fca5a5" : "var(--brand-light)",
                border: `1px solid ${atInventoryCap ? "rgba(239,68,68,0.35)" : "rgba(99,102,241,0.3)"}`,
                fontWeight: 600, cursor: atInventoryCap ? "pointer" : "default"
              }}
              onClick={() => atInventoryCap && setPaywall({ feature: "inventory_cap", mpId: myPlan?.user_id_number })}>
                {productsCount} / {planCaps.inventory_cap} {lang === "en" ? `products on ${planCaps.label}` : `produits — ${planCaps.label_fr}`}
                {atInventoryCap && (lang === "en" ? " — upgrade for unlimited" : " — mise à niveau requise")}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canReceiveGoods && (
            <button className="btn btn-secondary" onClick={() => guardAdd(() => setShowReceive(true))}
              style={atInventoryCap ? { opacity: 0.55 } : {}}>
              📦 {lang === "en" ? "Receive Goods" : "Réceptionner"}{atInventoryCap ? " 🔒" : ""}
            </button>
          )}
          {canAddProduct && (
            <>
              <button className="btn btn-secondary" onClick={() => guardAdd(() => setShowRapidEntry(true))}
                title={lang === "en" ? "Rapid entry mode for multiple products" : "Saisie rapide pour plusieurs produits"}
                style={atInventoryCap ? { opacity: 0.55 } : {}}>
                ⚡ {lang === "en" ? "Rapid Entry" : "Saisie rapide"}{atInventoryCap ? " 🔒" : ""}
              </button>
              <button className="btn btn-secondary" onClick={() => guardAdd(() => setShowImport(true))}
                title={lang === "en" ? "Import from Excel/CSV" : "Importer depuis Excel/CSV"}
                style={atInventoryCap ? { opacity: 0.55 } : {}}>
                📊 {lang === "en" ? "Import CSV" : "Importer CSV"}{atInventoryCap ? " 🔒" : ""}
              </button>
              <button className="btn btn-primary" onClick={() => guardAdd(() => setShowAddProduct(true))}
                style={atInventoryCap ? { opacity: 0.55 } : {}}>
                + {lang === "en" ? "Add Product" : "Ajouter produit"}{atInventoryCap ? " 🔒" : ""}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? t.en : t.fr}
          </button>
        ))}
      </div>

      {/* Search */}
      {(tab === "stock" || tab === "products") && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, maxWidth: 600 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input ref={searchRef} className="input"
              placeholder={lang === "en" ? "Search all locations by name, barcode or slot..." : "Chercher partout par nom, code-barres ou emplacement..."}
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 36 }} />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: scanning ? "#10b981" : "var(--text-muted)" }}>
              {scanning ? "✓" : "🔍"}
            </span>
            {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>}
          </div>
          <button onClick={() => setShowCamera(true)}
            style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
            title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>
            📷
          </button>
        </div>
      )}

      {showCamera && (
        <CameraScanner
          lang={lang}
          onScan={(code) => { setShowCamera(false); setSearch(code); setScanning(true); setTimeout(() => setScanning(false), 800); searchRef.current?.focus(); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ── STOCK TAB ── */}
      {tab === "stock" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {stockLoading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          : filtered.length === 0 ? (
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
                  <th>{lang === "en" ? "Slot" : "Emplacement"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Quantity" : "Quantité"}</th>
                  <th style={{ textAlign: "right" }}>Min</th>
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost" : "Achat"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Walk-in" : "Détail"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Wholesale" : "Gros"}</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>{lang === "en" ? "Min floor" : "Prix min"}</th>}
                  <th>Status</th>
                  <th style={{ fontSize: 11 }}>{lang === "en" ? "Last moved by" : "Dernier mouvement"}</th>
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
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_locations?.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_locations?.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>{s.pa_locations?.name}</span></td>
                      <td>
                        {s.slot_code ? (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontFamily: "monospace", fontWeight: 700 }}>
                            📍 {s.slot_code}
                          </span>
                        ) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: isLow ? "#f87171" : "var(--text-primary)" }}>{s.quantity} {p?.unit}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.min_quantity}</td>
                      {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{formatCFA(p?.cost_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p?.sell_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p?.wholesale_price > 0 ? formatCFA(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p?.min_price > 0 ? formatCFA(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_products?.is_active === false ? "rgba(100,100,100,0.15)" : isLow && s.alert_enabled !== false ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_products?.is_active === false ? "var(--text-muted)" : isLow && s.alert_enabled !== false ? "#f87171" : "#34d399" }}>
  {s.pa_products?.is_active === false ? (lang === "en" ? "⏸ Paused" : "⏸ Pausé") : isLow && s.alert_enabled !== false ? (lang === "en" ? "Low" : "Bas") : "OK"}
</span></td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {s.last_moved_by_name ? (
                          <div>
                            <div style={{ fontWeight: 500, color: "var(--text-secondary)" }}>{s.last_moved_by_name}</div>
                            <div style={{ fontSize: 10 }}>{s.last_movement_type}</div>
                          </div>
                        ) : "—"}
                      </td>
                      {canAdjustStock && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedStockRow(s); setShowAdjust(true); }}>{lang === "en" ? "Adjust" : "Ajuster"}</button>
                            {isOwner && <button className="btn btn-secondary btn-sm" onClick={() => { setEditProduct({ ...p, id: s.product_id }); setShowEditProduct(true); }} style={{ color: "var(--brand-light)" }}>✏️</button>}
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
                    <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>{lang === "en" ? "Total inventory value (at cost)" : "Valeur totale inventaire (au coût)"}</td>
                    <td colSpan={5} style={{ textAlign: "right", padding: "12px 16px", fontWeight: 800, color: "var(--brand-light)", fontSize: 15 }}>{formatCFA(totalStockValue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
          {overviewProducts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600 }}>No stock yet</div></div> : (
            <table className="table" style={{ minWidth: 500 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>Product</th>
                  <th>Unit</th>
                  {locations.map(l => <th key={l.id} style={{ textAlign: "right", minWidth: 110 }}><div>{l.name}</div><div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{l.type}</div></th>)}
                  <th style={{ textAlign: "right", color: "var(--brand-light)" }}>TOTAL</th>
                  {isOwner && <th style={{ textAlign: "right", color: "#fbbf24" }}>Value</th>}
                </tr>
              </thead>
              <tbody>
                {overviewProducts.map((p, i) => {
                  const product = products.find(pr => pr.name === p.name);
                  const value = isOwner ? p.total * (product?.cost_price || 0) : 0;
                  const photo = product?.photo_url || product?.image_url || null;
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {photo
                            ? <img src={photo} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }} />
                            : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--bg-elevated)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }} title={lang === "en" ? "No photo" : "Pas de photo"}>📷</div>}
                          <span>{p.name}</span>
                        </div>
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{p.unit}</td>
                      {locations.map(l => <td key={l.id} style={{ textAlign: "right" }}>{p.locs[l.id] != null ? p.locs[l.id] : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>)}
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{p.total}</td>
                      {isOwner && <td style={{ textAlign: "right", fontSize: 12, color: "#fbbf24" }}>{formatCFA(value)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)" }}>
                  <td colSpan={2} style={{ fontWeight: 600, padding: "12px 16px" }}>{overviewProducts.length} products</td>
                  {locations.map(l => { const t = allStock.filter(s => s.location_id === l.id).reduce((sum, s) => sum + +s.quantity, 0); return <td key={l.id} style={{ textAlign: "right", fontWeight: 600, padding: "12px 16px" }}>{t}</td>; })}
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)", padding: "12px 16px" }}>{allStock.reduce((sum, s) => sum + +s.quantity, 0)}</td>
                  {isOwner && <td style={{ textAlign: "right", fontWeight: 700, color: "#fbbf24", padding: "12px 16px" }}>{formatCFA(totalStockValue)}</td>}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── PRODUCTS TAB ── */}
      {tab === "products" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          {filteredProducts.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{search ? `No products matching "${search}"` : (lang === "en" ? "No products yet" : "Aucun produit")}</div>
              {!search && canAddProduct && <button className="btn btn-primary" onClick={() => guardAdd(() => setShowAddProduct(true))} style={{ marginTop: 12, opacity: atInventoryCap ? 0.55 : 1 }}>+ {lang === "en" ? "Add product" : "Ajouter"}{atInventoryCap ? " 🔒" : ""}</button>}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Barcode</th>
                  <th>Unit</th>
                  {canSeePrices && <th style={{ textAlign: "right" }}>Cost</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Walk-in</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Wholesale</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Min floor</th>}
                  <th>Dozie</th>
                  {isOwner && <th>Edit</th>}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {(p.photo_url || p.image_url)
                          ? <img src={p.photo_url || p.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }} />
                          : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--bg-elevated)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}>📷</div>}
                        <span>{p.name}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "—"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{p.unit}</td>
                    {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{formatCFA(p.cost_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{formatCFA(p.sell_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p.wholesale_price > 0 ? formatCFA(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p.min_price > 0 ? formatCFA(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                    <td>
                      <button className="btn btn-secondary btn-sm"
                        title={lang === "en" ? "Expose this product on Dozie marketplace" : "Exposer ce produit sur Dozie"}
                        onClick={async () => {
                          try {
                            await api.patch(`/products/${p.id}/expose-on-dozie`, { is_visible: true });
                            toast.success(lang === "en" ? "✓ Exposed on Dozie" : "✓ Exposé sur Dozie");
                          } catch (err) {
                            // 403 with upgrade_required → global axios interceptor (Sprint A) pops the paywall.
                            if (err.response?.status !== 403) toast.error(err.response?.data?.message || "Error");
                          }
                        }}>🛒 Dozie</button>
                    </td>
                    {isOwner && <td><button className="btn btn-secondary btn-sm" onClick={() => { setEditProduct({ ...p }); setShowEditProduct(true); }} style={{ color: "var(--brand-light)" }}>✏️ Edit</button></td>}
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
          {alerts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>✓ All stock levels OK!</div></div> : (
            <table className="table">
              <thead><tr>
                <th>Product</th><th>Location</th>
                <th style={{ textAlign: "right" }}>Current</th><th style={{ textAlign: "right" }}>Min</th><th style={{ textAlign: "right" }}>Shortage</th>
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

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: ADD NEW PRODUCT ── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showAddProduct && (
        <div className="modal-overlay" onClick={() => setShowAddProduct(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>+ {lang === "en" ? "Add New Product" : "Ajouter un produit"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{lang === "en" ? "For products that don't exist yet in the system" : "Pour les produits qui n'existent pas encore"}</div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label>
              <input className="input" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Tube, Huile palme..." autoFocus />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">Barcode</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <BarcodeInput lang={lang} value={newProduct.barcode} onChange={v => setNewProduct(p => ({ ...p, barcode: v }))} placeholder="Scan or type" />
                  </div>
                  <button type="button" onClick={() => setShowCameraAdd(true)}
                    style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
                    title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>📷</button>
                </div>
              </div>
              <div className="form-group">
                <label className="label">Unit</label>
                <select className="input" value={newProduct.unit} onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {showCameraAdd && (
              <CameraScanner
                lang={lang}
                onScan={(code) => { setShowCameraAdd(false); setNewProduct(p => ({ ...p, barcode: code })); }}
                onClose={() => setShowCameraAdd(false)}
              />
            )}

            {/* Sprint C: photo capture. Standard HTML input with
                accept=image/* + capture=environment → uses native
                camera on mobile, file picker on desktop. Preview is
                inline; data URL is posted in addProductMutation. */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                📷 {lang === "en" ? "Product photo (optional)" : "Photo du produit (optionnel)"}
              </div>
              {newProduct.photo_data_url ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <img src={newProduct.photo_data_url} alt="" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />
                  <button type="button" onClick={() => setNewProduct(p => ({ ...p, photo_data_url: null }))}
                    style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    {lang === "en" ? "Remove" : "Retirer"}
                  </button>
                </div>
              ) : (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, border: "1px dashed var(--border)", background: "var(--bg-card)", cursor: "pointer", fontSize: 13 }}>
                  📷 {lang === "en" ? "Take or choose a photo" : "Prendre ou choisir une photo"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" style={{ display: "none" }}
                    onChange={(e) => readPhotoToDataUrl(e.target.files && e.target.files[0], lang).then(dataUrl => dataUrl && setNewProduct(p => ({ ...p, photo_data_url: dataUrl }))).catch(err => toast.error(err.message))} />
                </label>
              )}
            </div>

            <PricingSection data={newProduct} onChange={(k, v) => setNewProduct(p => ({ ...p, [k]: v }))} lang={lang} />

            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                📦 {lang === "en" ? "Initial Stock (optional)" : "Stock initial (optionnel)"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label className="label">Location</label>
                  <select className="input" value={newProduct.initial_location_id} onChange={e => setNewProduct(p => ({ ...p, initial_location_id: e.target.value }))}>
                    <option value="">{lang === "en" ? "Skip (add later)" : "Ignorer"}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Initial quantity" : "Quantité initiale"}</label>
                  <input className="input" type="number" value={newProduct.initial_quantity} onChange={e => setNewProduct(p => ({ ...p, initial_quantity: e.target.value }))} placeholder="0" disabled={!newProduct.initial_location_id} />
                </div>
                <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="label">📍 {lang === "en" ? "Slot/Zone (optional)" : "Emplacement/Rayon (optionnel)"}</label>
                  <input className="input" value={newProduct.initial_slot || ""} onChange={e => setNewProduct(p => ({ ...p, initial_slot: e.target.value }))} placeholder="A-01, Rayon 2..." disabled={!newProduct.initial_location_id} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddProduct(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!newProduct.name || !newProduct.sell_price || addProductMutation.isPending} onClick={() => addProductMutation.mutate()}>
                {addProductMutation.isPending ? "..." : (lang === "en" ? "✓ Create Product" : "✓ Créer le produit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: RECEIVE GOODS ── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showReceive && (
        <div className="modal-overlay" onClick={() => setShowReceive(false)}>
          <div className="modal" style={{ maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>📦 {lang === "en" ? "Receive Goods" : "Réceptionner des marchandises"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{lang === "en" ? "For existing products — updates prices and adds stock" : "Pour produits existants — met à jour les prix et ajoute le stock"}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Destination *" : "Destination *"}</label>
                <select className="input" value={receiveForm.location_id} onChange={e => setReceiveForm(f => ({ ...f, location_id: e.target.value }))}>
                  <option value="">{lang === "en" ? "Select location" : "Choisir emplacement"}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Supplier</label>
                <input className="input" value={receiveForm.supplier_name} onChange={e => setReceiveForm(f => ({ ...f, supplier_name: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="label">Invoice ref</label>
                <input className="input" value={receiveForm.invoice_ref} onChange={e => setReceiveForm(f => ({ ...f, invoice_ref: e.target.value }))} placeholder="Optional" />
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {lang === "en" ? "Items received" : "Articles reçus"}
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                {lang === "en" ? "(search existing products — prices will update immediately)" : "(recherchez les produits existants — les prix se mettent à jour immédiatement)"}
              </span>
            </div>

            {receiveForm.items.map((item, idx) => (
              <ReceiveItemRow
                key={idx} idx={idx} item={item} products={products} lang={lang}
                onSelect={(product) => selectReceiveProduct(idx, product)}
                onChange={(k, v) => setReceiveItem(idx, k, v)}
                onRemove={receiveForm.items.length > 1 ? () => removeReceiveItem(idx) : null}
                canSeePrices={canSeePrices}
              />
            ))}

            <button className="btn btn-secondary btn-sm" onClick={addReceiveItem} style={{ marginBottom: 16 }}>
              + {lang === "en" ? "Add another item" : "Ajouter un article"}
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowReceive(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!receiveForm.location_id || receiveMutation.isPending || receiveForm.items.every(i => !i.product_id)}
                onClick={() => receiveMutation.mutate()}>
                {receiveMutation.isPending ? "..." : (lang === "en" ? "✓ Confirm & Update Prices" : "✓ Confirmer & Mettre à jour prix")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: EDIT PRODUCT ── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showEditProduct && editProduct && (
        <div className="modal-overlay" onClick={() => setShowEditProduct(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>✏️ {lang === "en" ? "Edit Product" : "Modifier le produit"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{editProduct.name}</div>

            <div className="form-group">
              <label className="label">Name *</label>
              <input className="input" value={editProduct.name} onChange={e => setEditProduct(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">Barcode</label>
                <input className="input" value={editProduct.barcode || ""} onChange={e => setEditProduct(p => ({ ...p, barcode: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Unit</label>
                <select className="input" value={editProduct.unit} onChange={e => setEditProduct(p => ({ ...p, unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <PricingSection data={editProduct} onChange={(k, v) => setEditProduct(p => ({ ...p, [k]: v }))} lang={lang} />

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowEditProduct(false); setEditProduct(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!editProduct.name || !editProduct.sell_price || editProductMutation.isPending} onClick={() => editProductMutation.mutate()}>
                {editProductMutation.isPending ? "..." : (lang === "en" ? "✓ Save Changes" : "✓ Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: RAPID ENTRY ── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showRapidEntry && (
        <div className="modal-overlay" onClick={() => setShowRapidEntry(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>⚡ {lang === "en" ? "Rapid Entry Mode" : "Saisie rapide"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{lang === "en" ? "Add multiple products quickly — form clears after each save" : "Ajoutez plusieurs produits rapidement — le formulaire se vide après chaque sauvegarde"}</div>
              </div>
              {rapidCount > 0 && (
                <div style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", padding: "4px 12px", borderRadius: 20, fontWeight: 700, fontSize: 13 }}>
                  {rapidCount} {lang === "en" ? "added" : "ajoutés"}
                </div>
              )}
            </div>

            <div style={{ background: "rgba(79,70,229,0.08)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--text-muted)" }}>
              💡 {lang === "en" ? "Tip: Fill name, scan barcode, set prices, press Enter or click Add. Form resets automatically." : "Astuce: Remplissez le nom, scannez le code, entrez les prix, appuyez sur Entrée. Le formulaire se réinitialise automatiquement."}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Product name" : "Nom du produit"} *</label>
              <input ref={rapidNameRef} className="input" value={rapidItem.name} onChange={e => setRapidItem(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Tube, Huile palme..." autoFocus
                onKeyDown={e => { if (e.key === "Enter" && rapidItem.name && rapidItem.sell_price) rapidMutation.mutate(); }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="label">Barcode</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <BarcodeInput lang={lang} value={rapidItem.barcode} onChange={v => setRapidItem(p => ({ ...p, barcode: v }))} placeholder="Scan or type" />
                  </div>
                  <button type="button" onClick={() => setShowCameraRapid(true)}
                    style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
                    title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>📷</button>
                </div>
              </div>
              <div className="form-group">
                <label className="label">Unit</label>
                <select className="input" value={rapidItem.unit} onChange={e => setRapidItem(p => ({ ...p, unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {showCameraRapid && (
              <CameraScanner
                lang={lang}
                onScan={(code) => { setShowCameraRapid(false); setRapidItem(p => ({ ...p, barcode: code })); rapidNameRef.current?.focus(); }}
                onClose={() => setShowCameraRapid(false)}
              />
            )}

            <PricingSection data={rapidItem} onChange={(k, v) => setRapidItem(p => ({ ...p, [k]: v }))} lang={lang} />

            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>📦 Initial Stock</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label className="label">Location</label>
                  <select className="input" value={rapidItem.initial_location_id} onChange={e => setRapidItem(p => ({ ...p, initial_location_id: e.target.value }))}>
                    <option value="">Skip</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Quantity</label>
                  <input className="input" type="number" value={rapidItem.initial_quantity} onChange={e => setRapidItem(p => ({ ...p, initial_quantity: e.target.value }))} placeholder="0"
                    onKeyDown={e => { if (e.key === "Enter" && rapidItem.name && rapidItem.sell_price) rapidMutation.mutate(); }}
                    disabled={!rapidItem.initial_location_id} />
                </div>
                <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                  <label className="label">📍 Slot/Zone</label>
                  <input className="input" value={rapidItem.initial_slot || ""} onChange={e => setRapidItem(p => ({ ...p, initial_slot: e.target.value }))} placeholder="A-01, Rayon 2..." disabled={!rapidItem.initial_location_id} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowRapidEntry(false); setRapidCount(0); setRapidItem(EMPTY_PRODUCT); }}>
                {lang === "en" ? "Done" : "Terminer"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2, fontWeight: 700 }}
                disabled={!rapidItem.name || !rapidItem.sell_price || rapidMutation.isPending}
                onClick={() => rapidMutation.mutate()}>
                {rapidMutation.isPending ? "..." : (lang === "en" ? "✓ Add & Next →" : "✓ Ajouter & Suivant →")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: CSV IMPORT ── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" style={{ maxWidth: 680, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>📊 {lang === "en" ? "Import from CSV/Excel" : "Importer depuis CSV/Excel"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{lang === "en" ? "Best for initial setup with 50+ products. Download template, fill it, upload." : "Idéal pour la configuration initiale avec 50+ produits."}</div>

            {/* Step 1: Download template */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                <span style={{ background: "var(--brand)", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>1</span>
                {lang === "en" ? "Download the template" : "Télécharger le modèle"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                {lang === "en" ? "Fill in your products. Columns: name, barcode, unit, cost_price, sell_price, wholesale_price, min_price, qty, location" : "Remplissez vos produits. Colonnes: name, barcode, unit, cost_price, sell_price, wholesale_price, min_price, qty, location"}
              </div>
              <button className="btn btn-secondary" onClick={downloadTemplate}>
                ⬇️ {lang === "en" ? "Download CSV Template" : "Télécharger le modèle CSV"}
              </button>
            </div>

            {/* Step 2: Upload */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                <span style={{ background: "var(--brand)", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>2</span>
                {lang === "en" ? "Upload your filled file" : "Téléverser votre fichier rempli"}
              </div>
              <label style={{ display: "block", padding: "20px", border: "2px dashed var(--border)", borderRadius: 10, textAlign: "center", cursor: "pointer", color: "var(--text-muted)", fontSize: 13 }}>
                {importFile ? <span style={{ color: "#10b981", fontWeight: 600 }}>✓ {importFile.name}</span> : (lang === "en" ? "Click to select CSV file" : "Cliquer pour sélectionner le fichier CSV")}
                <input type="file" accept=".csv,.txt" onChange={handleFileUpload} style={{ display: "none" }} />
              </label>
              {importError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{importError}</div>}
            </div>

            {/* Step 3: Preview */}
            {importPreview.length > 0 && (
              <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                  <span style={{ background: "var(--brand)", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>3</span>
                  {lang === "en" ? `Preview — ${importPreview.length} products found` : `Aperçu — ${importPreview.length} produits trouvés`}
                </div>
                <div style={{ overflowX: "auto", maxHeight: 240, overflowY: "auto" }}>
                  <table className="table" style={{ fontSize: 11 }}>
                    <thead><tr>
                      <th>Name</th><th>Barcode</th><th>Unit</th>
                      <th>Cost</th><th>Walk-in</th><th>Wholesale</th><th>Min</th>
                      <th>Qty</th><th>Location</th>
                    </tr></thead>
                    <tbody>
                      {importPreview.slice(0, 20).map((row, i) => (
                        <tr key={i} style={{ background: !row.sell_price ? "rgba(239,68,68,0.05)" : "transparent" }}>
                          <td style={{ fontWeight: 500 }}>{row.name}</td>
                          <td style={{ fontFamily: "monospace" }}>{row.barcode || "—"}</td>
                          <td>{row.unit || "pce"}</td>
                          <td>{row.cost_price || "—"}</td>
                          <td style={{ color: row.sell_price ? "var(--brand-light)" : "#f87171", fontWeight: 600 }}>{row.sell_price || "⚠️ missing"}</td>
                          <td>{row.wholesale_price || "—"}</td>
                          <td>{row.min_price || "—"}</td>
                          <td>{row.initial_quantity || "—"}</td>
                          <td style={{ fontSize: 10 }}>{row.location_id ? locations.find(l => l.id === row.location_id)?.name : <span style={{ color: "#fbbf24" }}>not matched</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreview.length > 20 && <div style={{ textAlign: "center", padding: 8, fontSize: 12, color: "var(--text-muted)" }}>...and {importPreview.length - 20} more</div>}
                </div>
                {importPreview.some(r => !r.sell_price) && (
                  <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>⚠️ {lang === "en" ? "Rows highlighted in red are missing sell_price and will be skipped." : "Les lignes en rouge n'ont pas de sell_price et seront ignorées."}</div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowImport(false); setImportFile(null); setImportPreview([]); }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={importPreview.length === 0 || importMutation.isPending}
                onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? `⏳ ${lang === "en" ? "Importing..." : "Importation..."}` : (lang === "en" ? `✓ Import ${importPreview.filter(r => r.sell_price).length} Products` : `✓ Importer ${importPreview.filter(r => r.sell_price).length} produits`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── UPGRADE PROMPT ── */}
      {showUpgradePrompt && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 20, padding: 32, maxWidth: 380, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{lang === "en" ? "Upgrade Required" : "Mise à niveau requise"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              {lang === "en"
                ? "You've reached your plan limit. Upgrade to Gold or Premium to add more products, locations and users."
                : "Vous avez atteint la limite de votre plan. Passez à Gold ou Premium pour ajouter plus de produits, emplacements et utilisateurs."}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowUpgradePrompt(false)}
                style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
                {lang === "en" ? "Later" : "Plus tard"}
              </button>
              <button onClick={() => { setShowUpgradePrompt(false); window.location.href = "/settings"; }}
                className="btn btn-primary" style={{ flex: 2 }}>
                ⬆️ {lang === "en" ? "Upgrade now" : "Améliorer maintenant"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADJUST MODAL ── */}
      {showAdjust && selectedStockRow && (
        <AdjustModal product={selectedStockRow} lang={lang}
          onClose={() => { setShowAdjust(false); setSelectedStockRow(null); }}
          onSuccess={() => { setShowAdjust(false); setSelectedStockRow(null); invalidateAll(); }} />
      )}

      {/* Sprint A: inventory-cap paywall */}
      {paywall && <PaywallModal feature={paywall.feature} currentPlan={effectivePlan} mpId={paywall.mpId} onClose={() => setPaywall(null)} />}

      {/* Sprint C: photo backfill modal — grid of photoless products
          with a per-row 📷 upload button. */}
      {showBackfill && (() => {
        const list = products.filter(p => !p.photo_url && !p.image_url);
        const done = products.length - list.length - products.filter(p => !p.photo_url && !p.image_url && p.is_active === false).length;
        return (
          <div className="modal-overlay" onClick={() => setShowBackfill(false)}>
            <div className="modal" style={{ maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>📷 {lang === "en" ? "Add photos to your products" : "Ajouter des photos"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {lang === "en" ? `${list.length} products without photos.` : `${list.length} produits sans photo.`}
                  </div>
                </div>
                <button onClick={() => setShowBackfill(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>✕</button>
              </div>
              {list.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  ✓ {lang === "en" ? "All products have photos." : "Tous les produits ont une photo."}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {list.map(p => (
                    <div key={p.id} style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.sku || p.barcode || "—"}</div>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--bg-card)", cursor: backfillUploading === p.id ? "wait" : "pointer", fontSize: 12, fontWeight: 600, opacity: backfillUploading === p.id ? 0.6 : 1 }}>
                        {backfillUploading === p.id ? "⏳ Uploading…" : "📷 Add photo"}
                        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" style={{ display: "none" }}
                          disabled={backfillUploading === p.id}
                          onChange={async (e) => {
                            const f = e.target.files && e.target.files[0]; if (!f) return;
                            try {
                              setBackfillUploading(p.id);
                              const dataUrl = await readPhotoToDataUrl(f, lang);
                              if (!dataUrl) return;
                              await api.post(`/products/${p.id}/photo`, { data_url: dataUrl });
                              toast.success(lang === "en" ? "✓ Photo uploaded" : "✓ Photo ajoutée");
                              invalidateAll();
                            } catch (err) { toast.error(err.message || "Upload failed"); }
                            finally { setBackfillUploading(null); }
                          }} />
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── SHARED PRICING SECTION COMPONENT ─────────────────────────────────────────
function PricingSection({ data, onChange, lang }) {
  return (
    <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
        💰 {lang === "en" ? "Pricing" : "Tarification"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group">
          <label className="label">{lang === "en" ? "Cost price (FCFA)" : "Prix achat (FCFA)"}</label>
          <input className="input" type="number" value={data.cost_price || ""} onChange={e => onChange("cost_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "var(--brand-light)" }}>{lang === "en" ? "Walk-in price (FCFA) *" : "Prix détail (FCFA) *"}</label>
          <input className="input" type="number" value={data.sell_price || ""} onChange={e => onChange("sell_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "#fbbf24" }}>{lang === "en" ? "Wholesale price (FCFA)" : "Prix gros (FCFA)"}</label>
          <input className="input" type="number" value={data.wholesale_price || ""} onChange={e => onChange("wholesale_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "#f87171" }}>{lang === "en" ? "Min price floor (FCFA)" : "Prix minimum (FCFA)"}</label>
          <input className="input" type="number" value={data.min_price || ""} onChange={e => onChange("min_price", e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        🔒 {lang === "en" ? "Min floor: staff cannot sell below this price. Owner PIN to override." : "Prix min: le personnel ne peut pas vendre en dessous. PIN propriétaire pour forcer."}
      </div>
    </div>
  );
}

// ── RECEIVE ITEM ROW COMPONENT ────────────────────────────────────────────────
function ReceiveItemRow({ idx, item, products, lang, onSelect, onChange, onRemove, canSeePrices }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showCam, setShowCam] = useState(false);

  function fuzzyMatch(str, pattern) {
    if (!str || !pattern) return false;
    const s = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const p = pattern.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.includes(p);
  }

  const filtered = search.length >= 1
    ? products.filter(p => fuzzyMatch(p.name, search) || (p.barcode && p.barcode.includes(search))).slice(0, 6)
    : [];

  const pickProduct = (p) => {
    setSelected(p);
    setSearch("");
    onSelect(p);
  };

  const clearProduct = () => {
    setSelected(null);
    setSearch("");
    onChange("product_id", "");
    onChange("product_name", "");
    onChange("cost_price", "");
    onChange("sell_price", "");
    onChange("wholesale_price", "");
    onChange("min_price", "");
  };

  return (
    <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 14, marginBottom: 12, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>
          {lang === "en" ? `Item ${idx + 1}` : `Article ${idx + 1}`}
        </span>
        {onRemove && <button onClick={onRemove} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12 }}>✕ Remove</button>}
      </div>

      {selected ? (
        <div>
          {/* Selected product */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(79,70,229,0.12)", border: "1px solid var(--brand)", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.name}</div>
              {selected.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{selected.barcode}</div>}
            </div>
            <button onClick={clearProduct} style={{ background: "rgba(239,68,68,0.15)", border: "none", color: "#f87171", cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>
              ✕ Clear
            </button>
          </div>

          {/* Quantity */}
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="label">{lang === "en" ? "Quantity received *" : "Quantité reçue *"}</label>
            <input className="input" type="number" value={item.quantity} onChange={e => onChange("quantity", e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="label">📍 {lang === "en" ? "Slot/Zone (optional)" : "Emplacement (opt.)"}</label>
            <input className="input" value={item.slot_code || ""} onChange={e => onChange("slot_code", e.target.value)} placeholder="A-01, Shelf 2..." />
          </div>

          {/* Pricing section */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
              💰 {lang === "en" ? "Update prices — leave blank to keep current" : "Mettre à jour les prix — laisser vide pour garder"}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12 }}>
              <span>Cost: <strong>{Number(selected.cost_price || 0).toLocaleString()} F</strong></span>
              <span style={{ color: "var(--brand-light)" }}>Walk-in: <strong>{Number(selected.sell_price || 0).toLocaleString()} F</strong></span>
              <span style={{ color: "#fbbf24" }}>Wholesale: <strong>{Number(selected.wholesale_price || 0).toLocaleString()} F</strong></span>
              <span style={{ color: "#f87171" }}>Min: <strong>{Number(selected.min_price || 0).toLocaleString()} F</strong></span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              <div className="form-group">
                <label className="label" style={{ fontSize: 10 }}>New Cost</label>
                <input className="input" type="number" value={item.cost_price} onChange={e => onChange("cost_price", e.target.value)} placeholder={selected.cost_price || "0"} />
              </div>
              <div className="form-group">
                <label className="label" style={{ fontSize: 10, color: "var(--brand-light)" }}>New Walk-in</label>
                <input className="input" type="number" value={item.sell_price} onChange={e => onChange("sell_price", e.target.value)} placeholder={selected.sell_price || "0"} />
              </div>
              <div className="form-group">
                <label className="label" style={{ fontSize: 10, color: "#fbbf24" }}>New Wholesale</label>
                <input className="input" type="number" value={item.wholesale_price} onChange={e => onChange("wholesale_price", e.target.value)} placeholder={selected.wholesale_price || "0"} />
              </div>
              <div className="form-group">
                <label className="label" style={{ fontSize: 10, color: "#f87171" }}>New Min floor</label>
                <input className="input" type="number" value={item.min_price} onChange={e => onChange("min_price", e.target.value)} placeholder={selected.min_price || "0"} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {/* Search input */}
          <div className="form-group" style={{ marginBottom: filtered.length > 0 ? 8 : 0 }}>
            <label className="label">{lang === "en" ? "Product *" : "Produit *"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <BarcodeInput
                  lang={lang}
                  value={search}
                  onChange={v => {
                    setSearch(v);
                    // Auto-pick if barcode matches exactly
                    const match = products.find(p => p.barcode && p.barcode === v.trim());
                    if (match) pickProduct(match);
                  }}
                  placeholder={lang === "en" ? "Type to search or scan barcode..." : "Tapez pour chercher ou scannez..."}
                  autoFocus={idx === 0}
                />
              </div>
              <button type="button" onClick={() => setShowCam(true)}
                style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
                title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>📷</button>
            </div>
          </div>
          {showCam && (
            <CameraScanner
              lang={lang}
              onScan={(code) => {
                setShowCam(false);
                setSearch(code);
                // Same auto-pick path as the typed-input branch above
                const match = products.find(p => p.barcode && p.barcode === code.trim());
                if (match) pickProduct(match);
              }}
              onClose={() => setShowCam(false)}
            />
          )}
          {/* Results shown INLINE — no dropdown, no blur issues */}
          {filtered.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
              {filtered.map((p, i) => (
                <button key={p.id} onClick={() => pickProduct(p)}
                  style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(79,70,229,0.08)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{p.name}</div>
                    {p.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.barcode}</div>}
                  </div>
                  {canSeePrices && <div style={{ fontSize: 12, color: "var(--brand-light)", fontWeight: 700 }}>{Number(p.sell_price || 0).toLocaleString()} F</div>}
                </button>
              ))}
            </div>
          )}
          {search.length > 1 && filtered.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 12px", background: "var(--bg-card)", borderRadius: 8, marginBottom: 8 }}>
              {lang === "en" ? `No product found for "${search}". Use + Add Product for new items.` : `Aucun produit pour "${search}". Utilisez + Ajouter produit.`}
            </div>
          )}
          {/* Quantity disabled until product picked */}
          <div className="form-group">
            <label className="label">{lang === "en" ? "Quantity received *" : "Quantité reçue *"}</label>
            <input className="input" type="number" value={item.quantity} onChange={e => onChange("quantity", e.target.value)} placeholder={lang === "en" ? "Select a product first" : "Choisissez un produit d'abord"} disabled />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ADJUST MODAL ──────────────────────────────────────────────────────────────
function AdjustModal({ product, lang, onClose, onSuccess }) {
  const [qty, setQty] = useState(product.quantity);
  const [minQty, setMinQty] = useState(product.min_quantity || 5);
  const [alertEnabled, setAlertEnabled] = useState(product.alert_enabled !== false);
  const [isActive, setIsActive] = useState(product.pa_products?.is_active !== false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.patch("/stock/adjust", { product_id: product.product_id, location_id: product.location_id, new_quantity: +qty, min_quantity: +minQty, alert_enabled: alertEnabled, reason });
      // Update product active status
      await api.patch("/products/" + product.product_id, { is_active: isActive });
      toast.success(lang === "en" ? "✓ Stock adjusted!" : "✓ Stock ajusté!");
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{lang === "en" ? "Adjust Stock" : "Ajuster le stock"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>{product.pa_products?.name} — {product.pa_locations?.name}</div>
        <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Current</span>
          <strong>{product.quantity} {product.pa_products?.unit}</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="label">{lang === "en" ? "New quantity" : "Nouvelle quantité"}</label>
            <input className="input" type="number" value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label" style={{ color: "#fbbf24" }}>⚠️ {lang === "en" ? "Low stock alert at" : "Alerte stock bas à"}</label>
            <input className="input" type="number" value={minQty} onChange={e => setMinQty(e.target.value)} placeholder="5" />
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
              {lang === "en" ? "Alert when below this number" : "Alerte quand en dessous de ce nombre"}
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="label">{lang === "en" ? "Reason" : "Raison"}</label>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={lang === "en" ? "e.g. Stock count, damaged..." : "Ex: Inventaire, endommagé..."} />
        </div>

        {/* Alert & Active toggles */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 4 }}>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>⚠️ {lang === "en" ? "Low stock alert" : "Alerte stock bas"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Get notified when stock is low" : "Recevoir une alerte quand le stock est bas"}</div>
            </div>
            <input type="checkbox" checked={alertEnabled} onChange={e => setAlertEnabled(e.target.checked)} style={{ width: 18, height: 18, cursor: "pointer" }} />
          </label>
          <div style={{ borderTop: "1px solid var(--border)" }} />
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>🛒 {lang === "en" ? "Available for sale" : "Disponible à la vente"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Uncheck to pause/discontinue this product" : "Décocher pour mettre en pause ce produit"}</div>
            </div>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ width: 18, height: 18, cursor: "pointer" }} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{lang === "en" ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={loading} onClick={handleSubmit}>{loading ? "..." : (lang === "en" ? "✓ Save" : "✓ Enregistrer")}</button>
        </div>
      </div>
    </div>
  );
}
