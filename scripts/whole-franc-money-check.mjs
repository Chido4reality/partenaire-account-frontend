// WHOLE-FRANC MONEY (2026-10-21) — the POS prices a cart in whole units, exactly as the server
// books it, so a fully-paid sale with a rounded line is sent as paid in full.
// VNT-20261021-0022: 24 × 1,833.333 summed to 142,999.992 against a 143,000 header → 'partial' +
// a 0.008 credit approval. Run: node scripts/whole-franc-money-check.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, "../src/utils/money.js"), "utf8");
const { lineMoney, wholeMoney, isCreditAmount, paymentStatusFor } =
  await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); };
// The POS cart total: Σ lineGross (= lineMoney) — POSPage, no discount.
const cartTotal = (lines) => lines.reduce((s, [q, u]) => s + lineMoney(q, u), 0);

const KOSI = [[30, 325], [24, 1833.333], [4, 11800], [12, 2250], [10, 1500], [1, 50]];
const tK = cartTotal(KOSI);
check("Kosi cart total = 143,000 (the header the server books)", tK === 143000, String(tK));
check("…the rounded line is 44,000", lineMoney(24, 1833.333) === 44000);
check("…paid in full → 'paid', no credit", paymentStatusFor(tK, tK) === "paid" && !isCreditAmount(tK - tK));
check("…the old figure (142,999.992) is no credit either", paymentStatusFor(143000, 142999.992) === "paid" && !isCreditAmount(0.008000000001629815));
check("a genuine 1-franc credit stays a credit", paymentStatusFor(143000, 142999) === "partial" && isCreditAmount(1));
const THREE = [[3, 99.8667], [3, 99.8667], [3, 99.8667]];
check("several rounded lines: total 900 (not 898.8)", cartTotal(THREE) === 900, String(cartTotal(THREE)));
check("whole price × fractional quantity drops the fraction (like the server)", lineMoney(1.125, 1931) === 2172);
check("whole × whole is exact", lineMoney(3, 500) === 1500 && lineMoney(0, 500) === 0 && lineMoney("", "") === 0);
check("wholeMoney rounds typed amounts", wholeMoney("999.6") === 1000 && wholeMoney("") === 0 && wholeMoney("abc") === 0);
check("credit sale (paid 0) → 'credit'", paymentStatusFor(3000, 0) === "credit");

// Wiring: the POS must price lines and tendered amounts through the helper.
const pos = readFileSync(resolve(HERE, "../src/pages/POSPage.jsx"), "utf8");
check("POSPage: lineGross = lineMoney", /const lineGross = \(i\) => lineMoney\(i\.quantity, i\.unit_price\)/.test(pos));
check("POSPage: tendered amounts are whole", /const partialTendered = wholeMoney\(paidAmt\)/.test(pos) && /const debtTendered\s+= wholeMoney\(debtPayAmt\)/.test(pos));
check("POSPage: receipt status from paymentStatusFor", /const paymentStatus = paymentStatusFor\(total, paid\)/.test(pos));
check("POSPage: no raw quantity × unit_price money left", !/(quantity|qty) \* (i\.unit_price|unit)\b/.test(pos));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
