// MP-RECEIPT-PRINT-SCOPE — the print buttons on the "Sale Recorded!" modal.
//
// THE BUG THIS EXISTS FOR (prod, sale VNT-20260911-0024, EST LE SOLDEUR, Kosi):
// tapping "Print (Bluetooth)" produced the toast "saleItems is not defined" and
// the PT-210 never received a byte.
//
// `0957ac41` (2026-08-11) introduced a shared line-item normaliser as a LOCAL
// const inside buildBodyLines(), and in the same commit replaced `data.items || []`
// with `saleItems` at FOUR call sites. Three of them live in
// PaymentEventReceiptInner — a different function — where the const does not
// exist. Every print path threw a ReferenceError; doBtPrint's try/catch turned it
// into a toast, which is why it read like a printer fault rather than a crash.
//
// 🔴 WHY NOTHING CAUGHT IT:
//   · the commit's own verification RENDERED the component and asserted on the
//     body lines — the one scope where saleItems WAS defined. A render never
//     fires a click handler.
//   · mount-check STUBS this component to `() => null` (mount-check.mjs:109), so
//     it is not rendered there at all.
//   · there is no ESLint config in this project, so no `no-undef`.
//   · `vite build` cannot see it — esbuild does not resolve identifiers.
//
// So this check does the two things those could not: it exercises the real
// builders with the real payload shapes, and it asserts the scope arrangement
// that the bug violated.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(HERE, "__receipt_print_mounted.mjs");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

console.log("\n-- receipt print paths: scope + payload ------------------------\n");

// ── 1. THE SCOPE ARRANGEMENT THE BUG VIOLATED ───────────────────────────────
// Asserted from source because the failure is a ReferenceError inside a closure
// that cannot be reached without a DOM. These three facts together are what make
// the reference resolvable from both functions.
{
  const src = readFileSync(resolve(ROOT, "src/components/common/PaymentEventReceipt.jsx"), "utf8");

  check("the normaliser is declared at MODULE scope",
    /^function normaliseSaleItems\(/m.test(src));

  // Both functions that reference saleItems must declare it from the shared
  // normaliser. Counting declarations vs the functions that use it.
  const decls = (src.match(/^\s*const saleItems = normaliseSaleItems\(data, en\);/gm) || []).length;
  check("BOTH buildBodyLines and PaymentEventReceiptInner declare it", decls === 2, `${decls} declarations`);

  // The regression itself: no `saleItems` may be referenced before its
  // declaration in PaymentEventReceiptInner.
  const innerAt = src.indexOf("function PaymentEventReceiptInner(");
  const innerSrc = src.slice(innerAt);
  const innerDecl = innerSrc.indexOf("const saleItems = normaliseSaleItems(");
  const innerFirstUse = innerSrc.search(/saleItems[.\s)]/);
  check("in the component, saleItems is declared BEFORE its first use",
    innerAt > 0 && innerDecl > 0 && innerDecl <= innerFirstUse,
    `decl@${innerDecl} firstUse@${innerFirstUse}`);

  // Every print entry point guards an empty item list.
  const guards = (src.match(/if \(!saleLinesOrWarn\(\)\) return;/g) || []).length;
  check("all THREE print paths guard an empty item list", guards === 3, `${guards} guards`);
}

// ── 2. THE REAL BUILDERS, WITH THE REAL PAYLOAD SHAPES ──────────────────────
await build({
  stdin: {
    contents: `export { buildSaleEscposBytes, buildSaleEscposBase64 } from "./utils/escpos";`,
    resolveDir: resolve(ROOT, "src"), loader: "js", sourcefile: "escpos-entry.js",
  },
  bundle: true, format: "esm", outfile: OUT, logLevel: "silent", platform: "node",
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));

const ORG = { name: "EST LE SOLDEUR", currency: "XAF", phone: "670000000" };
const baseOpts = (items, extra = {}) => ({
  org: ORG, lang: "fr", widthMm: 58,
  saleNumber: "VNT-20260911-0024", saleDate: "2026-09-11", saleTime: "14:22",
  customerName: null, cashierName: "Kosi",
  items, total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
  ...extra,
});
const decode = (b64) => Buffer.from(b64, "base64").toString("latin1");

// (a) MULTI-ITEM — the ordinary case the cashier hits all day.
{
  const items = [
    { name: "Tyre 300-18", quantity: 2, unit_price: 15000 },
    { name: "Michel Tube", quantity: 3, unit_price: 2500 },
    { name: "Bearing 6300", quantity: 1, unit_price: 1200 },
  ];
  const b64 = M.buildSaleEscposBase64(baseOpts(items));
  const txt = decode(b64);
  check("multi-item: ESC/POS payload is produced", typeof b64 === "string" && b64.length > 0, `${b64.length} b64 chars`);
  check("...every item name is in the bytes",
    items.every((i) => txt.includes(i.name)), items.map(i => txt.includes(i.name)).join(","));
  check("...the sale number is in the bytes", txt.includes("VNT-20260911-0024"));
  check("...the cashier is named", txt.includes("Kosi"));
  check("...it starts with the ESC/POS init sequence", /^\x1b@/.test(txt), JSON.stringify(txt.slice(0, 4)));
}

// (b) DISCOUNTED — net must not silently become the gross.
//
// ⚠️ The field is `discountTotal`, and `total` is COMPUTED (gross - disc), not
// passed. My first version of this test sent `{discount, total}` — both silently
// ignored — so it asserted nothing. Verified against escpos.js:142-153, and
// against saleReceiptOpts, which does pass `discountTotal`. Names matching across
// that boundary is the thing being tested here as much as the arithmetic.
{
  const items = [{ name: "Gold Black", quantity: 4, unit_price: 10000 }];   // gross 40 000
  const plain = decode(M.buildSaleEscposBase64(baseOpts(items)));
  const disc  = decode(M.buildSaleEscposBase64(baseOpts(items, { discountTotal: 5000 })));
  check("discounted: payload is produced", disc.length > 0);
  check("...a Sous-total line appears ONLY when discounted",
    disc.includes("Sous-total") && !plain.includes("Sous-total"));
  check("...the discount line is shown as a deduction", /-\s?5\s?000/.test(disc), "Remise line");
  check("...and the discounted receipt DIFFERS from the undiscounted one",
    disc !== plain, "identical payloads would mean discountTotal was ignored");
}

// (c) DEBT / PARTIAL — a repayment line carries no product.
{
  const items = [
    { name: "Tube 300-17", quantity: 1, unit_price: 3000 },
    { type: "debt_payment", name: "Remboursement de dette", quantity: 1, unit_price: 2000 },
  ];
  const b64 = M.buildSaleEscposBase64(baseOpts(items, { paid: 3000, balance: 2000 }));
  const txt = decode(b64);
  check("credit/partial: payload is produced", b64.length > 0);
  check("...the repayment line is named, not blank", txt.includes("Remboursement"));
}

// (d) SINGLE ITEM.
{
  const b64 = M.buildSaleEscposBase64(baseOpts([{ name: "JYC Battery", quantity: 1, unit_price: 45000 }]));
  check("single item: payload is produced", b64.length > 0);
  check("...the name is present", decode(b64).includes("JYC Battery"));
}

// (e) EMPTY — must still build without throwing. The UI refuses earlier
//     (saleLinesOrWarn), but the builder must not be the thing that explodes.
{
  let threw = null;
  try { M.buildSaleEscposBase64(baseOpts([])); } catch (e) { threw = e; }
  check("empty item list does not throw in the builder", threw === null, threw ? threw.message : "");
}

try { (await import("node:fs")).rmSync(OUT); } catch { /* leave it */ }
console.log(fails ? `\n-- ${fails} FAILED --\n` : "\n-- print paths build correctly --\n");
process.exit(fails ? 1 : 0);
