// MP-MULTIPART: a tappable "N sets" figure for a kit parent → opens a per-part
// breakdown at the location (part name, on-hand, qty needed per set, sets it can
// make, and the limiting bottleneck). Availability = MIN over parts of
// floor(part_stock / quantity_per_unit) at that location.
import { useState } from "react";
import api from "../../utils/api";

export default function MultipartAvailability({ productId, locationId = null, available = null, lang, compact = false }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const en = lang === "en";

  const load = async (e) => {
    if (e) e.stopPropagation();
    setOpen(true); setLoading(true); setData(null);
    try {
      const d = await api.get(`/products/${productId}/availability${locationId ? `?location_id=${locationId}` : ""}`)
        .then(r => r.data?.data || { by_location: [] });
      setData(d);
    } catch { setData({ by_location: [] }); }
    finally { setLoading(false); }
  };

  const rows = data?.by_location || [];

  return (
    <>
      <span onClick={load} title={en ? "See parts breakdown" : "Voir le détail des pièces"}
        style={{ cursor: "pointer", textDecoration: "underline", color: "var(--brand-light)", fontWeight: 700, whiteSpace: "nowrap" }}>
        🧩 {available != null ? available : "—"} {compact ? "" : (en ? "sets" : "lots")}
      </span>
      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, width: "100%", maxWidth: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>🧩 {en ? "Complete sets from parts" : "Lots complets depuis les pièces"}</div>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: "8px 18px 16px" }}>
              {loading ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>{en ? "No parts / no stock." : "Aucune pièce / aucun stock."}</div>
              ) : rows.map(loc => (
                <div key={loc.location_id} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>🏪 {loc.location_name || "—"}</span>
                    <span style={{ color: loc.available > 0 ? "#34d399" : "#f87171" }}>
                      {loc.available} {en ? "complete set(s)" : "lot(s) complet(s)"}
                    </span>
                  </div>
                  {(loc.parts || []).map(p => (
                    <div key={p.part_product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5, color: p.is_bottleneck ? "#fbbf24" : "var(--text-secondary)" }}>
                      <span style={{ minWidth: 0 }}>
                        {p.is_bottleneck ? "⛔ " : "• "}{p.name}
                        {p.is_bottleneck && <span style={{ fontSize: 10.5, marginLeft: 4 }}>({en ? "limiting" : "limitant"})</span>}
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {p.on_hand} {en ? "on hand" : "en stock"} · {p.per_unit}{en ? "/set" : "/lot"} → <b>{p.sets}</b>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
