// F-D — the Save gate, tested rather than asserted.
//
// The gate is the whole mechanism: an OPTIONAL reason field was skipped 89% of
// the time on prod (426 of 478 adjusts, 31,444 gross units with no record), so
// the fastest path through the modal must be a COMPLETE one. Save is unreachable
// until both taps are made.
//
// Tested as a pure predicate because the browser extension is not connected —
// this proves the RULE, and the button's wiring to it is verified by inspection.
//
//   node scripts/adjust-gate-check.mjs
import { canSubmitAdjust } from "../src/utils/adjustReasons.js";

const cases = [
  ["nothing tapped",                    "",            "",           false],
  ["branch tapped only",                "app_wrong",   "",           false],
  ["sub-reason only, no branch",        "",            "duplicate",  false],
  ["CROSS-BRANCH app_wrong + theft",    "app_wrong",   "theft",      false],
  ["CROSS-BRANCH stock_wrong + dont_know", "stock_wrong", "dont_know", false],
  ["unknown branch",                    "nonsense",    "duplicate",  false],
  ["valid app_wrong + duplicate",       "app_wrong",   "duplicate",  true],
  ["valid stock_wrong + damaged",       "stock_wrong", "damaged",    true],
];

let bad = 0;
for (const [label, reason, sub, want] of cases) {
  const got = canSubmitAdjust(reason, sub);
  if (got !== want) bad++;
  console.log(`  ${got === want ? "PASS" : "FAIL"}  Save enabled=${String(got).padEnd(5)} want ${String(want).padEnd(5)}  ${label}`);
}
console.log(`\n  ${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
