// MP-WHATSAPP-RECEIPT-RICH-FORMAT (Path A)
//
// Fixed-width monospace receipt renderer. Output is a plain string
// suitable for wrapping in a triple-backtick code fence so WhatsApp
// renders it monospace on both Android and iOS.
//
// One renderer per event type (sale / debt_collection / invoice_payment
// / refund / void). All branches share the same column geometry so a
// recipient can scan multiple receipts as a coherent set.
//
// WIDTH is the right edge of the receipt. Kept at 35 so portrait
// phones don't wrap. Box-drawing chars (═ ─ │ ║) are single-code-unit
// in JS and render at one cell in WhatsApp's monospace stack on both
// platforms in our testing.
//
// A future Path B (image-rendered receipt with a real Code-128) can
// reuse the per-event data extraction in this file; the renderer hook
// would diverge at the ascii barcode line and at the output sink.

const WIDTH = 35;

const fmtAmt = (n) => (Number(n) || 0).toLocaleString();

// ── Geometry helpers ────────────────────────────────────────────

function repeat(ch, n) { return ch.repeat(Math.max(0, n)); }

// Truncate-or-pad to exactly `w` chars (default WIDTH). Long strings
// get an ellipsis to keep the column alignment intact.
function fitWidth(s, w = WIDTH) {
  if (s.length === w) return s;
  if (s.length <  w) return s + repeat(" ", w - s.length);
  return s.slice(0, w - 1) + "…";
}

function centerLine(text, w = WIDTH) {
  if (text.length >= w) return fitWidth(text, w);
  const pad = w - text.length;
  const left = Math.floor(pad / 2);
  return repeat(" ", left) + text + repeat(" ", pad - left);
}

// Two-column "Label   value" row. Label gets the left LWIDTH (16 by
// default) padded; value right-aligned into the rest. Label is hard-
// truncated rather than wrapped so the value column never drifts.
function kvLine(label, value, w = WIDTH, lwidth = 16) {
  const lab = fitWidth(String(label || ""), lwidth);
  const val = String(value == null ? "" : value);
  const right = w - lwidth;
  if (val.length >= right) return lab + val.slice(0, right);
  return lab + repeat(" ", right - val.length) + val;
}

// Item row: "  name × qty            1,200 F"
//   indent (2) + name padded to 15 + " × qty " padded to 6 + amount
//   right-aligned into the remainder (12). Total = 2 + 15 + 6 + 12 = 35.
function itemLine(name, qty, amount, w = WIDTH) {
  const left  = "  " + fitWidth(String(name || "?"), 15);
  const mid   = fitWidth(`× ${qty}`, 6);
  const amt   = `${fmtAmt(amount)} F`;
  const right = w - left.length - mid.length;
  if (amt.length >= right) return left + mid + amt.slice(0, right);
  return left + mid + repeat(" ", right - amt.length) + amt;
}

// Amount-only line, label left-aligned, amount right-aligned. Used
// for totals/paid/balance/refund-total etc.
function amountLine(label, amount, w = WIDTH, lwidth = 22) {
  const lab = fitWidth(String(label || ""), lwidth);
  const amt = `${fmtAmt(amount)} F`;
  const right = w - lwidth;
  if (amt.length >= right) return lab + amt.slice(0, right);
  return lab + repeat(" ", right - amt.length) + amt;
}

// Deterministic ascii pseudo-barcode. Same ref → same pattern, so
// reissuing a receipt looks consistent. Not scannable — this is a
// visual flourish to evoke the printable receipt's Code-128 strip.
const _BAR_GLYPHS = ["│", "║", "│║", "║│", "│ ", " ║", "║│ "];
function asciiBarcode(ref, w = 25) {
  const s = String(ref || "RET");
  let out = "";
  let i = 0;
  while (out.length < w) {
    const c = s.charCodeAt(i % s.length);
    out += _BAR_GLYPHS[(c + i) % _BAR_GLYPHS.length];
    i++;
  }
  return out.slice(0, w);
}

// "VNT-20260523-0010" → "VNT-0010". For the centered short ref on
// the barcode strip — full ref already rendered at the top.
function shortRef(ref) {
  if (!ref) return "";
  const m = /-(\d+)$/.exec(String(ref));
  return m ? `${String(ref).split("-")[0]}-${m[1]}` : String(ref);
}

// ── Per-event titles (kept short so they fit the kv label column) ─

const TITLE_BY_TYPE = {
  sale:            { en: "RECEIPT",          fr: "REÇU" },
  debt_collection: { en: "DEBT COLLECTION",  fr: "ENCAISSEMENT" },
  invoice_payment: { en: "INVOICE PAYMENT",  fr: "PAIEMENT FACTURE" },
  refund:          { en: "REFUND",           fr: "REMBOURSEMENT" },
  void:            { en: "VOID",             fr: "ANNULATION" },
};

function pickReference(eventType, data) {
  if (eventType === "refund") return data.return_ref || null;
  return data.sale_number || null;
}

// ── Date helpers ────────────────────────────────────────────────

function fmtDateTime(lang) {
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const d = new Date();
  const dateStr = d.toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  return `${dateStr}, ${timeStr}`;
}

// ── Shared receipt frame ────────────────────────────────────────

function pushHeader(L, org) {
  L.push(repeat("═", WIDTH));
  L.push(centerLine(org?.name || "Boutique"));
  if (org?.address) L.push(centerLine(org.address));
  if (org?.city)    L.push(centerLine(org.city));
  if (org?.phone)   L.push(centerLine(`Tel: ${org.phone}`));
  L.push(repeat("═", WIDTH));
}

function pushBarcodeStrip(L, ref) {
  if (!ref) return;
  L.push(repeat("═", WIDTH));
  L.push(centerLine(asciiBarcode(ref, 25)));
  L.push(centerLine(shortRef(ref)));
  L.push(centerLine(asciiBarcode(ref, 25)));
  L.push(repeat("═", WIDTH));
}

function pushFooter(L, org, lang) {
  const en = lang === "en";
  const footer = org?.receipt_footer
    || (en ? "Thank you! · Merci!" : "Merci! · Thank you!");
  L.push(centerLine(footer));
}

// ── Per-event body sections ─────────────────────────────────────

function bodySale(L, data, lang) {
  const en = lang === "en";
  const items = data.items || [];
  L.push(repeat("─", WIDTH));
  L.push(en ? "ITEMS" : "ARTICLES");
  items.forEach(i => {
    if (i.type === "debt_payment") {
      L.push(itemLine(`💰 ${i.name || "Debt"}`, "", i.unit_price));
    } else {
      L.push(itemLine(i.name, i.quantity, (Number(i.quantity) || 0) * (Number(i.unit_price) || 0)));
    }
  });
  const total = items.reduce((s, i) =>
    s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const paid    = Number(data.paid_amount ?? total) || 0;
  const balance = total - paid;
  const status  = data.payment_status;
  L.push(repeat("─", WIDTH));
  L.push(amountLine(en ? "TOTAL" : "TOTAL", total));
  if (status === "paid") {
    const m = data.payment_method ? ` (${data.payment_method})` : "";
    L.push(amountLine(`${en ? "PAID" : "PAYÉ"}${m}`, paid));
    L.push(amountLine(en ? "BALANCE" : "RESTE", 0));
  } else if (status === "credit") {
    L.push(amountLine(en ? "CREDIT — unpaid" : "CRÉDIT — non payé", 0));
    L.push(amountLine(en ? "DUE" : "DÛ", total));
  } else if (status === "partial") {
    L.push(amountLine(en ? "PAID" : "PAYÉ", paid));
    L.push(amountLine(en ? "BALANCE" : "RESTE", balance));
  } else {
    L.push(amountLine(en ? "PAID" : "PAYÉ", paid));
    if (balance !== 0) L.push(amountLine(en ? "BALANCE" : "RESTE", balance));
  }
}

function bodyDebtCollection(L, data, lang) {
  const en = lang === "en";
  const applied = data.applied_to_invoices || [];
  const ghost   = Number(data.ghost_portion || 0);
  L.push(repeat("─", WIDTH));
  L.push(amountLine(en ? "AMOUNT PAID" : "MONTANT PAYÉ", data.amount));
  if (data.payment_method) L.push(kvLine(en ? "Method" : "Mode", data.payment_method));
  if (applied.length || ghost > 0) {
    L.push(repeat("─", WIDTH));
    L.push(en ? "APPLIED TO" : "IMPUTÉ SUR");
    applied.forEach(inv => {
      if (!inv) return;
      const ref = inv.sale_number || inv.sale_id || "?";
      const raw = inv.applied ?? inv.amount ?? inv.applied_amount ?? 0;
      L.push(itemLine(ref, "", raw));
    });
    if (ghost > 0) {
      L.push(itemLine(en ? "Outstanding (no invoice)" : "Dette sans facture", "", ghost));
    }
  }
  L.push(repeat("─", WIDTH));
  if (data.debt_before != null) L.push(amountLine(en ? "Prev. balance" : "Solde préc.", data.debt_before));
  if (data.debt_after  != null) L.push(amountLine(en ? "NEW BALANCE"   : "NOUVEAU SOLDE", data.debt_after));
}

function bodyInvoicePayment(L, data, lang) {
  const en = lang === "en";
  L.push(repeat("─", WIDTH));
  if (data.sale_number) L.push(kvLine(en ? "Invoice" : "Facture", data.sale_number));
  L.push(amountLine(en ? "AMOUNT PAID" : "MONTANT PAYÉ", data.amount));
  if (data.payment_method) L.push(kvLine(en ? "Method" : "Mode", data.payment_method));
  L.push(repeat("─", WIDTH));
  if (data.sale_total != null)       L.push(amountLine(en ? "Invoice total" : "Total facture", data.sale_total));
  if (data.sale_paid_before != null) L.push(amountLine(en ? "Paid before"   : "Payé avant",    data.sale_paid_before));
  if (data.sale_paid_after  != null) L.push(amountLine(en ? "Paid after"    : "Payé après",    data.sale_paid_after));
  if (data.balance_after    != null) {
    const lab = data.payment_status === "paid"
      ? (en ? "SETTLED" : "SOLDÉ")
      : (en ? "BALANCE" : "RESTE");
    L.push(amountLine(lab, data.balance_after));
  }
  if (data.debt_before != null && data.debt_after != null) {
    L.push(repeat("─", WIDTH));
    L.push(amountLine(en ? "Customer before" : "Client avant", data.debt_before));
    L.push(amountLine(en ? "Customer after"  : "Client après", data.debt_after));
  }
}

function bodyRefund(L, data, lang) {
  const en = lang === "en";
  L.push(repeat("─", WIDTH));
  if (data.source_sale_number) {
    L.push(kvLine(en ? "Original sale" : "Vente d'origine", data.source_sale_number));
  }
  L.push(en ? "ITEMS RETURNED" : "ARTICLES RENDUS");
  (data.items_returned || []).forEach(i => {
    const total = (Number(i.qty) || 0) * (Number(i.unit_price) || 0);
    L.push(itemLine(i.name, i.qty, total));
  });
  L.push(repeat("─", WIDTH));
  const m = data.refund_method ? ` (${data.refund_method})` : "";
  L.push(amountLine(`${en ? "REFUND TOTAL" : "TOTAL REMB."}${m}`, data.refund_amount));
  const credit = Number(data.credit_portion || 0);
  const cash   = Number(data.cash_portion   || 0);
  if (credit > 0 && cash > 0) {
    L.push(amountLine(en ? "  to credit account" : "  au compte crédit", credit));
    L.push(amountLine(en ? "  cash returned"     : "  rendu en espèces", cash));
  } else if (credit > 0) {
    L.push(amountLine(en ? "  to credit account" : "  au compte crédit", credit));
  }
  if (data.customer_new_balance != null) {
    L.push(amountLine(en ? "NEW BALANCE" : "NOUVEAU SOLDE", data.customer_new_balance));
  }
}

function bodyVoid(L, data, lang) {
  const en = lang === "en";
  L.push(repeat("─", WIDTH));
  L.push(kvLine(en ? "Voided sale" : "Vente annulée", data.sale_number || ""));
  L.push(en ? "ITEMS" : "ARTICLES");
  (data.items_returned || []).forEach(i => {
    const qty       = Number(i.qty) || 0;
    const priorQty  = Number(i.qty_already_returned) || 0;
    if (i.line_type === "debt_payment") {
      L.push(itemLine(`💰 ${i.name || "?"}`, "", i.unit_price));
      return;
    }
    if (qty <= 0) {
      if (priorQty > 0) {
        L.push(itemLine(`${i.name || "?"} (returned)`, 0, 0));
      }
      return;
    }
    L.push(itemLine(i.name, qty, qty * (Number(i.unit_price) || 0)));
  });
  L.push(repeat("─", WIDTH));
  if (data.original_total_amount != null) {
    L.push(amountLine(en ? "Original total" : "Total d'origine", data.original_total_amount));
  }
  if (Number(data.original_paid_amount) > 0) {
    L.push(amountLine(en ? "Originally paid" : "Initial. payé", data.original_paid_amount));
  }
  const cashRefund = Number(data.cash_refund_amount || 0);
  if (cashRefund > 0) {
    const m = data.cash_refund_method && data.cash_refund_method !== "cash"
      ? ` (${data.cash_refund_method})` : "";
    L.push(amountLine(`${en ? "CASH REFUND" : "REMB. ESPÈCES"}${m}`, cashRefund));
    if (data.cash_refund_ref) {
      L.push(kvLine(en ? "Refund ref" : "Réf. remb.", data.cash_refund_ref));
    }
  }
  if (data.reason) {
    L.push(repeat("─", WIDTH));
    // Reason can be long — naive 33-char wrap (2-char indent allowed).
    const r = String(data.reason);
    const head = en ? "Reason: " : "Motif: ";
    const first = (head + r).slice(0, WIDTH);
    L.push(first);
    let rest = (head + r).slice(WIDTH);
    while (rest.length > 0) {
      L.push("  " + rest.slice(0, WIDTH - 2));
      rest = rest.slice(WIDTH - 2);
    }
  }
  if (data.customer_new_balance != null) {
    L.push(amountLine(en ? "NEW BALANCE" : "NOUVEAU SOLDE", data.customer_new_balance));
  }
}

// ── Main entrypoint ─────────────────────────────────────────────

export function buildMonospaceReceipt(eventType, data, lang, org) {
  if (!data) return "";
  const en = lang === "en";
  const title = (TITLE_BY_TYPE[eventType] || TITLE_BY_TYPE.sale)[en ? "en" : "fr"];
  const ref   = pickReference(eventType, data);
  const customerName = data.customer_name || data.customer?.name || null;
  const dateTime = fmtDateTime(lang);

  const L = [];
  pushHeader(L, org);
  L.push(kvLine(title, ref || ""));
  L.push(kvLine(en ? "Date" : "Date", dateTime));
  if (data.cashier_name)  L.push(kvLine(en ? "Cashier" : "Caissier", data.cashier_name));
  if (data.location_name) L.push(kvLine(en ? "Location" : "Site",    data.location_name));
  if (customerName)       L.push(kvLine(en ? "Customer" : "Client",  customerName));

  switch (eventType) {
    case "debt_collection": bodyDebtCollection(L, data, lang); break;
    case "invoice_payment": bodyInvoicePayment(L, data, lang); break;
    case "refund":          bodyRefund(L, data, lang);         break;
    case "void":            bodyVoid(L, data, lang);           break;
    case "sale":
    default:                bodySale(L, data, lang);           break;
  }

  pushBarcodeStrip(L, ref);
  pushFooter(L, org, lang);
  return L.join("\n");
}

// Exported for inline tests + so the WA caller can do exact fence
// wrapping without re-typing the backticks.
export function wrapMonospaceFence(body) {
  return "```\n" + body + "\n```";
}
