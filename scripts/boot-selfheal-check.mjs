// BOOT SELF-HEAL CAP (2026-10-27) — a chunk that fails AFTER the app mounted must not reload the tab
// in a loop. On 2026-10-27 Peter's account booted the app ~22 times in 31 s after a deploy; the
// self-heal counter was cleared by main.jsx on every mount, so a post-mount failure was never capped.
//
// Runs the REAL inline recovery script from index.html in a sandbox (fake clock, sessionStorage that
// survives reloads like a real tab's, location.reload counted), applies whatever main.jsx does to
// sessionStorage at mount, and simulates: load → mount → a lazy chunk fails → (reload?) → …
//   §1 a chunk failing after EVERY mount for 3 minutes → at most 1 automatic reload per 60 s
//   §2 the first failure still self-heals (one reload), and again after 60 s of clean running
//   §3 offline → no reload; storage unreadable → no reload; the Retry button always reloads
// Teeth: INDEX_HTML=<old index.html> MAIN_JSX=<old main.jsx> node scripts/boot-selfheal-check.mjs → must FAIL.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.INDEX_HTML || resolve(HERE, "..", "index.html"), "utf8");
const mainSrc = readFileSync(process.env.MAIN_JSX || resolve(HERE, "..", "src", "main.jsx"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

// the inline recovery script (the one plain <script> that listens for vite:preloadError)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const recovery = scripts.find((s) => s.includes("vite:preloadError"));
check("index.html has the inline recovery script", !!recovery);
// what main.jsx does to sessionStorage at the top level when the app mounts
const mountRemoves = [...mainSrc.matchAll(/^try \{ sessionStorage\.removeItem\("([^"]+)"\)/gm)].map((m) => m[1]);
const mountSets = [...mainSrc.matchAll(/^try \{ sessionStorage\.setItem\(/gm)].length;

function makeTab({ online = true, storageBroken = false } = {}) {
  const store = new Map();
  const tab = { now: 1_800_000_000_000, reloads: 0, retryShown: false, store };
  const sessionStorage = {
    getItem: (k) => { if (storageBroken) throw new Error("off"); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageBroken) throw new Error("off"); store.set(k, String(v)); },
    removeItem: (k) => { if (storageBroken) throw new Error("off"); store.delete(k); },
  };
  tab.load = async () => {          // a fresh page in the same tab: the inline script runs again
    const handlers = {};
    const els = { "mp-boot": {}, "mp-boot-slow": { hidden: true }, "mp-boot-retry": { hidden: true, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } } };
    const ctx = {
      window: { addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); }, location: { reload: () => { tab.reloads++; } } },
      document: { getElementById: (id) => els[id] || null },
      navigator: { onLine: online, serviceWorker: { getRegistrations: () => Promise.resolve([]) } },
      caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
      sessionStorage, setTimeout: () => 0, parseInt, String, Promise,
      Date: { now: () => tab.now },
    };
    vm.runInNewContext(recovery, ctx);
    tab.page = { handlers, els };
  };
  tab.mount = () => {               // main.jsx ran: the boot screen is gone, its top-level storage calls ran
    delete tab.page.els["mp-boot"];
    for (const k of mountRemoves) try { sessionStorage.removeItem(k); } catch { /* storage off */ }
  };
  tab.chunkFails = async () => {    // a lazy chunk fails to load → vite:preloadError
    const before = tab.reloads;
    for (const f of tab.page.handlers["vite:preloadError"] || []) f({});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    tab.retryShown = tab.page.els["mp-boot-retry"].hidden === false;
    return tab.reloads > before;
  };
  return tab;
}

console.log("\n-- BOOT SELF-HEAL: at most one automatic reload per tab per minute ----------\n");
check("main.jsx never WRITES the self-heal cap at mount", mountSets === 0);

// §1 the loop: every mount, a lazy chunk fails; each cycle takes ~1.5 s (Peter: 22 boots in 31 s)
{
  const tab = makeTab();
  const reloadTimes = [];
  await tab.load();
  for (let t = 0; t < 180_000; t += 1500) {
    tab.now += 1500;
    tab.mount();
    if (await tab.chunkFails()) { reloadTimes.push(tab.now); await tab.load(); }
  }
  const worstMinute = Math.max(0, ...reloadTimes.map((t0) => reloadTimes.filter((t) => t >= t0 && t < t0 + 60_000).length));
  check("§1 a chunk failing after EVERY mount for 3 min → at most 1 automatic reload in any 60 s", worstMinute <= 1,
    `${reloadTimes.length} reloads in 3 min, worst minute ${worstMinute}`);
  check("…the first failure still self-healed once; after that the page stays put (one recovery attempt per page)",
    reloadTimes.length === 1, `${reloadTimes.length} reloads`);
}
// §2 normal life: one failure heals once; a second failure after 60 s of clean running heals again
{
  const tab = makeTab();
  await tab.load(); tab.now += 2000; tab.mount();
  check("§2 the first post-mount failure still self-heals (one reload)", await tab.chunkFails() === true);
  await tab.load(); tab.now += 2000; tab.mount();
  tab.now += 20_000;
  check("…a second failure 22 s later does NOT reload", await tab.chunkFails() === false);
  await tab.load(); tab.now += 2000; tab.mount(); tab.now += 61_000;
  check("…after 60 s of clean running, a new failure self-heals again", await tab.chunkFails() === true);
}
// §3 guards
{
  const off = makeTab({ online: false });
  await off.load(); off.now += 2000; off.mount();
  check("§3 offline → never reloads (the precache is the offline app)", await off.chunkFails() === false);
  const broken = makeTab({ storageBroken: true });
  await broken.load(); broken.now += 2000;
  check("…storage unreadable → no automatic reload (it could not be capped)", await broken.chunkFails() === false);
  const tab = makeTab();
  await tab.load(); tab.now += 1000;
  await tab.chunkFails();                     // before mount: the boot screen is still there → reload
  await tab.load(); tab.now += 1000;
  await tab.chunkFails();                     // capped → the Retry button is shown
  check("…a capped failure before mount shows the Retry button", tab.retryShown === true);
  const before = tab.reloads;
  tab.page.els["mp-boot-retry"].disabled = false;
  tab.page.els["mp-boot-retry"].listeners.click();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  check("…a tap on Retry always reloads (the person asked)", tab.reloads === before + 1);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
