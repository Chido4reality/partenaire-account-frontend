import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore, useAuthStore } from "../store";
import api from "../utils/api";
import BarcodeInput from "../components/common/BarcodeInput";
import CameraScanner from "../components/common/CameraScanner";
import { unitLabel } from "../utils/units";

export default function StockCountPage() {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const role = user?.role || "cashier";
  const isOwner = role === "owner";
  const canCount = isOwner || role === "manager" || role === "warehouse";

  const [search, setSearch] = useState("");
  // MP-STOCKCOUNT-LOCATION: scope the count to ONE shop at a time. Default = "All
  // locations" (""), never auto-picked / never remembered. Single location →
  // search + System qty + the saved adjustment are all that location's pa_stock;
  // "All locations" → System qty is the SUM across locations and Save is guarded.
  const [countLocationId, setCountLocationId] = useState("");
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

  // Load ALL org stock once; the on-screen location selector scopes/aggregates it
  // client-side (so switching shops is instant and never touches the global picker).
  const { data: stockData, isLoading } = useOfflineCachedQuery({
    queryKey: ["stock-count-all"],
    queryFn: () => api.get(`/stock`).then(r => r.data)
  });

  const { data: locData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const stock = stockData?.data || [];
  const locations = locData?.data || [];

  const singleLoc = !!countLocationId;
  const selectedLocName = locations.find(l => l.id === countLocationId)?.name || "";

  // Scope to the chosen location (one pa_stock row per product), or — for "All
  // locations" — aggregate per product so System qty is the SUM across locations
  // (this mode is view/count-only; Save is disabled because a summed discrepancy
  // can't be attributed to a single location).
  const displayRows = singleLoc
    ? stock.filter(s => s.location_id === countLocationId)
    : Object.values(stock.reduce((acc, s) => {
        const pid = s.product_id;
        if (!acc[pid]) acc[pid] = { id: pid, product_id: pid, pa_products: s.pa_products, quantity: 0, aggregated: true };
        acc[pid].quantity += Number(s.quantity) || 0;
        return acc;
      }, {}));

  // Filter by search (slot search only applies to a single location)
  const filtered = search
    ? displayRows.filter(s =>
        s.pa_products?.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.pa_products?.barcode?.includes(search) ||
        (s.slot_code || "").toLowerCase().includes(search.toLowerCase())
      )
    : displayRows;

  // Switching the audited location starts a fresh count (never mix shops).
  const changeCountLocation = (id) => {
    setCountLocationId(id);
    setCountList([]); setSearch(""); setSubmitted(false); setResults([]);
  };

  // Add product to count list. In single-location mode the line is bound to that
  // location's pa_stock row (location_id = the audited shop); in "All locations"
  // mode there is no single location (location_id = null → cannot be saved).
  const addToCount = (stockItem) => {
    const locId = singleLoc ? stockItem.location_id : null;
    const exists = countList.find(c => c.product_id === stockItem.product_id && c.location_id === locId);
    if (exists) {
      toast(lang === "en" ? "Already in count list" : "Déjà dans la liste", { duration: 1500 });
      return;
    }
    setCountList(prev => [...prev, {
      product_id: stockItem.product_id,
      name: stockItem.pa_products?.name || "?",
      unit: stockItem.pa_products?.unit || "pce",
      location_id: locId,
      location_name: singleLoc
        ? (stockItem.pa_locations?.name || selectedLocName || "?")
        : (lang === "en" ? "All locations (sum)" : "Toutes les boutiques (somme)"),
      slot_code: singleLoc ? (stockItem.slot_code || null) : null,
      system_qty: stockItem.quantity,      // location qty (single) or summed (all)
      actual_qty: stockItem.quantity,      // pre-fill with system qty
      aggregated: !singleLoc,
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
    mutationFn: () => {
      // Guard: only a single-location count can be saved as an adjustment — the
      // "All locations" sum can't be attributed to one location's pa_stock row.
      if (!singleLoc) throw new Error(lang === "en" ? "Select a location to save corrections" : "Choisissez une boutique pour enregistrer");
      return api.post("/stock/count", {
        counts: countList.map(c => ({
          product_id: c.product_id,
          location_id: c.location_id,   // = the audited shop → adjusts ONLY that pa_stock row
          actual_quantity: +c.actual_qty,
          notes: `Stock count by ${user?.full_name} @ ${selectedLocName}`
        }))
      });
    },
    onSuccess: (data) => {
      setResults(data?.data?.data || []);
      setSubmitted(true);
      setCountList([]);
      qc.invalidateQueries(["stock"]);
      qc.invalidateQueries(["stock-count-all"]);
      toast.success(lang === "en" ? "✓ Stock count saved!" : "✓ Inventaire sauvegardé!");
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || "Error")
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
        {countList.length > 0 && !submitted && singleLoc && (
          <button className="btn btn-primary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            {submitMutation.isPending ? "..." : `✓ ${lang === "en" ? "Save Count" : "Sauvegarder"} (${totalItems})`}
          </button>
        )}
      </div>

      {/* MP-STOCKCOUNT-LOCATION: audit one shop at a time. Default "All locations". */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          🏪 {lang === "en" ? "Location to audit" : "Boutique à auditer"}
        </label>
        <select className="input" value={countLocationId}
          onChange={e => changeCountLocation(e.target.value)}
          style={{ maxWidth: 280 }}>
          <option value="">{lang === "en" ? "All locations (view only)" : "Toutes les boutiques (lecture seule)"}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {!singleLoc && (
          <span style={{ fontSize: 11.5, color: "#fbbf24" }}>
            {lang === "en"
              ? "System = sum across shops · pick a shop to save corrections"
              : "Système = somme des boutiques · choisissez une boutique pour enregistrer"}
          </span>
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
                const locId = singleLoc ? s.location_id : null;
                const alreadyAdded = countList.find(c => c.product_id === s.product_id && c.location_id === locId);
                return (
                  <div key={s.id}
                    onClick={() => !alreadyAdded && addToCount(s)}
                    style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, cursor: alreadyAdded ? "default" : "pointer", opacity: alreadyAdded ? 0.5 : 1 }}
                    onMouseEnter={e => !alreadyAdded && (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.pa_products?.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8 }}>
                        <span>{singleLoc ? (s.pa_locations?.name || selectedLocName) : (lang === "en" ? "All shops (sum)" : "Toutes (somme)")}</span>
                        {singleLoc && s.slot_code && <span style={{ color: "#fbbf24" }}>📍 {s.slot_code}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.quantity} {unitLabel(s.pa_products?.unit)}</div>
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
                        <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>{item.system_qty} {unitLabel(item.unit)}</div>
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
                          {diff > 0 ? "+" : ""}{diff} {unitLabel(item.unit)}
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

              {/* Single-location → save adjusts that shop only. All locations →
                  view/count-only: Save is disabled (no ambiguous cross-shop write). */}
              <button className="btn btn-primary" style={{ height: 46, fontWeight: 700 }}
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || countList.length === 0 || !singleLoc}
                title={!singleLoc ? (lang === "en" ? "Select a location to save corrections" : "Choisissez une boutique pour enregistrer") : ""}>
                {submitMutation.isPending
                  ? "⏳ Saving..."
                  : singleLoc
                    ? `✓ ${lang === "en" ? "Save Count" : "Sauvegarder le comptage"} (${totalItems} items) — ${selectedLocName}`
                    : `🔒 ${lang === "en" ? "Save disabled for “All locations”" : "Enregistrement désactivé pour « Toutes »"}`}
              </button>
              {!singleLoc && (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center", marginTop: -2 }}>
                  {lang === "en"
                    ? "Select a location above to save corrections to that shop's stock."
                    : "Sélectionnez une boutique ci-dessus pour enregistrer les corrections de son stock."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
