// SPLIT RUN — the default way to run a HEAVY browser test on this PC (Peter 2026-11-24).
// One build step, then every browser case as its OWN short child process. Before each child it waits (up to
// waitSec) for ≥ startGB free; while a child runs it samples free memory every second and kills it below floorGB.
// After a floor stop nothing else starts: the parent reports and exits 99 (clean up, report, wait — Peter's rule).
// The children print the usual "  pass  …" / "  FAIL  …" lines; the parent adds them up.
//
//   await splitRun({ name, script, build: { env }, cases: [{ label, env }], teeth })
//   → exits 0 (all pass) / 1 (a failure) · teeth: 0 when RED as required, 1 when still green · 98 no memory · 99 floor
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import os from "node:os";

export const START_GB = Number(process.env.SPLIT_START_GB || 1.2);
export const FLOOR_GB = Number(process.env.SPLIT_FLOOR_GB || 0.9);   // never lower without asking Peter

// FreePhysicalMemory, as the watcher (watched.sh) reads it; os.freemem() as fallback
export function freeGB() {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"], { encoding: "utf8", timeout: 15000 });
      const kb = Number(String(out).trim()); if (kb > 0) return kb / 1048576;
    } catch { /* fall through */ }
  }
  return os.freemem() / 1073741824;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForStart(label, waitSec) {
  const until = Date.now() + waitSec * 1000;
  for (;;) {
    const f = freeGB();
    if (f >= START_GB) return f;
    if (Date.now() > until) { console.log(`!! WAIT ${label}: free ${f.toFixed(2)} GB < ${START_GB} after ${waitSec}s — not started`); return null; }
    await sleep(5000);
  }
}

// run one child under the floor; resolves { code, out, low, floorStop }
function runChild(script, env, label) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env, SPLIT_CHILD: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", low = Infinity, floorStop = false;
    child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    const t = setInterval(() => {
      const f = freeGB(); low = Math.min(low, f);
      if (f < FLOOR_GB && !floorStop) {
        floorStop = true; console.log(`!! MEMORY ${f.toFixed(2)} GB < ${FLOOR_GB} — stopping ${label}`);
        if (process.platform === "win32") { try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* */ } }
        else child.kill("SIGKILL");
      }
    }, 1000);
    child.on("exit", (code) => { clearInterval(t); done({ code, out, low, floorStop }); });
  });
}

export async function splitRun({ name, script, build, cases, teeth = false, waitSec = 180 }) {
  let passes = 0, fails = 0, low = Infinity;
  const steps = [{ label: "build", env: { ...(build?.env || {}), SPLIT_PHASE: "build" } }, ...cases.map((c) => ({ ...c, env: { ...c.env, SPLIT_PHASE: "run" } }))];
  for (const [i, s] of steps.entries()) {
    const start = await waitForStart(s.label, waitSec);
    if (start === null) { console.log(`\n${name}: STOPPED before ${s.label} (memory) — ${passes} pass / ${fails} fail so far`); process.exit(98); }
    console.log(`\n── [${i}/${steps.length - 1}] ${s.label} (start ${start.toFixed(2)} GB)`);
    const r = await runChild(script, s.env, s.label);
    low = Math.min(low, r.low);
    passes += (r.out.match(/^\s{2}pass\s/gm) || []).length;
    fails += (r.out.match(/^\s{2}FAIL\s/gm) || []).length;
    if (r.floorStop) { console.log(`\n${name}: FLOOR STOP in ${s.label} (low ${r.low.toFixed(2)} GB) — nothing else started; ${passes} pass / ${fails} fail so far`); process.exit(99); }
    if (s.label === "build" && r.code !== 0) { console.log(`\n${name}: build failed (exit ${r.code})`); process.exit(3); }
    if (r.code !== 0 && r.code !== 1) { fails++; console.log(`  FAIL  ${s.label}: child exited ${r.code}`); }
  }
  console.log(`\n(lowest free memory seen: ${low.toFixed(2)} GB · ${cases.length} runs)`);
  if (teeth) { console.log(`TEETH: ${fails ? `RED as required (${fails} failed)` : "STILL GREEN — the check has no teeth"}`); process.exit(fails ? 0 : 1); }
  console.log(fails ? `FAIL — ${fails} check(s) failed, ${passes} passed` : `PASS — ${passes}/${passes}: ${name}`);
  process.exit(fails ? 1 : 0);
}
