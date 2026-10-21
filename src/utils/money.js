// WHOLE-FRANC MONEY (2026-10-21) — the POS side of the backend's canonical rule
// (backend src/lib/derivePayment.js + src/lib/unitPriceRounding.js). Keep the two identical.
//
// VNT-20261021-0022: a cashier typed 1,833.333 for 24 bottles. The server books that line as
// 44,000 and the sale as 143,000; the POS summed 24 × 1,833.333 and sent paid 142,999.992. The
// 0.008 difference made a fully-paid sale 'partial' and asked the owner to approve a credit.
//
// XAF and NGN are whole units (pa_sales / pa_sale_items money is numeric(12,0)), so:
//   lineMoney(q, price)  a line's money as the server will store it — never q × a typed fraction
//   wholeMoney(x)        any amount, rounded to a whole unit before it is compared or sent
//   isCreditAmount(x)    a balance is only owed from one whole unit up
//   paymentStatusFor(total, paid)  'paid' | 'partial' | 'credit' from whole numbers

export function wholeMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Mirrors roundLinePrice(...).money: a fractional price → round(q × price); a whole price with a
// fractional quantity → the fraction is dropped (floor); whole × whole is exact.
export function lineMoney(quantity, unitPrice) {
  const q = Number(quantity) || 0;
  const u = Number(unitPrice) || 0;
  if (Number.isInteger(u)) {
    const exact = q * u;
    const floor = Math.floor(exact + 1e-9);
    return Math.round((exact - floor) * 1000) / 1000 > 0 ? floor : Math.round(exact);
  }
  // 1e-9 absorbs float noise (5000/12 × 12 = 4999.999…) before the whole-unit round.
  return Math.round(q * u + 1e-9);
}

export function isCreditAmount(balance) {
  return wholeMoney(balance) >= 1;
}

export function paymentStatusFor(total, paid) {
  const t = wholeMoney(total), p = wholeMoney(paid);
  if (!isCreditAmount(t - p)) return "paid";
  return p > 0 ? "partial" : "credit";
}
