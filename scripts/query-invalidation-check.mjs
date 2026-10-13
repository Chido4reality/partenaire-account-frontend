// LAUNCH-BATCH-2b (a) — React Query v5 invalidation must name its keys.
//
// In v5, qc.invalidateQueries(["stock"]) is NOT a key filter: an array is read as a
// filters object with no queryKey, which matches EVERY query. InventoryPage's
// invalidateAll() did that six times after a product create — 99 requests — and the
// Stock Levels refresh queued behind them, so a new shop's first product stayed
// missing for seconds after "Product added" (3 s at a 300 ms round trip).
// Inventory now uses the object form; elsewhere the old form is held to a RATCHET:
// the count may only go down. (Converting the rest changes which screens refresh as
// a side effect, so it is its own reviewed change.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const MAX_ELSEWHERE = 95;   // 2026-10-13 baseline outside InventoryPage — lower it as files are converted

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p); } };
walk(SRC);

const RX = /\b(invalidateQueries|refetchQueries|removeQueries|cancelQueries|resetQueries)\(\s*\[/g;
let fails = 0, elsewhere = 0;
const inventory = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const rel = relative(SRC, f).split("\\").join("/");
  for (const m of s.matchAll(RX)) {
    const lineStart = s.lastIndexOf("\n", m.index) + 1;
    const before = s.slice(lineStart, m.index);
    if (before.includes("//") || /^\s*\*/.test(before)) continue;   // a comment quoting the old form
    const line = s.slice(0, m.index).split("\n").length;
    if (rel === "pages/InventoryPage.jsx") inventory.push(`${rel}:${line}`); else elsewhere++;
  }
}
const check = (label, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`); };
check("InventoryPage uses only the v5 object form ({ queryKey: [...] })", inventory.length === 0, inventory.join(", "));
check(`array-form calls elsewhere do not grow (≤ ${MAX_ELSEWHERE})`, elsewhere <= MAX_ELSEWHERE, String(elsewhere));
console.log(fails ? `\n  ${fails} FAILED` : `\n  all passed (${elsewhere} array-form calls left elsewhere)`);
process.exit(fails ? 1 : 0);
