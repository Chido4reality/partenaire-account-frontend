// v20260509_0045 - slot + last_moved_by + global_search
import BarcodeInput from "../components/common/BarcodeInput";
import CameraScanner from "../components/common/CameraScanner";
import ProductSearchBox from "../components/common/ProductSearchBox";
import ClearButton from "../components/common/ClearButton";
import { unitLabel } from "../utils/units";
import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api from "../utils/api";
import { isPendingApproval, keepWorkingToast } from "../utils/approval";
import { useCurrency } from "../utils/useCurrency";
import OwnerPIN from "../components/common/OwnerPIN";
import PhotoUploadButtons from "../components/common/PhotoUploadButtons";
import PaywallModal from "../components/common/PaywallModal";
import useOwnerApproval from "../hooks/useOwnerApproval";
import RestrictedAction from "../components/common/RestrictedAction";
import DoziePublishModal from "../components/common/DoziePublishModal";
import { getCapabilities, isAtCap } from "../utils/planCapabilities";
import { useLiteMode } from "../hooks/useLiteMode";
import { parseProductImport, buildProductTemplateXlsx } from "../utils/productImport";

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
  const en = lang === "en";
  const { selectedLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  // MP-LITE-MODE-PHASE-1: skip dozie-listings + dozie-migrate-candidates,
  // hide Sell-on-Dozie controls in Lite. Multi-location stock display +
  // simple Receive Goods flow stay (per directive amendment).
  const lite = useLiteMode();

  const role = user?.role || "cashier";
  const isOwner = role === "owner";
  const isManager = role === "manager";
  const isWarehouse = role === "warehouse";
  const isCashier = role === "cashier";
  // MP-OWNER-PIN-APPROVAL (Wave 2): owner PIN needed before manager
  // confirms a product price change (via the edit modal) or a manual
  // stock adjustment. Hook self-manages modal state.
  const { requestApproval, modal: approvalModal } = useOwnerApproval();
  const fmt = useCurrency();

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
  // MP-STOCK-LOCATION-FILTER: in-tab Location filter for the Stock Levels
  // table. The top-bar selectedLocation drives POS/shift context (what
  // till the cashier is ringing on); reusing it as the inventory-view
  // filter was a category mismatch — a new user with no top-bar
  // selection sees "all locations" → 1 product × 2 default locations
  // shows as 2 rows and reads as duplicates.
  //
  // "" = All locations (rendered as such in the dropdown). Defaulted
  // to selectedLocation.id when set, else the first location's id
  // once locations finish loading (see useEffect below). Scoped to
  // this component — switching tabs preserves it; full page nav resets.
  const [locStockFilter, setLocStockFilter] = useState("");
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
  // MP-DOZIE-INVENTORY-PUBLISH-UI: per-product publish/edit modal.
  const [doziePublishCtx, setDoziePublishCtx] = useState(null); // { productId, productName, defaultPrice, totalStock }
  const [showArchived, setShowArchived] = useState(false); // ARCHIVE-RESTORE-UI: Products-tab toggle
  const [showRapidEntry, setShowRapidEntry] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);   // Sprint C — photo backfill modal
  const [backfillUploading, setBackfillUploading] = useState(null); // id of product currently uploading
  // FU.4 — migrate-duplicates modal state + candidates query.
  // Runs on every Inventory mount so the banner appears immediately
  // when there's something to migrate. Cached for 5 min to avoid
  // re-fetching on tab switches; refetches after a successful Apply.
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrateData, setMigrateData] = useState({ seller: null, pairs: [] });
  const [migrateSel, setMigrateSel] = useState({});         // ptn_id → { selected, dozie_price, hard_delete }
  const [migrateApplying, setMigrateApplying] = useState(false);
  const { data: migrateCandidatesData } = useOfflineCachedQuery({
    queryKey: ["dozie-migrate-candidates"],
    queryFn: () => api.get("/dozie/migrate-duplicates/candidates").then(r => r.data),
    // MP-LITE-MODE-PHASE-1: Dozie migration banner is a Pro nudge.
    enabled: !lite && isOwner,
    staleTime: 300000,
    retry: 1
  });
  const migrateCandidates = migrateCandidatesData?.data || null;
  const [showPIN, setShowPIN] = useState(false);
  const [pinAction, setPinAction] = useState(null);

  const [selectedStockRow, setSelectedStockRow] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  // MP-INVENTORY-DOZIE-CONTROLS — edit-modal Sell-on-Dozie state.
  const [dozieEnabled, setDozieEnabled] = useState(false);
  const [doziePrice, setDoziePrice] = useState(0);
  const [dozieSaving, setDozieSaving] = useState(false);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT);
  // MP-PRODUCT-DEDUP: existing product found by barcode/name when adding, so the
  // Add modal can offer to open/edit it instead of creating a duplicate.
  const [dupeProduct, setDupeProduct] = useState(null);

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
  const [importParsing, setImportParsing] = useState(false);
  const [importResults, setImportResults] = useState(null); // per-row outcome after Import

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
  const { data: stockData, isLoading: stockLoading } = useOfflineCachedQuery({
    queryKey: ["stock", locStockFilter, search],
    queryFn: () => {
      // MP-STOCK-LOCATION-FILTER: drive by the in-tab Location dropdown
      // (locStockFilter), not the top-bar selectedLocation. Empty string
      // = "All locations" and sends no location_id param. When searching,
      // search across ALL locations regardless of the dropdown — matches
      // the placeholder "Search all locations…" and lets the cashier
      // find a product without first guessing where it lives.
      const params = new URLSearchParams();
      if (locStockFilter && !search) params.append("location_id", locStockFilter);
      if (search) params.append("search", search);
      return api.get("/stock?" + params.toString()).then(r => r.data);
    },
    refetchInterval: 30000
  });

  const { data: alertData } = useOfflineCachedQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => api.get("/stock?low_only=true").then(r => r.data),
    refetchInterval: 60000
  });

  const { data: productsData } = useOfflineCachedQuery({
    queryKey: ["products-all", showArchived],
    queryFn: () => api.get("/products?limit=500" + (showArchived ? "&include_archived=true" : "")).then(r => r.data),
  });

  const { data: locationsData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: allStockData } = useOfflineCachedQuery({
    queryKey: ["stock-all"],
    queryFn: () => api.get("/stock").then(r => r.data),
    enabled: tab === "overview"
  });

  const stock = stockData?.data || [];
  const alerts = alertData?.data || [];
  const products = productsData?.data || [];
  const locations = locationsData?.data || [];
  const allStock = allStockData?.data || [];

  // MP-STOCK-LOCATION-FILTER: pick a sane default for the in-tab Location
  // dropdown once we know what locations exist. Prefer the top-bar
  // selectedLocation (matches the cashier's POS/shift context), fall
  // back to the first location, leave "All locations" only when the
  // user has explicitly chosen it (locStockFilter !== "" sticks). Runs
  // once on locations-arrive, then again if the cashier later changes
  // their top-bar selection from null → something — without overriding
  // their explicit in-tab choice.
  const locFilterTouchedRef = useRef(false);
  useEffect(() => {
    if (locFilterTouchedRef.current) return;
    if (!locations.length) return;
    const next = selectedLocation?.id || locations[0]?.id || "";
    setLocStockFilter(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations.length, selectedLocation?.id]);
  const setLocFilterByUser = (v) => { locFilterTouchedRef.current = true; setLocStockFilter(v); };

  // MP-INITIAL-STOCK-DEFAULT-LOCATION: Paint-at-qty-0 fix. The Add
  // Product and Rapid Entry forms have an "Initial Stock (optional)"
  // panel whose Location dropdown defaulted to "Skip (add later)" —
  // and the Quantity input is disabled until a location is picked. New
  // users would fill in name + price and submit without realising the
  // initial-quantity flow needed a location, so /stock/arrivals was
  // never posted and the auto-stock zero-rows are what showed up in
  // Inventory. Pre-select the most-likely-intended location (top-bar
  // selectedLocation, else first location) so the Quantity field is
  // enabled by default and entering a number actually applies. Users
  // who deliberately want to add later can still switch to "Skip".
  const defaultInitialLocId = selectedLocation?.id || locations[0]?.id || "";
  // Add Product modal: seed when it opens, unless the user has already
  // picked something (in which case respect their choice).
  useEffect(() => {
    if (!showAddProduct) return;
    if (newProduct.initial_location_id) return;
    if (!defaultInitialLocId) return;
    setNewProduct(p => ({ ...p, initial_location_id: defaultInitialLocId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddProduct, defaultInitialLocId]);
  // MP-PRODUCT-DEDUP: clear any stale duplicate notice when the Add modal opens.
  useEffect(() => { if (showAddProduct) setDupeProduct(null); }, [showAddProduct]);
  // Rapid Entry modal: same logic. The existing flow at rapidMutation
  // onSuccess preserves initial_location_id across batch submits, so
  // this useEffect only matters for the first product of a session.
  useEffect(() => {
    if (!showRapidEntry) return;
    if (rapidItem.initial_location_id) return;
    if (!defaultInitialLocId) return;
    setRapidItem(p => ({ ...p, initial_location_id: defaultInitialLocId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRapidEntry, defaultInitialLocId]);

  // MP-DOZIE-INVENTORY-PUBLISH-UI: org's Dozie listings, indexed by
  // product_id so the inventory row can render the publish button's
  // state (none / live / paused) in one lookup. allStock above is
  // location-scoped to the selected location; for total-stock-by-
  // product we sum across allStock when on "overview", or just use
  // the current stock list otherwise — out-of-stock surfacing on the
  // publish modal is best-effort and the modal also shows the warning.
  const { data: dozieListingsData } = useOfflineCachedQuery({
    queryKey: ["dozie-listings"],
    queryFn:  () => api.get("/dozie-listings").then(r => r.data?.data || []),
    // MP-LITE-MODE-PHASE-1: Sell-on-Dozie controls hidden; skip fetch.
    enabled:  !lite && (isOwner || (user?.role === "manager")),
    staleTime: 30000,
  });
  // Defense-in-depth: queryFn returns an array, but the offline-cache
  // path could in theory hand back a non-array if cache shape ever
  // drifts again. Array.isArray gates .map() against future regressions.
  const dozieListings = Array.isArray(dozieListingsData) ? dozieListingsData : [];
  const dozieListingByProductId = new Map(
    dozieListings.map(l => [l.product_id, l]));
  const stockByProductId = (() => {
    const map = new Map();
    for (const s of stock) {
      map.set(s.product_id, (map.get(s.product_id) || 0) + (Number(s.quantity) || 0));
    }
    return map;
  })();

  // Backend handles search globally, just use data as-is
  const filtered = stock;
  const filteredProducts = search ? products.filter(p => fuzzyMatch(p.name, search) || (p.barcode && p.barcode.includes(search))) : products;

  const totalStockValue = isOwner ? stock.reduce((sum, s) => sum + (+s.quantity * +(s.pa_products?.cost_price || 0)), 0) : 0;

  const invalidateAll = () => {
    qc.invalidateQueries(["stock"]);
    qc.invalidateQueries(["stock-all"]);
    qc.invalidateQueries(["products-all"]);
    qc.invalidateQueries(["stock-alerts"]);
    qc.invalidateQueries(["dozie-migrate-candidates"]); // FU.4 — banner re-evaluates after Apply
  };

  // MP-PHASE-4 BUG-Y — optimistic UI seed for offline product create.
  // Mirrors Wave 1/2 pattern from POSPage. When POST /products returns
  // the offline adapter's 202, the cashier expects to see the product
  // immediately in Inventory / Products / POS — but the broad
  // invalidateAll above triggers a refetch that catch-falls-back to
  // the pre-create cached array, so the new product is invisible until
  // sync.
  //
  // Seeds:
  //   ["products-all", showArchived]  — prepend synthetic pa_products row
  //   ["products-barcode"]            — same shape (when barcode is set)
  //   ["pos-products", locId]         — POS list with nested stock object
  //   ["stock", locId, search] +
  //     ["stock-all"]                 — ONLY when initial_quantity > 0;
  //                                     otherwise the auto-stock zero
  //                                     rows already render on reconnect
  //                                     and a synthetic row would just
  //                                     duplicate them visually.
  //                                     (review-claude greenlight note)
  //
  // Bug X (companion commit) guarantees the offline-stamped id matches
  // the eventual server-side id, so the synthetic rows reconcile cleanly
  // against the real rows when the [sync] emit invalidate fires on
  // reconnect.
  const seedAfterOfflineProductCreate = ({ product, initialLocationId, initialQuantity, initialSlot }) => {
    if (!product?.id) return;
    const nowIso = new Date().toISOString();
    // Synthetic pa_products row — fields every consumer reads.
    const synthProduct = {
      id:             product.id,
      org_id:         null,
      name:           product.name,
      name_en:        product.name_en || null,
      barcode:        product.barcode || null,
      sku:            product.sku || null,
      category_id:    product.category_id || null,
      description:    product.description || null,
      unit:           product.unit || "pce",
      cost_price:     Number(product.cost_price) || 0,
      sell_price:     Number(product.sell_price) || 0,
      wholesale_price: Number(product.wholesale_price) || 0,
      min_price:      Number(product.min_price) || 0,
      is_active:      true,
      photo_url:      null,
      image_url:      null,
      created_at:     nowIso,
      updated_at:     nowIso,
      offline_queued: true,
    };
    // ["products-all", showArchived] — list slot, prepend.
    qc.setQueriesData(
      { predicate: (q) => q.queryKey?.[0] === "products-all" },
      (old) => {
        if (!old) return old;
        const arr = Array.isArray(old) ? old : (old.data || []);
        const next = [synthProduct, ...arr];
        return Array.isArray(old) ? next : { ...old, data: next };
      }
    );
    // ["products-barcode"] — same shape (BarcodePage consumer).
    if (product.barcode) {
      qc.setQueriesData(
        { predicate: (q) => q.queryKey?.[0] === "products-barcode" },
        (old) => {
          if (!old) return old;
          const arr = Array.isArray(old) ? old : (old.data || []);
          const next = [synthProduct, ...arr];
          return Array.isArray(old) ? next : { ...old, data: next };
        }
      );
    }
    // ["pos-products", locId] — nested stock object. Always seed (with
    // qty=0 when no initial arrival) so the POS search returns the
    // product immediately. The auto-stock backend creates zero pa_stock
    // rows per location regardless, so this matches the eventual truth.
    const stockObj = {
      quantity:      Number(initialQuantity) || 0,
      min_quantity:  5,
      alert_enabled: true,
    };
    qc.setQueriesData(
      { predicate: (q) => q.queryKey?.[0] === "pos-products" },
      (old) => {
        if (!old) return old;
        const arr = Array.isArray(old) ? old : (old.data || []);
        const next = [{ ...synthProduct, stock: stockObj }, ...arr];
        return Array.isArray(old) ? next : { ...old, data: next };
      }
    );
    // ["stock", locId, search] + ["stock-all"] — synthetic stock row
    // ONLY when initialQuantity > 0. Skipping when qty=0 avoids visually
    // duplicating the auto-stock zero rows that appear on reconnect.
    const qty = Number(initialQuantity) || 0;
    if (qty > 0 && initialLocationId) {
      const synthStock = {
        // id is synthetic — pa_stock has its own UUID generated by the
        // trigger; on reconnect the real row replaces this via the
        // Layout sync-event invalidate path.
        id:                   "offline_" + product.id + "_" + initialLocationId,
        org_id:               null,
        product_id:           product.id,
        location_id:          initialLocationId,
        quantity:             qty,
        min_quantity:         5,
        alert_enabled:        true,
        slot_code:            initialSlot || null,
        last_moved_by_name:   user?.full_name || null,
        last_moved_at:        nowIso,
        last_movement_type:   "receive",
        updated_at:           nowIso,
        pa_products: {
          name:            synthProduct.name,
          name_en:         synthProduct.name_en,
          unit:            synthProduct.unit,
          barcode:         synthProduct.barcode,
          sell_price:      synthProduct.sell_price,
          cost_price:      synthProduct.cost_price,
          min_price:       synthProduct.min_price,
          wholesale_price: synthProduct.wholesale_price,
        },
        pa_locations: {
          name: (locations.find(l => l.id === initialLocationId)?.name) || null,
          type: null,
        },
        offline_queued: true,
      };
      qc.setQueriesData(
        { predicate: (q) => {
          const k = q.queryKey?.[0];
          return k === "stock" || k === "stock-all";
        }},
        (old) => {
          if (!old) return old;
          const arr = Array.isArray(old) ? old : (old.data || []);
          const next = [synthStock, ...arr];
          return Array.isArray(old) ? next : { ...old, data: next };
        }
      );
    }
  };
  // Bug Y companion: when invalidateAll runs after an offline product
  // create, skip the keys seedAfterOfflineProductCreate just authored
  // — otherwise the queryFn refetch + offline-cache catch-fallback
  // returns the pre-create array and clobbers the seed. Mirrors Wave
  // 2's invalidate predicate.
  const invalidateAllSkippingOfflineSeed = () => {
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey && q.queryKey[0];
        if (typeof k !== "string") return false;
        // Skip seeded keys
        if (k === "products-all" || k === "products-barcode" ||
            k === "pos-products" || k === "stock" || k === "stock-all") {
          return false;
        }
        return k === "stock-alerts" || k === "dozie-migrate-candidates";
      }
    });
  };

  // ── ADD PRODUCT MUTATION ────────────────────────────────────────────────────
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  // Sprint A: paywall state when an inventory cap action is blocked.
  const [paywall, setPaywall] = useState(null);
  // Sprint A: pull effective plan + capabilities. We already have the
  // legacy /my-plan query cached by Layout — re-using the same key
  // skips an extra round-trip on page load.
  const { data: planData } = useOfflineCachedQuery({
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
      // Bug Y: pass offline_queued marker + the formData snapshot
      // through so onSuccess can seed without re-reading state that
      // setNewProduct(EMPTY_PRODUCT) will have already cleared.
      return {
        ...res.data,
        _offlineSnapshot: {
          offlineQueued:      !!res.data?.offline_queued,
          product,
          initialLocationId:  newProduct.initial_location_id,
          initialQuantity:    newProduct.initial_quantity,
          initialSlot:        newProduct.initial_slot,
        },
      };
    },
    onSuccess: (data) => {
      toast.success(lang === "en" ? "✓ Product added!" : "✓ Produit ajouté!");
      setShowAddProduct(false);
      setNewProduct(EMPTY_PRODUCT);
      const snap = data?._offlineSnapshot;
      if (snap?.offlineQueued) {
        seedAfterOfflineProductCreate({
          product:            snap.product,
          initialLocationId:  snap.initialLocationId,
          initialQuantity:    snap.initialQuantity,
          initialSlot:        snap.initialSlot,
        });
        invalidateAllSkippingOfflineSeed();
      } else {
        invalidateAll();
      }
    },
    onError: (err) => {
      // MP-PRODUCT-DEDUP: backend rejected an identical product — surface the
      // existing one in the modal with an open/edit offer.
      if (err.response?.status === 409 && err.response?.data?.code === "PRODUCT_EXISTS") {
        setDupeProduct(err.response.data.existing || null);
        return;
      }
      toast.error(err.response?.data?.message || "Error");
    }
  });

  // MP-PRODUCT-DEDUP: client-side pre-check (barcode-first, else normalized
  // name) against the loaded list for instant feedback; the backend 409 above
  // is the authoritative guard (covers list>500 / offline replay / race).
  // PRICE LADDER (client mirror of the backend guard): enforce
  // cost_price <= min_price <= wholesale_price <= sell_price, comparing only
  // present (>0) values. Returns a localized message naming the out-of-order
  // value, or null. This is what blocks "wholesale below min" (Nora's entry).
  const priceLadderError = (form) => {
    const steps = [
      { v: +form.cost_price || 0,      en: "Cost price",      fr: "Prix d'achat" },
      { v: +form.min_price || 0,       en: "Min price",       fr: "Prix minimum" },
      { v: +form.wholesale_price || 0, en: "Wholesale price", fr: "Prix de gros" },
      { v: +form.sell_price || 0,      en: "Sell price",      fr: "Prix de vente" },
    ].filter(s => s.v > 0);
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].v < steps[i - 1].v) {
        const lo = steps[i], hi = steps[i - 1];
        return lang === "en"
          ? `${lo.en} (${lo.v.toLocaleString()} ${fmt.symbol}) can't be below ${hi.en} (${hi.v.toLocaleString()} ${fmt.symbol}).`
          : `${lo.fr} (${lo.v.toLocaleString()} ${fmt.symbol}) ne peut pas être inférieur au ${hi.fr} (${hi.v.toLocaleString()} ${fmt.symbol}).`;
      }
    }
    return null;
  };

  const handleAddProduct = () => {
    setDupeProduct(null);
    const ladderErr = priceLadderError(newProduct);
    if (ladderErr) { toast.error(ladderErr); return; }
    const bc = (newProduct.barcode || "").trim();
    let local = null;
    if (bc) {
      local = products.find(p => (p.barcode || "").trim() === bc);
    } else {
      const wn = (newProduct.name || "").trim().toLowerCase();
      local = products.find(p => (p.name || "").trim().toLowerCase() === wn);
    }
    if (local) { setDupeProduct({ id: local.id, name: local.name, barcode: local.barcode }); return; }
    addProductMutation.mutate();
  };
  // Open the existing product for edit/restock (full row from the loaded list).
  const openExistingProduct = (m) => {
    setDupeProduct(null);
    setShowAddProduct(false);
    const full = products.find(p => p.id === m.id) || m;
    setEditProduct({ ...full });
    setShowEditProduct(true);
  };

  // ── EDIT PRODUCT MUTATION ───────────────────────────────────────────────────
  // MP-OWNER-PIN-APPROVAL (Wave 2): manager-initiated edits via this
  // modal must surface owner/manager approval when sell_price or
  // wholesale_price actually change. The backend keys off the
  // X-Edit-Source: product-edit header so the receive-goods flow
  // (which also patches prices but as a bulk batch) is exempt.
  const editProductMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: editProduct.name,
        barcode: editProduct.barcode || null,
        unit: editProduct.unit,
        cost_price: +editProduct.cost_price || 0,
        sell_price: +editProduct.sell_price,
        wholesale_price: +editProduct.wholesale_price || 0,
        min_price: +editProduct.min_price || 0,
      };
      const headers = { "X-Edit-Source": "product-edit" };
      // Owner direct. Non-owner (manager today; cashier never reaches
      // this modal — page-level gate at L84) always requests approval;
      // the backend re-reads stored values and only consumes the token
      // when a price actually changed, so a manager who opened the
      // modal to fix a typo and didn't touch prices will see the PIN
      // prompt but the token simply goes unused.
      if (!isOwner) {
        const newSell = +editProduct.sell_price || 0;
        const newWS   = +editProduct.wholesale_price || 0;
        const { token } = await requestApproval({
          actionType:  "edit_product_price",
          targetTable: "pa_products",
          targetId:    editProduct.id,
          context: {
            sell_price_new: newSell,
            wholesale_price_new: newWS,
          },
          description: lang === "fr"
            ? `Modifier le produit « ${editProduct.name} »`
            : `Edit product "${editProduct.name}"`,
        });
        headers["Approval-Token"] = token;
      }
      return api.patch(`/products/${editProduct.id}`, body, { headers });
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product updated!" : "✓ Produit mis à jour!");
      setShowEditProduct(false); setEditProduct(null);
      invalidateAll();
    },
    onError: (err) => {
      // MP-OWNER-PIN-APPROVAL: silent when user closed PIN modal.
      if (err?.code === "cancelled") return;
      toast.error(err.response?.data?.message || "Error");
    }
  });

  // STOCK-UX-PASS Part B — archive (soft-remove) a wrong-input product.
  // Reuses the existing PATCH /products/:id (is_active is in the backend
  // allow-list, owner/manager + org-scoped). is_active=false → the
  // product drops out of every list endpoint (they filter is_active=true)
  // and is recoverable later via DB if needed. Not a hard delete.
  const archiveProductMutation = useMutation({
    mutationFn: () => api.patch(`/products/${editProduct.id}`, { is_active: false }),
    onSuccess: () => {
      toast.success(lang === "en" ? "🗄 Product archived" : "🗄 Produit archivé");
      setShowEditProduct(false); setEditProduct(null);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ARCHIVE-RESTORE-UI — un-archive (is_active=true) from the edit modal.
  const restoreProductMutation = useMutation({
    mutationFn: () => api.patch(`/products/${editProduct.id}`, { is_active: true }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Product restored" : "✓ Produit restauré");
      setShowEditProduct(false); setEditProduct(null);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // MP-INVENTORY-DOZIE-CONTROLS — when the edit modal opens, read back the
  // product's current Dozie listing so the toggle/price reflect reality.
  // Defaults: disabled, price = product's MP sell price. A 403 (no
  // dozie_access plan) is swallowed here — the global axios interceptor
  // already pops the paywall; the section just stays in its default state.
  useEffect(() => {
    if (!showEditProduct || !editProduct?.id) return;
    let cancelled = false;
    setDozieEnabled(false);
    setDoziePrice(Number(editProduct.sell_price) || 0);
    api.get(`/products/${editProduct.id}/dozie-listing`)
      .then(r => {
        if (cancelled) return;
        const d = r.data && r.data.data;
        if (d) {
          setDozieEnabled(!!d.is_visible);
          setDoziePrice(d.dozie_price != null ? Number(d.dozie_price) : (Number(editProduct.sell_price) || 0));
        }
      })
      .catch(() => { /* 403 → paywall via interceptor; keep defaults */ });
    return () => { cancelled = true; };
  }, [showEditProduct, editProduct?.id]);

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
      // Bug Y companion (same shape as addProductMutation): snapshot
      // form state for the onSuccess seed because the post-success
      // reducer resets rapidItem before onSuccess can read it.
      return {
        ...res.data,
        _offlineSnapshot: {
          offlineQueued:     !!res.data?.offline_queued,
          product,
          initialLocationId: rapidItem.initial_location_id,
          initialQuantity:   rapidItem.initial_quantity,
          initialSlot:       rapidItem.initial_slot,
        },
      };
    },
    onSuccess: (data) => {
      setRapidCount(c => c + 1);
      toast.success(lang === "en" ? `✓ ${rapidItem.name} added!` : `✓ ${rapidItem.name} ajouté!`, { duration: 1500 });
      setRapidItem(prev => ({ ...EMPTY_PRODUCT, initial_location_id: prev.initial_location_id, unit: prev.unit }));
      setTimeout(() => rapidNameRef.current?.focus(), 100);
      const snap = data?._offlineSnapshot;
      if (snap?.offlineQueued) {
        seedAfterOfflineProductCreate({
          product:            snap.product,
          initialLocationId:  snap.initialLocationId,
          initialQuantity:    snap.initialQuantity,
          initialSlot:        snap.initialSlot,
        });
        invalidateAllSkippingOfflineSeed();
      } else {
        invalidateAll();
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── IMPORT MUTATION ─────────────────────────────────────────────────────────
  // Only the VALID rows are sent; invalid rows are reported as skips (never
  // silently dropped). Each product also seeds its stock row (qty + slot_code).
  const importMutation = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const row of importPreview) {
        if (!row.ok) {
          results.push({ rowNum: row._rowNum, name: row.name, success: false, reason: (en ? row.errors[0]?.en : row.errors[0]?.fr) });
          continue;
        }
        try {
          const res = await api.post("/products", {
            name: row.name, barcode: row.barcode || null, unit: row.unit || "pce",
            cost_price: +row.cost_price || 0, sell_price: +row.sell_price,
            wholesale_price: +row.wholesale_price || 0, min_price: +row.min_price || 0,
          });
          const product = res.data.data;
          if (row.location_id && row.qty !== "" && +row.qty > 0) {
            await api.post("/stock/arrivals", {
              location_id: row.location_id,
              items: [{ product_id: product.id, quantity: +row.qty, cost_price: +row.cost_price || 0, slot_code: row.slot_zone || null }]
            });
          }
          results.push({ rowNum: row._rowNum, name: row.name, success: true });
        } catch (e) {
          results.push({ rowNum: row._rowNum, name: row.name, success: false, reason: e.response?.data?.message || (en ? "server error" : "erreur serveur") });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      toast.success(en ? `✓ ${ok} imported${fail ? `, ${fail} skipped` : ""}` : `✓ ${ok} importés${fail ? `, ${fail} ignorés` : ""}`, { duration: 4000 });
      setImportResults(results);
      invalidateAll();
      if (fail === 0) { setShowImport(false); setImportFile(null); setImportPreview([]); setImportResults(null); }
    },
    onError: (err) => toast.error(err.message || "Import failed")
  });

  // ── FILE UPLOAD → PARSE + VALIDATE (xlsx / csv) ───────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file); setImportError(""); setImportResults(null); setImportPreview([]); setImportParsing(true);
    try {
      const { rows } = await parseProductImport(file, locations);
      if (rows.length === 0) {
        setImportError(en ? "No rows found. Fill the 'Products' sheet and try again." : "Aucune ligne trouvée. Remplissez la feuille 'Products' et réessayez.");
      } else {
        setImportPreview(rows);
      }
    } catch (err) {
      setImportError(en ? "Could not read the file. Use the .xlsx template (or a CSV with the same columns)." : "Lecture du fichier impossible. Utilisez le modèle .xlsx (ou un CSV avec les mêmes colonnes).");
    } finally {
      setImportParsing(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const blob = await buildProductTemplateXlsx(locations, lang === "en");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "mon_partenaire_products_template.xlsx";
      a.click(); URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(lang === "en" ? "Could not build the template." : "Impossible de créer le modèle.");
    }
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
            {isOwner && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{lang === "en" ? "Stock value:" : "Valeur stock:"} <strong style={{ color: "var(--brand-light)" }}>{fmt(totalStockValue)}</strong></div>}
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
            <RestrictedAction>
              <button className="btn btn-secondary" onClick={() => guardAdd(() => setShowReceive(true))}
                style={atInventoryCap ? { opacity: 0.55 } : {}}>
                📦 {lang === "en" ? "Receive Goods" : "Réceptionner"}{atInventoryCap ? " 🔒" : ""}
              </button>
            </RestrictedAction>
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

      {/* FU.4 — Migrate Dozie Duplicates entry point. Auto-checks on
          page mount; renders a prominent banner only when the seller
          is MP-linked AND has at least one standalone ptn_product
          (i.e., genuine duplicates to merge). Hidden otherwise so
          non-applicable users don't see noise. Clicking the button
          reuses the cached candidates payload — no extra fetch. */}
      {(() => {
        if (!migrateCandidates || !migrateCandidates.seller) return null;
        const count = (migrateCandidates.pairs || []).length;
        if (count === 0) return null;
        const matched = (migrateCandidates.pairs || []).filter(p => !!p.match).length;
        return (
          <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "var(--brand-light)", flex: 1, minWidth: 0 }}>
              🔗 <strong>{lang === "en"
                ? `You have ${count} standalone Dozie product${count === 1 ? "" : "s"} that may duplicate your MP inventory.`
                : `Vous avez ${count} produit${count === 1 ? "" : "s"} Dozie autonome${count === 1 ? "" : "s"} qui pourrai${count === 1 ? "t" : "ent"} être un doublon.`}</strong>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en"
                  ? `${matched} match${matched === 1 ? "" : "es"} found in MP inventory.`
                  : `${matched} correspondance${matched === 1 ? "" : "s"} trouvée${matched === 1 ? "" : "s"} dans l'inventaire MP.`}
              </div>
            </div>
            <button onClick={() => {
                // Use the already-loaded candidates; just initialise per-pair selections + open.
                const initSel = {};
                for (const pair of (migrateCandidates.pairs || [])) {
                  initSel[pair.ptn.id] = {
                    selected: !!pair.match,
                    dozie_price: pair.ptn.price || pair.match?.sell_price || 0,
                    hard_delete: false
                  };
                }
                setMigrateData(migrateCandidates);
                setMigrateSel(initSel);
                setShowMigrate(true);
              }}
              style={{ background: "var(--brand)", border: 0, color: "#152B52", padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
              {lang === "en" ? "Auto-link to MP products →" : "Lier aux produits MP →"}
            </button>
          </div>
        );
      })()}

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
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, maxWidth: 600, flexWrap: "wrap" }}>
          <div style={{ flex: 1, position: "relative", minWidth: 220 }}>
            <input ref={searchRef} className="input"
              placeholder={lang === "en" ? "Search all locations by name, barcode or slot..." : "Chercher partout par nom, code-barres ou emplacement..."}
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 36, paddingRight: 34 }} />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: scanning ? "#10b981" : "var(--text-muted)" }}>
              {scanning ? "✓" : "🔍"}
            </span>
            <ClearButton value={search} onClear={() => setSearch("")} inputRef={searchRef} right={10} title={lang === "en" ? "Clear" : "Effacer"} />
          </div>
          <button onClick={() => setShowCamera(true)}
            style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
            title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>
            📷
          </button>
          {/* MP-STOCK-LOCATION-FILTER: in-tab Location dropdown for the
              Stock Levels table only. Hidden on Products (it doesn't
              affect that view) and on single-location orgs (no real
              choice). Disabled during search since the query falls
              through to all-locations regardless. */}
          {tab === "stock" && locations.length > 1 && (
            <select
              className="input"
              value={locStockFilter}
              onChange={(e) => setLocFilterByUser(e.target.value)}
              disabled={!!search}
              title={search
                ? (lang === "en" ? "Search spans all locations" : "La recherche couvre tous les emplacements")
                : (lang === "en" ? "Filter Stock Levels by location" : "Filtrer par emplacement")}
              style={{ flexShrink: 0, height: 42, minWidth: 180, fontWeight: 600 }}
            >
              <option value="">📍 {lang === "en" ? "All locations" : "Tous les emplacements"}</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>📍 {l.name}</option>
              ))}
            </select>
          )}
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
        // MP-MOBILE-UI-PHASE-1-5: mirror the Overview tab's h-scroll
        // pattern (overflow:auto + table minWidth) so the 11-column
        // Stock Levels table is reachable on mobile. The previous
        // overflow:hidden clipped the overflow with no scroll
        // affordance, leaving cashiers unable to see Status/Last-moved
        // /Actions columns on a ~360px phone.
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
          {stockLoading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          : filtered.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.4 }}>📦</div>
              <div style={{ fontWeight: 600 }}>{search ? `No results for "${search}"` : (lang === "en" ? "No stock records yet" : "Aucun stock")}</div>
            </div>
          ) : (
            <table className="table" style={{ minWidth: 800 }}>
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
                {(() => {
                  // MP-DOZIE-INVENTORY-PUBLISH-UI: track which product
                  // IDs we've already rendered a Dozie button for in
                  // this list — the same product shows up on every
                  // location row, so the button surfaces on the FIRST
                  // occurrence only to avoid duplicate publish controls.
                  const dozieButtonSeen = new Set();
                  return filtered.map(s => {
                  const isLow = s.quantity <= s.min_quantity;
                  const p = s.pa_products;
                  const dozieListing = dozieListingByProductId.get(s.product_id) || null;
                  const dozieFirst = !dozieButtonSeen.has(s.product_id);
                  if (dozieFirst) dozieButtonSeen.add(s.product_id);
                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p?.name}</div>
                        {p?.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.barcode}</div>}
                      </td>
                      <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: s.pa_locations?.type === "warehouse" ? "rgba(251,197,3,0.15)" : "rgba(16,185,129,0.15)", color: s.pa_locations?.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>{s.pa_locations?.name}</span></td>
                      <td>
                        {s.slot_code ? (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontFamily: "monospace", fontWeight: 700 }}>
                            📍 {s.slot_code}
                          </span>
                        ) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: isLow ? "#f87171" : "var(--text-primary)" }}>{s.quantity} {unitLabel(p?.unit)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{s.min_quantity}</td>
                      {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{fmt(p?.cost_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{fmt(p?.sell_price)}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p?.wholesale_price > 0 ? fmt(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                      {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p?.min_price > 0 ? fmt(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
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
                            <RestrictedAction><button className="btn btn-secondary btn-sm" onClick={() => { setSelectedStockRow(s); setShowAdjust(true); }}>{lang === "en" ? "Adjust" : "Ajuster"}</button></RestrictedAction>
                            {isOwner && <button className="btn btn-secondary btn-sm" onClick={() => { setEditProduct({ ...p, id: s.product_id }); setShowEditProduct(true); }} style={{ color: "var(--brand-light)" }}>✏️</button>}
                            {/* MP-DOZIE-INVENTORY-PUBLISH-UI: per-product
                                Dozie publish action. Renders only on the
                                first stock-row for each product_id so we
                                don't repeat the button across location
                                rows. Owner+manager only (gated upstream
                                via canAdjustStock OR explicit isOwner). */}
                            {/* MP-LITE-MODE-PHASE-1: Sell-on-Dozie button hidden in Lite. */}
                            {!lite && dozieFirst && (isOwner || user?.role === "manager") && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDoziePublishCtx({
                                  productId:    s.product_id,
                                  productName:  p?.name || "?",
                                  defaultPrice: Number(p?.sell_price) || 0,
                                  totalStock:   stockByProductId.get(s.product_id) || 0,
                                })}
                                title={dozieListing
                                  ? (dozieListing.is_visible
                                      ? (lang === "en" ? "🟢 Live on Dozie — click to edit" : "🟢 En ligne sur Dozie — cliquer pour modifier")
                                      : (lang === "en" ? "⏸ Paused on Dozie — click to edit" : "⏸ En pause sur Dozie — cliquer pour modifier"))
                                  : (lang === "en" ? "Publish to Dozie marketplace" : "Publier sur Dozie")}
                                style={{
                                  color: dozieListing
                                    ? (dozieListing.is_visible ? "#34d399" : "#fbbf24")
                                    : "var(--text-muted)",
                                }}>
                                🛒
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                  });
                })()}
              </tbody>
              {isOwner && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-elevated)" }}>
                    <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>{lang === "en" ? "Total inventory value (at cost)" : "Valeur totale inventaire (au coût)"}</td>
                    <td colSpan={5} style={{ textAlign: "right", padding: "12px 16px", fontWeight: 800, color: "var(--brand-light)", fontSize: 15 }}>{fmt(totalStockValue)}</td>
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
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{unitLabel(p.unit)}</td>
                      {locations.map(l => <td key={l.id} style={{ textAlign: "right" }}>{p.locs[l.id] != null ? p.locs[l.id] : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>)}
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{p.total}</td>
                      {isOwner && <td style={{ textAlign: "right", fontSize: 12, color: "#fbbf24" }}>{fmt(value)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)" }}>
                  <td colSpan={2} style={{ fontWeight: 600, padding: "12px 16px" }}>{overviewProducts.length} products</td>
                  {locations.map(l => { const t = allStock.filter(s => s.location_id === l.id).reduce((sum, s) => sum + +s.quantity, 0); return <td key={l.id} style={{ textAlign: "right", fontWeight: 600, padding: "12px 16px" }}>{t}</td>; })}
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)", padding: "12px 16px" }}>{allStock.reduce((sum, s) => sum + +s.quantity, 0)}</td>
                  {isOwner && <td style={{ textAlign: "right", fontWeight: 700, color: "#fbbf24", padding: "12px 16px" }}>{fmt(totalStockValue)}</td>}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── PRODUCTS TAB ── */}
      {tab === "products" && (
        // MP-MOBILE-UI-PHASE-1-5: same h-scroll fix as the Stock Levels
        // tab — overflow:auto + table minWidth so the 8-column table
        // (Product / Barcode / Unit / Cost / Walk-in / Wholesale /
        // Min floor / Edit) is reachable on phone viewports.
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
          {/* ARCHIVE-RESTORE-UI: include is_active=false rows when ON */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              {lang === "en" ? "Show archived" : "Afficher les archivés"}
            </label>
          </div>
          {filteredProducts.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{search ? `No products matching "${search}"` : (lang === "en" ? "No products yet" : "Aucun produit")}</div>
              {!search && canAddProduct && <button className="btn btn-primary" onClick={() => guardAdd(() => setShowAddProduct(true))} style={{ marginTop: 12, opacity: atInventoryCap ? 0.55 : 1 }}>+ {lang === "en" ? "Add product" : "Ajouter"}{atInventoryCap ? " 🔒" : ""}</button>}
            </div>
          ) : (
            <table className="table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Barcode</th>
                  <th>Unit</th>
                  {canSeePrices && <th style={{ textAlign: "right" }}>Cost</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Walk-in</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Wholesale</th>}
                  {canSeePrices && <th style={{ textAlign: "right" }}>Min floor</th>}
                  {isOwner && <th>Edit</th>}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(p => (
                  <tr key={p.id} style={p.is_active === false ? { opacity: 0.6 } : undefined}>
                    <td style={{ fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {(p.photo_url || p.image_url)
                          ? <img src={p.photo_url || p.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }} />
                          : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--bg-elevated)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}>📷</div>}
                        <span style={p.is_active === false ? { textDecoration: "line-through" } : undefined}>{p.name}</span>
                        {p.is_active === false && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 6, padding: "1px 6px" }}>{lang === "en" ? "ARCHIVED" : "ARCHIVÉ"}</span>}
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "—"}</td>
                    <td style={{ color: "var(--text-muted)" }}>{unitLabel(p.unit)}</td>
                    {canSeePrices && <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{fmt(p.cost_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", fontWeight: 600, color: "var(--brand-light)" }}>{fmt(p.sell_price)}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#fbbf24" }}>{p.wholesale_price > 0 ? fmt(p.wholesale_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
                    {canSeePrices && <td style={{ textAlign: "right", color: "#f87171", fontSize: 12 }}>{p.min_price > 0 ? fmt(p.min_price) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}</td>}
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
        // MP-MOBILE-UI-PHASE-1-5: 5-column alerts table — narrower than
        // Stock Levels / Products but still wider than a 360px phone
        // viewport once the action buttons and padding settle.
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
          {alerts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>✓ All stock levels OK!</div></div> : (
            <table className="table" style={{ minWidth: 520 }}>
              <thead><tr>
                <th>Product</th><th>Location</th>
                <th style={{ textAlign: "right" }}>Current</th><th style={{ textAlign: "right" }}>Min</th><th style={{ textAlign: "right" }}>Shortage</th>
              </tr></thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{a.location_name}</td>
                    <td style={{ textAlign: "right", color: "#f87171", fontWeight: 600 }}>{a.quantity} {unitLabel(a.unit)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{a.min_quantity}</td>
                    <td style={{ textAlign: "right", color: "#fbbf24" }}>{a.shortage} {unitLabel(a.unit)}</td>
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
                  {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
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
                <PhotoUploadButtons lang={lang}
                  onPicked={(file) => readPhotoToDataUrl(file, lang)
                    .then(dataUrl => dataUrl && setNewProduct(p => ({ ...p, photo_data_url: dataUrl })))
                    .catch(err => toast.error(err.message))} />
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

            {dupeProduct && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, marginBottom: 8 }}>
                  ⚠️ {lang === "en" ? "This item already exists" : "Cet article existe déjà"}{dupeProduct.name ? ` : ${dupeProduct.name}` : ""}
                </div>
                <button className="btn btn-primary btn-block" onClick={() => openExistingProduct(dupeProduct)}>
                  {lang === "en" ? "Open / edit / restock it" : "Ouvrir / modifier / réapprovisionner"}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddProduct(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!newProduct.name || !newProduct.sell_price || addProductMutation.isPending} onClick={handleAddProduct}>
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
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4, color: editProduct.is_active === false ? "#ef4444" : undefined }}>
              {editProduct.is_active === false
                ? `🗄 ${lang === "en" ? "Archived" : "Archivé"}: ${editProduct.name}`
                : `✏️ ${lang === "en" ? "Edit Product" : "Modifier le produit"}`}
            </div>
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
                  {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              </div>
            </div>

            <PricingSection data={editProduct} onChange={(k, v) => setEditProduct(p => ({ ...p, [k]: v }))} lang={lang} />

            {/* MP-INVENTORY-DOZIE-CONTROLS — product photo (same POST
                /products/:id/photo flow as the backfill modal). */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                📷 {lang === "en" ? "Product photo" : "Photo du produit"}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {(editProduct.photo_url || editProduct.image_url)
                  ? <img src={editProduct.photo_url || editProduct.image_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", flexShrink: 0 }} />
                  : <div style={{ width: 64, height: 64, borderRadius: 10, background: "var(--bg-card)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", fontSize: 18, color: "var(--text-muted)", flexShrink: 0 }}>📷</div>}
                {editPhotoUploading
                  ? <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>⏳ {lang === "en" ? "Uploading…" : "Téléversement…"}</div>
                  : <PhotoUploadButtons lang={lang}
                      onPicked={async (f) => {
                        try {
                          setEditPhotoUploading(true);
                          const dataUrl = await readPhotoToDataUrl(f, lang);
                          if (!dataUrl) return;
                          const r = await api.post(`/products/${editProduct.id}/photo`, { data_url: dataUrl });
                          const newUrl = r.data && r.data.data && r.data.data.photo_url;
                          if (newUrl) setEditProduct(p => ({ ...p, photo_url: newUrl }));
                          toast.success(lang === "en" ? "✓ Photo uploaded" : "✓ Photo ajoutée");
                          invalidateAll();
                        } catch (err) { toast.error(err.message || "Upload failed"); }
                        finally { setEditPhotoUploading(false); }
                      }} />}
              </div>
            </div>

            {/* MP-INVENTORY-DOZIE-CONTROLS — Sell-on-Dozie toggle + price.
                Saves via the existing PATCH /products/:id/expose-on-dozie.
                Toggle OFF still sends the price so it is preserved for a
                later toggle-on (matches pa_dozie_seller_listings semantics).
                MP-LITE-MODE-PHASE-1: section hidden in Lite. */}
            {!lite && (
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={dozieEnabled} onChange={e => setDozieEnabled(e.target.checked)} />
                🛒 {lang === "en" ? "Sell on Dozie" : "Vendre sur Dozie"}
              </label>
              {dozieEnabled && (
                <div className="form-group" style={{ marginTop: 12, marginBottom: 0, maxWidth: 220 }}>
                  <label className="label">{lang === "en" ? "Dozie price (XAF)" : "Prix Dozie (XAF)"}</label>
                  <input className="input" type="number" min="0" step="1" value={doziePrice}
                    onChange={e => setDoziePrice(e.target.value)} />
                </div>
              )}
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}
                disabled={dozieSaving}
                onClick={async () => {
                  try {
                    setDozieSaving(true);
                    await api.patch(`/products/${editProduct.id}/expose-on-dozie`, {
                      is_visible: dozieEnabled,
                      dozie_price: doziePrice != null && doziePrice !== "" ? Number(doziePrice) : null
                    });
                    toast.success(lang === "en" ? "✓ Dozie settings saved" : "✓ Réglages Dozie enregistrés");
                    invalidateAll();
                  } catch (err) {
                    // 403 upgrade_required → global paywall interceptor.
                    if (err.response?.status !== 403) toast.error(err.response?.data?.message || "Error");
                  } finally { setDozieSaving(false); }
                }}>
                {dozieSaving ? "..." : (lang === "en" ? "Save Dozie settings" : "Enregistrer Dozie")}
              </button>
            </div>
            )}{/* end MP-LITE-MODE-PHASE-1 Sell-on-Dozie section */}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowEditProduct(false); setEditProduct(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!editProduct.name || !editProduct.sell_price || editProductMutation.isPending} onClick={() => { const e = priceLadderError(editProduct); if (e) { toast.error(e); return; } editProductMutation.mutate(); }}>
                {editProductMutation.isPending ? "..." : (lang === "en" ? "✓ Save Changes" : "✓ Enregistrer")}
              </button>
            </div>

            {/* STOCK-UX-PASS Part B / ARCHIVE-RESTORE-UI — archived
                products show a green Restore; active ones a red Archive
                (soft is_active toggle; confirm on archive since it pulls
                the item from all inventory lists). */}
            {editProduct.is_active === false ? (
              <button
                disabled={restoreProductMutation.isPending}
                onClick={() => restoreProductMutation.mutate()}
                style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 8,
                  background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.45)",
                  color: "#22c55e", fontSize: 13, fontWeight: 700,
                  cursor: restoreProductMutation.isPending ? "wait" : "pointer" }}>
                {restoreProductMutation.isPending ? "..." : (lang === "en" ? "♻️ Restore product" : "♻️ Restaurer le produit")}
              </button>
            ) : (
              <button
                disabled={archiveProductMutation.isPending}
                onClick={() => {
                  const ok = window.confirm(lang === "en"
                    ? `Archive "${editProduct.name}"? It will be removed from your inventory lists. This does not delete its sales history.`
                    : `Archiver « ${editProduct.name} » ? Le produit sera retiré de vos listes d'inventaire. L'historique des ventes est conservé.`);
                  if (ok) archiveProductMutation.mutate();
                }}
                style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 8,
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
                  color: "#ef4444", fontSize: 13, fontWeight: 700,
                  cursor: archiveProductMutation.isPending ? "wait" : "pointer" }}>
                {archiveProductMutation.isPending ? "..." : (lang === "en" ? "🗄 Archive product" : "🗄 Archiver le produit")}
              </button>
            )}
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

            <div style={{ background: "rgba(251,197,3,0.08)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--text-muted)" }}>
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
                  {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
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
                <span style={{ background: "var(--brand)", color: "#152B52", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>1</span>
                {lang === "en" ? "Download the template" : "Télécharger le modèle"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                {lang === "en"
                  ? "Excel file with an example row. Fill the 'Products' sheet; the 'Instructions' sheet explains each column."
                  : "Fichier Excel avec une ligne d'exemple. Remplissez la feuille 'Products' ; la feuille 'Instructions' explique chaque colonne."}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 6, lineHeight: 1.5 }}>
                <b>{lang === "en" ? "Required:" : "Obligatoire :"}</b> name, unit, cost_price, walk_in_price, qty, location<br />
                <b>{lang === "en" ? "Optional:" : "Facultatif :"}</b> barcode, wholesale_price, min_price, slot_zone
              </div>
              <div style={{ fontSize: 11.5, color: "#fbbf24", marginBottom: 10, lineHeight: 1.4 }}>
                ⚠️ {lang === "en"
                  ? "Keep the barcode column as Text — if it shows like 1.23E+09, that row is rejected (the real digits are lost)."
                  : "Gardez la colonne code-barres en Texte — si elle affiche 1.23E+09, la ligne est refusée (les vrais chiffres sont perdus)."}
              </div>
              <button className="btn btn-secondary" onClick={downloadTemplate}>
                ⬇️ {lang === "en" ? "Download Excel Template (.xlsx)" : "Télécharger le modèle Excel (.xlsx)"}
              </button>
            </div>

            {/* Step 2: Upload */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                <span style={{ background: "var(--brand)", color: "#152B52", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>2</span>
                {lang === "en" ? "Upload your filled file" : "Téléverser votre fichier rempli"}
              </div>
              <label style={{ display: "block", padding: "20px", border: "2px dashed var(--border)", borderRadius: 10, textAlign: "center", cursor: "pointer", color: "var(--text-muted)", fontSize: 13 }}>
                {importParsing
                  ? <span style={{ fontWeight: 600 }}>⏳ {lang === "en" ? "Reading file…" : "Lecture du fichier…"}</span>
                  : importFile
                    ? <span style={{ color: "#10b981", fontWeight: 600 }}>✓ {importFile.name}</span>
                    : (lang === "en" ? "Click to select your Excel/CSV file" : "Cliquer pour sélectionner votre fichier Excel/CSV")}
                <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={handleFileUpload} style={{ display: "none" }} />
              </label>
              {importError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{importError}</div>}
            </div>

            {/* Step 3: Preview — per-row validation (good rows import, bad rows skip). */}
            {importPreview.length > 0 && (() => {
              const okCount = importPreview.filter(r => r.ok).length;
              const badCount = importPreview.length - okCount;
              return (
              <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                  <span style={{ background: "var(--brand)", color: "#152B52", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 8 }}>3</span>
                  {lang === "en" ? `Preview — ${okCount} ready${badCount ? `, ${badCount} to fix` : ""}` : `Aperçu — ${okCount} prêts${badCount ? `, ${badCount} à corriger` : ""}`}
                </div>
                <div style={{ overflowX: "auto", maxHeight: 240, overflowY: "auto" }}>
                  <table className="table" style={{ fontSize: 11 }}>
                    <thead><tr>
                      <th></th><th>Name</th><th>Barcode</th><th>Unit</th>
                      <th>Cost</th><th>Walk-in</th><th>Wholesale</th><th>Min</th>
                      <th>Qty</th><th>Location</th><th>Slot</th>
                    </tr></thead>
                    <tbody>
                      {importPreview.slice(0, 30).map((row, i) => (
                        <tr key={i} style={{ background: row.ok ? "transparent" : "rgba(239,68,68,0.06)" }}>
                          <td title={row.ok ? "" : (en ? row.errors.map(e => e.en).join(" ") : row.errors.map(e => e.fr).join(" "))}>{row.ok ? "✅" : "⚠️"}</td>
                          <td style={{ fontWeight: 500 }}>{row.name || "—"}</td>
                          <td style={{ fontFamily: "monospace" }}>{row.barcode || "—"}</td>
                          <td>{unitLabel(row.unit || "pce")}</td>
                          <td>{row.cost_price || "—"}</td>
                          <td style={{ color: row.sell_price ? "var(--brand-light)" : "#f87171", fontWeight: 600 }}>{row.sell_price || "—"}</td>
                          <td>{row.wholesale_price || "—"}</td>
                          <td>{row.min_price || "—"}</td>
                          <td>{row.qty || "—"}</td>
                          <td style={{ fontSize: 10 }}>{row.location_id ? locations.find(l => l.id === row.location_id)?.name : <span style={{ color: "#f87171" }}>{row.location_name || (en ? "missing" : "manquant")}</span>}</td>
                          <td style={{ fontSize: 10 }}>{row.slot_zone || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreview.length > 30 && <div style={{ textAlign: "center", padding: 8, fontSize: 12, color: "var(--text-muted)" }}>...{lang === "en" ? "and" : "et"} {importPreview.length - 30} {lang === "en" ? "more" : "de plus"}</div>}
                </div>
                {badCount > 0 && (
                  <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>
                    ⚠️ {lang === "en"
                      ? `${badCount} row(s) marked ⚠️ will be skipped (hover the ⚠️ for the reason). The ${okCount} good rows still import.`
                      : `${badCount} ligne(s) ⚠️ seront ignorées (survolez le ⚠️ pour la raison). Les ${okCount} bonnes lignes s'importent quand même.`}
                  </div>
                )}
              </div>
              );
            })()}

            {/* Import result — per-row outcome (kept open when some rows were skipped). */}
            {importResults && importResults.some(r => !r.success) && (
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                  {lang === "en" ? `Skipped rows (${importResults.filter(r => !r.success).length})` : `Lignes ignorées (${importResults.filter(r => !r.success).length})`}
                </div>
                {importResults.filter(r => !r.success).map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3 }}>
                    <b>{lang === "en" ? `Row ${r.rowNum}` : `Ligne ${r.rowNum}`}{r.name ? ` (${r.name})` : ""}:</b> {r.reason}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowImport(false); setImportFile(null); setImportPreview([]); setImportResults(null); }}>
                {lang === "en" ? "Close" : "Fermer"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={importPreview.filter(r => r.ok).length === 0 || importMutation.isPending}
                onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? `⏳ ${lang === "en" ? "Importing..." : "Importation..."}` : (lang === "en" ? `✓ Import ${importPreview.filter(r => r.ok).length} products` : `✓ Importer ${importPreview.filter(r => r.ok).length} produits`)}
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
          role={role} requestApproval={requestApproval}
          onClose={() => { setShowAdjust(false); setSelectedStockRow(null); }}
          onSuccess={(offlineQueued) => {
            setShowAdjust(false); setSelectedStockRow(null);
            // MP-PHASE-4 WAVE 1: when the modal seeded the stock caches
            // offline, skip invalidating the seeded keys — invalidate
            // → refetch → offline-cache fallback would return the OLD
            // pre-adjust cached array and clobber the seed. Same
            // principle as ShiftWidgets.jsx's "don't invalidate
            // current-shift while offline_queued" guard. Non-seeded
            // keys (products-all, dozie-migrate-candidates) still get
            // refreshed so a manual `is_active` toggle or a freshly-
            // migrated Dozie pair surfaces.
            if (offlineQueued) {
              qc.invalidateQueries(["products-all"]);
              qc.invalidateQueries(["dozie-migrate-candidates"]);
            } else {
              invalidateAll();
            }
          }} />
      )}
      {/* MP-OWNER-PIN-APPROVAL (Wave 2): hook's modal lives at the page
          root so it can overlay both the Adjust modal and the Edit
          product modal at z:2500. */}
      {approvalModal}

      {/* FU.4 — migrate-duplicates modal. Pairs of (ptn_products[], pa_products[]) */}
      {showMigrate && (
        <div className="modal-overlay" onClick={() => !migrateApplying && setShowMigrate(false)}>
          <div className="modal" style={{ maxWidth: 720, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>🔗 {lang === "en" ? "Migrate Dozie duplicates" : "Fusionner les doublons Dozie"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {migrateData.seller
                    ? (lang === "en" ? "Link your standalone Dozie products to matching MP products so they share photos + real stock." : "Reliez vos produits Dozie autonomes à des produits MP correspondants.")
                    : (lang === "en" ? "You need an MP-linked Dozie seller account to use this tool." : "Vous devez avoir un compte vendeur Dozie lié à MP pour utiliser cet outil.")}
                </div>
              </div>
              <button onClick={() => !migrateApplying && setShowMigrate(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>✕</button>
            </div>
            {migrateData.pairs.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                ✓ {lang === "en" ? "No standalone Dozie products to migrate." : "Aucun doublon à fusionner."}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {migrateData.pairs.map(pair => {
                    const sel = migrateSel[pair.ptn.id] || {};
                    return (
                      <div key={pair.ptn.id} style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 12, border: pair.match ? "1px solid var(--border)" : "1px dashed rgba(239,68,68,0.35)" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <input type="checkbox" disabled={!pair.match}
                            checked={!!sel.selected}
                            onChange={(e) => setMigrateSel(s => ({ ...s, [pair.ptn.id]: { ...s[pair.ptn.id], selected: e.target.checked } }))}
                            style={{ marginTop: 4 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {lang === "en" ? "Dozie:" : "Dozie :"} <strong style={{ color: "var(--text-primary)" }}>{pair.ptn.name}</strong>
                              <span style={{ color: "var(--text-muted)" }}> · stock {pair.ptn.stock || 0}{pair.ptn.photo_url ? " · 📷" : ""}</span>
                            </div>
                            {pair.match ? (
                              <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-muted)" }}>
                                MP: <strong style={{ color: pair.confidence === "exact" ? "#10b981" : "#fbbf24" }}>{pair.match.name}</strong>
                                <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 10, background: pair.confidence === "exact" ? "rgba(16,185,129,0.15)" : "rgba(251,191,36,0.15)", color: pair.confidence === "exact" ? "#10b981" : "#fbbf24" }}>
                                  {pair.confidence === "exact" ? (lang === "en" ? "exact match" : "match exact") : (lang === "en" ? "fuzzy match" : "match approx.")}
                                </span>
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, marginTop: 4, color: "#fca5a5" }}>{lang === "en" ? "No MP match — will stay as standalone." : "Aucun match MP — restera autonome."}</div>
                            )}
                            {pair.match && sel.selected && (
                              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", fontSize: 12 }}>
                                <label>Dozie price:</label>
                                <input className="input" style={{ width: 100, padding: "4px 8px" }} type="number"
                                  value={sel.dozie_price || ""}
                                  onChange={(e) => setMigrateSel(s => ({ ...s, [pair.ptn.id]: { ...s[pair.ptn.id], dozie_price: e.target.value } }))} />
                                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                                  <input type="checkbox" checked={!!sel.hard_delete}
                                    onChange={(e) => setMigrateSel(s => ({ ...s, [pair.ptn.id]: { ...s[pair.ptn.id], hard_delete: e.target.checked } }))} />
                                  {lang === "en" ? "Delete permanently" : "Supprimer définitivement"}
                                </label>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                  💡 {lang === "en"
                    ? "By default, retired Dozie products are soft-deleted (published=false). Tick \"Delete permanently\" only if you're sure."
                    : "Par défaut, les produits Dozie retirés sont masqués (published=false). Cochez \"Supprimer définitivement\" uniquement si vous êtes sûr."}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} disabled={migrateApplying} onClick={() => setShowMigrate(false)}>
                    {lang === "en" ? "Cancel" : "Annuler"}
                  </button>
                  <button className="btn btn-primary" style={{ flex: 2 }} disabled={migrateApplying}
                    onClick={async () => {
                      const items = Object.entries(migrateSel)
                        .filter(([id, s]) => s.selected)
                        .map(([ptn_id, s]) => {
                          const pair = migrateData.pairs.find(p => p.ptn.id === ptn_id);
                          return pair && pair.match ? {
                            ptn_id,
                            mp_product_id: pair.match.id,
                            dozie_price: s.dozie_price ? Number(s.dozie_price) : null,
                            hard_delete: !!s.hard_delete
                          } : null;
                        }).filter(Boolean);
                      if (!items.length) { toast.error(lang === "en" ? "Nothing selected" : "Rien à fusionner"); return; }
                      setMigrateApplying(true);
                      try {
                        const r = await api.post("/dozie/migrate-duplicates/apply", { items });
                        toast.success((lang === "en" ? "✓ Migrated " : "✓ Fusionnés ") + r.data.data.applied);
                        setShowMigrate(false);
                        invalidateAll();
                      } catch (e) { toast.error(e.response?.data?.message || e.message); }
                      finally { setMigrateApplying(false); }
                    }}>
                    {migrateApplying ? "..." : (lang === "en" ? "Apply migration" : "Appliquer")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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
                      {backfillUploading === p.id
                        ? <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", padding: "8px 10px" }}>⏳ {lang === "en" ? "Uploading…" : "Téléversement…"}</div>
                        : <PhotoUploadButtons lang={lang}
                            onPicked={async (f) => {
                              try {
                                setBackfillUploading(p.id);
                                const dataUrl = await readPhotoToDataUrl(f, lang);
                                if (!dataUrl) return;
                                await api.post(`/products/${p.id}/photo`, { data_url: dataUrl });
                                toast.success(lang === "en" ? "✓ Photo uploaded" : "✓ Photo ajoutée");
                                invalidateAll();
                              } catch (err) { toast.error(err.message || "Upload failed"); }
                              finally { setBackfillUploading(null); }
                            }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* MP-DOZIE-INVENTORY-PUBLISH-UI: per-product Dozie publish modal.
          Mounted once at page level; opens on 🛒 button click in the
          Inventory actions column. */}
      {doziePublishCtx && (
        <DoziePublishModal
          productId={doziePublishCtx.productId}
          productName={doziePublishCtx.productName}
          defaultPrice={doziePublishCtx.defaultPrice}
          defaultCity={user?.org_city || user?.city || ""}
          totalStock={doziePublishCtx.totalStock}
          lang={lang}
          onClose={() => setDoziePublishCtx(null)}
        />
      )}
    </div>
  );
}

// ── SHARED PRICING SECTION COMPONENT ─────────────────────────────────────────
function PricingSection({ data, onChange, lang }) {
  const fmt = useCurrency();
  return (
    <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
        💰 {lang === "en" ? "Pricing" : "Tarification"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group">
          <label className="label">{lang === "en" ? `Cost price (${fmt.symbol})` : `Prix achat (${fmt.symbol})`}</label>
          <input className="input" type="number" value={data.cost_price || ""} onChange={e => onChange("cost_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "var(--brand-light)" }}>{lang === "en" ? `Walk-in price (${fmt.symbol}) *` : `Prix détail (${fmt.symbol}) *`}</label>
          <input className="input" type="number" value={data.sell_price || ""} onChange={e => onChange("sell_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "#fbbf24" }}>{lang === "en" ? `Wholesale price (${fmt.symbol})` : `Prix gros (${fmt.symbol})`}</label>
          <input className="input" type="number" value={data.wholesale_price || ""} onChange={e => onChange("wholesale_price", e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label className="label" style={{ color: "#f87171" }}>{lang === "en" ? `Min price floor (${fmt.symbol})` : `Prix minimum (${fmt.symbol})`}</label>
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
  const [selected, setSelected] = useState(null);

  const pickProduct = (p) => {
    setSelected(p);
    onSelect(p);
  };

  const clearProduct = () => {
    setSelected(null);
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(251,197,3,0.12)", border: "1px solid var(--brand)", borderRadius: 10, marginBottom: 12 }}>
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
          {/* Search input — shared fuzzy + scrollable product search (USB/keyboard
              + camera scan built in via ProductSearchBox/BarcodeInput). */}
          <div className="form-group">
            <label className="label">{lang === "en" ? "Product *" : "Produit *"}</label>
            <ProductSearchBox
              onSelect={pickProduct}
              fallbackProducts={products}
              clearOnSelect={false}
              autoFocus={idx === 0}
              lang={lang}
              placeholder={lang === "en" ? "Type to search or scan barcode..." : "Tapez pour chercher ou scannez..."}
              renderMeta={canSeePrices ? (p => <span style={{ fontSize: 12, color: "var(--brand-light)", fontWeight: 700 }}>{Number(p.sell_price || 0).toLocaleString()} F</span>) : undefined}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              {lang === "en" ? "Typo-tolerant — scroll for more matches. No match? Use + Add Product." : "Tolérant aux fautes — défilez pour plus de résultats. Aucun ? + Ajouter produit."}
            </div>
          </div>
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
// MP-OWNER-PIN-APPROVAL (Wave 2): manager-initiated adjustments need
// an owner/manager PIN. Owner + warehouse pass through directly (the
// warehouse role's core job is inventory ops; PIN per adjustment would
// cripple). Cashier never reaches this modal — the page-level gate at
// the top of InventoryPage blocks them entirely.
function AdjustModal({ product, role, requestApproval, lang, onClose, onSuccess }) {
  const [qty, setQty] = useState(product.quantity);
  const [minQty, setMinQty] = useState(product.min_quantity || 5);
  const [alertEnabled, setAlertEnabled] = useState(product.alert_enabled !== false);
  const [isActive, setIsActive] = useState(product.pa_products?.is_active !== false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  // MP-PHASE-4 WAVE 1 — optimistic UI seed for offline stock-adjust.
  // The api.patch returns the offlineAwareAdapter's 202 when the device
  // is offline. Without a setQueryData seed, the inventory list shows
  // pre-adjust quantity until sync (Peter's "value doesn't change until
  // sync" complaint) — and the cashier might retry, generating a fresh
  // mutation flow that bypasses dedupe by being a new submission.
  // Mirror of the Phase 3 shift-open seed pattern in ShiftWidgets.jsx.
  const seedStockAfterAdjust = ({ newQty, newMin, newAlertEnabled }) => {
    const match = (s) => s.product_id === product.product_id && s.location_id === product.location_id;
    const updateRow = (s) => ({ ...s, quantity: newQty, min_quantity: newMin, alert_enabled: newAlertEnabled });
    // ["stock", locId, search] + ["stock-all"] live under varying param
    // shapes — match them by first-key prefix and replace the affected
    // row in whichever cache slots already populated.
    qc.setQueriesData(
      { predicate: (q) => {
        const k = q.queryKey?.[0];
        return k === "stock" || k === "stock-all";
      }},
      (old) => {
        if (!old) return old;
        const arr = Array.isArray(old) ? old : (old.data || []);
        const next = arr.map(s => match(s) ? updateRow(s) : s);
        return Array.isArray(old) ? next : { ...old, data: next };
      }
    );
    // ["stock-alerts"] — re-derive membership. Below min + alert on →
    // include; otherwise remove. Update in place if it stays.
    const shouldAlert = newQty < newMin && newAlertEnabled;
    qc.setQueriesData(
      { predicate: (q) => q.queryKey?.[0] === "stock-alerts" },
      (old) => {
        if (!old) return old;
        const arr = Array.isArray(old) ? old : (old.data || []);
        const existsIdx = arr.findIndex(match);
        let next;
        if (shouldAlert && existsIdx === -1) {
          next = [...arr, updateRow(product)];
        } else if (!shouldAlert && existsIdx !== -1) {
          next = arr.filter(s => !match(s));
        } else if (existsIdx !== -1) {
          next = arr.map(s => match(s) ? updateRow(s) : s);
        } else {
          return old;
        }
        return Array.isArray(old) ? next : { ...old, data: next };
      }
    );
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const headers = {};
      if (role === "manager" || role === "cashier") {
        const { token } = await requestApproval({
          actionType:  "adjust_stock",
          targetTable: "pa_stock",
          targetId:    product.product_id,
          context: {
            from_quantity: product.quantity,
            to_quantity:   +qty,
            location_id:   product.location_id,
            reason:        reason || null,
          },
          description: (lang === "fr"
            ? `Ajuster le stock de « ${product.pa_products?.name || ""} »`
            : `Adjust stock for "${product.pa_products?.name || ""}"`)
            + ` (${product.quantity} → ${+qty})`,
        });
        headers["Approval-Token"] = token;
      }
      const res = await api.patch("/stock/adjust",
        { product_id: product.product_id, location_id: product.location_id, new_quantity: +qty, min_quantity: +minQty, alert_enabled: alertEnabled, reason },
        { headers });
      // Non-blocking model: PARKED for owner approval → nothing adjusted. Don't
      // run the is_active write or show "adjusted"; toast + close, keep working.
      if (isPendingApproval(res?.data)) {
        toast(keepWorkingToast(lang === "en"), { icon: "⏳", duration: 4000 });
        setLoading(false);
        onClose();
        return;
      }
      const offlineQueued = !!res?.data?.offline_queued;
      if (offlineQueued) {
        seedStockAfterAdjust({ newQty: +qty, newMin: +minQty, newAlertEnabled: alertEnabled });
      }
      // Update product active status (not gated — is_active is the
      // owner-archive path; managers/warehouse who can open this modal
      // are already trusted with the status toggle).
      await api.patch("/products/" + product.product_id, { is_active: isActive });
      toast.success(offlineQueued
        ? (lang === "en" ? "✓ Stock adjusted · will sync" : "✓ Stock ajusté · se synchronisera")
        : (lang === "en" ? "✓ Stock adjusted!" : "✓ Stock ajusté!"));
      onSuccess(offlineQueued);
    } catch (err) {
      // MP-OWNER-PIN-APPROVAL: PIN modal closed → silent.
      if (err?.code === "cancelled") { setLoading(false); return; }
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
          <strong>{product.quantity} {unitLabel(product.pa_products?.unit)}</strong>
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
