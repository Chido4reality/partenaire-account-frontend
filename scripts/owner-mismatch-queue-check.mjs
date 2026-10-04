// OWNER CONFIRM-IN-PLACE — offline / slow connection (Peter, 2026-10-04).
//
// The owner's short count is refused by the server (409 owner_mismatch_confirm)
// BEFORE anything is written. Online, the screen asks "Recount, or continue anyway?".
// But confirm-receipt rides the offline queue and gives up on its first attempt
// after 8 s, so on a slow connection — the normal condition in Douala — the count
// is QUEUED and the 409 only arrives at replay. This check drives the REAL queue
// (utils/pendingSync, with an in-memory table and a stubbed network + fetch) and the
// REAL pure decisions (utils/ownerMismatch):
//   1. the phone-side check matches the server's predicate (owner-dispatched case);
//   2. a replayed 409 lands as an ANSWERABLE row and is surfaced (sync event);
//   3. "Retry all" never re-sends it as-is (it would be refused forever);
//   4. "Continue anyway" re-sends the SAME request (same local_id) WITH the
//      owner's confirmation, and the row then clears.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__owner_mismatch_queue.mjs");

// In-memory pending_sync covering exactly the statement shapes pendingSync uses.
const LOCALDB_STUB = `
  export const __rows = [];
  const whereFn = (clause, params, start) => {
    if (!clause) return () => true;
    const parts = clause.split(/\\s+AND\\s+/i); let i = start;
    const tests = parts.map(p => {
      const m = /^(\\w+)\\s*(=|<)\\s*\\?$/.exec(p.trim()); if (!m) throw new Error("stub WHERE: " + p);
      const v = params[i++]; return m[2] === "=" ? (r => r[m[1]] === v) : (r => r[m[1]] < v);
    });
    return (r) => tests.every(t => t(r));
  };
  export async function query(sql, params = []) {
    const m = /^SELECT \\* FROM pending_sync(?: WHERE (.+?))?(?: ORDER BY (\\w+)(?: (ASC|DESC))?)?\\s*$/i.exec(sql.trim());
    if (!m) throw new Error("stub SELECT: " + sql);
    let out = __rows.filter(whereFn(m[1], params, 0)).map(r => ({ ...r }));
    if (m[2]) out.sort((a, b) => String(a[m[2]] ?? "").localeCompare(String(b[m[2]] ?? "")) * (m[3] === "DESC" ? -1 : 1));
    return out;
  }
  export async function exec(sql, params = []) {
    const s = sql.replace(/\\s+/g, " ").trim();
    let m;
    if ((m = /^INSERT INTO pending_sync \\((.+?)\\) VALUES/i.exec(s))) {
      const cols = m[1].split(",").map(c => c.trim()); const r = {}; cols.forEach((c, i) => r[c] = params[i]); __rows.push(r); return { changes: 1 };
    }
    if ((m = /^UPDATE pending_sync SET (.+?) WHERE (.+)$/i.exec(s))) {
      const sets = m[1].split(",").map(c => c.split("=")[0].trim());
      const vals = params.slice(0, sets.length); const hit = __rows.filter(whereFn(m[2], params, sets.length));
      for (const r of hit) sets.forEach((c, i) => r[c] = vals[i]); return { changes: hit.length };
    }
    if ((m = /^DELETE FROM pending_sync WHERE (.+)$/i.exec(s))) {
      const f = whereFn(m[1], params, 0); const keep = __rows.filter(r => !f(r)); const n = __rows.length - keep.length;
      __rows.length = 0; __rows.push(...keep); return { changes: n };
    }
    throw new Error("stub exec: " + s);
  }
`;
const NETWORK_STUB = `
  export async function getNetworkStatus() { return { connected: true }; }
  export function onNetworkChange() { return () => {}; }
`;

await build({
  stdin: {
    contents: `export * from "./utils/pendingSync.js"; export { ownerShortLocal } from "./utils/ownerMismatch.js"; export { __rows } from "./utils/localDb.js";`,
    resolveDir: SRC, loader: "js",
  },
  bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "silent",
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /localDb(\.js)?$/ }, () => ({ path: "localDb", namespace: "stub" }));
      b.onResolve({ filter: /\/network(\.js)?$|^\.\/network$/ }, () => ({ path: "network", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.path === "localDb" ? LOCALDB_STUB : NETWORK_STUB, loader: "js" }));
    },
  }],
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

try {
  const Q = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

  console.log("1. Phone-side check (owner dispatched it, so the sent figures are local)");
  const tr = { id: "T1", pa_transfer_items: [{ id: "a", quantity: 6 }, { id: "b", quantity: 4 }] };
  check("short line → warn before sending", Q.ownerShortLocal(tr, [{ item_id: "a", received_quantity: 5, damaged_quantity: 0 }, { item_id: "b", received_quantity: 4, damaged_quantity: 0 }]) === true);
  check("matching count → no warning", Q.ownerShortLocal(tr, [{ item_id: "a", received_quantity: 6 }, { item_id: "b", received_quantity: 4 }]) === false);
  check("damage explains it (5 good + 1 broken of 6) → no warning (same as the server)", Q.ownerShortLocal(tr, [{ item_id: "a", received_quantity: 5, damaged_quantity: 1 }]) === false);
  check("blind transfer (someone else dispatched it) → no local verdict; the server decides", Q.ownerShortLocal({ ...tr, quantities_hidden: true }, [{ item_id: "a", received_quantity: 1 }]) === false);

  console.log("\n2. A queued owner count refused at replay");
  const calls = [];
  let mode = "refuse";
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body || "{}"); calls.push({ url, body, replay: init.headers?.["X-Offline-Replay"] });
    if (/confirm-receipt/.test(url)) {
      if (mode === "refuse" && body.owner_mismatch_confirmed !== true)
        return { status: 409, json: async () => ({ success: false, code: "owner_mismatch_confirm", message_en: "You have entered a count that doesn't match what was sent. Recount, or continue anyway?", message_fr: "Vous avez saisi un comptage qui ne correspond pas à l'envoi. Recompter, ou continuer quand même ?" }) };
      return { status: 200, json: async () => ({ success: true, comparison: [] }) };
    }
    return { status: 409, json: async () => ({ success: false, code: "STOCK_CONFLICT" }) };   // an unrelated conflict
  };
  Q.configureSync({ baseUrl: "http://rig/api", getAuthToken: () => "t" });
  const events = []; Q.onSyncEvent(e => events.push(e));
  await Q.enqueue({ endpoint: "/transfers/T1/confirm-receipt", payload: { lines: [{ item_id: "a", received_quantity: 5 }], transfer_number: "TRF-20261004-0042", local_id: "L-1" } });
  await tick();
  const omRow = Q.__rows.find(r => r.local_id === "L-1");
  check("refused at replay → failed_permanent (nothing written server-side)", omRow?.status === "failed_permanent", omRow?.status);
  const om = Q.ownerMismatchOf(omRow);
  check("recognised as an owner short count, labelled with its transfer number", om && om.transferId === "T1" && om.kind === "confirm" && om.transferNumber === "TRF-20261004-0042", JSON.stringify(om));
  check("…with the prompt in both languages", /doesn't match/.test(om?.message_en || "") && /ne correspond pas/.test(om?.message_fr || ""));
  const ev = events.find(e => e.type === "owner_mismatch");
  check("SURFACED: an owner_mismatch sync event fires (Layout toasts it)", !!ev && ev.transferNumber === "TRF-20261004-0042" && ev.rowId === omRow.id, JSON.stringify(ev));
  check("an unrelated failed row is NOT mistaken for one", Q.ownerMismatchOf({ status: "failed_permanent", endpoint: "/sales", last_error: JSON.stringify({ status: 409, body: { code: "STOCK_CONFLICT" } }) }) === null);

  console.log("\n3. Retry all must not re-send it as-is");
  await Q.enqueue({ endpoint: "/sales", payload: { items: [], local_id: "S-1" } });
  await tick();
  const before = calls.filter(c => /confirm-receipt/.test(c.url)).length;
  const n = await Q.retryAll();
  await tick();
  const after = calls.filter(c => /confirm-receipt/.test(c.url)).length;
  check("Retry all re-queues the sale only (1), never the owner short count", n === 1, `${n}`);
  check("…the owner count was NOT re-sent, and still waits for an answer", after === before && Q.__rows.find(r => r.local_id === "L-1")?.status === "failed_permanent", `${before} → ${after}`);

  console.log("\n4. Continue anyway");
  const ok = await Q.continueWithConfirm(omRow.id);
  await tick();
  const last = calls.filter(c => /confirm-receipt/.test(c.url)).pop();
  check("re-sent with owner_mismatch_confirmed: true", ok && last?.body?.owner_mismatch_confirmed === true, JSON.stringify(last?.body));
  check("…the SAME request: same local_id, same count", last?.body?.local_id === "L-1" && last?.body?.lines?.[0]?.received_quantity === 5);
  check("…and the row clears (sent)", Q.__rows.find(r => r.local_id === "L-1")?.status === "sent", Q.__rows.find(r => r.local_id === "L-1")?.status);
} catch (e) {
  console.error("!! rig error:", e.stack || e.message); fails++;
} finally {
  try { rmSync(OUT, { force: true }); } catch { /* noop */ }
}
console.log(fails ? `\n  ${fails} FAILED\n` : "\n  all passed\n");
process.exit(fails ? 1 : 0);
