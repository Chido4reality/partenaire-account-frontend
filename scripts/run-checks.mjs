// ── RELEASE CHECKS — run them ALL, then report ──────────────────────────────
//   npm test
//
// ⚠️ NO `&&` CHAINING, DELIBERATELY. The backend's `npm test` was
// `check-pagination && test-derivePayment`, and check-pagination has been red on
// a pre-existing finding for weeks — so test-derivePayment had not run in all
// that time. Nobody removed it; the shell simply stopped reaching it. A red gate
// that also HIDES the checks behind it is worse than a red gate, because the
// hidden ones look like they are passing.
//
// So: every check runs, every result is printed, and the exit code is the OR of
// the failures. One red check can never conceal another.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const CHECKS = [
  ["mount-check",   "scripts/mount-check.mjs",           "15 render scenarios — does it MOUNT, not just parse"],
  ["damaged-check", "scripts/receipt-damaged-check.mjs", "regression #10 — the damaged marker on all 3 receipt surfaces"],
  ["export-check",  "scripts/report-export-check.mjs",   "regression #7 — CSV round-trips through a real spreadsheet parser"],
  ["marketing",     "scripts/marketing-render-check.mjs","admin.html marketing screens RENDER against the real inline script"],
  ["admin-sync",    "scripts/sync-admin-copy.mjs --check","admin/index.html is a generated copy, not a drifting duplicate"],
  ["referral",      "scripts/referral-render-check.mjs", "the /register?code= link prefills, locks and never claims success early"],
  ["sw-guard",      "scripts/admin-sw-guard-check.mjs",  "the Capacitor wrap never installs a service worker (no stale shell)"],
  ["marketer-i18n", "scripts/marketer-i18n-check.mjs",   "every marketer string has a French entry — a miss FAILS instead of rendering English"],
  ["write-timeout", "scripts/write-timeout-check.mjs",   "only DB-constraint-safe writes may time out early and queue"],
  ["responsive",    "scripts/responsive-check.mjs",      "wide tables scroll instead of clipping; the drawer reuses the ONE nav"],
  ["deployed",      "scripts/deployed-admin-check.mjs",  "the LIVE hosts actually serve the marketer UI (needs network)"],
  // F-A: the two duplicate-capture surfaces. The staging rig proves the API
  // refuses and that release-info returns the sibling; NEITHER proves the screen
  // says anything. Both surfaces sit behind state a parent sets asynchronously
  // (a mutation's onError, a fetch in useEffect) and neither runs under
  // renderToString — which is why they are module-scope props-only components.
  ["buffer-dup-ui",  "scripts/buffer-duplicate-warning-check.mjs", "the duplicate prompt and the release warning render, in both languages"],
  // F-C: is the receive screen actually BLIND? The root cause of 1,108 uncounted
  // lines was a PREFILL (String(it.quantity) into the count input), which is a
  // rendering fact — invisible to the API gates and to `vite build`, since esbuild
  // does not evaluate a useState initialiser.
  ["receive-blind",  "scripts/receive-blind-render-check.mjs", "no sent quantity on the receiver's screen, and no prefill in any input"],
  // MP-ZERO-STOCK-INVISIBLE: InventoryPage had no render coverage at all, so a
  // product that vanished from the Stock tab looked identical to a green suite.
  ["zero-stock",    "scripts/inventory-zero-stock-check.mjs", "a zero-stock product lists at quantity 0 instead of reading as 'does not exist'"],
  // MP-EXPENSE-TRACKER: admin.html has no build step, so this drives the REAL
  // inline script — the only way to prove the screen renders rather than parses.
  ["expenses",      "scripts/expense-render-check.mjs", "the expense screen renders, never converts the authoritative table, and keeps USD cents"],
  // MP-DEGRADED-TTL: `degraded` was a one-way latch on native — one failed write
  // put the app in queue-only mode until restart, because no write could reach
  // axios to produce the 2xx that was its only exit.
  ["degraded-ttl",  "scripts/degraded-ttl-check.mjs", "the degraded signal expires after 120s instead of latching for the whole session"],
];

const results = [];
for (const [name, script, why] of CHECKS) {
  // split so an entry may carry argv (e.g. "…/sync-admin-copy.mjs --check")
  const r = spawnSync(process.execPath, script.split(/\s+/), { cwd: ROOT, stdio: "inherit" });
  results.push([name, r.status === 0, why]);
}

const failed = results.filter(([, ok]) => !ok);
console.log("\n── release checks ─────────────────────────────────────────────");
for (const [name, ok, why] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(15)} ${why}`);
console.log(`  ${results.length - failed.length}/${results.length} suites passed\n`);
process.exit(failed.length ? 1 : 0);
