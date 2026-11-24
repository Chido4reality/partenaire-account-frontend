// TEST A FIX 1 (2026-11-23, Peter): an ONLINE bar bill must get its VNT number from the server, never an
// "OFFLINE-…" receipt. The cause was the 8 s fast-first timeout (the server took ~16 s) and the degraded
// pre-flight short-cut that sends writes straight to the queue. A bar bill (POST /sales + bar_tab_id) is
// exempt from both; every other write — New Sale included — is unchanged, and a device that is really
// OFFLINE still queues the bill.
//
// Part A runs the REAL isBarBillRequest (and safeJson) taken from src/utils/api.js. Part B checks the two
// lines that use it (timeout + pre-flight) — api.js cannot be loaded under node (axios, Capacitor, stores),
// so this is a source contract, and Part C proves the contract has teeth: the same checks on copies with
// each exemption removed (or widened to every write) must FAIL.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "../src/utils/api.js"), "utf8");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

// ── A. the real predicate ──────────────────────────────────────────────────────────────────────
const fnSrc = (name) => {
  const m = SRC.match(new RegExp(`(?:export )?function ${name}\\([^)]*\\) \\{[^\\n]*\\}\\s*\\n`))          // one-line body
    || SRC.match(new RegExp(`(?:export )?function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}`));           // block body
  if (!m) throw new Error(`${name} not found in api.js`);
  return m[0].replace(/^export /, "");
};
// stripApiBase: axios hands interceptors the RELATIVE url ("/sales"); an absolute one is reduced to its path
const stripApiBase = (u) => String(u).replace(/^https?:\/\/[^/]+/, "").replace(/^\/api(?=\/)/, "");
const isBarBillRequest = new Function("stripApiBase", `${fnSrc("safeJson")}\n${fnSrc("isBarBillRequest")}\nreturn isBarBillRequest;`)(stripApiBase);
console.log("── A. which request is a bar bill ──");
const cases = [
  ["POST /sales with bar_tab_id", { method: "post", url: "/sales", data: { bar_tab_id: "t1", items: [] } }, true],
  ["POST /sales with bar_tab_id as a JSON string", { method: "POST", url: "/sales", data: JSON.stringify({ bar_tab_id: "t1" }) }, true],
  ["POST /sales/ with a query string", { method: "post", url: "/sales/?x=1", data: { bar_tab_id: "t1" } }, true],
  ["POST https://host/api/sales (absolute)", { method: "post", url: "https://pos.example/api/sales", data: { bar_tab_id: "t1" } }, true],
  ["New Sale: POST /sales without bar_tab_id", { method: "post", url: "/sales", data: { items: [] } }, false],
  ["New Sale: bar_tab_id null", { method: "post", url: "/sales", data: { bar_tab_id: null } }, false],
  ["GET /sales", { method: "get", url: "/sales", data: { bar_tab_id: "t1" } }, false],
  ["POST /sales/ticket with bar_tab_id", { method: "post", url: "/sales/ticket", data: { bar_tab_id: "t1" } }, false],
  ["POST /sales/bundled-approval-request with bar_tab_id", { method: "post", url: "/sales/bundled-approval-request", data: { bar_tab_id: "t1" } }, false],
  ["unparseable body", { method: "post", url: "/sales", data: "{not json" }, false],
  ["no config", undefined, false],
];
for (const [label, cfg, want] of cases) check(`${label} → ${want}`, isBarBillRequest(cfg) === want, String(isBarBillRequest(cfg)));

// ── B. the two lines that use it (source contract) ────────────────────────────────────────────
const contract = (src) => {
  const out = [];
  const t = src.split("\n").find((l) => /config\.timeout\s*=/.test(l) && /isFirstAttemptFast/.test(l)) || "";
  out.push(["timeout: a bar bill skips the 8 s fast-first attempt (45 s like any slow write)",
    /isFirstAttemptFast\(config\.url\)\s*&&\s*!isBarBillRequest\(config\)\s*\?\s*firstAttemptMs\(\)\s*:\s*45000/.test(t), t.trim().slice(0, 140)]);
  const p = src.split("\n").find((l) => /if\s*\(\s*!net\.connected\s*\|\|/.test(l)) || "";
  out.push(["pre-flight: degraded → queue, EXCEPT a bar bill (it tries the network)",
    /!net\.connected\s*\|\|\s*\(\s*net\.degraded\s*&&\s*!isBarBillRequest\(config\)\s*\)/.test(p), p.trim().slice(0, 140)]);
  out.push(["pre-flight: a device that is really offline still queues EVERY write (bar bill included)",
    /if\s*\(\s*!net\.connected\s*\|\|/.test(p) && !/!net\.connected\s*&&/.test(p), p.trim().slice(0, 80)]);
  out.push(["the exemption is used in exactly these two places (not spread to other writes)", (src.match(/!isBarBillRequest\(config\)/g) || []).length === 2,
    String((src.match(/!isBarBillRequest\(config\)/g) || []).length)]);
  return out;
};
console.log("\n── B. the timeout + pre-flight contract (shipped api.js) ──");
for (const [label, ok, d] of contract(SRC)) check(label, ok, d);

// ── C. teeth: the contract must catch each way of breaking it ──────────────────────────────────
console.log("\n── C. teeth (mutated copies must FAIL) ──");
const muts = [
  ["timeout exemption removed", (s) => s.replace("isFirstAttemptFast(config.url) && !isBarBillRequest(config) ?", "isFirstAttemptFast(config.url) ?")],
  ["degraded exemption removed", (s) => s.replace("(net.degraded && !isBarBillRequest(config))", "net.degraded")],
  ["exemption widened to every write (offline bypass)", (s) => s.replace("if (!net.connected || (net.degraded && !isBarBillRequest(config)))", "if ((!net.connected || net.degraded) && !isBarBillRequest(config))")],
];
for (const [label, fn] of muts) {
  const m = fn(SRC);
  if (m === SRC) { check(`teeth "${label}": the mutation applied`, false, "anchor not found"); continue; }
  const red = contract(m).filter(([, ok]) => !ok).length;
  check(`teeth "${label}": contract goes red`, red > 0, `${red} failed`);
}

console.log(fails ? `\n${fails} FAILED` : "\n  ALL bar-bill online checks passed");
process.exit(fails ? 1 : 0);
