// ── DAMAGED-LABEL CHECK — regression-pass Section A item #10 ────────────────
//   npm run damaged-check
//
// "#10 damaged label missing from receipts and reports" was fixed once and left
// in the pass's "not yet automated" list, so every release since has re-verified
// it by hand or not at all.
//
// ⚠️ WHY THIS IS NOT A MOUNT TEST. The label reaches paper through a helper that
// was a local const inside PaymentEventReceipt, closed over the component's
// `en`. Under renderToString the print paths are never taken, so a mount
// scenario would have ticked green without ever producing the string — the same
// unreachable-scenario trap documented at the top of mount-check.mjs. The pure
// part was extracted to utils/damagedLabel instead, and asserted here.
//
// ⚠️ THREE SURFACES, THREE DIFFERENT STRINGS. They disagree on purpose — each
// has its own width budget — which is exactly why "we fixed the damaged label"
// is a claim that needs three assertions, not one. A previous comment in
// receiptText.js attributed one of them to factureReceipt.js's `dmgName`; that
// file has no such symbol and never labels a damaged line itself. The labelling
// happens in the CALLER. A stale pointer like that is how a surface quietly
// stops being covered.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(HERE, "../src");
const OUT  = resolve(HERE, "__damaged.mjs");

// The frontend is not "type":"module", so these ESM sources cannot be imported
// directly by node. Bundle them the same way mount-check does.
await build({
  stdin: {
    contents: `
      export { dmgName, dmgShort, damagedLegend, DMG_PREFIX } from "./utils/damagedLabel";
      export { buildMonospaceReceipt } from "./utils/receiptText";
      export { buildTicketSlipEscposBytes } from "./utils/escpos";
    `,
    resolveDir: SRC, loader: "js", sourcefile: "damaged-entry.js",
  },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));

// ⚠️ A LONG name on purpose. The bug this file was written for only appears past
// 9 characters — a short fixture passed while the label was invisible in
// production for every real product. "Tyre 300-17 cst smooth" is a genuine
// product name from Paul's org.
const DAMAGED = { name: "Tyre 300-17 cst smooth", quantity: 2, unit_price: 6000, is_damaged: true };
const CLEAN   = { name: "Engine Oil 20L Duro Power", quantity: 1, unit_price: 19300, is_damaged: false };
const sale = { items: [DAMAGED, CLEAN], paid_amount: 31300, payment_status: "paid", sale_number: "VNT-1" };
const clean = { items: [CLEAN], paid_amount: 19300, payment_status: "paid", sale_number: "VNT-2" };
const decode = (bytes) => Buffer.from(bytes).toString("latin1");
// The line the customer actually reads for the damaged item.
const itemLineOf = (s) => s.split("\n").find((l) => l.includes("×") && l.includes("*")) || "";

const CHECKS = [
  // ── Surface 1: on-screen receipt, A4 facture, thermal facture ─────────────
  ["dmgName · labels a damaged line (EN)",
    () => M.dmgName(DAMAGED, true),
    (s) => s.startsWith("*") && s.includes("Tyre 300-17") && s.includes("DAMAGED GOODS")],
  ["dmgName · labels a damaged line (FR)",
    () => M.dmgName(DAMAGED, false),
    (s) => s.startsWith("*") && s.includes("MARCHANDISE ENDOMMAGÉE")],
  // The negative half. Without it the check passes if the label is appended to
  // EVERY line, which is a different bug that reads identically on the positive.
  ["dmgName · does NOT label a clean line (EN)",
    () => M.dmgName(CLEAN, true),
    (s) => s === CLEAN.name],
  ["dmgName · does NOT label a clean line (FR)",
    () => M.dmgName(CLEAN, false),
    (s) => s === CLEAN.name],
  ["dmgShort · prefixes only when damaged",
    () => `${M.dmgShort("Rice", true)}|${M.dmgShort("Rice", false)}`,
    (s) => s === "*Rice|Rice"],
  ["dmgName · null item does not throw",
    () => M.dmgName(null, true),
    (s) => s === ""],

  // ── Surface 2: WhatsApp monospace body (receiptText.js bodySale) ──────────
  // 🔴 THE REGRESSION ITSELF. itemLine fits the name to 15 chars, so a SUFFIX
  // was truncated away for every name over 9 characters. These assert on the
  // rendered ITEM LINE, not merely on the whole receipt containing the marker
  // somewhere — the old suffix was "present" in the source string and still
  // invisible to the reader.
  ["WhatsApp · marker survives a 22-char name (EN)",
    () => itemLineOf(M.buildMonospaceReceipt("sale", sale, "en", { name: "Shop" })),
    (s) => s.trimStart().startsWith("*")],
  ["WhatsApp · marker survives a 22-char name (FR)",
    () => itemLineOf(M.buildMonospaceReceipt("sale", sale, "fr", { name: "Shop" })),
    (s) => s.trimStart().startsWith("*")],
  ["WhatsApp · exactly ONE line is marked (the clean one is not)",
    () => M.buildMonospaceReceipt("sale", sale, "en", { name: "Shop" }),
    (s) => s.split("\n").filter((l) => /^\s*\*/.test(l) && l.includes("×")).length === 1],
  // A marker with no key is unreadable — swapping an invisible label for an
  // unintelligible one is not a fix.
  ["WhatsApp · legend printed when damaged present (EN)",
    () => M.buildMonospaceReceipt("sale", sale, "en", { name: "Shop" }),
    (s) => /\* = damaged goods/i.test(s)],
  ["WhatsApp · legend printed when damaged present (FR)",
    () => M.buildMonospaceReceipt("sale", sale, "fr", { name: "Shop" }),
    (s) => /\* = marchandise endommagée/i.test(s)],
  ["WhatsApp · NO legend on a receipt with no damaged line",
    () => M.buildMonospaceReceipt("sale", clean, "en", { name: "Shop" }),
    (s) => !/damaged goods/i.test(s)],

  // ── Surface 3: Bluetooth ESC/POS slip (escpos.js) ─────────────────────────
  // doc.wrapped() wraps rather than truncates, so this surface keeps BOTH the
  // "*" prefix and the spelled-out word.
  ["ESC/POS slip · damaged line carries * and [DAMAGED]",
    () => decode(M.buildTicketSlipEscposBytes({
      org: { name: "Shop" }, lang: "en", saleNumber: "VNT-1",
      items: [DAMAGED, CLEAN], itemCount: 2, total: 31300 })),
    (s) => s.includes("[DAMAGED]") && s.includes(`x *${DAMAGED.name}`)],
  ["ESC/POS slip · FR carries * and [ABIME]",
    () => decode(M.buildTicketSlipEscposBytes({
      org: { name: "Shop" }, lang: "fr", saleNumber: "VNT-1",
      items: [DAMAGED, CLEAN], itemCount: 2, total: 31300 })),
    (s) => s.includes("[ABIME]") && s.includes(`x *${DAMAGED.name}`)],
  ["ESC/POS slip · the CLEAN line is not marked",
    () => decode(M.buildTicketSlipEscposBytes({
      org: { name: "Shop" }, lang: "en", saleNumber: "VNT-1",
      items: [DAMAGED, CLEAN], itemCount: 2, total: 31300 })),
    (s) => s.includes(`x ${CLEAN.name}`) && !s.includes(`x *${CLEAN.name}`)],
];

let bad = 0;
for (const [name, run, ok] of CHECKS) {
  let out;
  try { out = String(run() ?? ""); }
  catch (e) { bad++; console.error(`  CRASH  ${name}\n           ${e.message}`); continue; }
  if (!ok(out)) {
    bad++;
    console.error(`  FAIL   ${name}\n           got: ${JSON.stringify(out.length > 300 ? out.slice(0, 300) + "…" : out)}`);
    continue;
  }
  console.error(`  ok     ${name}`);
  if (process.env.DUMP && name.includes(process.env.DUMP)) console.error(`\n${out}\n`);
}

try { rmSync(OUT, { force: true }); } catch { /* best effort */ }
console.log(`\n  ${CHECKS.length - bad}/${CHECKS.length} damaged-label checks passed`);
process.exit(bad ? 1 : 0);
