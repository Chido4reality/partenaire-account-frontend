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
const jwt = (sub, org = "org-1", expInSec = 3600) => `${b64u({ alg: "HS256" })}.${b64u({ sub, org_id: org, name: "Name " + sub, exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;
const A = jwt("user-A"), B = jwt("user-B"), A_EXPIRED = jwt("user-A", "org-1", -60), A2 = jwt("user-A");

let session = null;                          // the token api.js would hand over (null = signed out)
const calls = [];                            // what reached the "server"
let respond = () => ({ status: 201, body: { success: true, data: { id: "srv-1" } } });
globalThis.fetch = async (url, init) => {
  const auth = (init.headers && init.headers.Authorization) || null;
  calls.push({ url, auth, body: JSON.parse(init.body || "{}") });
  const r = respond(auth, url, init);
  if (r === "throw") throw new Error("Failed to fetch");
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
check("the 401 'Token manquant' row goes back to the queue — and, having no recorded author, WAITS (never sent by itself)",
  st("R-nosession") === "queued" && !calls.some((c) => c.body.local_id === "R-nosession"), st("R-nosession"));
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

// ── Follow-up (Peter, 2026-10-21): token lifetime, send on behalf, author unknown ─────────────────
const H = 3600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const OWNER = jwt("owner-1"), CASHB = jwt("cash-b");
const put = (id, extra = {}) => { Q.__rows.push({ id, local_id: id, endpoint: "/sales", method: "POST", payload_json: JSON.stringify({ local_id: id, items: [{ quantity: 2, unit_price: 500 }] }),
  status: "queued", attempts: 0, last_error: null, created_at: ago(H), owner_user_id: "user-A", owner_org_id: "org-1", owner_token: A, owner_name: "Name user-A", ...extra }); };
const R = (id) => Q.__rows.find((r) => r.id === id);
const salesTo = (id) => calls.filter((c) => c.url.endsWith("/sales") && c.body.local_id === id);

console.log("the stored author token is deleted");
reset(); session = OWNER;
put("T72", { created_at: ago(73 * H) });
check("older than 72 h → tokenForRow will not use it", Q.tokenForRow(R("T72"), OWNER).wait === "author");
await Q.purgeExpiredOwnerTokens();
check("…and the purge deletes it", R("T72").owner_token === null);
put("T71", { created_at: ago(71 * H) });
await Q.purgeExpiredOwnerTokens();
check("71 h old → kept", R("T71").owner_token === A);
reset(); session = null; put("T72b", { created_at: ago(80 * H) });
await flush();
check("…the purge runs on every worker tick even when nobody is signed in", R("T72b").owner_token === null && calls.length === 0);
for (const [label, resp] of [
  ["sent", { status: 201, body: { success: true, data: { id: "x" } } }],
  ["'Token manquant'", { status: 401, body: { success: false, message: "Token manquant" } }],
  ["'Token invalide'", { status: 401, body: { success: false, message: "Token invalide" } }],
  ["account_disabled", { status: 401, body: { success: false, error: "account_disabled", message: "désactivé" } }],
  ["400 (any permanent failure)", { status: 400, body: { success: false, message: "bad" } }],
  ["409 (any permanent failure)", { status: 409, body: { success: false } }],
]) {
  reset(); session = B; put("TK"); respond = () => resp;
  await flush();
  check(`${label} → the stored token is deleted`, R("TK") ? R("TK").owner_token === null : true, R("TK") && R("TK").status);
}

console.log("no screen ever receives a token");
reset(); session = OWNER;
put("L1"); put("L2", { status: "failed_permanent" }); put("L3", { status: "failed_transient" });
const listFns = Object.keys(Q).filter((k) => /^list/.test(k) && typeof Q[k] === "function");
check("there are list functions to check (listPending, listFailedPermanent…)", listFns.length >= 2 && listFns.includes("listPending") && listFns.includes("listFailedPermanent"), listFns.join());
for (const fn of listFns) {
  const out = await Q[fn]();
  check(`${fn}() returns rows, none with an owner_token field`, Array.isArray(out) && out.length > 0 && out.every((r) => !("owner_token" in r)), `${out.length} rows`);
}
check("…the table itself still holds the token (only the screens are denied it)", R("L1").owner_token === A);

console.log("send on behalf of the author");
reset(); session = B;
put("D1"); respond = (auth) => (auth === `Bearer ${A}` ? { status: 401, body: { success: false, error: "account_disabled", message: "désactivé" } } : { status: 201, body: {} });
await flush();
check("the author's account is disabled → failed_permanent, remembered", R("D1").status === "failed_permanent" && R("D1").owner_refused === "account_disabled" && R("D1").owner_token === null);
session = OWNER;
let act = Q.rowAction(R("D1"));
check("…the owner is offered 'send on behalf of Name user-A' (account_disabled)", act && act.kind === "on_behalf" && act.reason === "account_disabled" && act.author_name === "Name user-A", JSON.stringify(act));
await Q.retry("D1"); await new Promise((r) => setTimeout(r, 30));
check("…still offered after a plain Retry (which clears last_error)", (Q.rowAction(R("D1")) || {}).kind === "on_behalf" && salesTo("D1").every((c) => c.auth !== `Bearer ${OWNER}`));
calls.length = 0; respond = () => ({ status: 201, body: { success: true, data: { id: "srv-d1" } } });
check("sendOnBehalf → accepted", await Q.sendOnBehalf("D1"));
await new Promise((r) => setTimeout(r, 40));
let sent = salesTo("D1");
check("…sent ONCE with the OWNER's session, carrying on_behalf_of_user_id = the author + the reason", sent.length === 1 && sent[0].auth === `Bearer ${OWNER}`
  && sent[0].body.on_behalf_of_user_id === "user-A" && sent[0].body.on_behalf_reason === "account_disabled" && R("D1").status === "sent", JSON.stringify(sent.map((c) => c.body)));
await flush();
check("…and never again", salesTo("D1").length === 1);

reset(); session = B;
put("W1", { owner_token: null, created_at: ago(2 * H) }); put("W2", { owner_token: null, created_at: ago(25 * H) });
await flush();
check("waiting for the author < 24 h → shown as waiting, no button, never sent as B", (Q.rowAction(R("W1"), OWNER) || {}).kind === "waiting_author" && salesTo("W1").length === 0);
check("waiting > 24 h → 'send on behalf' offered (author_waiting)", (Q.rowAction(R("W2"), OWNER) || {}).reason === "author_waiting");
check("a row whose author is signed in is not offered", Q.rowAction(R("W2"), A2) === null);
session = CASHB; respond = () => ({ status: 403, body: { success: false, code: "on_behalf_not_permitted", message: "no" } });
await Q.sendOnBehalf("W2"); await new Promise((r) => setTimeout(r, 40));
check("a cashier presses it → the server's 403 → failed_permanent, the mark is cleared (offered again)", R("W2").status === "failed_permanent" && !R("W2").send_as
  && (Q.rowAction(R("W2"), OWNER) || {}).kind === "on_behalf", R("W2").status);
session = OWNER; respond = () => "throw";
await Q.sendOnBehalf("W2"); await new Promise((r) => setTimeout(r, 40));
session = B; respond = () => ({ status: 201, body: {} }); calls.length = 0;
await flush();
check("marked by the owner, owner signs out, B signs in → NOT sent with B's session", salesTo("W2").length === 0 && Q.tokenForRow(R("W2"), B).wait === "sender");
check("…offered again to ANOTHER person signed in now (a manager)", (Q.rowAction(R("W2"), jwt("mgr-1")) || {}).kind === "on_behalf");
check("…while for the owner who pressed it, it is still in progress (sent when they are back)", Q.rowAction(R("W2"), OWNER) === null && Q.tokenForRow(R("W2"), OWNER).sendAs === "on_behalf");
check("sendOnBehalf on a row with no on-behalf action → refused locally", !(await Q.sendOnBehalf("nope")));

console.log("author unknown (queued before authors were recorded)");
reset(); session = OWNER;
put("U1", { owner_user_id: null, owner_org_id: null, owner_token: null, owner_name: null });
put("U-exp", { owner_user_id: null, owner_org_id: null, owner_token: null, endpoint: "/expenditures" });
respond = () => ({ status: 201, body: { success: true, data: { id: "srv-u" } } });
await flush(); await flush();
check("a pre-fix SALE is never sent by itself, whoever is signed in", salesTo("U1").length === 0 && R("U1").status !== "sent" && Q.tokenForRow(R("U1"), OWNER).wait === "author_unknown");
check("…a pre-fix non-sale action keeps the earlier behaviour (sent with the session)", R("U-exp").status === "sent");
check("…offered as 'author unknown'", (Q.rowAction(R("U1")) || {}).kind === "author_unknown");
check("sendAuthorUnknown → accepted", await Q.sendAuthorUnknown("U1"));
await new Promise((r) => setTimeout(r, 40));
sent = salesTo("U1");
check("…sent once with the owner's session, flagged author_unknown", sent.length === 1 && sent[0].auth === `Bearer ${OWNER}` && sent[0].body.author_unknown === true && R("U1").status === "sent");

reset(); session = OWNER;
put("U2", { owner_user_id: null, owner_token: null }); put("U3", { owner_user_id: null, owner_token: null }); put("U4", { owner_user_id: null, owner_token: null });
respond = (auth, url, init) => {
  if (!url.endsWith("/sales/queue/discard-check")) return { status: 201, body: {} };
  const b = JSON.parse(init.body);
  return b.local_id === "U2" ? { status: 200, body: { success: true, data: { exists: true, server_id: "srv-u2", sale_number: "VNT-7" } } }
                             : { status: 200, body: { success: true, data: { exists: false } } };
};
let d = await Q.discardAuthorUnknown("U2");
check("discard, but the server ALREADY has that local_id → NOT deleted, marked sent", d.kept && d.sale_number === "VNT-7" && R("U2") && R("U2").status === "sent" && R("U2").server_id === "srv-u2", JSON.stringify(d));
d = await Q.discardAuthorUnknown("U3");
const chk = calls.filter((c) => c.url.endsWith("/sales/queue/discard-check") && c.body.local_id === "U3");
check("discard, server does not have it → deleted (the server audited it: the check carried local_id + total)", d.discarded && !R("U3") && chk.length === 1 && chk[0].body.total === 1000 && chk[0].auth === `Bearer ${OWNER}`);
respond = () => "throw";
d = await Q.discardAuthorUnknown("U4");
check("offline (cannot ask the server) → NOT deleted", d.error && !!R("U4"));
respond = () => ({ status: 403, body: { success: false, code: "on_behalf_not_permitted" } });
d = await Q.discardAuthorUnknown("U4");
check("server refuses (403) → NOT deleted", d.error && !!R("U4"));
put("K1");
d = await Q.discardAuthorUnknown("K1");
check("a row WITH a known author cannot go through the author-unknown discard", d.error === "not_author_unknown" && !!R("K1"));

console.log("a waiting shift-open never holds the sales behind it");
reset(); session = B; respond = () => ({ status: 201, body: { success: true, data: { id: "s" } } });
Q.__rows.push({ id: "SH", local_id: "SH", endpoint: "/shifts/open", method: "POST", payload_json: "{}", status: "queued", attempts: 0, created_at: ago(H), owner_user_id: "user-A", owner_token: null });
put("AFTER", { owner_user_id: "cash-b", owner_token: B });
await flush();
check("A's shift-open waits for A; B's sale behind it is still sent", R("SH").status === "queued" && R("AFTER").status === "sent", `${R("SH").status} / ${R("AFTER").status}`);

console.log("wiring (the screens)");
{
  const { readFileSync } = await import("node:fs");
  const src = (p) => readFileSync(resolve(SRC, p), "utf8");
  const modal = src("components/common/ConflictModal.jsx"), page = src("pages/PendingSyncPage.jsx"), qa = src("components/common/QueueOwnerActions.jsx");
  check("both the sync page and the sync modal render the owner's controls", /<QueueOwnerActions\b/.test(modal) && /<QueueOwnerActions\b/.test(page));
  check("the modal's plain Discard is never offered for an author-unknown sale", /canDiscard\s*=[^;]*queue_action\?\.kind\s*!==\s*"author_unknown"/.test(modal));
  check("the controls use the server-checked discard and the same who-may rule as Settings",
    /discardAuthorUnknown\(/.test(qa) && !/\bdiscard\(/.test(qa) && /role === "owner" \|\| \(isManager && !!perms\?\.can_manage_staff\)/.test(qa));
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
