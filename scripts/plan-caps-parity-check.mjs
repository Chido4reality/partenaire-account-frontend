// LAUNCH-BATCH-2b: the app's copy of the plan limits (src/utils/planCapabilities.js) must be
// the server's (backend/src/lib/planCapabilities.js) — they drifted once (cards 5/200/5 vs
// 2/∞/2 enforced). Every plan, every cap and gate, and Peter's numbers pinned.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PLAN_CAPABILITIES as FE } from "../src/utils/planCapabilities.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BE_FILE = resolve(HERE, "../../backend/src/lib/planCapabilities.js");
if (!existsSync(BE_FILE)) { console.log("  ....  SKIPPED — backend/ is not checked out beside frontend/"); process.exit(0); }
const { PLAN_CAPABILITIES: BE } = createRequire(import.meta.url)(BE_FILE);
let fails = 0;
const check = (name, ok, got) => { if (!ok) { fails++; console.log(`  FAIL  ${name}  ${got ?? ""}`); } else console.log(`  pass  ${name}`); };
const KEYS = ["inventory_cap", "staff_cap", "location_cap", "sections", "duration_days", "csv_exports", "dozie_access", "compare", "track_expiry", "alias_of"];
const plans = [...new Set([...Object.keys(FE), ...Object.keys(BE)])];
for (const p of plans) {
  const diffs = KEYS.filter((k) => JSON.stringify(FE[p]?.[k] ?? null) !== JSON.stringify(BE[p]?.[k] ?? null));
  check(`${p}: app = server`, !!FE[p] && !!BE[p] && diffs.length === 0, diffs.map((k) => `${k} app ${JSON.stringify(FE[p]?.[k])} server ${JSON.stringify(BE[p]?.[k])}`).join("; "));
}
const lim = (c) => `${c.location_cap}/${c.inventory_cap}/${c.staff_cap}`;
check("Lite = 1 location / 100 products / 2 users (Peter, 2026-10-13)", lim(BE.lite) === "1/100/2", lim(BE.lite));
check("Pro and Pro Plus unlimited", lim(BE.pro) === "null/null/null" && lim(BE.pro_plus) === "null/null/null");
check("trial window 30 days", BE.trial.duration_days === 30, BE.trial.duration_days);
if (fails) { console.log(`\n  ${fails} FAILED`); process.exit(1); }
