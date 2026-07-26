import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";

// MP-STAFF-ACTIVITY-LEDGER Phase 3: goods-buffer receipt detail — who captured it, supplier,
// qty received → who priced+released it, qty released, close reason. Reachable from the
// Goods-Buffer list, the Activity Ledger, and search (?buf=<id>). Shop-timezone times.
function fmtWhen(iso, en) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(en ? "en-GB" : "fr-FR",
      { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}
function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value ?? "—"}</span>
    </div>
  );
}

export default function BufferDetailModal({ bufferId, onClose }) {
  const { lang } = useLangStore();
  const en = lang === "en";

  const { data: resp, isLoading, isError } = useQuery({
    queryKey: ["buffer-detail", bufferId],
    queryFn: () => api.get(`/goods-buffer/${bufferId}`).then((r) => r.data),
    enabled: !!bufferId,
  });
  const b = resp?.data || null;
  const productName = b ? (b.pa_products?.name || b.new_product_name || (en ? "New product" : "Nouveau produit")) : "";
  const released = b && (b.status === "released" || b.status === "closed" || Number(b.qty_released) > 0);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: 16, padding: 20, maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>{en ? "Loading…" : "Chargement…"}</div>
        ) : isError || !b ? (
          <div style={{ textAlign: "center", color: "var(--danger, #dc2626)", padding: 30 }}>{en ? "Could not load this goods receipt." : "Impossible de charger cette réception."}</div>
        ) : (
          <>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>📦 {b.buffer_number}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 12 }}>{productName}</div>

            {/* Captured */}
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 2 }}>{en ? "① Received into the buffer" : "① Reçu dans le tampon"}</div>
            <Row label={en ? "Captured by" : "Enregistré par"} value={b.created_by_name} />
            <Row label={en ? "When" : "Quand"} value={fmtWhen(b.created_at, en)} />
            <Row label={en ? "Supplier" : "Fournisseur"} value={b.supplier_name} />
            <Row label={en ? "Quantity received" : "Quantité reçue"} value={`${b.qty_received} ${b.new_product_unit || b.pa_products?.unit || ""}`} />
            {b.location_name && <Row label={en ? "Branch" : "Boutique"} value={b.location_name} />}
            {b.note && <Row label={en ? "Note" : "Note"} value={b.note} />}

            {/* Priced + released */}
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, margin: "14px 0 2px" }}>{en ? "② Priced & released" : "② Tarifé et libéré"}</div>
            {released ? (
              <>
                <Row label={en ? "Released by" : "Libéré par"} value={b.closed_by_name} />
                <Row label={en ? "When" : "Quand"} value={fmtWhen(b.closed_at, en)} />
                <Row label={en ? "Quantity released" : "Quantité libérée"} value={b.qty_released} />
                <Row label={en ? "Reason" : "Raison"} value={b.close_reason} />
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600, padding: "8px 0" }}>
                ⏳ {en ? "Still waiting for the boss to price + release it." : "En attente de tarification et de libération par le patron."}
              </div>
            )}

            <button onClick={onClose} className="btn btn-secondary" style={{ width: "100%", marginTop: 16 }}>{en ? "Close" : "Fermer"}</button>
          </>
        )}
      </div>
    </div>
  );
}
