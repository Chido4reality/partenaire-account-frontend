// BAR LAYOUT (Peter 2026-11-18) — the pure rules behind the /bar screen, kept apart from the JSX so
// scripts/bar-layout-check.mjs can test them directly.
//
// VIEW: what the right side shows.
//   { barId, view: "home" }                 counter sale (the POS cart)
//   { barId, view: "table", tableId }       a table — its CURRENT bill is read from the floor, so a
//                                           paid table simply shows as free again (Open tab)
//   { barId, view: "named", tabId }         a named counter tab
// RULE (the branch-switch bug found in testing): changing branch ALWAYS returns to Home of the new
// branch — nothing from the old branch stays on screen, so a round can never land on the wrong bar.

export const HOME = "home";

export function barViewReducer(state, action) {
  switch (action.type) {
    case "branch":
      // a different branch → its Home; the same branch → unchanged
      if (state && state.barId === action.barId) return state;
      return { barId: action.barId || null, view: HOME };
    case "home":
      return { barId: state?.barId || null, view: HOME };
    case "table":
      if (!action.tableId || !state?.barId) return state;
      return { barId: state.barId, view: "table", tableId: action.tableId };
    case "named":
      if (!action.tabId || !state?.barId) return state;
      return { barId: state.barId, view: "named", tabId: action.tabId };
    case "floor": {
      // the floor of THIS branch was (re)loaded: a table or named tab that is no longer there → Home
      const f = action.floor;
      if (!state || !f || action.barId !== state.barId) return state;
      if (state.view === "table" && !(f.tables || []).some((t) => t.id === state.tableId)) return { barId: state.barId, view: HOME };
      if (state.view === "named" && !(f.named_tabs || []).some((t) => t.id === state.tabId)) return { barId: state.barId, view: HOME };
      return state;
    }
    default:
      return state;
  }
}

// The bill shown on the right: a table's current tab from the floor, or the named tab; null at Home
// or on a free table.
export function currentTabId(state, floor) {
  if (!state || !floor) return null;
  if (state.view === "table") return (floor.tables || []).find((t) => t.id === state.tableId)?.tab?.id || null;
  if (state.view === "named") return (floor.named_tabs || []).some((t) => t.id === state.tabId) ? state.tabId : null;
  return null;
}

// A tab's panel may only render on its own branch (second guard, behind the reducer).
export const tabBelongsToBar = (tab, barId) => !!tab && !!barId && String(tab.location_id) === String(barId);

// Drafts are kept per (person × branch × tab). Home uses the POS cart's own store (per person × branch).
export const draftKey = (userId, barId, tabId) => (userId && barId && tabId ? `${userId}::${barId}::${tabId}` : null);

// GRID ORDER stays still while an order is being entered: a fresh ranking is taken only when the
// current view's cart / draft is EMPTY. A product no longer sellable here drops out; new ones never
// jump in mid-order.
export function stableOrder(prevOrder, freshIds, busy) {
  const fresh = Array.isArray(freshIds) ? freshIds : [];
  if (busy && Array.isArray(prevOrder) && prevOrder.length) return prevOrder;
  return fresh;
}

// The grid's products, in order: ids from /bar/:id/quick-items, details from the POS product list
// (price, stock, photo, category). Ids the POS list does not know (not sold here, inactive) are skipped.
export function gridProducts(orderIds, products, limit = 12) {
  const byId = new Map((products || []).map((p) => [p.id, p]));
  const out = [];
  for (const id of orderIds || []) { const p = byId.get(id); if (p && p.is_multipart !== true) out.push(p); if (out.length >= limit) break; }
  return out;
}

// BOX COLOUR — stable per product: the category's own colour when it is a usable hex, else a colour
// fixed by the product id, so a product keeps its colour every day.
export const BOX_PALETTE = ["#1d4ed8", "#0f766e", "#b45309", "#6d28d9", "#3730a3", "#15803d", "#be185d", "#0e7490"];
const HEX = /^#([0-9a-f]{6})$/i;
const hash = (s) => { let h = 2166136261; for (const c of String(s || "")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// white text must stay readable: a category colour lighter than this is replaced by the palette
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
export function productColor(p) {
  const c = p?.pa_categories?.color;
  if (typeof c === "string" && HEX.test(c.trim()) && luminance(c.trim()) <= 0.18) return c.trim();
  return BOX_PALETTE[hash(p?.id) % BOX_PALETTE.length];
}

// PICTURE — the product's OWN photo from inventory (photo_url, then the older image_url); else an
// icon: the category's own icon when it has one, else a neutral bottle / glass / plate chosen from
// the category name. Never a bundled or downloaded brand image.
export function productPhoto(p) {
  for (const u of [p?.photo_url, p?.image_url]) if (typeof u === "string" && /^https:\/\//i.test(u.trim())) return u.trim();
  return null;
}
const GLASS = /(whisk|vodka|gin|rhum|rum|liqu|spirit|vin\b|wine|cocktail|shot|alcool)/i;
const PLATE = /(food|plat|grill|poulet|chicken|poisson|fish|brochette|snack|cuisine|repas|meal|plantain|frite|chips|soya)/i;
export function productIconKind(p) {
  const n = `${p?.pa_categories?.name || ""} ${p?.pa_categories?.name_en || ""}`;
  return GLASS.test(n) ? "glass" : PLATE.test(n) ? "plate" : "bottle";
}
export const categoryIcon = (p) => { const i = p?.pa_categories?.icon; return typeof i === "string" && i.trim() && i.trim().length <= 4 ? i.trim() : null; };
