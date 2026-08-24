// Runtime test of the REAL api.js adapter routing (MP-OFFLINE-GATE).
// Bundles the actual module with the network layer and queue stubbed, so the
// branch under test is the shipped code, not a copy of it.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const SRC = String.raw`C:\Users\Admin\Desktop\partenaire_account\frontend\src`;
const OUT = resolve(String.raw`C:\Users\Admin\Desktop\partenaire_account\frontend\scripts`, "__route.mjs");

globalThis.__NET = { connected: true, degraded: false, source: "test" };
globalThis.__ENQUEUED = [];

const STUBS = {
  "react-hot-toast": `const t=()=>{};t.success=()=>{};t.error=()=>{};t.dismiss=()=>{};export default t;`,
  "store": `
    export const useAuthStore = { getState: () => ({ token: "t", user: { id: "u" }, logout(){} }) };
    export const useLangStore = { getState: () => ({ lang: "en" }) };
  `,
  "pendingSync": `
    export async function enqueue(row){ globalThis.__ENQUEUED.push(row); }
    export function configureSync(){} export function startWorker(){}
    export function genLocalId(){ return "local-1"; }
    export function onSyncEvent(){ return () => {}; }
  `,
  "network": `
    export async function getNetworkStatus(){ return globalThis.__NET; }
    export function recordWriteFailure(){} export function recordWriteSuccess(){}
  `,
};

await build({
  stdin: { contents: `export { default as api } from "./utils/api";`, resolveDir: SRC, loader: "js", sourcefile: "e.js" },
  bundle: true, format: "esm", outfile: OUT, platform: "node", logLevel: "silent",
  // api.js reads import.meta.env (Vite-only). Substitute at build time.
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://127.0.0.1:9/api") },
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{
    name: "s",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        for (const k of Object.keys(STUBS)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "st" };
        return null;
      });
      b.onLoad({ filter: /.*/, namespace: "st" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
    },
  }],
});

const { api } = await import("file:///" + OUT.replace(/\\/g, "/"));

// Make the real network layer unreachable so any request that gets PAST the
// adapter's routing fails as a network error rather than hitting the internet.
api.defaults.baseURL = "http://127.0.0.1:9/api";

async function run(label, net, cfg) {
  globalThis.__NET = net;
  globalThis.__ENQUEUED = [];
  let outcome;
  try {
    const r = await api.post("/sales", { items: [] }, cfg);
    // NB: the flag is `offline_queued` (see buildOptimisticResponse). Getting
    // this name wrong made the two ungated cases look like failures on the
    // first run — the assertion was wrong, not the routing.
    outcome = r && r.data && r.data.offline_queued ? "QUEUED(optimistic success)" : "SENT";
  } catch (e) {
    outcome = e.isOfflineGateRefusal ? "REFUSED(gate)" : `ERROR(${e.code || e.message})`;
  }
  console.log(`  ${label.padEnd(46)} -> ${outcome.padEnd(28)} enqueued=${globalThis.__ENQUEUED.length}`);
  return { outcome, enqueued: globalThis.__ENQUEUED.length };
}

const OFFLINE  = { connected: false, degraded: true,  source: "test" };
const DEGRADED = { connected: true,  degraded: true,  source: "test" };
const HEALTHY  = { connected: true,  degraded: false, source: "test" };
const GATED    = { requiresServerDecision: true, gateReasons: ["credit"] };
const PLAIN    = {};

console.log("\nUNGATED cart (must keep working exactly as before):");
const a = await run("offline  + ungated", OFFLINE, PLAIN);
const b = await run("degraded + ungated", DEGRADED, PLAIN);

console.log("\nGATED cart (the fix):");
const c = await run("offline  + gated", OFFLINE, GATED);
const d = await run("degraded + gated", DEGRADED, GATED);
const e = await run("healthy  + gated", HEALTHY, GATED);

try { rmSync(OUT, { force: true }); } catch {}

const Q = "QUEUED(optimistic success)";
const R = "REFUSED(gate)";
// ⚠️ Every one of these must be able to FAIL. The enqueue assertions below were
// briefly hardcoded `true`, which made them pass against the pre-fix code as
// happily as against the fix — the exact unfireable-check shape this repo keeps
// producing. They now read the real counter.
const expect = [
  ["offline+ungated still queues",         a.outcome === Q && a.enqueued === 1],
  ["degraded+ungated still queues",        b.outcome === Q && b.enqueued === 1],
  ["offline+gated REFUSES",                c.outcome === R],
  ["offline+gated enqueues NOTHING",       c.enqueued === 0],
  ["degraded+gated does NOT queue",        d.outcome === R && d.enqueued === 0],
  ["healthy+gated does NOT queue",         e.outcome === R && e.enqueued === 0],
];
console.log("");
let bad = 0;
for (const [name, ok] of expect) { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`); }
console.log(`\n  ${expect.length - bad}/${expect.length} routing assertions passed`);
process.exit(bad ? 1 : 0);
