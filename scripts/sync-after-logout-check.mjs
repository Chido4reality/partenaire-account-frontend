// SYNC-AFTER-LOGOUT (2026-10-21) — a logout must never strand or mis-attribute a queued sale.
// Found on staging (emulator, app-lock tests): after ANY logout the worker replayed queued sales with no
// token → 401 "Token manquant" → failed_permanent; and the next user to log in replayed others' rows as
// themselves. Drives the REAL utils/pendingSync with an in-memory table and a stubbed network + fetch.
// Run: node scripts/sync-after-logout-check.mjs     Teeth: PS_SRC=<old src dir> node scripts/sync-after-logout-check.mjs
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PS_SRC ? resolve(process.env.PS_SRC) : resolve(HERE, "../src");
const OUT = resolve(HERE, "__sync_after_logout.mjs");

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
    const m = /^SELECT \\* FROM pending_sync(?: WHERE (.+?))?(?: ORDER BY (\\w+)(?: (ASC|DESC))?)?\\s*$/i.exec(sql.trim().replace(/\\s+/g, " "));
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
  stdin: { contents: `export * from "./utils/pendingSync.js"; export { __rows } from "./utils/localDb.js";`, resolveDir: SRC, loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "silent",
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /localDb(\.js)?$/ }, () => ({ path: "localDb", namespace: "stub" }));
    b.onResolve({ filter: /\/network(\.js)?$|^\.\/network$/ }, () => ({ path: "network", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: a.path === "localDb" ? LOCALDB_STUB : NETWORK_STUB, loader: "js" }));
  } }],
});
const Q = await import(pathToFileURL(OUT).href);
rmSync(OUT, { force: true });

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (sub, org = "org-1", expInSec = 3600) => `${b64u({ alg: "HS256" })}.${b64u({ sub, org_id: org, exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;
const A = jwt("user-A"), B = jwt("user-B"), A_EXPIRED = jwt("user-A", "org-1", -60), A2 = jwt("user-A");

let session = null;                          // the token api.js would hand over (null = signed out)
const calls = [];                            // what reached the "server"
let respond = () => ({ status: 201, body: { success: true, data: { id: "srv-1" } } });
globalThis.fetch = async (url, init) => {
  const auth = (init.headers && init.headers.Authorization) || null;
  calls.push({ url, auth, body: JSON.parse(init.body || "{}") });
  const r = respond(auth, url);
  return { status: r.status, json: async () => r.body };
};
Q.configureSync({ baseUrl: "https://api.test", getAuthToken: () => session });
const row = (localId) => Q.__rows.find((r) => JSON.parse(r.payload_json).local_id === localId);
const flush = async () => { await Q.retryAll(); await new Promise((r) => setTimeout(r, 30)); };   // retryAll → flushIfOnline (the worker's entry)
const kick = async () => { await Q.enqueue({ endpoint: "/__noop", payload: { local_id: "noop-" + Math.random() } }).catch(() => {}); await new Promise((r) => setTimeout(r, 30)); };
const reset = () => { Q.__rows.length = 0; calls.length = 0; respond = () => ({ status: 201, body: { success: true, data: { id: "srv-1" } } }); };

console.log("signed out");
reset(); session = A;
respond = () => ({ status: 503, body: {} });                       // offline-ish: the sale stays queued
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S1", total: 1000 } });
await new Promise((r) => setTimeout(r, 30));
check("the queued row records its author (user + org) and that author's token", row("S1").owner_user_id === "user-A" && row("S1").owner_org_id === "org-1" && row("S1").owner_token === A);
session = null; calls.length = 0; respond = () => ({ status: 401, body: { success: false, message: "Token manquant" } });
await flush();
check("signed out → nothing is sent", calls.filter((c) => c.url.endsWith("/sales")).length === 0, `${calls.length} calls`);
check("…and the row is NOT failed_permanent", row("S1").status !== "failed_permanent", row("S1").status);

console.log("a session 401 is retry-later");
session = A; respond = () => ({ status: 401, body: { success: false, message: "Token invalide" } });
await flush();
check("401 'Token invalide' with a session → failed_transient, not failed_permanent", row("S1").status === "failed_transient", row("S1").status);
respond = () => ({ status: 401, body: { success: false, error: "invalid_pin", message: "PIN" } });
await flush();
check("a business 401 (approval / PIN error code) keeps today's rule → failed_permanent", row("S1").status === "failed_permanent");

console.log("same user logs back in");
reset(); session = A; respond = () => ({ status: 503, body: {} });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S2" } }); await new Promise((r) => setTimeout(r, 30));
session = null; await flush();
session = A2; calls.length = 0; respond = () => ({ status: 201, body: { success: true, data: { id: "srv-2" } } });
await flush();
const s2 = calls.filter((c) => c.url.endsWith("/sales"));
check("author logs back in → sent ONCE with the author's NEW session token", s2.length === 1 && s2[0].auth === `Bearer ${A2}` && row("S2").status === "sent", `${s2.length} sends, ${s2[0] && s2[0].auth === "Bearer " + A2 ? "A's new token" : "?"}`);
check("…the stored token is cleared once sent", row("S2").owner_token === null);
await flush();
check("…and never sent again", calls.filter((c) => c.url.endsWith("/sales")).length === 1);

console.log("another user logs in");
reset(); session = A; respond = () => ({ status: 503, body: {} });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S3" } }); await new Promise((r) => setTimeout(r, 30));
session = null; await flush();
session = B; calls.length = 0; respond = () => ({ status: 201, body: { success: true, data: { id: "srv-3" } } });
await flush();
const s3 = calls.filter((c) => c.url.endsWith("/sales"));
check("user B logs in → A's sale is sent with A's OWN token (the server books it to A), once", s3.length === 1 && s3[0].auth === `Bearer ${A}` && row("S3").status === "sent", s3.map((c) => (c.auth === "Bearer " + A ? "A" : c.auth === "Bearer " + B ? "B" : "?")).join());

console.log("the author's stored token no longer works");
reset(); session = A_EXPIRED; respond = () => ({ status: 503, body: {} });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S4" } }); await new Promise((r) => setTimeout(r, 30));
session = B; calls.length = 0; await flush();
check("A's stored token expired, B signed in → NOT sent as B; the row waits for A", calls.filter((c) => c.url.endsWith("/sales")).length === 0 && row("S4").status !== "sent" && row("S4").status !== "failed_permanent", row("S4").status);
session = A; respond = () => ({ status: 201, body: { success: true, data: { id: "srv-4" } } }); await flush();
check("…A logs in → sent with A's session", calls.filter((c) => c.url.endsWith("/sales") && c.auth === `Bearer ${A}`).length === 1 && row("S4").status === "sent");
reset(); session = A; respond = () => ({ status: 503, body: {} });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S5" } }); await new Promise((r) => setTimeout(r, 30));
session = B; respond = (auth) => (auth === `Bearer ${A}` ? { status: 401, body: { success: false, message: "Token invalide" } } : { status: 201, body: {} });
await flush();
check("A's stored token refused (401) while B is signed in → token dropped, row waits (transient), never sent as B", row("S5").owner_token === null && row("S5").status === "failed_transient" && !calls.some((c) => c.url.endsWith("/sales") && c.auth === `Bearer ${B}`), row("S5").status);

console.log("one-time recovery of rows a logout already stranded");
reset(); session = A;
const strand = (id, err, endpoint = "/sales") => Q.__rows.push({ id, local_id: id, endpoint, method: "POST", payload_json: JSON.stringify({ local_id: id }), status: "failed_permanent", attempts: 2, last_error: JSON.stringify(err), created_at: "2026-10-21T10:00:00Z" });
strand("R-nosession", { status: 401, body: { success: false, message: "Token manquant", message_en: "You are not signed in" } });
strand("R-disabled", { status: 401, body: { success: false, error: "account_disabled", message: "Compte désactivé" } });
strand("R-400", { status: 400, body: { success: false, code: "NO_OPEN_SHIFT" } });
strand("R-409", { status: 409, body: { success: false, code: "stock_conflict" } });
respond = () => ({ status: 201, body: { success: true, data: { id: "srv-r" } } });
await kick();
const st = (id) => Q.__rows.find((r) => r.id === id).status;
check("the 401 'Token manquant' row goes back to the queue and is sent", st("R-nosession") === "sent", st("R-nosession"));
check("…a disabled-account 401, a 400 and a 409 stay failed_permanent exactly as before", st("R-disabled") === "failed_permanent" && st("R-400") === "failed_permanent" && st("R-409") === "failed_permanent");
check("strandedByLogout recognises only that cause", Q.strandedByLogout && Q.strandedByLogout({ status: "failed_permanent", last_error: JSON.stringify({ status: 401, body: { message: "Token manquant" } }) }) && !Q.strandedByLogout({ status: "failed_permanent", last_error: JSON.stringify({ status: 401, body: { message: "Token invalide" } }) }));

console.log("other rules unchanged");
reset(); session = A;
respond = () => ({ status: 400, body: { success: false, message: "bad" } });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S6" } }); await new Promise((r) => setTimeout(r, 30));
check("400 → failed_permanent (as before)", row("S6").status === "failed_permanent");
respond = () => ({ status: 409, body: { success: false } });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S7" } }); await new Promise((r) => setTimeout(r, 30));
check("409 → failed_permanent (as before)", row("S7").status === "failed_permanent");
respond = () => ({ status: 502, body: {} });
await Q.enqueue({ endpoint: "/sales", payload: { local_id: "S8" } }); await new Promise((r) => setTimeout(r, 30));
check("5xx → failed_transient (as before)", row("S8").status === "failed_transient");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
