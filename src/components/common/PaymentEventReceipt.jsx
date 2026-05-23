// MP-PAYMENT-EVENT-RECEIPTS Phase 2
//
// Shared receipt modal for every cash-movement event. One file
// for: POS sale, debt collection (Encaisser dette), refund, and
// void. Each event type plugs in through RECEIPT_CONFIG (header
// copy, body section composition, WhatsApp text builder, print
// template builder) — the modal shell, action buttons, QR/barcode
// rendering, and i18n wiring are shared.
//
// Replaces the inline ReceiptModal that used to live in POSPage
// (lines ~1509-1789 pre-extraction). Same on-screen layout, same
// print/WhatsApp UX. New flows (CustomersPage debt collection,
// RefundsPage refund + void) now render here too.
//
// Props:
//   eventType  — 'sale' | 'debt_collection' | 'refund' | 'void'
//   data       — event-specific payload from the backend response
//   org        — org metadata (name, address, phone, city,
//                receipt_footer) — same shape the inline modal used
//   lang       — 'en' | 'fr'
//   onClose    — callback when the user dismisses
//
// The receipt's reference (the value rendered as Code128 + QR via
// genSaleCodes) is picked by the config: sale_number for
// sale/debt_collection/void, return_ref for refund.

import { useEffect, useState } from "react";
import { genSaleCodes } from "../../utils/receiptCodes";

const fmtAmt = n => (Number(n) || 0).toLocaleString();

// ── EVENT-TYPE CONFIG ───────────────────────────────────────────
//
// Each entry encapsulates everything that changes between event
// types. Sections to render in the on-screen body are picked here;
// the WhatsApp + print text builders live inline in the section
// definitions so we don't drift between surfaces (same bug class
// that bit MP-RECEIPT-BODY-PAID-AMOUNT-BUG — three surfaces, one
// truth).

const HEADER_BY_TYPE = {
  sale: {
    emoji: "✅", color: "#10b981",
    titleEn: "Sale Recorded!",
    titleFr: "Vente enregistrée!",
  },
  debt_collection: {
    emoji: "💰", color: "#34d399",
    titleEn: "Debt Collection",
    titleFr: "Encaissement de dette",
  },
  refund: {
    emoji: "↩", color: "#fbbf24",
    titleEn: "Refund Recorded",
    titleFr: "Remboursement enregistré",
  },
  void: {
    emoji: "⊘", color: "#f87171",
    titleEn: "Sale Voided",
    titleFr: "Vente annulée",
  },
};

// Pick the "reference" string for QR/barcode + sub-header per type.
function referenceFor(eventType, data) {
  if (eventType === "refund") return data.return_ref || null;
  return data.sale_number || null;
}

// ── HELPERS ─────────────────────────────────────────────────────

function nowLocale(lang) {
  const loc = lang === "en" ? "en-US" : "fr-FR";
  const d = new Date();
  return {
    dateStr: d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" }),
    timeStr: d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }),
  };
}

// Compose the WhatsApp + print plain-text bodies (the on-screen
// modal renders JSX directly; the two outbound surfaces share
// this builder so they can't drift).
function buildBodyLines(eventType, data, lang, org) {
  const en = lang === "en";
  const lines = [];
  // Customer name lookup: new backend payloads expose `customer_name`
  // at the top level; POSPage's existing lastSale shape nests it
  // under `data.customer.name`. Support both.
  const customerName = data.customer_name || data.customer?.name || null;
  const customerLine = customerName
    ? `${en ? "Customer" : "Client"}: ${customerName}`
    : null;

  if (eventType === "sale") {
    const items = data.items || [];
    items.forEach(i => {
      if (i.type === "debt_payment") {
        lines.push(`💰 ${i.name} ........ ${fmtAmt(i.unit_price)} F`);
      } else {
        lines.push(`${i.name} × ${i.quantity} ........ ${fmtAmt(i.quantity * i.unit_price)} F`);
      }
    });
    const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const paid = Number(data.paid_amount ?? total) || 0;
    const balance = total - paid;
    lines.push("─────────────────────");
    lines.push(`${en ? "Total" : "Total"}: ${fmtAmt(total)} FCFA`);
    if (data.payment_status === "paid") {
      lines.push(`✅ ${en ? "PAID" : "PAYÉ"}: ${fmtAmt(paid)} FCFA`);
    } else if (data.payment_status === "credit") {
      lines.push(`🔴 ${en ? "FULL CREDIT — No payment" : "CRÉDIT TOTAL — Aucun paiement"}`);
      lines.push(`${en ? "Due" : "Dû"}: ${fmtAmt(total)} FCFA`);
    } else if (data.payment_status === "partial") {
      lines.push(`🟡 ${en ? "PARTIAL PAYMENT" : "PAIEMENT PARTIEL"}`);
      lines.push(`${en ? "Paid" : "Payé"}: ${fmtAmt(paid)} FCFA`);
      lines.push(`${en ? "Balance due" : "Reste dû"}: ${fmtAmt(balance)} FCFA`);
    }
  }

  if (eventType === "debt_collection") {
    const applied = data.applied_to_invoices || [];
    const ghost = Number(data.ghost_portion || 0);
    if (customerLine) lines.push(customerLine);
    lines.push("─────────────────────");
    lines.push(`${en ? "Amount paid" : "Montant payé"}: ${fmtAmt(data.amount)} FCFA`);
    if (data.payment_method) lines.push(`${en ? "Method" : "Mode"}: ${data.payment_method}`);
    if (applied.length || ghost) {
      lines.push("─────────────────────");
      lines.push(en ? "Applied to:" : "Imputé sur :");
      applied.forEach(inv => {
        const ref = inv.sale_number || inv.sale_id || "?";
        const amt = fmtAmt(inv.amount || inv.applied_amount || 0);
        lines.push(`  ${ref} — ${amt} F`);
      });
      if (ghost > 0) {
        lines.push(`  ${en ? "Outstanding debt (no invoice)" : "Dette en cours (sans facture)"} — ${fmtAmt(ghost)} F`);
      }
    }
    lines.push("─────────────────────");
    if (data.debt_before != null) {
      lines.push(`${en ? "Previous balance" : "Solde précédent"}: ${fmtAmt(data.debt_before)} FCFA`);
    }
    if (data.debt_after != null) {
      lines.push(`*${en ? "New balance" : "Nouveau solde"}: ${fmtAmt(data.debt_after)} FCFA*`);
    }
  }

  if (eventType === "refund") {
    if (customerLine) lines.push(customerLine);
    if (data.source_sale_number) {
      lines.push(`${en ? "Original sale" : "Vente d'origine"}: ${data.source_sale_number}`);
    }
    lines.push("─────────────────────");
    (data.items_returned || []).forEach(i => {
      const total = Number(i.qty || 0) * Number(i.unit_price || 0);
      lines.push(`${i.name || "?"} × ${i.qty} ........ ${fmtAmt(total)} F`);
    });
    lines.push("─────────────────────");
    lines.push(`*${en ? "Refund total" : "Total remboursé"}: ${fmtAmt(data.refund_amount)} FCFA*`);
    if (data.refund_method) lines.push(`${en ? "Method" : "Mode"}: ${data.refund_method}`);
    const credit = Number(data.credit_portion || 0);
    const cash = Number(data.cash_portion || 0);
    if (credit > 0 && cash > 0) {
      lines.push("");
      lines.push(en
        ? `↳ ${fmtAmt(credit)} F applied to your account balance, ${fmtAmt(cash)} F returned as cash.`
        : `↳ ${fmtAmt(credit)} F imputé sur votre solde client, ${fmtAmt(cash)} F restitué en espèces.`);
    } else if (credit > 0) {
      lines.push(en
        ? `↳ ${fmtAmt(credit)} F applied to your account balance.`
        : `↳ ${fmtAmt(credit)} F imputé sur votre solde client.`);
    }
    if (data.customer_new_balance != null) {
      lines.push(`${en ? "New balance" : "Nouveau solde"}: ${fmtAmt(data.customer_new_balance)} FCFA`);
    }
  }

  if (eventType === "void") {
    if (customerLine) lines.push(customerLine);
    lines.push(`${en ? "Voided sale" : "Vente annulée"}: ${data.sale_number}`);
    lines.push("─────────────────────");
    (data.items_returned || []).forEach(i => {
      if (i.line_type === "debt_payment") {
        lines.push(`💰 ${i.name || "?"} ........ ${fmtAmt(i.unit_price)} F`);
      } else {
        const total = Number(i.qty || 0) * Number(i.unit_price || 0);
        lines.push(`${i.name || "?"} × ${i.qty} ........ ${fmtAmt(total)} F`);
      }
    });
    lines.push("─────────────────────");
    lines.push(`${en ? "Original total" : "Total d'origine"}: ${fmtAmt(data.original_total_amount)} FCFA`);
    if (Number(data.original_paid_amount || 0) > 0) {
      lines.push(`${en ? "Originally paid" : "Initialement payé"}: ${fmtAmt(data.original_paid_amount)} FCFA`);
    }
    if (data.reason) lines.push(`${en ? "Reason" : "Raison"}: ${data.reason}`);
    if (data.customer_new_balance != null) {
      lines.push(`${en ? "New customer balance" : "Nouveau solde client"}: ${fmtAmt(data.customer_new_balance)} FCFA`);
    }
    lines.push("");
    lines.push(en
      ? "This void replaces the original transaction."
      : "Cette annulation remplace la transaction originale.");
  }

  return lines;
}

// ── COMPONENT ───────────────────────────────────────────────────

export default function PaymentEventReceipt({ eventType, data, org, lang, onClose }) {
  const en = lang === "en";
  const header = HEADER_BY_TYPE[eventType] || HEADER_BY_TYPE.sale;
  const reference = referenceFor(eventType, data);
  const { dateStr, timeStr } = nowLocale(lang);

  // ESC closes — mirrors the inline ReceiptModal's behaviour
  // (MP-RECEIPT-MODAL-MOBILE-FIX) so phones aren't trapped on a
  // tall receipt with no escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Code128 + QR encoded from the reference string. Async; render
  // is non-blocking — barcode/QR appear once ready.
  const [codes, setCodes] = useState({ barcode: "", qr: "" });
  useEffect(() => {
    if (!reference) { setCodes({ barcode: "", qr: "" }); return; }
    let cancelled = false;
    genSaleCodes(reference)
      .then(c => { if (!cancelled) setCodes(c); })
      .catch(() => { if (!cancelled) setCodes({ barcode: "", qr: "" }); });
    return () => { cancelled = true; };
  }, [reference]);

  // Body lines (shared by WhatsApp + print + on-screen summary).
  const bodyLines = buildBodyLines(eventType, data, lang, org);

  // Customer phone for the WhatsApp deeplink. Normalize to 237
  // prefix the same way the sale receipt's sendWhatsApp does.
  const customerPhone = data.customer_phone || data.customer?.phone || null;
  const normalisedPhone = (() => {
    if (!customerPhone) return null;
    let p = String(customerPhone).replace(/\s+/g, "").replace(/^0/, "");
    if (!p.startsWith("237")) p = "237" + p;
    return p;
  })();

  // WhatsApp message: shop header + body lines + footer.
  const buildWhatsApp = () => {
    const shopName = org?.name || "Notre boutique";
    const footer = org?.receipt_footer || (en ? "Thank you for your business!" : "Merci pour votre achat!");
    const title = en ? header.titleEn : header.titleFr;
    let msg = `${header.emoji} *${title} — ${shopName}*\n`;
    msg += `📅 ${dateStr} ${en ? "at" : "à"} ${timeStr}\n`;
    if (reference) msg += `N° ${reference}\n`;
    msg += `─────────────────────\n`;
    msg += bodyLines.join("\n") + "\n";
    msg += `\n${footer}\n— ${shopName}`;
    if (org?.address) msg += `\n📍 ${org.address}${org.city ? ", " + org.city : ""}`;
    if (org?.phone) msg += `\n📞 ${org.phone}`;
    return msg;
  };

  const sendWhatsApp = () => {
    const msg = buildWhatsApp();
    const url = normalisedPhone
      ? `https://wa.me/${normalisedPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  const printReceipt = () => {
    const shopName = org?.name || "Notre boutique";
    const footer = org?.receipt_footer || (en ? "Thank you for your business!" : "Merci pour votre achat!");
    const title = en ? header.titleEn : header.titleFr;
    const linesHtml = bodyLines
      .map(l => l === "─────────────────────"
        ? `<div class="line"></div>`
        : l === ""
          ? `<br/>`
          : `<div>${l.replace(/\*([^*]+)\*/g, "<strong>$1</strong>")}</div>`)
      .join("");
    const html = `
      <html><head><title>${title}</title><style>
        body { font-family: monospace; font-size: 12px; width: 300px; margin: 0 auto; }
        h2 { text-align: center; font-size: 14px; margin: 4px 0; }
        .center { text-align: center; }
        .line { border-top: 1px dashed #000; margin: 6px 0; }
        .footer { text-align: center; margin-top: 10px; font-size: 11px; }
      </style></head><body>
        <h2>${shopName}</h2>
        <div class="center">${org?.address || ""} ${org?.city || ""}</div>
        <div class="center">${org?.phone || ""}</div>
        <div class="line"></div>
        <div class="center" style="font-weight:bold">${header.emoji} ${title}</div>
        <div class="center">${dateStr} ${timeStr}</div>
        ${reference ? `<div class="center" style="font-size:15px;font-weight:bold;margin:4px 0">${reference}</div>` : ""}
        <div class="line"></div>
        ${linesHtml}
        <div class="line"></div>
        ${data.cashier_name ? `<div>${en ? "Cashier" : "Caissier"}: ${data.cashier_name}</div>` : ""}
        ${data.location_name ? `<div>${en ? "Location" : "Emplacement"}: ${data.location_name}</div>` : ""}
        ${codes.barcode ? `<div class="center" style="margin-top:6px"><img src="${codes.barcode}" style="height:44px;image-rendering:pixelated"/></div>` : ""}
        ${codes.qr ? `<div class="center"><img src="${codes.qr}" style="width:110px;height:110px"/></div>` : ""}
        ${reference ? `<div class="center" style="font-size:11px">${reference}</div>` : ""}
        <div class="footer">${footer}</div>
        <div class="footer">— ${shopName}</div>
      </body></html>`;
    const w = window.open("", "_blank", "width=350,height=520");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          borderRadius: 16, maxWidth: 420, width: "100%",
          maxHeight: "90vh", display: "flex", flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Sticky header */}
        <div style={{ position: "relative", flexShrink: 0, padding: "20px 24px 12px", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
          <button onClick={onClose} aria-label={en ? "Close" : "Fermer"}
            style={{
              position: "absolute", top: 10, right: 10,
              width: 32, height: 32, borderRadius: 16,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", cursor: "pointer",
              fontSize: 16, fontWeight: 700, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          <div style={{ fontSize: 32, marginBottom: 4 }}>{header.emoji}</div>
          <div style={{ fontWeight: 800, fontSize: 17, color: header.color }}>
            {en ? header.titleEn : header.titleFr}
          </div>
          {reference && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontFamily: "monospace" }}>
              {reference}
            </div>
          )}
          {eventType === "debt_collection" && data.sale_number && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
              {en ? "Internal ref" : "Réf interne"}: <span style={{ fontFamily: "monospace" }}>{data.sale_number}</span> {en ? "(debt collection)" : "(collection de dette)"}
            </div>
          )}
          {eventType === "refund" && data.source_sale_number && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
              {en ? "From sale" : "Issu de la vente"}: <span style={{ fontFamily: "monospace" }}>{data.source_sale_number}</span>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 24px" }}>
          <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 16, fontSize: 13 }}>
            <div style={{ fontWeight: 700, textAlign: "center", marginBottom: 6 }}>{org?.name || "Boutique"}</div>
            {(data.customer_name || data.customer?.name) && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginBottom: 8 }}>
                👤 {data.customer_name || data.customer?.name}
              </div>
            )}

            <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
              {bodyLines.map((l, idx) => {
                if (l === "─────────────────────") {
                  return <div key={idx} style={{ borderTop: "1px dashed var(--border)", margin: "6px 0" }} />;
                }
                if (l === "") return <div key={idx} style={{ height: 6 }} />;
                const isBold = /^\*[^*]+\*$/.test(l);
                const clean = l.replace(/^\*|\*$/g, "");
                return (
                  <div key={idx} style={{ fontSize: 12, color: isBold ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isBold ? 800 : 500, marginBottom: 2 }}>
                    {clean}
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 6, fontSize: 11, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
              {data.cashier_name && <div>{en ? "Cashier" : "Caissier"}: <strong>{data.cashier_name}</strong></div>}
              {data.location_name && <div>{en ? "Location" : "Emplacement"}: <strong>{data.location_name}</strong></div>}
              <div>{dateStr} · {timeStr}</div>
            </div>

            {reference && (codes.barcode || codes.qr) && (
              <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 10, textAlign: "center", background: "#fff", borderRadius: 8, padding: "10px 0" }}>
                {codes.barcode && <img src={codes.barcode} alt="barcode" style={{ height: 44, maxWidth: "90%" }} />}
                {codes.qr && <div><img src={codes.qr} alt="qr" style={{ width: 96, height: 96 }} /></div>}
                <div style={{ fontSize: 11, color: "#000", fontFamily: "monospace", fontWeight: 700 }}>{reference}</div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{ flexShrink: 0, padding: "12px 24px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-elevated)", display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={sendWhatsApp}
            style={{ width: "100%", padding: "11px", background: "#25D366", border: "none", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            📱 {customerPhone
              ? (en ? "Send via WhatsApp" : "Envoyer par WhatsApp")
              : (en ? "Share via WhatsApp" : "Partager par WhatsApp")}
          </button>
          <button onClick={printReceipt}
            style={{ width: "100%", padding: "11px", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            🖨️ {en ? "Print Receipt" : "Imprimer reçu"}
          </button>
          <button onClick={onClose}
            style={{ width: "100%", padding: "9px", background: "transparent", border: "none", color: "var(--text-muted)", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            {en ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    </div>
  );
}
