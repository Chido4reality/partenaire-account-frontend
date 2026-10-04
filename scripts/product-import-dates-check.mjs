// PRODUCT IMPORT — expiry dates land as TYPED (2026-10-05).
//
// The bug this guards produced NO error: SheetJS guessed dates in CSV text
// month-first, so "03/04/2027" (3 April, as Douala writes it) reached our parser
// as a date number and was STORED as 2027-03-04. Every date with a day ≤ 12 —
// roughly a third of real dates — went in silently wrong, while every test that
// used a day above 12 passed. So this check asserts the VALUE each row would store
// (row.expiry_date, what the import sends to /stock/arrivals), never merely the
// absence of an error message — a message-only check passes against the bug.
//
// Drives the REAL parseProductImport with the app's own installed xlsx library, on
// real CSV bytes and a real .xlsx workbook — no copy of the parsing rules.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "__product_import_dates.mjs");
const XLSX = createRequire(import.meta.url)("xlsx");

await build({
  stdin: { contents: `export { parseProductImport } from "./utils/productImport.js";`, resolveDir: resolve(HERE, "../src"), loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "silent",
  external: ["xlsx"],   // the app's own installed SheetJS, resolved from node_modules (bundling it breaks its require)
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const fileOf = (bytes) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const LOCS = [{ id: "loc-1", name: "Boutique Marché" }];

try {
  const { parseProductImport } = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

  console.log("CSV — what each row would STORE");
  const csv = [
    "name,barcode,cost_price,walk_in_price,qty,location,track_expiry,expiry_date,batch_no",
    "Sirop A,,500,900,10,Boutique Marché,yes,03/04/2027,L1",      // row 2 — 3 April
    "Sirop B,,500,900,10,Boutique Marché,oui,12/01/2027,",        // row 3 — 12 January
    "Sirop C,,500,900,10,Boutique Marché,yes,31/03/2027,",        // row 4
    "Sirop D,,500,900,10,Boutique Marché,yes,2027-03-31,",        // row 5 — ISO
    "Sirop E,,500,900,10,Boutique Marché,yes,31/02/2027,",        // row 6 — impossible
    "Sirop F,,500,900,10,Boutique Marché,yes,04/30/2027,",        // row 7 — US-style
    "Sirop G,,500,900,5,Boutique Marché,yes,,",                    // row 8 — tracked, blank
    "Savon H,007,1 200,250.5,3,Boutique Marché,no,,",              // row 9 — untracked
  ].join("\n") + "\n";
  // Written as Excel's "CSV UTF-8" writes it: with a byte-order mark. (UTF-8 WITHOUT a BOM —
  // Google Sheets / LibreOffice — garbles accented location names; separate, pre-existing, loud.)
  const { rows } = await parseProductImport(fileOf(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)])), LOCS);
  const r = (n) => rows.find((x) => x._rowNum === n) || {};
  const err = (n) => (r(n).errors || []).map((e) => e.en).join(" | ");

  check("03/04/2027 is STORED as 2027-04-03 (3 April, day-first)", r(2).ok === true && r(2).expiry_date === "2027-04-03", `${r(2).expiry_date} ok=${r(2).ok}`);
  check("12/01/2027 is STORED as 2027-01-12 (12 January)", r(3).ok === true && r(3).expiry_date === "2027-01-12", `${r(3).expiry_date} ok=${r(3).ok}`);
  check("31/03/2027 is STORED as 2027-03-31 (unchanged)", r(4).ok === true && r(4).expiry_date === "2027-03-31", `${r(4).expiry_date}`);
  check("2027-03-31 (ISO) is STORED as 2027-03-31", r(5).ok === true && r(5).expiry_date === "2027-03-31", `${r(5).expiry_date}`);
  check("31/02/2027 → REJECTED (impossible date), nothing stored", r(6).ok === false && /not a date/.test(err(6)) && !r(6).expiry_date, `ok=${r(6).ok} ${err(6)}`);
  check("04/30/2027 → REJECTED (month 30), not re-read as a US date", r(7).ok === false && /not a date/.test(err(7)) && !r(7).expiry_date, `ok=${r(7).ok} ${err(7)}`);
  check("tracked row with a blank expiry → REJECTED, and it is row 8", r(8).ok === false && /expiry_date is required/.test(err(8)) && r(8)._rowNum === 8, `ok=${r(8).ok} ${err(8)}`);
  check("track_expiry 'oui' counts as tracked", r(3).track_expiry === true);
  check("untracked row imports with no date", r(9).ok === true && r(9).track_expiry === false && r(9).expiry_date === "", `ok=${r(9).ok}`);
  check("number columns still parse from text: '1 200' → 1200, '250.5' → 250.5", r(9).cost_price === 1200 && r(9).sell_price === 250.5, `${r(9).cost_price} / ${r(9).sell_price}`);
  check("barcode '007' keeps its leading zeros", r(9).barcode === "007", JSON.stringify(r(9).barcode));
  check("batch number carried through", r(2).batch_no === "L1", JSON.stringify(r(2).batch_no));

  console.log("\n.xlsx — a REAL date cell is unaffected");
  const ws = XLSX.utils.aoa_to_sheet([["name", "cost_price", "walk_in_price", "qty", "location", "track_expiry", "expiry_date"],
    ["Sirop X", 500, 900, 4, "Boutique Marché", "yes", 0]]);
  ws.G2 = { t: "n", v: 46480, z: "dd/mm/yyyy" };            // Excel's own date serial for 2027-04-03
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Products");
  const xbytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  const { rows: xrows } = await parseProductImport(fileOf(xbytes), LOCS);
  check("an Excel date cell (serial 46480) is STORED as 2027-04-03", xrows[0]?.ok === true && xrows[0]?.expiry_date === "2027-04-03", `${xrows[0]?.expiry_date} ok=${xrows[0]?.ok}`);
} catch (e) {
  console.error("!! rig error:", e.stack || e.message); fails++;
} finally {
  try { rmSync(OUT, { force: true }); } catch { /* noop */ }
}
console.log(fails ? `\n  ${fails} FAILED\n` : "\n  all passed\n");
process.exit(fails ? 1 : 0);
