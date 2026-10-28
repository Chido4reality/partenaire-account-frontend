// GOODS-BUFFER LOCATION (2026-10-15) — one place the UI recognises the org's system
// location kind === "goods_buffer" ("Goods Buffer" / "Zone tampon"). Goods land there on
// a buffer release and leave by a normal transfer. It is never a selling location and
// never a destination for receiving / opening stock. Recognised by `kind`, never by name.

export const GOODS_BUFFER = "goods_buffer";

export const isGoodsBuffer = (l) => !!l && l.kind === GOODS_BUFFER;

// A location a sale, ticket, shift, cart or expense may happen at.
// WAREHOUSE MODE: a VIRTUAL store (kind 'virtual') is only a transfer destination — it keeps no
// stock and nothing is sold or counted there, so it is neither sellable nor a stock location.
// (The server never lists one outside Warehouse Mode; this keeps the warehouse lists honest.)
export const isVirtualStore = (l) => !!l && l.kind === "virtual";

export const isSellableLocation = (l) => !!l && !isGoodsBuffer(l) && !isVirtualStore(l) && l.is_active !== false;

// The buffer's stored name follows the ORG language; the label follows the USER's.
// (Peter, 2026-10-16) EVERY place a location name renders goes through one of these two.
// Its two names are RESERVED for the buffer (the server refuses them for any other
// location), so text that only carries a frozen name — an approval payload's from_name,
// a ledger branch_name, a report header — is labelled exactly by the name alone.
const BUFFER_NAMES = new Set(["zone tampon", "goods buffer"]);
export const isGoodsBufferName = (name) => BUFFER_NAMES.has(String(name || "").trim().toLowerCase());
const bufferWord = (lang) => (lang === "en" ? "Goods Buffer" : "Zone tampon");

export const locationLabel = (l, lang) => {
  if (!l) return "";
  if (isGoodsBuffer(l) || isGoodsBufferName(l.name)) return bufferWord(lang);
  return l.name || "";
};

// For a NAME string with no row at hand.
export const locationNameLabel = (name, lang) => (isGoodsBufferName(name) ? bufferWord(lang) : (name || ""));

// The one-letter icon a location card shows ("Z" in English was wrong): from the label.
export const locationInitial = (l, lang) => (locationLabel(l, lang).trim().charAt(0) || "?").toUpperCase();

export const locationTypeLabel = (l, lang) => {
  if (!l) return "";
  if (isGoodsBuffer(l)) return lang === "en" ? "System" : "Système";
  if (isVirtualStore(l)) return lang === "en" ? "Virtual · keeps no stock" : "Virtuel · aucun stock";
  return l.type || "";
};

// Locations that may RECEIVE goods directly (arrivals, opening stock, restock delivery,
// import): everything except the buffer.
export const withoutGoodsBuffer = (list) => (Array.isArray(list) ? list.filter((l) => !isGoodsBuffer(l) && !isVirtualStore(l)) : []);
