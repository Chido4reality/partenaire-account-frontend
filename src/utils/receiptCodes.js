import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { saleDigits } from "./receiptCodeStyle";

// Shared receipt-code generator → data URLs (no CDN, CSP-safe). Returns BOTH:
//   barcode → CODE128 of the sale_number's DIGITS ONLY ("VNT-20260703-0027" →
//             "202607030027"). Full alphanumeric CODE128 is too wide to scan on
//             58mm thermal (the "wide error!"); 12 digits fit + stay scannable.
//             format "CODE128" auto-picks Code Set C for the digit run (narrow).
//   qr      → the FULL sale_number, scans reliably on thermal.
// The receipt prints the human-readable full number beneath either code, and the
// scanner re-adds the VNT-/dashes for a digits-only barcode scan.
// Used by: POS sale receipt, Reports per-sale print, Hold Ticket.
export async function genSaleCodes(value) {
  const digits = saleDigits(value);
  let barcode = "";
  try {
    const c = document.createElement("canvas");
    JsBarcode(c, digits || String(value || ""), { format: "CODE128", width: 2, height: 60, displayValue: false, margin: 0 });
    barcode = c.toDataURL("image/png");
  } catch { /* ignore */ }
  let qr = "";
  try { qr = await QRCode.toDataURL(String(value || ""), { margin: 1, width: 220, errorCorrectionLevel: "M" }); } catch { /* ignore */ }
  return { barcode, qr, barcodeValue: digits };
}
