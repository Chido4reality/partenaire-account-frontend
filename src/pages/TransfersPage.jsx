import BarcodeInput from "../components/common/BarcodeInput";
import ProductSearchBox from "../components/common/ProductSearchBox";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatDate } from "../utils/api";

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

  // (A) tick-list multi-select picker state
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSel, setPickerSel]       = useState({}); // { [product_id]: qty }

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

  const { data: transferData, isLoading } = useOfflineCachedQuery({
    queryKey: ["transfers", statusFilter],
    queryFn: () => api.get(`/transfers?${statusFilter ? "status=" + statusFilter : ""}&limit=30`).then(r => r.data),
    refetchInterval: 30000
  });

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
      items: scannedItems.map(i => ({ product_id: i.product_id, quantity: Math.max(1, Number(i.quantity) || 1) }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer created!" : "Transfert cree!");
      setMode("list"); setStep(1); setFromLoc(""); setToLoc(""); setNotes(""); setScannedItems([]);
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
    onError: (err) => toast.error(err.response?.data?.message || "Error")
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

  // (B) CANCEL a pending transfer (soft) — server hard-rejects non-pending.
  const cancelMutation = useMutation({
    mutationFn: (id) => api.patch(`/transfers/${id}/cancel`),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer cancelled" : "Transfert annulé");
      qc.invalidateQueries(["transfers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const transfers = transferData?.data || [];
  const locations = locData?.data || [];

  const statusColor = (s) => {
    if (s === "completed") return { bg: "rgba(16,185,129,0.15)", color: "#34d399" };
    if (s === "in_transit") return { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" };
    if (s === "cancelled") return { bg: "rgba(239,68,68,0.15)", color: "#f87171" };
    return { bg: "rgba(251,197,3,0.15)", color: "var(--brand-light)" };
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

            <button className="btn btn-primary btn-block btn-lg"
              disabled={!fromLoc && !toLoc}
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
                      <input className="input" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                        placeholder={lang === "en" ? "Filter list..." : "Filtrer la liste..."} />
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
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Stock Transfers" : "Transferts de stock"}</h1>
        <button className="btn btn-primary btn-lg" onClick={() => setMode("new")} style={{ gap: 8 }}>
          + {lang === "en" ? "Transfer Stock" : "Transferer du stock"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
      ) : transfers.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No transfers yet" : "Aucun transfert"}</div>
          <button className="btn btn-primary" onClick={() => setMode("new")} style={{ marginTop: 12 }}>
            + {lang === "en" ? "Create first transfer" : "Premier transfert"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {transfers.map(tr => {
            const sc = statusColor(tr.status);
            const fromName = locations.find(l => l.id === tr.from_location)?.name || "External";
            const toName   = locations.find(l => l.id === tr.to_location)?.name || "External";
            return (
              <div key={tr.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{tr.transfer_number}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: sc.bg, color: sc.color }}>{tr.status}</span>
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
                      <button className="btn btn-sm"
                        disabled={cancelMutation.isPending}
                        onClick={() => { if (window.confirm(lang === "en" ? "Cancel this pending transfer?" : "Annuler ce transfert en attente ?")) cancelMutation.mutate(tr.id); }}
                        style={{ background: "transparent", border: "1px solid #f87171", color: "#f87171" }}>
                        {lang === "en" ? "Cancel" : "Annuler"}
                      </button>
                      <button className="btn btn-success btn-sm" disabled={completeMutation.isPending}
                        onClick={() => completeMutation.mutate(tr.id)}>
                        {lang === "en" ? "Mark done" : "Marquer termine"}
                      </button>
                    </div>
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
    </div>
  );
}
