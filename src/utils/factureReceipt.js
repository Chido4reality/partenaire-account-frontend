// MP-FACTURE-STANDARD — shared Cameroon "FACTURE" print HTML.
//
// Single source of truth for the printed sale invoice so EVERY print path is
// identical: the POS receipt (PaymentEventReceipt) and the Reports → Sales
// details print both call buildFactureHtml(). Matches the Le Soldeur paper
// invoice: centered letterhead (logo, name, slogan, address, Tél, E-mail) →
// FACTURE + N° + Date (DD-MM-YYYY) → Client → 4-col table (Qté|Désignation|
// P.U.|P. Total) → bold TOTAL → receipt_footer → "Arrêtée la présente facture…"
// → client/vendor signatures. No barcode/QR. Amounts: space thousands
// separator, no decimals (XAF has no cents).

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
export function buildFactureHtml({ org = {}, saleNumber = "", saleDate = "", customerName, items = [] }) {
  const currency = esc(org.currency || "FCFA");
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>FACTURE ${esc(saleNumber)}</title><style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0;padding:10px}
    .wrap{max-width:440px;margin:0 auto}
    .center{text-align:center}
    .name{font-weight:bold;font-size:16px}
    .slogan{font-style:italic;font-size:11px}
    .small{font-size:11px;line-height:1.4}
    .logo{max-height:70px;max-width:200px;object-fit:contain}
    .title{text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px;margin:12px 0 4px}
    .meta{font-size:12px;text-align:center}
    .client{margin:8px 0 4px;font-weight:bold}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th,td{border:1px solid #000;padding:4px 6px;font-size:11px;vertical-align:top;word-break:break-word}
    th{background:#f0f0f0}
    .c{text-align:center}.r{text-align:right}
    .total{text-align:right;font-weight:bold;font-size:15px;margin-top:8px}
    .footer{text-align:center;margin-top:12px;font-size:11px}
    .arrete{margin-top:16px;font-size:11px}
    .sign{display:flex;justify-content:space-between;margin-top:30px;font-size:11px;font-weight:bold}
    .sigcell{width:45%;border-top:1px solid #000;padding-top:4px;text-align:center}
    @media print{body{padding:0}.wrap{max-width:100%}}
  </style></head><body><div class="wrap">
    ${lh.join("")}
    <div class="title">FACTURE</div>
    <div class="meta">N°: ${esc(saleNumber)}</div>
    <div class="meta">Date: ${factureDate(saleDate)}</div>
    <div class="client">Client: ${esc(customerName || "Comptant")}</div>
    <table>
      <thead><tr><th class="c">Qté</th><th>Désignation</th><th class="r">P.U.</th><th class="r">P. Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">TOTAL: ${money(grand)} ${currency}</div>
    ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}
    <div class="arrete">Arrêtée la présente facture à la somme de : ________________________________</div>
    <div class="sign"><div class="sigcell">Signature client</div><div class="sigcell">Signature vendeur</div></div>
  </div></body></html>`;
}
