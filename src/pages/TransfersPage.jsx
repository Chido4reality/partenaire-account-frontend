import BarcodeInput from "../components/common/BarcodeInput";
import HelpButton from "../components/common/HelpButton";
import ClearButton from "../components/common/ClearButton";
import ProductSearchBox from "../components/common/ProductSearchBox";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore, useAuthStore } from "../store";
import DateRangeFilter, { inRange, wideRange } from "../components/common/DateRangeFilter";
import api, { formatDate } from "../utils/api";
import { useMyPermissions } from "../utils/useMyPermissions";
import { useReceiveSummary } from "../utils/useReceiveSummary"; // F-C: the override rate
import RestrictedAction from "../components/common/RestrictedAction";
import { useSearchParams } from "react-router-dom";
import TransferDetailModal from "../components/TransferDetailModal"; // MP-STAFF-ACTIVITY-LEDGER Phase 3

export default function TransfersPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [mode, setMode]             = useState("list"); // list | new
  const [step, setStep]             = useState(1);      // 1=locations, 2=scan items, 3=confirm
  const [fromLoc, setFromLoc]       = useState("");
  const [toLoc, setToLoc]           = useState("");
  const [notes, setNotes]           = useState("");
  const [scannedItems, setScannedItems] = useState([]);
  const [searchQty, setSearchQty]   = useState(1);      // quick-entry qty for the name search
  const [scanInput, setScanInput]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editingId, setEditingId]   = useState(null);  // (B) null = creating; id = editing a pending transfer

  // MP-STAFF-ACTIVITY-LEDGER Phase 3: open a transfer's detail from a tapped row OR a
  // ?tr=<id> deep-link (search box routes here). Kept in sync with the URL param.
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailTransferId, setDetailTransferId] = useState(searchParams.get("tr") || null);
  useEffect(() => { const tr = searchParams.get("tr"); if (tr) setDetailTransferId(tr); }, [searchParams]);
  const closeTransferDetail = () => {
    setDetailTransferId(null);
    if (searchParams.get("tr")) { searchParams.delete("tr"); setSearchParams(searchParams, { replace: true }); }
  };

  // (A) tick-list multi-select picker state
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSel, setPickerSel]       = useState({}); // { [product_id]: qty }
  const [flagRecount, setFlagRecount]   = useState(false); // MP-STOCK-CHECK
  const { data: planData } = useOfflineCachedQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const canStockCheck = ["pro", "pro_plus"].includes(planData?.data?.effective_plan || "");
  // MP-TRANSFER-WAYBILL: A4 delivery note, Pro/Pro Plus, available once dispatched.
  const canWaybill = ["pro", "pro_plus"].includes(planData?.data?.effective_plan || "");
  const [waybillBusy, setWaybillBusy] = useState(null);
  const handleWaybill = async (tr) => {
    setWaybillBusy(tr.id);
    try {
      const org = settingsData?.data || {};
      const fromName = locations.find(l => l.id === tr.from_location)?.name || (lang === "en" ? "External" : "Externe");
      const toName   = locations.find(l => l.id === tr.to_location)?.name || (lang === "en" ? "External" : "Externe");
      const { openWaybill } = await import("../utils/waybill"); // code-split: loads jsPDF only now
      await openWaybill({ org, lang, transfer: tr, fromName, toName });
    } catch (e) {
      toast.error(e?.message || (lang === "en" ? "Could not generate waybill" : "Impossible de générer le bon"));
    } finally { setWaybillBusy(null); }
  };

  // MP-TRANSFER-RECEIVE-CONFIRM (Phase 1) — who am I + is the two-sided flow on?
  const user = useAuthStore(s => s.user);
  const myId = user?.id;
  const isOwner = user?.role === "owner"; // owner is ALWAYS exempt from cannot_confirm_own_dispatch
  const { data: settingsData } = useOfflineCachedQuery({
    queryKey: ["org-settings"], queryFn: () => api.get("/settings").then(r => r.data), staleTime: 60000,
  });
  // ON  → sender Dispatches (pending→in_transit), a receiver Confirms at the
  //       destination (in_transit→completed). OFF → today's instant "Mark done".
  const confirmFlow = !!settingsData?.data?.transfer_receipt_confirmation_enabled;
  // Part 3: when a second person is NOT required, the dispatcher may self-confirm.
  const requireSecond = settingsData?.data?.transfer_require_second_person !== false;
  const [adjustFor, setAdjustFor] = useState(null); // the incoming transfer being COUNTED (F-C)
  const [reveal, setReveal] = useState(null);       // F-C: { comparison, variance_lines } — shown AFTER the count
  const { data: incomingData } = useOfflineCachedQuery({
    queryKey: ["transfers-incoming"],
    queryFn: () => api.get("/transfers/incoming").then(r => r.data),
    enabled: confirmFlow, refetchInterval: 30000,
  });
  const incoming = incomingData?.data || [];

  // MP-TRANSFER-GOVERNANCE: the current user's own grant (for the cancel-button gate).
  // MP-MY-PERMISSIONS-ONE-SHAPE: via the shared hook — this used to read `?.data?.x` off
  // a cache entry POSPage writes UNWRAPPED under the same key, so the grant read as false
  // whenever POS had fetched last. See useMyPermissions.js.
  const { perms: myPerms } = useMyPermissions({
    enabled: user?.role === "manager", // owner is unconditionally allowed; others never
  });

  const scanRef   = useRef(null);

  // USB/keyboard barcode buffer
  const barcodeBuffer = useRef("");
  const barcodeTimer  = useRef(null);

  useEffect(() => {
    if (mode !== "new" || step !== 2) return;
    const handleKey = async (e) => {
      if (document.activeElement === scanRef.current) return;
      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        if (code.length >= 4) await lookupBarcode(code);
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
  }, [mode, step]);

  const lookupBarcode = async (code) => {
    try {
      const res = await api.get(`/products/barcode/${code}?location_id=${fromLoc}`);
      const product = res.data.data;
      addItem(product);
      toast.success(product.name);
      setScanInput("");
      // (B) rapid quick-entry: keep the scan field focused for the next scan.
      scanRef.current?.focus();
    } catch {
      toast.error(lang === "en" ? "Barcode not found: " + code : "Code-barres introuvable: " + code);
      scanRef.current?.focus();
    }
  };

  // Available stock at the SOURCE location for a product (null = unknown/external).
  const availOf = (product) => (product?.stock?.quantity ?? null);

  // Add a product to the transfer list. MERGES on duplicate (increments qty) and
  // CLAMPS each line to the available stock at source (when known).
  const addItem = (product, qty = 1) => {
    setScannedItems(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) {
        const u = [...prev];
        const max = (u[idx].stock != null) ? u[idx].stock : Infinity;
        u[idx] = { ...u[idx], quantity: Math.min(u[idx].quantity + qty, max) };
        return u;
      }
      const stock = availOf(product);
      const initQty = (stock != null) ? Math.min(qty, stock) : qty;
      return [...prev, { product_id: product.id, name: product.name, unit: product.unit, barcode: product.barcode, quantity: Math.max(1, initQty), stock }];
    });
  };

  // CLAMP to [1, available]; allow a transient empty value while typing (the
  // input's onBlur normalises "" -> 1). NEVER removes a line — the × button does.
  const updateQty = (idx, val) => {
    setScannedItems(p => p.map((it, i) => {
      if (i !== idx) return it;
      if (val === "" || val == null) return { ...it, quantity: "" };
      const max = (it.stock != null) ? it.stock : Infinity;
      return { ...it, quantity: Math.max(1, Math.min(Number(val) || 1, max)) };
    }));
  };
  // The ONLY way to remove a line (the explicit × button).
  const removeItem = (idx) => setScannedItems(p => p.filter((_, i) => i !== idx));

  // A1: fetch a deep window (500) so the date filter can find PAST transfers, not
  // just the last page. Client-side date filtering is applied below (rows carry created_at).
  const { data: transferData, isLoading } = useOfflineCachedQuery({
    queryKey: ["transfers", statusFilter],
    queryFn: () => api.get(`/transfers?${statusFilter ? "status=" + statusFilter : ""}&limit=500`).then(r => r.data),
    refetchInterval: 30000
  });
  const [range, setRange] = useState(wideRange()); // A1 date filter (≈1yr default → nothing hidden)

  const { data: locData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  // (A) all SOURCE-location products (same /products data source, filtered to
  // from_location). Only those with stock > 0 are tick-list candidates. Skipped
  // when the source is external (no fromLoc).
  const { data: sourceProdData, isFetching: sourceLoading } = useOfflineCachedQuery({
    queryKey: ["transfer-source-products", fromLoc],
    queryFn: () => fromLoc
      ? api.get(`/products?location_id=${fromLoc}`).then(r => r.data)
      : { data: [] },
    enabled: !!fromLoc
  });
  const sourceProducts = (sourceProdData?.data || []).filter(p => (p.stock?.quantity || 0) > 0);
  const pickerFiltered = sourceProducts.filter(p => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    return (p.name || "").toLowerCase().includes(q)
      || (p.name_en || "").toLowerCase().includes(q)
      || (p.barcode || "").toLowerCase().includes(q);
  });
  const pickedCount = Object.keys(pickerSel).length;

  const togglePick = (p) => setPickerSel(prev => {
    const u = { ...prev };
    if (u[p.id] != null) delete u[p.id];
    else u[p.id] = 1;
    return u;
  });
  const setPickQty = (p, qty) => setPickerSel(prev => {
    const max = p.stock?.quantity ?? Infinity;
    return { ...prev, [p.id]: Math.max(1, Math.min(qty || 1, max)) };
  });
  const addPicked = () => {
    const ids = Object.keys(pickerSel);
    ids.forEach(id => {
      const p = sourceProducts.find(x => x.id === id);
      if (p) addItem(p, pickerSel[id]);
    });
    if (ids.length) toast.success((lang === "en" ? "Added " : "Ajouté ") + ids.length + (lang === "en" ? " item(s)" : " article(s)"));
    setPickerSel({}); setPickerSearch(""); setPickerOpen(false);
  };

  const createMutation = useMutation({
    mutationFn: () => api.post("/transfers", {
      from_location: fromLoc || null,
      to_location: toLoc || null,
      notes: notes || null,
      flag_recount: !!flagRecount, // MP-STOCK-CHECK: boss re-count flag (destination)
      items: scannedItems.map(i => ({ product_id: i.product_id, quantity: Math.max(1, Number(i.quantity) || 1) }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer created!" : "Transfert cree!");
      setMode("list"); setStep(1); setFromLoc(""); setToLoc(""); setNotes(""); setScannedItems([]); setFlagRecount(false);
      setPickerSel({}); setPickerSearch(""); setPickerOpen(false);
      qc.invalidateQueries(["transfers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const completeMutation = useMutation({
    mutationFn: (id) => api.patch(`/transfers/${id}/complete`),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer completed!" : "Transfert termine!");
      qc.invalidateQueries(["transfers"]);
      qc.invalidateQueries(["stock"]);
    },
    // MP-TRANSFER-APPROVAL-IN-TRANSIT: surface use_dispatch_confirm (flag-ON orgs) bilingually.
    onError: (err) => {
      const d = err.response?.data || {};
      toast.error((lang === "en" ? (d.message_en || d.message) : (d.message_fr || d.message)) || "Error");
    }
  });

  // MP-TRANSFER-RECEIVE-CONFIRM (Phase 1) — sender ships: pending→in_transit
  // (trigger deducts SOURCE now; the transfer is then locked from edits).
  const dispatchMutation = useMutation({
    mutationFn: (id) => api.post(`/transfers/${id}/dispatch`, {}),
    onSuccess: () => {
      toast.success(lang === "en" ? "Dispatched — awaiting confirmation" : "Envoyé — en attente de confirmation");
      qc.invalidateQueries(["transfers"]); qc.invalidateQueries(["transfers-incoming"]); qc.invalidateQueries(["stock"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });
  // Receiver confirms (one-tap, all correct): in_transit→completed (trigger credits DEST).
  // ONE-TAP (no lines) → dest gets sent qty. ADJUST ({lines:[{item_id,received_quantity}]})
  // → dest gets received; any received≠sent becomes a Stock Check variance for the owner.
  const confirmMutation = useMutation({
    mutationFn: ({ id, lines, override, override_reason }) =>
      api.post(`/transfers/${id}/confirm-receipt`,
        override ? { override: true, override_reason } : { lines }),
    onSuccess: (res) => {
      const v = res?.data?.variance_lines || 0;
      // F-C — THE REVEAL. The receiver counted blind; only now do they see what was
      // sent. Deliberately a STATE, not a toast: a toast is not a state, and the
      // whole point of counting is the comparison it produces. Five separate causes
      // hid inside toasts on this codebase in one week.
      const cmp = Array.isArray(res?.data?.comparison) ? res.data.comparison : [];
      if (cmp.length) setReveal({ comparison: cmp, variance_lines: v });
      else toast.success(res?.data?.received_without_count
        ? (lang === "en" ? "Received without counting — logged" : "Réceptionné sans comptage — enregistré")
        : (lang === "en" ? "Receipt confirmed — stock added" : "Réception confirmée — stock ajouté"));
      setAdjustFor(null);
      qc.invalidateQueries(["transfers"]); qc.invalidateQueries(["transfers-incoming"]); qc.invalidateQueries(["stock"]); qc.invalidateQueries(["stock-check-summary"]); qc.invalidateQueries(["transfer-receive-summary"]);
    },
    // MP-TRANSFER-APPROVAL-IN-TRANSIT: surface the server's bilingual reason clearly
    // (e.g. cannot_confirm_own_dispatch / not_your_destination) — never a raw 4xx.
    onError: (err) => {
      const d = err.response?.data || {};
      toast.error((lang === "en" ? (d.message_en || d.message) : (d.message_fr || d.message)) || "Error");
    }
  });

  // (B) EDIT a PENDING transfer: reopen the editor preloaded with its from/to +
  // items. from/to are read-only here (to change them, cancel + start fresh).
  const startEdit = async (tr) => {
    try {
      const t = (await api.get(`/transfers/${tr.id}`)).data.data;
      if (t.status !== "pending") { toast.error(lang === "en" ? "Only pending transfers can be edited" : "Seuls les transferts en attente sont modifiables"); return; }
      setEditingId(t.id);
      setFromLoc(t.from_location || "");
      setToLoc(t.to_location || "");
      setNotes(t.notes || "");
      setScannedItems((t.pa_transfer_items || []).map(it => ({
        product_id: it.product_id, name: it.pa_products?.name || "—", unit: it.pa_products?.unit || "",
        barcode: it.pa_products?.barcode || null, quantity: it.quantity, stock: null,
      })));
      setPickerSel({}); setPickerSearch(""); setPickerOpen(false); setSearchQty(1);
      setMode("new"); setStep(2);
    } catch (err) { toast.error(err.response?.data?.message || "Error"); }
  };

  // (B) SAVE edits to a pending transfer — replaces its items (status stays pending).
  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/transfers/${editingId}/items`, {
      notes: notes || null,
      items: scannedItems.map(i => ({ product_id: i.product_id, quantity: Math.max(1, Number(i.quantity) || 1) }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer updated!" : "Transfert mis à jour!");
      resetNew();
      qc.invalidateQueries(["transfers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // (B) CANCEL/REVERSE a pending or fully-un-received in-transit transfer. MP-TRANSFER-
  // GOVERNANCE: the server reverses the source leg (in-transit), logs who/when/why, and
  // enforces the permission + owner-lock. Blocked once any qty is received (already_received).
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }) => api.patch(`/transfers/${id}/cancel`, { reason }),
    onSuccess: (res) => {
      toast.success(res?.data?.reversed_source
        ? (lang === "en" ? "Transfer cancelled — stock returned to source" : "Transfert annulé — stock rendu à la source")
        : (lang === "en" ? "Transfer cancelled" : "Transfert annulé"));
      qc.invalidateQueries(["transfers"]);
      qc.invalidateQueries({ queryKey: ["transfers-incoming"] });
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });
  // MP-TRANSFER-GOVERNANCE: who may cancel — the OWNER, or a MANAGER the boss granted
  // can_cancel_transfers. (The server is authoritative; this only decides button visibility.)
  const canCancelTransfers = isOwner || (user?.role === "manager" && !!myPerms?.can_cancel_transfers);
  // F-C: may this person confirm a receipt WITHOUT counting it? Owner always; anyone
  // else only with the explicit grant. Not manager-only — the stuck-goods case is a
  // warehouse hand or a shop cashier receiving while the owner travels.
  //
  // 🔴 THIS DOUBLES AS THE DEPLOY INTERLOCK, and that is deliberate. An OLD backend's
  // /my-permissions has a NAMED select that does not contain receive_without_count, so
  // it comes back undefined, `=== true` is false, and the override button never draws.
  // The hatch therefore cannot exist before the backend that records it — otherwise,
  // in the FE-ahead-of-BE window, an override would be silently completed with nothing
  // logged. Proven by running this build against the old backend, not reasoned.
  const canReceiveWithoutCount = isOwner || myPerms?.receive_without_count === true;
  // F-C: the override rate, shared hook so this and the Accountant Log cannot drift.
  const { data: recvSummaryResp } = useReceiveSummary({ onError: () => {} });
  const recvSummary = recvSummaryResp?.data || { overrides: 0, receipts: 0, pct: 0, amber: false };
  // Part 4 — the per-org owner-cancel lock, mirrored in the UI. When it's ON, a granted
  // manager may still cancel STAFF transfers but not the OWNER's; the row carries
  // `owner_actor` (dispatcher once in-transit, else creator — computed server-side by the
  // same rule the cancel route enforces). Owner is never locked out of anything.
  const ownerCancelLock = !!settingsData?.data?.transfer_owner_cancel_lock;
  const canCancelThis = (tr) =>
    canCancelTransfers && (isOwner || !ownerCancelLock || !tr.owner_actor);
  const promptCancel = (tr) => {
    const reason = window.prompt(lang === "en"
      ? "Cancel this transfer? Enter a reason (logged):"
      : "Annuler ce transfert ? Saisissez une raison (enregistrée) :", "");
    if (reason === null) return;                 // user dismissed
    cancelMutation.mutate({ id: tr.id, reason: (reason || "").trim() });
  };

  // A1: client-side date filter across ALL tabs (rows carry created_at).
  const transfers = (transferData?.data || []).filter(tr => inRange(tr.created_at, range.from, range.to));
  const locations = locData?.data || [];

  const statusColor = (s) => {
    if (s === "completed") return { bg: "rgba(16,185,129,0.15)", color: "#34d399" };
    if (s === "in_transit") return { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" };
    if (s === "cancelled") return { bg: "rgba(239,68,68,0.15)", color: "#f87171" };
    return { bg: "rgba(251,197,3,0.15)", color: "var(--brand-light)" };
  };
  // MP-TRANSFER-APPROVAL-IN-TRANSIT: human, bilingual status — never the raw enum.
  // "In transit" / "En transit" must read distinct from "Completed" / "Terminé".
  const statusLabel = (s) => {
    if (s === "completed")  return lang === "en" ? "Completed"  : "Terminé";
    if (s === "in_transit") return lang === "en" ? "In transit" : "En transit";
    if (s === "cancelled")  return lang === "en" ? "Cancelled"  : "Annulé";
    if (s === "pending")    return lang === "en" ? "Pending"    : "En attente";
    return s;
  };

  const resetNew = () => {
    setMode("list"); setStep(1); setFromLoc(""); setToLoc(""); setNotes(""); setScannedItems([]);
    setPickerSel({}); setPickerSearch(""); setPickerOpen(false); setSearchQty(1); setEditingId(null);
  };

  // MP-TRANSFER-BACK-PRESERVE: a back press must step back ONE level, never
  // nuke an in-progress transfer. Header ←, the step footer button, and the
  // hardware/browser back button all route through goBack():
  //   step 3 (review) → step 2 (items)   — keep everything entered
  //   step 2 (items)  → step 1 (locations) — items preserved
  //   step 1          → leave the wizard   — only here is the transfer
  //                                          discarded, and only after a
  //                                          confirm when items were added.
  // Editing an existing pending transfer has no step 1 (locations are
  // read-only), so back from step 2 exits the edit (confirm first).
  const confirmDiscard = () =>
    window.confirm(lang === "en" ? "Discard this transfer?" : "Abandonner ce transfert ?");

  const goBack = () => {
    if (step === 3) { setStep(2); return; }
    if (step === 2) {
      if (editingId) {
        if (scannedItems.length > 0 && !confirmDiscard()) return;
        resetNew();
        return;
      }
      setStep(1);
      return;
    }
    // step === 1 — leaving the wizard entirely
    if (scannedItems.length > 0 && !confirmDiscard()) return;
    resetNew();
  };

  // Trap the hardware/browser back button while the wizard is open so it
  // runs goBack() instead of navigating away (which used to drop the whole
  // transfer). Push a sentinel history entry on entry and re-arm on each
  // pop so multi-step back-stepping stays trapped. goBackRef keeps the
  // listener pointed at the latest state without re-binding every render.
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEffect(() => {
    if (mode === "list") return;
    window.history.pushState({ mpTransferWizard: true }, "");
    const onPop = () => {
      window.history.pushState({ mpTransferWizard: true }, "");
      goBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mode]);

  // -- NEW TRANSFER FLOW --------------------------------------
  if (mode === "new") {
    return (
      <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
        {/* Header with steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <button onClick={goBack} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>{"←"}</button>
          <h1 className="page-title">{editingId ? (lang === "en" ? "Edit Transfer" : "Modifier le transfert") : (lang === "en" ? "New Transfer" : "Nouveau transfert")}</h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {[1,2,3].map(s => (
              <div key={s} style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: step >= s ? "var(--brand)" : "var(--bg-elevated)", color: step >= s ? "#152B52" : "var(--text-muted)", border: "1px solid " + (step >= s ? "var(--brand)" : "var(--border)") }}>{s}</div>
            ))}
          </div>
        </div>

        {/* STEP 1: Choose locations */}
        {step === 1 && (
          <div style={{ animation: "fadeUp 0.2s ease both" }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>
              {lang === "en" ? "Where are you moving stock?" : "Ou deplacez-vous le stock?"}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "FROM (source)" : "DE (source)"}</label>
              <select className="input" value={fromLoc} onChange={e => { setFromLoc(e.target.value); setPickerSel({}); setPickerOpen(false); }}
                style={{ fontSize: 15, padding: "12px 14px" }}>
                <option value="">{lang === "en" ? "Select source location" : "Choisir emplacement source"}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
              </select>
            </div>

            <div style={{ textAlign: "center", color: "var(--text-muted)", margin: "8px 0", fontSize: 20 }}>></div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "TO (destination)" : "VERS (destination)"}</label>
              <select className="input" value={toLoc} onChange={e => setToLoc(e.target.value)}
                style={{ fontSize: 15, padding: "12px 14px" }}>
                <option value="">{lang === "en" ? "Select destination" : "Choisir destination"}</option>
                {locations.filter(l => l.id !== fromLoc).map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
              <input className="input" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={lang === "en" ? "Reason for transfer..." : "Raison du transfert..."} />
            </div>

            {/* MP-STOCK-CHECK: boss flags this transfer's destination lines for a re-count. */}
            {canStockCheck && toLoc && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={flagRecount} onChange={e => setFlagRecount(e.target.checked)} />
                <span>🔍 {lang === "en" ? "Flag for re-count at destination (Stock Check)" : "Signaler pour recomptage à destination (Vérification de stock)"}</span>
              </label>
            )}

            {/* MP-TRANSFER-DESTINATION-REQUIRED (2026-07-17, audit fix): the old
                `!fromLoc && !toLoc` check only blocked the wizard when BOTH were
                empty, so fromLoc-set + toLoc-empty sailed through — the exact shape
                of TRF-20260716-0003 (deducted at source, credited nowhere, since the
                DB trigger's dest-credit branch silently no-ops on NULL to_location).
                FROM may legitimately stay empty (external-source receive — nothing
                is deducted, only the destination gets credited, so there's no loss
                symmetry with an empty TO). TO must always be picked. */}
            <button className="btn btn-primary btn-block btn-lg"
              disabled={!toLoc}
              onClick={() => setStep(2)}>
              {lang === "en" ? "Next - Scan items" : "Suivant - Scanner les articles"} >
            </button>
          </div>
        )}

        {/* STEP 2: Scan / search / pick items */}
        {step === 2 && (
          <div style={{ animation: "fadeUp 0.2s ease both" }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
              {lang === "en" ? "Scan or search items" : "Scanner ou chercher les articles"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
              {locations.find(l => l.id === fromLoc)?.name || "External"} > {locations.find(l => l.id === toLoc)?.name || "External"}
            </div>

            {/* Scan input — rapid: each scan adds 1 (merges) + keeps focus */}
            <div style={{ background: "var(--bg-card)", border: "2px dashed var(--brand)", borderRadius: 14, padding: 20, textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                {lang === "en" ? "Point camera at barcode OR type barcode below" : "Pointer la camera sur le code-barres OU taper ci-dessous"}
              </div>
              <BarcodeInput
                inputRef={scanRef}
                lang={lang}
                value={scanInput}
                onChange={setScanInput}
                onScan={(code) => lookupBarcode(code)}
                onKeyDown={e => { if (e.key === "Enter" && scanInput.trim()) lookupBarcode(scanInput.trim()); }}
                placeholder={lang === "en" ? "Type or scan barcode — press Enter" : "Taper ou scanner — appuyer Entrée"}
                style={{ marginBottom: 4 }}
                autoFocus
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                {lang === "en" ? "Scan, Enter, scan, Enter — adds each instantly" : "Scanner, Entrée, scanner, Entrée — ajout instantané"}
              </div>
            </div>

            {/* Quick-entry by name: qty + the SHARED fuzzy/scrollable search.
                Enter (or a clicked result) adds the top match with this qty. */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="number" min="1" value={searchQty}
                onChange={e => setSearchQty(Math.max(1, +e.target.value || 1))}
                title={lang === "en" ? "Quantity to add" : "Quantité à ajouter"}
                style={{ width: 64, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-primary)", padding: "10px", fontSize: 14 }} />
              <div style={{ flex: 1 }}>
                <ProductSearchBox
                  onSelect={p => { addItem(p, searchQty || 1); setSearchQty(1); }}
                  locationId={fromLoc}
                  lang={lang}
                  placeholder={lang === "en" ? "Search by name — Enter to add" : "Chercher par nom — Entrée pour ajouter"}
                  renderMeta={p => p.stock != null
                    ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{lang === "en" ? "Avail:" : "Disp:"} {p.stock?.quantity ?? 0} {p.unit}</span>
                    : (p.barcode ? <span style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "monospace" }}>{p.barcode}</span> : undefined)}
                />
              </div>
            </div>

            {/* (A) Tick-list multi-select — only when a source location is chosen */}
            {fromLoc && (
              <div style={{ marginBottom: 16 }}>
                <button className="btn btn-secondary btn-block"
                  onClick={() => setPickerOpen(o => !o)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  📋 {pickerOpen
                    ? (lang === "en" ? "Hide source stock list" : "Masquer la liste du stock source")
                    : (lang === "en" ? `Browse source stock (${sourceProducts.length})` : `Parcourir le stock source (${sourceProducts.length})`)}
                </button>

                {pickerOpen && (
                  <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)" }}>
                    <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ position: "relative" }}>
                        <input className="input" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                          placeholder={lang === "en" ? "Filter list..." : "Filtrer la liste..."} style={{ paddingRight: 34 }} />
                        <ClearButton value={pickerSearch} onClear={() => setPickerSearch("")} right={10} title={lang === "en" ? "Clear" : "Effacer"} />
                      </div>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: "auto" }}>
                      {sourceLoading && sourceProducts.length === 0 ? (
                        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>
                      ) : pickerFiltered.length === 0 ? (
                        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                          {lang === "en" ? "No products in stock at source" : "Aucun produit en stock à la source"}
                        </div>
                      ) : pickerFiltered.map(p => {
                        const checked = pickerSel[p.id] != null;
                        const avail = p.stock?.quantity ?? 0;
                        return (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: checked ? "rgba(251,197,3,0.06)" : "transparent" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer", minWidth: 0 }}>
                              <input type="checkbox" checked={checked} onChange={() => togglePick(p)}
                                style={{ width: 18, height: 18, accentColor: "var(--brand)", flexShrink: 0 }} />
                              <span style={{ minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Available:" : "Disponible:"} {avail} {p.unit}</span>
                              </span>
                            </label>
                            {checked && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                <button onClick={() => setPickQty(p, (pickerSel[p.id] || 1) - 1)} disabled={(pickerSel[p.id] || 1) <= 1}
                                  style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: (pickerSel[p.id] || 1) <= 1 ? "not-allowed" : "pointer", fontSize: 15, opacity: (pickerSel[p.id] || 1) <= 1 ? 0.4 : 1 }}>−</button>
                                <input type="number" min="1" max={avail} value={pickerSel[p.id]}
                                  onChange={e => setPickQty(p, +e.target.value)}
                                  onFocus={e => e.target.select()}
                                  style={{ width: 46, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px", fontSize: 13 }} />
                                <button onClick={() => setPickQty(p, (pickerSel[p.id] || 1) + 1)} disabled={(pickerSel[p.id] || 1) >= avail} style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: (pickerSel[p.id] || 1) >= avail ? "not-allowed" : "pointer", fontSize: 15, opacity: (pickerSel[p.id] || 1) >= avail ? 0.4 : 1 }}>+</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Sticky add bar */}
                    <div style={{ position: "sticky", bottom: 0, display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      <button className="btn btn-secondary btn-sm" disabled={pickedCount === 0} onClick={() => setPickerSel({})}>
                        {lang === "en" ? "Clear" : "Effacer"}
                      </button>
                      <button className="btn btn-primary" style={{ flex: 1 }} disabled={pickedCount === 0} onClick={addPicked}>
                        {lang === "en" ? `Add (${pickedCount}) item(s)` : `Ajouter (${pickedCount}) article(s)`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Items to transfer */}
            {scannedItems.length > 0 && (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                  {scannedItems.length} {lang === "en" ? "item(s) to transfer" : "article(s) a transferer"}
                </div>
                {scannedItems.map((item, idx) => {
                  const qtyNum = Number(item.quantity) || 1;
                  const atMax = item.stock != null && qtyNum >= item.stock;
                  const atMin = qtyNum <= 1;
                  return (
                    <div key={item.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0, marginRight: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
                        {item.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{item.barcode}</div>}
                        {item.stock != null && <div style={{ fontSize: 11, color: atMax ? "#fbbf24" : "var(--text-muted)" }}>{lang === "en" ? "Available:" : "Disponible:"} {item.stock} {item.unit}{atMax ? (lang === "en" ? " (max)" : " (max)") : ""}</div>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        {/* − clamps at 1 and is disabled there — it NEVER removes the line. */}
                        <button onClick={() => updateQty(idx, qtyNum - 1)} disabled={atMin} title={lang === "en" ? "Less" : "Moins"}
                          style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: atMin ? "not-allowed" : "pointer", fontSize: 16, opacity: atMin ? 0.4 : 1 }}>−</button>
                        {/* Select-all on focus so typing replaces the value; empty → 1 on blur. */}
                        <input type="number" min="1" value={item.quantity}
                          onChange={e => updateQty(idx, e.target.value)}
                          onFocus={e => e.target.select()}
                          onBlur={e => { if (e.target.value === "" || Number(e.target.value) < 1) updateQty(idx, 1); }}
                          style={{ width: 52, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "5px", fontSize: 14 }} />
                        <button onClick={() => updateQty(idx, qtyNum + 1)} disabled={atMax} title={lang === "en" ? "More" : "Plus"}
                          style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: atMax ? "not-allowed" : "pointer", fontSize: 16, opacity: atMax ? 0.4 : 1 }}>+</button>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 24 }}>{item.unit}</span>
                        {/* × removal — visually DISTINCT from − (red bordered box, set apart) so a
                            stray tap on − can't delete the line. */}
                        <button onClick={() => removeItem(idx)} title={lang === "en" ? "Remove item" : "Retirer l'article"}
                          style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.12)", color: "#f87171", cursor: "pointer", fontSize: 14, marginLeft: 10 }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={goBack}>
                {"←"} {editingId ? (lang === "en" ? "Cancel edit" : "Annuler") : (lang === "en" ? "Back" : "Retour")}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={scannedItems.length === 0}
                onClick={() => setStep(3)}>
                {lang === "en" ? "Review & confirm" : "Verifier et confirmer"} >
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Confirm */}
        {step === 3 && (
          <div style={{ animation: "fadeUp 0.2s ease both" }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>
              {lang === "en" ? "Confirm transfer" : "Confirmer le transfert"}
            </div>

            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 14 }}>
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>FROM</div>
                  <div style={{ fontWeight: 600 }}>{locations.find(l => l.id === fromLoc)?.name || "External"}</div>
                </div>
                <div style={{ fontSize: 24, color: "var(--text-muted)" }}>></div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>TO</div>
                  <div style={{ fontWeight: 600 }}>{locations.find(l => l.id === toLoc)?.name || "External"}</div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                {scannedItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                    <span>{item.name}</span>
                    <span style={{ color: "var(--brand-light)", fontWeight: 600 }}>{Math.max(1, Number(item.quantity) || 1)} {item.unit}</span>
                  </div>
                ))}
              </div>

              {notes && <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>{notes}</div>}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(2)}>{"←"} {lang === "en" ? "Back" : "Retour"}</button>
              <button className="btn btn-success" style={{ flex: 2 }}
                disabled={editingId ? saveMutation.isPending : createMutation.isPending}
                onClick={() => editingId ? saveMutation.mutate() : createMutation.mutate()}>
                {(editingId ? saveMutation.isPending : createMutation.isPending) ? "..."
                  : (editingId ? (lang === "en" ? "Save changes" : "Enregistrer") : (lang === "en" ? "Confirm Transfer" : "Confirmer le transfert"))}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -- TRANSFER LIST ------------------------------------------
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      {detailTransferId && <TransferDetailModal transferId={detailTransferId} onClose={closeTransferDetail} />}
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 className="page-title" style={{ margin: 0 }}>{lang === "en" ? "Stock Transfers" : "Transferts de stock"}</h1>
          <HelpButton topic="transfer" />
        </div>
        <RestrictedAction>
          <button className="btn btn-primary btn-lg" onClick={() => setMode("new")} style={{ gap: 8 }}>
            + {lang === "en" ? "Transfer Stock" : "Transferer du stock"}
          </button>
        </RestrictedAction>
      </div>

      {/* MP-TRANSFER-RECEIVE-CONFIRM (Phase 1) — destination "Incoming transfers"
          inbox: in_transit deliveries arriving at my location, awaiting confirmation.
          A staffer can't confirm their own dispatch (server enforces + button hidden). */}
      {confirmFlow && incoming.length > 0 && (
        <div style={{ marginBottom: 20, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            📥 {lang === "en" ? "Incoming transfers" : "Transferts entrants"}
            <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>
              {lang === "en" ? "count what actually arrived" : "comptez ce qui est réellement arrivé"}
            </span>
          </div>
          {/* F-C: the override RATE, where the work happens. Only drawn once an
              override exists — a permanent "0 of 21" would be noise, and the chip
              needs to mean something when it appears. Amber is decided SERVER-side
              so the two surfaces cannot disagree about the threshold. */}
          {recvSummary.overrides > 0 && (
            <div style={{ fontSize: 11.5, marginBottom: 10, padding: "6px 10px", borderRadius: 8,
                          background: recvSummary.amber ? "rgba(245,158,11,0.12)" : "var(--bg-elevated)",
                          border: `1px solid ${recvSummary.amber ? "rgba(245,158,11,0.45)" : "var(--border)"}`,
                          color: recvSummary.amber ? "#f59e0b" : "var(--text-muted)" }}>
              {lang === "en"
                ? `${recvSummary.overrides} of ${recvSummary.receipts} receipts in the last 30 days were confirmed WITHOUT counting (${recvSummary.pct}%).`
                : `${recvSummary.overrides} réceptions sur ${recvSummary.receipts} ces 30 derniers jours ont été confirmées SANS comptage (${recvSummary.pct} %).`}
            </div>
          )}
          <div style={{ display: "grid", gap: 10 }}>
            {incoming.map(tr => {
              const fromName = locations.find(l => l.id === tr.from_location)?.name || "External";
              const toName   = locations.find(l => l.id === tr.to_location)?.name || "External";
              const mine = tr.dispatched_by && tr.dispatched_by === myId;
              return (
                <div key={tr.id} style={{ border: "1px solid var(--border)", borderLeft: "3px solid #fbbf24", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{tr.transfer_number}</div>
                      <div style={{ fontSize: 14, fontWeight: 500, margin: "3px 0" }}>{fromName} <span style={{ color: "var(--text-muted)" }}>></span> {toName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {tr.dispatched_by_name ? (lang === "en" ? `Sent by ${tr.dispatched_by_name}` : `Envoyé par ${tr.dispatched_by_name}`) : ""}
                        {tr.pa_transfer_items?.length ? " · " + tr.pa_transfer_items.length + " item(s)" : ""}
                      </div>
                    </div>
                    {(mine && requireSecond && !isOwner) ? (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", maxWidth: 190, textAlign: "right" }}>
                        {lang === "en" ? "You dispatched this — someone at the destination must confirm." : "Vous l'avez envoyé — quelqu'un à destination doit confirmer."}
                      </span>
                    ) : (
                      // F-C: ONE BUTTON, AND IT OPENS A COUNT.
                      // "Confirm all correct" is gone. It wrote received_quantity NULL,
                      // the trigger read that as the full sent quantity, and 1,108 of
                      // 1,135 lines on Paul's org went through it unexamined —
                      // TRF-20260810-0003 was 9 lines and 1,048 units in 47 seconds.
                      // There is no longer a way to agree with a number you have not seen.
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setAdjustFor(tr)}>
                          {lang === "en" ? "Count & receive" : "Compter & réceptionner"}
                        </button>
                      </div>
                    )}
                  </div>
                  {/* F-C: the quantity chips are GONE from the receiver's card.
                      They printed "{product} x{sent}" for every line, so the answer was
                      on screen before the question was asked. The server no longer sends
                      the number to a receiver at all (GET /transfers/incoming strips it),
                      so this could not render it even if someone re-added the markup —
                      the blindness is in the payload, not the styling. */}
                  {tr.pa_transfer_items?.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {tr.pa_transfer_items.map((item, i) => (
                        <span key={i} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                          {item.pa_products?.name}
                          {item.quantity != null ? ` x${item.quantity}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { value: "", en: "All", fr: "Tous" },
          { value: "pending", en: "Pending", fr: "En attente" },
          { value: "completed", en: "Completed", fr: "Termines" },
          { value: "cancelled", en: "Cancelled", fr: "Annulés" },
        ].map(f => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={"btn btn-sm " + (statusFilter === f.value ? "btn-primary" : "btn-secondary")}>
            {lang === "en" ? f.en : f.fr}
          </button>
        ))}
      </div>

      {/* A1 date filter — applies across the All/Pending/Completed/Cancelled tabs */}
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} style={{ marginBottom: 20 }} />

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
      ) : transfers.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No transfers yet" : "Aucun transfert"}</div>
          <RestrictedAction>
            <button className="btn btn-primary" onClick={() => setMode("new")} style={{ marginTop: 12 }}>
              + {lang === "en" ? "Create first transfer" : "Premier transfert"}
            </button>
          </RestrictedAction>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {transfers.map(tr => {
            const sc = statusColor(tr.status);
            const fromName = locations.find(l => l.id === tr.from_location)?.name || "External";
            const toName   = locations.find(l => l.id === tr.to_location)?.name || "External";
            return (
              <div key={tr.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px" }}>
                {/* flexWrap + gap so the action group (flexShrink:0) wraps BELOW the
                    info block on narrow cards instead of overflowing the card edge. */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      {/* MP-STAFF-ACTIVITY-LEDGER Phase 3: tap the number → full detail chain. */}
                      <button onClick={() => setDetailTransferId(tr.id)}
                        style={{ fontFamily: "monospace", fontSize: 12, color: "var(--brand)", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
                        {tr.transfer_number}
                      </button>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: sc.bg, color: sc.color }}>{statusLabel(tr.status)}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                      {fromName} <span style={{ color: "var(--text-muted)" }}>></span> {toName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatDate(tr.transfer_date)}
                      {tr.pa_transfer_items?.length > 0 && " - " + tr.pa_transfer_items.length + " item(s)"}
                      {tr.notes && " - " + tr.notes}
                    </div>
                  </div>
                  {tr.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(tr)}>
                        {lang === "en" ? "Edit" : "Modifier"}
                      </button>
                      {canCancelThis(tr) && (
                        <button className="btn btn-sm"
                          disabled={cancelMutation.isPending}
                          onClick={() => promptCancel(tr)}
                          style={{ background: "transparent", border: "1px solid #f87171", color: "#f87171" }}>
                          {lang === "en" ? "Cancel" : "Annuler"}
                        </button>
                      )}
                      {confirmFlow ? (
                        <button className="btn btn-success btn-sm" disabled={dispatchMutation.isPending}
                          onClick={() => dispatchMutation.mutate(tr.id)}>
                          {lang === "en" ? "Dispatch" : "Envoyer"}
                        </button>
                      ) : (
                        <button className="btn btn-success btn-sm" disabled={completeMutation.isPending}
                          onClick={() => completeMutation.mutate(tr.id)}>
                          {lang === "en" ? "Mark done" : "Marquer termine"}
                        </button>
                      )}
                    </div>
                  )}
                  {/* MP-TRANSFER-WAYBILL: A4 delivery note for a DISPATCHED transfer
                      (dispatched_at set → two-sided Pro/Pro Plus flow). Reprintable
                      anytime; shares to WhatsApp / prints on Android via the OS sheet. */}
                  {tr.status !== "pending" && tr.dispatched_at && canWaybill && (
                    <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}
                      disabled={waybillBusy === tr.id}
                      onClick={() => handleWaybill(tr)}>
                      {waybillBusy === tr.id ? "…" : `📄 ${lang === "en" ? "Waybill" : "Bon de livraison"}`}
                    </button>
                  )}
                  {/* MP-TRANSFER-GOVERNANCE: cancel/reverse an in-transit (fully un-received)
                      transfer — permission-gated; the server blocks once any qty is received
                      and reverses the source leg. */}
                  {tr.status === "in_transit" && canCancelThis(tr) && (
                    <button className="btn btn-sm" style={{ flexShrink: 0, background: "transparent", border: "1px solid #f87171", color: "#f87171" }}
                      disabled={cancelMutation.isPending}
                      onClick={() => promptCancel(tr)}>
                      {lang === "en" ? "Cancel / reverse" : "Annuler / inverser"}
                    </button>
                  )}
                </div>
                {tr.pa_transfer_items?.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {tr.pa_transfer_items.map((item, i) => (
                      <span key={i} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                        {item.pa_products?.name} x{item.quantity}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adjustFor && (
        <ReceiveCountModal
          transfer={adjustFor} lang={lang} busy={confirmMutation.isPending}
          canSkipCount={canReceiveWithoutCount}
          onCancel={() => setAdjustFor(null)}
          onSubmit={(lines) => confirmMutation.mutate({ id: adjustFor.id, lines })}
          onOverride={(reason) => confirmMutation.mutate({ id: adjustFor.id, override: true, override_reason: reason })} />
      )}

      {/* F-C: the reveal. Separate from the count modal on purpose — the count is
          closed before this opens, so there is no way to see the sent figures and
          then go back and "adjust" the answer. */}
      {reveal && (
        <ReceiveRevealModal reveal={reveal} lang={lang} onClose={() => setReveal(null)} />
      )}
    </div>
  );
}

// MP-TRANSFER-RECEIVE-CONFIRM (Phase 2) + MP-TRANSFER-RECEIPT-DAMAGE: per-line "what
// actually arrived" — GOOD units (credited to sellable stock) and DAMAGED units
// (recorded to the damaged pile at receipt, sellable-as-damaged). Good is pre-filled
// to the sent qty; damaged defaults 0. Good + damaged can't exceed sent; anything still
// missing (sent − good − damaged) is a genuine transit variance flagged for the owner.
// ── F-C — THE BLIND COUNT ────────────────────────────────────────────────────
//
// This replaces AdjustReceiptModal, which PREFILLED the Good input with the sent
// quantity and printed "Sent: N" beside every row. That prefill is the root cause
// of the whole problem: submitting it unchanged wrote received == sent, which is
// why 49 lines carry a value and only 15 of them differ. The feature was never
// ignored — it was PRE-ANSWERED.
//
// So:
//   · inputs start EMPTY, never at the sent quantity and never at 0. Empty means
//     "not answered"; 0 is an answer, and it is the single most valuable number
//     this screen can capture (nothing arrived).
//   · the sent quantity is not shown, and is not even in the payload — the server
//     strips it from GET /transfers/incoming for the receiver.
//   · every line must be answered before Confirm enables. A partial count would
//     leave the unanswered lines NULL and the trigger would credit them in full,
//     which is the original bug returning one line at a time.
//
// ⚠️ WHAT THIS DOES NOT ACHIEVE. Blind receiving raises the COST of a rubber
// stamp; it does not make counting unfakeable. The dispatcher can read the figure
// down the phone, it is on the dispatch note, and someone determined can still
// invent a number. The lever that actually bites is the visible override rate.
export function ReceiveCountModal({ transfer, lang, busy, canSkipCount, onCancel, onSubmit, onOverride }) {
  const en = lang === "en";
  const items = transfer.pa_transfer_items || [];
  // EMPTY, not prefilled. See above — this single line is the fix.
  const [good, setGood] = useState(() => Object.fromEntries(items.map(it => [it.id, ""])));
  const [dmg, setDmg]   = useState(() => Object.fromEntries(items.map(it => [it.id, ""])));
  const [skip, setSkip] = useState(false);      // the escape hatch panel
  const [reason, setReason] = useState("");

  const num = (v) => (String(v).trim() === "" ? null : Number(v));
  const goodOf = (it) => num(good[it.id]);
  const dmgOf  = (it) => { const d = num(dmg[it.id]); return d == null ? 0 : d; };
  const answered = (it) => { const g = goodOf(it); return g != null && Number.isFinite(g) && g >= 0; };
  const allAnswered = items.length > 0 && items.every(answered);
  const badDamage = items.some(it => { const d = num(dmg[it.id]); return d != null && (!Number.isFinite(d) || d < 0); });

  const REASON_MIN = 10;
  const reasonOk = reason.trim().length >= REASON_MIN;

  const submitCount = () => {
    if (!allAnswered || badDamage) return;
    onSubmit(items.map(it => ({ item_id: it.id, received_quantity: goodOf(it), damaged_quantity: dmgOf(it) })));
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          {en ? "Count what arrived" : "Comptez ce qui est arrivé"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {en ? "Count the goods in front of you and enter the numbers. You'll see what was sent once you confirm."
              : "Comptez les marchandises devant vous et saisissez les quantités. Vous verrez ce qui a été envoyé après confirmation."}
        </div>

        {!skip && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
            {items.map(it => (
              <div key={it.id} style={{ padding: "8px 10px", background: "var(--bg-elevated)", borderRadius: 8,
                                        border: answered(it) ? "1px solid transparent" : "1px solid var(--border)" }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {it.pa_products?.name || "—"}
                  {it.pa_products?.unit ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {it.pa_products.unit}</span> : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Good" : "Bon"}
                    <input type="number" min="0" inputMode="numeric" value={good[it.id]}
                      placeholder="—"
                      onChange={e => setGood(p => ({ ...p, [it.id]: e.target.value }))}
                      style={{ width: 68, marginLeft: 6, textAlign: "right", padding: "5px 7px", borderRadius: 8,
                               border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }} />
                  </label>
                  <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Damaged" : "Abîmé"}
                    <input type="number" min="0" inputMode="numeric" value={dmg[it.id]}
                      placeholder="0"
                      onChange={e => setDmg(p => ({ ...p, [it.id]: e.target.value }))}
                      style={{ width: 68, marginLeft: 6, textAlign: "right", padding: "5px 7px", borderRadius: 8,
                               border: `1px solid ${dmgOf(it) > 0 ? "#fbbf24" : "var(--border)"}`, background: "var(--bg-card)", color: "var(--text-primary)" }} />
                  </label>
                  {!answered(it) && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "not counted yet" : "pas encore compté"}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!skip && !allAnswered && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
            {en ? `Every line needs a number — ${items.filter(answered).length} of ${items.length} counted.`
                : `Chaque ligne doit avoir une quantité — ${items.filter(answered).length} sur ${items.length} comptées.`}
          </div>
        )}

        {/* THE ESCAPE HATCH. Permission-gated, off by default, and never the default
            action here either — it is a text link under the primary button, not a
            peer of it. The reason is the record. */}
        {skip && (
          <div style={{ padding: "10px 12px", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              ⚠️ {en ? "Receive without counting" : "Réceptionner sans compter"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
              {en ? "Stock will be added at the full quantity sent, uncounted. This is logged with your name and shows in the owner's override rate."
                  : "Le stock sera ajouté à la quantité envoyée, sans comptage. Ceci est enregistré à votre nom et apparaît dans le taux de dérogation du propriétaire."}
            </div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder={en ? "Why can't this be counted right now?" : "Pourquoi ne peut-on pas compter maintenant ?"}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)",
                       background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, resize: "vertical" }} />
            <div style={{ fontSize: 11, color: reasonOk ? "var(--text-muted)" : "#f59e0b", marginTop: 4 }}>
              {reasonOk ? (en ? "Reason recorded." : "Motif enregistré.")
                        : (en ? `At least ${REASON_MIN} characters.` : `Au moins ${REASON_MIN} caractères.`)}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy}
            onClick={() => (skip ? setSkip(false) : onCancel())}>
            {skip ? (en ? "Back" : "Retour") : (en ? "Cancel" : "Annuler")}
          </button>
          {skip ? (
            <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !reasonOk}
              onClick={() => onOverride(reason.trim())}>
              {busy ? "…" : (en ? "Receive without counting" : "Réceptionner sans compter")}
            </button>
          ) : (
            <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !allAnswered || badDamage}
              onClick={submitCount}>
              {busy ? "…" : (en ? "Confirm count" : "Confirmer le comptage")}
            </button>
          )}
        </div>

        {canSkipCount && !skip && (
          <button onClick={() => setSkip(true)} disabled={busy}
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--text-muted)",
                     fontSize: 11.5, textDecoration: "underline", cursor: "pointer", width: "100%" }}>
            {en ? "Can't count these right now?" : "Impossible de compter maintenant ?"}
          </button>
        )}
      </div>
    </div>
  );
}

// F-C — THE REVEAL, shown only AFTER a count has been submitted. This is the
// first time the receiver sees what was sent. Rendered as a STATE rather than a
// toast: the comparison IS the output of counting, and a toast that disappears
// in four seconds cannot carry a nine-line reconciliation.
export function ReceiveRevealModal({ reveal, lang, onClose }) {
  const en = lang === "en";
  const rows = reveal.comparison || [];
  const off = rows.filter(r => !r.matches);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          {off.length === 0 ? (en ? "✓ Everything matched" : "✓ Tout correspond")
                            : (en ? `${off.length} line(s) differ` : `${off.length} ligne(s) diffèrent`)}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {off.length === 0
            ? (en ? "Your count agrees with what was sent. Stock has been added."
                  : "Votre comptage correspond à ce qui a été envoyé. Le stock a été ajouté.")
            : (en ? "Stock was added at YOUR counted quantity. Differences have gone to the owner as a stock check."
                  : "Le stock a été ajouté selon VOTRE comptage. Les écarts sont transmis au propriétaire comme vérification.")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
          {rows.map(r => (
            <div key={r.item_id} style={{ padding: "8px 10px", borderRadius: 8,
              background: r.matches ? "var(--bg-elevated)" : "rgba(239,68,68,0.10)",
              border: r.matches ? "1px solid transparent" : "1px solid rgba(239,68,68,0.35)" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.product || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                {en ? "Sent" : "Envoyé"} {r.sent} · {en ? "you counted" : "vous avez compté"} {r.good}
                {r.damaged > 0 ? ` · ${en ? "damaged" : "abîmé"} ${r.damaged}` : ""}
                {r.lost !== 0 ? ` · ${r.lost > 0 ? (en ? `missing ${r.lost}` : `manquant ${r.lost}`)
                                                : (en ? `extra ${-r.lost}` : `en trop ${-r.lost}`)}` : ""}
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={onClose}>
          {en ? "Done" : "Terminé"}
        </button>
      </div>
    </div>
  );
}
