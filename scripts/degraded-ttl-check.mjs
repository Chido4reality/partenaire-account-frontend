// MP-DEGRADED-TTL — does the degraded signal ever come back down?
//
// THE DEFECT: on native, `degraded` was a one-way latch for the whole app
// session. recordWriteFailure() set it; only recordWriteSuccess() cleared it;
// but api.js sends every offline-eligible write straight to the queue while
// degraded is true, so no write reached axios, so none returned 2xx, so
// recordWriteSuccess could never fire. The ping path that would otherwise drain
// it is not enabled on native. One failed write => queue-only until restart.
//
// This exercises the REAL network.js module (not a copy) and asserts the exit
// path exists. It ages the window through a test seam rather than sleeping 120
// real seconds — the seam only moves the timestamp, the comparison under test is
// the shipped one.
//
// A test that cannot fail measures nothing, so it also asserts the PRE-FIX
// behaviour would have been caught: with the window still fresh, degraded must
// remain true.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(HERE, "../src/utils/network.js");
const OUT = resolve(HERE, "__network_under_test.mjs");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

// network.js reads navigator.onLine; give it a browser-ish global that is ONLINE
// (degraded only means anything while the device believes it has a link).
// Node 24 defines navigator as a getter-only global, so it must be redefined
// rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true }, writable: true, configurable: true,
});
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {} };

// network.js is Vite source and reads import.meta.env, which Node has no notion
// of. Bundle the REAL file with that one value defined — the module under test
// is still the shipped source, not a copy.
await build({
  entryPoints: [MOD], outfile: OUT, bundle: true, format: "esm", platform: "node",
  logLevel: "silent",
  define: { "import.meta.env.VITE_API_URL": '"/api"', "import.meta.env.DEV": "false" },
});
const net = await import("file:///" + OUT.replace(/\\/g, "/"));

console.log("\n── degraded TTL ─────────────────────────────────────────────\n");

check("network.js exports the TTL as a named constant", typeof net.DEGRADED_TTL_MS === "number",
  String(net.DEGRADED_TTL_MS));
check("the TTL is 120s — long enough not to flap, short enough to recover",
  net.DEGRADED_TTL_MS === 120000, `${net.DEGRADED_TTL_MS}ms`);
check("recordWriteFailure / recordWriteSuccess are exported",
  typeof net.recordWriteFailure === "function" && typeof net.recordWriteSuccess === "function");

// getNetworkStatus is async (it awaits the Capacitor plugin loader), so the
// probe must await it — reading .degraded off the Promise silently yields
// undefined, which would make every assertion below vacuous.
const degraded = async () => (await net.getNetworkStatus()).degraded;

// ── 1. a failure arms it ─────────────────────────────────────────────────────
console.log("\n  a single failed write");
check("clean state is NOT degraded", (await degraded()) === false, String(await degraded()));
net.recordWriteFailure();
check("one failed write arms degraded", (await degraded()) === true, String(await degraded()));

// ── 2. THE OLD BUG: it must stay armed while the window is fresh ─────────────
// (This is the negative control. If this ever passes trivially the TTL is too
// short and the signal would flap during a real outage.)
console.log("\n  while the window is fresh (must NOT flap)");
net.__setLastWriteFailureAtForTest(Date.now() - 1000);
check("1s after the failure it is still degraded", (await degraded()) === true);
net.__setLastWriteFailureAtForTest(Date.now() - (net.DEGRADED_TTL_MS - 5000));
check("5s BEFORE the TTL expires it is still degraded", (await degraded()) === true);

// ── 3. THE FIX: the window expires ───────────────────────────────────────────
console.log("\n  once the window expires");
net.__setLastWriteFailureAtForTest(Date.now() - (net.DEGRADED_TTL_MS + 1000));
check("1s AFTER the TTL it is no longer degraded — the latch is released",
  (await degraded()) === false, String(await degraded()));
const internals = net.__degradedInternalsForTest();
check("...and it recovered WITHOUT needing a 2xx (counter is still up)",
  internals.writeFailures >= 1,
  `writeFailures=${internals.writeFailures} — this is exactly what could never drain before`);

// ── 4. a fresh failure re-arms it ────────────────────────────────────────────
console.log("\n  a fresh failure re-arms, and repeated failures slide the window");
net.recordWriteFailure();
check("a new failure re-arms degraded", (await degraded()) === true);
net.__setLastWriteFailureAtForTest(Date.now() - (net.DEGRADED_TTL_MS + 1000));
check("...which then expires again", (await degraded()) === false);
net.recordWriteFailure();
net.__setLastWriteFailureAtForTest(Date.now() - (net.DEGRADED_TTL_MS - 1000));
net.recordWriteFailure();   // slides the window forward
check("a second failure SLIDES the window rather than inheriting the old one",
  (await degraded()) === true, "still armed after the slide");

// ── 5. a real success still clears it immediately ────────────────────────────
console.log("\n  a real success still wins outright");
let guard = 0;
while (net.__degradedInternalsForTest().writeFailures > 0 && guard++ < 50) net.recordWriteSuccess();
check("draining the counter clears degraded", (await degraded()) === false, String(await degraded()));
check("...and the timestamp is reset so it cannot resurrect",
  net.__degradedInternalsForTest().lastFailureAt === 0,
  String(net.__degradedInternalsForTest().lastFailureAt));

// ── 6. offline is offline, not degraded ──────────────────────────────────────
console.log("\n  offline is a different state");
net.recordWriteFailure();
globalThis.navigator.onLine = false;
check("while offline the device reports offline, not degraded", (await degraded()) === false);
globalThis.navigator.onLine = true;
check("back online, the armed signal is visible again", (await degraded()) === true);

console.log(`\n  ${fails === 0 ? "ALL degraded-TTL checks passed" : fails + " FAILED"}\n`);
try { rmSync(OUT); } catch { /* best effort */ }
process.exit(fails === 0 ? 0 : 1);
