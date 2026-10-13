// LAUNCH-BATCH-2 (Nigeria day-one) — receipts and money speak the ORG's currency.
//
// The text receipt (WhatsApp / thermal monospace) hard-coded "F" on every amount, so a
// Nigerian shop's receipt said "12,500 F". formatMoney printed naira the franc way
// ("12 500 ₦"), and WhatsApp links always dialled Cameroon's 237. This renders the REAL
// builders for an NGN org and an XAF org and checks what the customer would read —
// and that Cameroon's receipts did not change.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(HERE, "../src");
const OUT  = resolve(HERE, "__currency.mjs");
await build({
  stdin: {
    contents: `
      export { buildMonospaceReceipt } from "./utils/receiptText";
      export { formatMoney, currencyShort } from "./utils/currency";
      export { waPhone } from "./utils/waPhone";
    `,
    resolveDir: SRC, loader: "js", sourcefile: "currency-entry.js",
  },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));

const NG = { name: "Lagos Store", currency: "NGN", country: "Nigeria" };
const CM = { name: "Boutique Akwa", currency: "XAF", country: "Cameroun" };
const sale = { sale_number: "VNT-1", paid_amount: 12500, payment_status: "paid",
  items: [{ name: "Rice 5kg", quantity: 2, unit_price: 5000 }, { name: "Oil 1L", quantity: 1, unit_price: 2500 }] };
const ng = M.buildMonospaceReceipt("sale", sale, "en", NG);
const cm = M.buildMonospaceReceipt("sale", sale, "fr", CM);
const amountLines = (s) => s.split("\n").filter((l) => /\d[\d,  ]*\s\S+$/.test(l) && /(×|Total|TOTAL|Pay|Payé|PAID|PAYÉ)/i.test(l));

const CHECKS = [
  ["NG text receipt: every amount is in naira (₦)", amountLines(ng).length > 0 && amountLines(ng).every((l) => l.trim().endsWith("₦")), amountLines(ng).join(" | ")],
  ["NG text receipt: no amount ends in the franc 'F'", !amountLines(ng).some((l) => / F$/.test(l)), amountLines(ng).join(" | ")],
  ["CM text receipt: unchanged — amounts still end in 'F'", amountLines(cm).length > 0 && amountLines(cm).every((l) => / F$/.test(l)), amountLines(cm).join(" | ")],
  ["formatMoney NGN → ₦1,234,567", M.formatMoney(1234567, "NGN") === "₦1,234,567", M.formatMoney(1234567, "NGN")],
  ["formatMoney NGN negative → -₦500", M.formatMoney(-500, "NGN") === "-₦500", M.formatMoney(-500, "NGN")],
  ["formatMoney XAF unchanged → 1 234 567 FCFA", M.formatMoney(1234567, "XAF") === "1 234 567 FCFA", JSON.stringify(M.formatMoney(1234567, "XAF"))],
  ["currencyShort: NGN ₦, XAF F, missing F", M.currencyShort("NGN") === "₦" && M.currencyShort("XAF") === "F" && M.currencyShort() === "F", ""],
  ["WhatsApp: Nigerian 0803… dials 234803…", M.waPhone("0803 000 0000", NG) === "2348030000000", M.waPhone("0803 000 0000", NG)],
  ["WhatsApp: +234 kept as is", M.waPhone("+234 803 000 0000", NG) === "2348030000000", M.waPhone("+234 803 000 0000", NG)],
  ["WhatsApp: Cameroon 677… still dials 237677…", M.waPhone("677 12 34 56", CM) === "237677123456", M.waPhone("677 12 34 56", CM)],
];

let fails = 0;
for (const [label, ok, detail] of CHECKS) {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`);
}
try { rmSync(OUT); } catch { /* noop */ }
console.log(fails ? `\n  ${fails} FAILED` : "\n  all passed");
process.exit(fails ? 1 : 0);
