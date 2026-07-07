// MP-TRANSFER-WAYBILL — A4 delivery note / bon de livraison for a DISPATCHED
// transfer. Shown to police at checkpoints during inter-location transport and for
// the carrier to sign. One dispatcher signature line (receiver acceptance lives in
// the digital confirm). Reprintable anytime after dispatch.
//
// PRINT INFRA NOTE: MP has no PDF library and its A4 facture "print" relies on
// window.print(), which is a no-op/freeze in the Capacitor Android WebView — so
// there is no existing path that yields a real, WhatsApp-shareable PDF *file* on
// Android. This module therefore builds the PDF with jsPDF, DYNAMICALLY IMPORTED so
// it is a separate chunk: zero cost to the main bundle and never loaded for non-Pro
// users or until a boss actually opens a waybill.
//
// Data source: pa_stock_transfers + pa_transfer_items + the org record — NO schema.
// Bilingual FR/EN labels are printed inline on the single document.

// Fetch a remote image (org logo) as a data URL for jsPDF.addImage. Best-effort:
// a failed/blocked logo just omits it — never blocks the waybill.
async function loadImageDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

function fmtDateTime(iso, en) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(en ? "en-GB" : "fr-FR",
      { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(iso); }
}

// Build the A4 waybill and hand it to the OS: native → cache file + share sheet
// (WhatsApp / print / save); web → download. Returns { ok, native }.
export async function openWaybill({ org = {}, lang = "fr", transfer = {}, fromName = "", toName = "" }) {
  const en = lang === "en";
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PAGE_W = 210, PAGE_H = 297, M = 15;
  const CW = PAGE_W - M * 2;
  let y = 16;

  // ── Letterhead ────────────────────────────────────────────────────────────
  if (org.logo_url) {
    const logo = await loadImageDataUrl(org.logo_url);
    if (logo) {
      try {
        const fmt = /png/i.test(logo.slice(0, 30)) ? "PNG" : "JPEG";
        doc.addImage(logo, fmt, PAGE_W / 2 - 14, y, 28, 18, undefined, "FAST");
        y += 20;
      } catch { /* bad image → skip */ }
    }
  }
  if (org.name) {
    doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(0);
    doc.text(String(org.name), PAGE_W / 2, y, { align: "center" }); y += 6;
  }
  const addr = [org.address, org.city, org.country].filter(Boolean).join(", ");
  const tel = [org.phone, org.whatsapp_number].filter(Boolean).join(" / ");
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60);
  if (addr) { doc.text(addr, PAGE_W / 2, y, { align: "center" }); y += 4; }
  if (tel)  { doc.text((en ? "Tel: " : "Tél: ") + tel, PAGE_W / 2, y, { align: "center" }); y += 4; }

  y += 3;
  doc.setDrawColor(0).setLineWidth(0.3).line(M, y, PAGE_W - M, y); y += 8;

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFillColor(240).rect(M, y - 6, CW, 10, "F");
  doc.setDrawColor(0).setLineWidth(0.3).rect(M, y - 6, CW, 10);
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(0);
  doc.text("WAYBILL / BON DE LIVRAISON", PAGE_W / 2, y + 1, { align: "center" });
  y += 12;

  // ── Meta (bilingual labels) ────────────────────────────────────────────────
  const meta = (labelEn, labelFr, value) => {
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0);
    const label = `${labelEn} / ${labelFr}: `;
    doc.text(label, M, y);
    const lw = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal");
    doc.text(String(value == null || value === "" ? "—" : value), M + lw, y);
    y += 6;
  };
  meta("Transfer No", "N° de transfert", transfer.transfer_number);
  meta("From", "De", fromName || "—");
  meta("To", "À", toName || "—");
  meta("Date", "Date", fmtDateTime(transfer.dispatched_at, en));
  meta("Dispatched by", "Expédié par", transfer.dispatched_by_name);
  y += 2;

  // ── Item table (product + qty + unit; NO prices on a delivery note) ─────────
  const items = transfer.pa_transfer_items || [];
  const cols = [
    { x: M,       w: 12,  label: "#",                 align: "center" },
    { x: M + 12,  w: 108, label: "Product / Produit", align: "left" },
    { x: M + 120, w: 28,  label: "Qty / Qté",         align: "center" },
    { x: M + 148, w: CW - 148, label: "Unit / Unité", align: "center" },
  ];
  const rowH = 8;
  const headerRow = () => {
    doc.setFillColor(240).rect(M, y, CW, rowH, "F");
    doc.setDrawColor(0).setLineWidth(0.2).rect(M, y, CW, rowH);
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(0);
    cols.forEach(c => {
      const tx = c.align === "center" ? c.x + c.w / 2 : c.x + 2;
      doc.text(c.label, tx, y + 5.5, { align: c.align === "center" ? "center" : "left" });
      doc.line(c.x, y, c.x, y + rowH);
    });
    y += rowH;
  };
  headerRow();
  doc.setFont("helvetica", "normal").setFontSize(9);
  items.forEach((it, i) => {
    if (y + rowH > PAGE_H - 45) { doc.addPage(); y = 20; headerRow(); doc.setFont("helvetica", "normal").setFontSize(9); }
    doc.setDrawColor(0).setLineWidth(0.2).rect(M, y, CW, rowH);
    cols.forEach(c => doc.line(c.x, y, c.x, y + rowH));
    const name = (en ? (it.pa_products?.name_en || it.pa_products?.name) : it.pa_products?.name) || "—";
    const vals = [String(i + 1), name, String(it.quantity), it.pa_products?.unit || "—"];
    cols.forEach((c, ci) => {
      const tx = c.align === "center" ? c.x + c.w / 2 : c.x + 2;
      const text = ci === 1 ? doc.splitTextToSize(vals[ci], c.w - 4)[0] : vals[ci]; // clamp long names to 1 line
      doc.text(text, tx, y + 5.5, { align: c.align === "center" ? "center" : "left" });
    });
    y += rowH;
  });
  // (each row's rect already draws its full border, so no extra outline needed)

  // ── Dispatcher signature (ONE line) ─────────────────────────────────────────
  y += 22;
  if (y > PAGE_H - 40) { doc.addPage(); y = 40; }
  doc.setDrawColor(0).setLineWidth(0.3).line(M, y, M + 80, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0);
  doc.text("Dispatcher's signature / Signature de l'expéditeur", M, y + 5);
  if (transfer.dispatched_by_name) {
    doc.setFontSize(8).setTextColor(90);
    doc.text(String(transfer.dispatched_by_name), M, y - 2);
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(120);
  const footParts = [org.name, tel, addr].filter(Boolean);
  const foot = footParts.join(" · ") || "Mon Partenaire";
  doc.text(foot, PAGE_W / 2, PAGE_H - 12, { align: "center", maxWidth: CW });

  // ── Deliver ─────────────────────────────────────────────────────────────────
  const filename = `WAYBILL-${(transfer.transfer_number || "transfer")}.pdf`.replace(/[^\w.\-]/g, "_");
  let isNative = false;
  try { const { Capacitor } = await import("@capacitor/core"); isNative = Capacitor.isNativePlatform(); } catch { /* web */ }

  if (isNative) {
    // Write to the cache dir, then open the OS share sheet (WhatsApp / print / save).
    const base64 = doc.output("datauristring").split(",")[1];
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: `${en ? "Waybill" : "Bon de livraison"} ${transfer.transfer_number || ""}`.trim(),
      text: `${en ? "Waybill" : "Bon de livraison"} ${transfer.transfer_number || ""}${org.name ? " — " + org.name : ""}`,
      files: [uri],
      dialogTitle: en ? "Share / print waybill" : "Partager / imprimer le bon",
    });
    return { ok: true, native: true };
  }

  // Web: download the PDF (the browser's viewer then prints it).
  doc.save(filename);
  return { ok: true, native: false };
}
