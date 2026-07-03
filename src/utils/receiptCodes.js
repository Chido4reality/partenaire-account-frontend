import QRCode from "qrcode";

// Shared receipt-code generator. QR ONLY — a QR of the sale_number for one-scan
// return lookup. The old CODE128 barcode was REMOVED: a dense CODE128 of a 16–17
// char VNT-… value did not render reliably on 58mm thermal (the ESC/POS path
// printed "wide error!" + garbage bars), while a QR of the same value scans on
// the first try and the in-app camera scanner already decodes QR. No CDN (CSP).
// Used by: POS sale receipt, Reports per-sale print, Hold Ticket.
export async function genSaleCodes(value) {
  let qr = "";
  try {
    qr = await QRCode.toDataURL(String(value || ""), { margin: 1, width: 220, errorCorrectionLevel: "M" });
  } catch { /* ignore */ }
  // `barcode` kept as "" for back-compat with any caller that still reads it —
  // the CODE128 path is intentionally gone so it can never render broken bars.
  return { qr, barcode: "" };
}
