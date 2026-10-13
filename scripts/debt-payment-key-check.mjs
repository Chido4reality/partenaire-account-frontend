// PHASE-1 item 5 — every invoice debt payment the app sends carries a local_id.
// Without one the server falls back to a keyless "same amount within 12 s" duplicate
// guard. Before Phase 1 that guard swallowed a SECOND cashier's real payment (10/10 on
// staging) while the POS printed a receipt. The server now scopes it to one cashier, but
// the app must still send a key so a retry is recorded exactly once.
// Static: every call to POST /sales/:id/payment in src must pass local_id in its body.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(f) && files.push(p); } })(SRC);

let calls = 0, bad = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const re = /api\.post\(\s*`\/sales\/\$\{[^}]+\}\/payment`\s*,\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    calls++;
    // the body object literal: from the "{" to its matching "}"
    let i = m.index + m[0].length, depth = 1;
    while (i < text.length && depth) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
    const body = text.slice(m.index + m[0].length, i - 1);
    if (!/\blocal_id\s*:/.test(body)) {
      const line = text.slice(0, m.index).split("\n").length;
      bad.push(`${f.slice(SRC.length + 1)}:${line}`);
    }
  }
}
if (calls === 0) { console.error("FAIL  no POST /sales/:id/payment call found — the check is looking in the wrong place"); process.exit(1); }
if (bad.length) { console.error(`FAIL  ${bad.length} of ${calls} invoice payment call(s) send no local_id:\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`pass  all ${calls} invoice payment calls send a local_id`);
