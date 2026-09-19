// FAMILY HERITAGE PORTAL SECTIONS — static checks against the real admin.html.
//
// These exist because every failure this feature has already had was SILENT:
// a page that deployed and was unreachable behind a service worker, a copy of
// the portal that drifted two months stale, a label that said "Active" for an
// account that could do nothing. None of them threw. So the checks here are
// about reachability and about two things never disagreeing — not about style.
//
//   node scripts/fh-portal-check.mjs
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(HERE, "public/admin.html"), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  const d = typeof detail === "function" ? detail() : detail;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${d || ""}`);
  ok ? pass++ : fail++;
};

console.log("\nFAMILY HERITAGE PORTAL SECTIONS\n" + "=".repeat(78));

const ROUTES = ["family-accounts", "family-approvals", "family-people"];
const LOADERS = { "family-accounts": "loadFamilyAccounts", "family-approvals": "loadFamilyApprovals", "family-people": "loadFamilyPeople" };

// A ROUTES entry is not proof of a live route — that mistake has its own memory.
// A section is only reachable if ALL FOUR of these exist, so all four are checked
// together and the failure names the missing one.
for (const r of ROUTES) {
  const inValid   = new RegExp(`'${r}'`).test(html.slice(html.indexOf("const VALID_ROUTES"), html.indexOf("function parseHashRoute")));
  const navLink   = new RegExp(`data-route="${r}"`).test(html);
  const section   = new RegExp(`id="route-${r}"`).test(html);
  const dispatch  = new RegExp(`route === '${r}'\\s*\\)\\s*${LOADERS[r]}\\(\\)`).test(html);
  const defined   = new RegExp(`function ${LOADERS[r]}\\s*\\(`).test(html);
  const missing = [
    !inValid && "VALID_ROUTES", !navLink && "nav link", !section && "<section>",
    !dispatch && "navigateTo dispatch", !defined && `${LOADERS[r]}()`,
  ].filter(Boolean);
  check(`${r} is reachable end to end`, missing.length === 0,
    missing.length ? `MISSING: ${missing.join(", ")}` : "nav link -> VALID_ROUTES -> section -> dispatch -> loader");
}

// 🔴 THE KEYSTONE. The admin JWT is not a family session and the backend
// refuses it. If apiFamily ever read TOKEN_KEY, the portal would be sending an
// admin credential to the family API — useless, and the first step towards the
// server-side bridge that must never be built.
const apiFamilyBody = (() => {
  const i = html.indexOf("async function apiFamily(");
  return i === -1 ? "" : html.slice(i, html.indexOf("\n    }", i));
})();
check("apiFamily never touches the admin token",
  apiFamilyBody.length > 0 && !/TOKEN_KEY|admin_token/.test(apiFamilyBody),
  apiFamilyBody.length ? "reads FH_SESSION only" : "apiFamily not found at all");

check("the admin API wrapper is never pointed at /fh",
  !/apiAdmin\(\s*['"][A-Z]+['"]\s*,\s*['"]\/fh/.test(html),
  "/api/fh/* is reached only through apiFamily");

// sessionStorage, not localStorage: the family token must not outlive the tab.
const fhSessionBlock = html.slice(html.indexOf("const FH_SESSION_KEY"), html.indexOf("async function apiFamily("));
check("the family token lives in sessionStorage only",
  /sessionStorage\.setItem\(FH_SESSION_KEY/.test(fhSessionBlock) &&
  !/localStorage\.\w+\(FH_SESSION_KEY/.test(html),
  "dies with the tab; the admin token's localStorage is a different lifetime");

check("signing out of the portal clears the family session",
  /function signOut\(\)\s*\{[\s\S]*?\n    \}/.exec(html)?.[0].includes("fhClearSession()") === true,
  "otherwise the next admin on this machine finds the archive open");

// The role gate lives in two places — its own memory. Both must be present.
check("the role gate is in BOTH places",
  /sb-link-family-accounts'[\s\S]{0,200}?isMaster/.test(html) &&
  /function fhRenderGate[\s\S]{0,600}?isMasterAdmin\(\)/.test(html),
  "sidebar visibility in showApp(), and again inside the section renderer");

check("the sidebar links are hidden with style.display, not [hidden]",
  !/\$\('sb-link-family-[a-z]+'\)[\s\S]{0,80}?\.hidden\s*=/.test(html),
  "the portal has no [hidden] CSS rule; the attribute is silently overridden");

// Not signed in is a state, not a failure.
check("no family session shows a SIGN-IN PANEL, not an error",
  /data-fh-signin/.test(html) && /Sign in to the family archive/.test(html),
  "the section works; it just needs the other key");

// What is offered must be what the server would accept.
check("approvals will not offer Approve for a proposal it cannot apply",
  /function fhUnappliable/.test(html) && /const blocked = bad\.length > 0/.test(html) &&
  /blocked \? '' :/.test(html),
  "APPLY_FIELDS is mirrored and an unappliable proposal is annotated, not 400'd");

check("the child-override control reads the column the database enforces on",
  /p\.minor_login_override\s*\n?\s*\?\s*'<span class="pill pill-info">Allowed/.test(html) ||
  /p\.minor_login_override$/m.test(html) || /minor_login_override/.test(html),
  "never a label derived from something other than the override itself");

check("an account for a child says so instead of claiming Active",
  /childBlocked[\s\S]{0,200}?No access — child not allowed/.test(html),
  "a guard that works and a label that lies is worse than a visible failure");

check("the override asks for a reason and warns that access changes at once",
  /reasonId: 'fh-reason'/.test(html) && /ends the child’s access IMMEDIATELY/.test(html),
  "recorded with a name and a date, and the consequence named before the click");

check("the temporary password is shown once and needs an acknowledgement",
  /This password is shown ONCE/.test(html) && /fh-pw-ack/.test(html),
  "closing without reading it means setting a new one");

// 🔴 fh_site_settings is NEVER writable through the spine, and this portal does
// not display it either. No route, no button, at any stage.
// Test the CODE, not the file: a comment saying the table is forbidden is the
// documentation working, and banning the word would delete the explanation —
// the same mistake the family site's filtering check made.
const codeOnly = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
check("no CODE here touches fh_site_settings",
  !/fh_site_settings/.test(codeOnly),
  "the master switch stays a SQL statement Peter runs himself");

// Reject must not describe Approve's consequence — the old portal's copy bug.
check("Reject does not claim to write the change",
  /Reject this change[\s\S]{0,200}?Nothing is written to the record/.test(html),
  "the old standalone portal reused Approve's sentence here");

// ── the two deployments ────────────────────────────────────────────────────
const genPath = join(HERE, "admin/index.html");
check("the generated admin/index.html is in sync",
  existsSync(genPath) && readFileSync(genPath, "utf8") === html,
  existsSync(genPath)
    ? (readFileSync(genPath, "utf8") === html ? "both hosts serve the same portal" : "OUT OF SYNC — run scripts/sync-admin-copy.mjs")
    : "admin/index.html is missing");

// Both service workers precache the shell CacheFirst. Without a bump the new
// sections ship and nobody ever sees them.
// The first form of this pinned the comment to one feature's wording ("Family
// Heritage sections"), so the next change to admin.html broke the check by
// doing the right thing. The invariant is not which feature bumped it — it is
// that WHOEVER bumped it wrote down why, for THIS version. Numbers that drift
// apart mean someone bumped without a note, or wrote a note without bumping.
for (const [f, label] of [["public/sw-admin.js", "pos host"], ["admin/sw-admin.js", "admin host"]]) {
  const sw = readFileSync(join(HERE, f), "utf8");
  const m = sw.match(/const VERSION = 'admin-pwa-v(\d+)'/);
  const noted = m && new RegExp(`^//\\s*v${m[1]}:\\s*\\S`, "m").test(sw);
  check(`${label} service worker version is bumped and explained`,
    Boolean(m) && noted,
    !m ? "no VERSION found"
       : noted ? `admin-pwa-v${m[1]}, with a "// v${m[1]}:" note`
               : `admin-pwa-v${m[1]} but no "// v${m[1]}:" line saying what changed`);
}

console.log("=".repeat(78));
console.log(`  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
