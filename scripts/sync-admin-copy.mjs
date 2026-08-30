// admin/index.html is a GENERATED copy of public/admin.html — never edit it.
//
// WHY THIS EXISTS
// ---------------
// The admin portal is deployed twice:
//   • pos.partenairedozie.com/admin.html      ← from public/admin.html
//   • partenairedozieadmin.com/  (root)       ← from admin/index.html
// a separate Vercel project whose root directory is frontend/admin, with its
// own PWA manifest, service worker and icon.
//
// Those two HTML files were HAND-MAINTAINED duplicates, and they silently
// drifted: on 2026-08-30 the admin domain was still serving a 2026-07-10 build
// — no Phase 1 marketing screens, no org soft-delete Delete/Restore, and a
// marketer logging in there saw the full sidebar and an "ADMIN" badge while the
// API correctly refused them. Nothing failed loudly; it just served old code.
//
// The HTML is a PURE copy — verified: both reference /admin-manifest.json,
// /sw-admin.js and /icon.svg identically. Only sw-admin.js and
// admin-manifest.json genuinely differ per host (shell '/' vs '/admin.html'),
// so those are NOT touched here and stay maintained per directory.
//
// USAGE
//   node scripts/sync-admin-copy.mjs           → regenerate admin/index.html
//   node scripts/sync-admin-copy.mjs --check   → fail if out of sync (the gate)

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "public/admin.html");
const DST = resolve(ROOT, "admin/index.html");
const checkOnly = process.argv.includes("--check");

const sha = (b) => createHash("sha256").update(b).digest("hex");

const src = readFileSync(SRC);
let dst = null;
try { dst = readFileSync(DST); } catch { /* missing is a valid "out of sync" */ }

const srcHash = sha(src);
const dstHash = dst ? sha(dst) : null;

if (srcHash === dstHash) {
  console.log(`  admin/index.html is in sync with public/admin.html (${srcHash.slice(0, 12)}…)`);
  process.exit(0);
}

if (checkOnly) {
  console.error("");
  console.error("  admin/index.html is OUT OF SYNC with public/admin.html");
  console.error(`    public/admin.html : ${src.length} bytes  ${srcHash.slice(0, 12)}…`);
  console.error(`    admin/index.html  : ${dst ? dst.length + " bytes  " + dstHash.slice(0, 12) + "…" : "MISSING"}`);
  console.error("");
  console.error("  admin/index.html is GENERATED. Edit public/admin.html, then run:");
  console.error("      npm run sync:admin");
  console.error("");
  console.error("  Shipping them out of sync means partenairedozieadmin.com serves");
  console.error("  different code from pos.partenairedozie.com — which is exactly how");
  console.error("  a 7-week-stale admin portal reached production once already.");
  process.exit(1);
}

writeFileSync(DST, src);
console.log(`  regenerated admin/index.html from public/admin.html (${src.length} bytes, ${srcHash.slice(0, 12)}…)`);
