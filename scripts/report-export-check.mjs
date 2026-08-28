// ── REPORT EXPORT CHECK — regression-pass Section A item #7 ─────────────────
//   npm run export-check
//
// #7 is "blank CSV export — assert the export has a non-empty header row and
// one line per row for a known date range". Both of those are asserted below.
//
// ⚠️ THE ROUND TRIP IS PARSED BY SheetJS, NOT BY A READER WRITTEN HERE.
// A check that parses our CSV with our own splitter is testing the writer
// against a reader built from the same misunderstanding — it would agree that
// `Oil 20L, blue` is two columns just as confidently as the bug does. xlsx is
// already a dependency of this app and is an independent implementation, so the
// assertion is "a real spreadsheet tool reads back exactly what we put in".
//
// ⚠️ THE FIXTURE IS DELIBERATELY HOSTILE. A product name containing a comma, a
// double quote and a newline; a customer name containing a comma. Prod has zero
// of these today — which is exactly why the bug survived: every real export
// happened to be well-formed. A benign fixture reproduces that blind spot.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(HERE, "../src");
const OUT  = resolve(HERE, "__exports.mjs");

await build({
  stdin: {
    contents: `export * from "./utils/reportExports";`,
    resolveDir: SRC, loader: "js", sourcefile: "export-entry.js",
  },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));

// Parse with SheetJS exactly as a spreadsheet would.
const parse = (csv) => XLSX.utils.sheet_to_json(
  XLSX.read(csv, { type: "string", raw: true }).Sheets.Sheet1, { header: 1, blankrows: false, defval: "" });

const NASTY_PRODUCT  = 'Oil 20L, "blue"\nsecond line';
const NASTY_CUSTOMER = "Doe, John";

const SALES = [
  { sale_number: "VNT-1", sale_date: "2026-08-20", payment_status: "paid",
    pa_customers: { name: NASTY_CUSTOMER },
    pa_sale_items: [
      { quantity: 2, unit_price: 6000, pa_products: { name: NASTY_PRODUCT }, product_id: "p1", line_type: "product" },
      { quantity: 1, unit_price: 1000, pa_products: { name: "Rice" },        product_id: "p2", line_type: "product" },
    ] },
  { sale_number: "VNT-2", sale_date: "2026-08-21", payment_status: "credit",
    pa_customers: null,
    pa_sale_items: [
      { quantity: 1, unit_price: 500, product_id: null, line_type: "debt_payment" },
    ] },
];
const DAILY = [
  { sale_date: "2026-08-20", gross_sales: 13000, cash_collected: 13000, credit_given: 0,
    total_cost: 9000, gross_profit: 4000, profit_margin_pct: 30.8, total_expenditure: 500,
    net_profit: 3500, sale_count: 1 },
  { sale_date: "2026-08-21", gross_sales: 500, cash_collected: 0, credit_given: 500,
    total_cost: 300, gross_profit: 200, profit_margin_pct: 40, total_expenditure: 0,
    net_profit: 200, sale_count: 1 },
];

const salesCsv = M.toCsv(M.buildSalesDetailRows(SALES));
const dailyCsv = M.toCsv(M.buildDailySummaryRows(DAILY));
const salesBack = parse(salesCsv);
const dailyBack = parse(dailyCsv);

const CHECKS = [
  // ── #7 as written ─────────────────────────────────────────────────────────
  ["Sales detail · header row is non-empty",
    () => (salesBack[0] || []).join("|"),
    (s) => s.startsWith("Sale#|Date|Customer|") && s.length > 20],
  ["Daily summary · header row is non-empty",
    () => (dailyBack[0] || []).join("|"),
    (s) => s.startsWith("Date|Sales|Cash Collected|") && s.length > 20],
  // 3 sale ITEMS across 2 sales -> 3 data rows. Per line, not per sale.
  ["Sales detail · one line per sale ITEM (3 items -> 3 rows + header)",
    () => String(salesBack.length),
    (s) => s === "4"],
  ["Daily summary · one line per day (2 days -> 2 rows + header)",
    () => String(dailyBack.length),
    (s) => s === "3"],
  // The original complaint: never hand back a header with nothing under it.
  ["Empty range · sales detail yields NO rows at all, not a header",
    () => JSON.stringify(M.buildSalesDetailRows([])),
    (s) => s === "[]"],
  ["Empty range · daily summary yields NO rows at all, not a header",
    () => JSON.stringify(M.buildDailySummaryRows([])),
    (s) => s === "[]"],

  // ── the defect this check was written for ─────────────────────────────────
  ["Escaping · column COUNT survives a comma/quote/newline name",
    () => salesBack.map((r) => r.length).join(","),
    (s) => s === "8,8,8,8"],
  ["Escaping · the product name round-trips EXACTLY",
    () => String(salesBack[1][3]),
    (s) => s === NASTY_PRODUCT],
  ["Escaping · the customer name round-trips EXACTLY",
    () => String(salesBack[1][2]),
    (s) => s === NASTY_CUSTOMER],
  ["Escaping · amounts land in the right column despite the nasty name",
    () => `${salesBack[1][6]}|${salesBack[2][6]}`,
    (s) => s === "12000|1000"],

  // ── the rest of the row contract ──────────────────────────────────────────
  ["Debt line is labelled and carries no product",
    () => String(salesBack[3][3]),
    (s) => s === "Debt Repayment"],
  ["Missing customer falls back to Walk-in",
    () => String(salesBack[3][2]),
    (s) => s === "Walk-in"],
];

let bad = 0;
for (const [name, run, ok] of CHECKS) {
  let out;
  try { out = String(run() ?? ""); }
  catch (e) { bad++; console.error(`  CRASH  ${name}\n           ${e.message}`); continue; }
  if (!ok(out)) { bad++; console.error(`  FAIL   ${name}\n           got: ${JSON.stringify(out)}`); continue; }
  console.error(`  ok     ${name}`);
}
if (process.env.DUMP) console.error(`\n----- sales csv -----\n${salesCsv}\n---------------------\n`);

try { rmSync(OUT, { force: true }); } catch { /* best effort */ }
console.log(`\n  ${CHECKS.length - bad}/${CHECKS.length} export checks passed`);
process.exit(bad ? 1 : 0);
