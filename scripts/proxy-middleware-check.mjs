// ORANGE PROXY — the /api middleware (middleware.js) and the config it depends on.
//
// THE RISK (measured 2026-11-13): Vercel lets a caller's own x-vercel-forwarded-for / x-forwarded-for
// reach the API on ~half of proxied requests, so the API's per-address rate limits could be dodged.
// The middleware carries the edge address in x-stenamo-client-ip instead. This check runs the REAL
// middleware.js with forged headers and holds every rule:
//   • book. / pos. → prod API; staging / *.vercel.app → staging API; anything else not handled
//   • path and query kept
//   • x-stenamo-client-ip = the edge address (x-real-ip as Vercel gives it to middleware), never a
//     caller-sent x-stenamo-client-ip
//   • caller-sent x-forwarded-for / x-vercel-forwarded-for / forwarded / x-forwarded-host / secret
//     header are dropped; the middleware never SETS x-vercel-forwarded-for or x-real-ip itself
//   • the secret comes from the env; ordinary headers (Authorization, X-Collected-At…) pass through
//   • vercel.json is in the "rewrites" form (the legacy "routes" form silently disables middleware)
//     and has no /api rewrite of its own
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
process.env.STENAMO_PROXY_SECRET = "TestSecret0123456789abcdefABCDEF0123456789";
const mw = await import(pathToFileURL(resolve(ROOT, "middleware.js")).href);

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

const EDGE = "154.72.168.4";
const FORGED = {
  "x-real-ip": EDGE,                         // what Vercel's edge gives the middleware
  "x-vercel-forwarded-for": "198.19.1.1", "x-forwarded-for": "198.19.2.2", "forwarded": "for=198.19.5.5",
  "x-forwarded-host": "evil.example", "x-stenamo-client-ip": "198.19.4.4", "x-stenamo-proxy": "CallerGuess",
  "authorization": "Bearer abc.def.ghi", "x-collected-at": "2026-11-13T10:00:00.000Z", "content-type": "application/json",
};
function run(host, path = "/api/sales?x=1") {
  const req = new Request(`https://${host}${path}`, { method: "POST", headers: FORGED });
  const res = mw.default(req);
  if (!res) return null;
  const h = res.headers;
  const keys = (h.get("x-middleware-override-headers") || "").split(",").filter(Boolean);
  const up = Object.fromEntries(keys.map((k) => [k, h.get("x-middleware-request-" + k)]));
  return { dest: h.get("x-middleware-rewrite"), marker: h.get("x-stenamo-mw"), keys, up };
}

console.log("\n── /api middleware (ORANGE PROXY) ─────────────────────────────────\n");

check("matcher is /api/:path* only", JSON.stringify(mw.config) === JSON.stringify({ matcher: "/api/:path*" }), JSON.stringify(mw.config));
const ROUTES = [
  ["book.stenamo.com", "https://api.partenairedozie.com/api/sales?x=1"],
  ["pos.partenairedozie.com", "https://api.partenairedozie.com/api/sales?x=1"],
  ["BOOK.Stenamo.com", "https://api.partenairedozie.com/api/sales?x=1"],
  ["staging.stenamo.com", "https://partenaire-account-server-staging.onrender.com/api/sales?x=1"],
  ["partenaire-account-frontend-abc.vercel.app", "https://partenaire-account-server-staging.onrender.com/api/sales?x=1"],
];
for (const [host, want] of ROUTES) {
  const r = run(host);
  check(`${host} → ${want.split("/api/")[0]}`, r && r.dest === want && r.marker === "1", r ? r.dest : "not handled");
}
for (const host of ["book.stenamo.com.evil.example", "example.com"]) {
  check(`${host} → not handled`, run(host) === null);
}

const r = run("book.stenamo.com");
check("x-stenamo-client-ip = the edge address, not the caller's copy", r.up["x-stenamo-client-ip"] === EDGE, r.up["x-stenamo-client-ip"]);
check("the secret comes from the env, not the caller", r.up["x-stenamo-proxy"] === process.env.STENAMO_PROXY_SECRET);
const leaked = ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host", "host"].filter((k) => r.keys.includes(k));
check("caller address headers are dropped; x-vercel-forwarded-for / x-real-ip are never set by the middleware", leaked.length === 0, leaked.join(",") || "none");
check("ordinary headers pass through (Authorization, X-Collected-At, Content-Type)",
  r.up["authorization"] === FORGED.authorization && r.up["x-collected-at"] === FORGED["x-collected-at"] && r.up["content-type"] === FORGED["content-type"]);
{
  const noIp = mw.default(new Request("https://book.stenamo.com/api/health", { headers: { "x-stenamo-client-ip": "198.19.4.4" } }));
  const v = noIp.headers.get("x-middleware-request-x-stenamo-client-ip");
  check("no edge address → empty client address (the API then refuses to believe it), never the caller's", v === "", JSON.stringify(v));
}

console.log("\n  vercel.json");
{
  const vj = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8"));
  check("rewrites form, no legacy routes (routes disables middleware.js)", Array.isArray(vj.rewrites) && !("routes" in vj) && !("proxy" in vj), Object.keys(vj).join(","));
  check("no /api rewrite in vercel.json (the middleware is the only /api path)", !vj.rewrites.some((x) => /^\/api/.test(x.source)));
}

console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "all proxy-middleware checks pass"}\n`);
process.exit(fails ? 1 : 0);
