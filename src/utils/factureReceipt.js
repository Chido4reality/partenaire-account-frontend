// MP-FACTURE-STANDARD — shared Cameroon "FACTURE" print HTML.
//
// Single source of truth for the printed sale invoice so EVERY print path is
// identical: the POS receipt (PaymentEventReceipt) and the Reports → Sales
// details print both call buildFactureHtml(). Matches the Le Soldeur paper
// invoice: centered letterhead (logo, name, slogan, address, Tél, E-mail) →
// FACTURE + N° + Date (DD-MM-YYYY) → Client → 4-col table (Qté|Désignation|
// P.U.|P. Total) → bold TOTAL → receipt_footer → "Arrêtée la présente facture…"
// → client/vendor signatures. No barcode/QR. Amounts: space thousands
// separator, no decimals.
//
// build 10:
//  • FORCED black-on-white (background:#fff / color:#000 !important + color-scheme
//    light) on screen AND in print, so the facture never inherits the app's dark
//    theme inside the WebView.
//  • A .no-print action bar (Imprimer / Partager / Fermer) that stays on screen
//    and is hidden from the printout via @media print { .no-print{display:none} }.
//  • Currency symbol comes from the org's currency field (XAF -> FCFA) via the
//    currency helper; action labels come from the i18n dictionary.
import { currencySymbol } from "./currency";
import { t } from "./i18n";
import { advertLines } from "./receiptExtras";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function money(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");
}
function factureDate(sd) {
  if (sd && /^\d{4}-\d{2}-\d{2}/.test(sd)) { const [y, m, d] = String(sd).slice(0, 10).split("-"); return `${d}-${m}-${y}`; }
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// org: { logo_url, name, slogan, address, city, country, phone, whatsapp_number,
//        email, currency, receipt_footer }  (empty fields are skipped)
// items: [{ name, quantity, unit_price }]   (debt lines: pass quantity 1, unit_price = amount)
export function buildFactureHtml({ org = {}, lang = "fr", saleNumber = "", saleDate = "", customerName, cashierName, items = [], discountTotal = 0, barcodeDataUrl = "" }) {
  const currency = esc(currencySymbol(org.currency));   // XAF -> FCFA, etc.
  const footer = org.receipt_footer || "";

  const lh = [];
  if (org.logo_url) lh.push(`<div class="center"><img class="logo" src="${esc(org.logo_url)}"/></div>`);
  if (org.name)     lh.push(`<div class="center name">${esc(org.name)}</div>`);
  if (org.slogan)   lh.push(`<div class="center slogan">${esc(org.slogan)}</div>`);
  const addr = [org.address, org.city, org.country].filter(Boolean).map(esc).join(", ");
  if (addr)         lh.push(`<div class="center small">${addr}</div>`);
  const tel = [org.phone, org.whatsapp_number].filter(Boolean).map(esc).join(" / ");
  if (tel)          lh.push(`<div class="center small">Tél: ${tel}</div>`);
  if (org.email)    lh.push(`<div class="center small">E-mail: ${esc(org.email)}</div>`);

  let grand = 0;
  const rows = (items || []).map((i) => {
    const qty = Number(i.quantity) || 0;
    const pu = Number(i.unit_price) || 0;
    const lt = qty * pu;
    grand += lt;
    return `<tr><td class="c">${qty}</td><td>${esc(i.name)}</td><td class="r">${money(pu)}</td><td class="r">${money(lt)}</td></tr>`;
  }).join("");

  // Action-bar labels via the i18n dictionary (default FR).
  const printLbl = esc(t("print", lang));
  const shareLbl = esc(t("share", lang));
  const closeLbl = esc(t("close", lang));
  const shareText = `FACTURE ${saleNumber}${org.name ? " — " + org.name : ""} — ${money(grand)} ${currencySymbol(org.currency)}`;

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>FACTURE ${esc(saleNumber)}</title><style>
    :root{color-scheme:light}
    /* FORCE black-on-white so the facture never inherits the app's dark theme */
    html,body{background:#fff !important;color:#000 !important}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;margin:0;padding:0}
    .wrap{max-width:440px;margin:0 auto;padding:10px;color:#000;background:#fff}
    .center{text-align:center}
    .name{font-weight:bold;font-size:16px}
    .slogan{font-style:italic;font-size:11px}
    .small{font-size:11px;line-height:1.4}
    .logo{max-height:70px;max-width:200px;object-fit:contain}
    .title{text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px;margin:12px 0 4px}
    .meta{font-size:12px;text-align:center}
    .client{margin:8px 0 4px;font-weight:bold}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th,td{border:1px solid #000;padding:4px 6px;font-size:11px;vertical-align:top;word-break:break-word;color:#000}
    th{background:#f0f0f0}
    .c{text-align:center}.r{text-align:right}
    .total{text-align:right;font-weight:bold;font-size:15px;margin-top:8px}
    .footer{text-align:center;margin-top:12px;font-size:11px}
    .arrete{margin-top:16px;font-size:11px}
    .sign{display:flex;justify-content:space-between;margin-top:30px;font-size:11px;font-weight:bold}
    .sigcell{width:45%;border-top:1px solid #000;padding-top:4px;text-align:center}
    /* On-screen action bar — hidden from the printout */
    .actions{position:sticky;top:0;z-index:10;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;
      padding:10px;background:#fff;border-bottom:1px solid #ccc}
    .actions button{padding:10px 16px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}
    .btn-print{border:none;background:#152B52;color:#fff}
    .btn-share{border:1px solid #152B52;background:#fff;color:#152B52}
    .btn-close{border:1px solid #999;background:#fff;color:#333}
    @media print{
      .no-print{display:none !important}
      html,body{background:#fff !important;color:#000 !important}
      .wrap{max-width:100%;padding:0}
      body{padding:0}
    }
  </style></head><body>
    <div class="actions no-print">
      <button class="btn-print" onclick="window.print()">🖨️ ${printLbl}</button>
      <button class="btn-share" onclick="_shareFacture()">🔗 ${shareLbl}</button>
      <button class="btn-close" onclick="window.close()">✕ ${closeLbl}</button>
    </div>
    <div class="wrap">
    ${lh.join("")}
    <div class="title">FACTURE</div>
    <div class="meta">N°: ${esc(saleNumber)}</div>
    <div class="meta">Date: ${factureDate(saleDate)}</div>
    <div class="client">Client: ${esc(customerName || "Comptant")}</div>
    ${cashierName ? `<div class="client" style="font-weight:normal">${lang === "en" ? "Served by" : "Servi par"}: ${esc(cashierName)}</div>` : ""}
    <table>
      <thead><tr><th class="c">Qté</th><th>Désignation</th><th class="r">P.U.</th><th class="r">P. Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${Number(discountTotal) > 0
      ? `<div class="total" style="font-weight:normal;font-size:12px">${lang === "en" ? "Subtotal" : "Sous-total"}: ${money(grand)} ${currency}</div>
         <div class="total" style="font-weight:normal;font-size:12px">${lang === "en" ? "Discount" : "Remise"}: −${money(discountTotal)} ${currency}</div>
         <div class="total">TOTAL: ${money(grand - Number(discountTotal))} ${currency}</div>`
      : `<div class="total">TOTAL: ${money(grand)} ${currency}</div>`}
    ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}
    <div class="arrete">Arrêtée la présente facture à la somme de : ________________________________</div>
    <div class="sign"><div class="sigcell">Signature client</div><div class="sigcell">Signature vendeur</div></div>
    ${(barcodeDataUrl && saleNumber) ? `<div class="center" style="margin-top:14px">
        <img src="${barcodeDataUrl}" alt="barcode" style="height:14mm;max-width:70%;object-fit:fill"/>
        <div class="center" style="font-family:monospace;font-weight:bold;font-size:13px;letter-spacing:1px">${esc(saleNumber)}</div>
      </div>` : ""}
    ${advertLines(org).length ? `<div class="center small" style="margin-top:10px">${advertLines(org).map(l => `<div>${esc(l)}</div>`).join("")}</div>` : ""}
    </div>
    <script>
      function _shareFacture(){
        var txt=${JSON.stringify(shareText)};
        try{ if(navigator.share){ navigator.share({title:"FACTURE ${esc(saleNumber)}", text:txt}); return; } }catch(e){}
        try{ window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank'); }catch(e){}
      }
    </script>
  </body></html>`;
}

// MP-RECEIPT-PRINT-CLOSE-FIX: INNER facture markup (no <html>/<head>/<body>,
// no action bar, no <script>, no window.close button) for rendering INSIDE the
// app via an in-app print overlay instead of a separate window.open() window.
// window.open()-spawned windows can't be reliably closed on Android WebView
// (window.close() is a no-op), which left an uncloseable layer over the app.
// All styles are scoped under .mp-fac so nothing leaks to the host app.
export function buildFactureInner({ org = {}, lang = "fr", saleNumber = "", saleDate = "", customerName, cashierName, items = [], discountTotal = 0, barcodeDataUrl = "" }) {
  const currency = esc(currencySymbol(org.currency));
  const footer = org.receipt_footer || "";

  const lh = [];
  if (org.logo_url) lh.push(`<div class="center"><img class="logo" src="${esc(org.logo_url)}"/></div>`);
  if (org.name)     lh.push(`<div class="center name">${esc(org.name)}</div>`);
  if (org.slogan)   lh.push(`<div class="center slogan">${esc(org.slogan)}</div>`);
  const addr = [org.address, org.city, org.country].filter(Boolean).map(esc).join(", ");
  if (addr)         lh.push(`<div class="center small">${addr}</div>`);
  const tel = [org.phone, org.whatsapp_number].filter(Boolean).map(esc).join(" / ");
  if (tel)          lh.push(`<div class="center small">Tél: ${tel}</div>`);
  if (org.email)    lh.push(`<div class="center small">E-mail: ${esc(org.email)}</div>`);

  let grand = 0;
  const rows = (items || []).map((i) => {
    const qty = Number(i.quantity) || 0;
    const pu = Number(i.unit_price) || 0;
    const lt = qty * pu;
    grand += lt;
    return `<tr><td class="c">${qty}</td><td>${esc(i.name)}</td><td class="r">${money(pu)}</td><td class="r">${money(lt)}</td></tr>`;
  }).join("");

  return `<style>
    .mp-fac, .mp-fac *{box-sizing:border-box;color:#000}
    .mp-fac{font-family:Arial,Helvetica,sans-serif;font-size:12px;background:#fff;max-width:440px;margin:0 auto;padding:10px}
    .mp-fac .center{text-align:center}
    .mp-fac .name{font-weight:bold;font-size:16px}
    .mp-fac .slogan{font-style:italic;font-size:11px}
    .mp-fac .small{font-size:11px;line-height:1.4}
    .mp-fac .logo{max-height:70px;max-width:200px;object-fit:contain}
    .mp-fac .title{text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px;margin:12px 0 4px}
    .mp-fac .meta{font-size:12px;text-align:center}
    .mp-fac .client{margin:8px 0 4px;font-weight:bold}
    .mp-fac table{width:100%;border-collapse:collapse;margin-top:6px}
    .mp-fac th,.mp-fac td{border:1px solid #000;padding:4px 6px;font-size:11px;vertical-align:top;word-break:break-word}
    .mp-fac th{background:#f0f0f0}
    .mp-fac .c{text-align:center}.mp-fac .r{text-align:right}
    .mp-fac .total{text-align:right;font-weight:bold;font-size:15px;margin-top:8px}
    .mp-fac .footer{text-align:center;margin-top:12px;font-size:11px}
    .mp-fac .arrete{margin-top:16px;font-size:11px}
    .mp-fac .sign{display:flex;justify-content:space-between;margin-top:30px;font-size:11px;font-weight:bold}
    .mp-fac .sigcell{width:45%;border-top:1px solid #000;padding-top:4px;text-align:center}
  </style>
  <div class="mp-fac">
    ${lh.join("")}
    <div class="title">FACTURE</div>
    <div class="meta">N°: ${esc(saleNumber)}</div>
    <div class="meta">Date: ${factureDate(saleDate)}</div>
    <div class="client">Client: ${esc(customerName || "Comptant")}</div>
    ${cashierName ? `<div class="client" style="font-weight:normal">${lang === "en" ? "Served by" : "Servi par"}: ${esc(cashierName)}</div>` : ""}
    <table>
      <thead><tr><th class="c">Qté</th><th>Désignation</th><th class="r">P.U.</th><th class="r">P. Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${Number(discountTotal) > 0
      ? `<div class="total" style="font-weight:normal;font-size:12px">${lang === "en" ? "Subtotal" : "Sous-total"}: ${money(grand)} ${currency}</div>
         <div class="total" style="font-weight:normal;font-size:12px">${lang === "en" ? "Discount" : "Remise"}: −${money(discountTotal)} ${currency}</div>
         <div class="total">TOTAL: ${money(grand - Number(discountTotal))} ${currency}</div>`
      : `<div class="total">TOTAL: ${money(grand)} ${currency}</div>`}
    ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}
    <div class="arrete">Arrêtée la présente facture à la somme de : ________________________________</div>
    <div class="sign"><div class="sigcell">Signature client</div><div class="sigcell">Signature vendeur</div></div>
    ${(barcodeDataUrl && saleNumber) ? `<div class="center" style="margin-top:14px">
        <img src="${barcodeDataUrl}" alt="barcode" style="height:14mm;max-width:70%;object-fit:fill"/>
        <div class="center" style="font-family:monospace;font-weight:bold;font-size:13px;letter-spacing:1px">${esc(saleNumber)}</div>
      </div>` : ""}
    ${advertLines(org).length ? `<div class="center small" style="margin-top:10px">${advertLines(org).map(l => `<div>${esc(l)}</div>`).join("")}</div>` : ""}
  </div>`;
}

// MP-THERMAL-RECEIPT — narrow single-column receipt for 58mm / 80mm thermal
// rolls. Monospace, monochrome, no tables/borders/backgrounds (thermal printers
// can't render those). Reuses the SAME sale data as the A4 facture (incl. the
// discount net fields + cashier name). Printed via window.print() on the
// in-app overlay; @page size narrows the print dialog's paper.
//
// params:
//   org, lang, widthMm (58|80),
//   saleNumber, saleDate, saleTime, customerName, cashierName,
//   items: [{name, quantity, unit_price}],
//   discountTotal, paidAmount, balanceDue, paymentMethod, paymentStatus
export function buildThermalReceipt({
  org = {}, lang = "fr", widthMm = 58,
  saleNumber = "", saleDate = "", saleTime = "",
  customerName, cashierName,
  items = [], discountTotal = 0,
  paidAmount = null, balanceDue = null, paymentMethod = "", paymentStatus = "",
  barcodeDataUrl = "", // MP-RECEIPT-RETURN-BARCODE: CODE128 PNG of saleNumber
} = {}) {
  const en = lang === "en";
  const W = (Number(widthMm) === 80) ? 80 : 58;
  const fontPx = W === 80 ? 12 : 11;
  const currency = esc(currencySymbol(org.currency));

  const gross = (items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const disc = Math.max(0, Number(discountTotal) || 0);
  const total = gross - disc;
  const paid = paidAmount == null ? null : (Number(paidAmount) || 0);
  const balance = balanceDue != null ? (Number(balanceDue) || 0) : (paid == null ? null : Math.max(0, total - paid));
  const change = (paid != null && paid > total) ? (paid - total) : 0;

  const methodLabel = (m) => {
    const k = String(m || "").toLowerCase();
    if (k === "cash")          return en ? "Cash" : "Espèces";
    if (k === "mobile_money")  return "Mobile Money";
    if (k === "bank" || k === "bank_transfer") return en ? "Bank" : "Virement";
    return m || (en ? "Cash" : "Espèces");
  };

  // Header (skip empty fields).
  const head = [];
  if (org.name)   head.push(`<div class="ctr b big">${esc(org.name)}</div>`);
  if (org.slogan) head.push(`<div class="ctr sm">${esc(org.slogan)}</div>`);
  const addr = [org.address, org.city, org.country].filter(Boolean).map(esc).join(", ");
  if (addr)       head.push(`<div class="ctr sm">${addr}</div>`);
  const tel = [org.phone, org.whatsapp_number].filter(Boolean).map(esc).join(" / ");
  if (tel)        head.push(`<div class="ctr sm">${en ? "Tel" : "Tél"}: ${tel}</div>`);

  const meta = [];
  meta.push(`<div class="row sm"><span>N°</span><span class="r">${esc(saleNumber || "—")}</span></div>`);
  meta.push(`<div class="row sm"><span>Date</span><span class="r">${factureDate(saleDate)}${saleTime ? " " + esc(saleTime) : ""}</span></div>`);
  if (cashierName)  meta.push(`<div class="row sm"><span>${en ? "Served by" : "Servi par"}</span><span class="r">${esc(cashierName)}</span></div>`);
  meta.push(`<div class="row sm"><span>${en ? "Customer" : "Client"}</span><span class="r">${esc(customerName || (en ? "Walk-in" : "Comptant"))}</span></div>`);

  const lines = (items || []).map((i) => {
    const qty = Number(i.quantity) || 0;
    const pu = Number(i.unit_price) || 0;
    return `<div class="it"><div class="nm">${esc(i.name || "?")}</div>`
      + `<div class="row sm"><span>${qty} × ${money(pu)}</span><span class="r">${money(qty * pu)}</span></div></div>`;
  }).join("");

  const totals = [];
  if (disc > 0) {
    totals.push(`<div class="row sm"><span>${en ? "Subtotal" : "Sous-total"}</span><span class="r">${money(gross)} ${currency}</span></div>`);
    totals.push(`<div class="row sm"><span>${en ? "Discount" : "Remise"}</span><span class="r">−${money(disc)} ${currency}</span></div>`);
  }
  totals.push(`<div class="row b big"><span>TOTAL</span><span class="r">${money(total)} ${currency}</span></div>`);
  if (paid != null) totals.push(`<div class="row"><span>${en ? "Paid" : "Payé"}</span><span class="r">${money(paid)} ${currency}</span></div>`);
  if (balance != null && balance > 0) totals.push(`<div class="row b"><span>${en ? "Balance due" : "Reste à payer"}</span><span class="r">${money(balance)} ${currency}</span></div>`);
  if (change > 0) totals.push(`<div class="row"><span>${en ? "Change" : "Monnaie"}</span><span class="r">${money(change)} ${currency}</span></div>`);
  if (paymentMethod) totals.push(`<div class="row sm"><span>${en ? "Method" : "Mode"}</span><span class="r">${esc(methodLabel(paymentMethod))}</span></div>`);

  const footer = org.receipt_footer || (en ? "Thank you!" : "Merci !");

  // MP-RECEIPT-RETURN-BARCODE: scannable CODE128 of the sale_number at the bottom
  // (for one-scan return lookup) + the number in readable text beneath as a
  // manual fallback. Height ~12–14mm so it stays scannable on 58mm thermal.
  const bcH = W === 80 ? 14 : 12;
  const barcodeBlock = (barcodeDataUrl && saleNumber)
    ? `<hr>
       <div class="ctr" style="margin-top:2px">
         <img src="${barcodeDataUrl}" alt="barcode" style="width:92%;height:${bcH}mm;object-fit:fill"/>
         <div class="ctr b" style="font-family:'Courier New',monospace;font-size:${fontPx}px;letter-spacing:1px;margin-top:1px">${esc(saleNumber)}</div>
       </div>`
    : "";

  // MP-RECEIPT-ADVERT: text-only "Powered by Mon Partenaire" at the very bottom,
  // language by org country; wraps within the roll width. Omitted when toggled off.
  const adverts = advertLines(org);
  const advertBlock = adverts.length
    ? `<hr>
       <div class="ctr sm" style="margin-top:2px">${adverts.map(l => `<div>${esc(l)}</div>`).join("")}</div>`
    : "";

  return `<style>
    @page { size: ${W}mm auto; margin: 2mm; }
    .mp-th, .mp-th * { color:#000 !important; background:#fff !important; box-sizing:border-box; -webkit-print-color-adjust:exact; }
    .mp-th { font-family:'Courier New',ui-monospace,monospace; width:${W}mm; max-width:${W}mm; margin:0 auto; padding:2mm; font-size:${fontPx}px; line-height:1.35; }
    .mp-th .ctr{ text-align:center; }
    .mp-th .b{ font-weight:bold; }
    .mp-th .big{ font-size:${fontPx + 2}px; }
    .mp-th .sm{ font-size:${fontPx - 1}px; }
    .mp-th hr{ border:none; border-top:1px dashed #000; margin:4px 0; }
    .mp-th .row{ display:flex; justify-content:space-between; gap:6px; align-items:baseline; }
    .mp-th .row .r{ text-align:right; white-space:nowrap; }
    .mp-th .nm{ word-break:break-word; overflow-wrap:anywhere; }
    .mp-th .it{ margin:2px 0; }
  </style>
  <div class="mp-th">
    ${head.join("")}
    <hr>
    ${meta.join("")}
    <hr>
    ${lines || `<div class="sm ctr">—</div>`}
    <hr>
    ${totals.join("")}
    <hr>
    <div class="ctr sm">${esc(footer)}</div>
    ${barcodeBlock}
    ${advertBlock}
  </div>`;
}
