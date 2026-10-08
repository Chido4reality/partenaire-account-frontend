// WHO SEES COST (2026-10-08) — no stale cost left on a device after sign-in / app start.
// Runs the REAL src/utils/costCacheScrub.js against a scripted localStorage holding what
// a phone cached BEFORE the server stopped sending cost, and checks the App.jsx wiring.
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__cost_cache_scrub.mjs");
await build({ entryPoints: [resolve(SRC, "utils/costCacheScrub.js")], outfile: OUT, bundle: true, format: "esm", platform: "node", logLevel: "silent" });

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const store = (entries) => {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
try {
  const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const posCache = JSON.stringify({ ts: 1, data: { data: [{ id: "p1", name: "Pneu", sell_price: 12000, min_price: 9000, cost_price: 8500 }] } });
  const cart = JSON.stringify({ state: { carts: { A: [{ product_id: "p1", unit_price: 12000, cost_price: 8500 }] } }, version: 0 });
  const s = store({
    "cache_pos-products-v2-A": posCache,
    "cache_reports": JSON.stringify({ data: { gross_profit: 100, gross_sales: 900 } }),
    "mp-pos-draft-cart": cart,
    "cache_broken": '{"cost_price": 1, oops',
    "mp-auth": JSON.stringify({ state: { token: "t", user: { role: "cashier" } } }),
    "cache_customers": JSON.stringify({ data: [{ id: "c1", name: "Ali" }] }),
  });
  const n = M.scrubCachedCost(s);
  const pos = JSON.parse(s.getItem("cache_pos-products-v2-A"));
  check("the POS product cache is REWRITTEN without cost — selling prices kept (offline POS still works)",
    !s.getItem("cache_pos-products-v2-A").includes("cost_price") && pos.data.data[0].sell_price === 12000 && pos.data.data[0].min_price === 9000, s.getItem("cache_pos-products-v2-A"));
  check("the draft cart loses cost_price, keeps the line", !s.getItem("mp-pos-draft-cart").includes("cost_price") && s.getItem("mp-pos-draft-cart").includes("12000"));
  check("a cached report loses profit, keeps sales", !s.getItem("cache_reports").includes("gross_profit") && s.getItem("cache_reports").includes("gross_sales"));
  check("an unreadable cache entry that mentions cost is removed", s.getItem("cache_broken") === null);
  check("entries without cost are untouched (customers cache, auth session)", s.getItem("cache_customers").includes("Ali") && s.getItem("mp-auth").includes("cashier"));
  check("count reported = the 4 entries that held cost", n === 4, String(n));
  check("who is scrubbed: everyone but the owner", M.shouldScrubCost({ role: "cashier" }) && M.shouldScrubCost({ role: "accountant" }) && M.shouldScrubCost({ role: "warehouse" })
    && M.shouldScrubCost({ role: "manager" }) && !M.shouldScrubCost({ role: "owner" }) && !M.shouldScrubCost(null));
  const app = readFileSync(resolve(SRC, "App.jsx"), "utf8");
  check("App.jsx runs it at app start AND on every sign-in (effect keyed on user id/role)",
    /useEffect\(\(\) => \{\s*if \(shouldScrubCost\(sessionUser\)\) scrubCachedCost\(\);\s*\}, \[sessionUser\?\.id, sessionUser\?\.role\]\)/.test(app));
} catch (e) { fails++; console.log(`  FAIL  threw: ${e.message}`); }
finally { rmSync(OUT, { force: true }); }
console.log(`\n${fails ? `FAIL (${fails})` : "PASS"}`);
process.exit(fails ? 1 : 0);
