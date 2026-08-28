// MP-DAMAGED-GOODS — the damaged-clearance label, as PURE functions.
//
// Regression-pass item #10 is "damaged label missing from receipts and reports".
// It was fixed once, had no automated check, and was still broken when one was
// finally written (2026-08-28).
//
// ── WHY THERE IS A PREFIX ────────────────────────────────────────────────────
// The WhatsApp monospace receipt fits the item name to FIFTEEN characters
// (receiptText.js itemLine → fitWidth(name, 15)). A SUFFIX is therefore eaten by
// truncation for any realistic product name. Measured before the fix:
//
//   "Nail"                   ( 4)  ->  "Nail (DMG)"        label intact
//   "Tyre 300-17"            (11)  ->  "Tyre 300-17 (D…"   label mangled
//   "Front Fender Bajaj"     (18)  ->  "Front Fender B…"   label GONE
//   "Tyre 300-17 cst smooth" (22)  ->  "Tyre 300-17 cs…"   label GONE
//
// The label survived only for names of 9 characters or fewer. Every product name
// in Paul's org is longer, so on that surface the label was effectively never
// shown — and the worse of the two failure modes is silent: a truncated name
// with nothing to say a marker was dropped.
//
// A PREFIX cannot be truncated away: it occupies the first column, which is the
// one place every renderer keeps. That is the whole reason for the shape.
//
// ⚠️ A bare "*" means nothing to a customer, so any surface that is too narrow to
// spell the word out MUST also print damagedLegend(). Prefix without legend is a
// marker nobody can read; that would be trading an invisible label for an
// unintelligible one.
//
// THREE SURFACES, DIFFERENT WIDTH BUDGETS, SAME MARKER:
//   · dmgName()      — on-screen receipt, A4 facture, thermal facture, and (via
//                      PaymentEventReceipt's saleReceiptOpts) the Bluetooth
//                      ESC/POS sale receipt. Room to spell it out: prefix AND
//                      the words.
//   · dmgShort()     — WhatsApp monospace body. 15-char column: prefix only,
//                      plus the legend line.
//   · escpos.js      — ticket slip. doc.wrapped() wraps rather than truncates,
//                      so it keeps "[DAMAGED]" too, with the same prefix.
// All three are asserted by scripts/receipt-damaged-check.mjs.

export const DMG_PREFIX = "*";

// Wide surfaces: marker AND words.
export function dmgName(item, en) {
  if (!item) return "";
  return item.is_damaged
    ? `${DMG_PREFIX}${item.name} (${en ? "DAMAGED GOODS" : "MARCHANDISE ENDOMMAGÉE"})`
    : item.name;
}

// Width-constrained surfaces: marker only. Takes the raw name so callers that
// already hold a string (not an item object) can use it.
export function dmgShort(name, isDamaged) {
  const n = name == null ? "" : String(name);
  return isDamaged ? `${DMG_PREFIX}${n}` : n;
}

// Printed once, under the item list, only when a damaged line is present.
// Without this the prefix is a marker with no key.
export function damagedLegend(en) {
  return en
    ? `${DMG_PREFIX} = damaged goods, sold as seen`
    : `${DMG_PREFIX} = marchandise endommagée, vendue en l'état`;
}

// True when any line in the list is a damaged-clearance line.
export function hasDamaged(items) {
  return Array.isArray(items) && items.some((i) => i && i.is_damaged);
}
