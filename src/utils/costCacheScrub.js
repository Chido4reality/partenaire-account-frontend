// WHO SEES COST (Peter, 2026-10-08) — no stale cost left on a phone.
//
// Since 2026-10-08 the server never sends cost to anyone but the owner and a manager
// with the stock-value grant. But a device that cached product data BEFORE that still
// holds cost_price in localStorage (the POS product cache "cache_pos-products-v2-*",
// other "cache_*" entries, and the draft cart, whose line whitelist keeps cost_price).
//
// At app start and after every sign-in, for anyone but the owner, every such entry
// is REWRITTEN without its cost fields — not deleted, so a phone that starts offline
// right after the update keeps a working POS. A granted manager is scrubbed too
// (the app can't know the grant before the first online call); harmless — the next
// online read brings his cost back, because the server decides.
const COST_KEYS = new Set([
  "cost_price", "unit_cost", "total_cost", "gross_profit", "net_profit", "profit_margin_pct",
  "loss_value", "estimated_cost", "value_held", "value_missing", "damaged_cost", "damaged_margin",
]);
const SCRUB_PREFIXES = ["cache_"];
const SCRUB_KEYS = ["mp-pos-draft-cart"];

export function stripCostDeep(v) {
  if (Array.isArray(v)) return v.map(stripCostDeep);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!COST_KEYS.has(k)) out[k] = stripCostDeep(x);
  return out;
}

const mentionsCost = (raw) => [...COST_KEYS].some((k) => raw.includes(`"${k}"`));

/** Returns how many stored entries were rewritten (or removed when unreadable). */
export function scrubCachedCost(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) return 0;
  let n = 0;
  const keys = [];
  try { for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)); } catch { return 0; }
  for (const k of keys) {
    if (!k || !(SCRUB_KEYS.includes(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p)))) continue;
    let raw; try { raw = storage.getItem(k); } catch { continue; }
    if (!raw || !mentionsCost(raw)) continue;
    try { storage.setItem(k, JSON.stringify(stripCostDeep(JSON.parse(raw)))); }
    catch { try { storage.removeItem(k); } catch { /* storage unavailable */ } }   // unreadable → gone
    n++;
  }
  return n;
}

/** The app-level rule: everyone but the owner gets their device scrubbed. */
export function shouldScrubCost(user) {
  return !!user && user.role !== "owner";
}
