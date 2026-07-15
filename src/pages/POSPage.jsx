// v12 - receipt payment status fix
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore, useDraftCartStore } from "../store";
// MP-MIN-PRICE-PIN-UX Option B: OwnerPIN import dropped — the PIN
// override flow was dead code (imported, state set, never rendered).
// Staff who attempt a sub-min price now get a toast.error explaining
// why; the backend at sales.js:46-62 is the source of truth either way.
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { formatMoney, currencySymbol } from "../utils/currency";
import { t } from "../utils/i18n";
import { cacheData, getCachedData } from "../utils/offlineStore";
import { useOfflineCachedQuery, cacheKeyFor } from "../utils/offlineQuery";
import { useLiteMode } from "../hooks/useLiteMode";
import CameraScanner from "../components/common/CameraScanner";
import { genSaleCodes } from "../utils/receiptCodes";
import { ActiveShiftIndicator, useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";
import MobileShiftChip from "../components/layout/MobileShiftChip";
import MobileCartSheet from "../components/pos/MobileCartSheet";
import PayButton from "../components/pos/PayButton";
import { tapHaptic } from "../utils/haptics";
import { motion } from "framer-motion";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";
import BelowCostLossDetail from "../components/common/BelowCostLossDetail";
import DiscountApprovalDetail from "../components/common/DiscountApprovalDetail";
import { momoLabel } from "../utils/paymentLabels";
import ClearButton from "../components/common/ClearButton";
import { unitLabel } from "../utils/units";
import MultipartAvailability from "../components/common/MultipartAvailability";
import RestrictedAction from "../components/common/RestrictedAction";
import useOwnerApproval from "../hooks/useOwnerApproval";

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

// Relevance rank for the POS customer quick-pick. Higher = better:
// exact > whole-name prefix > any-word prefix > earliest substring > phone >
// fuzzy-only. The list arrives sorted by NAME, so without this a search token
// shared by many customers (e.g. a shop with 40+ "Bonaberi") only ever showed
// the 8 alphabetically-first matches and hid everyone else (real bug: a valid
// customer at alpha-rank 22 was unreachable). Ranking guarantees the closest
// matches land inside the visible cap.
function customerMatchScore(c, q) {
  const s = String(c?.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const p = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!p) return 0;
  if (s === p) return 1000;
  if (s.startsWith(p)) return 800;
  if (s.split(/\s+/).some(w => w.startsWith(p))) return 600;
  const idx = s.indexOf(p);
  if (idx >= 0) return 400 - Math.min(idx, 200);   // earlier substring ranks higher
  if (c?.phone && String(c.phone).includes(String(q).trim())) return 300;
  return 0;   // passed the fuzzy filter but no direct hit → sorts last
}
const CUSTOMER_RESULT_CAP = 25;

export default function POSPage() {
  const { lang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  // MP-PROPLUS-CASHIER-LOCATION: when set, this cashier is pinned to a home
  // location (Pro Plus). Layout already force-overwrites selectedLocation to it;
  // here we LOCK the picker so it can't be changed on-device. Backend also
  // substitutes server-side, so this is purely UX honesty. Dedupes with the
  // ["my-plan"] query Layout/useTrialState already run.
  const { data: _myPlanResp } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
  });
  const forcedLocation = _myPlanResp?.data?.forced_location || null;
  // MP-LITE-MODE-PHASE-1: skip Issue 2's customer-debt prefetch in Lite
  // (per directive — Pro-only optimization). The on-demand fetch when
  // a customer is selected still runs; only the upfront bulk warm-up
  // is gated.
  const lite = useLiteMode();
  const navigate = useNavigate();
  const isOwner = user?.role === "owner";
  // MP-REQUIRE-OPEN-SHIFT Phase 3: shared with <ActiveShiftIndicator />
  // via the ["current-shift", locId] cache, so this hook does not
  // trigger a second network request.
  const { hasShift: shiftIsOpen } = useActiveShift();
  const fmt = useCurrency();

  const [cart, setCart]                   = useState([]);
  const [search, setSearch]               = useState("");
  // MP-SERVER-SIDE-PRODUCT-SEARCH (Part A.4): online DB-side search results
  // (null = not searched / offline → use the cached client filter instead).
  const [serverHits, setServerHits]       = useState(null);
  const [customer, setCustomer]           = useState(null);
  // MIN-PRICE FLOOR: reuse the existing boss/owner PIN approval flow for
  // below-min manual price edits. {approvalModal} is rendered near the page root.
  const { requestApproval, modal: approvalModal } = useOwnerApproval();
  // MP-SOLD-DATE-NOTE: gate the cart's optional "Sold date" input on the
  // cashier's OWN sold_date_policy — 'block' (the server default) hides it
  // entirely; the server enforces this independently regardless of what the
  // UI shows (see sales.js), this is just so a blocked staffer never sees a
  // control they can't use. Owner never calls this (always exempt server-
  // side) but the query is harmless for them too.
  const { data: myPerms } = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => api.get("/staff/my-permissions").then(r => r.data?.data),
    staleTime: 5 * 60 * 1000,
  });
  const soldDateAllowed = user?.role === "owner" || (myPerms && myPerms.sold_date_policy !== "block");
  const [custSearch, setCustSearch]       = useState("");
  const [showCustDrop, setShowCustDrop]   = useState(false);
  const [payMode, setPayMode]             = useState("paid");
  // MP-POS-SILENT-FULLPAY-GUARD (BUG 1): payMode defaults to "paid". When a
  // customer is attached the cashier MUST consciously pick Paid/Partial/Credit
  // — otherwise a credit sale gets silently booked as full cash (the cashier
  // collects part, forgets to switch off the default, and the receivable is
  // wiped: VNT-20260613-0021). This flag tracks an explicit tap so we can gate
  // Confirm + suppress the pre-selected highlight for customer sales.
  const [payModeChosen, setPayModeChosen] = useState(false);
  const [paidAmt, setPaidAmt]             = useState("");
  const [dueDate, setDueDate]             = useState("");
  const [payMethod, setPayMethod]         = useState("cash");
  const [notes, setNotes]                 = useState("");
  const [showPayment, setShowPayment]     = useState(false);
  // MP-DISCOUNT: sale-level discount (line discounts live on each cart item).
  const [saleDiscType, setSaleDiscType]     = useState("");   // "" | "amount" | "percent"
  const [saleDiscValue, setSaleDiscValue]   = useState("");
  const [saleDiscReason, setSaleDiscReason] = useState("");
  // MP-SOLD-DATE-NOTE: optional "actually sold on" note (YYYY-MM-DD), gated
  // by sold_date_policy — allow/approve/block, owner-exempt. NEVER used for
  // sale_date/created_at or any calculation; purely a receipt note.
  const [soldDate, setSoldDate]             = useState("");
  const [showSoldDate, setShowSoldDate]     = useState(false);
  // MP-APPROVAL-BUNDLE: the entire below-cost/discount/credit/oversell hybrid
  // is now ONE bundled request. bundledApprovalIdRef = a boss-approved
  // bundled_sale id riding a resumed held sale (server re-verifies the cart+pay
  // signature + single-uses it). bundledApprovalTokenRef = an owner-PIN-now
  // single-use token minted from the OwnerApprovalModal (resubmit reads it
  // without waiting on a state flush). approvalBundle holds the server 403
  // payload ({ actions:[...] }) while the ONE choice modal (PIN-now / send to
  // boss / cancel) is open — the cashier sees every needed approval at once,
  // never a cascading series of separate prompts.
  const bundledApprovalIdRef = useRef(null);
  const bundledApprovalTokenRef = useRef(null);
  const [approvalBundle, setApprovalBundle] = useState(null);
  const [sendingToBoss, setSendingToBoss] = useState(false);
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
  // MP-CREDIT-LIMIT-MODAL: dedicated UI for backend's CREDIT_LIMIT_EXCEEDED
  // 400. Backend already returns structured fields (credit_limit,
  // current_debt, new_balance) alongside the verbose French sentence;
  // we render the three numbers in a table so the cashier reads them
  // at a glance instead of squinting at a wrapped toast. Shape:
  // { customer_name, credit_limit, current_debt, new_balance }.
  const [creditLimitModal, setCreditLimitModal] = useState(null);
  // MP-DOZIE-CART-PREFILL-VALIDATE: when the online_cart_validate_for_pos
  // RPC reports can_proceed=false, this holds per-item verdicts to
  // render. Shape: { locationName, items:[{name, status, qty_requested,
  // qty_available, ...}], summary }.
  const [validateModal, setValidateModal]     = useState(null);
  // MP-MOBILE-UI-PHASE-2A: cart bottom-sheet visibility on mobile.
  // The MobileCartSheet renders a persistent strip when cart isn't
  // empty; this state controls whether the full sheet is expanded.
  // The auto-collapse effect below closes it whenever any overlay
  // modal opens, so the Vaul portal (z:1701) doesn't sit on top of
  // root modals that live at z:3000+.
  const [sheetOpen, setSheetOpen] = useState(false);
  // MP-MOBILE-UI-PHASE-2A: brief row flash on add-to-cart. Holds the
  // product_id of the last-tapped row for ~250ms so the row can
  // pulse-highlight, then clears.
  const [justAddedId, setJustAddedId] = useState(null);
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

  // MP-UNDO-TO-CART: ?restore_from=<voidedSaleId> reloads the just-undone sale's
  // items into the cart. restoreFromIdRef is sent as replaces_sale_id on the new
  // sale (audit link); restoreBanner shows "Editing voided VNT-X".
  const restoreRanRef = useRef(false);
  const restoreFromIdRef = useRef(null);
  const [restoreBanner, setRestoreBanner] = useState(null);

  // MP-MOBILE-UI-PHASE-2A: auto-collapse the mobile cart sheet whenever
  // ANY root-level overlay opens. Vaul renders at z:1701 — the receipt /
  // hold / resume / block / oversell / validate modals are all at
  // z:3000+ inside POSPage's JSX but the cashier perception is
  // "modal on top of sheet". Closing the sheet first removes the
  // backdrop and gives the modal the entire viewport. resetCart()
  // already returns POSPage to a fresh state on sale success, so this
  // also gives the cleanest "transaction done" finish.
  useEffect(() => {
    if (showReceipt || showHold || showResume || debtReceiptEvent
        || blockModal || oversellModal || validateModal) {
      setSheetOpen(false);
    }
  }, [showReceipt, showHold, showResume, debtReceiptEvent,
      blockModal, oversellModal, validateModal]);

  // MP-POS-CART-PERSIST: restore + auto-save draft cart so navigating
  // away (e.g. accidentally tapping a sidebar link) never loses Nora's
  // in-progress sale. Scoped per (user × location) via useDraftCartStore;
  // 24h TTL silently drops stale carts.
  //
  // Scope-pin (cartScopeRef): the current in-memory cart belongs to ONE
  // (userId, locationId) pair. If the cashier switches location mid-cart,
  // we MUST NOT auto-save those items under the new location's key —
  // that would silently overwrite the other location's saved draft. The
  // pin records "which scope the cart's items came from"; auto-save only
  // fires while the current scope matches the pin. Switching location
  // freezes save until the cart empties (sale, hold, or manual clear),
  // at which point the pin clears and the new scope can author its own
  // draft.
  const { saveDraft, getDraft, clearDraft } = useDraftCartStore();
  const userId = user?.id;
  const locId  = selectedLocation?.id;
  const draftRestoredRef = useRef(false);
  const cartScopeRef     = useRef(null); // { userId, locId } when cart non-empty
  // Restore once user + location are resolved. Skip if no draft, draft
  // is older than 24h, or items is empty. Open the mobile cart sheet
  // on successful restore so the cashier sees the cart waiting for her.
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!userId || !locId) return;
    const draft = getDraft({ userId, locationId: locId });
    if (!draft) { draftRestoredRef.current = true; return; }
    const TTL_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - (draft.updatedAt || 0) > TTL_MS) {
      clearDraft({ userId, locationId: locId });
      draftRestoredRef.current = true;
      return;
    }
    if (Array.isArray(draft.items) && draft.items.length > 0) {
      // Backfill a stable lineId on drafts saved before lineIds existed.
      // MP-DAMAGED-GOODS: PREPEND the restored items (functional updater) so a
      // damaged line handed off from Stock Check (appended by the handoff effect
      // below) survives even if this restore runs AFTER the handoff — e.g. when
      // auth/location resolve a render late. Restore-then-handoff and
      // handoff-then-restore both settle to [restored…, damaged].
      setCart(prev => [...draft.items.map(it => (it && it.lineId) ? it : { ...it, lineId: genLineId() }), ...prev]);
      if (draft.customer)      setCustomer(draft.customer);
      if (draft.payMode)       { setPayMode(draft.payMode); setPayModeChosen(true); }
      if (draft.paidAmt)       setPaidAmt(draft.paidAmt);
      if (draft.dueDate)       setDueDate(draft.dueDate);
      if (draft.notes)         setNotes(draft.notes);
      // MP-BELOW-COST-PERSIST / MP-APPROVAL-BUNDLE: restore the cart-level
      // boss-approval link so a resumed bundled-approval cart still finalizes
      // with its approval without a re-approval after navigating away and back.
      bundledApprovalIdRef.current = draft.bundledApprovalId || null;
      if (isMobile())          setSheetOpen(true);
      cartScopeRef.current = { userId, locId };
      toast.success(lang === "en"
        ? `${draft.items.length} item(s) restored from your saved cart`
        : `${draft.items.length} article(s) restauré(s) de votre panier`,
        { duration: 3500 });
    }
    draftRestoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, locId]);
  // Auto-save on every cart-shaped change. Guard against firing before
  // restore completes — otherwise the empty-initial-state would wipe a
  // valid persisted draft before we ever read it.
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    if (!userId || !locId) return;
    if (cart.length === 0) {
      // Cart emptied (sale finalized / held / cleared). Drop pin so the
      // next non-empty cart claims the current scope as its own.
      if (cartScopeRef.current) {
        clearDraft({ userId: cartScopeRef.current.userId, locationId: cartScopeRef.current.locId });
        cartScopeRef.current = null;
      }
      return;
    }
    // First non-empty change pins the scope to whichever (user, loc) is
    // active right now.
    if (!cartScopeRef.current) {
      cartScopeRef.current = { userId, locId };
    }
    // Freeze save when the cashier has switched location mid-cart: the
    // items still belong to the pinned scope, not the current one.
    if (cartScopeRef.current.userId !== userId || cartScopeRef.current.locId !== locId) {
      return;
    }
    saveDraft({ userId, locationId: locId,
      items: cart, customer, payMode, paidAmt, dueDate, notes,
      // MP-BELOW-COST-PERSIST / MP-APPROVAL-BUNDLE: keep the boss-approval link
      // with the draft so a remount still sends it at checkout (refs are wiped
      // on unmount).
      bundledApprovalId: bundledApprovalIdRef.current });
  }, [cart, customer, payMode, paidAmt, dueDate, notes,
      userId, locId, saveDraft, clearDraft]);
  // MP-STORAGE-QUOTA-CRASH-FIX: safeStorage fires this (at most once/session)
  // when a draft save had to be skipped because the device storage is full.
  // Quiet, non-fatal heads-up — the sale keeps working, only the auto-save of
  // the in-progress cart is paused until space frees up.
  useEffect(() => {
    const onQuota = () => toast(
      lang === "en"
        ? "Device storage is full — your in-progress cart won't be auto-saved. Finish or clear the sale to free space."
        : "Stockage plein — votre panier en cours ne sera pas sauvegardé. Terminez ou videz la vente pour libérer de l'espace.",
      { icon: "⚠️", duration: 6000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } }
    );
    window.addEventListener("mp-storage-quota", onQuota);
    return () => window.removeEventListener("mp-storage-quota", onQuota);
  }, [lang]);

  // MP-DAMAGED-GOODS: cross-page hand-off. Stock Check's "Sell" button stashes a
  // damaged product in sessionStorage then routes to /pos. We consume it exactly
  // once on mount and APPEND a DAMAGED cart line priced at the current customer
  // tier (priceForTier), carrying is_damaged + damaged_source_id so checkout
  // records the sale line as damaged and the server decrements the pile. This
  // APPENDS while draft-restore PREPENDS, so the two effects compose regardless
  // of which runs first and the handed-off line is never clobbered.
  const damagedHandoffRef = useRef(false);
  useEffect(() => {
    if (damagedHandoffRef.current) return;
    damagedHandoffRef.current = true;
    let payload;
    try {
      const raw = sessionStorage.getItem("mp-damaged-handoff");
      if (!raw) return;
      sessionStorage.removeItem("mp-damaged-handoff");
      payload = JSON.parse(raw);
    } catch { return; }
    if (!payload || !payload.product_id || !payload.damaged_source_id) return;
    const qty  = Math.max(1, Number(payload.quantity) || 1);
    const tier = tierForCustomer(customer);
    const price = priceForTier(payload, tier);
    setCart(prev => [...prev, {
      lineId: genLineId(),
      product_id: payload.product_id,
      name: payload.name,
      unit: payload.unit,
      barcode: payload.barcode || null,
      quantity: qty,
      unit_price: price,
      original_price: price,
      price_tier: tier,                                    // recorded on the sale line
      sell_price: Number(payload.sell_price) || 0,         // ladder fields → tier re-pricing on customer change
      wholesale_price: Number(payload.wholesale_price) || 0,
      min_price: Number(payload.min_price) || 0,
      cost_price: payload.cost_price,
      stock: undefined,
      is_multipart: false,
      // MP-DAMAGED-GOODS markers → /sales payload + server pile decrement.
      is_damaged: true,
      damaged_source_id: payload.damaged_source_id,
    }]);
    if (isMobile()) setSheetOpen(true);
    toast.success(lang === "en" ? "Damaged item added to cart" : "Article endommagé ajouté au panier", { duration: 3000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // MP-MULTIPART: a hidden kit part must never be sold on its own (would sell at 0).
      if (product && product.is_component) {
        setLastScan({ name: product.name, success: false });
        toast.error(lang === "en"
          ? `"${product.name}" is a kit part — sell the finished product instead.`
          : `« ${product.name} » est une pièce de kit — vendez le produit fini.`, { position: "top-center", duration: 3000 });
        return;
      }
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
    // MP-PHASE-4.0 + Issue B: 'always' so the queryFn runs OFFLINE — the
    // existing try/catch + getCachedData fallback below was dead code
    // under default 'online' (queryFn pauses). Safe form per the
    // memory rule: this queryFn always returns an array-shape, never
    // an error object.
    networkMode: 'always',
    queryFn: async () => {
      console.log('[query] fired', ["locations"], { online: navigator.onLine });
      try {
        const result = await api.get("/locations").then(r => r.data);
        cacheData("pos-locations", result);
        return result;
      } catch {
        const cached = await getCachedData("pos-locations");
        console.log('[query] cache fallback', ["locations"], { hits: !!cached });
        return cached || { data: [] };
      }
    }
  });

  const { data: allProducts } = useQuery({
    queryKey: ["pos-products", selectedLocation?.id],
    networkMode: 'always',
    queryFn: async () => {
      // MP-SALES-PICKER-FULL-CATALOGUE (build 18): cache key bumped to v2 so
      // installing this build DISCARDS any stale pre-f118010 product cache (the
      // Brake-Shoe / "hidden in Sales" bug was a stale cache served when the
      // 6s fetch timed out on cold start). Longer timeout so a cold Render
      // backend or slow network resolves instead of falling back to stale.
      // The backend now returns the FULL active catalogue (no 200 cap), and is
      // the offline fallback source for the client filter below.
      const cacheKey = "pos-products-v2-" + (selectedLocation?.id || "all");
      console.log('[query] fired', ["pos-products", selectedLocation?.id], { online: navigator.onLine });
      try {
        // MP-MULTIPART: hide hidden parts (is_component) from the sales picker.
        const result = await api.get("/products?exclude_components=true&location_id=" + (selectedLocation?.id || ""), { timeout: 45000 }).then(r => r.data);
        cacheData(cacheKey, result);
        return result;
      } catch {
        const cached = await getCachedData(cacheKey);
        console.log('[query] cache fallback', ["pos-products", selectedLocation?.id], { hits: !!cached });
        return cached || { data: [] };
      }
    },
    enabled: true,
    staleTime: 60000
  });

  // MP-MULTIPART-VISIBILITY: kit parents hold no pa_stock, so overlay their
  // COMPUTED complete-sets availability at the selected location on their picker row.
  const { data: mpAvailData } = useQuery({
    queryKey: ["pos-mp-availability", selectedLocation?.id],
    networkMode: "always",
    queryFn: () => api.get("/products/multipart-availability?location_id=" + (selectedLocation?.id || "")).then(r => r.data),
    enabled: !!selectedLocation?.id,
    staleTime: 30000,
  });
  const parentAvail = mpAvailData?.data || {}; // { [parentId]: availableSets }

  const { data: allCustomers } = useQuery({
    queryKey: ["pos-customers"],
    networkMode: 'always',
    queryFn: async () => {
      console.log('[query] fired', ["pos-customers"], { online: navigator.onLine });
      try {
        const result = await api.get("/customers?limit=300").then(r => r.data);
        cacheData("pos-customers", result);
        return result;
      } catch {
        const cached = await getCachedData("pos-customers");
        console.log('[query] cache fallback', ["pos-customers"], { hits: !!cached });
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

  // MP-DEBT-MODAL-OFFLINE (Issue 2): converted from useQuery to
  // useOfflineCachedQuery so the debt detail can serve cached data
  // when the network is unavailable. Combined with the prefetch
  // useEffect below — which warms the cache for every debtor as soon
  // as allCustomers loads — the cashier can pick any customer who
  // owed money at last-online-sync and see the modal/banner correctly
  // even fully offline.
  const { data: customerDebtData, isLoading: debtLoading } = useOfflineCachedQuery({
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

  // MP-PAUL-FIX-16 (3 Jun): offline-fallback banner. When the cashier
  // picks a customer with debt but useOfflineCachedQuery returns
  // null (offline + no cached detail, because Layout warm-up didn't
  // reach this customer before the network dropped) the effect above
  // returns early and the cashier sees nothing — silent failure.
  // Surface a non-blocking inline note so they know the debt detail
  // can't load right now and what to do. Distinct from debtBanner
  // (which is the paper-debt prompt for online flows).
  const showOfflineDebtNote =
    !!customer?.id &&
    Number(customer?.total_debt || 0) > 0 &&
    !debtLoading &&
    !customerDebtData;

  // MP-DEBT-MODAL-PREFETCH (Issue 2): warm the customer-debt cache for
  // every debtor as soon as the allCustomers list arrives. Without this,
  // the modal/banner only works for customers the cashier individually
  // picked WHILE online — picking any other debtor offline would leave
  // customerDebtData undefined and the useEffect above would silently
  // return early. The pre-fetch fires once per debtor in parallel,
  // populates the offlineQuery localStorage cache via cacheData with
  // the SAME derived key the consumer reads back, and ALSO seeds the
  // React Query in-memory cache so the modal opens instantly without
  // a refetch when the cashier picks the customer next.
  //
  // Bounded by active-debtor count (typically a small subset of total
  // customers). Failures are silent — best-effort warm-up, no UI
  // spinner, and the existing online refetch path handles the case
  // where the cache is stale by the time the cashier picks the
  // customer. Re-runs whenever allCustomers refetches.
  useEffect(() => {
    // MP-LITE-MODE-PHASE-1: skip the upfront prefetch in Lite. The
    // useOfflineCachedQuery consumer above still fetches on-demand
    // when a customer is selected; only the bulk warm-up is gated.
    if (lite) return;
    const all = allCustomers?.data || [];
    if (!all.length) return;
    const debtors = all.filter(c => c?.id && Number(c?.total_debt || 0) > 0);
    if (!debtors.length) return;
    let cancelled = false;
    (async () => {
      // MP-CUSTOMER-DEBT-N1-FIX: ONE batched request for all debtors instead of
      // a Promise.all fan-out of dozens of concurrent GET /customer-debt/:id
      // calls (the app-open burst that overloaded the API). Same cache seeding.
      try {
        const batch = await api.post("/sales/customer-debt-batch", { customer_ids: debtors.map(c => c.id) })
          .then(res => res.data?.data || {});
        if (cancelled) return;
        for (const c of debtors) {
          const r = batch[c.id];
          if (!r) continue;
          try { cacheData(cacheKeyFor(["customer-debt", c.id]), r); } catch { /* swallow storage errors */ }
          qc.setQueryData(["customer-debt", c.id], r);
        }
      } catch { /* silent — best-effort warm-up */ }
    })();
    return () => { cancelled = true; };
  }, [allCustomers?.data, qc, lite]);

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
              lineId: genLineId(),
              product_id: it.product_id,
              name: p.name || it.name,
              unit: p.unit, barcode: p.barcode,
              quantity: Number(it.qty_requested) || 1,
              unit_price: Number(it.price) || Number(p.sell_price) || 0,
              original_price: Number(p.sell_price) || 0,
              sell_price: Number(p.sell_price) || 0,
              wholesale_price: Number(p.wholesale_price) || 0,
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

  // MP-UNDO-TO-CART: ?restore_from=<voidedSaleId> → reload that (now voided) sale's
  // items into the cart to re-checkout. Clones the from_online hydration: fetch the
  // sale + items, hydrate fresh product data via /products/:id (keeps the ORIGINAL
  // unit_price charged), setCart + setCustomer, remember the id for replaces_sale_id.
  useEffect(() => {
    if (restoreRanRef.current) return;
    const restoreFrom = new URLSearchParams(window.location.search).get("restore_from");
    if (!restoreFrom) return;
    restoreRanRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const sale = await api.get(`/sales/${restoreFrom}`).then(r => r.data?.data);
        if (cancelled || !sale) return;
        const lines = Array.isArray(sale.pa_sale_items) ? sale.pa_sale_items : [];
        const hydrated = await Promise.all(lines.map(async li => {
          if (!li.product_id) return null; // skip debt/adjustment lines
          try {
            const p = await api.get(`/products/${li.product_id}`).then(r => r.data?.data);
            if (!p) return null;
            return {
              lineId: genLineId(),
              product_id: li.product_id,
              name: p.name || li.pa_products?.name || "—",
              unit: p.unit, barcode: p.barcode,
              quantity: Number(li.quantity) || 1,
              unit_price: Number(li.unit_price) || Number(p.sell_price) || 0, // keep what was charged
              original_price: Number(p.sell_price) || 0,
              sell_price: Number(p.sell_price) || 0,
              wholesale_price: Number(p.wholesale_price) || 0,
              min_price: p.min_price || 0,
              cost_price: p.cost_price,
              stock: Number(p.stock?.quantity ?? p.stock ?? 0),
            };
          } catch { return null; }
        }));
        if (cancelled) return;
        const items = hydrated.filter(Boolean);
        if (!items.length) { toast.error(lang === "en" ? "Nothing to reload" : "Rien à recharger"); return; }
        setCart(items);
        if (sale.customer_id) setCustomer({ id: sale.customer_id, name: sale.pa_customers?.name, phone: sale.pa_customers?.phone });
        restoreFromIdRef.current = restoreFrom;
        setRestoreBanner(sale.sale_number || restoreFrom.slice(0, 8));
        toast.success(lang === "en" ? "Sale reloaded — adjust and re-checkout" : "Vente rechargée — ajustez et refaites");
      } catch (e) {
        toast.error(e?.response?.data?.message || (lang === "en" ? "Could not reload sale" : "Échec du rechargement"));
      } finally {
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, clean);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locations = locData?.data || [];

  // MP-SERVER-SIDE-PRODUCT-SEARCH (Part A.4): when ONLINE, search the catalogue
  // in the DB (scales to thousands of products without caching them all on the
  // phone). Debounced. Offline or on error, fall back to filtering the cached
  // full list. Either way the FULL active set is reachable — no zero-stock gate.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 1 || typeof navigator !== "undefined" && navigator.onLine === false) { setServerHits(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // MP-MULTIPART: the sales picker must exclude hidden kit parts (is_component).
        const r = await api.get(`/products?search=${encodeURIComponent(q)}&exclude_components=true&location_id=${selectedLocation?.id || ""}`, { timeout: 20000 }).then(x => x.data);
        if (!cancelled && r && Array.isArray(r.data)) setServerHits(r.data.filter(p => !p.is_component));
      } catch { if (!cancelled) setServerHits(null); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedLocation?.id]);

  const clientFiltered = (allProducts?.data || []).filter(p =>
    // MP-MULTIPART: never surface hidden kit parts in the sales picker (defensive —
    // allProducts is already fetched with exclude_components=true).
    !p.is_component && (
      fuzzyMatch(p.name, search) ||
      fuzzyMatch(p.name_en, search) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.sku && p.sku.toLowerCase().includes(search.toLowerCase()))
    )
  );
  const filteredProducts = search.length >= 1
    ? (serverHits !== null ? serverHits : clientFiltered).slice(0, 50)
    : [];

  // Sale-flow customer quick-pick. The list arrives sorted by NAME; rank the
  // matches by RELEVANCE (customerMatchScore) before capping, so the closest
  // matches always land inside the visible cap. Previously this was a flat
  // .slice(0, 8) on the alphabetical list, so a search token shared by many
  // customers (a shop with 40+ "Bonaberi") hid everyone past the 8th name.
  const _custMatches = custSearch.length >= 1 && !customer
    ? (allCustomers?.data || []).filter(c =>
        fuzzyMatch(c.name, custSearch) ||
        (c.phone && c.phone.includes(custSearch)))
    : [];
  const filteredCustomers = _custMatches
    .slice()
    .sort((a, b) => customerMatchScore(b, custSearch) - customerMatchScore(a, custSearch))
    .slice(0, CUSTOMER_RESULT_CAP);
  const customerMatchOverflow = Math.max(0, _custMatches.length - CUSTOMER_RESULT_CAP);

  // ── PRICE TIER: auto-apply by customer type ─────────────────────────────────
  // MP-CUSTOMER-TIER-PRICING: price ladder per product is
  //   cost_price <= min_price <= wholesale_price <= sell_price.
  // Customer type → tier (recorded on each sale line as price_tier):
  //   no customer / walk-in        -> sell_price       (walk_in)
  //   garage | retail | wholesale  -> wholesale_price  (wholesale)
  //   vip                          -> min_price        (vip)
  // All three resolve >= min_price, so they never trip the min-price floor.
  const tierForCustomer = (cust) => {
    const t = cust?.customer_type;
    if (!cust) return "walk_in";
    if (t === "vip") return "vip";
    if (t === "garage" || t === "retail" || t === "wholesale") return "wholesale";
    return "walk_in";
  };
  // Resolve the unit price for a product at a tier, with safe fallbacks when an
  // optional ladder value is missing (0/null): never resolves to 0, never below
  // the next price up.
  const priceForTier = (product, tier) => {
    const sell = Number(product.sell_price) || 0;
    const ws   = Number(product.wholesale_price) || 0;
    const min  = Number(product.min_price) || 0;
    if (tier === "vip")       return min > 0 ? min : (ws > 0 ? ws : sell);
    if (tier === "wholesale") return ws  > 0 ? ws  : sell;
    return sell;
  };
  const isTierCustomer = (cust) => tierForCustomer(cust) !== "walk_in";
  const getPrice = (product) => priceForTier(product, tierForCustomer(customer));

  // Re-price the WHOLE cart when the attached customer is changed or cleared —
  // existing product lines move to the new tier too, not just newly-added ones.
  // Debt/debt-payment lines are left alone; any prior manual below-min override
  // is reset (tier prices are >= min, so they need no approval).
  const customerId   = customer?.id || null;
  const customerType = customer?.customer_type || null;
  useEffect(() => {
    const tier = tierForCustomer(customer);
    setCart(prev => prev.map(it => {
      if (it.isDebt || it.isDebtPayment || it.type === "debt_payment"
          || it.product_id === "__DEBT__" || it.product_id === "__DEBT_PAYMENT__") return it;
      // MP-BELOW-COST-PERSIST: a boss-APPROVED below-cost line (sync PIN override
      // OR async send-to-boss) keeps its approved price when the customer/tier
      // changes — the boss approved THIS exact price. Re-pricing it would revert
      // to the tier price and (for below-cost) break the approval signature,
      // forcing needless re-approval. The backend still voids the approval if the
      // product/qty/price actually changes.
      if (it.price_overridden || it.below_cost_approved) return it;
      // Legacy lines (drafts saved before this change) may lack ladder fields →
      // priceForTier would yield 0; fall back to the line's current price.
      const price = priceForTier(it, tier) || Number(it.unit_price) || Number(it.original_price) || 0;
      return {
        ...it,
        unit_price: price,
        original_price: price,
        price_tier: tier,
        price_overridden: false,
        price_approval_token: undefined,
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customerType]);

  // MP-PAUL-PHANTOM-LINE-FIX: every cart line gets a stable lineId. Keys,
  // removal and edits are by lineId — NOT array index — so removing a line
  // can't shift indices under an in-flight edit and a removed line is fully
  // gone (the whole object, incl. any below-min price_approval_token, is
  // dropped). Index-keyed lists were the classic source of a "removed" line
  // lingering in state and being scanned at checkout though it isn't rendered.
  const genLineId = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `ln_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // A line is submittable only if it's a real, active line: a debt/debt-payment
  // line, OR a product line with a truthy product_id and quantity > 0. The sale
  // payload AND the visible cart are derived from this so the backend (and its
  // min-price check) can only ever see lines that are actually in the cart.
  const isSubmittableLine = (i) => {
    if (!i) return false;
    if (i.type === "debt_payment" || i.isDebt || i.isDebtPayment
        || i.product_id === "__DEBT__" || i.product_id === "__DEBT_PAYMENT__") return true;
    return !!i.product_id && (Number(i.quantity) || 0) > 0;
  };

  // MP-FAST-MULTI-ADD (Fix 3): keepSearch=true leaves the product results list
  // open after a tap so no-barcode shops can keep tapping to add many items
  // rapidly (each tap = qty 1; adjust in cart later). The list closes when the
  // user opens the cart (yellow cart bar) or clears/retypes the search. Scan/
  // barcode adds keep the default (clear) behavior.
  const addToCart = (product, qty = 1, keepSearch = false) => {
    const tier  = tierForCustomer(customer);
    const price = priceForTier(product, tier);
    // Low stock warning
    const stockQty = product.stock?.quantity;
    const minQty = product.stock?.min_quantity || 5;
    if (stockQty !== undefined && stockQty <= minQty) {
      toast(`⚠️ ${lang === "en" ? "Low stock:" : "Stock bas:"} ${product.name} — ${stockQty} ${unitLabel(product.unit)} ${lang === "en" ? "remaining" : "restant(s)"}`, {
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
        lineId: genLineId(),
        product_id: product.product_id || product.id,
        name: product.name, unit: product.unit, barcode: product.barcode,
        quantity: qty,
        unit_price: price,
        original_price: price,
        price_tier: tier,                                       // recorded on the sale line
        sell_price: Number(product.sell_price) || 0,            // kept for re-pricing on customer change
        wholesale_price: Number(product.wholesale_price) || 0,
        min_price: product.min_price || 0,
        cost_price: product.cost_price,
        stock: product.stock?.quantity,
        is_multipart: !!product.is_multipart,   // MP-MULTIPART: kit → no own stock
      }];
    });
    if (!keepSearch) setSearch("");
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
      { lineId: genLineId(), product_id: "__DEBT__", name: `${lang === "en" ? "Debt repayment" : "Remboursement"} (${refs})`, unit: "pce", quantity: 1, unit_price: totalAmt, cost_price: 0, isDebt: true, debtSaleIds: selected.map(i => i.id), debtAmount: totalAmt }
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
        lineId: genLineId(), product_id: "__DEBT_PAYMENT__", type: "debt_payment",
        name: `${lang === "en" ? "Debt Repayment" : "Remboursement dette"} (${debtBanner.name})`,
        unit: "pce", quantity: 1, unit_price: debtBanner.amount, cost_price: 0,
        isDebtPayment: true, customer_id: debtBanner.customer_id, debtMax: debtBanner.amount
      }
    ]);
    setDebtBanner(null);
  };

  // All cart mutations key off lineId (not array index) so a concurrent
  // removal/re-price can't retarget the wrong row.
  const removeLine = (lineId) => setCart(c => c.filter(it => it.lineId !== lineId));
  const updateQty  = (lineId, qty) => qty <= 0
    ? removeLine(lineId)
    : setCart(c => c.map(it => it.lineId === lineId ? { ...it, quantity: qty } : it));

  // Typing into the price field is free-form (transient) for everyone; the
  // min-price floor + boss/owner PIN override are enforced on blur (below), so
  // we never pop the PIN modal mid-keystroke.
  const updatePrice = (lineId, raw) =>
    setCart(c => c.map(it => it.lineId === lineId ? { ...it, unit_price: raw === "" ? "" : +raw } : it));

  // The qty/price fields are <input type=number>. Clearing the highlighted
  // digits (Delete) fires onChange with value "" — tolerate a transient empty
  // value (line stays, digits cleared) and only normalise on blur. Removal
  // stays explicit via the ✕ button / decrementing below 1.
  const onQtyInput = (lineId, raw) => {
    if (raw === "") {
      setCart(c => c.map(it => it.lineId === lineId ? { ...it, quantity: "" } : it));
      return;
    }
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return; // ignore 0/garbage mid-typing
    setCart(c => c.map(it => it.lineId === lineId ? { ...it, quantity: n } : it));
  };
  const onQtyBlur = (lineId) => setCart(c => c.map(it => {
    if (it.lineId !== lineId) return it;
    const n = parseInt(it.quantity, 10);
    return (isNaN(n) || n < 1) ? { ...it, quantity: 1 } : { ...it, quantity: n };
  }));
  const onPriceInput = (lineId, raw) => updatePrice(lineId, raw);

  // MP-APPROVAL-BUNDLE (Peter, 2026-07-15): below-cost is no longer checked or
  // interrupted HERE — the cashier sets ANY price freely while building the
  // cart, no popup mid-build. Everything needing approval (below-cost, discount,
  // credit, oversell — any combination) is discovered ONCE, together, only when
  // Confirm Payment is pressed (see saleMutation.onError's single `approval_
  // required` handler). This is the fix for the exact bugs Paul hit: a below-
  // cost popup firing per-line while the cart was still being built, then a
  // SECOND separate popup for credit moments later, each bound to its own
  // snapshot of the cart — any shift between them voided the earlier approval.
  const onPriceBlur = (lineId) => {
    const item = cart.find(it => it.lineId === lineId);
    if (!item) return;
    const p = parseFloat(item.unit_price);
    const revertTo = item.original_price || item.min_price || 0;
    if (isNaN(p) || p < 0) {
      setCart(c => c.map(it => it.lineId === lineId ? { ...it, unit_price: revertTo } : it));
      return;
    }
    setCart(c => c.map(it => it.lineId === lineId
      ? { ...it, unit_price: p, price_overridden: false, price_approval_token: undefined }
      : it));
  };

  // MP-BELOW-COST-HYBRID-APPROVAL — option 1: boss is HERE. The EXISTING
  // synchronous owner-PIN path (OwnerApprovalModal → action_type
  // 'edit_product_price' token stamped on the line → rides to checkout). Unchanged
  // behaviour, just triggered from the hybrid choice modal now.
  // MP-APPROVAL-BUNDLE: the cart lines this bundle's approval-request call needs
  // — mirrors the OLD per-gate senders' item shape exactly (product lines only;
  // debt/credit exposure is derived server-side from pay_mode/paid_amount, not
  // from itemizing debt lines here).
  const bundleLineItems = () => cart
    .filter(i => i.product_id && !isDebtish(i))
    .map(i => ({
      product_id: i.product_id, name: i.name,
      quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0,
      discount_type:  (i.discount_type && Number(i.discount_value) > 0) ? i.discount_type : null,
      discount_value: (i.discount_type && Number(i.discount_value) > 0) ? Number(i.discount_value) : null,
      discount_reason: (i.discount_type && Number(i.discount_value) > 0) ? (String(i.discount_reason || "").trim() || null) : null,
      is_damaged: i.is_damaged ? true : undefined,
      damaged_source_id: i.is_damaged ? (i.damaged_source_id || undefined) : undefined,
    }));

  // MP-APPROVAL-BUNDLE — option 1: boss is HERE. Mint ONE single-use owner-PIN
  // bundled_sale token covering every gate the cart tripped, then RESUBMIT the
  // sale with it. Nothing about the cashier's cart/prices/payment reverts —
  // the sale completes with the exact values already entered.
  const approvalBundleViaPin = () => {
    const bundle = approvalBundle;
    setApprovalBundle(null);
    if (!bundle) return;
    const who = String(user?.full_name || "").trim() || (lang === "en" ? "A cashier" : "Un caissier");
    const parts = (bundle.actions || []).map(a => {
      if (a.type === "below_cost") return lang === "en"
        ? `sell "${a.name}" for ${fmt(a.attempted_price)} (below the ${fmt(a.min_price)} floor)`
        : `vendre "${a.name}" à ${fmt(a.attempted_price)} (sous le plancher de ${fmt(a.min_price)})`;
      if (a.type === "discount") return lang === "en"
        ? `give a total discount of ${fmt(a.total_discount)}` : `accorder une remise totale de ${fmt(a.total_discount)}`;
      if (a.type === "credit") return lang === "en"
        ? `sell ${fmt(a.balance_due)} on credit` : `vendre ${fmt(a.balance_due)} à crédit`;
      if (a.type === "oversell") return lang === "en"
        ? `sell more than the stock shows (${(a.items || []).map(it => it.name).filter(Boolean).join(", ")})`
        : `vendre plus que le stock affiché (${(a.items || []).map(it => it.name).filter(Boolean).join(", ")})`;
      if (a.type === "sold_date") return lang === "en"
        ? `record this sale as actually sold on ${a.sold_date}` : `enregistrer cette vente comme ayant eu lieu le ${a.sold_date}`;
      return "";
    }).filter(Boolean);
    requestApproval({
      actionType:  "bundled_sale",
      targetTable: "pa_sales",
      targetId:    null,
      context:     { actions: bundle.actions },
      description: lang === "en"
        ? `${who} wants to: ${parts.join("; ")}.`
        : `${who} veut : ${parts.join("; ")}.`,
    })
      .then(({ token }) => { bundledApprovalTokenRef.current = token; saleMutation.mutate(); })
      .catch((e) => {
        bundledApprovalTokenRef.current = null;
        if (e?.code !== "cancelled") {
          toast.error(e?.response?.data?.message || (lang === "en" ? "Approval failed" : "Échec de l'approbation"));
        }
      });
  };

  // MP-APPROVAL-BUNDLE — option 2: boss is AWAY. Park ONE bundled approval
  // (server recomputes every gate + the cart+pay signature), HOLD the cart
  // linked to it, and clear the screen. The cashier later resumes the held
  // sale (everything pre-approved, nothing re-prompted) and completes it — OR
  // the boss completes it directly from My Requests; whichever happens first
  // cancels the other (single source of truth, closes the double-sale bug).
  const sendApprovalBundleToBoss = async () => {
    setSendingToBoss(true);
    try {
      const lineItems = bundleLineItems();
      const ar = await api.post("/sales/bundled-approval-request", {
        location_id: selectedLocation?.id,
        customer_id: customer?.id || null,
        customer_name: customer?.name || null,
        items: lineItems,
        pay_mode: isDebtOnlyCart ? "debt" : payMode,
        paid_amount: paid,
        discount_type:   (saleDiscType && Number(saleDiscValue) > 0) ? saleDiscType : null,
        discount_value:  (saleDiscType && Number(saleDiscValue) > 0) ? Number(saleDiscValue) : null,
        discount_reason: (saleDiscType && Number(saleDiscValue) > 0) ? (saleDiscReason.trim() || null) : null,
        notes: notes || null,
        sold_date: soldDate || null,
      }).then(r => r.data);
      const approvalId = ar?.approval_id;
      const hr = await api.post("/held-carts", {
        location_id: selectedLocation?.id,
        customer_id: customer?.id || null,
        label: lang === "en" ? "Sale — boss approval" : "Vente — approbation patron",
        items: lineItems.map(i => ({ product_id: i.product_id, qty: i.quantity, unit_price: i.unit_price, line_total: i.quantity * i.unit_price })),
        discount_approval_id: approvalId,
      }).then(r => r.data);
      setApprovalBundle(null);
      setCart([]); setCustomer(null); setOnlineCtx(null);
      setShowPayment(false); setPayMode("paid"); setPayModeChosen(false); setPaidAmt("");
      setSaleDiscType(""); setSaleDiscValue(""); setSaleDiscReason("");
      setSoldDate(""); setShowSoldDate(false);
      bundledApprovalIdRef.current = null; bundledApprovalTokenRef.current = null;
      qc.invalidateQueries(["held-carts"]);
      toast.success(lang === "en"
        ? `Sent to the boss + held as ${hr?.data?.hold_ref || ""}. Resume it once approved.`
        : `Envoyé au patron + mis en attente ${hr?.data?.hold_ref || ""}. Reprenez après approbation.`,
        { duration: 7000 });
    } catch (e) {
      toast.error(e?.response?.data?.message || (lang === "en" ? "Could not send the request" : "Échec de l'envoi de la demande"));
    } finally {
      setSendingToBoss(false);
    }
  };

  // Cancel the bundle choice → close the modal. Nothing to revert: prices/
  // discount/payment were never provisionally changed while the modal was open.
  const cancelApprovalBundle = () => setApprovalBundle(null);

  // MP-DISCOUNT: patch a cart line's discount fields (type/value/reason) +
  // a toggle to open/clear the line discount control.
  const setLineDisc = (lineId, patch) =>
    setCart(c => c.map(it => it.lineId === lineId ? { ...it, ...patch } : it));

  // ── MP-DISCOUNT: net totals (mirror backend order — line discounts first,
  // then sale-level on the product subtotal). Debt lines are never discounted.
  const resolveDisc = (type, value, base) => {
    const v = Number(value) || 0;
    if (!type || v <= 0) return 0;
    const a = type === "percent" ? Math.round(base * v / 100) : Math.round(v);
    return Math.max(0, Math.min(a, Math.round(base)));
  };
  const isDebtish = (i) => i.product_id === "__DEBT__" || i.type === "debt_payment";
  const lineGross = (i) => (Number(i.quantity) || 0) * (Number(i.unit_price) || 0);
  const lineDisc  = (i) => isDebtish(i) ? 0 : resolveDisc(i.discount_type, i.discount_value, lineGross(i));
  const grossProducts   = cart.reduce((s, i) => s + (isDebtish(i) ? 0 : lineGross(i)), 0);
  const debtAmt         = cart.reduce((s, i) => s + (isDebtish(i) ? lineGross(i) : 0), 0);
  const lineDiscTotal   = cart.reduce((s, i) => s + lineDisc(i), 0);
  const subtotalAfterLines = grossProducts - lineDiscTotal;
  const saleDiscAmount  = resolveDisc(saleDiscType, saleDiscValue, subtotalAfterLines);
  const totalDiscount   = lineDiscTotal + saleDiscAmount;
  const grossTotal      = grossProducts + debtAmt;                       // before any discount
  const total   = (subtotalAfterLines - saleDiscAmount) + debtAmt;       // NET — what the cashier collects
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
  // MP-OVERPAY-CAP: the APPLIED payment is capped at the amount due (cart total,
  // or the debt total for a debt-only cart). Excess tendered is CHANGE — shown,
  // never sent/stored. partialTendered is what the cashier typed; partialChange
  // is the over-amount. Under-payments (partial < due) behave exactly as before.
  const partialTendered = +paidAmt || 0;
  const debtTendered     = +debtPayAmt || 0;
  const paid    = isDebtOnlyCart
    ? (debtPayAmt ? Math.min(debtTendered, total) : total)
    : (payMode === "paid" ? total : payMode === "credit" ? 0 : Math.min(partialTendered, total));
  const balance = Math.max(0, total - paid);
  // Change to hand back (cash only): tendered over the amount due.
  const tenderChange = isDebtOnlyCart
    ? Math.max(0, debtTendered - total)
    : (payMode === "partial" ? Math.max(0, partialTendered - total) : 0);
  // Non-cash methods can't give change → block an over-due amount.
  const overDueNonCash = payMethod !== "cash" && (
    (payMode === "partial" && partialTendered > total) ||
    (isDebtOnlyCart && debtTendered > total)
  );

  // MP-PHASE-4 WAVE 2 — optimistic UI seed for POST /sales offline_queued.
  // Mirrors Wave 1's collect-debt + stock-adjust pattern. Touches every
  // cache slot a sale moves so the UI reflects the new state immediately
  // even when the actual write is sitting in pendingSync. Same clobber
  // guard applies: when offline_queued, the parent's broad
  // invalidateQueries skips the keys seeded here — otherwise an
  // invalidate → refetch → catch-fallback would return the pre-sale
  // localStorage cached array and clobber the seed.
  //
  // Closes Phase 3.1's offline-drawer ticket: cash sales seed the
  // ["current-shift", locId] drawer math (cash_sales_received +
  // expected_drawer), so the ActiveShiftIndicator + DrawerDashboardCard
  // reflect the new sale's contribution without waiting for sync.
  const seedAfterOfflineSale = ({ saleId, saleNumber, items, payMethodArg, paidArg, totalArg, balanceArg, paymentStatusArg, customerArg, locIdArg }) => {
    // ── 1. Stock decrement (stock / stock-all / stock-alerts / pos-products)
    const productLines = items.filter(i =>
      i.product_id && i.product_id !== "__DEBT__" && i.product_id !== "__DEBT_PAYMENT__" && i.type !== "debt_payment");
    const decrementMap = new Map(); // product_id → total qty sold this txn
    for (const line of productLines) {
      const q = Number(line.quantity) || 0;
      if (q > 0) decrementMap.set(line.product_id, (decrementMap.get(line.product_id) || 0) + q);
    }
    if (decrementMap.size > 0) {
      const decRow = (s) => {
        if (!s) return s;
        const sold = decrementMap.get(s.product_id);
        if (!sold) return s;
        if (s.location_id && locIdArg && s.location_id !== locIdArg) return s;
        return { ...s, quantity: Math.max(0, (Number(s.quantity) || 0) - sold) };
      };
      qc.setQueriesData(
        { predicate: (q) => {
          const k = q.queryKey?.[0];
          return k === "stock" || k === "stock-all" || k === "stock-alerts";
        }},
        (old) => {
          if (!old) return old;
          const arr = Array.isArray(old) ? old : (old.data || []);
          const next = arr.map(decRow);
          return Array.isArray(old) ? next : { ...old, data: next };
        }
      );
      // pos-products has a different shape — products with nested
      // `stock: { quantity, min_quantity, alert_enabled }`. Decrement
      // the nested quantity defensively (skip if no stock object).
      qc.setQueriesData(
        { predicate: (q) => q.queryKey?.[0] === "pos-products" },
        (old) => {
          if (!old) return old;
          const arr = Array.isArray(old) ? old : (old.data || []);
          const next = arr.map(p => {
            if (!p) return p;
            const sold = decrementMap.get(p.id);
            if (!sold || !p.stock) return p;
            const curQty = Number(p.stock.quantity) || 0;
            return { ...p, stock: { ...p.stock, quantity: Math.max(0, curQty - sold) } };
          });
          return Array.isArray(old) ? next : { ...old, data: next };
        }
      );
    }
    // ── 2. Recent sales prepend
    qc.setQueriesData(
      { predicate: (q) => q.queryKey?.[0] === "recent-sales" },
      (old) => {
        if (!old) return old;
        const arr = Array.isArray(old) ? old : (old.data || []);
        const nowIso = new Date().toISOString();
        const synth = {
          id: saleId,
          sale_number: saleNumber,
          sale_date: nowIso,
          created_at: nowIso,
          total_amount: totalArg,
          paid_amount: paidArg,
          balance_due: balanceArg,
          payment_method: payMethodArg,
          payment_status: paymentStatusArg,
          location_id: locIdArg,
          customer_id: customerArg?.id || null,
          pa_customers: customerArg
            ? { id: customerArg.id, name: customerArg.name, phone: customerArg.phone }
            : null,
          offline_queued: true,
        };
        // Cap at ~50 so an offline binge of sales doesn't bloat the
        // cache entry (Dashboard's recent-sales call uses limit=8, so
        // 50 is generous headroom).
        const next = [synth, ...arr].slice(0, 50);
        return Array.isArray(old) ? next : { ...old, data: next };
      }
    );
    // ── 3. Daily summary bump
    qc.setQueriesData(
      { predicate: (q) => q.queryKey?.[0] === "daily-summary" },
      (old) => {
        if (!old) return old;
        const s = old.data || old;
        if (!s || typeof s !== "object") return old;
        const cashBump   = payMethodArg === "cash" ? Number(paidArg) || 0 : 0;
        const creditBump = balanceArg > 0 ? Number(balanceArg) || 0 : 0;
        const next = {
          ...s,
          gross_sales:    (Number(s.gross_sales)    || 0) + (Number(totalArg) || 0),
          sale_count:     (Number(s.sale_count)     || 0) + 1,
          cash_collected: (Number(s.cash_collected) || 0) + cashBump,
          credit_sales:   (Number(s.credit_sales)   || 0) + creditBump,
          // net_profit / net_cash require cost_price + per-category
          // accounting — left as-is; the next online refetch reconciles.
        };
        return old.data ? { ...old, data: next } : next;
      }
    );
    // ── 4. Current shift drawer bump (cash only — debt and non-cash
    // payment methods don't move pa_cash_shifts.cash_sales_received).
    if (payMethodArg === "cash" && locIdArg) {
      qc.setQueryData(["current-shift", locIdArg], (old) => {
        if (!old) return old;
        const cur      = Number(old.cash_sales_received) || 0;
        const expected = Number(old.expected_drawer)     || 0;
        const cashAdd  = Number(paidArg) || 0;
        return {
          ...old,
          cash_sales_received: cur + cashAdd,
          expected_drawer:     expected + cashAdd,
        };
      });
    }
    // ── 5. Customer debt bump (credit/partial sale only)
    if (customerArg?.id && balanceArg > 0) {
      const customerId = customerArg.id;
      const priorDebt  = Number(customerArg.total_debt) || 0;
      const bumpRow = (c) => c?.id === customerId
        ? { ...c, total_debt: (Number(c.total_debt) || 0) + balanceArg }
        : c;
      qc.setQueriesData(
        { predicate: (q) => {
          const k = q.queryKey?.[0];
          return k === "customers" || k === "pos-customers";
        }},
        (old) => {
          if (!old) return old;
          const arr = Array.isArray(old) ? old : (old.data || []);
          const next = arr.map(bumpRow);
          return Array.isArray(old) ? next : { ...old, data: next };
        }
      );
      qc.setQueryData(["customer-detail", customerId], (old) => {
        if (!old) return old;
        const rec = old.data || old;
        if (!rec || rec.id !== customerId) return old;
        const next = { ...rec, total_debt: (Number(rec.total_debt) || 0) + balanceArg };
        return old.data ? { ...old, data: next } : next;
      });
      qc.setQueriesData(
        { predicate: (q) => q.queryKey?.[0] === "customer-summary" },
        (old) => {
          if (!old) return old;
          const s = old.data || old;
          if (!s || typeof s !== "object") return old;
          const becameDebtor = priorDebt === 0;
          const next = {
            ...s,
            total_debt: (Number(s.total_debt) || 0) + balanceArg,
            customers_with_debt: becameDebtor
              ? (Number(s.customers_with_debt) || 0) + 1
              : s.customers_with_debt,
          };
          return old.data ? { ...old, data: next } : next;
        }
      );
    }
  };

  const saleMutation = useMutation({
    mutationFn: async () => {
      // MP-PHANTOM-PAID-FIX (Path A/B): a CUSTOMER sale MUST carry an explicit
      // Paid/Partial/Credit choice. Enforced HERE — not only on the Confirm button's
      // disabled attr — so the approval-resubmit and hold-resume paths (which call
      // this mutation directly, bypassing the button) can't slip through with the
      // "paid" default and silently book full pay, wiping the receivable. Debt-only
      // carts have their own flow and are exempt.
      if (customer && !isDebtOnlyCart && !payModeChosen) {
        toast.error(lang === "en"
          ? "Choose how the customer paid — Paid / Partial / Credit — before completing."
          : "Choisissez le mode de paiement — Payé / Partiel / Crédit — avant de valider.", { duration: 5000 });
        setShowPayment(true);
        const gerr = new Error("PAYMODE_REQUIRED"); gerr.payModeGuard = true; throw gerr;
      }
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
        // MP-PENDING-SYNC-DETAIL: carry the customer name so an offline-queued
        // sale shows who it's for on the Pending-sync screen without a lookup.
        // Backend ignores unknown top-level fields.
        customer_name:  customer?.name || null,
        // MP-POS-DEBT-CART-FLOW + MP-CART-INVOICE-PRODUCT-BUG: every
        // non-product cart line goes to the backend as a
        // debt_payment line. That includes the legacy __DEBT__
        // sentinel when it appears alongside products (the mixed
        // cart case fixed here) — it is converted into the generic
        // debt_payment shape so the backend reduces total_debt
        // generically. product_id:null + type so the backend never
        // runs them through stock / min-price / pa_sale_items.
        // MP-PAUL-PHANTOM-LINE-FIX: only submittable lines are sent — a stale/
        // removed/blank line (no product_id or qty<=0) can never reach the
        // backend, so its min-price check can only reference items actually in
        // the cart.
        items:          cart.filter(isSubmittableLine).map(i => {
                          if (i.type === "debt_payment") {
                            // MP-OFFLINE-DISCOUNT-NULL-FIX: non-product lines must emit
                            // discount_amount: 0 (NOT null) so an offline replay can't
                            // violate pa_sale_items NOT NULL DEFAULT 0. net_amount is a
                            // GENERATED column → never sent (the DB computes it).
                            return { type: "debt_payment", product_id: null, quantity: 1, unit_price: Number(i.unit_price) || 0, customer_id: i.customer_id, discount_amount: 0 };
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
                              name: i.name, // MP-PENDING-SYNC-DETAIL: label for the queued-action detail view
                              quantity: 1,
                              unit_price: Number(i.unit_price) || 0,
                              customer_id: customer?.id,
                              discount_amount: 0, // MP-OFFLINE-DISCOUNT-NULL-FIX: non-product line → 0, never null
                              target_sale_ids: Array.isArray(i.debtSaleIds) && i.debtSaleIds.length
                                ? i.debtSaleIds
                                : undefined,
                            };
                          }
                          // MP-PENDING-SYNC-DETAIL: carry `name` so an OFFLINE-
                          // queued sale is self-describing — the Pending-sync
                          // screen renders the picking list straight from the
                          // queued payload (no server call). The backend inserts
                          // pa_sale_items by explicit columns, so this extra
                          // field is harmless/ignored server-side.
                          return { product_id: i.product_id, name: i.name, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0, cost_price: i.cost_price, price_tier: i.price_tier || "walk_in", price_approval_token: i.price_approval_token,
                            // MP-DAMAGED-GOODS: a damaged line records is_damaged
                            // on pa_sale_items and tells the server which pile row
                            // to decrement. Normal lines send neither (undefined).
                            is_damaged:        i.is_damaged ? true : undefined,
                            damaged_source_id: i.is_damaged ? (i.damaged_source_id || undefined) : undefined,
                            // MP-DISCOUNT: per-line discount (backend resolves the FCFA amount + net_amount).
                            discount_type:   (i.discount_type && Number(i.discount_value) > 0) ? i.discount_type : null,
                            discount_value:  (i.discount_type && Number(i.discount_value) > 0) ? Number(i.discount_value) : null,
                            // MP-OFFLINE-DISCOUNT-NULL-FIX: explicit 0 (never null) for symmetry with debt lines.
                            discount_amount: 0,
                            discount_reason: (i.discount_type && Number(i.discount_value) > 0) ? (String(i.discount_reason || "").trim() || null) : null };
                        }),
        payment_method: payMethod,
        paid_amount:    paid,
        // MP-PHANTOM-PAID-FIX: send the cashier's explicit payment intent so the
        // backend can reject the contradiction (pay_mode='partial' but full amount).
        pay_mode:       isDebtOnlyCart ? "debt" : payMode,
        due_date:       dueDate || null,
        notes:          notes || null,
        // MP-DISCOUNT: sale-level discount + owner-PIN token (set on resubmit
        // after DISCOUNT_APPROVAL_REQUIRED). Backend resolves the FCFA amount.
        discount_type:   (saleDiscType && Number(saleDiscValue) > 0) ? saleDiscType : null,
        discount_value:  (saleDiscType && Number(saleDiscValue) > 0) ? Number(saleDiscValue) : null,
        discount_reason: (saleDiscType && Number(saleDiscValue) > 0) ? (saleDiscReason.trim() || null) : null,
        // MP-APPROVAL-BUNDLE: ONE bundled approval covers below-cost/discount/
        // credit/oversell together — either an owner-PIN-now single-use token
        // (resubmit after approval_required) or a boss-approved id riding a
        // resumed held sale. Server re-verifies the cart+pay signature and
        // single-uses whichever is present. A sale that tripped no gate sends
        // neither → undefined → every gate untouched.
        bundled_approval_token: bundledApprovalTokenRef.current || undefined,
        bundled_approval_id: bundledApprovalIdRef.current || undefined,
        // MP-SOLD-DATE-NOTE: optional note only (see cart input above) — never
        // undefined-vs-empty ambiguity matters here since the backend treats
        // anything that isn't a clean YYYY-MM-DD as "no note".
        sold_date: soldDate || undefined,
        // MP-UNDO-TO-CART: link this re-checkout to the voided sale it replaces.
        replaces_sale_id: restoreFromIdRef.current || undefined,
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
        setCart([]); setCustomer(null); setPayMode("paid"); setPayModeChosen(false);
        setPaidAmt(""); setDueDate(""); setNotes(""); setShowPayment(false);
        restoreFromIdRef.current = null; setRestoreBanner(null); // MP-UNDO-TO-CART: clear link

        // MP-DISCOUNT: clear sale-level discount + any minted bundled-approval
        // token/id (owner-PIN-now token or a consumed async boss-approval id).
        setSaleDiscType(""); setSaleDiscValue(""); setSaleDiscReason(""); bundledApprovalTokenRef.current = null; bundledApprovalIdRef.current = null;
        setSoldDate(""); setShowSoldDate(false); // MP-SOLD-DATE-NOTE
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
        const paymentStatus =
          paid >= total ? "paid" :
          paid > 0      ? "partial" :
                          "credit";
        // saleId already declared above (online-cart link-sale path). Reuse it.
        const saleNumber = data?.data?.sale_number || data?.sale_number || `OFFLINE-${Date.now()}`;
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
          payment_status: paymentStatus,
        });
        setShowReceipt(true);

        // MP-PHASE-4 WAVE 2: seed every cache slot the sale moves so the
        // UI reflects the new state immediately offline. Gated on
        // offline_queued so online sales keep the existing
        // server-truth-then-invalidate path.
        if (data?.offline_queued) {
          seedAfterOfflineSale({
            saleId, saleNumber,
            items: cart,
            payMethodArg: payMethod,
            paidArg:      paid,
            totalArg:     total,
            balanceArg:   balance,
            paymentStatusArg: paymentStatus,
            customerArg:  customer,
            locIdArg:     selectedLocation?.id,
          });
        }
      }
      resetCart();
      // MP-INVALIDATE-AFTER-SALE: a sale moves stock + sales + dashboard
      // + reports + low-stock. RQ matches keys by array prefix, and these
      // families use distinct first elements (e.g. "stock" vs "stock-all"
      // vs "stock-alerts", and "reports-*"), so a single ["stock"] call
      // would miss most. Use a predicate that names every affected
      // first-key (and the reports-* family) so every dependent view
      // refetches immediately.
      //
      // Wave 2: when the sale was offline-queued, skip the keys
      // seedAfterOfflineSale just authored. Invalidate → refetch →
      // offline-cache catch-fallback would return the pre-sale array
      // and clobber the seed (same trap Phase 3 shift-open's "do NOT
      // invalidate current-shift while offline_queued" guard avoids).
      // Non-seeded keys still get refreshed so e.g. stock-count and
      // reports-* refetch on next reconnect.
      const offlineQueued = !!data?.offline_queued;
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey && q.queryKey[0];
          if (typeof k !== "string") return false;
          if (offlineQueued) {
            // Skip seeded keys (stock family, pos-products,
            // recent-sales, daily-summary, current-shift, customers
            // family). Note: current-shift wasn't in the original
            // invalidate list, but adding the skip keeps the rule
            // legible at the seed site.
            if (k === "stock" || k === "stock-all" || k === "stock-alerts" ||
                k === "pos-products" || k === "recent-sales" ||
                k === "daily-summary" || k === "current-shift" ||
                k === "customers" || k === "pos-customers" ||
                k === "customer-detail" || k === "customer-summary") {
              return false;
            }
          }
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
      // MP-PHANTOM-PAID-FIX: the client-side pay-mode guard already toasted; abort quietly.
      if (err.payModeGuard) return;
      const d = err.response?.data;
      // MP-PHANTOM-PAID-FIX: backend rejected a customer full-pay with no/contradictory
      // pay_mode (the resubmit hole). Steer the cashier to pick the real mode.
      if (d?.code === "PAY_MODE_REQUIRED" || d?.code === "PAY_MODE_CONTRADICTION") {
        toast.error(d.message || (lang === "en"
          ? "Confirm how the customer paid (Paid / Partial / Credit)."
          : "Confirmez le mode de paiement (Payé / Partiel / Crédit)."), { duration: 6000 });
        setShowPayment(true);
        return;
      }
      // ── MP-APPROVAL-BUNDLE (Peter, 2026-07-15) ────────────────────────────
      // Hard blocks (no approval possible — hasn't changed) stay immediate:
      if (d?.code === "DISCOUNT_BLOCKED") {
        toast.error(lang === "en"
          ? "You are not allowed to apply discounts. Ask the owner."
          : "Vous n'êtes pas autorisé à faire des remises. Demandez au propriétaire.",
          { duration: 5000 });
        return;
      }
      if (d?.code === "oversell_not_allowed") {
        setBlockModal({
          locationName: selectedLocation?.name || "",
          products: (d.items || []).map(it => it.name).filter(Boolean),
          message: (lang === "en" ? d.message_en : d.message_fr) || d.message || (lang === "en"
            ? "This product is finished. Ask the boss."
            : "Ce produit est fini. Demandez au patron."),
        });
        return;
      }
      if (d?.code === "credit_not_allowed") {
        toast.error(lang === "en"
          ? "You are not allowed to sell on credit. Ask the boss."
          : "Vous n'êtes pas autorisé à vendre à crédit. Demandez au patron.",
          { duration: 6000 });
        return;
      }
      if (d?.code === "unknown_product") {
        toast.error(d.message_en && lang === "en" ? d.message_en : (d.message_fr || d.message || "Error"), { duration: 6000 });
        return;
      }
      // Everything that CAN be approved — below-cost, discount, credit, oversell,
      // any combination — now comes back as ONE response listing every action
      // needed. ONE popup, right here, at Confirm Payment. This replaces four
      // separate per-blocker-type popups (DISCOUNT_APPROVAL_REQUIRED, credit_
      // approval_required, oversell_approval_required, and the old per-line
      // below-cost interrupt at onPriceBlur) whose separately-signed approvals
      // could void each other on a second round-trip — the exact cascading trap
      // Kusi hit (below-cost approved → credit needed → "price changed, needs
      // another approval", no popup, dead sale).
      if (d?.code === "approval_required") {
        bundledApprovalIdRef.current = null; bundledApprovalTokenRef.current = null;
        setApprovalBundle({ actions: d.actions || [] });
        return;
      }
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
      // MP-MULTIPART: a kit's PARTS are short at the sale location — name them.
      if (d?.code === "MULTIPART_PART_SHORT") {
        setBlockModal({
          locationName: d.location_name || selectedLocation?.name || "",
          products: [...new Set((d.items || []).flatMap(i => i.short_parts || []))],
          message: d.message,
        });
        return;
      }
      if (d?.code === "CREDIT_LIMIT_EXCEEDED") {
        // sales.js:158-165 returns credit_limit + current_debt +
        // new_balance as structured fields. Render the three numbers
        // in a table so the cashier sees what tripped the gate
        // without parsing a long French sentence on a phone screen.
        setCreditLimitModal({
          customer_name: customer?.name || "",
          credit_limit:  Number(d.credit_limit)  || 0,
          current_debt:  Number(d.current_debt)  || 0,
          new_balance:   Number(d.new_balance)   || 0,
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
      // MP-APPROVAL-BUNDLE: drop any stale minted approval token so it can't be reused.
      bundledApprovalTokenRef.current = null;
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

  const runCheckout = () => {
    // MP-DISCOUNT: a reason is REQUIRED whenever a discount is entered (matches
    // the backend guard; caught here first for a clean cashier message).
    const lineMissing = cart.some(i => !isDebtish(i) && i.discount_type && Number(i.discount_value) > 0 && !String(i.discount_reason || "").trim());
    const saleMissing = saleDiscType && Number(saleDiscValue) > 0 && !saleDiscReason.trim();
    if (lineMissing || saleMissing) {
      toast.error(lang === "en" ? "Enter a reason for every discount." : "Saisissez une raison pour chaque remise.");
      return;
    }
    // MP-OVERPAY-CAP: non-cash can't give change → refuse an amount over due.
    if (overDueNonCash) {
      toast.error(lang === "en"
        ? `Amount can't exceed what's due (${formatMoney(total, orgSettings.currency)}).`
        : `Le montant ne peut pas dépasser le montant dû (${formatMoney(total, orgSettings.currency)}).`);
      return;
    }
    setOversellModal(null); saleMutation.mutate();
  };
  const attemptCheckout = () => {
    const real = cart.filter(i =>
      i.product_id && i.product_id !== "__DEBT__" &&
      i.product_id !== "__DEBT_PAYMENT__" && i.type !== "debt_payment");
    // MP-MULTIPART: a kit parent holds NO stock of its own — its parts do. Skip it
    // in the "not stocked here" / oversell client checks (they'd see stock=null/0 and
    // wrongly block). The backend validates part availability at the sale location and
    // blocks with the SHORT PART name(s) (MULTIPART_PART_SHORT) when a part is absent.
    // MP-DAMAGED-GOODS-SELL-LOCATION-FIX: a damaged line's stock comes from the pile
    // row (pa_damaged_stock, at ITS OWN location via damaged_source_id), not from the
    // till's sellable stock — the handoff deliberately leaves `stock` undefined for
    // these lines, which wrongly tripped the "not stocked at this location" block.
    // The backend consumes purely by damaged_source_id (location-agnostic), so skip
    // both client-side stock checks for it exactly like a kit line.
    const isKitLine = (i) => i.is_multipart || Object.prototype.hasOwnProperty.call(parentAvail, i.product_id) || i.is_damaged;
    const notStocked = real.filter(i => !isKitLine(i) && (i.stock === null || i.stock === undefined));
    if (notStocked.length) {
      setBlockModal({
        locationName: selectedLocation?.name || "",
        products: notStocked.map(i => i.name),
        message: null
      });
      return;
    }
    const oversold = real
      .filter(i => !isKitLine(i) && typeof i.stock === "number" && i.quantity > i.stock)
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
      setShowPayment(false); setPayMode("paid"); setPayModeChosen(false); setPaidAmt("");
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
      // MP-APPROVAL-BUNDLE: a hold linked to a bundled approval rebuilds WITH the
      // exact boss-approved cart (items/discount/pay_mode/paid_amount — the whole
      // sale is signature-bound) only when the approval is 'approved'. While
      // pending, or if rejected/expired, it resumes at the plain held values with
      // NO approval id attached — Confirm Payment will re-trigger the SAME unified
      // approval prompt if still needed, never silently skip it. Any hold left over
      // from BEFORE this redesign (legacy discount/below_cost_sale action_type) is
      // treated the same as a plain hold here — its approval id is no longer a
      // field the backend reads, so it resumes at its held price/discount but
      // needs a fresh (now single, bundled) approval to complete.
      const da = h?.discount_approval || null;
      const isBundle = !!da && da.action_type === "bundled_sale";
      const approved = isBundle && da.status === "approved";
      const bundleRejected = isBundle && !approved && da.status !== "pending";
      // current_stock lives on the held-cart items; index it by product so we keep
      // the low-stock warning even when rebuilding from the approval payload.
      const stockByProduct = {};
      (h?.items || []).forEach(it => { if (it.product_id) stockByProduct[it.product_id] = it.current_stock; });
      const sr = approved ? da.payload?.sale_request : null;
      const srcItems = (sr && Array.isArray(sr.items) && sr.items.length)
        ? sr.items.filter(it => it.product_id)
        : (h?.items || []);
      // MP-HOLD-RESUME-CUSTOMER: restore the held customer for EVERY hold (a
      // normal hold's own customer_id was previously ignored, reverting to
      // walk-in). Prefer the approved bundle's customer, else the held cart's own
      // customer_id. null = genuine walk-in.
      const heldCustomerId = (sr && sr.customer_id) || h?.customer_id || null;
      let resumedCustomer = null;
      if (heldCustomerId) {
        try { resumedCustomer = await api.get(`/customers/${heldCustomerId}`).then(r => r.data?.data); } catch { /* ignore */ }
      }
      const resumedTier = resumedCustomer ? tierForCustomer(resumedCustomer) : "walk_in";
      const hydrated = await Promise.all(srcItems.map(async it => {
        let p = null;
        try { p = await api.get(`/products/${it.product_id}`).then(r => r.data?.data); } catch { /* ignore */ }
        const cs = stockByProduct[it.product_id];
        return {
          lineId: genLineId(),
          product_id: it.product_id,
          name: it.name || p?.name || "—",
          unit: p?.unit, barcode: p?.barcode,
          quantity: Number(it.qty != null ? it.qty : it.quantity) || 1,
          // MP-HOLD-RESUME-PRESERVE-PRICE: the HELD unit_price is authoritative —
          // never fall back to the product's current walk-in price. Keep a held
          // price of 0 (giveaway) intact; only derive from line_total/qty or the
          // product price when the held record genuinely lacks a unit_price.
          unit_price: bundleRejected
            // Rejected bundle → snap the line back to the customer's tier price
            // (walk-in / wholesale / vip), never the rejected under-min value.
            ? (priceForTier(p || {}, resumedTier) || Number(p?.sell_price) || 0)
            : (it.unit_price != null
                ? Number(it.unit_price)
                : (it.line_total != null && Number(it.qty || it.quantity)
                    ? Number(it.line_total) / Number(it.qty || it.quantity)
                    : Number(p?.sell_price) || 0)),
          original_price: Number(p?.sell_price) || 0,
          price_tier: resumedTier,
          sell_price: Number(p?.sell_price) || 0,
          wholesale_price: Number(p?.wholesale_price) || 0,
          min_price: p?.min_price || 0,
          cost_price: p?.cost_price,
          stock: cs != null ? Number(cs) : null,
          // MP-HOLD-RESUME-PRESERVE-PRICE: pin the held price so the customer-change
          // re-pricing effect (which moves lines to the tier/walk-in price) leaves
          // resumed lines alone — the held record is the source of truth. Editing a
          // line later clears this flag as usual. A REJECTED bundle line is NOT
          // pinned — it's back at the legit tier price and freely editable/sellable.
          price_overridden: bundleRejected ? false : true,
          // line discount + damaged-line linkage restored only from an approved
          // bundle's signature-bound sale_request (a plain hold's raw items never
          // carry these fields).
          discount_type:  sr && it.discount_type ? it.discount_type : "",
          discount_value: sr && it.discount_value != null ? String(it.discount_value) : "",
          discount_reason: sr && it.discount_reason ? it.discount_reason : "",
          is_damaged: sr && it.is_damaged ? true : (it.is_damaged || undefined),
          damaged_source_id: sr && it.is_damaged ? (it.damaged_source_id || undefined) : undefined,
          // MP-BELOW-COST-PERSIST: mark every line of a boss-approved bundle so
          // re-attaching the customer / restoring the draft keeps the approved
          // price (the whole cart is signature-bound to these values).
          below_cost_approved: approved ? true : undefined,
        };
      }));
      setCart(hydrated.filter(isSubmittableLine));

      // Sale-level discount + pay-mode/paid-amount + notes — all sourced from the
      // approved bundle's signature-bound sale_request, nowhere else.
      if (sr && sr.discount_type && Number(sr.discount_value) > 0) {
        setSaleDiscType(sr.discount_type); setSaleDiscValue(String(sr.discount_value)); setSaleDiscReason(sr.discount_reason || "");
      } else {
        setSaleDiscType(""); setSaleDiscValue(""); setSaleDiscReason("");
      }
      if (sr && (sr.pay_mode === "paid" || sr.pay_mode === "partial" || sr.pay_mode === "credit")) {
        setPayMode(sr.pay_mode); setPayModeChosen(true);
        if (sr.paid_amount != null) setPaidAmt(String(sr.paid_amount));
      }
      if (sr && sr.notes) setNotes(sr.notes);
      // MP-SOLD-DATE-NOTE: restore the exact approved sold_date (or clear it —
      // a resumed-but-unapproved/rejected hold must not carry a stale one).
      if (sr && sr.sold_date) { setSoldDate(sr.sold_date); setShowSoldDate(true); }
      else { setSoldDate(""); setShowSoldDate(false); }
      // MP-APPROVAL-BUNDLE: ONE ref carries the approved bundle id so Confirm
      // Payment sends it straight through with no re-prompt. Unapproved/legacy
      // holds resume with it unset — Confirm Payment re-triggers the (now
      // unified) approval prompt if the cart still needs one.
      bundledApprovalIdRef.current = approved ? da.id : null;
      bundledApprovalTokenRef.current = null;
      // Customer already resolved above (held-cart customer_id or approval payload).
      setCustomer(resumedCustomer || null);
      setShowResume(false);
      const short = hydrated.filter(i => typeof i.stock === "number" && i.quantity > i.stock);
      const resumeMsg = approved
        ? (lang === "en" ? `Resumed ${h.hold_ref} — boss-approved, ready to complete` : `Reprise ${h.hold_ref} — approuvé par le patron, prêt à finaliser`)
        : (da && da.status === "pending")
          ? (lang === "en" ? `Resumed ${h.hold_ref} — still awaiting boss approval` : `Reprise ${h.hold_ref} — approbation en attente`)
          : da
            ? (lang === "en" ? `Resumed ${h.hold_ref} — the request was not approved; resuming without it` : `Reprise ${h.hold_ref} — demande non approuvée; reprise sans`)
            : (lang === "en" ? `Resumed ${h.hold_ref}` : `Reprise ${h.hold_ref}`);
      toast.success(resumeMsg, { duration: da ? 6000 : 3000 });
      // MP-BELOW-COST-REJECT-REVERT: tell the cashier the under-min price was undone
      // and the cart is sellable again — no dead-end.
      if (bundleRejected) {
        const rl = hydrated.filter(isSubmittableLine);
        const detail = rl.length === 1
          ? fmt(rl[0].unit_price)
          : (lang === "en" ? "their normal prices" : "leurs prix normaux");
        toast(lang === "en"
          ? `Request rejected — prices reverted to ${detail}. Sell at the normal price or re-request a new one.`
          : `Demande refusée — prix rétablis à ${detail}. Vendez au prix normal ou refaites une demande.`,
          { icon: "↩️", duration: 7000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
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

  // MP-MOBILE-UI-PHASE-2A: the cart-pane inner JSX, captured once so
  // it can be reused by both the desktop right-pane and the mobile
  // bottom sheet without duplicating ~170 lines of JSX. All state,
  // handlers, and derived values are closed over from POSPage's
  // outer scope — same behavior as the previous inline render.
  const cartPaneInner = (
    <>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>🛒 {lang === "en" ? "Cart" : "Panier"}</span>
              {cart.length > 0 && <span style={{ background: "var(--brand)", color: "#152B52", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{cart.length}</span>}
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
            <div style={{ padding: "8px 14px", background: "rgba(251,197,3,0.12)", borderBottom: "1px solid rgba(251,197,3,0.3)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>📥</span>
              <span style={{ fontSize: 11, color: "var(--brand-light)", fontWeight: 600, flex: 1, minWidth: 0 }}>
                {lang === "en"
                  ? `Prefilled from Dozie order ${onlineCtx.ref} — sale links back on checkout`
                  : `Pré-rempli depuis Dozie ${onlineCtx.ref} — la vente sera liée`}
              </span>
            </div>
          )}

          {/* MP-UNDO-TO-CART: editing a voided sale — a NEW receipt is issued on checkout. */}
          {restoreBanner && (
            <div style={{ padding: "8px 14px", background: "rgba(52,211,153,0.12)", borderBottom: "1px solid rgba(52,211,153,0.3)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>↩</span>
              <span style={{ fontSize: 11, color: "#34d399", fontWeight: 600, flex: 1, minWidth: 0 }}>
                {lang === "en"
                  ? `Editing voided ${restoreBanner} → a new receipt will be issued on checkout`
                  : `Modification de la vente annulée ${restoreBanner} → un nouveau reçu sera émis`}
              </span>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: (mobile && showPayment) ? "none" : "block" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>🛒</div>
                <div style={{ fontSize: 12 }}>{lang === "en" ? "Cart is empty" : "Panier vide"}</div>
              </div>
            ) : cart.map((item, idx) => (
              <div key={item.lineId} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: (item.isDebt || item.isDebtPayment) ? "rgba(239,68,68,0.04)" : "transparent" }}>
                {(item.isDebt || item.isDebtPayment) && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    {item.isDebtPayment ? "💰" : "🧾"} {lang === "en" ? "Debt Repayment" : "Remboursement dette"} · DEBT
                  </div>
                )}
                {/* MP-DAMAGED-GOODS: clear badge so the cashier sees this line is
                    a damaged-goods sale (still tier-priced, discount allowed). */}
                {item.is_damaged && (
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    🔨 {lang === "en" ? "Damaged" : "Endommagé"}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: (item.isDebt || item.isDebtPayment) ? 4 : 7 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1, paddingRight: 8, lineHeight: 1.3 }}>{item.name}</div>
                  <button onClick={() => removeLine(item.lineId)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>✕</button>
                </div>
                {item.isDebt ? (
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171", textAlign: "right" }}>{fmt(item.unit_price)}</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => updateQty(item.lineId, item.quantity - 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                    <input type="number" value={item.quantity} onChange={e => onQtyInput(item.lineId, e.target.value)} onBlur={() => onQtyBlur(item.lineId)} style={{ width: 40, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 4px", fontSize: 13 }} />
                    <button onClick={() => updateQty(item.lineId, item.quantity + 1)} style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    <div style={{ flex: 1, position: "relative" }}>
                      <input type="number" value={item.unit_price} onChange={e => onPriceInput(item.lineId, e.target.value)} onBlur={() => onPriceBlur(item.lineId)} style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px 6px 4px 18px", fontSize: 12 }} />
                      <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)" }}>F</span>
                    </div>
                    {/* MP-DISCOUNT: line total — struck gross + net when discounted. */}
                    {lineDisc(item) > 0 ? (
                      <div style={{ minWidth: 70, textAlign: "right", lineHeight: 1.15 }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", textDecoration: "line-through" }}>{fmt(lineGross(item))}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>{fmt(lineGross(item) - lineDisc(item))}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-light)", minWidth: 56, textAlign: "right" }}>{fmt(lineGross(item))}</div>
                    )}
                  </div>
                )}
                {/* MP-DISCOUNT: per-line discount control (product lines only). */}
                {!item.isDebt && !isDebtish(item) && (
                  item.discount_type ? (
                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                      <button onClick={() => setLineDisc(item.lineId, { discount_type: item.discount_type === "amount" ? "percent" : "amount" })}
                        style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                        title={lang === "en" ? "Toggle amount / percent" : "Basculer montant / %"}>{item.discount_type === "amount" ? "F" : "%"}</button>
                      <input type="number" value={item.discount_value ?? ""} placeholder={lang === "en" ? "off" : "remise"}
                        onChange={e => setLineDisc(item.lineId, { discount_value: e.target.value })}
                        style={{ width: 56, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 6px", fontSize: 12 }} />
                      <input type="text" value={item.discount_reason ?? ""} placeholder={lang === "en" ? "reason *" : "raison *"}
                        onChange={e => setLineDisc(item.lineId, { discount_reason: e.target.value })}
                        style={{ flex: 1, minWidth: 80, background: "var(--bg-elevated)", border: `1px solid ${(Number(item.discount_value) > 0 && !String(item.discount_reason || "").trim()) ? "#f87171" : "var(--border)"}`, borderRadius: 6, color: "var(--text-primary)", padding: "3px 6px", fontSize: 12 }} />
                      <button onClick={() => setLineDisc(item.lineId, { discount_type: null, discount_value: "", discount_reason: "" })}
                        style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }} title={lang === "en" ? "Remove discount" : "Retirer la remise"}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setLineDisc(item.lineId, { discount_type: "percent", discount_value: "", discount_reason: "" })}
                      style={{ marginTop: 4, background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>
                      − {lang === "en" ? "Add discount" : "Ajouter une remise"}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: "14px 16px", borderTop: "2px solid var(--border)", background: "var(--bg-elevated)", ...(mobile && showPayment ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : {}) }}>
            {/* MP-DISCOUNT: sale-level discount control (only with product lines). */}
            {grossProducts > 0 && (
              saleDiscType ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>{lang === "en" ? "Sale discount" : "Remise globale"}</span>
                  <button onClick={() => setSaleDiscType(saleDiscType === "amount" ? "percent" : "amount")}
                    style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{saleDiscType === "amount" ? "F" : "%"}</button>
                  <input type="number" value={saleDiscValue} placeholder={lang === "en" ? "off" : "remise"} onChange={e => setSaleDiscValue(e.target.value)}
                    style={{ width: 56, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 6px", fontSize: 12 }} />
                  <input type="text" value={saleDiscReason} placeholder={lang === "en" ? "reason *" : "raison *"} onChange={e => setSaleDiscReason(e.target.value)}
                    style={{ flex: 1, minWidth: 80, background: "var(--bg-card)", border: `1px solid ${(Number(saleDiscValue) > 0 && !saleDiscReason.trim()) ? "#f87171" : "var(--border)"}`, borderRadius: 6, color: "var(--text-primary)", padding: "3px 6px", fontSize: 12 }} />
                  <button onClick={() => { setSaleDiscType(""); setSaleDiscValue(""); setSaleDiscReason(""); }}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ) : (
                <button onClick={() => setSaleDiscType("percent")}
                  style={{ marginBottom: 8, background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>
                  − {lang === "en" ? "Add sale discount" : "Ajouter une remise globale"}
                </button>
              )
            )}

            {/* MP-SOLD-DATE-NOTE: optional note only — never affects the receipt's
                real date or any total. Hidden entirely for a blocked staffer
                (server enforces this independently either way). */}
            {soldDateAllowed && cart.length > 0 && (
              showSoldDate || soldDate ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>
                    {lang === "en" ? "Sold date" : "Date de vente"}
                  </span>
                  <input type="date" value={soldDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setSoldDate(e.target.value)}
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "3px 6px", fontSize: 12 }} />
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                    {lang === "en" ? "note only — doesn't change the receipt date" : "note seulement — ne change pas la date du reçu"}
                  </span>
                  <button onClick={() => { setSoldDate(""); setShowSoldDate(false); }}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ) : (
                <button onClick={() => setShowSoldDate(true)}
                  style={{ marginBottom: 8, background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>
                  − {lang === "en" ? "This was actually sold earlier (add a note)" : "Cette vente a eu lieu plus tôt (ajouter une note)"}
                </button>
              )
            )}

            {/* MP-DISCOUNT: Gross → −Discount → Net summary when any discount applies. */}
            {totalDiscount > 0 && (
              <div style={{ marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
                  <span>{lang === "en" ? "Gross" : "Brut"}</span><span>{fmt(grossTotal)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#34d399" }}>
                  <span>{lang === "en" ? "Discount" : "Remise"}</span><span>−{fmt(totalDiscount)}</span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-secondary)" }}>{totalDiscount > 0 ? (lang === "en" ? "Net total" : "Total net") : "Total"}</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: "var(--brand-light)", letterSpacing: "-0.5px" }}>{fmt(total)}</span>
            </div>

            {!showPayment ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <RestrictedAction block>
                  <button className="btn btn-primary btn-block" disabled={cart.length === 0 || !selectedLocation} onClick={() => setShowPayment(true)} style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12 }}>
                    {!selectedLocation ? (lang === "en" ? "Select location first" : "Choisir emplacement") : hasDebt ? (lang === "en" ? "Collect Payment →" : "Encaisser →") : (lang === "en" ? "Proceed to Payment →" : "Paiement →")}
                  </button>
                </RestrictedAction>
                {!hasDebt && (
                  <button disabled={cart.length === 0 || !selectedLocation} onClick={() => { setHoldLabel(""); setHoldNotes(""); setShowHold(true); }}
                    style={{ height: 40, fontSize: 13, fontWeight: 700, borderRadius: 12, cursor: cart.length === 0 ? "not-allowed" : "pointer", background: "transparent", border: "1.5px solid rgba(245,158,11,0.5)", color: cart.length === 0 ? "var(--text-muted)" : "#fbbf24", opacity: cart.length === 0 || !selectedLocation ? 0.5 : 1 }}>
                    ⏸ {lang === "en" ? "Hold Sale" : "Mettre en attente"}
                  </button>
                )}
              </div>
            ) : (
              // MP-PAUL-FIX-6 (3 Jun): partial-pay Confirm hidden on phone.
              // Original layout stacked all payment fields + Back/Confirm
              // in one un-bounded div; on a small phone with virtual
              // keyboard open the Confirm fell below the visible viewport.
              // Now: flex-column with the scrollable form on top
              // (maxHeight: 50vh on mobile so it doesn't push the action
              // row off-screen even when keyboard is up) and the
              // Back/Confirm row pinned below the scroll boundary. Desktop
              // right-pane is unaffected because its parent already has
              // overflow handling.
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: mobile ? 1 : undefined }}>
                <div style={{
                  overflowY: "auto",
                  minHeight: 0,
                  // Fill the available sheet height and scroll; the Back/Confirm
                  // footer below is pinned (flexShrink:0), so every payment mode
                  // (Full/Partial/Credit) keeps Confirm reachable with no fixed
                  // height cap to recompute on mode change. + --kb-inset so the
                  // focused field scrolls clear of the on-screen keyboard.
                  flex: mobile ? 1 : undefined,
                  paddingRight: 2,
                  paddingBottom: "var(--kb-inset, 0px)",
                }}>
                  {isDebtOnlyCart && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                        {lang === "en" ? "Amount to collect (blank = full balance)" : "Montant à encaisser (vide = tout)"}
                      </div>
                      <input className="input" type="number"
                        placeholder={`${t("full_balance", lang)}: ${formatMoney(total, orgSettings.currency)}`}
                        value={debtPayAmt} onChange={e => setDebtPayAmt(e.target.value)}
                        style={{ marginBottom: 4 }} />
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {lang === "en" ? "Leave blank to collect full balance" : "Laissez vide pour encaisser le solde total"}
                      </div>
                      {/* MP-OVERPAY-CAP: collection is capped at the balance. */}
                      {overDueNonCash && (
                        <div style={{ marginTop: 6, padding: "8px 12px", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 8, fontSize: 12, color: "#f87171", fontWeight: 600 }}>
                          {lang === "en"
                            ? `Amount can't exceed what's due (${formatMoney(total, orgSettings.currency)}).`
                            : `Le montant ne peut pas dépasser le montant dû (${formatMoney(total, orgSettings.currency)}).`}
                        </div>
                      )}
                      {payMethod === "cash" && tenderChange > 0 && (
                        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.30)", borderRadius: 8, fontSize: 13, color: "#34d399", fontWeight: 700 }}>
                          <span>{lang === "en" ? "Change" : "Monnaie"}</span>
                          <span>{formatMoney(tenderChange, orgSettings.currency)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {!isDebtOnlyCart && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                      {PAYMENT_MODES.map(pm => {
                        // MP-POS-SILENT-FULLPAY-GUARD: suppress the pre-selected
                        // "Paid" highlight for customer sales until the cashier
                        // actually taps a mode, so the default can't be mistaken
                        // for a deliberate choice. Walk-ins keep the fast default.
                        const sel = payMode === pm.key && (payModeChosen || !customer);
                        return (
                        <button key={pm.key} onClick={() => { setPayMode(pm.key); setPayModeChosen(true); }} style={{ padding: "8px 4px", borderRadius: 10, border: `1.5px solid ${sel ? pm.color : "var(--border)"}`, background: sel ? pm.color + "18" : "transparent", color: sel ? pm.color : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, transition: "all 0.15s" }}>
                          <div style={{ fontSize: 14 }}>{pm.icon}</div>
                          <div style={{ marginTop: 2 }}>{lang === "en" ? pm.en : pm.fr}</div>
                        </button>
                        );
                      })}
                    </div>
                  )}
                  {!isDebtOnlyCart && customer && !payModeChosen && (
                    <div style={{ padding: "8px 12px", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 8 }}>
                      ⚠️ {lang === "en"
                        ? "Choose how this customer is paying — Paid in full, Partial, or Credit — before confirming."
                        : "Choisissez le mode de paiement du client — Payé, Partiel ou Crédit — avant de valider."}
                    </div>
                  )}
                  {payMode === "partial" && !isDebtOnlyCart && (
                    <input className="input" type="number" placeholder={`${t("amount_paid", lang)} (${currencySymbol(orgSettings.currency)})`} value={paidAmt} onChange={e => setPaidAmt(e.target.value)} style={{ marginBottom: 8 }} />
                  )}
                  {/* MP-OVERPAY-CAP: cash → show change; non-cash over-due → block message. */}
                  {payMode === "partial" && !isDebtOnlyCart && overDueNonCash && (
                    <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 8, fontSize: 12, color: "#f87171", fontWeight: 600, marginBottom: 8 }}>
                      {lang === "en"
                        ? `Amount can't exceed what's due (${formatMoney(total, orgSettings.currency)}).`
                        : `Le montant ne peut pas dépasser le montant dû (${formatMoney(total, orgSettings.currency)}).`}
                    </div>
                  )}
                  {payMode === "partial" && !isDebtOnlyCart && payMethod === "cash" && tenderChange > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.30)", borderRadius: 8, fontSize: 13, color: "#34d399", fontWeight: 700, marginBottom: 8 }}>
                      <span>{lang === "en" ? "Change" : "Monnaie"}</span>
                      <span>{formatMoney(tenderChange, orgSettings.currency)}</span>
                    </div>
                  )}
                  {(payMode === "partial" || payMode === "credit") && !isDebtOnlyCart && (
                    <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ marginBottom: 8 }} title={t("due_date", lang)} />
                  )}
                  <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                    {PAY_METHODS.map(m => (
                      <button key={m.key} onClick={() => setPayMethod(m.key)} style={{ flex: 1, padding: "6px 4px", borderRadius: 8, border: `1.5px solid ${payMethod === m.key ? "var(--brand)" : "var(--border)"}`, background: payMethod === m.key ? "rgba(251,197,3,0.12)" : "transparent", color: payMethod === m.key ? "var(--brand-light)" : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700, transition: "all 0.15s" }}>
                        <div>{m.icon}</div>
                        <div style={{ marginTop: 1 }}>{m.key === "mobile_money" ? momoLabel(orgSettings.currency, lang === "en") : (lang === "en" ? m.en : m.fr)}</div>
                      </button>
                    ))}
                  </div>
                  <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ color: "var(--text-muted)" }}>Total</span><strong>{formatMoney(total, orgSettings.currency)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#10b981" }}>{lang === "en" ? "Paid" : "Payé"}</span>
                      <strong style={{ color: "#10b981" }}>{formatMoney(paid, orgSettings.currency)}</strong>
                    </div>
                    {balance > 0 && !hasDebt && (
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)", marginTop: 3 }}>
                        <span style={{ color: "#f87171", fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste"}</span>
                        <strong style={{ color: "#f87171" }}>{formatMoney(balance, orgSettings.currency)}</strong>
                      </div>
                    )}
                  </div>
                  {/* MP-PHANTOM-PAID-FIX: make the remainder-becomes-debt explicit BEFORE
                      Confirm, incl. for debt-carrying customers (whose "Balance due" line
                      above is otherwise hidden by !hasDebt). */}
                  {customer && balance > 0 && (payMode === "partial" || payMode === "credit") && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginBottom: 10, borderRadius: 10, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.40)", fontSize: 12.5, fontWeight: 700, color: "#f87171" }}>
                      <span>→ {lang === "en" ? `Added to ${customer.name || "customer"}'s debt` : `Ajouté à la dette de ${customer.name || "ce client"}`}</span>
                      <span>{formatMoney(balance, orgSettings.currency)}</span>
                    </div>
                  )}
                  {(payMode === "credit" || payMode === "partial") && !customer && (
                    <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, fontSize: 12, color: "#f87171", marginBottom: 8 }}>
                      ⚠️ {lang === "en" ? "A registered customer is required for credit or partial sales." : "Un client enregistré est requis pour les ventes à crédit ou partielles."}
                    </div>
                  )}
                </div>
                {/* Action footer — sits OUTSIDE the scroll boundary so
                    Confirm stays visible on small phones with keyboard up.
                    Shift warning is kept just above the buttons (also
                    outside the scroll area) so it can't be scrolled out
                    of sight either. */}
                {!shiftIsOpen && (
                  <div style={{ padding: "8px 12px", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, fontSize: 12, color: "#fbbf24", fontWeight: 600, marginTop: 8, marginBottom: 8, textAlign: "center" }}>
                    {noShiftHint(lang)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, paddingTop: 8, flexShrink: 0, borderTop: mobile ? "1px solid var(--border)" : "none", background: "var(--bg-surface)" }}>
                  <button onClick={() => setShowPayment(false)} className="btn btn-secondary" style={{ flex: 1 }}>← {lang === "en" ? "Back" : "Retour"}</button>
                  <PayButton
                    saleMutation={saleMutation}
                    onClick={attemptCheckout}
                    disabled={!shiftIsOpen || (!hasDebt && payMode === "partial" && !paidAmt) || ((payMode === "credit" || payMode === "partial") && !customer) || (!isDebtOnlyCart && !!customer && !payModeChosen)}
                    title={!shiftIsOpen ? noShiftHint(lang) : ""}
                    label={lang === "en" ? "✓ Confirm" : "✓ Valider"}
                    successLabel={lang === "en" ? "✓ Sold!" : "✓ Vendu !"}
                    errorLabel={lang === "en" ? "✕ Failed" : "✕ Échec"}
                    onSuccessTimeout={() => setSheetOpen(false)}
                    className="btn btn-success"
                    style={{ flex: 2, fontWeight: 700 }}
                  />
                </div>
              </div>
            )}
          </div>
    </>
  );

  return (
    <>
      {approvalModal}
      {/* ── MP-APPROVAL-BUNDLE: ONE popup lists every gate this cart tripped
          (below-cost / discount / credit / oversell, any combination) — the
          cashier builds the WHOLE order with no interruptions, sees everything
          at once here, and the owner accepts/denies ONCE. No cascading. ── */}
      {approvalBundle && (
        <div style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>
              🔐 {lang === "en" ? "This sale needs the owner's approval" : "Cette vente nécessite l'approbation du patron"}
            </div>
            <div style={{ marginBottom: 16 }}>
              {approvalBundle.actions.some(a => a.type === "below_cost") && (
                <BelowCostLossDetail
                  payload={{ below_cost: approvalBundle.actions.filter(a => a.type === "below_cost")
                    .map(a => ({ name: a.name, unit_price: a.attempted_price, min_price: a.min_price, qty: a.quantity })) }}
                  en={lang === "en"} fmt={fmt} cashier={user?.full_name} />
              )}
              {approvalBundle.actions.filter(a => a.type === "discount").map((a, i) => (
                <DiscountApprovalDetail key={`d${i}`} payload={{ items: cart, total_discount: a.total_discount }} en={lang === "en"} fmt={fmt} cashier={user?.full_name} />
              ))}
              {approvalBundle.actions.filter(a => a.type === "credit").map((a, i) => (
                <div key={`c${i}`} style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 6 }}>
                  {lang === "en" ? `Credit sale: ${fmt(a.balance_due)} on the customer's account.` : `Vente à crédit : ${fmt(a.balance_due)} sur le compte du client.`}
                </div>
              ))}
              {approvalBundle.actions.filter(a => a.type === "oversell").map((a, i) => (
                <div key={`o${i}`} style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 6 }}>
                  {(a.items || []).map((it, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{it.name}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {lang === "en" ? `have ${it.available}, selling ${it.need}` : `stock ${it.available}, vente ${it.need}`}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {approvalBundle.actions.filter(a => a.type === "sold_date").map((a, i) => (
                <div key={`sd${i}`} style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 6 }}>
                  {lang === "en" ? `Sold-date note: this sale will show as actually sold on ${a.sold_date}.` : `Note de date de vente : cette vente indiquera avoir eu lieu le ${a.sold_date}.`}
                </div>
              ))}
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                {lang === "en" ? "Choose how to get the owner's approval:" : "Choisissez comment obtenir l'approbation :"}
              </div>
            </div>
            <button onClick={approvalBundleViaPin} disabled={sendingToBoss}
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--brand)", background: "var(--brand)", color: "#152B52", cursor: "pointer", textAlign: "left", fontWeight: 700, marginBottom: 10 }}>
              🔑 {lang === "en" ? "Enter owner PIN now" : "Saisir le PIN du patron"}
              <div style={{ fontSize: 11, fontWeight: 400, color: "#152B52", opacity: 0.8, marginTop: 3 }}>
                {lang === "en" ? "The owner is here — completes the sale immediately, exactly as entered." : "Le patron est présent — termine la vente immédiatement, telle que saisie."}
              </div>
            </button>
            <button onClick={sendApprovalBundleToBoss} disabled={sendingToBoss}
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", cursor: sendingToBoss ? "wait" : "pointer", textAlign: "left", fontWeight: 700, marginBottom: 10 }}>
              📲 {sendingToBoss ? (lang === "en" ? "Sending…" : "Envoi…") : (lang === "en" ? "Send request to boss" : "Envoyer la demande au patron")}
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginTop: 3 }}>
                {lang === "en" ? "Boss is away — holds this sale; resume it once approved on their phone." : "Le patron est absent — met la vente en attente ; reprenez-la après approbation sur son téléphone."}
              </div>
            </button>
            <button onClick={cancelApprovalBundle} disabled={sendingToBoss}
              style={{ width: "100%", padding: "10px", border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
              {lang === "en" ? "Cancel" : "Annuler"}
            </button>
          </div>
        </div>
      )}
      {/* ── DEBT MODAL ─────────────────────────────────────── */}
      {showDebtModal && debtInvoices.length > 0 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>🧾 {lang === "en" ? "Open Invoices" : "Factures impayées"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {customer?.name} {lang === "en" ? "has unpaid invoices. Select which to collect:" : "a des factures impayées. Choisissez lesquelles encaisser :"}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setSelectedDebtIds(new Set(debtInvoices.map(i => i.id)))} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(251,197,3,0.1)", color: "var(--brand-light)", cursor: "pointer", fontWeight: 600 }}>
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
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "rgba(251,197,3,0.08)" : "var(--bg-card)", cursor: "pointer", transition: "all 0.15s" }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked ? "var(--brand)" : "var(--border)"}`, background: checked ? "var(--brand)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#152B52", fontSize: 11, fontWeight: 700 }}>
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
                        {fmt(inv.effective_balance_due ?? inv.balance_due)}
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
                <span style={{ fontWeight: 600 }}>{fmt(debtPaperBalance)}</span>
              </div>
            )}
            {selectedDebtIds.size > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{lang === "en" ? "To collect:" : "À encaisser :"}</span>
                <strong style={{ color: "#f87171" }}>{fmt(debtInvoices.filter(i => selectedDebtIds.has(i.id)).reduce((s, i) => s + parseFloat(i.effective_balance_due ?? i.balance_due), 0))}</strong>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowDebtModal(false)} style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Skip" : "Ignorer"}
              </button>
              <button onClick={addDebtToCart} disabled={selectedDebtIds.size === 0}
                style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: selectedDebtIds.size > 0 ? "var(--brand)" : "var(--border)", color: selectedDebtIds.size > 0 ? "#152B52" : "var(--text-muted)", cursor: selectedDebtIds.size > 0 ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 14, transition: "all 0.15s" }}>
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
              ? <>This customer owes <strong style={{ color: "#f87171" }}>{fmt(debtBanner.amount)}</strong>. Add debt payment to cart?</>
              : <>Ce client doit <strong style={{ color: "#f87171" }}>{fmt(debtBanner.amount)}</strong>. Ajouter au panier ?</>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDebtBanner(null)}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              {lang === "en" ? "Skip — sale only" : "Ignorer"}
            </button>
            <button onClick={addDebtPaymentToCart}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#152B52", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              {lang === "en" ? "Add to Cart" : "Ajouter au panier"}
            </button>
          </div>
        </div>
      )}

      {/* MP-PAUL-FIX-16: offline-fallback inline note. Non-blocking
          slim band beneath the customer chip; tells the cashier why
          the debt modal didn't appear and what to do, instead of
          silent failure. */}
      {showOfflineDebtNote && (
        <div role="status" style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 1099, maxWidth: 460, width: "calc(100% - 24px)",
          background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)",
          borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "#fbbf24",
          fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
        }}>
          <span>⚠</span>
          <span>{lang === "en"
            ? `Debt detail unavailable offline. ${customer?.name || "Customer"} owes ${fmt(Number(customer?.total_debt) || 0)} — reconnect to load invoices.`
            : `Détail dette indisponible hors-ligne. ${customer?.name || "Client"} doit ${fmt(Number(customer?.total_debt) || 0)} — reconnectez pour charger les factures.`}</span>
        </div>
      )}

      {showCamera && (
        <CameraScanner lang={lang} onScan={(code) => { setShowCamera(false); scanBarcode(code); }} onClose={() => setShowCamera(false)} />
      )}

      {/* MP-CASH-SHIFTS-UI: outer column so the shift indicator sits
          on top without breaking the left/right panel layout.
          MP-MOBILE-UI-PHASE-1-5: on mobile, swap the full-width banner
          for a compact chip that opens a bottom sheet — saves ~30px
          vertical space cashiers need to see the cart. Desktop keeps
          the inline indicator. */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)" }}>
        <div style={{ padding: mobile ? "8px 14px 0 14px" : "10px 14px 0 14px" }}>
          {mobile ? <MobileShiftChip /> : <ActiveShiftIndicator />}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: mobile ? "column" : "row" }}>

        {/* ██ LEFT PANEL ████████████████████████████████████████
            MP-MOBILE-UI: the cart strip (position:fixed, 56px tall)
            sits ~60px above the viewport bottom, covering the
            bottom 56px of this scroll area. Without extra bottom
            padding, the search dropdown / last product rows render
            UNDER the strip — most visibly on the APK because
            Capacitor's Keyboard:'native' resize mode shrinks the
            viewport when the search input is focused, putting the
            dropdown right where the strip lives. Add 72px of
            paddingBottom only when the strip is actually showing
            (cart non-empty OR holds present). */}
        <div style={{ flex: 1, padding: mobile ? 12 : 20, paddingBottom: mobile && (cart.length > 0 || activeHolds.length > 0) ? 84 : (mobile ? 12 : 20), overflowY: "auto", borderRight: mobile ? "none" : "1px solid var(--border)" }}>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.3px" }}>{lang === "en" ? "New Sale" : "Nouvelle vente"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {cart.length > 0 ? `${cart.length} item${cart.length > 1 ? "s" : ""} in cart` : lang === "en" ? "Search or scan to add items" : "Cherchez ou scannez"}
              </div>
            </div>
            {selectedLocation && (
              <div style={{ fontSize: 11, background: "rgba(251,197,3,0.12)", color: "var(--brand-light)", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>
                📍 {selectedLocation.name}
              </div>
            )}
          </div>

          {/* MP-PROPLUS-CASHIER-LOCATION: pinned cashier → locked display, no picker. */}
          {forcedLocation ? (
            <div className="input" aria-disabled="true"
              style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "not-allowed", opacity: 0.95 }}
              title={lang === "en" ? "Assigned by the owner — locked" : "Assigné par le propriétaire — verrouillé"}>
              🔒 📍 {forcedLocation.name}
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                {lang === "en" ? "(assigned location)" : "(emplacement assigné)"}
              </span>
            </div>
          ) : (
            <>
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
            </>
          )}

          {/* ── CUSTOMER SEARCH ── */}
          <div style={{ marginBottom: 14, position: "relative" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 5 }}>
              👤 {lang === "en" ? "Customer (optional)" : "Client (optionnel)"}
            </label>
            {customer ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(251,197,3,0.1)", border: "1px solid var(--brand)", borderRadius: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand)", color: "#152B52", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
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
                      <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>🧾 Owes {fmt(customer.total_debt)}</div>
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
                <div style={{ position: "relative" }}>
                  <input ref={custRef} className="input"
                    placeholder={lang === "en" ? "Type name or phone..." : "Nom ou téléphone..."}
                    value={custSearch}
                    onChange={e => { setCustSearch(e.target.value); setShowCustDrop(true); }}
                    onFocus={() => setShowCustDrop(true)}
                    onBlur={() => setTimeout(() => setShowCustDrop(false), 200)}
                    style={{ paddingRight: 34 }} />
                  <ClearButton value={custSearch} onClear={() => setCustSearch("")} inputRef={custRef} right={10}
                    title={lang === "en" ? "Clear" : "Effacer"} />
                </div>
                {showCustDrop && filteredCustomers.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", overflowY: "auto", maxHeight: "min(60vh, 420px)", marginTop: 4, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}>
                    {filteredCustomers.map(c => (
                      <div key={c.id} onMouseDown={() => { setCustomer(c); setCustSearch(""); setShowCustDrop(false); }}
                        style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(251,197,3,0.2)", color: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                          {c.phone && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.phone}</div>}
                        </div>
                        {c.total_debt > 0 && (
                          <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, background: "rgba(239,68,68,0.1)", padding: "2px 8px", borderRadius: 10 }}>
                            {fmt(c.total_debt)}
                          </div>
                        )}
                      </div>
                    ))}
                    {customerMatchOverflow > 0 && (
                      <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-muted)", textAlign: "center", background: "rgba(255,255,255,0.03)" }}>
                        {lang === "en"
                          ? `+${customerMatchOverflow} more — type more of the name to narrow`
                          : `+${customerMatchOverflow} autres — précisez le nom pour affiner`}
                      </div>
                    )}
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

          {/* ── SCANNER + RESULTS WRAP ───────────────────────────
              MP-MOBILE-UI: when the mobile cart strip is visible (cart
              non-empty OR holds present), the floating strip + the soft
              keyboard squeeze the visible area such that inline search
              results render UNDER the strip — only on APK because
              Capacitor's Keyboard:'native' resize mode shrinks the
              WebView viewport on input focus while the strip stays
              anchored to the new bottom. Reversing the scanner ↔
              results visual order on mobile-with-strip pushes results
              ABOVE the input, keeping them in already-visible space no
              matter how aggressively the keyboard reflows things.
              Desktop and empty-cart mobile keep the original order. */}
          {/* MP-MOBILE-UI-PHASE-2C: column-reverse experiment removed.
              The original intent was to keep the scanner/search above
              the on-screen keyboard when a cart was active; in practice
              the Vaul mobile cart sheet (z:1701) already pins the cart
              to the top of the visible area, and reversing the column
              pushed the search input + results dropdown BELOW the
              sheet's peek bar — Peter's "search dead after debt-line
              auto-added" repro on the APK. Always column = search input
              stays where the cashier expects it. */}
          <div style={{ display: "flex", flexDirection: "column" }}>
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
              <div style={{ background: scanning ? "rgba(16,185,129,0.1)" : "rgba(251,197,3,0.08)", border: `1.5px solid ${scanning ? "#10b981" : "var(--brand)"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 8, textAlign: "center", transition: "all 0.3s" }}>
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
                style={{ width: "100%", padding: "16px", marginBottom: 8, background: "rgba(251,197,3,0.1)", border: "2px dashed var(--brand)", borderRadius: 12, color: "var(--brand-light)", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(251,197,3,0.2)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(251,197,3,0.1)"}>
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
                  value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38, paddingRight: 34 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 14, pointerEvents: "none" }}>🔍</span>
                <ClearButton value={search} onClear={() => setSearch("")} inputRef={searchRef} right={10}
                  title={lang === "en" ? "Clear" : "Effacer"} />
              </div>
            )}

            {scanMode === "camera" && (
              <div style={{ position: "relative", marginTop: 6 }}>
                <input ref={searchRef} className="input"
                  placeholder={lang === "en" ? "Or type to search..." : "Ou tapez pour chercher..."}
                  value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38, paddingRight: 34, fontSize: 12 }} />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 13, pointerEvents: "none" }}>✏️</span>
                <ClearButton value={search} onClear={() => setSearch("")} inputRef={searchRef} right={10}
                  title={lang === "en" ? "Clear" : "Effacer"} />
              </div>
            )}
          </div>

          {filteredProducts.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              {filteredProducts.map((p, i) => {
                // MP-MOBILE-UI-PHASE-2A: stock color tiers — green > 10,
                // amber 1-10, red 0. Falls back to muted when the
                // product has no stock row for this location (the
                // validate-for-pos path keeps a real number even for
                // online-cart prefilled products).
                const stockQ = p.stock?.quantity;
                // MP-MULTIPART: kit parents show COMPUTED complete-sets availability,
                // not their own (absent) stock row.
                const isKit = p.is_multipart || Object.prototype.hasOwnProperty.call(parentAvail, p.id);
                const kitAvail = isKit ? (Number(parentAvail[p.id]) || 0) : null;
                const stockColor =
                  stockQ === undefined || stockQ === null ? "var(--text-muted)" :
                  stockQ === 0  ? "#f87171" :
                  stockQ <= 10  ? "#fbbf24" :
                                  "#34d399";
                const isFlashing = justAddedId === p.id;
                const rowHeight = mobile ? 72 : 56;
                return (
                  <motion.div key={p.id}
                    onClick={() => {
                      tapHaptic("light");
                      addToCart(p, 1, true); // keep the results list open for fast multi-add
                      setJustAddedId(p.id);
                      setTimeout(() => setJustAddedId(curr => curr === p.id ? null : curr), 280);
                    }}
                    animate={{ backgroundColor: isFlashing ? "rgba(251,197,3,0.22)" : "rgba(0,0,0,0)" }}
                    transition={{ duration: 0.22 }}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: mobile ? "12px 14px" : "11px 14px", minHeight: rowHeight, cursor: "pointer", borderBottom: i < filteredProducts.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ flex: 1, paddingRight: 12, minWidth: 0 }}>
                      <div style={{ fontSize: mobile ? 14 : 13, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8, alignItems: "center" }}>
                        {p.barcode && <span style={{ fontFamily: "monospace" }}>{p.barcode}</span>}
                        {isKit ? (
                          <MultipartAvailability productId={p.id} available={kitAvail} locationId={selectedLocation?.id} lang={lang} />
                        ) : stockQ !== undefined && stockQ !== null && (
                          <span style={{ color: stockColor, fontWeight: 600 }}>
                            ● {stockQ} {unitLabel(p.unit)} {lang === "en" ? "in stock" : "en stock"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: mobile ? 6 : 2 }}>
                      <div style={{ fontWeight: 700, color: "var(--brand-light)", fontSize: mobile ? 15 : 14 }}>
                        {fmt(priceForTier(p, tierForCustomer(customer)))}
                        {tierForCustomer(customer) === "wholesale" && p.wholesale_price > 0 && (
                          <span style={{ fontSize: 9, background: "#fbbf24", color: "#000", borderRadius: 4, padding: "1px 4px", marginLeft: 4, fontWeight: 700 }}>GROS</span>
                        )}
                        {tierForCustomer(customer) === "vip" && p.min_price > 0 && (
                          <span style={{ fontSize: 9, background: "#a78bfa", color: "#000", borderRadius: 4, padding: "1px 4px", marginLeft: 4, fontWeight: 700 }}>VIP</span>
                        )}
                      </div>
                      {mobile ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#152B52", background: "var(--brand)", padding: "3px 10px", borderRadius: 12 }}>
                          + {lang === "en" ? "Add" : "Ajouter"}
                        </span>
                      ) : (
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>/{unitLabel(p.unit)}</div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          </div>{/* /SCANNER + RESULTS WRAP */}

          {search.length > 0 && filteredProducts.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "en" ? `No products matching "${search}"` : `Aucun produit pour "${search}"`}
            </div>
          )}
        </div>

        {/* ██ RIGHT PANEL — Cart (DESKTOP ONLY) ████████████████████████
            MP-MOBILE-UI-PHASE-2A: on mobile, this inline pane is
            skipped — the same cartPaneInner JSX is rendered inside
            <MobileCartSheet> at the bottom of the JSX tree so the
            cashier gets a proper bottom-sheet UX instead of a half-
            height squished pane. */}
        {!mobile && (
          <div style={{ width: 340, display: "flex", flexDirection: "column", background: "var(--bg-surface)", maxHeight: "100%" }}>
            {cartPaneInner}
          </div>
        )}
      </div>
      </div>{/* /MP-CASH-SHIFTS-UI outer column */}

      {/* MP-MOBILE-UI-PHASE-2A: mobile cart bottom sheet. Hosts the
          SAME cartPaneInner JSX as the desktop right-pane above, so
          every cart feature (debt rows, online-cart prefill, hold/
          resume, payment form, Confirm/PayButton) works identically
          in both viewports. The persistent strip inside MobileCartSheet
          shows the totals; tap to expand. */}
      {mobile && (
        <MobileCartSheet
          open={sheetOpen}
          onOpenChange={(o) => { setSheetOpen(o); if (o) setSearch(""); /* Fix 3: tapping the yellow cart bar closes the results list */ }}
          itemCount={cart.length}
          heldCount={activeHolds.length}
          total={total}
          formatTotal={fmt}
          lang={lang}
        >
          {cartPaneInner}
        </MobileCartSheet>
      )}
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

      {/* ── MP-CREDIT-LIMIT-MODAL: structured rendering of the
          backend's CREDIT_LIMIT_EXCEEDED 400. Mirrors blockModal's
          shape so the UX feels consistent with the other hard-block
          modals (z:3000, full-width row of numbers, single CTA). */}
      {creditLimitModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 14, width: "100%", maxWidth: 460, padding: 22 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🚫</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
              {lang === "en" ? "Credit limit reached" : "Limite de crédit atteinte"}
            </div>
            {creditLimitModal.customer_name && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
                {creditLimitModal.customer_name}
              </div>
            )}
            {/* Three-row breakdown. New balance highlighted red so the
                eye lands on it first — that's the number that tripped
                the gate. */}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Limit" : "Limite"}</span>
                <span style={{ fontWeight: 700 }}>{fmt(creditLimitModal.credit_limit)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderTop: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Current debt" : "Dette actuelle"}</span>
                <span style={{ fontWeight: 700 }}>{fmt(creditLimitModal.current_debt)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderTop: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "New balance" : "Nouveau solde"}</span>
                <span style={{ fontWeight: 700, color: "#f87171" }}>{fmt(creditLimitModal.new_balance)}</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
              {lang === "en"
                ? "Collect a partial payment first, or raise the limit from Customers."
                : "Collectez un paiement partiel d'abord, ou augmentez la limite dans Clients."}
            </div>
            <button onClick={() => setCreditLimitModal(null)} className="btn btn-primary btn-block" style={{ fontWeight: 700 }}>
              OK
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
          {/* MP-OVERSELL-MODAL-SCROLL-FIX (build 19): bounded flex column so a
              long finished-items list can never push the confirm button below
              the viewport on short phones (Samsung). The header (title +
              context + BOTH actions) is pinned (flexShrink:0, never scrolls);
              the items list is the only scrolling region (flex:1, overflow-y).
              Layout-only — overselling behaviour is unchanged. */}
          <div style={{ background: "var(--bg-card)", border: "1px solid rgba(245,158,11,0.45)", borderRadius: 14, width: "100%", maxWidth: 460, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Pinned header — always visible at any screen height */}
            <div style={{ flexShrink: 0, padding: "20px 22px 14px", borderBottom: "1px solid rgba(245,158,11,0.25)" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>
                {lang === "en" ? "Insufficient stock" : "Stock insuffisant"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
                {lang === "en"
                  ? "You can still sell — stock will go negative and the sale is flagged for restock follow-up."
                  : "Vous pouvez vendre — le stock passera en négatif et la vente sera signalée pour réapprovisionnement."}
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
            {/* Scrollable finished/out-of-stock list — scrolls WITHIN the modal */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 22px 18px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {(oversellModal.items || []).map((it, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <strong>{it.name}</strong> — {lang === "en"
                    ? `${it.available} available, selling ${it.selling}`
                    : `${it.available} dispo, vente de ${it.selling}`}
                </div>
              ))}
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
                      {nItems} {lang === "en" ? (nItems === 1 ? "item" : "items") : "article(s)"} · {fmt(h.estimated_total)}
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
  const fmt = useCurrency();
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
        <div class="row est"><span>${HT.est}</span><span>${(Number(hold.estimated_total) || 0).toLocaleString()} ${fmt.symbol}</span></div>
        <div class="line"></div>
        ${codes.qr ? `<div class="center"><img src="${codes.qr}" style="width:110px;height:110px;image-rendering:pixelated"/></div>` : ""}
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
          {codes.qr && (
            <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 10, textAlign: "center", background: "#fff", borderRadius: 8, padding: "10px 0" }}>
              <div><img src={codes.qr} alt="qr" style={{ width: 110, height: 110 }} /></div>
              <div style={{ fontSize: 11, color: "#000", fontFamily: "monospace", fontWeight: 700 }}>{hold.hold_ref}</div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)", textAlign: "center", fontWeight: 600 }}>{HT.notReceipt}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={printTicket}
            style={{ width: "100%", padding: "12px", background: "var(--brand)", border: "none", color: "#152B52", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
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
