// PHASE 1 — Peter's staging test, display fixes (static, over src/):
//   1  the Accountant Log can NAME the three phase-1 audit rows (feed, tap-detail, Activity Ledger)
//   2  a capped payment is a yellow WARNING (warningToast), never a green success toast
//   3  no raw payment_status badge ("partial") — always the translated label
//   4  "Cash collected" never labels an all-methods figure
//   5  no "97 000 FCFA FCFA": fmt() already carries the currency; ledger subtotals are formatted
//   7  every clock time is rendered in the shop's zone (timeZone set), never the device's
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.env.CHECK_SRC ? resolve(process.env.CHECK_SRC) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "src"); // CHECK_SRC: teeth run on an older tree
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(f) && files.push(p); } })(SRC);
const read = (rel) => { try { return readFileSync(join(SRC, rel), "utf8"); } catch { return ""; } }; // a missing file fails its checks, never crashes the run
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
const rel = (f) => f.slice(SRC.length + 1).replace(/\\/g, "/");

let fails = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m, list = []) => { fails++; console.error(`FAIL  ${m}${list.length ? "\n  " + list.join("\n  ") : ""}`); };

// 1
{
  const lt = read("utils/ledgerTypes.js"), al = read("pages/AccountantLogPage.jsx");
  const miss = [];
  for (const t of ["offline_flag", "transfer_edit", "late_money"]) {
    if (!new RegExp(`\\b${t}:\\s*\\{`).test(lt)) miss.push(`LEDGER_TYPES.${t}`);
    if (!new RegExp(`"${t}"`).test(lt.slice(lt.indexOf("LEDGER_TYPE_ORDER")))) miss.push(`LEDGER_TYPE_ORDER ${t}`);
  }
  for (const a of ["offline_sale_recorded_over_rules", "transfer_items_edited", "late_money_filed"]) {
    if (!new RegExp(`\\b${a}:\\s*\\{ en:`).test(al)) miss.push(`ACTION_TEXT.${a}`);
    if ((al.match(new RegExp(`case "${a}":`, "g")) || []).length < 2) miss.push(`actionText + detailFields case ${a}`);
  }
  miss.length ? fail("1: the Accountant Log cannot name every phase-1 audit row", miss) : pass("1: the Accountant Log names offline flag, transfer edit and late money (feed, detail, ledger)");
}
// 2
{
  const bad = [];
  let sites = 0;
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\.capped\b/g)) {
      sites++;
      const win = t.slice(m.index, m.index + 260);
      if (!/warningToast\(/.test(win) && !/filter\(/.test(win)) bad.push(`${rel(f)}:${lineOf(t, m.index)} capped without warningToast`);
    }
    if (/toast\.success\([^)]*\)[^\n]*\n[^\n]*\.capped/.test(t)) bad.push(`${rel(f)} green success toast fired right before a capped warning`);
  }
  if (!sites) fail("2: no capped-payment handling found — the check looks in the wrong place");
  else bad.length ? fail("2: a capped payment is not shown as a yellow warning", bad) : pass(`2: all ${sites} capped-payment sites use the yellow warning toast`);
  const wt = read("utils/warningToast.js");
  /#f59e0b/.test(wt) && /fontWeight:\s*700/.test(wt) ? pass("2: warning style is bold on yellow") : fail("2: warningToast is not bold yellow");
}
// 3
{
  const bad = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/>\s*\{\s*[a-zA-Z_.]+\.payment_status\s*\}\s*</g)) bad.push(`${rel(f)}:${lineOf(t, m.index)}`);
  }
  bad.length ? fail("3: raw payment_status rendered (shows 'partial' untranslated)", bad) : pass("3: every payment status badge goes through saleStatusLabel");
  /Due: \{fmt\(sale\.balance_due\)\}/.test(read("pages/ReportsPage.jsx")) ? fail("3: Sales Detail still shows the raw 'Due: balance_due'") : pass("3: Sales Detail 'Due' is translated and read through saleDue()");
}
// 4
{
  const bad = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/"(Cash collected|Cash Collected|Espèces encaissées|Especes encaissees)"/g)) bad.push(`${rel(f)}:${lineOf(t, m.index)} ${m[1]}`);
  }
  bad.length ? fail("4: 'Cash collected' still labels a figure (it counts every payment method)", bad) : pass("4: no 'Cash collected' label on an all-methods figure");
  const rp = read("pages/ReportsPage.jsx");
  /payment_status === "paid"\)\.reduce\(\(s, sale\) => s \+ parseFloat\(sale\.total_amount\)/.test(rp)
    ? fail("4: Daily Sales still computes its own 'Collected' from paid sales' totals") : pass("4: Daily Sales 'Collected (all methods)' = the Daily Summary figure");
}
// 5
{
  const bad = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\$\{fmt\([^`]*?\)\}\s*\$\{fmt\.(symbol|currency)\}/g)) bad.push(`${rel(f)}:${lineOf(t, m.index)}`);
    for (const m of t.matchAll(/subtotalValue=\{bl\.[a-z_.]+\}/g)) bad.push(`${rel(f)}:${lineOf(t, m.index)} raw number subtotal`);
  }
  bad.length ? fail("5: a figure is printed with its currency twice, or unformatted", bad) : pass("5: no doubled currency, no raw ledger subtotal");
}
// 7
{
  const bad = [];
  for (const f of files) {
    if (/shopTime\.js$/.test(f)) continue;
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\.toLocale(?:Time|Date)?String\(([^()]*?),\s*\{([^{}]*?)\}\s*\)/gs)) {
      if (/\bhour\b/.test(m[2]) && !/timeZone/.test(m[2])) bad.push(`${rel(f)}:${lineOf(t, m.index)}`);
    }
  }
  bad.length ? fail("7: a clock time is rendered in the device's zone, not the shop's", bad) : pass("7: every clock time names a timeZone (shop time, WAT)");
}
process.exit(fails ? 1 : 0);
