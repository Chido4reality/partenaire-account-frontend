// MP-RECEIPT-CODE-STYLE (Fix 1) — per-org choice of the printed return-lookup
// code. Column pa_organisations.receipt_code_style ∈ auto|barcode|qr|both.
//   auto → by currency: NGN shops use 1D laser scanners that can't read QR, so
//          they get the horizontal CODE128 barcode; everyone else (XAF/CM…) gets
//          the QR, which scans reliably on 58mm thermal.
//   barcode | qr | both → use exactly that.
export function resolveCodeStyle(org) {
  const s = String((org && org.receipt_code_style) || "auto").toLowerCase();
  if (s === "barcode" || s === "qr" || s === "both") return s;
  const cur = String((org && org.currency) || "").toUpperCase();
  return cur === "NGN" ? "barcode" : "qr";
}

// The CODE128 on 58mm thermal encodes the DIGITS ONLY of the sale_number
// ("VNT-20260703-0027" → "202607030027"): the full alphanumeric value is too
// wide/dense to scan on 58mm (the "wide error!"), while 12 digits fit and stay
// scannable. The QR still carries the full value. The human-readable full number
// prints beneath. The scanner re-adds the VNT-/dashes (normalizeScannedSaleRef).
export function saleDigits(saleNumber) {
  return String(saleNumber || "").replace(/\D/g, "");
}

// Turn a scanned/typed value back into a full sale_number for lookup:
//  - already-prefixed refs (VNT-/DOZ-/HLD-/QOF- from QR or manual entry) pass through,
//  - a bare 12+ digit string (a CODE128 barcode scan) → "VNT-YYYYMMDD-####".
export function normalizeScannedSaleRef(raw) {
  const v = String(raw || "").trim();
  if (!v) return v;
  if (/^[a-z]{2,}-/i.test(v)) return v.toUpperCase();      // has a XXX- prefix already
  const d = v.replace(/\D/g, "");
  if (d.length >= 12) return "VNT-" + d.slice(0, 8) + "-" + d.slice(8); // digits-only barcode
  return v;                                                 // leave anything else untouched
}
