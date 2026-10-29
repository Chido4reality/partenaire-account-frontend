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

// WAREHOUSE MODE: every stock / inventory location picker (Inventory, Count, Stock Check, Goods
// Buffer release). A virtual store keeps no stock, so it is only ever a transfer destination
// (and listed in Settings → Locations). In POS Mode the server never lists one, so this is a no-op.
export const withoutVirtualStores = (list) => (Array.isArray(list) ? list.filter((l) => !isVirtualStore(l)) : []);
// New Transfer source list: never a virtual store, and — when the server has answered
// GET /transfers/allowed-sources — only the ids it allows this user to send from. No answer
// (null: offline, older server) → today's list; the server still decides at Confirm.
export const allowedSourceLocations = (list, allowedIds) => {
  const allowed = Array.isArray(allowedIds) ? new Set(allowedIds.map(String)) : null;
  return withoutVirtualStores(list).filter((l) => !allowed || allowed.has(String(l.id)));
};

// WAREHOUSE MODE: the name of one end of a transfer ("from" | "to"). From the screen's own location
// list when it holds it; otherwise from the server's `<end>_location_info` (GET /transfers and
// /transfers/incoming) — a virtual store seen in POS Mode is named and labelled "virtual", a shop
// seen in Warehouse Mode is named. "" when neither knows it (a true external source).
export const transferEndLabel = (tr, end, list, lang) => {
  const id = tr && (end === "from" ? tr.from_location : tr.to_location);
  if (!id) return "";
  const hit = (list || []).find((l) => l.id === id);
  if (hit) return locationLabel(hit, lang);
  const info = tr[`${end}_location_info`];
  if (!info || !info.name) return "";
  if (info.kind === GOODS_BUFFER) return bufferWord(lang);
  if (info.kind === "virtual") return `${info.name} (${lang === "en" ? "virtual" : "virtuel"})`;
  return info.name;
};

// LOW-STOCK BANNER (Inventory header): the count and WHERE it was counted, in one sentence —
// "3 items below minimum at Principal Magazine" / "… — all locations" (location = null).
export const lowStockBannerText = (count, location, lang) => {
  const en = lang === "en";
  const head = `${count} ${en ? "items below minimum" : "articles sous le minimum"}`;
  if (!location) return `${head} — ${en ? "all locations" : "tous les emplacements"}`;
  return `${head} ${en ? "at" : "à"} ${locationLabel(location, lang)}`;
};
