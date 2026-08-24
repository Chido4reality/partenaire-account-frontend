// Proof for PING_TIMEOUT_MS: a SLOW-BUT-ALIVE link must not be marked degraded.
//
// Stands up a real HTTP server that answers HEAD /health after a configurable
// delay, points the REAL network.js at it, and reads the degraded flag it
// actually produces. Not an assertion about the constant — an observation of the
// behaviour the constant causes.
//
//   node scripts/ping-timeout-check.mjs [delayMs]   (default 8000)
//
// 8s is the interesting case: slower than the old 6s ceiling, comfortably faster
// than the new 12s one, and well inside the 20s read ceiling. A link this slow is
// alive and its requests would have succeeded.
import { build } from "esbuild";
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const DELAY = Number(process.argv[2] || 8000);
const PORT = 4599;
const SRC = String.raw`C:\Users\Admin\Desktop\partenaire_account\frontend\src`;
const OUT = resolve(String.raw`C:\Users\Admin\Desktop\partenaire_account\frontend\scripts`, "__ping.mjs");

// --- a link that is slow, not dead -------------------------------------------
// Count RECEIVED separately from COMPLETED. Conflating them made the first run
// report "aborted by the timeout" when in fact no ping had been sent at all —
// two very different states behind one counter.
let received = 0, served = 0;
const server = createServer((req, res) => {
  received++;
  setTimeout(() => { served++; res.writeHead(200); res.end(); }, DELAY);
});
await new Promise((r) => server.listen(PORT, r));

// --- browser globals network.js expects --------------------------------------
const listeners = {};
globalThis.window = {
  addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
  removeEventListener: () => {},
};
// Node 24 exposes navigator as a getter-only global, so assign the property.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true }, configurable: true, writable: true,
});
globalThis.document = { addEventListener: () => {}, visibilityState: "visible" };

await build({
  stdin: { contents: `export * from "./utils/network";`, resolveDir: SRC, loader: "js", sourcefile: "e.js" },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
  define: { "import.meta.env.VITE_API_URL": JSON.stringify(`http://127.0.0.1:${PORT}/api`) },
});

const net = await import("file:///" + OUT.replace(/\\/g, "/") + `?t=${Date.now()}`);

// ⚠️ getNetworkStatus() only wires listeners — it does NOT start the health
// monitor. onNetworkChange() does (network.js:285), and it fires an immediate
// tick. Subscribing is what puts a real ping on the wire.
const unsub = net.onNetworkChange(() => {});
await new Promise((r) => setTimeout(r, DELAY + 2500));
const status = await net.getNetworkStatus();

try { unsub(); } catch {}
server.close();
try { rmSync(OUT, { force: true }); } catch {}

console.log(`\n  link responds in ${DELAY}ms (slow, but alive)`);
console.log(`  ping requests received  : ${received}${received === 0 ? "  <-- none sent; harness bug, not a result" : ""}`);
console.log(`  ping requests completed : ${served}${received > 0 && served === 0 ? "  <-- ABORTED by the timeout" : ""}`);
console.log(`  connected               : ${status.connected}`);
console.log(`  degraded                : ${status.degraded}`);

// Expectation is explicit, so the counter-test (a genuinely bad link SHOULD be
// degraded) reads as a pass rather than being mislabelled a failure.
//   node scripts/ping-timeout-check.mjs 8000  healthy
//   node scripts/ping-timeout-check.mjs 20000 degraded
const WANT_DEGRADED = (process.argv[3] || "healthy") === "degraded";
// A result only counts if a ping actually went out.
const ok = received > 0 && status.degraded === WANT_DEGRADED;
const label = WANT_DEGRADED
  ? `a ${DELAY}ms link (past the ceiling) IS still marked degraded`
  : `a ${DELAY}ms slow-but-alive link is NOT marked degraded`;
console.log(`\n  ${ok ? "ok  " : "FAIL"}  ${label}`);
if (!ok && !WANT_DEGRADED) {
  console.log(`        -> a ${DELAY}ms round trip is being treated as a failing link.`);
  console.log(`           Since MP-OFFLINE-GATE, degraded means a gated cart is refused.`);
}
if (!ok && WANT_DEGRADED) {
  console.log(`        -> the detector has gone blind: a link this bad must still flag.`);
}
process.exit(ok ? 0 : 1);
