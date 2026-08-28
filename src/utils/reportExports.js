// MP-REPORT-EXPORTS — the row builders and the ONE CSV serialiser.
//
// Regression-pass Section A item #7 is "blank CSV export". The blank-file half
// is genuinely fixed — both exporters refuse an empty range and say so rather
// than handing over a header-only file. What was still wrong when a check was
// finally written for it (2026-08-28) is worse, because it does not announce
// itself:
//
//   ReportsPage had THREE exporters and they did not agree.
//     · exportLedgerCSV  quoted every field correctly
//     · exportCSV        r.join(",")  — unescaped
//     · exportSalesCSV   r.join(",")  — unescaped, AND it emits customer and
//                                       product names
//
// A product called "Oil 20L, blue" or a customer called "Doe, John" shifts
// every later column by one. The file still opens; the numbers are simply in
// the wrong columns, which is harder to notice than a blank file and worse to
// act on. On prod today ZERO product or customer names contain a comma, a quote
// or a newline — so this was latent, not live. Nothing validates against it,
// and one natural product name makes it live.
//
// So there is now ONE serialiser. Three implementations meant two were wrong;
// the fix is not "escape in the other two", it is "have one place to be right".

// ── row predicates, shared with the on-screen report so the export and the
// screen cannot disagree about what a debt line is ──────────────────────────
export const isDebtItem = (i) => i?.line_type === "debt_payment" || (i && i.product_id === null);
export const itemAmount = (i) => (Number(i?.quantity) || 0) * (Number(i?.unit_price) || 0);

// RFC 4180. Quote everything and double any embedded quote — the simple rule
// that is correct for commas, quotes and newlines alike, rather than three
// conditional escapes that each need to be right.
//
// ⚠️ This quotes EVERY field, so a row reads "2026-08-28","1500" rather than
// 2026-08-28,1500. Excel, Sheets, LibreOffice and every real CSV reader treat
// the two identically. A hand-rolled consumer that splits on raw commas would
// see a difference; no such consumer is known.
export function toCsv(rows) {
  return (rows || [])
    .map((r) => (r || []).map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

// ── Daily Summary ───────────────────────────────────────────────────────────
export const DAILY_SUMMARY_HEADER = [
  "Date", "Sales", "Cash Collected", "Credit Given", "Cost",
  "Gross Profit", "Margin%", "Expenses", "Net Profit", "Transactions",
];

export function buildDailySummaryRows(daily) {
  const rows = (daily || []).map((d) => [
    d.sale_date, d.gross_sales, d.cash_collected, d.credit_given, d.total_cost,
    d.gross_profit, d.profit_margin_pct, d.total_expenditure, d.net_profit, d.sale_count,
  ]);
  // Header ONLY when there is something under it. A header-only file is the
  // original #7 complaint; the callers also refuse the empty case, and this
  // makes the builder honest on its own rather than by the caller's grace.
  return rows.length ? [DAILY_SUMMARY_HEADER, ...rows] : [];
}

// ── Sales Detail ────────────────────────────────────────────────────────────
export const SALES_DETAIL_HEADER = [
  "Sale#", "Date", "Customer", "Product / Line Type", "Qty",
  "Unit Price", "Line Total", "Payment Status",
];

// ONE LINE PER SALE ITEM, not per sale — a sale with three products is three
// rows, which is what "one line per row" means for this export and what the
// check asserts.
export function buildSalesDetailRows(sales) {
  const rows = [];
  for (const sale of sales || []) {
    for (const item of sale.pa_sale_items || []) {
      rows.push([
        sale.sale_number,
        sale.sale_date,
        sale.pa_customers?.name || "Walk-in",
        isDebtItem(item) ? "Debt Repayment" : (item.pa_products?.name || ""),
        item.quantity,
        item.unit_price,
        itemAmount(item).toFixed(0),
        sale.payment_status,
      ]);
    }
  }
  return rows.length ? [SALES_DETAIL_HEADER, ...rows] : [];
}
