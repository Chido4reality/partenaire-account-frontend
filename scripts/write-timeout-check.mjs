// MP-FIRST-ATTEMPT-8S — which writes may time out early, and which may not.
//
// Cutting the first-attempt timeout to 8s means we will sometimes queue a write
// the server DID commit. That is only safe where the replay collapses to one row
// via a DATABASE constraint. So the risk here is not "the timeout is wrong" — it
// is "the LIST is wrong": one endpoint added to the fast list without a backing
// constraint is a duplicate sale in a real shop's books.
//
// This reads the SHIPPED lists out of api.js rather than a copy, and pins:
//   1. nothing gets a fast timeout unless it is also offline-eligible (i.e. has
//      a queue to fall into — otherwise an early abort just loses the write)
//   2. the three deliberate exclusions stay excluded
//   3. concrete URLs resolve to the timeout we intend
//   4. the QUEUE's own per-attempt ceiling is untouched (cold-start headroom on
//      replay is a separate concern from the interactive first attempt)
//   5. the redundant 3s health poll is gone and not reinstated
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = readFileSync(resolve(ROOT, "src/utils/api.js"), "utf8");
const sync = readFileSync(resolve(ROOT, "src/utils/pendingSync.js"), "utf8");
const hook = readFileSync(resolve(ROOT, "src/utils/useNetworkStatus.js"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

console.log("\n-- write timeout routing ------------------------------------\n");

// Evaluate the two REAL lists out of the shipped source.
const slice = (startMarker, endMarker) => {
  const a = api.indexOf(startMarker);
  const b = api.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error("could not slice " + startMarker);
  return api.slice(a, b + endMarker.length);
};
const ctx = { BASE_URL: "" };
vm.createContext(ctx);
// `const` at the top level of a vm Script lands in the declarative environment,
// NOT on the context object — so each list is explicitly published to globalThis.
const publish = (code, name) => vm.runInContext(code + "; globalThis." + name + " = " + name + ";", ctx);
publish(slice("const OFFLINE_ELIGIBLE = [", "];"), "OFFLINE_ELIGIBLE");
publish(slice("const FAST_FIRST_ATTEMPT = [", "];"), "FAST_FIRST_ATTEMPT");
publish(api.slice(api.indexOf("function isFirstAttemptFast"), api.indexOf("function isOfflineEligible")), "isFirstAttemptFast");
publish(api.slice(api.indexOf("function isOfflineEligible"), api.indexOf("}", api.indexOf("return OFFLINE_ELIGIBLE.some"))) + "}", "isOfflineEligible");

check("both lists parse out of the shipped api.js",
  Array.isArray(ctx.OFFLINE_ELIGIBLE) && Array.isArray(ctx.FAST_FIRST_ATTEMPT),
  `${ctx.OFFLINE_ELIGIBLE.length} eligible / ${ctx.FAST_FIRST_ATTEMPT.length} fast`);

// 1. A fast timeout without a queue would simply lose the write.
const orphans = ctx.FAST_FIRST_ATTEMPT.filter((rx) => {
  const sample = rx.source
    .replace(/^\^/, "").replace(/\\\/\?\$$/, "").replace(/\\\//g, "/")
    .replace(/\[\^\/\]\+/g, "X").replace(/\$$/, "");
  return !ctx.OFFLINE_ELIGIBLE.some((e) => e.rx.test(sample));
});
check("every FAST endpoint is also offline-eligible (has a queue to fall into)",
  orphans.length === 0, orphans.map((r) => r.source).join(" | ") || "none orphaned");

// 2. The deliberate exclusions.
const EXCLUDED = [
  ["/shifts/open", "no local_id, no unique index — replay leans on a 409"],
  ["/shifts/abc123/close", "same"],
  ["/stock/count", "dedup-safe but bulk counts[] is legitimately slow"],
];
for (const [url, why] of EXCLUDED) {
  const eligible = ctx.isOfflineEligible("POST", url);
  const fast = ctx.isFirstAttemptFast(url);
  check(`EXCLUDED stays at 45s: ${url}`, eligible && !fast, why);
}

// 3. Concrete routing. 8000 only for the confirmed-idempotent set.
const expect = [
  ["/sales", "POST", 8000], ["/sales/9f2/payment", "POST", 8000],
  ["/expenditures", "POST", 8000], ["/transfers", "POST", 8000],
  ["/transfers/77/dispatch", "POST", 8000], ["/transfers/77/confirm-receipt", "POST", 8000],
  ["/stock/arrivals", "POST", 8000], ["/customers/12/collect-debt", "POST", 8000],
  ["/stock-checks/55/resolve", "POST", 8000], ["/products", "POST", 8000],
  ["/products/42", "PATCH", 8000], ["/stock/adjust", "PATCH", 8000],
  ["/shifts/open", "POST", 45000], ["/shifts/abc/close", "POST", 45000],
  ["/stock/count", "POST", 45000],
];
let wrong = [];
for (const [url, method, want] of expect) {
  const got = ctx.isOfflineEligible(method, url)
    ? (ctx.isFirstAttemptFast(url) ? 8000 : 45000)
    : null;
  if (got !== want) wrong.push(`${method} ${url}: want ${want} got ${got}`);
}
check("all 15 offline-eligible writes route to the intended timeout",
  wrong.length === 0, wrong.join(" | ") || "12 fast / 3 held at 45s");

// A read must never be caught by this.
check("reads are untouched by the fast list",
  !ctx.isFirstAttemptFast("/products?limit=50") || !ctx.isOfflineEligible("GET", "/products?limit=50"),
  "GET /products is not an offline-eligible write");

// 4. Replay headroom is a different budget and must not shrink with it.
const qTimeout = (sync.match(/ENDPOINT_TIMEOUTS_MS\s*=\s*(\d+)/) || [])[1];
check("the QUEUE keeps its 45s per-attempt ceiling (cold-start headroom on replay)",
  qTimeout === "45000", `pendingSync ENDPOINT_TIMEOUTS_MS=${qTimeout}`);

// 5. The second health poll is gone.
console.log("");
check("useNetworkStatus no longer runs its own poll", !/setInterval/.test(hook));
check("...and no longer fetches its own /health", !/fetch\(|HEALTH_URL/.test(hook));
check("...it reads the shared signal from network.js",
  /from '\.\/network'/.test(hook) && /getNetworkStatus/.test(hook) && /onNetworkChange/.test(hook));
check("...and still returns { isOnline } so call sites are unchanged",
  /return \{ isOnline \}/.test(hook));

console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} write-timeout checks\n`);
process.exit(fails === 0 ? 0 : 1);
