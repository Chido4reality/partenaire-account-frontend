import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api from "../utils/api";
import BarcodeInput from "../components/common/BarcodeInput";
import CameraScanner from "../components/common/CameraScanner";

export default function StockCountPage() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const role = user?.role || "cashier";
  const isOwner = role === "owner";
  const canCount = isOwner || role === "manager" || role === "warehouse";

  const [search, setSearch] = useState("");
  const [countList, setCountList] = useState([]); // [{product_id, name, unit, location_id, location_name, system_qty, actual_qty}]
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState([]);
  const [showCamera, setShowCamera] = useState(false);
  const searchRef = useRef(null);

  if (!canCount) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔒</div>
      <div style={{ fontWeight: 700 }}>{lang === "en" ? "Access restricted" : "Accès restreint"}</div>
    </div>
  );

  // Load stock for selected location
  const { data: stockData, isLoading } = useOfflineCachedQuery({
    queryKey: ["stock-count", selectedLocation?.id],
    queryFn: () => {
      const params = selectedLocation ? `?location_id=${selectedLocation.id}` : "";
      return api.get(`/stock${params}`).then(r => r.data);
    }
  });

  const { data: locData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const stock = stockData?.data || [];
  const locations = locData?.data || [];

  // Filter stock by search
  const filtered = search
    ? stock.filter(s =>
        s.pa_products?.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.pa_products?.barcode?.includes(search) ||
        s.slot_code?.toLowerCase().includes(search.toLowerCase())
      )
    : stock;

  // Add product to count list
  const addToCount = (stockItem) => {
    const exists = countList.find(c => c.product_id === stockItem.product_id && c.location_id === stockItem.location_id);
    if (exists) {
      toast(lang === "en" ? "Already in count list" : "Déjà dans la liste", { duration: 1500 });
      return;
    }
    setCountList(prev => [...prev, {
      product_id: stockItem.product_id,
      name: stockItem.pa_products?.name || "?",
      unit: stockItem.pa_products?.unit || "pce",
      location_id: stockItem.location_id,
      location_name: stockItem.pa_locations?.name || "?",
      slot_code: stockItem.slot_code || null,
      system_qty: stockItem.quantity,
      actual_qty: stockItem.quantity // pre-fill with system qty
    }]);
    setSearch("");
    searchRef.current?.focus();
    toast.success(`✓ ${stockItem.pa_products?.name} ${lang === "en" ? "added to count" : "ajouté au comptage"}`, { duration: 1200 });
  };

  const updateActualQty = (idx, qty) => {
    setCountList(prev => prev.map((c, i) => i === idx ? { ...c, actual_qty: qty } : c));
  };

  const removeFromCount = (idx) => {
    setCountList(prev => prev.filter((_, i) => i !== idx));
  };

  const submitMutation = useMutation({
    mutationFn: () => api.post("/stock/count", {
      counts: countList.map(c => ({
        product_id: c.product_id,
        location_id: c.location_id,
        actual_quantity: +c.actual_qty,
        notes: `Stock count by ${user?.full_name}`
      }))
    }),
    onSuccess: (data) => {
      setResults(data?.data?.data || []);
      setSubmitted(true);
      setCountList([]);
      qc.invalidateQueries(["stock"]);
      qc.invalidateQueries(["stock-count"]);
      toast.success(lang === "en" ? "✓ Stock count saved!" : "✓ Inventaire sauvegardé!");
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const differences = countList.filter(c => +c.actual_qty !== +c.system_qty);
  const totalItems = countList.length;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">🔢 {lang === "en" ? "Stock Count" : "Comptage de stock"}</h1>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {lang === "en" ? "Scan or search products, enter actual count, save differences." : "Scannez ou cherchez les produits, entrez le compte réel, sauvegardez les différences."}
          </div>
        </div>
        {countList.length > 0 && !submitted && (
          <button className="btn btn-primary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            {submitMutation.isPending ? "..." : `✓ ${lang === "en" ? "Save Count" : "Sauvegarder"} (${totalItems})`}
          </button>
        )}
      </div>

      {/* Results after submission */}
      {submitted && results.length > 0 && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
            ✅ {lang === "en" ? "Count Results" : "Résultats du comptage"}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>System</th>
                  <th style={{ textAlign: "right" }}>Counted</th>
                  <th style={{ textAlign: "right" }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const item = stock.find(s => s.product_id === r.product_id);
                  const diff = r.difference || (r.actual - r.previous);
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{item?.pa_products?.name || r.product_id}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{r.previous}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{r.actual}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: diff === 0 ? "#34d399" : diff > 0 ? "var(--brand-light)" : "#f87171" }}>
                        {diff > 0 ? "+" : ""}{diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => { setSubmitted(false); setResults([]); }}>
            {lang === "en" ? "New count" : "Nouveau comptage"}
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 20 }}>

        {/* LEFT: Search & add products */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            1️⃣ {lang === "en" ? "Search & add products to count" : "Cherchez et ajoutez les produits à compter"}
          </div>

          {/* Search */}
          <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <BarcodeInput
                inputRef={searchRef}
                lang={lang}
                value={search}
                onChange={setSearch}
                placeholder={lang === "en" ? "Type name, scan barcode or slot..." : "Nom, code-barres ou emplacement..."}
                autoFocus
              />
            </div>
            <button onClick={() => setShowCamera(true)}
              style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>
              📷
            </button>
          </div>

          {showCamera && (
            <CameraScanner
              lang={lang}
              onScan={(code) => { setShowCamera(false); setSearch(code); searchRef.current?.focus(); }}
              onClose={() => setShowCamera(false)}
            />
          )}

          {/* Stock list */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", maxHeight: 500, overflowY: "auto" }}>
            {isLoading ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {search ? `No results for "${search}"` : lang === "en" ? "No stock records" : "Aucun stock"}
              </div>
            ) : (
              filtered.map(s => {
                const alreadyAdded = countList.find(c => c.product_id === s.product_id && c.location_id === s.location_id);
                return (
                  <div key={s.id}
                    onClick={() => !alreadyAdded && addToCount(s)}
                    style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, cursor: alreadyAdded ? "default" : "pointer", opacity: alreadyAdded ? 0.5 : 1 }}
                    onMouseEnter={e => !alreadyAdded && (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.pa_products?.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8 }}>
                        <span>{s.pa_locations?.name}</span>
                        {s.slot_code && <span style={{ color: "#fbbf24" }}>📍 {s.slot_code}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.quantity} {s.pa_products?.unit}</div>
                      {alreadyAdded && <div style={{ fontSize: 10, color: "#34d399" }}>✓ Added</div>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: Count list */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            2️⃣ {lang === "en" ? "Enter actual count" : "Entrez le compte réel"}
            {differences.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, background: "rgba(239,68,68,0.15)", color: "#f87171", padding: "2px 8px", borderRadius: 10 }}>
                {differences.length} {lang === "en" ? "difference(s)" : "différence(s)"}
              </span>
            )}
          </div>

          {countList.length === 0 ? (
            <div style={{ background: "var(--bg-card)", border: "2px dashed var(--border)", borderRadius: 12, padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {lang === "en" ? "← Click products on the left to add them here" : "← Cliquez sur les produits à gauche pour les ajouter ici"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {countList.map((item, idx) => {
                const diff = +item.actual_qty - +item.system_qty;
                const hasDiff = diff !== 0;
                return (
                  <div key={idx} style={{ background: "var(--bg-card)", border: `1px solid ${hasDiff ? (diff > 0 ? "rgba(251,197,3,0.4)" : "rgba(239,68,68,0.4)") : "var(--border)"}`, borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {item.location_name}
                          {item.slot_code && <span style={{ color: "#fbbf24", marginLeft: 6 }}>📍 {item.slot_code}</span>}
                        </div>
                      </div>
                      <button onClick={() => removeFromCount(idx)}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>System</div>
                        <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>{item.system_qty} {item.unit}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Counted *</div>
                        <input type="number" value={item.actual_qty}
                          onChange={e => updateActualQty(idx, e.target.value)}
                          style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: `1px solid ${hasDiff ? "#f87171" : "var(--border)"}`, background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 14, fontWeight: 700, textAlign: "center" }} />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Diff</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: diff === 0 ? "#34d399" : diff > 0 ? "var(--brand-light)" : "#f87171" }}>
                          {diff > 0 ? "+" : ""}{diff} {item.unit}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Summary */}
              {countList.length > 0 && (
                <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: "12px 16px", marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Items counted:" : "Articles comptés:"}</span>
                    <strong>{totalItems}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "With differences:" : "Avec différences:"}</span>
                    <strong style={{ color: differences.length > 0 ? "#f87171" : "#34d399" }}>{differences.length}</strong>
                  </div>
                </div>
              )}

              <button className="btn btn-primary" style={{ height: 46, fontWeight: 700 }}
                onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || countList.length === 0}>
                {submitMutation.isPending ? "⏳ Saving..." : `✓ ${lang === "en" ? "Save Count" : "Sauvegarder le comptage"} (${totalItems} items)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
