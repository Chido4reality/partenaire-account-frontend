import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

// Shared receipt-code generator (Sprint K). Code128B (sync canvas) +
// QR (async) → data URLs that print cleanly and survive CSP (no CDN).
// Set B is forced so scanners round-trip "-" as "-" (not "+").
// Used by: POS receipt, Reports per-sale print, Hold Ticket.
export async function genSaleCodes(value) {
  let barcode = "";
  try {
    const c = document.createElement("canvas");
    JsBarcode(c, value, { format: "CODE128B", width: 2, height: 44, displayValue: false, margin: 0 });
    barcode = c.toDataURL("image/png");
  } catch { /* ignore */ }
  let qr = "";
  try { qr = await QRCode.toDataURL(value, { margin: 1, width: 130 }); } catch { /* ignore */ }
  return { barcode, qr };
}
