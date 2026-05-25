// v12 - receipt payment status fix
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
// MP-MIN-PRICE-PIN-UX Option B: OwnerPIN import dropped — the PIN
// override flow was dead code (imported, state set, never rendered).
// Staff who attempt a sub-min price now get a toast.error explaining
// why; the backend at sales.js:46-62 is the source of truth either way.
import api, { formatCFA } from "../utils/api";
import { cacheData, getCachedData } from "../utils/offlineStore";
import CameraScanner from "../components/common/CameraScanner";
import { genSaleCodes } from "../utils/receiptCodes";
import { ActiveShiftIndicator, useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";

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
  const navigate = useNavigate();
  const isOwner = user?.role === "owner";
  // MP-REQUIRE-OPEN-SHIFT Phase 3: shared with <ActiveShiftIndicator />
  // via the ["current-shift", locId] cache, so this hook does not
  // trigger a second network request.
  const { hasShift: shiftIsOpen } = useActiveShift();

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
  // MP-MIN-PRICE-PIN-UX: showPIN / pinItem state removed — they were
  // set by the price-edit handler but never read anywhere (the
  // OwnerPIN modal that would have consumed them was never rendered).
  // Staff now get a toast.error inline; no override mechanism.
  const [showReceipt, setShowReceipt]       = useState(false);
  const [lastSale, setLastSale]             = useState(null);
  // MP-POS-COLLECT-DEBT-CART-NO-RECEIPT (Bug A): separate state
  // for the debt-cart receipt so the sale receipt + debt-cart
  // receipt can coexist (one closes, the other opens). Shape:
  // { data: {...} } compatible with PaymentEventReceipt
  // eventType='debt_collection'.
  const [debtReceiptEvent, setDebtReceiptEvent] = useState(null);
  const [debtInvoices, setDebtInvoices]       = useState([]);
  const [selectedDebtIds, setSelectedDebtIds] = useState(new Set());
  const [debtPayAmt, setDebtPayAmt]           = useState(""); // partial debt payment amount
  const [debtBanner, setDebtBanner]           = useState(null); // MP-POS-DEBT-CART-FLOW: {customer_id,name,amount}
  // D-2.4: when arriving from the Online Cart "Send to Cart" flow
  // (?from_online=<id>&session=<sid>), this holds the entry id + ref so
  // the banner shows and the created sale gets linked back on finalize.
  const [onlineCtx, setOnlineCtx]             = useState(null);
  // Inventory guards (Bugs 2 & 3): blockModal = products not stocked
  // at this location (HARD block, no proceed); oversellModal = lines
  // exceeding available stock (WARN, may proceed).
  const [blockModal, setBlockModal]           = useState(null);
  const [oversellModal, setOversellModal]     = useState(null);
  // MP-DOZIE-CART-PREFILL-VALIDATE: when the online_cart_validate_for_pos
  // RPC reports can_proceed=false, this holds per-item verdicts to
  // render. Shape: { locationName, items:[{name, status, qty_requested,
  // qty_available, ...}], summary }.
  const [validateModal, setValidateModal]     = useState(null);
  // Hold Sale (park & resume). showHold = label/notes prompt;
  // heldTicket = the just-held cart to print; showResume = the
  // active-holds picker.
  const [showHold, setShowHold]               = useState(false);
  const [holdLabel, setHoldLabel]             = useState("");
  const [holdNotes, setHoldNotes]             = useState("");
  const [heldTicket, setHeldTicket]           = useState(null);
  const [showResume, setShowResume]           = useState(false);
  const [cancelTarget, setCancelTarget]       = useState(null); // hold pending cancel
  const [cancelReason, setCancelReason]       = useState("changed_mind");

  const searchRef     = useRef(null);
  const custRef       = useRef(null);
  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);
  // MP-DOZIE-CART-PREFILL-VALIDATE: prevents the validate-on-mount
  // effect from re-firing once it has dispatched a successful POST.
  // The URL params are stripped on completion, but selectedLocation
  // changes would otherwise re-fire the effect mid-flight.
  const dozieValidateRanRef = useRef(false);

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
      try {
        const result = await api.get("/locations").then(r => r.data);
        cacheData("pos-locations", result);
        return result;
      } catch {
        const cached = await getCachedData("pos-locations");
        return cached || { data: [] };
      }
    }
  });

  const { data: allProducts } = useQuery({
    queryKey: ["pos-products", selectedLocation?.id],
    queryFn: async () => {
      const cacheKey = "pos-products-" + (selectedLocation?.id || "all");
      try {
        const result = await api.get("/products?location_id=" + (selectedLocation?.id || "") + "&limit=200").then(r => r.data);
        cacheData(cacheKey, result);
        return result;
      } catch {
        const cached = await getCachedData(cacheKey);
        return cached || { data: [] };
      }
    },
    enabled: true,
    staleTime: 60000
  });

  const { data: allCustomers } = useQuery({
    queryKey: ["pos-customers"],
    queryFn: async () => {
      try {
        const result = await api.get("/customers?limit=300").then(r => r.data);
        cacheData("pos-customers", result);
        return result;
      } catch {
        const cached = await getCachedData("pos-customers");
        return cached || { data: [] };
      }
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
  // MP-INVOICE-DISPLAY-NET-OF-RETURNS (Bug B): paper_record_balance
  // is the slice of customer.total_debt that doesn't have a
  // backing open invoice (collect_debt_no_invoice ghost residual,
  // cart-debt-line carryover, manual adjustments). Displayed
  // below the invoice list as "Previous balance".
  const debtPaperBalance = Number(customerDebtData?.paper_record_balance || 0);

  // MP-POS-DEBT-CART-FLOW: NO auto-collect. Outstanding invoices keep
  // the original per-invoice modal (unchanged, works). Manual / paper-
  // migrated debt (total_debt>0, no outstanding sale) surfaces a
  // NON-BLOCKING banner — the cashier explicitly chooses Add-to-Cart or
  // Skip; nothing is collected on select.
  useEffect(() => {
    if (!customerDebtData) return;
    const invoices = customerDebtData.data || [];
    const owed = Number(customerDebtData.customer_total_debt || customer?.total_debt || 0);
    if (invoices.length > 0) {
      setDebtInvoices(invoices);
      setSelectedDebtIds(new Set(invoices.map(i => i.id)));
      setShowDebtModal(true);
      setDebtBanner(null);
    } else if (owed > 0 && customer?.id) {
      setDebtInvoices([]);
      setShowDebtModal(false);
      setDebtBanner({ customer_id: customer.id, name: customer.name || "", amount: owed });
    } else {
      setDebtBanner(null);
    }
  }, [customerDebtData]);

  // D-2.4 / MP-DOZIE-CART-PREFILL-VALIDATE: Online Cart → POS prefill
  // via the server-side validate RPC. Replaces the prior client-side
  // allProducts cross-lookup (commit 3604342) which suffered from
  // limit=200 truncation and selectedLocation timing races. The RPC
  // resolves product_ids (mappings, then case-insensitive name match
  // scoped to the seller's org), reads stock from pa_stock at the
  // target location, and auto-fills the cart row's mappings +
  // location_id on success. Non-stock fields (unit, barcode,
  // min_price, cost_price) still hydrate via /products/:id since the
  // RPC's response is intentionally stock-focused.
  useEffect(() => {
    if (dozieValidateRanRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const fromOnline = params.get("from_online");
    const fromSession = params.get("session") || "";
    if (!fromOnline) return;
    if (!selectedLocation?.id) return; // wait for location to settle
    dozieValidateRanRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post(`/online-cart/${fromOnline}/validate-for-pos`, {
          location_id: selectedLocation.id
        }).then(r => r.data);
        const verdict = res?.data || {};
        if (cancelled) return;
        // RPC v2 returns ok:false with an error code for hard failures
        // (entry_not_pending, org_mismatch, location_not_found,
        // empty_items, entry_not_found). Surface the code and offer a
        // path back to the inbox so the cashier isn't stranded.
        if (!verdict.ok) {
          setValidateModal({
            locationName: selectedLocation?.name || "",
            errorCode: verdict.error || "unknown_error",
            items: []
          });
          return;
        }
        const verdictItems = Array.isArray(verdict.items) ? verdict.items : [];
        if (!verdict.can_proceed) {
          setValidateModal({
            locationName: selectedLocation?.name || "",
            items: verdictItems,
            summary: verdict.summary || null
          });
          return;
        }
        // Hydrate non-stock fields for each resolved item. stock comes
        // from the RPC (qty_available) — that's the authoritative
        // number attemptCheckout will consult.
        const hydrated = await Promise.all(verdictItems.map(async it => {
          try {
            const p = await api.get(`/products/${it.product_id}`).then(r => r.data?.data);
            if (!p) return null;
            return {
              product_id: it.product_id,
              name: p.name || it.name,
              unit: p.unit, barcode: p.barcode,
              quantity: Number(it.qty_requested) || 1,
              unit_price: Number(it.price) || Number(p.sell_price) || 0,
              original_price: Number(p.sell_price) || 0,
              min_price: p.min_price || 0,
              cost_price: p.cost_price,
              stock: Number(it.qty_available)
            };
          } catch { return null; }
        }));
        if (cancelled) return;
        const items = hydrated.filter(Boolean);
        if (!items.length) {
          toast.error(lang === "en" ? "Failed to load cart items" : "Échec du chargement");
          return;
        }
        setCart(items);
        setOnlineCtx({
          id: fromOnline,
          ref: fromOnline.slice(0, 8),
          session: fromSession
        });
        toast.success(lang === "en" ? "Cart prefilled from Dozie order" : "Panier pré-rempli (Dozie)");
      } catch (e) {
        toast.error(e?.response?.data?.message || (lang === "en" ? "Could not load order" : "Échec du chargement"));
      } finally {
        // Strip params so a refresh / re-finalize doesn't re-trigger.
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, clean);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation?.id]);

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
  // MP-CUSTOMER-TYPE-PRICING-TIER (Bug C): wholesale, vip, AND
  // garage all use wholesale_price. Only retail (and the Dozie
  // marketplace flow, which doesn't reach this handler) fall
  // back to sell_price. Pre-fix: only wholesale picked the tier;
  // VIP customers were charged sell_price (VNT-0002 repro).
  const TIER_TYPES = ["wholesale", "vip", "garage"];
  const isTierCustomer = (cust) => TIER_TYPES.includes(cust?.customer_type);
  const getPrice = (product) => {
    if (isTierCustomer(customer) && product.wholesale_price > 0) {
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
    // MP-INVOICE-DISPLAY-NET-OF-RETURNS (Bug B): use effective
    // balance (post net-of-refund-credit-portion) for cart totals
    // and per-invoice display. Falls back to raw balance_due on
    // legacy API responses that haven't been redeployed yet.
    const totalAmt = selected.reduce((s, i) =>
      s + parseFloat(i.effective_balance_due ?? i.balance_due), 0);
    const refs = selected.map(i => i.sale_number).join(", ");
    setCart(prev => [
      ...prev.filter(i => i.product_id !== "__DEBT__"),
      { product_id: "__DEBT__", name: `${lang === "en" ? "Debt repayment" : "Remboursement"} (${refs})`, unit: "pce", quantity: 1, unit_price: totalAmt, cost_price: 0, isDebt: true, debtSaleIds: selected.map(i => i.id), debtAmount: totalAmt }
    ]);
    setShowDebtModal(false);
    setShowPayment(true);
  };

  // MP-POS-DEBT-CART-FLOW: add the manual/paper debt as an editable,
  // removable cart LINE ITEM (type:'debt_payment'). It then rides the
  // NORMAL cart → checkout → pay flow; the backend reduces total_debt
  // and writes a sale-linked payment on sale completion. NOTHING is
  // collected here.
  const addDebtPaymentToCart = () => {
    if (!debtBanner) return;
    setCart(prev => [
      ...prev.filter(i => i.product_id !== "__DEBT_PAYMENT__"),
      {
        product_id: "__DEBT_PAYMENT__", type: "debt_payment",
        name: `${lang === "en" ? "Debt Repayment" : "Remboursement dette"} (${debtBanner.name})`,
        unit: "pce", quantity: 1, unit_price: debtBanner.amount, cost_price: 0,
        isDebtPayment: true, customer_id: debtBanner.customer_id, debtMax: debtBanner.amount
      }
    ]);
    setDebtBanner(null);
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
    // Staff: block below min price with an explicit toast so the
    // cashier knows WHY the price reverted. Backend at sales.js:46-62
    // would also reject — this just gives clearer feedback before
    // they get to checkout. No override path; owner must intervene.
    if (minPrice > 0 && newPrice < minPrice) {
      toast.error(lang === "en"
        ? `Minimum price: ${minPrice.toLocaleString()} FCFA — ask the owner`
        : `Prix minimum: ${minPrice.toLocaleString()} FCFA — demandez au propriétaire`);
      return;
    }
    setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: newPrice } : it));
  };

  // The qty/price fields are <input type=number>. Clearing the
  // highlighted digits (Delete) fires onChange with value "", and
  // `+"" === 0` previously hit updateQty(idx,0) → the line was
  // filtered out. Tolerate a transient empty value (line stays,
  // digits cleared) and only normalise on blur. Removal stays
  // explicit via the ✕ button / decrementing below 1.
  const onQtyInput = (idx, raw) => {
    if (raw === "") {
      setCart(c => c.map((it, i) => i === idx ? { ...it, quantity: "" } : it));
      return;
    }
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return; // ignore 0/garbage mid-typing
    setCart(c => c.map((it, i) => i === idx ? { ...it, quantity: n } : it));
  };
  const onQtyBlur = (idx) => setCart(c => c.map((it, i) => {
    if (i !== idx) return it;
    const n = parseInt(it.quantity, 10);
    return (isNaN(n) || n < 1) ? { ...it, quantity: 1 } : { ...it, quantity: n };
  }));
  const onPriceInput = (idx, raw) => {
    if (raw === "") {
      setCart(c => c.map((it, i) => i === idx ? { ...it, unit_price: "" } : it));
      return;
    }
    updatePrice(idx, raw);
  };
  const onPriceBlur = (idx) => setCart(c => c.map((it, i) => {
    if (i !== idx) return it;
    const p = parseFloat(it.unit_price);
    return (isNaN(p) || p < 0)
      ? { ...it, unit_price: it.original_price || it.min_price || 0 }
      : it;
  }));

  const total   = cart.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const hasDebt = cart.some(i => i.product_id === "__DEBT__");
  // MP-DEBT-ONLY-PARTIAL-PAY-FIX: detect carts that contain ONLY debt
  // lines (legacy __DEBT__ invoice-settle, or new debt_payment line, or
  // both). Such carts use the AMOUNT TO COLLECT input — the 3-mode
  // Paid/Partial/Credit picker doesn't apply (you can't extend further
  // credit on a debt repayment, and "partial" needs its own field).
  // The input is wired to debtPayAmt (existing state, previously only
  // read by the legacy __DEBT__ allocation loop).
  const isDebtOnlyCart = cart.length > 0 && cart.every(i =>
    i.product_id === "__DEBT__" || i.type === "debt_payment");
  const paid    = isDebtOnlyCart
    ? (debtPayAmt ? Math.min(+debtPayAmt, total) : total)
    : (payMode === "paid" ? total : payMode === "credit" ? 0 : (+paidAmt || 0));
  const balance = total - paid;

  const saleMutation = useMutation({
    mutationFn: async () => {
      // MP-CART-INVOICE-PRODUCT-BUG: the legacy invoice-settle path
      // (POST /sales/:id/payment per invoice) is ONLY correct when
      // the cart is a pure invoice-settle action — a single __DEBT__
      // line aggregating selected invoices and nothing else. If the
      // cart ALSO has product lines or new debt_payment lines, take
      // Path A (create a new sale) so:
      //   - products land in pa_sale_items / decrement stock
      //   - the partial-pay amount the user typed is honoured
      //   - the __DEBT__ line converts to a generic debt_payment
      //     line on the new sale, reducing customer.total_debt
      //     without settling the specific source invoices (they
      //     stay open at their per-invoice balance — same model
      //     the verify spec describes).
      const debtItem        = cart.find(i => i.product_id === "__DEBT__");
      const productItems    = cart.filter(i => i.product_id && i.product_id !== "__DEBT__" && i.type !== "debt_payment");
      const newDebtItems    = cart.filter(i => i.type === "debt_payment");
      const isPureInvoiceSettle = !!debtItem && productItems.length === 0 && newDebtItems.length === 0;

      if (isPureInvoiceSettle) {
        const totalDebt  = debtItem.debtAmount;
        const amountToPay = debtPayAmt ? Math.min(parseFloat(debtPayAmt), totalDebt) : totalDebt;
        let remaining = amountToPay;
        // MP-POS-COLLECT-DEBT-CART-NO-RECEIPT (Bug A): capture each
        // /sales/:id/payment response so onSuccess can aggregate
        // them into a debt_collection-shape receipt payload.
        // Same fix family as commit 4c64605 (CreditsPage), now
        // covering the multi-invoice POS-cart path.
        const responses = [];
        for (const saleId of debtItem.debtSaleIds) {
          if (remaining <= 0) break;
          const inv = debtInvoices.find(i => i.id === saleId);
          if (!inv) continue;
          // MP-INVOICE-DISPLAY-NET-OF-RETURNS (Bug B): cap at
          // effective_balance_due (after-refund-credit-portion)
          // not raw balance_due. Falls back to balance_due on
          // older API responses that don't carry effective yet.
          const cap = parseFloat(inv.effective_balance_due ?? inv.balance_due);
          const payThis = Math.min(remaining, cap);
          const r = await api.post(`/sales/${saleId}/payment`, { amount: payThis, payment_method: payMethod, notes: notes || null });
          responses.push(r?.data?.data || {});
          remaining -= payThis;
        }
        return { isDebt: true, responses, totalPaid: amountToPay };
      }

      const salePayload = {
        location_id:    selectedLocation?.id,
        customer_id:    customer?.id || null,
        // MP-POS-DEBT-CART-FLOW + MP-CART-INVOICE-PRODUCT-BUG: every
        // non-product cart line goes to the backend as a
        // debt_payment line. That includes the legacy __DEBT__
        // sentinel when it appears alongside products (the mixed
        // cart case fixed here) — it is converted into the generic
        // debt_payment shape so the backend reduces total_debt
        // generically. product_id:null + type so the backend never
        // runs them through stock / min-price / pa_sale_items.
        items:          cart.map(i => {
                          if (i.type === "debt_payment") {
                            return { type: "debt_payment", product_id: null, quantity: 1, unit_price: Number(i.unit_price) || 0, customer_id: i.customer_id };
                          }
                          if (i.product_id === "__DEBT__") {
                            // MP-CART-DEBT-LINE-FIFO-APPLY: preserve the
                            // Open Invoices modal's checkbox selection.
                            // Backend applies the debt-collection to
                            // these invoice IDs in this exact order
                            // (then FIFO fallback over the customer's
                            // other open invoices for any remainder).
                            return {
                              type: "debt_payment",
                              product_id: null,
                              quantity: 1,
                              unit_price: Number(i.unit_price) || 0,
                              customer_id: customer?.id,
                              target_sale_ids: Array.isArray(i.debtSaleIds) && i.debtSaleIds.length
                                ? i.debtSaleIds
                                : undefined,
                            };
                          }
                          return { product_id: i.product_id, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0, cost_price: i.cost_price };
                        }),
        payment_method: payMethod,
        paid_amount:    paid,
        due_date:       dueDate || null,
        notes:          notes || null,
      };

      // MP-OFFLINE-WARNING-FALSE-POSITIVE: the SW used to intercept
      // this with a 2s timeout and return {offline:true} on slow
      // responses, which caused successful-but-slow sales to be
      // misclassified as offline (yellow warning, no receipt). The
      // SW intercept is now a no-op (public/sw-offline-sales.js
      // header comment explains why); requests go straight to the
      // network and real failures land in onError below.
      const result = await api.post("/sales", salePayload).then(r => r.data);
      return result;
    },
    onSuccess: (data) => {
      const resetCart = () => {
        setCart([]); setCustomer(null); setPayMode("paid");
        setPaidAmt(""); setDueDate(""); setNotes(""); setShowPayment(false);
        setDebtInvoices([]); setSelectedDebtIds(new Set()); setDebtPayAmt("");
        setDebtBanner(null);
        setOnlineCtx(null);
      };

      // (Previous data?.offline branch removed — see fetch comment
      // above. The SW no longer returns the fake offline shape, so
      // any response landing here is a genuine backend response.)
      if (data?.isDebt) {
        toast.success(lang === "en" ? "✓ Debt payment recorded!" : "✓ Remboursement enregistré!", { duration: 2000 });
        // MP-POS-COLLECT-DEBT-CART-NO-RECEIPT (Bug A): aggregate
        // per-invoice responses into a debt_collection-shape
        // payload so the shared receipt component renders with
        // applied_to_invoices breakdown + customer debt
        // before/after. For single-invoice carts this also
        // surfaces a receipt (was silently toast-only before).
        const responses = data.responses || [];
        if (responses.length > 0) {
          const first = responses[0];
          const last  = responses[responses.length - 1];
          const applied_to_invoices = responses.map(r => ({
            sale_id:     r.sale_id,
            sale_number: r.sale_number,
            applied:     Number(r.amount) || 0,
          }));
          setDebtReceiptEvent({
            data: {
              // Multi-invoice has no single sale_number to encode
              // in the QR; if exactly one invoice, use its
              // sale_number so QR renders. Otherwise null = no QR
              // (the receipt just shows the applied_to_invoices
              // list which is the relevant info anyway).
              sale_number:    responses.length === 1 ? first.sale_number : null,
              amount:         Number(data.totalPaid) || 0,
              payment_method: first.payment_method,
              applied_to_invoices,
              ghost_portion:  0,
              debt_before:    first.debt_before,
              debt_after:     last.debt_after,
              customer_id:    first.customer_id,
              customer_name:  first.customer_name,
              customer_phone: first.customer_phone,
              cashier_name:   first.cashier_name,
              location_id:    first.location_id,
              location_name:  first.location_name,
              shift_id:       first.shift_id,
            }
          });
        }
      } else {
        // D-2.4: link the new sale back to its Online Cart entry so
        // the entry moves to Completed, void can reverse it, and
        // reporting can trace Dozie origin. Captured locally because
        // resetCart() nulls onlineCtx right after. The sale is
        // already persisted — a link failure must NOT be silent
        // (the old empty .catch left entries stuck pending forever),
        // so we surface it and tell the cashier to reconcile.
        const saleId = data?.data?.id || data?.id;
        const oc = onlineCtx;
        if (oc?.id && saleId) {
          api.post(`/online-cart/${oc.id}/link-sale`, {
            sale_id: saleId,
            cart_session_id: oc.session || undefined
          })
            .then(() => toast.success(lang === "en"
              ? "Sale recorded and linked to Online Cart entry"
              : "Vente enregistrée et liée au Panier en ligne", { duration: 4000 }))
            .catch((err) => {
              console.error("[online-cart] link-sale failed:", err?.response?.data || err?.message || err);
              toast(lang === "en"
                ? "Sale saved, but linking it to the Online Cart entry failed — reconcile it from the Online Cart page."
                : "Vente enregistrée, mais le lien au Panier en ligne a échoué — à réconcilier depuis le Panier en ligne.",
                { duration: 7000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
            });
        }
        setLastSale({
          // /sales returns { success, data: fullSale }. Spreading
          // `data` only exposed { success, data } — so sale.sale_number
          // was undefined and the receipt's VNT-*/Code128/QR (all
          // gated on sale_number) silently rendered nothing. Spread
          // the actual sale row.
          ...(data?.data || data),
          customer,
          items: cart,
          // MP-CART-INVOICE-PRODUCT-BUG: the legacy `hasDebt ? total
          // : paid` ternary lied for mixed-cart Path A — it claimed
          // paid_amount = total whenever the cart had a __DEBT__
          // line, masking the user's actual partial payment. Use
          // the real values; backend sets the same on pa_sales.
          paid_amount: paid,
          balance_due: balance,
          payment_method: payMethod,
          // MP-RECEIPT-PAID-IN-FULL-BUG: don't use payMode here.
          // For debt-only carts the 3-mode picker is hidden and
          // payMode stays at the default "paid" — even when the
          // cashier partial-paid via AMOUNT TO COLLECT — so the
          // status badge in the receipt modal said "PAID IN FULL"
          // for genuine partials. Compute from paid vs total so
          // the badge can never disagree with the rendered
          // amounts below it. Matches the backend's own derivation
          // and the values backend writes to pa_sales.
          payment_status:
            paid >= total ? "paid" :
            paid > 0      ? "partial" :
                            "credit",
        });
        setShowReceipt(true);
      }
      resetCart();
      // MP-INVALIDATE-AFTER-SALE: a sale moves stock + sales + dashboard
      // + reports + low-stock. RQ matches keys by array prefix, and these
      // families use distinct first elements (e.g. "stock" vs "stock-all"
      // vs "stock-alerts", and "reports-*"), so a single ["stock"] call
      // would miss most. Use a predicate that names every affected
      // first-key (and the reports-* family) so every dependent view
      // refetches immediately.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey && q.queryKey[0];
          if (typeof k !== "string") return false;
          return (
            k === "stock" || k === "stock-all" || k === "stock-alerts" || k === "stock-count" ||
            k === "products-all" || k === "products-barcode" || k === "pos-products" ||
            k === "recent-sales" || k === "daily-summary" || k === "overdue-credits" ||
            k === "pos-customers" || k === "customer-debt" || k === "credits" ||
            k === "customers" || k === "customer-summary" ||
            k.startsWith("reports-")
          );
        }
      });
      saleMutation.reset();
    },
    onError: (err) => {
      const d = err.response?.data;
      if (d?.code === "NOT_STOCKED_AT_LOCATION") {
        // Backend is the source of truth — show the blocking modal
        // even if the frontend stock snapshot looked fine.
        setBlockModal({
          locationName: d.location_name || selectedLocation?.name || "",
          products: (d.products || []).map(p => p.name).filter(Boolean),
          message: d.message
        });
        return;
      }
      // MP-OFFLINE-WARNING-FALSE-POSITIVE: no err.response means the
      // request never reached the server (network down, DNS failure,
      // CORS). Be honest about it — don't pretend it was saved
      // offline, because the SW's offline-queue is disabled until
      // it's redesigned safely. The cashier should retry.
      if (!err.response) {
        toast.error(lang === "en"
          ? "Network error — check your connection and retry"
          : "Erreur réseau — vérifiez votre connexion et réessayez",
          { duration: 5000 });
        return;
      }
      toast.error(d?.message || "Error");
    }
  });

  // Bugs 2 & 3: gate the sale before it's submitted.
  //  • Not stocked at this location → HARD block (no proceed).
  //  • qty > available → WARN, allow "Sell anyway".
  // Synthetic lines carry no real stock — skip them from every
  // inventory check: __DEBT__ (invoice settle) and, per MP-POS-DEBT-
  // LINE-LOCATION-FIX, __DEBT_PAYMENT__ / type:'debt_payment' (manual
  // debt). Debt is org-level, never location-stocked.
  const runCheckout = () => { setOversellModal(null); saleMutation.mutate(); };
  const attemptCheckout = () => {
    const real = cart.filter(i =>
      i.product_id && i.product_id !== "__DEBT__" &&
      i.product_id !== "__DEBT_PAYMENT__" && i.type !== "debt_payment");
    const notStocked = real.filter(i => i.stock === null || i.stock === undefined);
    if (notStocked.length) {
      setBlockModal({
        locationName: selectedLocation?.name || "",
        products: notStocked.map(i => i.name),
        message: null
      });
      return;
    }
    const oversold = real
      .filter(i => typeof i.stock === "number" && i.quantity > i.stock)
      .map(i => ({ name: i.name, available: i.stock, selling: i.quantity }));
    if (oversold.length) { setOversellModal({ items: oversold }); return; }
    runCheckout();
  };

  // ── HOLD SALE (park & resume) ────────────────────────────────────
  // Active holds for this org+location (a hold at Bonaberri is not
  // visible at Bepanda — backend scopes by org and we filter by the
  // selected location). Backend lazily expires stale rows on read.
  const { data: heldData } = useQuery({
    queryKey: ["held-carts", selectedLocation?.id],
    queryFn: () => api.get("/held-carts?status=active"
      + (selectedLocation?.id ? "&location_id=" + selectedLocation.id : "")).then(r => r.data),
    enabled: !!selectedLocation?.id,
    staleTime: 15000,
    refetchOnWindowFocus: true,
  });
  const activeHolds = heldData?.data || [];

  const holdMutation = useMutation({
    mutationFn: async () => {
      // Exclude both debt sentinels from holds: invoice-settle (__DEBT__)
      // and manual debt repayment (__DEBT_PAYMENT__ / type:'debt_payment').
      // Debt is a live, customer-bound cashier action — parking it would
      // persist a bogus product_id and corrupt the line on resume.
      const items = cart
        .filter(i => i.product_id && i.product_id !== "__DEBT__" &&
                     i.product_id !== "__DEBT_PAYMENT__" &&
                     i.type !== "debt_payment")
        .map(i => {
          const qty = Number(i.quantity) || 1;
          const unit = Number(i.unit_price) || 0;
          return { product_id: i.product_id, qty, unit_price: unit,
                   line_total: qty * unit, notes: i.notes || null };
        });
      if (!items.length) throw new Error("empty");
      const res = await api.post("/held-carts", {
        location_id: selectedLocation?.id,
        customer_id: customer?.id || null,
        label: holdLabel.trim() || null,
        notes: holdNotes.trim() || null,
        items,
      }).then(r => r.data);
      return res?.data;
    },
    onSuccess: (row) => {
      setShowHold(false); setHoldLabel(""); setHoldNotes("");
      setCart([]); setCustomer(null); setOnlineCtx(null);
      setShowPayment(false); setPayMode("paid"); setPaidAmt("");
      toast.success(lang === "en"
        ? `Sale held as ${row.hold_ref}` : `Vente mise en attente : ${row.hold_ref}`,
        { duration: 4000 });
      setHeldTicket(row);                 // open the Hold Ticket print
      qc.invalidateQueries(["held-carts"]);
      holdMutation.reset();
    },
    onError: (err) => {
      toast.error(err?.message === "empty"
        ? (lang === "en" ? "Cart is empty" : "Panier vide")
        : (err?.response?.data?.message || (lang === "en" ? "Could not hold sale" : "Échec de la mise en attente")));
    }
  });

  // Repopulate the POS cart from a held cart. Items carry
  // current_stock from the backend; we hydrate each product so the
  // resumed line matches addToCart()'s shape (min/cost/original
  // price) and set `stock` so the existing oversell gate at checkout
  // warns (never blocks) on lines that no longer have enough stock.
  const resumeHold = async (id) => {
    try {
      const res = await api.post(`/held-carts/${id}/resume`).then(r => r.data);
      const h = res?.data;
      const held = h?.items || [];
      const hydrated = await Promise.all(held.map(async it => {
        let p = null;
        try { p = await api.get(`/products/${it.product_id}`).then(r => r.data?.data); } catch { /* ignore */ }
        return {
          product_id: it.product_id,
          name: it.name || p?.name || "—",
          unit: p?.unit, barcode: p?.barcode,
          quantity: Number(it.qty) || 1,
          unit_price: Number(it.unit_price) || Number(p?.sell_price) || 0,
          original_price: Number(p?.sell_price) || 0,
          min_price: p?.min_price || 0,
          cost_price: p?.cost_price,
          stock: it.current_stock != null ? Number(it.current_stock) : null,
        };
      }));
      setCart(hydrated);
      setCustomer(null);
      setShowResume(false);
      const short = hydrated.filter(i => typeof i.stock === "number" && i.quantity > i.stock);
      toast.success(lang === "en"
        ? `Resumed ${h.hold_ref}` : `Reprise ${h.hold_ref}`, { duration: 3000 });
      if (short.length) {
        toast(lang === "en"
          ? `⚠️ Low stock: ${short.map(i => `${i.name} (${i.stock} left, ${i.quantity} held)`).join("; ")}. Adjust before completing.`
          : `⚠️ Stock faible : ${short.map(i => `${i.name} (${i.stock} restant, ${i.quantity} en attente)`).join("; ")}. Ajustez avant de finaliser.`,
          { duration: 8000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
      qc.invalidateQueries(["held-carts"]);
    } catch (err) {
      const code = err?.response?.data?.code;
      toast.error(code
        ? (lang === "en" ? `Hold already ${code}` : `Attente déjà ${code}`)
        : (err?.response?.data?.message || (lang === "en" ? "Could not resume" : "Échec de la reprise")));
      qc.invalidateQueries(["held-carts"]);
    }
  };

  const confirmCancelHold = async () => {
    if (!cancelTarget) return;
    try {
      await api.post(`/held-carts/${cancelTarget.id}/cancel`, { reason: cancelReason });
      toast.success(lang === "en" ? "Hold cancelled" : "Attente annulée");
    } catch (err) {
      toast.error(err?.response?.data?.message || (lang === "en" ? "Could not cancel" : "Échec de l'annulation"));
    }
    setCancelTarget(null); setCancelReason("changed_mind");
    qc.invalidateQueries(["held-carts"]);
  };

  // Scan-to-resume: Layout routes HLD-* scans here as ?hold=HLD-XXXX.
  // Look up by ref; if active, open the Resume picker so the cashier
  // confirms; otherwise tell them why it can't be resumed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("hold");
    if (!ref) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/held-carts/by-ref/${encodeURIComponent(ref)}`).then(r => r.data);
        const h = res?.data;
        if (cancelled) return;
        if (h?.status === "active") setShowResume(true);
        else toast(lang === "en"
          ? `Hold ${ref} is ${h?.status || "unavailable"}.`
          : `L'attente ${ref} est ${h?.status || "indisponible"}.`,
          { duration: 5000 });
      } catch {
        if (!cancelled) toast.error(lang === "en"
          ? `No active hold matches ${ref}` : `Aucune attente active pour ${ref}`);
      } finally {
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, clean);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                      {/* MP-INVOICE-DISPLAY-NET-OF-RETURNS (Bug B):
                          effective_balance_due is balance_due
                          minus the sum of audit-logged credit-
                          portion reversals from prior refunds.
                          Falls back to balance_due on older API
                          responses. */}
                      <div style={{ fontWeight: 700, color: "#f87171", fontSize: 14 }}>
                        {formatCFA(inv.effective_balance_due ?? inv.balance_due)}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{inv.payment_status}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Optional residual line: customer.total_debt minus
                sum of effective invoice balances. Surfaces paper-
                record debt (ghost-residual from cart-debt-line
                carryover, manual adjustments, collect_debt_no_
                invoice ghosts) that has no backing invoice. */}
            {debtPaperBalance > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", marginBottom: 8, fontSize: 12, color: "var(--text-muted)", borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
                <span>{lang === "en" ? "Previous balance" : "Solde antérieur"}</span>
                <span style={{ fontWeight: 600 }}>{formatCFA(debtPaperBalance)}</span>
              </div>
            )}
            {selectedDebtIds.size > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{lang === "en" ? "To collect:" : "À encaisser :"}</span>
                <strong style={{ color: "#f87171" }}>{formatCFA(debtInvoices.filter(i => selectedDebtIds.has(i.id)).reduce((s, i) => s + parseFloat(i.effective_balance_due ?? i.balance_due), 0))}</strong>
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

      {/* MP-POS-DEBT-CART-FLOW: non-blocking debt banner. Explicit
          cashier choice — Add-to-Cart (editable line item) or Skip.
          NOTHING is auto-collected. */}
      {debtBanner && (
        <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100, maxWidth: 460, width: "calc(100% - 24px)", background: "var(--bg-card)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: 12, padding: "12px 16px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", fontSize: 13 }}>
            ⚠️ {lang === "en"
              ? <>This customer owes <strong style={{ color: "#f87171" }}>{formatCFA(debtBanner.amount)}</strong>. Add debt payment to cart?</>
              : <>Ce client doit <strong style={{ color: "#f87171" }}>{formatCFA(debtBanner.amount)}</strong>. Ajouter au panier ?</>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDebtBanner(null)}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              {lang === "en" ? "Skip — sale only" : "Ignorer"}
            </button>
            <button onClick={addDebtPaymentToCart}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              {lang === "en" ? "Add to Cart" : "Ajouter au panier"}
            </button>
          </div>
        </div>
      )}

      {showCamera && (
        <CameraScanner lang={lang} onScan={(code) => { setShowCamera(false); scanBarcode(code); }} onClose={() => setShowCamera(false)} />
      )}

      {/* MP-CASH-SHIFTS-UI: outer column so the shift indicator sits
          on top without breaking the left/right panel layout. */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)" }}>
        <div style={{ padding: "10px 14px 0 14px" }}>
          <ActiveShiftIndicator />
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: mobile ? "column" : "row" }}>

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
                  {isTierCustomer(customer) && (
                    <div style={{ fontSize: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24", padding: "2px 8px", borderRadius: 10, fontWeight: 700, marginTop: 2, display: "inline-block" }}>
                      🏷 {lang === "en" ? "Tier prices applied" : "Prix préférentiels appliqués"}
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
                <button onClick={() => { setCustomer(null); setDebtInvoices([]); setSelectedDebtIds(new Set()); setDebtBanner(null); setCart(c => c.filter(i => i.product_id !== "__DEBT__" && i.product_id !== "__DEBT_PAYMENT__")); }}
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
                      {formatCFA(isTierCustomer(customer) && p.wholesale_price > 0 ? p.wholesale_price : p.sell_price)}
                      {isTierCustomer(customer) && p.wholesale_price > 0 && (
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
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {activeHolds.length > 0 && (
                <button onClick={() => setShowResume(true)}
                  title={lang === "en" ? "Resume a held sale" : "Reprendre une vente en attente"}
                  style={{ background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", color: "#fbbf24", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6 }}>
                  ⏸ {lang === "en" ? "Resume" : "Reprendre"} ({activeHolds.length})
                </button>
              )}
              {cart.length > 0 && (
                <button onClick={() => setCart([])} style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6 }}>
                  {lang === "en" ? "Clear all" : "Vider"}
                </button>
              )}
            </div>
          </div>

          {onlineCtx && (
            <div style={{ padding: "8px 14px", background: "rgba(79,70,229,0.12)", borderBottom: "1px solid rgba(79,70,229,0.3)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>📥</span>
              <span style={{ fontSize: 11, color: "var(--brand-light)", fontWeight: 600, flex: 1, minWidth: 0 }}>
                {lang === "en"
                  ? `Prefilled from Dozie order ${onlineCtx.ref} — sale links back on checkout`
                  : `Pré-rempli depuis Dozie ${onlineCtx.ref} — la vente sera liée`}
              </span>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>🛒</div>
                <div style={{ fontSize: 12 }}>{lang === "en" ? "Cart is empty" : "Panier vide"}</div>
              </div>
            ) : cart.map((item, idx) => (
              <div key={idx} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: (item.isDebt || item.isDebtPayment) ? "rgba(239,68,68,0.04)" : "transparent" }}>
                {(item.isDebt || item.isDebtPayment) && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    {item.isDebtPayment ? "💰" : "🧾"} {lang === "en" ? "Debt Repayment" : "Remboursement dette"} · DEBT
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: (item.isDebt || item.isDebtPayment) ? 4 : 7 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, paddingRight: 8, lineHeight: 1.3 }}>{item.name}</div>
                  <button onClick={() => updateQty(idx, 0)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✕</button>
                </div>
                {item.isDebt ? (
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171", textAlign: "right" }}>{formatCFA(item.unit_price)}</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => updateQty(idx, item.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    <input type="number" value={item.quantity} onChange={e => onQtyInput(idx, e.target.value)} onBlur={() => onQtyBlur(idx)} style={{ width: 40, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 4px", fontSize: 13 }} />
                    <button onClick={() => updateQty(idx, item.quantity + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    <div style={{ flex: 1, position: "relative" }}>
                      <input type="number" value={item.unit_price} onChange={e => onPriceInput(idx, e.target.value)} onBlur={() => onPriceBlur(idx)} style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px 6px 4px 18px", fontSize: 12 }} />
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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn-primary btn-block" disabled={cart.length === 0 || !selectedLocation} onClick={() => setShowPayment(true)} style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12 }}>
                  {!selectedLocation ? (lang === "en" ? "Select location first" : "Choisir emplacement") : hasDebt ? (lang === "en" ? "Collect Payment →" : "Encaisser →") : (lang === "en" ? "Proceed to Payment →" : "Paiement →")}
                </button>
                {!hasDebt && (
                  <button disabled={cart.length === 0 || !selectedLocation} onClick={() => { setHoldLabel(""); setHoldNotes(""); setShowHold(true); }}
                    style={{ height: 40, fontSize: 13, fontWeight: 700, borderRadius: 12, cursor: cart.length === 0 ? "not-allowed" : "pointer", background: "transparent", border: "1.5px solid rgba(245,158,11,0.5)", color: cart.length === 0 ? "var(--text-muted)" : "#fbbf24", opacity: cart.length === 0 || !selectedLocation ? 0.5 : 1 }}>
                    ⏸ {lang === "en" ? "Hold Sale" : "Mettre en attente"}
                  </button>
                )}
              </div>
            ) : (
              <div>
                {isDebtOnlyCart && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                      {lang === "en" ? "Amount to collect (blank = full balance)" : "Montant à encaisser (vide = tout)"}
                    </div>
                    <input className="input" type="number"
                      placeholder={`${lang === "en" ? "Full balance:" : "Solde total:"} ${total.toLocaleString()} FCFA`}
                      value={debtPayAmt} onChange={e => setDebtPayAmt(e.target.value)}
                      style={{ marginBottom: 4 }} />
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {lang === "en" ? "Leave blank to collect full balance" : "Laissez vide pour encaisser le solde total"}
                    </div>
                  </div>
                )}
                {!isDebtOnlyCart && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                    {PAYMENT_MODES.map(pm => (
                      <button key={pm.key} onClick={() => setPayMode(pm.key)} style={{ padding: "8px 4px", borderRadius: 10, border: `1.5px solid ${payMode === pm.key ? pm.color : "var(--border)"}`, background: payMode === pm.key ? pm.color + "18" : "transparent", color: payMode === pm.key ? pm.color : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.15s" }}>
                        <div style={{ fontSize: 14 }}>{pm.icon}</div>
                        <div style={{ marginTop: 2 }}>{lang === "en" ? pm.en : pm.fr}</div>
                      </button>
                    ))}
                  </div>
                )}
                {payMode === "partial" && !isDebtOnlyCart && (
                  <input className="input" type="number" placeholder={lang === "en" ? "Amount paid (FCFA)" : "Montant payé (FCFA)"} value={paidAmt} onChange={e => setPaidAmt(e.target.value)} style={{ marginBottom: 8 }} />
                )}
                {(payMode === "partial" || payMode === "credit") && !isDebtOnlyCart && (
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
                    <strong style={{ color: "#10b981" }}>{formatCFA(paid)}</strong>
                  </div>
                  {balance > 0 && !hasDebt && (
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)", marginTop: 3 }}>
                      <span style={{ color: "#f87171", fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste"}</span>
                      <strong style={{ color: "#f87171" }}>{formatCFA(balance)}</strong>
                    </div>
                  )}
                </div>
                {!shiftIsOpen && (
                  <div style={{ padding: "8px 12px", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 8, textAlign: "center" }}>
                    {noShiftHint(lang)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowPayment(false)} className="btn btn-secondary" style={{ flex: 1 }}>← {lang === "en" ? "Back" : "Retour"}</button>
                  {(payMode === "credit" || payMode === "partial") && !customer && (
                    <div style={{ gridColumn: "1/-1", padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, fontSize: 12, color: "#f87171", marginBottom: 8 }}>
                      ⚠️ {lang === "en" ? "A registered customer is required for credit or partial sales." : "Un client enregistré est requis pour les ventes à crédit ou partielles."}
                    </div>
                  )}
                  <button onClick={attemptCheckout} disabled={!shiftIsOpen || saleMutation.isPending || (!hasDebt && payMode === "partial" && !paidAmt) || ((payMode === "credit" || payMode === "partial") && !customer)} title={!shiftIsOpen ? noShiftHint(lang) : ""} className="btn btn-success" style={{ flex: 2, fontWeight: 700 }}>
                    {saleMutation.isPending ? "⏳" : (lang === "en" ? "✓ Confirm" : "✓ Valider")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>{/* /MP-CASH-SHIFTS-UI outer column */}
      {/* ── BUG 2: HARD BLOCK — product not stocked at this location ── */}
      {blockModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 14, width: "100%", maxWidth: 460, padding: 22 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⛔</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>
              {lang === "en" ? "Cannot sell here" : "Vente impossible ici"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
              {blockModal.message || (lang === "en"
                ? <>These products are not stocked at <strong>{blockModal.locationName || "this location"}</strong>:</>
                : <>Ces produits ne sont pas en stock à <strong>{blockModal.locationName || "ce site"}</strong> :</>)}
              <ul style={{ margin: "8px 0 0 18px" }}>
                {(blockModal.products || []).map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
              </ul>
              <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
                {lang === "en"
                  ? "Transfer stock to this location, remove the item, or switch the sale location."
                  : "Transférez le stock vers ce site, retirez l'article, ou changez le site de vente."}
              </div>
            </div>
            <button onClick={() => setBlockModal(null)} className="btn btn-primary btn-block" style={{ fontWeight: 700 }}>
              {lang === "en" ? "OK, I'll fix it" : "OK, je corrige"}
            </button>
          </div>
        </div>
      )}

      {/* ── MP-DOZIE-CART-PREFILL-VALIDATE: result modal from the
            online_cart_validate_for_pos RPC. Two variants:
              • errorCode set → hard failure (entry_not_pending,
                org_mismatch, etc.); offer "Back to inbox"
              • items set     → can_proceed=false; per-item status
                badges with informational guidance (transfer /
                partial-fulfill / substitution are deferred). ── */}
      {validateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 14, width: "100%", maxWidth: 520, padding: 22 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>{validateModal.errorCode ? "⛔" : "⚠️"}</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>
              {validateModal.errorCode
                ? (lang === "en" ? "Cannot open this online cart" : "Impossible d'ouvrir ce panier")
                : (lang === "en" ? "Cannot complete this order here" : "Impossible de finaliser ici")}
            </div>
            {validateModal.errorCode ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
                {(() => {
                  const c = validateModal.errorCode;
                  const map = {
                    entry_not_found:    lang === "en" ? "Online cart entry not found." : "Panier en ligne introuvable.",
                    entry_not_pending:  lang === "en" ? "This online cart has already been processed." : "Ce panier en ligne a déjà été traité.",
                    org_mismatch:       lang === "en" ? "Location does not belong to this organisation." : "Le site n'appartient pas à cette organisation.",
                    location_not_found: lang === "en" ? "Selected location is invalid." : "Le site sélectionné est invalide.",
                    empty_items:        lang === "en" ? "This online cart has no items." : "Ce panier en ligne n'a aucun article."
                  };
                  return map[c] || (lang === "en" ? "Validation failed." : "Échec de validation.");
                })()}
                <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  code: {validateModal.errorCode}
                </div>
              </div>
            ) : (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
              {lang === "en"
                ? <>Stock check at <strong>{validateModal.locationName || "this location"}</strong>:</>
                : <>Vérification du stock à <strong>{validateModal.locationName || "ce site"}</strong> :</>}
              <ul style={{ margin: "10px 0 0 0", padding: 0, listStyle: "none" }}>
                {(validateModal.items || []).map((it, i) => {
                  const palette = it.status === "ok"
                    ? { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.4)", fg: "#10b981" }
                    : it.status === "insufficient"
                    ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", fg: "#f59e0b" }
                    : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", fg: "#ef4444" };
                  const badge = it.status === "ok"
                    ? (lang === "en" ? "OK" : "OK")
                    : it.status === "insufficient"
                    ? (lang === "en" ? "Insufficient" : "Insuffisant")
                    : (lang === "en" ? "Not in catalog" : "Hors catalogue");
                  return (
                    <li key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: palette.bg, border: `1px solid ${palette.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {lang === "en"
                            ? `requested ${Number(it.qty_requested) || 0} · available ${Number(it.qty_available) || 0}`
                            : `demandé ${Number(it.qty_requested) || 0} · disponible ${Number(it.qty_available) || 0}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: palette.fg, padding: "3px 8px", borderRadius: 999, border: `1px solid ${palette.border}`, whiteSpace: "nowrap" }}>
                        {badge}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
                {lang === "en"
                  ? "Transfer stock from another location, remove unmatched items in the inbox, or switch to a store that carries them."
                  : "Transférez du stock depuis un autre site, retirez les articles non reconnus dans la boîte de réception, ou passez à un site qui les a en stock."}
              </div>
            </div>
            )}
            {validateModal.errorCode ? (
              <button onClick={() => { setValidateModal(null); navigate("/online-cart"); }} className="btn btn-primary btn-block" style={{ fontWeight: 700 }}>
                {lang === "en" ? "← Back to inbox" : "← Retour à la boîte"}
              </button>
            ) : (
              <button onClick={() => setValidateModal(null)} className="btn btn-primary btn-block" style={{ fontWeight: 700 }}>
                {lang === "en" ? "OK, I'll fix it" : "OK, je corrige"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── BUG 3: WARN + ALLOW — overselling ── */}
      {oversellModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(245,158,11,0.45)", borderRadius: 14, width: "100%", maxWidth: 460, padding: 22 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>
              {lang === "en" ? "Insufficient stock" : "Stock insuffisant"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
              {(oversellModal.items || []).map((it, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <strong>{it.name}</strong> — {lang === "en"
                    ? `${it.available} available, selling ${it.selling}`
                    : `${it.available} dispo, vente de ${it.selling}`}
                </div>
              ))}
              <div style={{ marginTop: 10, color: "var(--text-muted)" }}>
                {lang === "en"
                  ? "You can still sell — stock will go negative and the sale is flagged for restock follow-up."
                  : "Vous pouvez vendre — le stock passera en négatif et la vente sera signalée pour réapprovisionnement."}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setOversellModal(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button onClick={runCheckout} disabled={!shiftIsOpen || saleMutation.isPending} title={!shiftIsOpen ? noShiftHint(lang) : ""} className="btn btn-success" style={{ flex: 2, fontWeight: 700 }}>
                {lang === "en" ? "Sell anyway" : "Vendre quand même"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIPT MODAL ────────────────────────────────────────────── */}
      {/* MP-PAYMENT-EVENT-RECEIPTS Phase 2: shared component now
          renders the sale receipt. lastSale's shape (.items,
          .paid_amount, .payment_status, nested .customer) maps
          1:1 to the sale event-type body — no payload change
          needed at this call site. */}
      {showReceipt && lastSale && (
        <PaymentEventReceipt
          eventType="sale"
          data={lastSale}
          org={orgSettings}
          lang={lang}
          onClose={() => setShowReceipt(false)}
        />
      )}

      {/* MP-POS-COLLECT-DEBT-CART-NO-RECEIPT (Bug A): debt-cart
          receipt. Aggregated from per-invoice /sales/:id/payment
          responses into a debt_collection-shape payload. */}
      {debtReceiptEvent && (
        <PaymentEventReceipt
          eventType="debt_collection"
          data={debtReceiptEvent.data}
          org={orgSettings}
          lang={lang}
          onClose={() => setDebtReceiptEvent(null)}
        />
      )}

      {/* ── HOLD SALE — label/notes prompt ───────────────────────────── */}
      {showHold && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 400, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>⏸ {lang === "en" ? "Hold this sale" : "Mettre en attente"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {lang === "en"
                ? "Park this cart so you can serve the next customer. Valid 24h."
                : "Parquez ce panier pour servir le client suivant. Valable 24h."}
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {lang === "en" ? "Customer description (optional)" : "Description client (optionnel)"}
            </label>
            <input className="input" value={holdLabel} onChange={e => setHoldLabel(e.target.value)} autoFocus
              placeholder={lang === "en" ? "e.g. tall guy, blue shirt" : "ex. monsieur, chemise bleue"}
              style={{ margin: "6px 0 14px" }} maxLength={120} />
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}
            </label>
            <textarea className="input" value={holdNotes} onChange={e => setHoldNotes(e.target.value)} rows={2}
              style={{ margin: "6px 0 18px", resize: "vertical" }} maxLength={500} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowHold(false)} className="btn btn-secondary" style={{ flex: 1 }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button onClick={() => holdMutation.mutate()} disabled={holdMutation.isPending} className="btn btn-primary" style={{ flex: 2, fontWeight: 700 }}>
                {holdMutation.isPending ? "⏳" : (lang === "en" ? "⏸ Hold & Print Ticket" : "⏸ Attente & Ticket")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESUME — active holds picker ─────────────────────────────── */}
      {showResume && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, maxWidth: 460, width: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>⏸ {lang === "en" ? "Held sales" : "Ventes en attente"}</div>
              <button onClick={() => setShowResume(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              {selectedLocation?.name ? `📍 ${selectedLocation.name} · ` : ""}{activeHolds.length} {lang === "en" ? "active" : "actives"}
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {activeHolds.length === 0 && (
                <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
                  {lang === "en" ? "No held sales." : "Aucune vente en attente."}
                </div>
              )}
              {activeHolds.map(h => {
                const mins = Math.max(0, Math.round((Date.now() - new Date(h.created_at).getTime()) / 60000));
                const ago = mins < 60 ? `${mins} ${lang === "en" ? "min ago" : "min"}` : `${Math.round(mins / 60)} ${lang === "en" ? "h ago" : "h"}`;
                const nItems = (h.items || []).length;
                return (
                  <div key={h.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg-card)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{h.hold_ref}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ago}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", margin: "4px 0" }}>
                      👤 {h.label || (lang === "en" ? "Walk-in" : "Client de passage")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--brand-light)", fontWeight: 600, marginBottom: 10 }}>
                      {nItems} {lang === "en" ? (nItems === 1 ? "item" : "items") : "article(s)"} · {formatCFA(h.estimated_total)}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => resumeHold(h.id)} className="btn btn-success" style={{ flex: 2, fontWeight: 700, fontSize: 13 }}>
                        {lang === "en" ? "Resume" : "Reprendre"}
                      </button>
                      <button onClick={() => { setCancelReason("changed_mind"); setCancelTarget(h); }}
                        style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        {lang === "en" ? "Cancel" : "Annuler"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── CANCEL HOLD — confirm + reason ───────────────────────────── */}
      {cancelTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 14, padding: 22, maxWidth: 380, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
              {lang === "en" ? "Cancel held sale?" : "Annuler la mise en attente ?"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              {cancelTarget.hold_ref} — {cancelTarget.label || (lang === "en" ? "Walk-in" : "Client de passage")}
            </div>
            <select className="input" value={cancelReason} onChange={e => setCancelReason(e.target.value)} style={{ marginBottom: 16 }}>
              <option value="customer_left">{lang === "en" ? "Customer left" : "Client parti"}</option>
              <option value="changed_mind">{lang === "en" ? "Changed mind" : "A changé d'avis"}</option>
              <option value="other">{lang === "en" ? "Other" : "Autre"}</option>
            </select>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCancelTarget(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                {lang === "en" ? "Keep it" : "Garder"}
              </button>
              <button onClick={confirmCancelHold} className="btn btn-danger" style={{ flex: 1, fontWeight: 700, background: "#ef4444", color: "#fff" }}>
                {lang === "en" ? "Cancel hold" : "Annuler l'attente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HOLD TICKET (print) ──────────────────────────────────────── */}
      {heldTicket && (
        <HoldTicket
          hold={heldTicket}
          org={orgSettings}
          lang={lang}
          cashierName={user?.name || ""}
          onClose={() => setHeldTicket(null)}
        />
      )}
    </>
  );
}

// MP-PAYMENT-EVENT-RECEIPTS Phase 2: the inline ReceiptModal that
// used to live here was extracted to components/common/Payment
// EventReceipt.jsx (single source for sale + debt_collection +
// refund + void). Call site updated above to:
//   <PaymentEventReceipt eventType="sale" data={lastSale} ... />
// MP-RECEIPT-PAID-IN-FULL-BUG + MP-RECEIPT-BODY-PAID-AMOUNT-BUG
// fixes are preserved by the shared component.

// ── HOLD TICKET COMPONENT ─────────────────────────────────────────────────────
// Thermal-friendly slip the customer keeps. Code128B + QR of the
// hold_ref (shared genSaleCodes) so the cashier scans it to resume.
// This is NOT a receipt — no payment, no totals owed.
function HoldTicket({ hold, org, lang, cashierName, onClose }) {
  const en = lang === "en";
  const loc = en ? "en-US" : "fr-FR";
  const created = hold.created_at ? new Date(hold.created_at) : new Date();
  const dateStr = created.toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = created.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  const items = hold.items || [];
  const HT = {
    hold:    en ? "HOLD" : "MISE EN ATTENTE",
    date:    en ? "Date" : "Date",
    cashier: en ? "Cashier" : "Caissier",
    customer:en ? "Customer" : "Client",
    walkin:  en ? "Walk-in" : "Client de passage",
    est:     en ? "Estimated total" : "Total estimé",
    notReceipt: en
      ? "This is NOT a receipt. Please present this slip to resume your purchase. Valid for 24 hours."
      : "Ceci n'est pas un reçu. Veuillez présenter ce ticket pour reprendre votre achat. Valable 24 heures.",
    print:   en ? "Print Hold Ticket" : "Imprimer le ticket",
    close:   en ? "Close" : "Fermer",
    held:    en ? "Sale held" : "Vente en attente",
  };

  const [codes, setCodes] = useState({ barcode: "", qr: "" });
  useEffect(() => {
    if (!hold.hold_ref) return;
    let cancelled = false;
    genSaleCodes(hold.hold_ref)
      .then(c => { if (!cancelled) setCodes(c); })
      .catch(() => { if (!cancelled) setCodes({ barcode: "", qr: "" }); });
    return () => { cancelled = true; };
  }, [hold.hold_ref]);

  const printTicket = () => {
    const shopName = org.name || "Boutique";
    const html = `
      <html><head><title>${HT.hold} ${hold.hold_ref}</title><style>
        body { font-family: monospace; font-size: 12px; width: 300px; margin: 0 auto; }
        h2 { text-align: center; font-size: 14px; margin: 4px 0; }
        .center { text-align: center; }
        .line { border-top: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; }
        .big { font-size: 17px; font-weight: bold; text-align: center; margin: 6px 0; }
        .est { font-weight: bold; font-size: 14px; }
        .note { text-align: center; margin-top: 10px; font-size: 11px; font-weight: bold; }
      </style></head><body>
        <h2>${shopName}</h2>
        <div class="line"></div>
        <div class="big">${HT.hold}: ${hold.hold_ref}</div>
        <div class="center">${HT.date}: ${dateStr} ${timeStr}</div>
        ${cashierName ? `<div class="center">${HT.cashier}: ${cashierName}</div>` : ""}
        <div class="center">${HT.customer}: ${hold.label || HT.walkin}</div>
        <div class="line"></div>
        ${items.map(i => `<div class="row"><span>${i.name} ×${i.qty}</span><span>${(Number(i.line_total) || 0).toLocaleString()} F</span></div>`).join("")}
        <div class="line"></div>
        <div class="row est"><span>${HT.est}</span><span>${(Number(hold.estimated_total) || 0).toLocaleString()} FCFA</span></div>
        <div class="line"></div>
        ${codes.barcode ? `<div class="center"><img src="${codes.barcode}" style="height:44px;image-rendering:pixelated"/></div>` : ""}
        ${codes.qr ? `<div class="center"><img src="${codes.qr}" style="width:110px;height:110px"/></div>` : ""}
        <div class="center" style="font-size:11px">${hold.hold_ref}</div>
        <div class="line"></div>
        <div class="note">${HT.notReceipt}</div>
      </body></html>
    `;
    const w = window.open("", "_blank", "width=350,height=520");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 360, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 380, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>⏸</div>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#fbbf24" }}>{HT.held}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginTop: 4 }}>{hold.hold_ref}</div>
        </div>
        <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 16, marginBottom: 18, fontSize: 12 }}>
          <div style={{ textAlign: "center", fontWeight: 700, marginBottom: 6 }}>{org.name || "Boutique"}</div>
          <div style={{ textAlign: "center", color: "var(--text-muted)", marginBottom: 8 }}>{dateStr} {timeStr}</div>
          <div style={{ color: "var(--text-secondary)", marginBottom: 8 }}>
            👤 {hold.label || HT.walkin}{cashierName ? ` · ${HT.cashier}: ${cashierName}` : ""}
          </div>
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
            {items.slice(0, 5).map((i, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--text-secondary)" }}>{i.name} ×{i.qty}</span>
                <span style={{ fontWeight: 600 }}>{(Number(i.line_total) || 0).toLocaleString()} F</span>
              </div>
            ))}
            {items.length > 5 && <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>...+{items.length - 5}</div>}
          </div>
          <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
            <span>{HT.est}</span><span style={{ color: "var(--brand-light)" }}>{(Number(hold.estimated_total) || 0).toLocaleString()} F</span>
          </div>
          {(codes.barcode || codes.qr) && (
            <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 10, textAlign: "center", background: "#fff", borderRadius: 8, padding: "10px 0" }}>
              {codes.barcode && <img src={codes.barcode} alt="barcode" style={{ height: 44, maxWidth: "90%" }} />}
              {codes.qr && <div><img src={codes.qr} alt="qr" style={{ width: 96, height: 96 }} /></div>}
              <div style={{ fontSize: 11, color: "#000", fontFamily: "monospace", fontWeight: 700 }}>{hold.hold_ref}</div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)", textAlign: "center", fontWeight: 600 }}>{HT.notReceipt}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={printTicket}
            style={{ width: "100%", padding: "12px", background: "var(--brand)", border: "none", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            🖨️ {HT.print}
          </button>
          <button onClick={onClose}
            style={{ width: "100%", padding: "10px", background: "transparent", border: "none", color: "var(--text-muted)", borderRadius: 12, fontSize: 13, cursor: "pointer" }}>
            {HT.close}
          </button>
        </div>
      </div>
    </div>
  );
}
