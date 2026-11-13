// ORANGE STEP 3a — which API address each build and each site calls.
//
// THE RISK: the web build and the Android build share .env.production. Pointing the web at the
// same-site "/api" (the Vercel proxy) by editing .env.production would send the APK to
// https://localhost/api — its own files — and every APK would stop working. So the choice is made at
// RUN time by src/utils/apiBase.js, and this check holds every row of it:
//   • web on book.stenamo.com / pos.partenairedozie.com      → "/api"
//   • Android (Capacitor), whatever its hostname              → the built direct address
//   • staging, previews, local dev, any other host            → the built address, unchanged
//   • .env.production still carries the direct address (the APK's)
//   • nothing in src/ reads VITE_API_URL or hard-codes the API host except apiBase.js
//   • public/learn.html follows the same rule
//   • the fast first attempt is 20 s only through the proxy, 8 s everywhere else
//
// The module under test is the REAL file, bundled with esbuild with the build value defined
// (the same substitution Vite does), once per scenario.
import { build } from "esbuild";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MOD = resolve(ROOT, "src/utils/apiBase.js");
const PROD = "https://api.partenairedozie.com/api";
const STAGING = "https://partenaire-account-server-staging.onrender.com/api";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

let n = 0;
async function load({ built, hostname, native }) {
  const out = resolve(HERE, `__api_base_under_test_${n++}.mjs`);
  await build({
    entryPoints: [MOD], outfile: out, bundle: true, format: "esm", platform: "node", logLevel: "silent",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(built) },
  });
  globalThis.location = { hostname };
  globalThis.window = native ? { Capacitor: { isNativePlatform: () => true } } : {};
  try { return await import("file:///" + out.replace(/\\/g, "/")); }
  finally { rmSync(out, { force: true }); delete globalThis.location; delete globalThis.window; }
}

console.log("\n── API address per build and site (ORANGE STEP 3a) ─────────────\n");

const SCENARIOS = [
  // [label, built, hostname, native, want API_BASE, want VIA proxy]
  ["prod web on book.stenamo.com",           PROD,    "book.stenamo.com",        false, "/api", true],
  ["prod web on pos.partenairedozie.com",    PROD,    "pos.partenairedozie.com", false, "/api", true],
  ["prod web, host in capitals",             PROD,    "BOOK.Stenamo.com",        false, "/api", true],
  ["Android APK (https://localhost)",        PROD,    "localhost",               true,  PROD,   false],
  ["Android, even if its host looked prod",  PROD,    "book.stenamo.com",        true,  PROD,   false],
  ["Android page before Capacitor is seen",  PROD,    "localhost",               false, PROD,   false],
  ["staging site",                           STAGING, "staging.stenamo.com",     false, STAGING, false],
  ["a Vercel preview",                       PROD,    "partenaire-account-frontend-abc.vercel.app", false, PROD, false],
  ["a look-alike host",                      PROD,    "book.stenamo.com.evil.example", false, PROD, false],
  ["local dev with no VITE_API_URL",         "",      "localhost",               false, "/api", false],
];
for (const [label, built, hostname, native, want, wantVia] of SCENARIOS) {
  const m = await load({ built, hostname, native });
  check(`${label} → ${want}`, m.API_BASE === want && m.VIA_SAME_SITE_PROXY === wantVia,
    `API_BASE=${m.API_BASE} via_proxy=${m.VIA_SAME_SITE_PROXY}`);
}

console.log("\n  stripping the base");
{
  const m = await load({ built: PROD, hostname: "book.stenamo.com", native: false });
  const rows = [
    ["/api/sales", "/api", "/sales"],
    ["/sales", "/api", "/sales"],
    ["/products?search=a/apib", "/api", "/products?search=a/apib"],   // String.replace would have cut this
    [`${PROD}/sales`, PROD, "/sales"],
    ["/sales", PROD, "/sales"],
    ["", "/api", ""],
  ];
  const bad = rows.filter(([u, b, w]) => m.stripApiBase(u, b) !== w).map(([u, b, w]) => `${u}|${b} → ${m.stripApiBase(u, b)} want ${w}`);
  check("only a LEADING base is removed", bad.length === 0, bad.join(" ; ") || `${rows.length} rows`);
}

console.log("\n  the Android address is untouched");
{
  const env = readFileSync(resolve(ROOT, ".env.production"), "utf8");
  const v = (env.match(/^VITE_API_URL=(.*)$/m) || [])[1];
  check(".env.production still points at the direct prod API (the APK's address)", v === PROD, String(v));
}

console.log("\n  one place decides");
{
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(f) && files.push(p); } };
  walk(resolve(ROOT, "src"));
  const readers = files.filter((f) => readFileSync(f, "utf8").includes("VITE_API_URL")).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  check("only src/utils/apiBase.js reads VITE_API_URL", readers.length === 1 && readers[0] === "src/utils/apiBase.js", readers.join(", "));
  // A quoted address, not a mention in a comment.
  const hard = files.filter((f) => /["'`]https?:\/\/api\.partenairedozie\.com/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  check("no file in src/ has the API address as a string (comments may name it)", hard.length === 0, hard.join(", ") || "none");
}

console.log("\n  public/learn.html follows the same rule");
{
  const html = readFileSync(resolve(ROOT, "public/learn.html"), "utf8");
  const start = html.indexOf("var API = (function () {");
  const end = html.indexOf("})();", start);
  const code = html.slice(start, end + 5);
  const learn = (hostname, port = "") => {
    const ctx = { location: { hostname, port, search: "" }, URLSearchParams };
    vm.createContext(ctx);
    vm.runInContext(code + "; globalThis.API = API;", ctx);
    return ctx.API;
  };
  const rows = [
    ["book.stenamo.com", "", "/api"], ["pos.partenairedozie.com", "", "/api"],
    ["localhost", "", PROD], ["staging.stenamo.com", "", STAGING], ["x.vercel.app", "", STAGING],
    ["localhost", "5173", "http://localhost:3001/api"],
  ];
  const bad = start < 0 ? ["block not found"] : rows.filter(([h, p, w]) => learn(h, p) !== w).map(([h, p, w]) => `${h}:${p} → ${learn(h, p)} want ${w}`);
  check("learn.html: prod sites → /api, Android/staging/dev unchanged", bad.length === 0, bad.join(" ; ") || `${rows.length} rows`);
}

console.log("\n  the first attempt through the proxy");
{
  const api = readFileSync(resolve(ROOT, "src/utils/api.js"), "utf8");
  check("FIRST_ATTEMPT_MS = 20 s through the proxy, 8 s otherwise",
    /export const FIRST_ATTEMPT_MS = VIA_SAME_SITE_PROXY \? 20000 : 8000;/.test(api));
  check("the fast writes use it", /config\.timeout = isFirstAttemptFast\(config\.url\) \? FIRST_ATTEMPT_MS : 45000;/.test(api));
  check("api.js takes its base from apiBase", /const BASE_URL = API_BASE;/.test(api) && !/\.replace\(BASE_URL/.test(api));
}

console.log("\n  the health ping through the proxy");
{
  const net = readFileSync(resolve(ROOT, "src/utils/network.js"), "utf8");
  check("PING_INTERVAL_MS = 30 s through the proxy, 10 s otherwise",
    /export const PING_INTERVAL_MS = VIA_SAME_SITE_PROXY \? 30000 : 10000;/.test(net));
  check("the web health monitor uses it", /setInterval\(tick, PING_INTERVAL_MS\)/.test(net));
  check("network.js takes VIA_SAME_SITE_PROXY from apiBase",
    /import \{ API_BASE, VIA_SAME_SITE_PROXY \} from "\.\/apiBase"/.test(net));
}

console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "all api-base checks pass"}\n`);
process.exit(fails ? 1 : 0);
