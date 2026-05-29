import BarcodeInput from "../components/common/BarcodeInput";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function TransfersPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [mode, setMode]             = useState("list"); // list | new
  const [step, setStep]             = useState(1);      // 1=locations, 2=scan items, 3=confirm
  const [fromLoc, setFromLoc]       = useState("");
  const [toLoc, setToLoc]           = useState("");
  const [notes, setNotes]           = useState("");
  const [scannedItems, setScannedItems] = useState([]);
  const [manualSearch, setManualSearch] = useState("");
  const [scanInput, setScanInput]   = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const scanRef = useRef(null);

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
    } catch {
      toast.error(lang === "en" ? "Barcode not found: " + code : "Code-barres introuvable: " + code);
    }
  };

  const addItem = (product, qty = 1) => {
    setScannedItems(prev => {
      const idx = prev.findIndex(i => i.product_id === product.id);
      if (idx >= 0) {
        const u = [...prev];
        u[idx] = { ...u[idx], quantity: u[idx].quantity + qty };
        return u;
      }
      return [...prev, { product_id: product.id, name: product.name, unit: product.unit, barcode: product.barcode, quantity: qty, stock: product.stock?.quantity }];
    });
  };

  const updateQty = (idx, qty) => {
    if (qty <= 0) setScannedItems(p => p.filter((_, i) => i !== idx));
    else setScannedItems(p => p.map((it, i) => i === idx ? { ...it, quantity: qty } : it));
  };

  const { data: transferData, isLoading } = useOfflineCachedQuery({
    queryKey: ["transfers", statusFilter],
    queryFn: () => api.get(`/transfers?${statusFilter ? "status=" + statusFilter : ""}&limit=30`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: locData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: searchResults } = useOfflineCachedQuery({
    queryKey: ["transfer-search", manualSearch],
    queryFn: () => manualSearch.length >= 2
      ? api.get(`/products?search=${manualSearch}&location_id=${fromLoc}`).then(r => r.data)
      : { data: [] },
    enabled: manualSearch.length >= 2
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/transfers", {
      from_location: fromLoc || null,
      to_location: toLoc || null,
      notes: notes || null,
      items: scannedItems.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer created!" : "Transfert cree!");
      setMode("list"); setStep(1); setFromLoc(""); setToLoc(""); setNotes(""); setScannedItems([]);
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

  const transfers = transferData?.data || [];
  const locations = locData?.data || [];

  const statusColor = (s) => {
    if (s === "completed") return { bg: "rgba(16,185,129,0.15)", color: "#34d399" };
    if (s === "in_transit") return { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" };
    if (s === "cancelled") return { bg: "rgba(239,68,68,0.15)", color: "#f87171" };
    return { bg: "rgba(79,70,229,0.15)", color: "var(--brand-light)" };
  };

  const resetNew = () => { setMode("list"); setStep(1); setFromLoc(""); setToLoc(""); setNotes(""); setScannedItems([]); };

  // -- NEW TRANSFER FLOW --------------------------------------
  if (mode === "new") {
    return (
      <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
        {/* Header with steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <button onClick={resetNew} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>{"←"}</button>
          <h1 className="page-title">{lang === "en" ? "New Transfer" : "Nouveau transfert"}</h1>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {[1,2,3].map(s => (
              <div key={s} style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: step >= s ? "var(--brand)" : "var(--bg-elevated)", color: step >= s ? "#fff" : "var(--text-muted)", border: "1px solid " + (step >= s ? "var(--brand)" : "var(--border)") }}>{s}</div>
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
              <select className="input" value={fromLoc} onChange={e => setFromLoc(e.target.value)}
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

        {/* STEP 2: Scan items */}
        {step === 2 && (
          <div style={{ animation: "fadeUp 0.2s ease both" }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
              {lang === "en" ? "Scan or search items" : "Scanner ou chercher les articles"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
              {locations.find(l => l.id === fromLoc)?.name || "External"} > {locations.find(l => l.id === toLoc)?.name || "External"}
            </div>

            {/* Scan input */}
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
            </div>

            {/* Manual search */}
            <div style={{ marginBottom: 16 }}>
              <input className="input" value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
                placeholder={lang === "en" ? "Or search by product name..." : "Ou chercher par nom de produit..."} />
              {searchResults?.data?.length > 0 && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginTop: 4, background: "var(--bg-elevated)" }}>
                  {searchResults.data.map(p => (
                    <div key={p.id} onClick={() => { addItem(p); setManualSearch(""); }}
                      style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 13, display: "flex", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{p.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{p.barcode}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Scanned items */}
            {scannedItems.length > 0 && (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                  {scannedItems.length} {lang === "en" ? "item(s) to transfer" : "article(s) a transferer"}
                </div>
                {scannedItems.map((item, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
                      {item.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{item.barcode}</div>}
                      {item.stock != null && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Available:" : "Disponible:"} {item.stock} {item.unit}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => updateQty(idx, item.quantity - 1)} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 16 }}>-</button>
                      <input type="number" value={item.quantity} onChange={e => updateQty(idx, +e.target.value)}
                        style={{ width: 50, textAlign: "center", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "4px", fontSize: 14 }} />
                      <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 30 }}>{item.unit}</span>
                      <button onClick={() => updateQty(idx, item.quantity + 1)} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", cursor: "pointer", fontSize: 16 }}>+</button>
                      <button onClick={() => updateQty(idx, 0)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, marginLeft: 4 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>{"←"} {lang === "en" ? "Back" : "Retour"}</button>
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
                    <span style={{ color: "var(--brand-light)", fontWeight: 600 }}>{item.quantity} {item.unit}</span>
                  </div>
                ))}
              </div>

              {notes && <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>{notes}</div>}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(2)}>{"←"} {lang === "en" ? "Back" : "Retour"}</button>
              <button className="btn btn-success" style={{ flex: 2 }}
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "..." : (lang === "en" ? "Confirm Transfer" : "Confirmer le transfert")}
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
                    <button className="btn btn-success btn-sm" disabled={completeMutation.isPending}
                      onClick={() => completeMutation.mutate(tr.id)}>
                      {lang === "en" ? "Mark done" : "Marquer termine"}
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
    </div>
  );
}


