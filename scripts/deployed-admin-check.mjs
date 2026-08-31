// Asserts what is ACTUALLY SERVED, not what is in the working tree.
//
// THE GAP THIS CLOSES
// -------------------
// On 2026-08-30 the marketer role shipped and every local check was green:
// the scope rig proved API refusals, the render rig proved the sidebar hiding,
// the badge and the landing route — all against public/admin.html. Peter then
// logged in as a real marketer and saw the FULL sidebar, an "ADMIN" badge and
// the dashboard.
//
// Cause: partenairedozieadmin.com is a SEPARATE deployment served from
// admin/index.html, which was a hand-maintained duplicate last touched
// 2026-07-10. It contained none of the marketer code. Every rig read the local
// source file, so nothing ever looked at the bytes a browser receives.
//
// Rule this encodes: a deploy is not proven by a successful push. Fetch the URL
// a human uses and assert the markers are in the response.
//
// Network-dependent by design. If a host is unreachable it SKIPS loudly rather
// than passing — a green run must never mean "could not check".

const HOSTS = [
  ["pos.partenairedozie.com", "https://pos.partenairedozie.com/admin.html"],
  ["partenairedozieadmin.com", "https://www.partenairedozieadmin.com/"],
];

// Markers that must exist in the DEPLOYED html. Each is tied to a symptom Peter
// actually saw, so a failure names the user-visible breakage, not a string.
const MARKERS = [
  ["isMarketer",                    "marketer branch in showApp (full sidebar / wrong badge)"],
  ["sb-link-mymarketing",           "the My marketing nav link"],
  ["route-my-marketing",            "the marketing screen section"],
  ['value="marketer"',              "Marketer option in the role dropdowns"],
  // Wrapped in the translator since the French pass — pin the call, not the
  // bare literal, or this fails the moment a string becomes translatable.
  ["roleEl.textContent = i18n('Marketer')", "the sidebar badge saying Marketer, not ADMIN"],
  ["loadMyMarketing",               "the marketing screen loader"],
];

let fails = 0, skips = 0;
function check(label, ok, detail = "") {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
}

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now(),
      { redirect: "follow", signal: ctl.signal });
    if (!res.ok) return { err: `HTTP ${res.status}` };
    return { body: await res.text() };
  } catch (e) {
    return { err: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

console.log("\n── deployed admin portal check ──────────────────────────────\n");

const bodies = {};
for (const [name, url] of HOSTS) {
  console.log(`${name}`);
  const { body, err } = await fetchText(url);
  if (err) {
    skips++;
    console.log(`  SKIP  unreachable (${err}) — NOT a pass; re-run when online`);
    continue;
  }
  bodies[name] = body;
  console.log(`  served ${body.length} chars`);
  for (const [marker, why] of MARKERS) {
    check(`${name}: serves ${why}`, body.includes(marker), body.includes(marker) ? "" : `missing "${marker}"`);
  }
  // Settings must NOT be reachable in the marketer nav allow-list.
  check(`${name}: marketer nav is my-marketing ONLY (Settings hidden)`,
    body.includes("(r === 'my-marketing') ? '' : 'none'"),
    body.includes("r === 'settings'") ? "still allows settings" : "");
}

// The regression itself: the two hosts drifting apart.
const names = Object.keys(bodies);
if (names.length === 2) {
  const [a, b] = names;
  check("both hosts serve the SAME build (no duplicate drift)",
    bodies[a].length === bodies[b].length,
    `${a}=${bodies[a].length}B  ${b}=${bodies[b].length}B`);
}

if (skips) console.log(`\n  ${skips} host(s) SKIPPED — this run did not fully verify the deploy.`);
console.log(`\n  ${fails === 0 ? (skips ? "no failures (with skips)" : "ALL") : fails + " FAILED of"} deployed-admin checks\n`);
process.exit(fails === 0 ? 0 : 1);
