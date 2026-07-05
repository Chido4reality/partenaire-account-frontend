// MP-MULTIPART: parts (BOM) builder for a multi-part product (kit). Variable N
// parts — add/remove as many as needed. Each part is either a NEW hidden
// component (name/unit/cost) or an EXISTING sellable product (linked → stock is
// shared). quantity_per_unit = how many of that part make one complete set.
// PRICE lives only on the parent; parts carry no sale price within the kit.
import { unitLabel } from "../../utils/units";

const rid = () => `p_${Math.random().toString(36).slice(2, 9)}`;

export function emptyPart() {
  return { _k: rid(), mode: "new", name: "", unit: "pce", cost_price: "", part_product_id: "", part_label: "",
    quantity_per_unit: 1, opening_qty: "", opening_location_id: "" };
}

// Convert builder rows → the API `parts` payload (drops incomplete rows). Carries
// quantity_per_unit (recipe) + opening_qty/opening_location_id (stock bought).
export function partsToPayload(parts) {
  return (parts || [])
    .filter(p => (p.mode === "new" && String(p.name || "").trim()) || (p.mode === "existing" && p.part_product_id))
    .map((p, i) => {
      const opening = {
        opening_qty: Number(p.opening_qty) || 0,
        opening_location_id: p.opening_location_id || null,
      };
      return p.mode === "existing"
        ? { part_product_id: p.part_product_id, quantity_per_unit: Number(p.quantity_per_unit) || 1, sort_order: i + 1, ...opening }
        : { new_part: { name: String(p.name).trim(), unit: p.unit || "pce", cost_price: Number(p.cost_price) || 0 }, quantity_per_unit: Number(p.quantity_per_unit) || 1, sort_order: i + 1, ...opening };
    });
}

export default function MultipartBuilder({ parts, setParts, products = [], locations = [], lang }) {
  const en = lang === "en";
  const add = () => setParts([...(parts || []), emptyPart()]);
  const upd = (k, patch) => setParts(parts.map(p => p._k === k ? { ...p, ...patch } : p));
  const rm = (k) => setParts(parts.filter(p => p._k !== k));

  // Existing-part candidates: real sellable products (not kits, not hidden parts).
  const candidates = (products || []).filter(p => !p.is_multipart && !p.is_component && p.is_active !== false);

  const inputStyle = { width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 13 };

  return (
    <div style={{ marginTop: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
        🧩 {en ? "Parts (the kit is made of these)" : "Pièces (le kit est composé de celles-ci)"}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
        {en ? "Price is on the kit above. Parts are the real stock, moved/counted on their own."
            : "Le prix est sur le kit ci-dessus. Les pièces sont le vrai stock, déplacées/comptées séparément."}
      </div>

      {(parts || []).length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 0" }}>
          {en ? "No parts yet — add at least two." : "Aucune pièce — ajoutez-en au moins deux."}
        </div>
      )}

      {(parts || []).map((p, idx) => (
        <div key={p._k} style={{ borderTop: idx === 0 ? "none" : "1px solid var(--border)", padding: "10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: "var(--brand-light)" }}>{en ? "Part" : "Pièce"} {idx + 1}</span>
            <select value={p.mode} onChange={e => upd(p._k, { mode: e.target.value })}
              style={{ ...inputStyle, width: "auto", flex: 1 }}>
              <option value="new">{en ? "New part (hidden)" : "Nouvelle pièce (masquée)"}</option>
              <option value="existing">{en ? "Existing product" : "Produit existant"}</option>
            </select>
            <button type="button" onClick={() => rm(p._k)}
              style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 15 }}>✕</button>
          </div>

          {p.mode === "new" ? (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6 }}>
              <input style={inputStyle} placeholder={en ? "Part name" : "Nom de la pièce"} value={p.name}
                onChange={e => upd(p._k, { name: e.target.value })} />
              <input style={inputStyle} placeholder={unitLabel("pce")} value={p.unit}
                onChange={e => upd(p._k, { unit: e.target.value })} />
              <input style={inputStyle} type="number" placeholder={en ? "Cost (opt.)" : "Coût (opt.)"} value={p.cost_price}
                onChange={e => upd(p._k, { cost_price: e.target.value })} />
            </div>
          ) : (
            <div>
              <input style={inputStyle} list={`mp-cand-${p._k}`}
                placeholder={en ? "Search existing product…" : "Chercher un produit existant…"}
                value={p.part_label}
                onChange={e => {
                  const label = e.target.value;
                  const match = candidates.find(c => c.name === label);
                  upd(p._k, { part_label: label, part_product_id: match ? match.id : "" });
                }} />
              <datalist id={`mp-cand-${p._k}`}>
                {candidates.slice(0, 200).map(c => <option key={c.id} value={c.name} />)}
              </datalist>
              {p.part_label && !p.part_product_id && (
                <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 3 }}>
                  {en ? "Pick a product from the list." : "Choisissez un produit dans la liste."}
                </div>
              )}
            </div>
          )}

          {/* RECIPE — how many of this part make ONE finished product (≠ stock). */}
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)" }}>
              {en ? "Qty per unit (recipe)" : "Quantité par unité (recette)"}
            </label>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 3 }}>
              {en ? "How many of this part make ONE finished product"
                  : "Combien de cette pièce pour fabriquer UN produit fini"}
            </div>
            <input style={{ ...inputStyle, width: 110 }} type="number" min="0.01" step="0.01"
              value={p.quantity_per_unit}
              onChange={e => upd(p._k, { quantity_per_unit: e.target.value })} />
          </div>

          {/* OPENING STOCK — what you actually BOUGHT of this part, per location. */}
          <div style={{ marginTop: 8, background: "var(--bg-elevated)", borderRadius: 8, padding: 8 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)" }}>
              {en ? "Opening stock — separate from the recipe" : "Stock d'ouverture — différent de la recette"}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6, marginTop: 4 }}>
              <input style={inputStyle} type="number" min="0" step="1"
                placeholder={en ? "Qty in stock (bought)" : "Quantité en stock (achetée)"}
                value={p.opening_qty}
                onChange={e => upd(p._k, { opening_qty: e.target.value })} />
              <select style={inputStyle} value={p.opening_location_id || ""}
                onChange={e => upd(p._k, { opening_location_id: e.target.value })}>
                <option value="">{en ? "Location (for stock)" : "Emplacement (pour le stock)"}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            {Number(p.opening_qty) > 0 && !p.opening_location_id && (
              <div style={{ fontSize: 10.5, color: "#fbbf24", marginTop: 3 }}>
                {en ? "Pick a location for this opening stock." : "Choisissez un emplacement pour ce stock."}
              </div>
            )}
          </div>
        </div>
      ))}

      <button type="button" onClick={add}
        style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 8, border: "1px dashed var(--border)", background: "transparent", color: "var(--brand-light)", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
        + {en ? "Add part" : "Ajouter une pièce"}
      </button>
    </div>
  );
}
