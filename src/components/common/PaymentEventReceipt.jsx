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

import { Component, useEffect, useState } from "react";
import { genSaleCodes } from "../../utils/receiptCodes";
import { buildMonospaceReceipt, wrapMonospaceFence } from "../../utils/receiptText";
import { buildFactureHtml } from "../../utils/factureReceipt";

// MP-VOID-PARTIAL-COMMIT-FIX: scoped error boundary so a render
// crash in the receipt (bad payload shape, missing field, etc.)
// doesn't leave the cashier stuck. The wrapped operation has
// ALREADY completed on the backend by the time we mount; a
// render failure here is purely UI. Show a minimal fallback +
// Close button so the cashier can move on, then they can find
// the operation in the audit log / customer detail if needed.
class _ReceiptErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[PaymentEventReceipt]", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const en = this.props.lang === "en";
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={this.props.onClose}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: "var(--bg-elevated)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "#fbbf24" }}>
            {en ? "Receipt couldn't render" : "Reçu non affiché"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.5 }}>
            {en
              ? "The operation completed successfully — only the receipt display failed. You can find the record in customer history or the audit log."
              : "L'opération a réussi — seul l'affichage du reçu a échoué. Vous pouvez retrouver l'enregistrement dans l'historique client ou le journal d'audit."}
          </div>
          <button onClick={this.props.onClose}
            style={{ padding: "10px 24px", borderRadius: 10, background: "var(--brand)", border: "none", color: "#152B52", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            {en ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    );
  }
}

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
  // MP-PAYMENT-EVENT-RECEIPTS Bug 2 fix — POST /sales/:id/payment
  // (action='debt_payment_against_sale'). Distinct from
  // debt_collection because shape is single-invoice not
  // applied_to_invoices array, and the original sale is the
  // anchor (sale_number is the reference for QR/barcode).
  invoice_payment: {
    emoji: "💵", color: "#34d399",
    titleEn: "Invoice Payment",
    titleFr: "Paiement de facture",
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
      // MP-DEBT-COLLECTION-RECEIPT-DISPLAY-BUG: the live
      // collect_debt_no_invoice RPC emits applied_to_invoices
      // entries shaped { sale_number, applied } — not the
      // .amount / .applied_amount names this code was reading.
      // Result: every line rendered "VNT-XXXX — 0 F". Read
      // .applied first; keep .amount / .applied_amount as
      // fallbacks for any pre-current-shape entries. Use ??
      // (not ||) so a legitimate 0 doesn't fall through to a
      // larger fallback value. Defensive null skip for any
      // malformed array element.
      applied.forEach(inv => {
        if (!inv) return;
        const ref = inv.sale_number || inv.sale_id || "?";
        const raw = inv.applied ?? inv.amount ?? inv.applied_amount ?? 0;
        lines.push(`  ${ref} — ${fmtAmt(raw)} F`);
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

  if (eventType === "invoice_payment") {
    if (customerLine) lines.push(customerLine);
    if (data.sale_number) {
      lines.push(`${en ? "Invoice" : "Facture"}: ${data.sale_number}`);
    }
    lines.push("─────────────────────");
    lines.push(`${en ? "Amount paid" : "Montant payé"}: ${fmtAmt(data.amount)} FCFA`);
    if (data.payment_method) lines.push(`${en ? "Method" : "Mode"}: ${data.payment_method}`);
    lines.push("─────────────────────");
    if (data.sale_total != null) {
      lines.push(`${en ? "Invoice total" : "Total facture"}: ${fmtAmt(data.sale_total)} FCFA`);
    }
    if (data.sale_paid_before != null && data.sale_paid_after != null) {
      lines.push(`${en ? "Paid before" : "Payé avant"}: ${fmtAmt(data.sale_paid_before)} FCFA`);
      lines.push(`${en ? "Paid after" : "Payé après"}: ${fmtAmt(data.sale_paid_after)} FCFA`);
    }
    if (data.balance_after != null) {
      const balanceLabel = data.payment_status === "paid"
        ? (en ? "Settled — no balance remaining" : "Soldée — aucun reste dû")
        : `${en ? "Remaining balance" : "Reste dû"}: ${fmtAmt(data.balance_after)} FCFA`;
      lines.push(data.payment_status === "paid" ? `✅ ${balanceLabel}` : balanceLabel);
    }
    // Customer-level totals (only when a registered customer was
    // attached to the sale; walk-in invoice payments are rare but
    // possible if the original sale predated customer linking).
    if (data.debt_before != null && data.debt_after != null) {
      lines.push("─────────────────────");
      lines.push(`${en ? "Customer debt before" : "Dette client avant"}: ${fmtAmt(data.debt_before)} FCFA`);
      lines.push(`*${en ? "Customer debt after" : "Dette client après"}: ${fmtAmt(data.debt_after)} FCFA*`);
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
    // MP-VOID-CASH-AND-RETURNS-HANDLING Gap 2: items_returned
    // entries now carry effective qty + qty_already_returned.
    // Surface the "X already returned earlier" subtle hint so the
    // cashier understands why qty might differ from the original
    // sale. Skip lines where effective qty is 0 (fully returned
    // before void — nothing physical to mention).
    (data.items_returned || []).forEach(i => {
      const qty = Number(i.qty || 0);
      const priorQty = Number(i.qty_already_returned || 0);
      const origQty = Number(i.qty_original || qty);
      if (i.line_type === "debt_payment") {
        lines.push(`💰 ${i.name || "?"} ........ ${fmtAmt(i.unit_price)} F`);
        return;
      }
      if (qty <= 0) {
        // Line fully returned before void — informational only.
        if (priorQty > 0) {
          lines.push(`${i.name || "?"} × 0 (${en ? "all" : "tout"} ${priorQty} ${en ? "previously returned" : "déjà retourné"})`);
        }
        return;
      }
      const total = qty * Number(i.unit_price || 0);
      const note = priorQty > 0
        ? ` (${en ? "of" : "sur"} ${origQty}, ${priorQty} ${en ? "prev. returned" : "déjà retourné"})`
        : "";
      lines.push(`${i.name || "?"} × ${qty} ........ ${fmtAmt(total)} F${note}`);
    });
    lines.push("─────────────────────");
    lines.push(`${en ? "Original total" : "Total d'origine"}: ${fmtAmt(data.original_total_amount)} FCFA`);
    if (Number(data.original_paid_amount || 0) > 0) {
      lines.push(`${en ? "Originally paid" : "Initialement payé"}: ${fmtAmt(data.original_paid_amount)} FCFA`);
    }
    // MP-VOID-CASH-AND-RETURNS-HANDLING Gap 1: surface the cash
    // going back to the customer for THIS void. Effective amount
    // already accounts for any prior refunds. Drawer reconciliation
    // picks it up via the synthesised pa_returns row at shift close.
    const cashRefund = Number(data.cash_refund_amount || 0);
    const priorRefundTotal = Number(data.prior_refund_total || 0);
    if (cashRefund > 0) {
      lines.push(`💵 *${en ? "Cash refund" : "Remboursement espèces"}: ${fmtAmt(cashRefund)} FCFA*`);
      if (data.cash_refund_method && data.cash_refund_method !== "cash") {
        lines.push(`   ${en ? "Method" : "Mode"}: ${data.cash_refund_method}`);
      }
      if (data.cash_refund_ref) {
        lines.push(`   ${en ? "Refund ref" : "Réf. remb."}: ${data.cash_refund_ref}`);
      }
      if (priorRefundTotal > 0) {
        lines.push(`   ${en
          ? `(net of ${fmtAmt(priorRefundTotal)} previously refunded)`
          : `(net de ${fmtAmt(priorRefundTotal)} déjà remboursé)`}`);
      }
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

function PaymentEventReceiptInner({ eventType, data, org, lang, onClose }) {
  const en = lang === "en";
  // Defensive: callers should always pass a data object, but a
  // missing/null one shouldn't take down the modal stack. The
  // outer ErrorBoundary catches real render errors; this is the
  // cheap up-front guard.
  if (!data) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={onClose}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 360 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginBottom: 14 }}>
            {en ? "No receipt data to display." : "Aucune donnée de reçu à afficher."}
          </div>
          <button onClick={onClose} style={{ width: "100%", padding: 10, borderRadius: 10, background: "var(--brand)", color: "#152B52", border: "none", fontWeight: 700, cursor: "pointer" }}>
            {en ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    );
  }
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

  // MP-WHATSAPP-RECEIPT-RICH-FORMAT (Path A): WhatsApp receipts are
  // now a fixed-width 35-char monospace block wrapped in a triple-
  // backtick code fence so WA renders them in its monospace font on
  // both Android and iOS — same column alignment, separators, header
  // and ASCII barcode strip the printable receipt uses. Built in
  // utils/receiptText.js so a future Path B (image + scannable
  // Code-128) can reuse the per-event data extraction.
  const buildWhatsApp = () => {
    const body = buildMonospaceReceipt(eventType, data, lang, org);
    const title = en ? header.titleEn : header.titleFr;
    // Lead with one un-fenced status line so the recipient sees the
    // event type + emoji in WhatsApp's preview before tapping in.
    return `${header.emoji} ${title}\n${wrapMonospaceFence(body)}`;
  };

  const sendWhatsApp = () => {
    const msg = buildWhatsApp();
    const url = normalisedPhone
      ? `https://wa.me/${normalisedPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  // MP-FACTURE-STANDARD: Cameroon "FACTURE" print format (matches the Le
  // Soldeur paper invoice). Letterhead is pulled from org letterhead fields;
  // sales render as a full facture (items table + TOTAL + signatures). Other
  // event types (refund / void / debt) keep their line-based body under the
  // same letterhead — they aren't invoices. Narrow/thermal printers get the
  // same structure: the container is a centered max-width box that condenses
  // to the paper width, and the table wraps the Désignation column.
  const printReceipt = () => {
    // SALE → shared Cameroon FACTURE builder (identical to the Reports → Sales
    // details print). No barcode/QR; amounts space-separated, no decimals.
    if (eventType === "sale") {
      const isDebt = (i) => i.type === "debt_payment" || i.isDebt || i.isDebtPayment
        || i.product_id === "__DEBT__" || i.product_id === "__DEBT_PAYMENT__";
      const items = (data.items || []).map((i) => isDebt(i)
        ? { name: i.name, quantity: 1, unit_price: Number(i.unit_price) || 0 }
        : { name: i.name, quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0 });
      const html = buildFactureHtml({
        org: org || {},
        saleNumber: reference || data.sale_number || "",
        saleDate: data.sale_date || "",
        customerName: data.customer_name || data.customer?.name || "Comptant",
        items,
      });
      const w = window.open("", "_blank", "width=400,height=600");
      w.document.write(html); w.document.close(); w.focus();
      setTimeout(() => { w.print(); w.close(); }, 300);
      return;
    }
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    // XAF has no cents: round to whole units and group thousands with a plain
    // space (e.g. 57000 -> "57 000", 20500 -> "20 500").
    const money = (n) => Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");
    const currency = esc(org?.currency || "FCFA");
    const shopName = org?.name || "Notre boutique";
    const footer = org?.receipt_footer || (en ? "Thank you for your business!" : "Merci pour votre achat!");
    const title = en ? header.titleEn : header.titleFr;

    // ── Letterhead (skip any empty field) ──
    const lh = [];
    if (org?.logo_url) lh.push(`<div class="center"><img class="logo" src="${esc(org.logo_url)}"/></div>`);
    if (org?.name)     lh.push(`<div class="center name">${esc(org.name)}</div>`);
    if (org?.slogan)   lh.push(`<div class="center slogan">${esc(org.slogan)}</div>`);
    const addr = [org?.address, org?.city, org?.country].filter(Boolean).map(esc).join(", ");
    if (addr)          lh.push(`<div class="center small">${addr}</div>`);
    const tel = [org?.phone, org?.whatsapp_number].filter(Boolean).map(esc).join(" / ");
    if (tel)           lh.push(`<div class="center small">Tél: ${tel}</div>`);
    if (org?.email)    lh.push(`<div class="center small">E-mail: ${esc(org.email)}</div>`);
    const letterhead = lh.join("");

    // DD-MM-YYYY from the sale's own date (fallback: today).
    const factureDate = (() => {
      const sd = data.sale_date;
      if (sd && /^\d{4}-\d{2}-\d{2}/.test(sd)) { const [y, m, d] = sd.slice(0, 10).split("-"); return `${d}-${m}-${y}`; }
      const d = new Date(); const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
    })();

    let bodyHtml;
    if (eventType === "sale") {
      const items = data.items || [];
      const isDebtLine = (i) => i.type === "debt_payment" || i.isDebt || i.isDebtPayment
        || i.product_id === "__DEBT__" || i.product_id === "__DEBT_PAYMENT__";
      const rows = items.map((i) => {
        const debt = isDebtLine(i);
        const qty = debt ? 1 : (Number(i.quantity) || 0);
        const pu = Number(i.unit_price) || 0;
        const lt = qty * pu;
        return `<tr><td class="c">${qty}</td><td>${esc(i.name)}</td><td class="r">${money(pu)}</td><td class="r">${money(lt)}</td></tr>`;
      }).join("");
      const grand = items.reduce((s, i) => {
        const qty = isDebtLine(i) ? 1 : (Number(i.quantity) || 0);
        return s + qty * (Number(i.unit_price) || 0);
      }, 0);
      const clientName = esc(data.customer_name || data.customer?.name || "Comptant");
      const num = esc(reference || data.sale_number || "");
      bodyHtml = `
        <div class="title">FACTURE</div>
        <div class="center meta">N°: ${num}</div>
        <div class="center meta">Date: ${factureDate}</div>
        <div class="client">Client: ${clientName}</div>
        <table>
          <thead><tr><th class="c">Qté</th><th>Désignation</th><th class="r">P.U.</th><th class="r">P. Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total">TOTAL: ${money(grand)} ${currency}</div>
        ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}
        <div class="arrete">Arrêtée la présente facture à la somme de : ________________________________</div>
        <div class="sign"><div class="sigcell">Signature client</div><div class="sigcell">Signature vendeur</div></div>`;
    } else {
      // Non-sale events: keep the line-based body under the letterhead.
      const linesHtml = bodyLines
        .map((l) => l === "─────────────────────" ? `<hr class="sep"/>`
          : l === "" ? `<br/>`
          : `<div>${esc(l).replace(/\*([^*]+)\*/g, "<strong>$1</strong>")}</div>`)
        .join("");
      bodyHtml = `
        <hr class="sep"/>
        <div class="center title">${title}</div>
        <div class="center meta">${dateStr} ${timeStr}</div>
        ${reference ? `<div class="center" style="font-size:14px;font-weight:bold;margin:4px 0">${esc(reference)}</div>` : ""}
        <hr class="sep"/>
        ${linesHtml}
        ${codes.qr ? `<div class="center" style="margin-top:8px"><img src="${codes.qr}" style="width:110px;height:110px"/></div>` : ""}
        ${footer ? `<div class="footer">${esc(footer)}</div>` : ""}`;
    }

    const html = `
      <html><head><meta charset="utf-8"><title>${eventType === "sale" ? "FACTURE " + esc(reference || "") : esc(title)}</title><style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; margin: 0; padding: 10px; }
        .wrap { max-width: 440px; margin: 0 auto; }
        .center { text-align: center; }
        .name { font-weight: bold; font-size: 16px; }
        .slogan { font-style: italic; font-size: 11px; }
        .small { font-size: 11px; line-height: 1.4; }
        .logo { max-height: 70px; max-width: 200px; object-fit: contain; }
        .title { text-align: center; font-weight: bold; font-size: 16px; letter-spacing: 1px; margin: 12px 0 4px; }
        .meta { font-size: 12px; }
        .client { margin: 8px 0 4px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        th, td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; vertical-align: top; word-break: break-word; }
        th { background: #f0f0f0; }
        .c { text-align: center; } .r { text-align: right; }
        .total { text-align: right; font-weight: bold; font-size: 15px; margin-top: 8px; }
        .footer { text-align: center; margin-top: 12px; font-size: 11px; }
        .arrete { margin-top: 16px; font-size: 11px; }
        .sign { display: flex; justify-content: space-between; margin-top: 30px; font-size: 11px; font-weight: bold; }
        .sigcell { width: 45%; border-top: 1px solid #000; padding-top: 4px; text-align: center; }
        hr.sep { border: none; border-top: 1px dashed #000; margin: 8px 0; }
        @media print { body { padding: 0; } .wrap { max-width: 100%; } }
      </style></head><body>
        <div class="wrap">
          ${letterhead}
          ${bodyHtml}
        </div>
      </body></html>`;
    const w = window.open("", "_blank", "width=400,height=600");
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

// Default export wraps the inner render in the error boundary so
// a render-time crash shows the fallback notice instead of an
// unmounted blank screen. Props pass through transparently.
export default function PaymentEventReceipt(props) {
  return (
    <_ReceiptErrorBoundary lang={props.lang} onClose={props.onClose}>
      <PaymentEventReceiptInner {...props} />
    </_ReceiptErrorBoundary>
  );
}
