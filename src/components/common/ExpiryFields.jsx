// EXPIRY-TRACKING (Peter, 2026-10-04) — the two receive-time inputs, shared by every
// place goods are received (Receive Goods, initial stock, rapid entry, restock
// receive, goods-buffer release). Shown ONLY for a product that tracks expiry: the
// date is required, the batch / lot number optional. The server enforces the same
// rule (400 expiry_required), so this is the friendly half, not the guard.

export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** True when a tracked line is missing its date (blocks submit, client side). */
export function expiryMissing(tracked, date) {
  return !!tracked && !String(date || "").trim();
}

export default function ExpiryFields({ en, date, batch, onDate, onBatch, compact = false, disabled = false }) {
  const missing = !String(date || "").trim();
  const wrap = compact
    ? { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }
    : { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginTop: 6 };
  return (
    <div style={wrap}>
      <div>
        <label className="label" style={{ fontSize: 12 }}>
          {en ? "Expiry date" : "Date d'expiration"} <span style={{ color: "var(--red, #c0392b)" }}>*</span>
        </label>
        <input className="input" type="date" value={date || ""} disabled={disabled}
          onChange={(e) => onDate(e.target.value)}
          style={missing ? { borderColor: "var(--red, #c0392b)" } : undefined} />
        {date && date < todayIso() && (
          <div style={{ fontSize: 11, color: "var(--amber, #b7791f)", marginTop: 2 }}>
            {en ? "This date is already past." : "Cette date est déjà passée."}
          </div>
        )}
      </div>
      <div>
        <label className="label" style={{ fontSize: 12 }}>{en ? "Batch / lot no. (optional)" : "N° de lot (facultatif)"}</label>
        <input className="input" value={batch || ""} maxLength={60} disabled={disabled}
          onChange={(e) => onBatch(e.target.value)} placeholder={en ? "e.g. L2410" : "ex. L2410"} />
      </div>
    </div>
  );
}

/** The per-product switch for the add / edit / rapid-entry / buffer forms. */
export function TrackExpiryToggle({ en, checked, onChange, disabled = false }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: disabled ? "default" : "pointer", fontSize: 13.5, marginTop: 8 }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontWeight: 600 }}>{en ? "Track expiry" : "Suivre la date d'expiration"}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
          {en ? "Every delivery of this product will need an expiry date. Products not tracked work exactly as today."
              : "Chaque livraison de ce produit demandera une date d'expiration. Les produits non suivis fonctionnent comme aujourd'hui."}
        </span>
      </span>
    </label>
  );
}
