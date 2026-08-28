// MP-DAMAGED-GOODS — the damaged-clearance label, as a PURE function.
//
// Regression-pass item #10 is "damaged label missing from receipts and reports".
// It was fixed once and had no automated check, because the label lived as a
// local const inside PaymentEventReceipt — and a helper closed over a
// component's scope cannot be asserted without rendering the component, which
// under renderToString does not reach the print paths at all.
//
// Extracted here for the same reason utils/approvalReasons was extracted: pull
// the pure part out so a test can hold it. See scripts/receipt-damaged-check.mjs.
//
// THREE SURFACES CARRY THIS LABEL AND THEY DO NOT AGREE ON WORDING — deliberately,
// because each has a different width budget:
//   · this one          — "(DAMAGED GOODS)" / "(MARCHANDISE ENDOMMAGÉE)"
//                          on-screen receipt, A4 facture, thermal facture
//   · receiptText.js    — "(DMG)" / "(ABÎMÉ)"      WhatsApp monospace body
//   · escpos.js         — " [DAMAGED]" / " [ABIME]" Bluetooth ESC/POS slip
// The check script asserts all three, so "fixed on one surface" can never again
// read as fixed everywhere.

export function dmgName(item, en) {
  if (!item) return "";
  return item.is_damaged
    ? `${item.name} (${en ? "DAMAGED GOODS" : "MARCHANDISE ENDOMMAGÉE"})`
    : item.name;
}
