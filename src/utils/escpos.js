// MP-BT-THERMAL — ESC/POS byte encoder for the Bluetooth thermal print path.
//
// Builds a monochrome, monospace receipt as raw ESC/POS commands from the SAME
// sale data the on-screen/A4 receipt uses (items, discount net, cashier name,
// totals). The native plugin (BluetoothPrinterPlugin) just transports these
// bytes over a Classic-Bluetooth SPP socket. Width-aware: 58mm = 32 chars,
// 80mm = 48 chars.
//
// Accents are ASCII-folded (é→e, à→a, ₦→"NGN") because cheap printers default to
// an unknown code page and would otherwise garble UTF-8 — legibility over
// typography on the paper slip. (The HTML/window.print thermal path keeps
// accents.)

import { advertLines, showDownloadQr, downloadQrCaptionLines, PLAY_STORE_URL } from "./receiptExtras";

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

function asciiFold(s) {
  return String(s == null ? "" : s)
    .replace(/₦/g, "NGN")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^\x20-\x7e]/g, "?");                   // any other non-ASCII → ?
}

function money(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");
}

// Mutable byte buffer with ESC/POS helpers.
function newDoc(widthChars) {
  const bytes = [];
  const pushStr = (s) => { const a = asciiFold(s); for (let i = 0; i < a.length; i++) bytes.push(a.charCodeAt(i) & 0xff); };
  const api = {
    bytes,
    width: widthChars,
    raw(...b) { for (const x of b) bytes.push(x & 0xff); return api; },
    init() { return api.raw(ESC, 0x40); },                // ESC @  reset
    align(a) { return api.raw(ESC, 0x61, a === "C" ? 1 : a === "R" ? 2 : 0); }, // ESC a
    bold(on) { return api.raw(ESC, 0x45, on ? 1 : 0); },  // ESC E
    feed(n) { for (let i = 0; i < (n || 1); i++) bytes.push(LF); return api; },
    text(s) { pushStr(s); return api; },
    line(s) { pushStr(s || ""); bytes.push(LF); return api; },
    // Wrap a long string to the roll width, left-aligned.
    wrapped(s) {
      const words = asciiFold(s).split(/\s+/).filter(Boolean);
      let cur = "";
      for (const w of words) {
        if (!cur.length) cur = w;
        else if ((cur + " " + w).length <= widthChars) cur += " " + w;
        else { api.line(cur); cur = w; }
        while (cur.length > widthChars) { api.line(cur.slice(0, widthChars)); cur = cur.slice(widthChars); }
      }
      if (cur.length) api.line(cur);
      return api;
    },
    // Label left, value flush right on one line (value never wraps; label trims).
    cols(left, right) {
      const r = asciiFold(right);
      let l = asciiFold(left);
      const space = widthChars - r.length;
      if (l.length > space - 1) l = l.slice(0, Math.max(0, space - 1));
      const pad = Math.max(1, widthChars - l.length - r.length);
      api.line(l + " ".repeat(pad) + r);
      return api;
    },
    rule() { api.line("-".repeat(widthChars)); return api; },
    // MP-RECEIPT-RETURN-QR: native QR (GS ( k, model 2) of the sale_number for
    // one-scan return lookup — robust on 58mm thermal where a dense CODE128 of a
    // 16–17 char VNT-… value failed ("wide error!"). QR has no HRI, so the caller
    // prints the human-readable value beneath. Module size tuned to stay crisp.
    qrCode(value, modOverride) {
      const v = asciiFold(value);
      if (!v) return api;
      const mod = modOverride || (widthChars >= 48 ? 8 : 6); // module size in dots (80mm / 58mm)
      api.align("C");
      api.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // fn65: select model 2
      api.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, mod);        // fn67: module size
      api.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);       // fn69: error correction M
      const n = v.length + 3;                                       // pL,pH = data length + 3
      api.raw(GS, 0x28, 0x6b, n & 0xff, (n >> 8) & 0xff, 0x31, 0x50, 0x30); // fn80: store data
      for (let i = 0; i < v.length; i++) bytes.push(v.charCodeAt(i) & 0xff);
      api.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);       // fn81: print stored symbol
      bytes.push(LF);
      return api;
    },
    // MP-RECEIPT-RETURN-BARCODE (Fix 1): native CODE128 (Code Set B) of the
    // DIGITS-ONLY sale_number (caller passes "202607030027", not the full VNT-…).
    // 12 digits at module width 2 ≈ 334 dots — fits 58mm and scans (the full
    // 17-char value was ~444 dots → the printer's "wide error!"). HRI off; the
    // caller prints the human-readable full number beneath. Scanner re-adds VNT-.
    barcode128(digits) {
      const v = String(digits == null ? "" : digits).replace(/[^0-9A-Za-z\-.$/+% ]/g, "");
      if (!v) return api;
      api.raw(GS, 0x68, widthChars >= 48 ? 100 : 80); // GS h  barcode height (dots)
      api.raw(GS, 0x77, 2);                            // GS w  narrow module width (2 dots)
      api.raw(GS, 0x48, 0);                            // GS H  HRI off (we print the text ourselves)
      api.align("C");
      const payload = [0x7b, 0x42];                    // "{B" = CODE128 code set B
      for (let i = 0; i < v.length; i++) payload.push(v.charCodeAt(i) & 0xff);
      api.raw(GS, 0x6b, 73, payload.length & 0xff);    // GS k 73 n  (CODE128, function-B form)
      for (const b of payload) bytes.push(b & 0xff);
      bytes.push(LF);
      return api;
    },
    cut() { return api.raw(GS, 0x56, 66, 0); }, // GS V 66 0 = feed + partial cut (ignored if no cutter)
  };
  return api;
}

function methodLabel(m, en, currency) {
  const k = String(m || "").toLowerCase();
  if (k === "cash") return en ? "Cash" : "Especes";
  // MP-PAYMENT-METHOD-LABEL: same stored 'mobile_money' bucket, labelled by
  // country — NG/NGN shows "Bank Transfer", CM/XAF shows "Mobile Money".
  if (k === "mobile_money") return String(currency || "").toUpperCase() === "NGN" ? "Bank Transfer" : "Mobile Money";
  if (k === "bank" || k === "bank_transfer") return en ? "Bank" : "Virement";
  return m || (en ? "Cash" : "Especes");
}

function ddmmyyyy(sd) {
  if (sd && /^\d{4}-\d{2}-\d{2}/.test(String(sd))) {
    const [y, m, d] = String(sd).slice(0, 10).split("-");
    return `${d}-${m}-${y}`;
  }
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// Base64 of a byte array (browser-safe; receipts are small).
function bytesToBase64(arr) {
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] & 0xff);
  return btoa(bin);
}

// Build ESC/POS bytes (Uint8Array) for a sale receipt.
export function buildSaleEscposBytes({
  org = {}, lang = "fr", widthMm = 58,
  saleNumber = "", saleDate = "", saleTime = "",
  customerName, cashierName,
  items = [], discountTotal = 0,
  paidAmount = null, balanceDue = null, paymentMethod = "",
  codeStyle = "qr", // MP-RECEIPT-CODE-STYLE: 'barcode' | 'qr' | 'both'
} = {}) {
  const en = lang === "en";
  const W = Number(widthMm) === 80 ? 48 : 32; // chars per line
  const sym = (org.currency && /ngn/i.test(org.currency)) ? "NGN" : "FCFA";

  const gross = (items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const disc = Math.max(0, Number(discountTotal) || 0);
  const total = gross - disc;
  const paid = paidAmount == null ? null : (Number(paidAmount) || 0);
  const balance = balanceDue != null ? (Number(balanceDue) || 0) : (paid == null ? null : Math.max(0, total - paid));
  const change = (paid != null && paid > total) ? (paid - total) : 0;

  const d = newDoc(W);
  d.init();
  // Header
  d.align("C").bold(true).line(org.name || "Recu").bold(false);
  if (org.slogan) d.line(org.slogan);
  const addr = [org.address, org.city, org.country].filter(Boolean).join(", ");
  if (addr) d.wrapped(addr);
  const tel = [org.phone, org.whatsapp_number].filter(Boolean).join(" / ");
  if (tel) d.line((en ? "Tel: " : "Tel: ") + tel);
  d.align("L").rule();
  // Meta
  d.cols("N", saleNumber || "-");
  d.cols("Date", ddmmyyyy(saleDate) + (saleTime ? " " + saleTime : ""));
  if (cashierName) d.cols(en ? "Served by" : "Servi par", cashierName);
  d.cols(en ? "Customer" : "Client", customerName || (en ? "Walk-in" : "Comptant"));
  d.rule();
  // Items
  for (const it of (items || [])) {
    const qty = Number(it.quantity) || 0;
    const pu = Number(it.unit_price) || 0;
    d.wrapped(it.name || "?");
    d.cols(`  ${qty} x ${money(pu)}`, money(qty * pu));
  }
  d.rule();
  // Totals
  if (disc > 0) {
    d.cols(en ? "Subtotal" : "Sous-total", `${money(gross)} ${sym}`);
    d.cols(en ? "Discount" : "Remise", `-${money(disc)} ${sym}`);
  }
  d.bold(true).cols("TOTAL", `${money(total)} ${sym}`).bold(false);
  if (paid != null) d.cols(en ? "Paid" : "Paye", `${money(paid)} ${sym}`);
  if (balance != null && balance > 0) d.bold(true).cols(en ? "Balance due" : "Reste a payer", `${money(balance)} ${sym}`).bold(false);
  if (change > 0) d.cols(en ? "Change" : "Monnaie", `${money(change)} ${sym}`);
  if (paymentMethod) d.cols(en ? "Method" : "Mode", methodLabel(paymentMethod, en, org.currency));
  d.rule();
  // Footer
  d.align("C").line(org.receipt_footer || (en ? "Thank you!" : "Merci !"));

  // MP-RECEIPT-CODE-STYLE (Fix 1): scannable return-lookup code(s) at the bottom
  // per the org's style — CODE128 (digits-only, scanner re-adds VNT-), QR (full
  // value), or both — with the human-readable full number printed beneath.
  if (saleNumber) {
    d.feed(1);
    // RESILIENCE: a code-render error must NEVER abort the receipt — the
    // human-readable number still prints so the sale can be looked up manually.
    try {
      if (codeStyle === "barcode" || codeStyle === "both") d.barcode128(String(saleNumber).replace(/\D/g, ""));
      if (codeStyle === "qr" || codeStyle === "both") d.qrCode(saleNumber);
    } catch (_) { /* code failed → keep the readable number below */ }
    d.align("C").line(saleNumber);
  }

  // MP-RECEIPT-ADVERT: text-only "Powered by Mon Partenaire" at the very bottom,
  // language by org country; ASCII-folded for cheap printers. Omitted when off.
  const adverts = advertLines(org);
  if (adverts.length) {
    d.rule();
    d.align("C");
    for (const l of adverts) d.wrapped(l);
  }

  // MP-RECEIPT-DOWNLOAD-QR: small app-download QR + caption in the advert footer
  // (same toggle as the advert), well below the return-lookup code above.
  try {
    if (showDownloadQr(org)) {
      d.align("C");
      for (const l of downloadQrCaptionLines(org)) d.wrapped(l);
      d.qrCode(PLAY_STORE_URL, W >= 48 ? 5 : 4); // smaller module → compact QR for the longer URL
    }
  } catch (_) { /* download-QR is optional advert extra — never break the receipt */ }

  d.feed(3).cut();

  return Uint8Array.from(d.bytes);
}

// Convenience: same as above but returns a base64 string for the native bridge.
export function buildSaleEscposBase64(opts) {
  return bytesToBase64(buildSaleEscposBytes(opts));
}

export { bytesToBase64 };
