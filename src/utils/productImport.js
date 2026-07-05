// MP-PRODUCT-IMPORT — the "Add products via spreadsheet" template + parser.
//
// Goals (see the Add-Product form for the canonical fields):
//  • barcode is TEXT end to end. The .xlsx template pre-formats the barcode
//    column as Text so Excel never turns "6001234567890" into 1.23E+09, and the
//    parser reads it strictly as a string. A value that already arrived corrupted
//    (scientific notation / a rounded float / a >15-digit number) is REJECTED with
//    a plain message — the real digits are unrecoverable, so we never save a wrong
//    barcode silently.
//  • Canonical headers match the form; legacy aliases still parse (back-compat).
//  • location resolves to a real org location (case/space-insensitive) or the row
//    is rejected listing the valid names.
//  • Per-row validation so good rows import and bad rows are listed.
//
// SheetJS is dynamically imported so it is code-split out of the main bundle.
import { unitValue } from "./units";

// Canonical header order shown in the template.
export const TEMPLATE_HEADERS = [
  "name", "barcode", "unit", "cost_price", "walk_in_price",
  "wholesale_price", "min_price", "qty", "location", "slot_zone",
];

// Which CSV/XLSX headers map to which internal field. Accepts the friendly form
// names, the canonical names, AND the legacy template names (sell_price, etc.).
const HEADER_ALIASES = {
  name: "name", product: "name", product_name: "name",
  barcode: "barcode", bar_code: "barcode", code: "barcode",
  unit: "unit",
  cost_price: "cost_price", cost: "cost_price", cost_prix: "cost_price", prix_achat: "cost_price",
  walk_in_price: "sell_price", walkin_price: "sell_price", "walk-in_price": "sell_price",
  sell_price: "sell_price", selling_price: "sell_price", price: "sell_price", prix_vente: "sell_price",
  wholesale_price: "wholesale_price", wholesale: "wholesale_price", prix_gros: "wholesale_price",
  min_price: "min_price", min: "min_price", min_price_floor: "min_price", prix_min: "min_price",
  qty: "qty", quantity: "qty", initial_quantity: "qty", quantité: "qty", quantite: "qty", stock: "qty",
  location: "location", branch: "location", shop: "location", boutique: "location", emplacement: "location",
  slot_zone: "slot_zone", slot: "slot_zone", zone: "slot_zone", "slot/zone": "slot_zone", slot_code: "slot_zone", rayon: "slot_zone",
};

const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/\s+/g, "_");
const normLoc = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Barcode → { value, error }. error is a key ('sci' | 'float' | 'toolong') when
// the incoming value is corrupted and must be rejected.
export function coerceBarcode(raw) {
  if (raw == null || raw === "") return { value: "", error: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { value: "", error: "float" };
    if (raw > 999999999999999) return { value: "", error: "toolong" }; // >15 digits: precision already lost
    return { value: String(raw), error: null };                        // safe integer → exact digits, no leading-zero case
  }
  const s = String(raw).trim();
  if (!s) return { value: "", error: null };
  if (/e\+?\d/i.test(s)) return { value: "", error: "sci" };           // 1.23E+09
  if (/\./.test(s)) return { value: "", error: "float" };              // 1230000000.0 (Excel-rounded)
  return { value: s, error: null };                                    // keep as string, leading zeros preserved
}

const barcodeErrMsg = (en) => en
  ? "barcode looks corrupted (e.g. 1.23E+09). Format the barcode column as Text and type the full number again."
  : "code-barres corrompu (ex : 1.23E+09). Formatez la colonne code-barres en Texte et retapez le numéro complet.";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

// Parse an uploaded .xlsx/.xls/.csv into validated rows against the org's
// locations. Returns { rows } where each row carries { ok, errors:[{en,fr}], ... }.
// Resolve the xlsx module across CJS/ESM interop (vite may nest it under .default).
async function loadXLSX() {
  const mod = await import("xlsx");
  return mod && mod.utils ? mod : (mod && mod.default) || mod;
}

export async function parseProductImport(file, locations) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];                 // first sheet = the data ("Products")
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  if (!aoa.length) return { rows: [] };

  // Find the header row (first row that contains a recognisable "name" header).
  let headerIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    if ((aoa[i] || []).some((c) => HEADER_ALIASES[normHeader(c)] === "name")) { headerIdx = i; break; }
  }
  const headerCells = (aoa[headerIdx] || []).map((c) => HEADER_ALIASES[normHeader(c)] || null);

  const locByName = new Map((locations || []).map((l) => [normLoc(l.name), l]));
  const validLocList = (locations || []).map((l) => l.name).join(" | ");

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const cells = aoa[i] || [];
    const rowNum = i + 1; // 1-based spreadsheet row for user-facing messages
    const rec = {};
    headerCells.forEach((field, idx) => { if (field) rec[field] = cells[idx]; });
    // Skip fully-blank rows.
    if (!Object.values(rec).some((v) => v != null && String(v).trim() !== "")) continue;

    const errors = [];
    const name = String(rec.name == null ? "" : rec.name).trim();
    // Store the canonical 'pce' (a typed/imported 'pcs' normalises back to it).
    const unit = unitValue(String(rec.unit == null ? "" : rec.unit).trim() || "pce");
    const bc = coerceBarcode(rec.barcode);
    if (bc.error) errors.push({ en: barcodeErrMsg(true), fr: barcodeErrMsg(false) });

    const cost = num(rec.cost_price);
    const sell = num(rec.sell_price);
    const wholesale = num(rec.wholesale_price);
    const minp = num(rec.min_price);
    const qty = num(rec.qty);

    if (!name) errors.push({ en: "name is required.", fr: "le nom est requis." });
    if (cost == null || Number.isNaN(cost)) errors.push({ en: "cost_price is required and must be a number.", fr: "cost_price est requis et doit être un nombre." });
    if (sell == null || Number.isNaN(sell)) errors.push({ en: "walk_in_price is required and must be a number.", fr: "walk_in_price est requis et doit être un nombre." });
    if (qty == null || Number.isNaN(qty)) errors.push({ en: "qty is required and must be a number.", fr: "qty est requis et doit être un nombre." });

    const locRaw = String(rec.location == null ? "" : rec.location).trim();
    let loc = null;
    if (!locRaw) errors.push({ en: "location is required.", fr: "l'emplacement est requis." });
    else {
      loc = locByName.get(normLoc(locRaw)) || null;
      if (!loc) errors.push({
        en: `location "${locRaw}" not found. Valid: ${validLocList || "(add a location first)"}.`,
        fr: `emplacement "${locRaw}" introuvable. Valides : ${validLocList || "(ajoutez d'abord un emplacement)"}.`,
      });
    }

    rows.push({
      _rowNum: rowNum,
      name,
      barcode: bc.value || "",
      unit,
      cost_price: cost == null || Number.isNaN(cost) ? "" : cost,
      sell_price: sell == null || Number.isNaN(sell) ? "" : sell,
      wholesale_price: wholesale == null || Number.isNaN(wholesale) ? "" : wholesale,
      min_price: minp == null || Number.isNaN(minp) ? "" : minp,
      qty: qty == null || Number.isNaN(qty) ? "" : qty,
      location_name: locRaw,
      location_id: loc ? loc.id : "",
      slot_zone: String(rec.slot_zone == null ? "" : rec.slot_zone).trim(),
      errors,
      ok: errors.length === 0,
    });
  }
  return { rows };
}

// Build the downloadable .xlsx template with a Text-formatted barcode column,
// a real example row, and an Instructions sheet (required vs optional, FR+EN).
export async function buildProductTemplateXlsx(locations, en) {
  const XLSX = await loadXLSX();
  const locName = (locations && locations[0] && locations[0].name) || (en ? "Your Shop" : "Votre Boutique");
  const ex1 = ["Tube", "6001234567890", "pcs", 2500, 4000, 3500, 2500, 100, locName, "A-01 Rayon 2"];
  const ex2 = ["Huile palme", "6009988776655", "litre", 1800, 3000, 2500, 1800, 50, locName, ""];
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ex1, ex2]);

  // Force the barcode column (B) to TEXT for a buffer of rows so long digit
  // strings the user types never become scientific notation.
  const NROWS = 400;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  range.e.r = Math.max(range.e.r, NROWS);
  range.e.c = Math.max(range.e.c, TEMPLATE_HEADERS.length - 1);
  ws["!ref"] = XLSX.utils.encode_range(range);
  for (let r = 1; r <= NROWS; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = ws[addr] || { t: "s", v: "" };
    cell.t = "s"; cell.z = "@"; // string cell + Text number format
    ws[addr] = cell;
  }
  ws["!cols"] = TEMPLATE_HEADERS.map((h, i) => ({ wch: i === 0 ? 18 : i === 1 ? 20 : i === 8 ? 16 : i === 9 ? 16 : 13 }));

  const guideEN = [
    ["HOW TO FILL THIS TEMPLATE — fill the 'Products' sheet."],
    [""],
    ["REQUIRED columns: name, unit, cost_price, walk_in_price, qty, location"],
    ["OPTIONAL columns: barcode, wholesale_price, min_price, slot_zone"],
    [""],
    ["name            product name"],
    ["barcode         scan code (digits). KEEP THIS COLUMN AS TEXT."],
    ["unit            pcs, litre, kg, carton..."],
    ["cost_price      what you pay for it"],
    ["walk_in_price   normal selling price (what a walk-in customer pays)"],
    ["wholesale_price price for wholesale buyers (optional)"],
    ["min_price       lowest price you allow (optional)"],
    ["qty             how many you have now"],
    ["location        must match one of your shop/branch names exactly"],
    ["slot_zone       shelf/zone label, e.g. A-01 Rayon 2 (optional)"],
    [""],
    ["IMPORTANT: do not let Excel change a long barcode into 1.23E+09."],
    ["Keep the barcode column formatted as Text. A barcode shown as 1.23E+09"],
    ["will be REJECTED on import (the real digits are already lost)."],
    [""],
    [`Your locations: ${(locations || []).map((l) => l.name).join(" | ") || "(add a location first)"}`],
  ];
  const guideFR = [
    ["COMMENT REMPLIR CE MODÈLE — remplissez la feuille 'Products'."],
    [""],
    ["Colonnes OBLIGATOIRES : name, unit, cost_price, walk_in_price, qty, location"],
    ["Colonnes FACULTATIVES : barcode, wholesale_price, min_price, slot_zone"],
    [""],
    ["name            nom du produit"],
    ["barcode         code de scan (chiffres). GARDEZ CETTE COLONNE EN TEXTE."],
    ["unit            pcs, litre, kg, carton..."],
    ["cost_price      votre prix d'achat"],
    ["walk_in_price   prix de vente normal (ce que paie un client de passage)"],
    ["wholesale_price prix pour les grossistes (facultatif)"],
    ["min_price       prix le plus bas autorisé (facultatif)"],
    ["qty             quantité en stock actuelle"],
    ["location        doit correspondre exactement à un nom de boutique/succursale"],
    ["slot_zone       étagère/zone, ex : A-01 Rayon 2 (facultatif)"],
    [""],
    ["IMPORTANT : ne laissez pas Excel transformer un long code-barres en 1.23E+09."],
    ["Gardez la colonne code-barres en Texte. Un code affiché 1.23E+09 sera"],
    ["REFUSÉ à l'import (les vrais chiffres sont déjà perdus)."],
    [""],
    [`Vos emplacements : ${(locations || []).map((l) => l.name).join(" | ") || "(ajoutez d'abord un emplacement)"}`],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(en ? guideEN : guideFR);
  wsGuide["!cols"] = [{ wch: 78 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.utils.book_append_sheet(wb, wsGuide, "Instructions");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
