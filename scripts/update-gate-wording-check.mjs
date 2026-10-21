// UPDATE GATE × SYNC-AFTER-LOGOUT (2026-10-21) — every update screen tells the user to send pending sales
// first: a SALE queued by the old app has no recorded author and is held for the owner after the update.
// Static check on src/components/UpdateGate.jsx (the screens are exercised on the emulator in Step 2/5).
// Run: node scripts/update-gate-wording-check.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, "../src/components/UpdateGate.jsx"), "utf8");
let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); };

const block = (lang) => { const i = src.indexOf(`  ${lang}: {`); return src.slice(i, src.indexOf("\n  },", i)); };
const fr = block("fr"), en = block("en");
for (const key of ["sending", "kept", "pendingBefore"]) {
  const lineOf = (b) => (b.split("\n").find((l) => l.trim().startsWith(`${key}:`)) || "");
  check(`EN ${key}: "Send pending sales before updating"`, /Send pending sales before updating/.test(lineOf(en)));
  check(`FR ${key}: "Envoyez vos ventes en attente avant de mettre à jour"`, /Envoyez vos ventes en attente avant de mettre à jour/.test(lineOf(fr)));
}
check("EN/FR 'kept' no longer promises every pending item is sent after the update", !/kept and will be sent after the update/.test(en) && !/seront envoyés après la mise à jour/.test(fr));
check("the required screen shows the queue (sending / kept)", /data-update-queue="sending"/.test(src) && /data-update-queue="kept"/.test(src));
check("the reminder AND the downloaded sheets show 'send pending sales before updating' when something is queued",
  (src.match(/data-update-queue="pending-before"/g) || []).length === 2 && /sheetShown/.test(src) && /pendingCount\(\)/.test(src));
const firstReturn = src.indexOf("if (!view) return null");
check("the queue watchers are hooks above the first early return (hook order stays stable)",
  firstReturn > 0 && src.indexOf("[sheetShown]") > 0 && src.indexOf("[sheetShown]") < firstReturn && src.indexOf("[requiredShown]") < firstReturn);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
