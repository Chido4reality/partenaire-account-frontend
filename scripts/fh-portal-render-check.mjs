// FAMILY HERITAGE PORTAL — render check.
//
// fh-portal-check.mjs reads the page as TEXT. This one RUNS it: the real inline
// script out of public/admin.html is evaluated against a DOM shim and the three
// loaders are driven with stubbed API payloads, so what is asserted is what the
// page actually produces. Same rig and same reasoning as
// marketing-render-check.mjs — the script text is read at run time, so a real
// break inside loadFamilyAccounts fails here; a copy-pasted fixture would not.
//
// It exists because the things most likely to go wrong in these sections are
// not syntax. They are: an account that cannot do anything being labelled
// "Active", an Approve button offered for a proposal the server would refuse,
// and the admin token leaking into a family request.
//
//   node scripts/fh-portal-render-check.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

// ── DOM shim ────────────────────────────────────────────────────────────────
function makeEl(id = "") {
  return {
    id, _html: "", textContent: "", value: "", checked: false, hidden: false,
    disabled: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    closest() { return null; }, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; }, remove() {},
    scrollIntoView() {},
  };
}
const els = new Map();
const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

const document = {
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, createElement: () => makeEl(),
  body: makeEl("body"), documentElement: makeEl("html"),
};

// Record every fetch so the two-identity rule can be asserted, not assumed.
const CALLS = [];
let NEXT = {};
const sandbox = {
  document, console,
  localStorage: { getItem: (k) => (k === "admin_token" ? "ADMIN-JWT-DO-NOT-LEAK" : null), setItem() {}, removeItem() {} },
  sessionStorage: (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  })(),
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, location: { hash: "" } },
  location: { hash: "", href: "http://x/admin.html", origin: "http://x", hostname: "admin.test", protocol: "http:", pathname: "/admin.html", search: "", reload() {} },
  navigator: { userAgent: "node", language: "en", clipboard: { writeText: async () => {} } },
  setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON,
  fetch: async (url, opts) => {
    CALLS.push({ url: String(url), headers: (opts && opts.headers) || {}, method: (opts && opts.method) || "GET" });
    const key = Object.keys(NEXT).find((k) => String(url).includes(k));
    const body = key ? NEXT[key] : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  },
  prompt: () => null, alert: () => {}, confirm: () => true,
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  URL, URLSearchParams, Blob: class {}, FormData: class {},
  AbortController: globalThis.AbortController, Promise, Error, RegExp,
  encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat,
  Number, String, Boolean, Array, Object,
};
sandbox.globalThis = sandbox;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.sessionStorage = sandbox.sessionStorage;

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let script = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
{
  const t = script.trim();
  const open = t.indexOf("(function () {");
  const close = t.lastIndexOf("})();");
  if (open === 0 && close > 0) script = t.slice("(function () {".length, close);
}
// `function f(){}` at script top level becomes a property of the vm global, but
// `let currentAdmin` does NOT — it is a lexical binding the rig cannot reach.
// Setting ctx.currentAdmin silently creates a DIFFERENT variable, and every
// section then renders as "not a master admin" while the role check appears to
// pass. So append an accessor. This ADDS a line; it rewrites nothing, and the
// role logic under test is still the shipped isMasterAdmin().
script += "\n;globalThis.__setAdmin = function (a) { currentAdmin = a; };\n";
// Same reason, same shape: FH_MEMBERS is a lexical binding the rig cannot reach
// from outside, and fhMemberAction looks the member up in it before doing
// anything at all.
script += "\n;globalThis.__setFhMembers = function (m) { FH_MEMBERS = m; };\n";

console.log("\n── family heritage portal render check ──────────────────────\n");
check("found the admin inline script", script.length > 100000, `${script.length} chars`);

const ctx = vm.createContext(sandbox);
try {
  new vm.Script(script, { filename: "admin.html:inline" }).runInContext(ctx);
  check("the real inline script EVALUATES (not just parses)", true);
} catch (err) {
  check("the real inline script EVALUATES (not just parses)", false, err.message);
  console.log(`\n  ${fails} FAILED\n`);
  process.exit(1);
}

for (const fn of ["loadFamilyAccounts", "loadFamilyApprovals", "loadFamilyPeople",
                  "apiFamily", "fhSignIn", "fhRenderGate", "fhRenderAll", "wireFamily",
                  "fhRenderAccounts", "fhRenderPeople", "fhRenderProposals", "fhUnappliable"]) {
  check(`${fn} is defined`, typeof ctx[fn] === "function", typeof ctx[fn]);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const PEOPLE = [
  { id: "p-adult", given_names: "Ada", surname: "Okafor", is_minor: false, minor_login_override: false,
    public_visibility: "full", birth_date: "1950-01-02", archived: false },
  { id: "p-child", given_names: "Chinemelu", surname: "Bright", is_minor: true, minor_login_override: false,
    public_visibility: "hidden", birth_date: "2015-06-01", archived: false },
  { id: "p-child-ok", given_names: "Ngozi", surname: "Bright", is_minor: true, minor_login_override: true,
    public_visibility: "hidden", birth_date: "2012-03-04", archived: false },
  // UNLINKED, so they actually reach the picker. p-adult and p-child below are
  // both already linked to members and are therefore filtered out of it — the
  // first version of these assertions tested a list that could never contain
  // them, and said so by failing.
  { id: "p-child-free", given_names: "Obiageli", surname: "Okafor", is_minor: true, minor_login_override: false,
    public_visibility: "hidden", birth_date: "2016-02-02", archived: false },
  { id: "p-adult-free", given_names: "Emeka", surname: "Okafor", is_minor: false, minor_login_override: false,
    public_visibility: "full", birth_date: "1978-07-07", archived: false },
  // ARCHIVED, and a child — the prod case (Honorine Okafor, 2026-09-25): the
  // roster showed her as live, with a Child badge and an "Allow a login" that
  // saved. One of her two relationships matches her archived_at, one does not.
  { id: "p-archived-child", given_names: "Honorine", surname: "Okafor", is_minor: true, minor_login_override: false,
    public_visibility: "hidden", birth_date: null, archived: true, archived_at: "2026-09-21T07:38:26Z",
    restore_relationships_back: 1, restore_relationships_not_back: 1 },
];
const MEMBERS = [
  { id: "m1", display_name: "Ada", email: "ada@x.test", person_id: "p-adult",
    can_view: true, can_edit: true, can_submit: true, can_archive: false,
    suspended: false, unlinked: false, must_change_password: false },
  // The account that looks perfect and can do nothing.
  { id: "m2", display_name: "Chinemelu", email: "c@x.test", person_id: "p-child",
    can_view: true, can_edit: true, can_submit: true, can_archive: false,
    suspended: false, unlinked: false, must_change_password: false },
];
const PROPOSALS = [
  { id: "s1", kind: "person", operation: "update", status: "pending", submitted_at: "2026-09-18T10:00:00Z",
    submitted_by_name: "Ada", payload: { biography: "A life." } },
  // birth_order passes the submission guard and is NOT in APPLY_FIELDS.person.
  { id: "s2", kind: "person", operation: "update", status: "pending", submitted_at: "2026-09-18T11:00:00Z",
    submitted_by_name: "Ada", payload: { birth_order: 3 } },
  // The four kinds added 2026-09-25. belief was approvable on the server and
  // hidden HERE — the portal's mirror had never been told about it.
  { id: "s3", kind: "belief", operation: "insert", status: "pending", submitted_at: "2026-09-25T10:00:00Z",
    submitted_by_name: "Ada", payload: { name: "Ancestral shrine", description: "Kept in the compound." } },
  { id: "s4", kind: "document", operation: "insert", status: "pending", submitted_at: "2026-09-25T10:01:00Z",
    submitted_by_name: "Ada", payload: { title: "Land deed", media_id: "11111111-1111-4111-8111-111111111111" },
    file: { mime_type: "application/pdf", byte_size: 250000 } },
  // A document whose file never arrived: the server answers 409 file_missing.
  { id: "s5", kind: "document", operation: "insert", status: "pending", submitted_at: "2026-09-25T10:02:00Z",
    submitted_by_name: "Ada", payload: { title: "Baptism card", media_id: "22222222-2222-4222-8222-222222222222" },
    file: null },
  { id: "s6", kind: "source", operation: "insert", status: "pending", submitted_at: "2026-09-25T10:03:00Z",
    submitted_by_name: "Ada", payload: { title: "Parish register", citation: "St Mary's, 1952" } },
];

// ── the role gate, place 2 ──────────────────────────────────────────────────
ctx.__setAdmin({ role: "admin" });
ctx.loadFamilyAccounts();
check("a non-master admin gets the permission placeholder, not the section",
  getEl("fa-no-permission").hidden === false && getEl("fa-body").hidden === true,
  `deny=${getEl("fa-no-permission").hidden} body=${getEl("fa-body").hidden}`);
// CONTROL: the same call as a master must NOT show the placeholder, or the
// check above would pass simply because nothing rendered at all.
ctx.__setAdmin({ role: "master_admin" });
ctx.fhClearSession();
ctx.loadFamilyAccounts();
check("CONTROL — a master admin does not get the placeholder",
  getEl("fa-no-permission").hidden === true,
  `deny=${getEl("fa-no-permission").hidden}`);

// ── master admin, no family session ─────────────────────────────────────────
ctx.__setAdmin({ role: "master_admin" });
ctx.fhClearSession();
ctx.loadFamilyAccounts();
const gate = getEl("fa-gate");
check("no family session shows a sign-in panel, not an error",
  gate.hidden === false && /data-fh-signin/.test(gate.innerHTML) && /Sign in to the family archive/.test(gate.innerHTML) &&
  !/error|failed|denied/i.test(gate.innerHTML),
  "panel rendered");
check("the sign-in panel says the portal login is a different account",
  /different account from your portal login/.test(gate.innerHTML), "");

// ── signed in to the family account ─────────────────────────────────────────
ctx.fhSaveSession({ access_token: "FAMILY-SUPABASE-TOKEN", email: "peter@x.test", display_name: "Peter" });
CALLS.length = 0;
NEXT = { "/owner/members": { members: MEMBERS }, "/owner/persons": { persons: PEOPLE } };
await ctx.loadFamilyAccounts();

check("the identity strip names the family account",
  /Peter/.test(getEl("fa-identity").innerHTML) && /owner/.test(getEl("fa-identity").innerHTML), "");

// 🔴 THE KEYSTONE, measured rather than reasoned about.
const fhCalls = CALLS.filter((c) => c.url.includes("/fh/"));
check("family requests carry the Supabase token",
  fhCalls.length > 0 && fhCalls.every((c) => String(c.headers.Authorization || "").includes("FAMILY-SUPABASE-TOKEN")),
  `${fhCalls.length} call(s)`);
check("no family request carries the admin JWT",
  fhCalls.every((c) => !JSON.stringify(c.headers).includes("ADMIN-JWT-DO-NOT-LEAK")),
  "the admin token never reaches /api/fh");

// ── the label that used to lie ──────────────────────────────────────────────
const accounts = getEl("fa-tbody").innerHTML;
check("a child with no override reads as NO ACCESS, not Active",
  /No access — child not allowed/.test(accounts), "");
check("the adult account still reads Active",
  /pill-success">Active/.test(accounts), "");
const childRow = accounts.slice(accounts.indexOf("Chinemelu"));
check("the child's row does not also claim Active",
  !/pill-success">Active/.test(childRow.slice(0, childRow.indexOf("</tr>") + 5)), "");

// ── the person picker: a child must not be a selectable option ──────────────
// Peter hit this on the live screen: Chinemelu Bright Okafor was selectable in
// "Create an account". The database would have refused the link, so nothing
// unsafe could land — but an option that 403s on submit is the same
// control-that-fails-when-clicked rule this build has caught four times.
const picker = getEl("fa-person").innerHTML;
check("a child without the override is in the list but DISABLED",
  /value="p-child-free"[^>]*\sdisabled/.test(picker), "");
check("and the option says what to do about it",
  /allow a login in Family people first/.test(picker), "the rule is taught, not hidden");
check("a child WITH the override is selectable",
  /value="p-child-ok"(?![^>]*\sdisabled)/.test(picker), "the override is what makes the difference");
check("the adult is selectable",
  /value="p-adult-free"(?![^>]*\sdisabled)/.test(picker), "");
check("the resting selection is never a disabled option",
  !/^p-child-free$/.test(getEl("fa-person").value),
  `defaults to ${getEl("fa-person").value || "(none)"}`);

// ── the roster ──────────────────────────────────────────────────────────────
await ctx.loadFamilyPeople();
const roster = getEl("fr-tbody").innerHTML;
check("a child without the override shows Not allowed", /Not allowed/.test(roster), "");
check("a child with the override shows Allowed", /pill-info">Allowed/.test(roster), "");
check("the override control is offered only for children",
  (roster.match(/data-fh-override/g) || []).length === 3, "3 of the 5 roster rows are children");
check("a minor's public column says a child is never public",
  /a child is never public/.test(roster), "");
check("the roster offers no way to edit a name",
  !/data-fh-edit|<input/.test(roster), "read-only, as briefed");

// ── archived people (2026-09-25) ────────────────────────────────────────────
check("an archived person is NOT listed by default", !/Honorine/.test(roster), "live people only until asked");
check("every live person can be archived", (roster.match(/data-fh-archive=/g) || []).length === 5, `${(roster.match(/data-fh-archive=/g) || []).length} Archive buttons`);
getEl("fr-show-archived").checked = true;
ctx.fhRenderPeople();
const withArchived = getEl("fr-tbody").innerHTML;
const hRow = (withArchived.split("<tr").find((r) => /Honorine/.test(r)) || "");
check("with Show archived, she is listed and plainly marked with her date",
  /Honorine/.test(hRow) && /Archived/.test(hRow) && /2026|21/.test(hRow), hRow.replace(/<[^>]+>/g, " ").replace(/s+/g, " ").slice(0, 120));
check("…and offered Restore, and NOTHING else — no override, no Archive, no publish",
  /data-fh-restore="p-archived-child"/.test(hRow) && !/data-fh-override/.test(hRow) && !/data-fh-archive/.test(hRow) && !/Public|Not public|Allowed|Not allowed/.test(hRow), "");
check("…and her row says how many relationships would NOT come back", /1 would not/.test(hRow), "");
{
  let spec = null; const real = ctx.fhConfirm; ctx.fhConfirm = (sp) => { spec = sp; };
  ctx.fhRestore("p-archived-child");
  ctx.fhConfirm = real;
  check("Restore warns BEFORE the click that the restore is partial",
    !!spec && /1 relationship will come back/.test(spec.sub) && /1 will NOT/.test(spec.sub) && spec.label === "Restore anyway",
    spec ? `${spec.label}: ${spec.sub.slice(0, 110)}…` : "no confirm");
}
getEl("fr-show-archived").checked = false;
ctx.fhRenderPeople();

// ── approvals ───────────────────────────────────────────────────────────────
NEXT = { "/owner/proposals": { proposals: PROPOSALS } };
await ctx.loadFamilyApprovals();
const props = getEl("fp-host").innerHTML;
const s1 = props.slice(props.indexOf('data-fh-prop="s1"') - 900, props.indexOf('data-fh-prop="s1"') + 200);
check("a proposal the server CAN apply offers Approve",
  /data-fh-prop="s1" data-fh-act="approve"/.test(props), "");
check("a proposal carrying birth_order offers NO Approve button",
  !/data-fh-prop="s2" data-fh-act="approve"/.test(props), "it would 400 at the server");
check("and says why, naming the field",
  /Cannot be approved here: birth_order/.test(props), "");
check("it can still be rejected",
  /data-fh-prop="s2" data-fh-act="reject"/.test(props), "");
check("fhUnappliable agrees with APPLY_FIELDS.person",
  ctx.fhUnappliable(PROPOSALS[1]).join(",") === "birth_order" &&
  ctx.fhUnappliable(PROPOSALS[0]).length === 0, "");
for (const id of ["s3", "s4", "s6"]) {
  const p = PROPOSALS.find((x) => x.id === id);
  check(`a ${p.kind} proposal offers Approve (the server applies it)`,
    new RegExp(`data-fh-prop="${id}" data-fh-act="approve"`).test(props),
    ctx.fhUnappliable(p).join(",") || "unappliable says nothing");
}
check("a document with its file shows it and offers to open it",
  /Attached: <b>PDF<\/b> · 244 KB/.test(props) && /data-fh-prop="s4" data-fh-act="file"/.test(props), "");
check("…and never prints the media_id",
  !/11111111-1111-4111-8111-111111111111/.test(props), "");
check("a document whose file never arrived offers NO Approve, and says why",
  !/data-fh-prop="s5" data-fh-act="approve"/.test(props) && /never arrived/.test(props) &&
  /data-fh-prop="s5" data-fh-act="reject"/.test(props), "the server would answer 409 file_missing");

/* ── THE OWNER MINTS A PASSWORD, AND ACTUALLY SEES IT ───────────────────────
   The bug: "New password" called PATCH /owner/members/:id {must_change_password}
   which only raises a flag — no password generated, none written to auth,
   nothing in the response — so the dialog closed on an empty hand while the
   screen promised a password shown once. Three family accounts were left with a
   credential nobody knew. These assertions fail on that code and pass on this. */
{
  const PW = "Xk7mQp2Rt9Vn4b";
  ctx.__setFhMembers([{ id: "m-paul", display_name: "Paul Okafor", person_id: "p-adult", unlinked: false }]);
  NEXT = { "/owner/members/m-paul/password": { member: { id: "m-paul", display_name: "Paul Okafor", must_change_password: true }, temporary_password: PW } };

  const shown = [];
  const realShow = ctx.fhShowPasswordOnce;
  ctx.fhShowPasswordOnce = (m, p, h) => { shown.push({ name: m && m.display_name, password: p, heading: h }); };
  let spec = null, onOk = null;
  const realConfirm = ctx.fhConfirm;
  ctx.fhConfirm = (s, ok) => { spec = s; onOk = ok; };

  await ctx.fhMemberAction("m-paul", "force-pw");
  check("the New password action offers a confirm that promises a password",
    !!spec && /New password/.test(spec.title) && /shown once/i.test(spec.sub || ""), spec ? spec.title : "none");

  const from = CALLS.length;
  await onOk();
  const made = CALLS.slice(from).map((c) => `${c.method} ${c.url}`);
  check("...and confirming calls POST …/password — the route that mints one",
    made.some((u) => /POST .*\/owner\/members\/m-paul\/password/.test(u)), made.join(" | ") || "no call");
  check("...and NOT the PATCH that only raises a flag",
    !made.some((u) => /PATCH .*\/owner\/members\/m-paul(\?|$)/.test(u)), made.join(" | "));
  check("...and the password reaches the panel the owner reads",
    shown.length === 1 && shown[0].password === PW, JSON.stringify(shown));
  check("...labelled as a new password, not as a new account",
    shown[0] && shown[0].heading === "New password", shown[0] && shown[0].heading);

  /* CREATE: the password used to be rendered AFTER two list reloads were
     awaited, so a reload that threw was caught by the outer handler, turned
     into a toast, and the only copy of the password was discarded — with the
     account already created. Make both reloads throw: the password must still
     be shown. */
  shown.length = 0;
  NEXT = { "/owner/members": { member: { id: "m-new", display_name: "New Person" }, temporary_password: PW } };
  const realLoadA = ctx.fhLoadAccounts, realLoadP = ctx.fhLoadPeople;
  ctx.fhLoadAccounts = async () => { throw new Error("list reload failed"); };
  ctx.fhLoadPeople = async () => { throw new Error("list reload failed"); };
  getEl("fa-person").value = "p-adult";
  getEl("fa-name").value = "New Person";
  getEl("fa-email").value = "new.person@example.com";
  await ctx.fhCreateAccount();
  check("on creation the password is shown even when the list reload FAILS",
    shown.length === 1 && shown[0].password === PW, JSON.stringify(shown));

  ctx.fhLoadAccounts = realLoadA; ctx.fhLoadPeople = realLoadP;
  ctx.fhShowPasswordOnce = realShow; ctx.fhConfirm = realConfirm;
}

// ── signing out ─────────────────────────────────────────────────────────────
ctx.fhClearSession();
ctx.loadFamilyPeople();
check("signing out of the family account returns the sign-in panel",
  getEl("fr-gate").hidden === false && /data-fh-signin/.test(getEl("fr-gate").innerHTML), "");

console.log(`\n  ${fails === 0 ? "all render checks passed" : fails + " FAILED"}\n`);
process.exit(fails ? 1 : 0);
