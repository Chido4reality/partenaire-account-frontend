// PRICE ORDER RULE (Peter, 2026-10-23) — the app's copy of backend src/lib/priceRules.js, for instant
// feedback BEFORE submit. The server is the real guard (it refuses every write path, the owner
// included). Keep the two in step: same order, same "0 = not set", same wording.
//
//   cost ≤ min ≤ wholesale ≤ sell        0 / empty = "not set" → skipped in the comparison.

export const PRICE_FIELDS = ["cost_price", "min_price", "wholesale_price", "sell_price"];
const LABEL = {
  cost_price:      { en: "Cost",      fr: "prix d'achat" },
  min_price:       { en: "Min",       fr: "prix minimum" },
  wholesale_price: { en: "Wholesale", fr: "prix de gros" },
  sell_price:      { en: "Walk-in",   fr: "prix détail" },   // the box says "Walk-in price" / "Prix détail"
};

/** Which prices a role may change on each screen (same table as the server's). */
export function editablePrices(role, screen) {
  if (role === "owner") return PRICE_FIELDS.slice();
  if (screen === "receive-goods") {
    if (role === "manager") return PRICE_FIELDS.slice();
    if (role === "accountant") return ["cost_price", "wholesale_price", "sell_price"];
    return ["cost_price"];
  }
  if (screen === "product-edit") return ["wholesale_price", "sell_price"];
  if (screen === "product-create") return ["cost_price", "wholesale_price", "sell_price"];
  return PRICE_FIELDS.slice();
}

export function priceValue(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The first break in the order, or null (see the backend copy for the shape). */
export function priceOrderViolation(prices) {
  const steps = PRICE_FIELDS.map((f) => ({ f, v: priceValue(prices && prices[f]) })).filter((s) => s.v > 0);
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].v < steps[i - 1].v) {
      const below = i >= 2 ? steps[i - 2] : null;
      return { field: steps[i].f, value: steps[i].v, above: steps[i - 1].f, aboveValue: steps[i - 1].v,
        below: below ? below.f : null, belowValue: below ? below.v : 0 };
    }
  }
  return null;
}

export function priceOrderMessage(viol, { fmt = (n) => String(n), newCost = false, prices = null, editable = PRICE_FIELDS } = {}) {
  const a = fmt(viol.value), b = fmt(viol.aboveValue);
  const can = (f) => editable.includes(f);
  if (newCost && viol.above === "cost_price") {
    const cost = viol.aboveValue;
    const low = PRICE_FIELDS.slice(1).filter((f) => { const v = priceValue(prices && prices[f]); return v > 0 && v < cost; });
    if (!low.length) low.push(viol.field);
    const [first, ...rest] = low;
    const restEn = rest.length ? ` (and ${rest.map((f) => LABEL[f].en).join("/")} if needed)` : "";
    const restFr = rest.length ? ` (et le ${rest.map((f) => LABEL[f].fr).join(" / ")} si besoin)` : "";
    const headEn = `New cost ${b} is above ${LABEL[first].en} ${fmt(priceValue(prices && prices[first]) || viol.value)}.`;
    const headFr = `Le nouveau prix d'achat (${b}) est supérieur au ${LABEL[first].fr} (${fmt(priceValue(prices && prices[first]) || viol.value)}).`;
    if (low.every(can)) return {
      en: `${headEn} Raise ${LABEL[first].en}${restEn} to at least ${b} in this form, then save.`,
      fr: `${headFr} Augmentez le ${LABEL[first].fr}${restFr} à au moins ${b} dans ce formulaire, puis enregistrez.`,
    };
    return {
      en: `${headEn} Ask the owner or a manager to raise ${LABEL[first].en}${restEn} to at least ${b} first, then receive again.`,
      fr: `${headFr} Demandez au propriétaire ou à un gérant d'augmenter d'abord le ${LABEL[first].fr}${restFr} à au moins ${b}, puis réceptionnez à nouveau.`,
    };
  }
  const canLower = (!viol.below || viol.value >= viol.belowValue) && can(viol.above);
  const L = LABEL[viol.field], H = LABEL[viol.above];
  const headEn = `${L.en} ${a} is below ${H.en} ${b}.`;
  const headFr = `Le ${L.fr} (${a}) est inférieur au ${H.fr} (${b}).`;
  if (can(viol.field)) return {
    en: `${headEn} Raise ${L.en} to at least ${b}${canLower ? `, or lower ${H.en} to ${a} or less` : ""}.`,
    fr: `${headFr} Augmentez le ${L.fr} à au moins ${b}${canLower ? `, ou baissez le ${H.fr} à ${a} ou moins` : ""}.`,
  };
  if (canLower) return { en: `${headEn} Lower ${H.en} to ${a} or less.`, fr: `${headFr} Baissez le ${H.fr} à ${a} ou moins.` };
  return {
    en: `${headEn} Ask the owner or a manager to raise ${L.en} to at least ${b}.`,
    fr: `${headFr} Demandez au propriétaire ou à un gérant d'augmenter le ${L.fr} à au moins ${b}.`,
  };
}

export function mergePrices(current, changes) {
  const out = {};
  for (const f of PRICE_FIELDS) out[f] = (changes && f in changes) ? changes[f] : (current ? current[f] : null);
  return out;
}

export function changedPriceFields(current, changes) {
  return PRICE_FIELDS.filter((f) => changes && f in changes && priceValue(changes[f]) !== priceValue(current && current[f]));
}

export function checkPriceWrite(current, changes) {
  if (!changedPriceFields(current, changes).length) return null;
  return priceOrderViolation(mergePrices(current, changes));
}

/** The on-screen refusal in the reader's language, or null.
 *  current = the product as stored (null for a new one): with it, only a REAL price change is
 *  checked, exactly like the server — an untouched broken product never blocks a name edit.
 *  newCost = Receive Goods / buffer release, where the cost arrives with the stock. */
export function priceOrderText(changes, { lang = "fr", fmt, current = null, newCost = false, editable = PRICE_FIELDS, always = false } = {}) {
  // always = Receive Goods / buffer release: the WHOLE price set is checked even when nothing
  // changed — stock is never received under broken prices (Edit keeps the change-only check).
  const viol = always ? priceOrderViolation(mergePrices(current, changes))
    : current ? checkPriceWrite(current, changes) : priceOrderViolation(changes);
  if (!viol) return null;
  const isNewCost = newCost && "cost_price" in (changes || {}) && priceValue(changes.cost_price) !== priceValue(current && current.cost_price);
  const m = priceOrderMessage(viol, { fmt, newCost: isNewCost, prices: mergePrices(current, changes), editable });
  return lang === "en" ? m.en : m.fr;
}
