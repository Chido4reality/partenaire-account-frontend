// ORANGE FALLBACK — red guards for src/utils/apiHost.js and its wiring in api.js (2026-10-06).
//
// Part A: apiHost alone (scripted health probes, clock and storage).
// Part B: the REAL api.js, bundled with its queue/network/store stubbed and a scripted
//         axios transport that counts every request that actually goes out.
//
// The promises being guarded:
//   • switch ONLY on a connection failure (no HTTP response) — never on 4xx/5xx, never on a timeout
//   • the new code never re-sends an app request; it only probes <base>/health
//   • a failed offline-eligible write goes to the queue ONCE and the transport saw it ONCE
//   • later requests use the address that answered; the direct one is re-tried after 4h
//   • the web build is direct-first too; its ONE fallback is "/api" on its own site
//   • a fallback counts only if its /health reports the direct address's env
//     (a prod page never lands on staging, nor the reverse)
//   • on the web, leaving the direct address logs whether it was a CORS refusal
//   • a dev/rig build ("/api" as the direct address) never probes at all
// Part C: the real api.js as the WEB build (no Capacitor) — direct, then "/api".
// Part S: static — nothing but api.js/apiHost.js reads VITE_API_URL; the queue and
//         the health ping read the CURRENT address.
import { build } from "esbuild";
import { rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const DIRECT = "https://direct.test/api", BOOK = "https://book.test/api", POS = "https://pos.test/api";
const ENV = { "import.meta.env.VITE_API_URL": JSON.stringify(DIRECT), "import.meta.env.VITE_API_FALLBACKS": JSON.stringify(`${BOOK},${POS}`) };

const STUBS = {
  "../store": `export const useAuthStore = { getState: () => ({ token: "tok", logout() {} }) };
               export const useLangStore = { getState: () => ({ lang: "fr" }) };`,
  "./pendingSync": `export const enqueue = async (row) => { globalThis.__q.push(row); return { id: "q" + globalThis.__q.length }; };
                    export const configureSync = (o) => { globalThis.__sync = o; };
                    export const startWorker = () => {};
                    export const genLocalId = () => "lid-" + Math.random().toString(36).slice(2);`,
  "./network": `export const getNetworkStatus = async () => ({ connected: true, degraded: false, source: "test" });
                export const recordWriteFailure = () => {}; export const recordWriteSuccess = () => {};`,
  "react-hot-toast": `const t = () => {}; t.success = t; t.error = t; t.dismiss = t; t.loading = t; export default t;`,
};
const stubs = { name: "stubs", setup(b) {
  b.onResolve({ filter: /.*/ }, (a) => (STUBS[a.path] !== undefined ? { path: a.path, namespace: "stub" } : null));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
} };
const OUT_A = resolve(HERE, "__api_host_a.mjs"), OUT_B = resolve(HERE, "__api_host_b.mjs"), OUT_W = resolve(HERE, "__api_host_web.mjs");
const OUT_C = resolve(HERE, "__api_host_c.mjs");
const common = { bundle: true, format: "esm", platform: "node", logLevel: "silent", external: ["axios"] };
await build({ ...common, entryPoints: [resolve(SRC, "utils/apiHost.js")], outfile: OUT_A, define: ENV });
await build({ ...common, entryPoints: [resolve(SRC, "utils/api.js")], outfile: OUT_B, define: ENV, plugins: [stubs] });
await build({ ...common, entryPoints: [resolve(SRC, "utils/api.js")], outfile: OUT_C, define: ENV, plugins: [stubs] });
await build({ ...common, entryPoints: [resolve(SRC, "utils/apiHost.js")], outfile: OUT_W,
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api"), "import.meta.env.VITE_API_FALLBACKS": "undefined" } });

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const mem = () => { const m = new Map(); return { get: () => m.get("k") ?? null, set: (v) => m.set("k", v), raw: m }; };
// Health probes: up = set of bases that answer /health (as the PRODUCTION server —
// DIRECT is a production name); envOf overrides what a base reports.
const probe = (up, log, envOf = {}) => async (url, opts = {}) => {
  log.push(opts.mode === "no-cors" ? `no-cors ${url}` : url);
  const base = url.replace(/\/health$/, "");
  if (up.has(base)) return { ok: true, json: async () => ({ ok: true, env: envOf[base] || "production" }) };
  throw new TypeError("Failed to fetch");
};
const netErr = (code, response) => Object.assign(new Error(code), { code, response });

try {
  // ── Part A ────────────────────────────────────────────────────────────────
  console.log("\n-- A. apiHost alone --\n");
  const H = await import(pathToFileURL(OUT_A).href + `?t=${Date.now()}`);
  let t = 1_000_000; const now = () => t;
  let log = [], st = mem();
  H.__setForTest({ fetchImpl: probe(new Set([BOOK, POS]), log), now, store: st, candidates: [DIRECT, BOOK, POS] });
  check("A1 starts on the direct address", H.getApiBase() === DIRECT);
  const verdict = {
    "4xx": H.isConnectionFailure(netErr("ERR_BAD_REQUEST", { status: 404 })),
    "5xx": H.isConnectionFailure(netErr("ERR_BAD_RESPONSE", { status: 502 })),
    "timeout": H.isConnectionFailure(netErr("ECONNABORTED")),
    "etimedout": H.isConnectionFailure(netErr("ETIMEDOUT")),
    "no-response": H.isConnectionFailure(netErr("ERR_NETWORK")),
    // No response either, but the APP gave up (page left, request superseded) — not a block.
    "canceled": H.isConnectionFailure(netErr("ERR_CANCELED")),
  };
  check("A2 a connection failure is ONLY 'no response at all' — not 4xx, 5xx, a timeout or a cancel",
    !verdict["4xx"] && !verdict["5xx"] && !verdict.timeout && !verdict.etimedout && !verdict.canceled && verdict["no-response"], JSON.stringify(verdict));
  for (const e of [netErr("ERR_BAD_REQUEST", { status: 403 }), netErr("ERR_BAD_RESPONSE", { status: 500 }), netErr("ECONNABORTED")]) {
    check(`A3 ${e.code}${e.response ? " " + e.response.status : ""} → no probe, no switch`, H.noteRequestFailure(e) === null && log.length === 0 && H.getApiBase() === DIRECT);
  }
  const seenChange = []; H.onApiBaseChange((b) => seenChange.push(b));
  const r = await H.noteRequestFailure(netErr("ERR_NETWORK"));
  check("A4 connection failure → probes the next address and switches to it", r === BOOK && H.getApiBase() === BOOK && seenChange[0] === BOOK, `${r} via ${log.join(" ")}`);
  check("A5 it only ever probed /health — no app request re-sent", log.length > 0 && log.every((u) => u.endsWith("/health")), log.join(" "));
  check("A6 the choice is remembered", JSON.parse(st.raw.get("k")).base === BOOK);

  log = []; st = mem(); t = 1_000_000;
  H.__setForTest({ fetchImpl: probe(new Set([POS]), log), now, store: st, candidates: [DIRECT, BOOK, POS] });
  const r2 = await H.noteRequestFailure(netErr("ERR_NETWORK"));
  check("A7 first fallback dead → the next one (both domains carried)", r2 === POS && H.getApiBase() === POS, log.join(" "));

  log = []; st = mem(); t = 1_000_000;
  H.__setForTest({ fetchImpl: probe(new Set(), log), now, store: st, candidates: [DIRECT, BOOK, POS] });
  const r3 = await H.noteRequestFailure(netErr("ERR_NETWORK"));
  check("A8 nothing answers (plainly offline) → stays put", r3 === null && H.getApiBase() === DIRECT, log.join(" "));
  t += 5000; const again = H.noteRequestFailure(netErr("ERR_NETWORK"));
  check("A9 a second failure within the 30 s cooldown does NOT probe again", again === null && log.length === 2, `${log.length} probes`);

  log = []; st = mem(); t = 1_000_000;
  H.__setForTest({ fetchImpl: probe(new Set([BOOK]), log), now, store: st, candidates: [DIRECT, BOOK, POS] });
  await H.noteRequestFailure(netErr("ERR_NETWORK"));
  t += H.RETRY_PRIMARY_MS - 1000;
  check("A10 the direct address is NOT re-tried before 4 h", H.maybeRetryPrimary() === null);
  t += 2000; log.length = 0;
  const back1 = await H.maybeRetryPrimary();
  check("A11 after 4 h it is re-tried; still blocked → stay on the fallback", back1 === false && H.getApiBase() === BOOK && log[0] === `${DIRECT}/health`, log.join(" "));
  check("A12 …and the 4 h clock restarts", H.maybeRetryPrimary() === null);
  t += H.RETRY_PRIMARY_MS + 1000; H.__setForTest({ fetchImpl: probe(new Set([DIRECT, BOOK]), log), now, store: st, candidates: [DIRECT, BOOK, POS] });
  t += H.RETRY_PRIMARY_MS + 1000;
  const back2 = await H.maybeRetryPrimary();
  check("A13 the direct address answers again → back to it", back2 === true && H.getApiBase() === DIRECT);

  st = mem(); st.set(JSON.stringify({ base: POS, since: t }));
  H.__setForTest({ fetchImpl: probe(new Set(), []), now, store: st, candidates: [DIRECT, BOOK, POS] });
  check("A14 restart → resumes on the remembered address", H.getApiBase() === POS);
  st = mem(); st.set(JSON.stringify({ base: "https://evil.test/api", since: t }));
  H.__setForTest({ fetchImpl: probe(new Set(), []), now, store: st, candidates: [DIRECT, BOOK, POS] });
  check("A15 a remembered address NOT in the built-in list is ignored", H.getApiBase() === DIRECT);
  check("A16 stripApiBase strips whichever address is in front", H.stripApiBase(`${BOOK}/sales?x=1`) === "/sales?x=1" && H.stripApiBase("/sales") === "/sales");

  const W = await import(pathToFileURL(OUT_W).href + `?t=${Date.now()}`);
  const wlog = []; W.__setForTest({ fetchImpl: probe(new Set(["/api"]), wlog), now, store: mem() });
  check("A17 a dev/rig build (\"/api\" as the direct address, one candidate) never probes", W.API_CANDIDATES.length === 1 && W.noteRequestFailure(netErr("ERR_NETWORK")) === null && wlog.length === 0, JSON.stringify(W.API_CANDIDATES));

  // A18–A19: the candidate list per runtime.
  const webList = H.candidatesFor({ primary: DIRECT, fallbackList: `${BOOK},${POS}`, native: false });
  const appList = H.candidatesFor({ primary: DIRECT, fallbackList: `${BOOK},${POS}`, native: true });
  check("A18 WEB is direct-first; its only fallback is \"/api\" on its own site (never an absolute proxy name)",
    JSON.stringify(webList) === JSON.stringify([DIRECT, "/api"]), JSON.stringify(webList));
  check("A19 ANDROID is direct-first, then the built-in proxy names in order", JSON.stringify(appList) === JSON.stringify([DIRECT, BOOK, POS]), JSON.stringify(appList));

  // A20: the env guard — a fallback that answers as the OTHER server is refused.
  log = []; st = mem(); t = 1_000_000;
  H.__setForTest({ fetchImpl: probe(new Set([BOOK, POS]), log, { [BOOK]: "staging" }), now, store: st, candidates: [DIRECT, BOOK, POS] });
  const r20 = await H.noteRequestFailure(netErr("ERR_NETWORK"));
  check("A20 a fallback whose /health says the OTHER env is skipped (prod page never lands on staging)", r20 === POS && H.getApiBase() === POS, `${r20} via ${log.join(" ")}`);
  check("A21 expected env comes from the direct address", H.expectedEnvFor("https://partenaire-account-server-staging.onrender.com/api") === "staging"
    && H.expectedEnvFor("https://api.partenairedozie.com/api") === "production");

  // A22–A24: the web DIAG line — CORS refusal vs a real block.
  const warns = []; const realWarn = console.warn; console.warn = (m) => warns.push(String(m));
  try {
    const corsFetch = (up) => async (url, opts = {}) => {
      log.push(opts.mode === "no-cors" ? `no-cors ${url}` : url);
      const base = url.replace(/\/health$/, "");
      if (base === DIRECT && opts.mode === "no-cors" && up.direct) return { ok: false, type: "opaque" };   // server answered; CORS hid it
      if (base === "/api") return { ok: true, json: async () => ({ env: "production" }) };
      throw new TypeError("Failed to fetch");
    };
    log = []; t = 1_000_000;
    H.__setForTest({ fetchImpl: corsFetch({ direct: true }), now, store: mem(), candidates: [DIRECT, "/api"], native: false });
    await H.noteRequestFailure(netErr("ERR_NETWORK")); await new Promise((r) => setTimeout(r, 20));
    const d1 = H.lastApiHostDiag();
    check("A22 web, direct reachable without CORS → DIAG says CORS mistake (and the fallback still works)",
      H.getApiBase() === "/api" && d1?.verdict === "cors" && warns.some((w) => w.includes("CORS mistake")), JSON.stringify(d1));
    const noCors = log.filter((l) => l.startsWith("no-cors"));
    check("A25 the DIAG sends exactly ONE no-cors request, GET <direct>/health — no app request, nothing else",
      noCors.length === 1 && noCors[0] === `no-cors ${DIRECT}/health`, noCors.join(" | "));
    warns.length = 0; log = []; t = 1_000_000;
    H.__setForTest({ fetchImpl: corsFetch({ direct: false }), now, store: mem(), candidates: [DIRECT, "/api"], native: false });
    await H.noteRequestFailure(netErr("ERR_NETWORK")); await new Promise((r) => setTimeout(r, 20));
    const d2 = H.lastApiHostDiag();
    check("A23 web, direct unreachable → DIAG says blocked", d2?.verdict === "blocked" && warns.some((w) => w.includes("unreachable")), JSON.stringify(d2));
    warns.length = 0; log = []; t = 1_000_000;
    H.__setForTest({ fetchImpl: corsFetch({ direct: true }), now, store: mem(), candidates: [DIRECT, "/api"], native: true });
    await H.noteRequestFailure(netErr("ERR_NETWORK")); await new Promise((r) => setTimeout(r, 20));
    check("A24 Android → no no-cors probe (CORS cannot be the cause there)", !log.some((l) => l.startsWith("no-cors")) && H.lastApiHostDiag() === null, log.join(" "));
  } finally { console.warn = realWarn; H.__setForTest({ native: false }); }

  // ── Part B ────────────────────────────────────────────────────────────────
  console.log("\n-- B. through the real api.js --\n");
  const axios = (await import("axios")).default;
  const sent = [];                 // every request the TRANSPORT saw
  let plan = () => ({ status: 200 });
  axios.defaults.adapter = async (config) => {
    const base = config.baseURL, url = config.url, method = (config.method || "get").toUpperCase();
    sent.push(`${method} ${base}${url}`);
    const p = plan(base, url, method);
    if (p.code) { const e = new axios.AxiosError(p.code, p.code, config, {}); throw e; }
    const response = { data: p.data || { success: true }, status: p.status, statusText: "", headers: {}, config, request: {} };
    if (p.status >= 400) throw new axios.AxiosError("bad", p.status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST", config, {}, response);
    return response;
  };
  // Part B is the ANDROID build: Capacitor present → the built-in proxy names are the fallbacks.
  globalThis.__q = []; globalThis.window = { dispatchEvent() {}, addEventListener() {}, location: { href: "" },
    Capacitor: { isNativePlatform: () => true } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const hlog = [];
  globalThis.fetch = probe(new Set([BOOK]), hlog);
  const { default: api } = await import(pathToFileURL(OUT_B).href + `?t=${Date.now()}`);
  const HB = await import(pathToFileURL(OUT_A).href + `?t=b${Date.now()}`);   // a separate instance for timing only
  void HB;

  // B1 an offline-eligible WRITE hits a reset on the direct address
  plan = (base) => (base === DIRECT ? { code: "ERR_NETWORK" } : { status: 201 });
  const salesRes = await api.post("/sales", { total: 1000 }).catch((e) => e);
  await new Promise((r) => setTimeout(r, 50));    // let the (un-awaited) probe finish
  const salesSent = sent.filter((s) => s.includes("/sales"));
  check("B1 the failed POST /sales went out EXACTLY ONCE (no re-send by the new code)", salesSent.length === 1, salesSent.join(" | "));
  check("B2 …and was queued EXACTLY ONCE, with its local_id", __q.length === 1 && __q[0].endpoint === "/sales" && !!JSON.parse(__q[0].payload_json || JSON.stringify(__q[0].payload || {})).local_id,
    `${__q.length} queued ${JSON.stringify(__q[0] || {}).slice(0, 120)}`);
  check("B3 the probe touched only /health", hlog.length > 0 && hlog.every((u) => u.endsWith("/health")), hlog.join(" "));
  check("B4 the queue replays against the CURRENT address", typeof globalThis.__sync?.getBaseUrl === "function" && globalThis.__sync.getBaseUrl() === BOOK, globalThis.__sync?.getBaseUrl?.());
  sent.length = 0;
  await api.get("/locations");
  check("B5 the NEXT request goes to the address that answered", sent[0] === `GET ${BOOK}/locations`, sent.join(" | "));

  // B6 a non-queued write (returns) hits a reset: sent once, error to the caller, nothing queued
  sent.length = 0; __q.length = 0; plan = () => ({ code: "ERR_NETWORK" });
  const ret = await api.post("/returns", { x: 1 }).then(() => "resolved", (e) => e.code);
  check("B6 a non-queued write that fails is sent ONCE and the error reaches the caller (never re-sent)",
    sent.filter((s) => s.includes("/returns")).length === 1 && __q.length === 0 && ret === "ERR_NETWORK", `${sent.join(" | ")} → ${ret}`);

  // B7/B8 HTTP answers never move the address
  hlog.length = 0;
  for (const status of [500, 404]) {
    sent.length = 0; plan = () => ({ status });
    await api.get("/reports/x").catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    check(`B7 a ${status} answer → no probe, address unchanged`, hlog.length === 0 && sent.every((s) => s.includes(BOOK)), `${hlog.length} probes · ${sent.join(" | ")}`);
  }
  sent.length = 0; plan = () => ({ code: "ECONNABORTED" });
  await api.post("/returns", { y: 1 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  check("B8 a TIMEOUT → no probe (it may have reached the server)", hlog.length === 0, `${hlog.length} probes`);

  // ── Part C: the WEB build through the real api.js ──────────────────────────
  console.log("\n-- C. web build: direct first, then /api on its own site --\n");
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, location: { href: "" } };   // no Capacitor
  globalThis.__q = []; globalThis.__sync = null;
  const clog = [];
  globalThis.fetch = probe(new Set(["/api"]), clog);
  sent.length = 0;
  const { default: webApi } = await import(pathToFileURL(OUT_C).href + `?t=c${Date.now()}`);
  plan = () => ({ status: 200 });
  await webApi.get("/locations");
  check("C1 web starts on the DIRECT address", sent[0] === `GET ${DIRECT}/locations`, sent.join(" | "));
  sent.length = 0; plan = (base) => (base === DIRECT ? { code: "ERR_NETWORK" } : { status: 201 });
  await webApi.post("/sales", { total: 500 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  check("C2 a reset on the direct address: the POST went out ONCE and was queued ONCE",
    sent.filter((s) => s.includes("/sales")).length === 1 && __q.length === 1, `${sent.join(" | ")} · ${__q.length} queued`);
  check("C3 the probe asked only \"/api/health\" (plus the one no-cors DIAG to the direct address)",
    clog.filter((u) => !u.startsWith("no-cors")).every((u) => u === "/api/health") && clog.includes("/api/health"), clog.join(" | "));
  sent.length = 0; plan = () => ({ status: 200 });
  await webApi.get("/locations");
  check("C4 the next request goes to \"/api\" on the page's own site", sent[0] === "GET /api/locations", sent.join(" | "));
  check("C5 the queue replays against \"/api\" now", globalThis.__sync?.getBaseUrl?.() === "/api", globalThis.__sync?.getBaseUrl?.());

  // ── Part S: static ────────────────────────────────────────────────────────
  console.log("\n-- S. one address source --\n");
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = resolve(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p); } };
  walk(SRC);
  const readers = files.filter((p) => readFileSync(p, "utf8").includes("VITE_API_URL"))
    .map((p) => p.slice(SRC.length + 1).split("\\").join("/")).sort();
  check("S1 only utils/api.js and utils/apiHost.js read VITE_API_URL (every other caller uses getApiBase)",
    JSON.stringify(readers) === JSON.stringify(["utils/api.js", "utils/apiHost.js"]), readers.join(", "));
  const ps = readFileSync(resolve(SRC, "utils/pendingSync.js"), "utf8");
  check("S2 the queue never builds a URL from the startup address (`${_apiBaseUrl}`)", !ps.includes("${_apiBaseUrl}"));
  const net = readFileSync(resolve(SRC, "utils/network.js"), "utf8");
  check("S3 the health ping follows the current address", /getApiBase\(\)\s*\+\s*'\/health'/.test(net) && !net.includes("VITE_API_URL"));
} catch (e) {
  fails++; console.log(`  FAIL  threw: ${e.stack || e.message}`);
} finally {
  for (const f of [OUT_A, OUT_B, OUT_W, OUT_C]) rmSync(f, { force: true });
}
console.log(`\n${fails ? `FAIL (${fails})` : "PASS"}`);
process.exit(fails ? 1 : 0);
