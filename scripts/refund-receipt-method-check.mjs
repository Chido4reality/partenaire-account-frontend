// LAUNCH-BATCH-2b: a refund set wholly against the customer's debt hands over no cash,
// so its receipt must not print a cash method. A split refund keeps its real method.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT  = resolve(HERE, "__refund_receipt.mjs");
await build({
  stdin: { contents: `export { buildMonospaceReceipt } from "./utils/receiptText";`, resolveDir: resolve(HERE, "../src"), loader: "js", sourcefile: "refund-entry.js" },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
});
const { buildMonospaceReceipt } = await import("file:///" + OUT.replace(/\\/g, "/"));
rmSync(OUT, { force: true });

let fails = 0;
const check = (name, ok, got) => { if (!ok) { fails++; console.log(`  FAIL  ${name}\n${got}`); } else console.log(`  pass  ${name}`); };
const base = { return_ref: "RET-1", source_sale_number: "VNT-1", refund_amount: 3000, refund_method: "cash",
  items_returned: [{ name: "Huile", qty: 1, unit_price: 3000 }], customer_new_balance: 2000 };
const org = { name: "Shop", currency: "XAF" };

for (const lang of ["en", "fr"]) {
  const allCredit = buildMonospaceReceipt("refund", { ...base, credit_portion: 3000, cash_portion: 0 }, lang, org);
  check(`${lang}: refund wholly against debt prints no cash method`,
    !/\(cash\)/i.test(allCredit) && (lang === "en" ? /\(account\)/ : /\(compte\)/).test(allCredit), allCredit);
  const split = buildMonospaceReceipt("refund", { ...base, credit_portion: 1000, cash_portion: 2000 }, lang, org);
  check(`${lang}: split refund keeps the cash method`, /\(cash\)/.test(split), split);
}
if (fails) { console.log(`\n  ${fails} FAILED`); process.exit(1); }
