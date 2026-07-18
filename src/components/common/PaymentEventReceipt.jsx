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
import { genSaleCodes, genQr } from "../../utils/receiptCodes";
import { resolveCodeStyle } from "../../utils/receiptCodeStyle";
import { buildMonospaceReceipt, wrapMonospaceFence } from "../../utils/receiptText";
import { buildFactureInner, buildThermalReceipt } from "../../utils/factureReceipt";
import { advertLines, PLAY_STORE_URL, showDownloadQr, downloadQrCaptionLines } from "../../utils/receiptExtras";
import { currencySymbol } from "../../utils/currency";
import { momoLabel } from "../../utils/paymentLabels";
import toast from "react-hot-toast";
// MP-BT-THERMAL: direct Bluetooth (Classic SPP) ESC/POS printing.
import { isBtPrintSupported, getSavedPrinter, saveSavedPrinter, listPairedPrinters, printSaleViaBluetooth } from "../../utils/btPrint";

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
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
            {en
              ? "The sale completed successfully — only the receipt display failed."
              : "La vente a réussi — seul l'affichage du reçu a échoué."}
          </div>
          {this.props.saleRef && (
            <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "var(--text-primary)", marginBottom: 16, letterSpacing: 0.5 }}>
              {en ? "Receipt №" : "Reçu №"} {this.props.saleRef}
            </div>
          )}
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

// MP-SOLD-DATE-NOTE: fixed DD/MM/YYYY for the note line specifically — a
// deliberate, single format independent of whatever each surface's PRIMARY
// date already uses (this file's own footer, the print builders' hyphenated
// DD-MM-YYYY, WhatsApp's month-name format all differ from each other).
function fmtSoldDateNote(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return (y && m && d) ? `${d}/${m}/${y}` : String(isoDate);
}

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
  const sym = currencySymbol(org?.currency);
  const lines = [];
  // MP-PAYMENT-METHOD-LABEL: 'mobile_money' shows as the country's label
  // (NG "Bank Transfer", CM/XAF "Mobile Money"); other methods unchanged.
  const methodLbl = (m) => {
    const k = String(m || "").toLowerCase();
    if (k === "mobile_money") return momoLabel(org?.currency, en);
    if (k === "cash") return en ? "Cash" : "Espèces";
    if (k === "bank" || k === "bank_transfer") return en ? "Bank" : "Virement";
    return m;
  };
  // Customer name lookup: new backend payloads expose `customer_name`
  // at the top level; POSPage's existing lastSale shape nests it
  // under `data.customer.name`. Support both.
  const customerName = data.customer_name || data.customer?.name || null;
  const customerLine = customerName
    ? `${en ? "Customer" : "Client"}: ${customerName}`
    : null;

  if (eventType === "sale") {
    const items = data.items || [];
    // MP-DAMAGED-GOODS: flag damaged lines on the receipt (preview + WhatsApp +
    // non-facture print all share these lines). Server stamps is_damaged.
    const dmg = (i) => i.is_damaged ? (en ? " (DAMAGED GOODS)" : " (MARCHANDISE ENDOMMAGÉE)") : "";
    items.forEach(i => {
      if (i.type === "debt_payment") {
        lines.push(`💰 ${i.name} ........ ${fmtAmt(i.unit_price)} F`);
      } else {
        lines.push(`${i.name}${dmg(i)} × ${i.quantity} ........ ${fmtAmt(i.quantity * i.unit_price)} F`);
      }
    });
    // MP-DISCOUNT: NET total is data.total_amount; discount = gross − net.
    const grossSum = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const total = Number(data.total_amount != null ? data.total_amount : grossSum) || 0;
    const discount = Math.max(0, grossSum - total);
    const paid = Number(data.paid_amount ?? total) || 0;
    const balance = total - paid;
    lines.push("─────────────────────");
    if (discount > 0) {
      lines.push(`${en ? "Subtotal" : "Sous-total"}: ${fmtAmt(grossSum)} ${sym}`);
      lines.push(`${en ? "Discount" : "Remise"}: −${fmtAmt(discount)} ${sym}`);
    }
    lines.push(`${en ? "Total" : "Total"}: ${fmtAmt(total)} ${sym}`);
    if (data.payment_status === "paid") {
      lines.push(`✅ ${en ? "PAID" : "PAYÉ"}: ${fmtAmt(paid)} ${sym}`);
    } else if (data.payment_status === "credit") {
      lines.push(`🔴 ${en ? "FULL CREDIT — No payment" : "CRÉDIT TOTAL — Aucun paiement"}`);
      lines.push(`${en ? "Due" : "Dû"}: ${fmtAmt(total)} ${sym}`);
    } else if (data.payment_status === "partial") {
      lines.push(`🟡 ${en ? "PARTIAL PAYMENT" : "PAIEMENT PARTIEL"}`);
      lines.push(`${en ? "Paid" : "Payé"}: ${fmtAmt(paid)} ${sym}`);
      lines.push(`${en ? "Balance due" : "Reste dû"}: ${fmtAmt(balance)} ${sym}`);
    }
  }

  if (eventType === "debt_collection") {
    const applied = data.applied_to_invoices || [];
    const ghost = Number(data.ghost_portion || 0);
    if (customerLine) lines.push(customerLine);
    lines.push("─────────────────────");
    lines.push(`${en ? "Amount paid" : "Montant payé"}: ${fmtAmt(data.amount)} ${sym}`);
    if (data.payment_method) lines.push(`${en ? "Method" : "Mode"}: ${methodLbl(data.payment_method)}`);
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
      lines.push(`${en ? "Previous balance" : "Solde précédent"}: ${fmtAmt(data.debt_before)} ${sym}`);
    }
    if (data.debt_after != null) {
      lines.push(`*${en ? "New balance" : "Nouveau solde"}: ${fmtAmt(data.debt_after)} ${sym}*`);
    }
  }

  if (eventType === "invoice_payment") {
    if (customerLine) lines.push(customerLine);
    if (data.sale_number) {
      lines.push(`${en ? "Invoice" : "Facture"}: ${data.sale_number}`);
    }
    lines.push("─────────────────────");
    lines.push(`${en ? "Amount paid" : "Montant payé"}: ${fmtAmt(data.amount)} ${sym}`);
    if (data.payment_method) lines.push(`${en ? "Method" : "Mode"}: ${methodLbl(data.payment_method)}`);
    lines.push("─────────────────────");
    if (data.sale_total != null) {
      lines.push(`${en ? "Invoice total" : "Total facture"}: ${fmtAmt(data.sale_total)} ${sym}`);
    }
    if (data.sale_paid_before != null && data.sale_paid_after != null) {
      lines.push(`${en ? "Paid before" : "Payé avant"}: ${fmtAmt(data.sale_paid_before)} ${sym}`);
      lines.push(`${en ? "Paid after" : "Payé après"}: ${fmtAmt(data.sale_paid_after)} ${sym}`);
    }
    if (data.balance_after != null) {
      const balanceLabel = data.payment_status === "paid"
        ? (en ? "Settled — no balance remaining" : "Soldée — aucun reste dû")
        : `${en ? "Remaining balance" : "Reste dû"}: ${fmtAmt(data.balance_after)} ${sym}`;
      lines.push(data.payment_status === "paid" ? `✅ ${balanceLabel}` : balanceLabel);
    }
    // Customer-level totals (only when a registered customer was
    // attached to the sale; walk-in invoice payments are rare but
    // possible if the original sale predated customer linking).
    if (data.debt_before != null && data.debt_after != null) {
      lines.push("─────────────────────");
      lines.push(`${en ? "Customer debt before" : "Dette client avant"}: ${fmtAmt(data.debt_before)} ${sym}`);
      lines.push(`*${en ? "Customer debt after" : "Dette client après"}: ${fmtAmt(data.debt_after)} ${sym}*`);
    }
  }

  if (eventType === "refund") {
    if (customerLine) lines.push(customerLine);
    if (data.source_sale_number) {
      lines.push(`${en ? "Original sale" : "Vente d'origine"}: ${data.source_sale_number}`);
    }
    // MP-EXCHANGE-HEADER-RECONCILE: an exchange is a refund event with
    // replacement items / a non-zero price difference. For a collect-more
    // exchange show what was COLLECTED (not "Refund total: 0 / Method: none");
    // for an even swap say so; otherwise it's a real refund/credit.
    const diff = Number(data.price_difference || 0);
    const replacements = Array.isArray(data.replacement_items) ? data.replacement_items : [];
    const isExchange = replacements.length > 0 || diff !== 0;
    lines.push("─────────────────────");
    (data.items_returned || []).forEach(i => {
      const total = Number(i.qty || 0) * Number(i.unit_price || 0);
      lines.push(`${isExchange ? (en ? "Returned: " : "Retour : ") : ""}${i.name || "?"} × ${i.qty} ........ ${fmtAmt(total)} F`);
    });
    if (isExchange && replacements.length) {
      replacements.forEach(i => {
        const up = Number(i.unit_price != null ? i.unit_price : (i.sell_price || 0));
        const total = Number(i.qty || i.quantity || 0) * up;
        lines.push(`${en ? "New: " : "Nouveau : "}${i.name || "?"} × ${i.qty || i.quantity} ........ ${fmtAmt(total)} F`);
      });
    }
    lines.push("─────────────────────");
    if (isExchange && diff > 0) {
      // Customer paid the difference — show the amount collected.
      lines.push(`*${en ? "Collected" : "Différence encaissée"}: ${fmtAmt(diff)} ${sym}*`);
      lines.push(`${en ? "Method" : "Mode"}: ${methodLbl(data.settlement_method || "cash")}`);
    } else if (isExchange && diff === 0) {
      lines.push(`*${en ? "Even exchange — no payment" : "Échange égal — aucun paiement"}*`);
    } else {
      // Pure refund OR cheaper-replacement exchange (refund/credit the diff).
      lines.push(`*${en ? "Refund total" : "Total remboursé"}: ${fmtAmt(data.refund_amount)} ${sym}*`);
      if (data.refund_method && data.refund_method !== "none") {
        lines.push(`${en ? "Method" : "Mode"}: ${methodLbl(data.refund_method)}`);
      }
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
    }
    if (data.customer_new_balance != null) {
      lines.push(`${en ? "New balance" : "Nouveau solde"}: ${fmtAmt(data.customer_new_balance)} ${sym}`);
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
    lines.push(`${en ? "Original total" : "Total d'origine"}: ${fmtAmt(data.original_total_amount)} ${sym}`);
    if (Number(data.original_paid_amount || 0) > 0) {
      lines.push(`${en ? "Originally paid" : "Initialement payé"}: ${fmtAmt(data.original_paid_amount)} ${sym}`);
    }
    // MP-VOID-CASH-AND-RETURNS-HANDLING Gap 1: surface the cash
    // going back to the customer for THIS void. Effective amount
    // already accounts for any prior refunds. Drawer reconciliation
    // picks it up via the synthesised pa_returns row at shift close.
    const cashRefund = Number(data.cash_refund_amount || 0);
    const priorRefundTotal = Number(data.prior_refund_total || 0);
    if (cashRefund > 0) {
      lines.push(`💵 *${en ? "Cash refund" : "Remboursement espèces"}: ${fmtAmt(cashRefund)} ${sym}*`);
      if (data.cash_refund_method && data.cash_refund_method !== "cash") {
        lines.push(`   ${en ? "Method" : "Mode"}: ${methodLbl(data.cash_refund_method)}`);
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
      lines.push(`${en ? "New customer balance" : "Nouveau solde client"}: ${fmtAmt(data.customer_new_balance)} ${sym}`);
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

  // MP-DAMAGED-GOODS: append a damaged marker to an item name for the printed
  // factures (thermal, A4) and history views, so a damaged-goods sale is
  // unmistakable on paper too. Server stamps is_damaged on the sale line.
  const dmgName = (i) => (i && i.is_damaged)
    ? `${i.name} (${en ? "DAMAGED GOODS" : "MARCHANDISE ENDOMMAGÉE"})`
    : (i ? i.name : "");

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

  // MP-RECEIPT-DOWNLOAD-QR: constant app-download QR for the advert footer.
  const [downloadQr, setDownloadQr] = useState("");
  useEffect(() => {
    let cancelled = false;
    genQr(PLAY_STORE_URL, 140).then(u => { if (!cancelled) setDownloadQr(u); });
    return () => { cancelled = true; };
  }, []);

  // MP-RECEIPT-PRINT-CLOSE-FIX: the facture/receipt is printed via an IN-APP
  // overlay (printHtml != null) instead of window.open(). A window.open()-spawned
  // window can't be reliably closed on Android System WebView (window.close() is
  // a no-op), which left an uncloseable layer over the app — tapping "Close" did
  // nothing and the only way out was force-quit. The overlay is plain React state,
  // so closePrint() ALWAYS dismisses and returns to the live app.
  const [printHtml, setPrintHtml] = useState(null);
  const openPrint = (inner) => setPrintHtml(inner);
  // MP-THERMAL-RECEIPT: 58mm (default, cheapest/most common) vs 80mm roll width,
  // remembered across receipts.
  const [thermalWidth, setThermalWidth] = useState(() => {
    try { return Number(localStorage.getItem("mp_thermal_width")) === 80 ? 80 : 58; } catch { return 58; }
  });
  const pickThermalWidth = (w) => {
    setThermalWidth(w);
    try { localStorage.setItem("mp_thermal_width", String(w)); } catch { /* ignore */ }
  };
  // MP-BT-THERMAL: Bluetooth printer picker state.
  const [btOpen, setBtOpen] = useState(false);
  const [btDevices, setBtDevices] = useState([]);
  const [btBusy, setBtBusy] = useState(false);
  const [btMsg, setBtMsg] = useState("");
  const btSupported = isBtPrintSupported();
  const closePrint = () => {
    setPrintHtml(null);
    document.body.classList.remove("mp-printing"); // defensive: never leave print state behind
  };
  // Belt-and-suspenders teardown. window.onafterprint is unreliable in Android
  // WebView, so we ALSO recover on visibilitychange/focus + a safety timeout —
  // independent of whether the user actually printed.
  useEffect(() => {
    if (!printHtml) return;
    document.body.classList.add("mp-printing");
    const afterPrint = () => closePrint();                         // auto-return when it fires
    const strip = () => document.body.classList.remove("mp-printing"); // defensive class strip
    const onVis = () => { if (document.visibilityState === "visible") strip(); };
    window.addEventListener("afterprint", afterPrint);
    window.addEventListener("focus", strip);
    document.addEventListener("visibilitychange", onVis);
    const safety = setTimeout(strip, 60000);
    return () => {
      window.removeEventListener("afterprint", afterPrint);
      window.removeEventListener("focus", strip);
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(safety);
      document.body.classList.remove("mp-printing");
    };
  }, [printHtml]);
  // If the whole receipt unmounts, never leave a print body-class behind.
  useEffect(() => () => document.body.classList.remove("mp-printing"), []);

  // Share the facture text (used by the print overlay's Partager button).
  const shareFacture = () => {
    const num = reference || data.sale_number || "";
    const txt = `FACTURE ${num}${org?.name ? " — " + org.name : ""}`;
    try { if (navigator.share) { navigator.share({ title: `FACTURE ${num}`, text: txt }); return; } } catch (e) { /* fall through */ }
    try { window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank"); } catch (e) { /* ignore */ }
  };

  // MP-RECEIPT-PRINT-ANDROID-FIX: the print overlay's "Print" button.
  // window.print() shows the browser print dialog on WEB, but in the Capacitor
  // Android System WebView it is a NO-OP that can FREEZE the WebView JS thread —
  // which left BOTH Print and the subsequent Close tap unresponsive (the reported
  // "stuck, must force-quit"). So on native we NEVER call window.print(): we route
  // to the OS share sheet (from there the user can Print / Save-as-PDF / send).
  // A direct thermal printout on native is the on-screen Bluetooth button, which
  // sends ESC/POS straight to the paired printer. btSupported === native app.
  const doOverlayPrint = async () => {
    if (!btSupported) { try { window.print(); } catch (e) { /* ignore */ } return; }
    // Native: hand the FULL receipt to the OS share sheet (Capacitor Share plugin)
    // so the user can Print / Save-as-PDF / send it; fall back to navigator.share
    // / wa.me if the plugin is unavailable. Never call window.print() here.
    const num = reference || data.sale_number || "";
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: `${en ? "Receipt" : "Reçu"} ${num}`, text: buildWhatsApp(), dialogTitle: en ? "Print / Share receipt" : "Imprimer / Partager le reçu" });
      return;
    } catch (e) { /* fall through */ }
    shareFacture();
  };

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
  // MP-THERMAL-RECEIPT: narrow 58/80mm paper receipt for thermal printers.
  // Reuses the SAME sale data as the A4 facture (items, discount net, cashier,
  // paid/balance) — opens in the existing print overlay → window.print().
  // Shared receipt-data shape used by BOTH the thermal-via-dialog and the
  // Bluetooth ESC/POS paths (same sale data, single source of truth).
  const saleReceiptOpts = (widthMm) => {
    const isDebt = (i) => i.type === "debt_payment" || i.isDebt || i.isDebtPayment
      || i.product_id === "__DEBT__" || i.product_id === "__DEBT_PAYMENT__";
    const items = (data.items || []).map((i) => isDebt(i)
      ? { name: i.name, quantity: 1, unit_price: Number(i.unit_price) || 0 }
      : { name: dmgName(i), quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0 });
    const grossItems = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
    const netTotal = Number(data.total_amount != null ? data.total_amount : grossItems) || 0;
    let saleTime = "";
    const ts = data.created_at || data.sale_date;
    if (ts && /T\d{2}:\d{2}/.test(String(ts))) saleTime = String(ts).slice(11, 16);
    return {
      org: org || {},
      lang,
      widthMm: widthMm || thermalWidth,
      saleNumber: reference || data.sale_number || "",
      saleDate: data.sale_date || "",
      saleTime,
      customerName: data.customer_name || data.customer?.name || null,
      cashierName: data.cashier_name || null,
      items,
      discountTotal: Math.max(0, grossItems - netTotal),
      paidAmount: data.paid_amount != null ? Number(data.paid_amount) : null,
      balanceDue: data.balance_due != null ? Number(data.balance_due) : null,
      paymentMethod: data.payment_method || "",
      paymentStatus: data.payment_status || "",
      // MP-RECEIPT-CODE-STYLE: per-org barcode/qr/both. HTML path uses the PNG
      // data URLs; the ESC/POS path draws native from saleNumber + codeStyle.
      qrDataUrl: codes.qr || "",
      barcodeDataUrl: codes.barcode || "",
      codeStyle: resolveCodeStyle(org),
      downloadQrDataUrl: downloadQr || "",
      // MP-SOLD-DATE-NOTE: purely a note line, undefined when no manual sold
      // date was recorded — the real saleDate above is untouched either way.
      soldDateNote: data.sold_date_note || null,
      soldDateNoteByName: data.sold_date_note_by_name || null,
    };
  };
  const printThermal = (widthMm) => openPrint(buildThermalReceipt(saleReceiptOpts(widthMm)));

  // ── MP-BT-THERMAL: direct Bluetooth ESC/POS print ─────────────────────────
  const openBtPicker = async () => {
    setBtMsg("");
    setBtOpen(true);
    setBtBusy(true);
    try {
      const devs = await listPairedPrinters();
      setBtDevices(devs);
      if (!devs.length) setBtMsg(en
        ? "No paired printers. Pair your printer in Android Bluetooth settings first, then refresh."
        : "Aucune imprimante jumelée. Jumelez-la dans les réglages Bluetooth Android, puis actualisez.");
    } catch (e) {
      setBtDevices([]);
      setBtMsg(e?.message || (en ? "Bluetooth unavailable" : "Bluetooth indisponible"));
    } finally { setBtBusy(false); }
  };

  const doBtPrint = async (deviceId) => {
    setBtBusy(true);
    try {
      await printSaleViaBluetooth(saleReceiptOpts(thermalWidth), deviceId);
      setBtOpen(false);
      toast.success(en ? "Sent to printer" : "Envoyé à l'imprimante");
    } catch (e) {
      const code = e?.code;
      if (code === "NO_DEVICE") { openBtPicker(); return; }
      toast.error(e?.message || (en ? "Print failed" : "Échec de l'impression"));
      // Graceful fallback to the system print dialog (thermal layout).
      if (code === "CONNECT_FAILED" || code === "BT_OFF" || code === "NO_BT" || code === "NOT_NATIVE") {
        setBtOpen(false);
        printThermal(thermalWidth);
      }
    } finally { setBtBusy(false); }
  };

  const printViaBluetooth = () => {
    const saved = getSavedPrinter();
    if (saved && saved.id) doBtPrint(saved.id);
    else openBtPicker();
  };

  const pickBtDevice = (dev) => { saveSavedPrinter(dev); doBtPrint(dev.id); };

  const printReceipt = () => {
    // SALE → shared Cameroon FACTURE builder (identical to the Reports → Sales
    // details print). No barcode/QR; amounts space-separated, no decimals.
    if (eventType === "sale") {
      const isDebt = (i) => i.type === "debt_payment" || i.isDebt || i.isDebtPayment
        || i.product_id === "__DEBT__" || i.product_id === "__DEBT_PAYMENT__";
      const items = (data.items || []).map((i) => isDebt(i)
        ? { name: i.name, quantity: 1, unit_price: Number(i.unit_price) || 0 }
        : { name: dmgName(i), quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0 });
      // MP-RECEIPT-PRINT-CLOSE-FIX: render the facture in an IN-APP overlay
      // (black-on-white + Imprimer/Partager/Fermer bar) instead of a separate
      // window.open() window. The overlay's Fermer is plain React state so it
      // ALWAYS dismisses; window.open() windows are uncloseable on Android WebView.
      // MP-DISCOUNT: facture shows Subtotal/Discount/Net when discounted.
      const grossItems = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
      const netTotal = Number(data.total_amount != null ? data.total_amount : grossItems) || 0;
      openPrint(buildFactureInner({
        org: org || {},
        lang,
        saleNumber: reference || data.sale_number || "",
        saleDate: data.sale_date || "",
        customerName: data.customer_name || data.customer?.name || "Comptant",
        cashierName: data.cashier_name || null, // MP-SALE-CASHIER-NAME: "Served by"
        items,
        discountTotal: Math.max(0, grossItems - netTotal),
        qrDataUrl: codes.qr || "", // MP-RECEIPT-CODE-STYLE
        barcodeDataUrl: codes.barcode || "",
        codeStyle: resolveCodeStyle(org),
        downloadQrDataUrl: downloadQr || "",
        soldDateNote: data.sold_date_note || null, // MP-SOLD-DATE-NOTE
        soldDateNoteByName: data.sold_date_note_by_name || null,
      }));
      return;
    }
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    // XAF has no cents: round to whole units and group thousands with a plain
    // space (e.g. 57000 -> "57 000", 20500 -> "20 500").
    const money = (n) => Math.round(Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");
    const currency = esc(currencySymbol(org?.currency));
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
        return `<tr><td class="c">${qty}</td><td>${esc(debt ? i.name : dmgName(i))}</td><td class="r">${money(pu)}</td><td class="r">${money(lt)}</td></tr>`;
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

    // MP-RECEIPT-PRINT-CLOSE-FIX: scoped INNER markup for the in-app overlay
    // (no window.open). Styles scoped under .mp-fac so nothing leaks to the app.
    const inner = `<style>
        .mp-fac, .mp-fac *{box-sizing:border-box;color:#000}
        .mp-fac{font-family:Arial,Helvetica,sans-serif;font-size:12px;background:#fff;max-width:440px;margin:0 auto;padding:10px}
        .mp-fac .center{text-align:center}
        .mp-fac .name{font-weight:bold;font-size:16px}
        .mp-fac .slogan{font-style:italic;font-size:11px}
        .mp-fac .small{font-size:11px;line-height:1.4}
        .mp-fac .logo{max-height:70px;max-width:200px;object-fit:contain}
        .mp-fac .title{text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px;margin:12px 0 4px}
        .mp-fac .meta{font-size:12px}
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
        .mp-fac hr.sep{border:none;border-top:1px dashed #000;margin:8px 0}
      </style>
      <div class="mp-fac">
        ${letterhead}
        ${bodyHtml}
      </div>`;
    openPrint(inner);
  };

  return (
    <>
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
              {data.cashier_name && <div>{en ? "Served by" : "Servi par"}: <strong>{data.cashier_name}</strong></div>}
              {data.location_name && <div>{en ? "Location" : "Emplacement"}: <strong>{data.location_name}</strong></div>}
              <div>{dateStr} · {timeStr}</div>
            </div>

            {/* MP-SOLD-DATE-NOTE: a NOTE only — the date/time above is the real
                receipt date, unchanged. Shown only when a manual sold date was
                recorded on this sale. */}
            {eventType === "sale" && data.sold_date_note && (
              <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", fontSize: 11, color: "#fbbf24", lineHeight: 1.5 }}>
                {/* MP-SOLD-DATE-NOTE (Peter, 2026-07-18): show the sold date AND the true
                    record stamp side by side, so the boss sees both dates + who recorded it. */}
                {en ? "NOTE — Sold Date: " : "NOTE — Date de vente : "}
                <strong>{fmtSoldDateNote(data.sold_date_note)}</strong>
                {data.sold_date_note_by_name ? (en ? ` · recorded by ${data.sold_date_note_by_name}` : ` · saisi par ${data.sold_date_note_by_name}`) : ""}
                {data.sold_date_note_at ? (en
                  ? ` · recorded ${new Date(data.sold_date_note_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : ` · enregistré ${new Date(data.sold_date_note_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`) : ""}
              </div>
            )}

            {reference && (codes.qr || codes.barcode) && (() => {
              const st = resolveCodeStyle(org);
              const showBar = (st === "barcode" || st === "both") && codes.barcode;
              const showQr = (st === "qr" || st === "both") && codes.qr;
              if (!showBar && !showQr) return null;
              return (
                <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 10, textAlign: "center", background: "#fff", borderRadius: 8, padding: "10px 0" }}>
                  {showBar && <div><img src={codes.barcode} alt="barcode" style={{ height: 46, maxWidth: "92%" }} /></div>}
                  {showQr && <div style={{ marginTop: showBar ? 6 : 0 }}><img src={codes.qr} alt="qr" style={{ width: 110, height: 110 }} /></div>}
                  <div style={{ fontSize: 11, color: "#000", fontFamily: "monospace", fontWeight: 700 }}>{reference}</div>
                </div>
              );
            })()}
            {/* MP-RECEIPT-ADVERT: bottom advert, language by org country, org toggle. */}
            {advertLines(org).length > 0 && (
              <div style={{ marginTop: 8, textAlign: "center", fontSize: 11, color: "#000", lineHeight: 1.4 }}>
                {advertLines(org).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            {/* MP-RECEIPT-DOWNLOAD-QR: app-download QR in the advert footer (same toggle). */}
            {showDownloadQr(org) && downloadQr && (
              <div style={{ marginTop: 6, textAlign: "center", fontSize: 10.5, color: "#000", lineHeight: 1.35 }}>
                {downloadQrCaptionLines(org).map((l, i) => <div key={i}>{l}</div>)}
                <div><img src={downloadQr} alt="app download" style={{ width: 72, height: 72, marginTop: 2 }} /></div>
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
            🖨️ {en ? "Print Receipt (A4)" : "Imprimer reçu (A4)"}
          </button>
          {/* MP-THERMAL-RECEIPT: paper receipt for 58/80mm thermal printers. */}
          {eventType === "sale" && (
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <button onClick={() => printThermal()}
                style={{ flex: 1, padding: "11px", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                🧾 {en ? "Thermal" : "Reçu thermique"}
              </button>
              <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
                {[58, 80].map((w) => (
                  <button key={w} onClick={() => pickThermalWidth(w)} title={`${w}mm`}
                    style={{ padding: "0 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
                      background: thermalWidth === w ? "var(--brand)" : "transparent",
                      color: thermalWidth === w ? "#152B52" : "var(--text-secondary)" }}>
                    {w}mm
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* MP-BT-THERMAL: direct Bluetooth printing (Android app only). */}
          {eventType === "sale" && btSupported && (
            <button onClick={printViaBluetooth} disabled={btBusy}
              style={{ width: "100%", padding: "11px", background: "var(--bg-card)", border: "1px solid var(--brand)", color: "var(--brand-light)", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: btBusy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              🖨️ {btBusy ? (en ? "Printing…" : "Impression…") : (en ? "Print (Bluetooth)" : "Imprimer (Bluetooth)")}
              {(() => { const sp = getSavedPrinter(); return sp && sp.name ? <span style={{ fontWeight: 500, fontSize: 11, opacity: 0.8 }}>· {sp.name}</span> : null; })()}
            </button>
          )}
          <button onClick={onClose}
            style={{ width: "100%", padding: "9px", background: "transparent", border: "none", color: "var(--text-muted)", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            {en ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    </div>

    {/* MP-BT-THERMAL: paired-printer picker. */}
    {btOpen && (
      <div style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        onClick={() => { if (!btBusy) setBtOpen(false); }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ width: "100%", maxWidth: 480, background: "var(--bg-surface, #1b2436)", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>{en ? "Choose Bluetooth printer" : "Choisir l'imprimante Bluetooth"}</strong>
            <button onClick={openBtPicker} disabled={btBusy}
              style={{ fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
              {btBusy ? (en ? "Scanning…" : "Recherche…") : (en ? "Refresh" : "Actualiser")}
            </button>
          </div>
          {btMsg && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{btMsg}</div>}
          {btDevices.map((d) => (
            <button key={d.id} onClick={() => pickBtDevice(d)} disabled={btBusy}
              style={{ width: "100%", textAlign: "left", padding: "12px", marginBottom: 8, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", cursor: "pointer" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name || (en ? "Unnamed device" : "Appareil sans nom")}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{d.id}</div>
            </button>
          ))}
          <button onClick={() => setBtOpen(false)} disabled={btBusy}
            style={{ width: "100%", padding: "9px", marginTop: 4, background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {en ? "Cancel" : "Annuler"}
          </button>
        </div>
      </div>
    )}

    {/* MP-RECEIPT-PRINT-CLOSE-FIX: in-app print overlay (replaces window.open).
        z-index 4000 sits ABOVE the receipt modal (300); its Fermer button is the
        topmost layer so its tap target is never covered, and closePrint() always
        resets state. window.print() is isolated to this overlay via the @media
        print rules below; the <style> + overlay unmount together so no print CSS
        can linger. */}
    {printHtml && (
      <div className="mp-print-overlay"
        style={{ position: "fixed", inset: 0, zIndex: 4000, background: "#fff", color: "#000", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .mp-print-overlay, .mp-print-overlay * { visibility: visible !important; }
            .mp-print-overlay { position: absolute !important; inset: 0 !important; }
            .mp-print-overlay .no-print { display: none !important; }
            .mp-print-overlay .mp-print-body { padding-top: 0 !important; }
          }
        `}</style>
        {/* MP-RECEIPT-PRINT-ANDROID-FIX: FIXED (not sticky) action bar so it can
            never scroll off-screen on the Android WebView — Close is always
            reachable. Print routes through doOverlayPrint (native-safe). */}
        <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 4001, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", padding: 10, background: "#fff", borderBottom: "1px solid #ccc" }}>
          <button onClick={doOverlayPrint}
            style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none", background: "#152B52", color: "#fff", cursor: "pointer" }}>
            🖨️ {btSupported ? (en ? "Print / Share" : "Imprimer / Partager") : (en ? "Print" : "Imprimer")}
          </button>
          <button onClick={shareFacture}
            style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "1px solid #152B52", background: "#fff", color: "#152B52", cursor: "pointer" }}>
            🔗 {en ? "Share" : "Partager"}
          </button>
          <button onClick={closePrint}
            style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "1px solid #999", background: "#fff", color: "#333", cursor: "pointer" }}>
            ✕ {en ? "Close" : "Fermer"}
          </button>
        </div>
        <div className="mp-print-body" style={{ paddingTop: 60 }} dangerouslySetInnerHTML={{ __html: printHtml }} />
      </div>
    )}
    </>
  );
}

// Default export wraps the inner render in the error boundary so
// a render-time crash shows the fallback notice instead of an
// unmounted blank screen. Props pass through transparently.
export default function PaymentEventReceipt(props) {
  const saleRef = props?.data?.sale_number || props?.data?.reference || props?.reference || "";
  return (
    <_ReceiptErrorBoundary lang={props.lang} onClose={props.onClose} saleRef={saleRef}>
      <PaymentEventReceiptInner {...props} />
    </_ReceiptErrorBoundary>
  );
}
