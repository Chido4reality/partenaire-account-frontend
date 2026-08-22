// MP-PAYMENT-BREAKDOWN — one sentence that says how a sale was actually paid.
//
// WHY THIS EXISTS
// Peter hit it on VNT-20260822-0003: total 9,550, paid 5,000, credit 4,550. He
// opened Void/Return and the header said "9,550 FCFA". The refund maths was
// right — debt-first cancels the 4,550 still owed and returns only the 5,000
// actually collected — but NOTHING on the way there told him the sale was split.
// A worker who did not personally ring the sale up has no way to know how much
// cash to hand over, and the only number in front of them is the one they must
// NOT hand over.
//
// So the rule is: wherever a sale's money is shown, show its STRUCTURE, in one
// order everywhere — goods total, then what was paid, then what was credited.
//
// ⚠️ ONLY WHEN THERE IS SOMETHING TO DISAMBIGUATE. A fully-paid sale reading
// "Total 9,550 · Paid 9,550 · Credit 0" is noise, and noise is how the useful
// case gets skipped. Fully paid → returns null, and the caller shows the plain
// total exactly as before.

const n = (v) => Number(v) || 0;

// Does this sale have a payment structure worth spelling out?
// Keyed on the MONEY, not on payment_status: status is a label that has been
// wrong before, while total/paid are the figures the refund itself is computed
// from. A sale with any unpaid balance qualifies, whatever it is labelled.
export function hasSplitPayment(sale) {
  if (!sale) return false;
  const total = n(sale.total_amount);
  const paid = n(sale.paid_amount);
  return total > 0 && paid < total;
}

// Structured parts, for callers that want to style each piece.
// Returns null when there is nothing to disambiguate.
export function paymentParts(sale, lang) {
  if (!hasSplitPayment(sale)) return null;
  const en = lang === "en";
  const total = n(sale.total_amount);
  const paid = n(sale.paid_amount);
  // Derive the credit rather than trusting balance_due: balance_due is a
  // GENERATED column and correct today, but this line's whole job is to agree
  // with the two numbers beside it. Deriving makes disagreement impossible.
  const credit = Math.max(0, total - paid);
  return {
    total, paid, credit,
    labels: {
      total:  en ? "Total"  : "Total",
      paid:   en ? "Paid"   : "Payé",
      credit: en ? "Credit" : "Crédit",
    },
  };
}

// The one-line form: "Total 9,550 · Paid 5,000 · Credit 4,550".
// `fmt` is the caller's currency formatter. Returns null when fully paid.
export function paymentBreakdownLine(sale, lang, fmt) {
  const p = paymentParts(sale, lang);
  if (!p) return null;
  const f = typeof fmt === "function" ? fmt : (v) => String(v);
  return `${p.labels.total} ${f(p.total)} · ${p.labels.paid} ${f(p.paid)} · ${p.labels.credit} ${f(p.credit)}`;
}

// ── THE REFUND INSTRUCTION ───────────────────────────────────────────────────
// On a split sale, a refund does two different things and only ONE of them is a
// physical act: the credit portion cancels debt (nothing to do), the cash
// portion is money leaving the drawer right now. Those two were rendered as
// equal-weight muted text side by side. This returns just the actionable half so
// a caller can style it as the instruction it is.
// Returns null when no cash is actually going out.
export function cashToHandBack(refundData, lang, fmt) {
  if (!refundData) return null;
  const cash = n(refundData.cash_portion);
  if (cash <= 0) return null;
  const en = lang === "en";
  const f = typeof fmt === "function" ? fmt : (v) => String(v);
  return en
    ? `Hand back ${f(cash)} in cash`
    : `Remettre ${f(cash)} en espèces`;
}
