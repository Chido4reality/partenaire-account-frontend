// PUSH LOGOUT — a logout retires THIS phone's token and nothing else (2026-10-05).
//
// The bug this guards: revokeOnLogout ran on EVERY platform, and when the stored token was
// missing (always, in a browser) or stale, it fell back to DELETE /devices/token {all:true}
// — retiring every phone the user owned. On prod that wiped two users' live tokens at one
// instant on a logout and left an owner with no live device for a month; half the alerts
// addressed to a person in 30 days had nowhere to land.
//
// Drives the REAL utils/push.js with only its api module swapped for a recorder, and
// asserts the exact requests a logout makes. (The staging probe in the backend repo,
// scripts/push-logout-revoke-probe.mjs, asserts the STORED rows end to end.)
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "__push_logout.mjs");

// ./api → a recorder. Every call lands in globalThis.__calls; the reply is configurable.
const apiStub = {
  name: "api-stub",
  setup(b) {
    b.onResolve({ filter: /^\.\/api$/ }, () => ({ path: "api-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      loader: "js",
      contents: `
        const rec = (method) => async (url, cfg) => {
          globalThis.__calls.push({ method, url, data: cfg && cfg.data });
          return { data: globalThis.__reply ? globalThis.__reply(method, url, cfg && cfg.data) : {} };
        };
        export default { get: rec("get"), post: rec("post"), delete: rec("delete") };`,
    }));
  },
};

await build({
  entryPoints: [resolve(HERE, "../src/utils/push.js")],
  bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "silent",
  external: ["@capacitor/push-notifications"], plugins: [apiStub],
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = {};
const setNative = (on) => { globalThis.window.Capacitor = on ? { isNativePlatform: () => true } : undefined; };
const setToken = (t) => { t ? store.set("mp-push-token", t) : store.delete("mp-push-token"); };
const show = (calls) => JSON.stringify(calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.data ?? null)}`));
const anyAll = (calls) => calls.some((c) => c.data && c.data.all);

async function logout({ native, token, revoked = 1 }) {
  setNative(native); setToken(token);
  globalThis.__calls = [];
  globalThis.__reply = () => ({ success: true, revoked });
  await push.revokeOnLogout();
  return globalThis.__calls;
}

let push;
try {
  push = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const A = "tokA-this-phone-0123456789";

  console.log("WEB — a browser logout never touches a device token");
  let c = await logout({ native: false, token: null });
  check("web logout, no stored token → NO request at all", c.length === 0, show(c));
  // A browser never stores one; seeded anyway so the NATIVE check is tested on its own,
  // rather than being masked by the missing-token rule.
  c = await logout({ native: false, token: A });
  check("web logout, even WITH a stored token → NO request at all", c.length === 0, show(c));

  console.log("\nNATIVE — revokes THIS phone's token, exactly once, never 'all'");
  c = await logout({ native: true, token: A, revoked: 1 });
  check("native logout → exactly ONE request", c.length === 1, show(c));
  check("…and it is DELETE /devices/token { token: <this phone's> }",
    c[0]?.method === "delete" && c[0]?.url === "/devices/token" && c[0]?.data?.token === A && !("all" in (c[0]?.data || {})), show(c));
  check("…and the stored token is cleared afterwards", store.get("mp-push-token") === undefined);

  c = await logout({ native: true, token: A, revoked: 0 });
  check("native logout, STALE token (server matched 0) → still one request, NO {all} follow-up",
    c.length === 1 && !anyAll(c), show(c));

  c = await logout({ native: true, token: null });
  check("native logout, NO stored token → NO request (revoke nothing, not everything)", c.length === 0, show(c));
} catch (e) {
  console.error("!! rig error:", e.stack || e.message); fails++;
} finally {
  try { rmSync(OUT, { force: true }); } catch { /* noop */ }
}
console.log(fails ? `\n  ${fails} FAILED\n` : "\n  all passed\n");
process.exit(fails ? 1 : 0);
