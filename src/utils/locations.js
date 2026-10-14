// GOODS-BUFFER LOCATION (2026-10-15) — one place the UI recognises the org's system
// location kind === "goods_buffer" ("Goods Buffer" / "Zone tampon"). Goods land there on
// a buffer release and leave by a normal transfer. It is never a selling location and
// never a destination for receiving / opening stock. Recognised by `kind`, never by name.

export const GOODS_BUFFER = "goods_buffer";

export const isGoodsBuffer = (l) => !!l && l.kind === GOODS_BUFFER;

// A location a sale, ticket, shift, cart or expense may happen at.
export const isSellableLocation = (l) => !!l && !isGoodsBuffer(l) && l.is_active !== false;

// The buffer's stored name follows the ORG language; the label follows the USER's.
export const locationLabel = (l, lang) => {
  if (!l) return "";
  if (isGoodsBuffer(l)) return lang === "en" ? "Goods Buffer" : "Zone tampon";
  return l.name || "";
};

export const locationTypeLabel = (l, lang) => {
  if (!l) return "";
  if (isGoodsBuffer(l)) return lang === "en" ? "System" : "Système";
  return l.type || "";
};

// Locations that may RECEIVE goods directly (arrivals, opening stock, restock delivery,
// import): everything except the buffer.
export const withoutGoodsBuffer = (list) => (Array.isArray(list) ? list.filter((l) => !isGoodsBuffer(l)) : []);
