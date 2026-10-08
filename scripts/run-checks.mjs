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
  // OWNER CONFIRM-IN-PLACE: confirm-receipt queues after 8 s, so on a slow line the
  // owner's short count is refused only at REPLAY. That row must be answerable
  // (Recount / Continue anyway), surfaced, and never re-sent as-is by Retry all.
  ["owner-mismatch-queue", "scripts/owner-mismatch-queue-check.mjs", "a queued owner short count is answerable, surfaced, and never retried as-is"],
  // PRODUCT IMPORT: SheetJS guessed CSV dates month-first — "03/04/2027" (3 April)
  // was stored as 2027-03-04 with NO error. Asserts the STORED value, not a message.
  ["import-dates", "scripts/product-import-dates-check.mjs", "a CSV expiry date is stored as typed (DD/MM), impossible / US dates are rejected rows"],
  // PUSH LOGOUT: a web logout (no token) fell back to {all:true} and retired every phone
  // the user owned — on prod, half of all person-addressed alerts had no live device.
  ["push-logout", "scripts/push-logout-check.mjs", "logout revokes THIS phone's token only — web never, missing/stale token revokes nothing"],
  // PUSH ASK: Android allows TWO permission dialogs per install. Our card asks first; only a
  // tap on yes may open Android's dialog; "Plus tard" is free; the badge reads THIS phone.
  ["push-ask", "scripts/push-ask-check.mjs", "only a tap opens Android's dialog; Plus tard is free; 3/7/14/30 ladder; badge reads this phone"],
  // SUPPORT MESSAGING + LOGIN DIAGNOSTICS: the admin Messages screen against the REAL inline
  // script (honest reach, never "delivered"), the shop thread, the login failure line, and
  // /messages registered everywhere a route lives (incl. NOT hidden in Lite).
  ["messages-ui", "scripts/support-messaging-render-check.mjs", "admin Messages renders honest reach; owner thread + login failure render; /messages wired in all places, Lite too"],
  // MP-RECEIPT-PRINT-SCOPE: 0957ac41 moved the line-item normaliser into
  // buildBodyLines but kept using it in THREE call sites inside the component,
  // where it does not exist — every print path threw "saleItems is not defined".
  // mount-check STUBS this component to null, so nothing could catch it.
  ["receipt-print", "scripts/receipt-print-paths-check.mjs", "print paths resolve their line items and build a real ESC/POS payload"],
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
  // FAMILY HERITAGE: every failure this feature has had was SILENT — a page that
  // deployed and was unreachable, a portal copy two months stale, a label saying
  // "Active" for an account that could do nothing.
  ["fh-portal",     "scripts/fh-portal-check.mjs", "the Family sections are reachable, keep the two identities apart, and both service workers were bumped"],
  // CHECK EXPIRY/LOW: every role reaches it (route, menu, badge); a role without the value grant sees
  // product/qty/expiry/days/lot but no money; Lite sees the Pro lock card.
  ["expiry-access", "scripts/expiry-access-render-check.mjs", "every role reaches Check Expiry/Low; no value without the grant; Lite locked"],
  // WHO SEES COST: when the server withholds a floor that IS the cost, the below-cost popup says
  // "below the minimum price" with no amounts — never "0".
  ["below-cost-floor", "scripts/below-cost-floor-render-check.mjs", "withheld cost-floor renders without amounts; a real floor is unchanged"],
  // WHO SEES COST: at app start / sign-in, a non-owner device keeps no cached cost (POS cache, cart, reports).
  ["cost-cache-scrub", "scripts/cost-cache-scrub-check.mjs", "cached cost is scrubbed from the device for everyone but the owner"],
  ["fh-portal-render", "scripts/fh-portal-render-check.mjs", "the Family sections RENDER against the real inline script: no 'Active' on a blocked child, no Approve the server would refuse"],
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
