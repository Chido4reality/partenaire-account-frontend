// PHASE 1 — marketing screen render check.
//
// admin.html is a static page with no build step and no test harness, so the
// only honest way to prove the new screens WORK (rather than merely parse) is
// to evaluate the REAL inline script out of public/admin.html against a minimal
// DOM shim and drive the two loaders with stubbed API responses.
//
// This is deliberately the artefact, not a copy: the script text is read from
// public/admin.html at run time. If someone edits the page and breaks
// loadMyMarketing, this fails — a copy-pasted fixture would not.
//
// It catches what `node --check` cannot: TDZ, typo'd identifiers, wrong field
// names against the API shape, and the divide-by-zero rendering of
// cost-per-paying-customer.
//
// No new dependency: the shim is ~80 lines of hand-rolled DOM.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");

let fails = 0;
function check(label, ok, detail = "") {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
}

// ── minimal DOM shim ────────────────────────────────────────────────────────
function makeEl(id = "") {
  const el = {
    id, _html: "", textContent: "", value: "", checked: false, dataset: {},
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    closest() { return null; }, focus() {}, querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; }, remove() {},
  };
  return el;
}
const els = new Map();
const getEl = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};
// Stat cards: four/five per strip, matching the markup.
function statCards(n) { return Array.from({ length: n }, () => makeEl()); }
const strips = { "mm-strip": statCards(4), "mk-strip": statCards(5) };

const document = {
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: (sel) => {
    const m = /^#([a-z-]+) \.stat-card \.stat-value$/.exec(sel);
    if (m && strips[m[1]]) return strips[m[1]];
    return [];
  },
  addEventListener() {}, createElement: () => makeEl(),
  body: makeEl("body"), documentElement: makeEl("html"),
};
const localStorage = { getItem: () => "tok", setItem() {}, removeItem() {} };
const sandbox = {
  document, localStorage, console,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, location: { hash: "" } },
  location: { hash: "", href: "http://x/admin.html", origin: "http://x", hostname: "admin.test", protocol: "http:", pathname: "/admin.html", search: "" },
  navigator: { userAgent: "node", language: "en" },
  setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON,
  fetch: async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }),
  prompt: () => null, alert: () => {}, confirm: () => true,
  // Enough of the browser globals the page touches at load. Each is a no-op:
  // this rig exercises the marketing loaders, not the widgets that use them.
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  URL, URLSearchParams, Blob: class {}, FormData: class {},
  AbortController: globalThis.AbortController, Promise, Error, RegExp,
  encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat, Number, String, Boolean, Array, Object,
};
sandbox.globalThis = sandbox;
sandbox.window.localStorage = localStorage;

// ── evaluate the real inline script ─────────────────────────────────────────
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let script = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
// admin.html wraps everything in `(function () { 'use strict'; ... })();`, so
// its functions are private to that closure and unreachable from the rig.
// Unwrap the outer IIFE so top-level declarations land on the vm context. This
// is still the SHIPPED text — only the closure boundary is removed, nothing is
// rewritten — so a real break inside loadMyMarketing still fails this check.
{
  const t = script.trim();
  const open = t.indexOf("(function () {");
  const close = t.lastIndexOf("})();");
  if (open === 0 && close > 0) script = t.slice("(function () {".length, close);
}
console.log("\n── marketing render check ───────────────────────────────────\n");
check("found the admin inline script", script.length > 100000, `${script.length} chars`);

const ctx = vm.createContext(sandbox);
try {
  new vm.Script(script, { filename: "admin.html:inline" }).runInContext(ctx);
  check("the real inline script EVALUATES (not just parses)", true);
} catch (err) {
  check("the real inline script EVALUATES (not just parses)", false, err.message);

  console.log(`\n  ${fails} FAILED of marketing render checks\n`);
  process.exit(1);
}

for (const fn of ["loadMyMarketing", "loadMarketers", "wireMarketing", "fmtCostMap", "fmtMoneyMap", "fmtCur", "convRate", "mmStat"]) {
  check(`${fn} is defined`, typeof ctx[fn] === "function", typeof ctx[fn]);
}

// ── drive the marketer screen with a realistic payload ──────────────────────
const ME = {
  success: true,
  data: {
    marketer: { id: "m1", full_name: "Aisha Bello", email: "a@x.test", is_active: true },
    own_codes: [{ id: "c1", code: "AISHA10", is_active: true }],
    own: { signups: 12, paying_customers: 4, revenue_by_currency: { XAF: 240000 }, still_in_trial: 5, lapsed: 3 },
    team: [
      { id: "t1", name: "John Doe", phone: "677000111", status: "active",
        codes: [{ id: "c2", code: "JOHN10", is_active: true }],
        stats: { signups: 8, paying_customers: 2, revenue_by_currency: { XAF: 90000, NGN: 15000 }, still_in_trial: 4, lapsed: 2 },
        expenditure_by_currency: { XAF: 30000, NGN: 9000 },
        cost_by_currency: { XAF: {spend:30000,conversions:2,cost:15000}, NGN: {spend:9000,conversions:0,cost:null} } },
      // the divide-by-zero case: spend, no conversions
      { id: "t2", name: "Grace N", phone: null, status: "active", codes: [],
        stats: { signups: 3, paying_customers: 0, revenue_by_currency: {}, still_in_trial: 3, lapsed: 0 },
        expenditure_by_currency: { XAF: 12000 },
        cost_by_currency: { XAF: {spend:12000,conversions:0,cost:null} } },
    ],
    team_total: { signups: 23, paying_customers: 6, revenue_by_currency: { XAF: 330000, NGN: 15000 }, still_in_trial: 12, lapsed: 5 },
    expenditure_by_currency: { XAF: 42000, NGN: 9000 },
    cost_by_currency: { XAF: {spend:42000,conversions:6,cost:7000}, NGN: {spend:9000,conversions:0,cost:null} },
  },
};
const SPEND = {
  success: true, total_by_currency: { XAF: 42000 },
  data: [
    { id: "e1", category: "transport", amount: 30000, currency: 'XAF', spent_on: "2026-08-10", note: "bus", team_member_id: "t1" },
    { id: "e2", category: "flyers", amount: 12000, currency: 'NGN', spent_on: "2026-08-12", note: null, team_member_id: null },
  ],
};
ctx.apiAdmin = async (method, path) => {
  if (path.startsWith("/admin/marketing/me")) return ME;
  if (path.startsWith("/admin/marketing/expenditures")) return SPEND;
  throw new Error("unexpected path " + path);
};
ctx.showToast = () => {};

await ctx.loadMyMarketing();
const teamHtml = getEl("mm-team").innerHTML;
const spendHtml = getEl("mm-spend").innerHTML;
const codesHtml = getEl("mm-codes").innerHTML;

check("own code renders", codesHtml.includes("AISHA10"), codesHtml.slice(0, 40));
check("team member names render", teamHtml.includes("John Doe") && teamHtml.includes("Grace N"));
check("a member's code renders", teamHtml.includes("JOHN10"));
check("a member with NO code gets a Create-code button", teamHtml.includes("data-mm-newcode=\"t2\""));
check("cost-per-customer of null renders as an em dash, NOT 0 or Infinity",
  teamHtml.includes("—") && !teamHtml.includes("Infinity") && !teamHtml.includes("NaN"));
check("stat strip took the TEAM TOTAL signups (23), not just own (12)",
  strips["mm-strip"][0].textContent === "23", strips["mm-strip"][0].textContent);
check("stat strip revenue shows BOTH currencies, never blended, and NO literal <br>",
  !/<br>/.test(strips["mm-strip"][3].textContent) && /FCFA/.test(strips["mm-strip"][3].textContent) && /₦/.test(strips["mm-strip"][3].textContent) && !/345000|330015/.test(strips["mm-strip"][3].textContent),
  strips["mm-strip"][3].textContent);
check("spend rows render with the member NAME, not a raw uuid",
  spendHtml.includes("John Doe") && !spendHtml.includes("t1\""), "");
check("an unattributed expense reads 'Whole team'", spendHtml.includes("Whole team"));
check("spend total renders", spendHtml.includes("42") && /FCFA/.test(spendHtml));

// XSS: a hostile team-member name must not become live markup.
ME.data.team[0].name = '<img src=x onerror="alert(1)">';
await ctx.loadMyMarketing();
const xss = getEl("mm-team").innerHTML;
check("a hostile member name is escaped, not injected",
  !xss.includes("<img src=x") && xss.includes("&lt;img"), xss.includes("<img src=x") ? "INJECTED" : "escaped");
ME.data.team[0].name = "John Doe";

// ── drive the oversight tab ─────────────────────────────────────────────────
const OVERSIGHT = {
  success: true,
  data: [
    ME.data,
    { marketer: { id: "m2", full_name: "Bruno K", email: "b@x.test", is_active: false },
      own_codes: [], own: {}, team: [],
      team_total: { signups: 4, paying_customers: 1, revenue_by_currency: { NGN: 50000 }, still_in_trial: 2, lapsed: 1 },
      expenditure_by_currency: { XAF: 90000 },
      cost_by_currency: { XAF: {spend:90000,conversions:1,cost:90000} } },
  ],
  totals: { marketers: 2, signups: 27, paying_customers: 7, revenue_by_currency: { XAF: 330000, NGN: 65000 },
            expenditure_by_currency: { XAF: 132000, NGN: 9000 },
            cost_by_currency: { XAF: {spend:132000,conversions:7,cost:18857.14}, NGN: {spend:9000,conversions:0,cost:null} } },
};
ctx.apiAdmin = async (m, p) => {
  if (p.startsWith("/admin/marketing/oversight")) return OVERSIGHT;
  throw new Error("unexpected path " + p);
};
await ctx.loadMarketers();
const mk = getEl("mk-table").innerHTML;
check("oversight lists both marketers", mk.includes("Aisha Bello") && mk.includes("Bruno K"));
check("a deactivated marketer is badged, not hidden", mk.includes("deactivated"));
check("team members drill down as their own indented rows",
  mk.includes("mk-member") && mk.includes("John Doe"));
check("conversion rate is a percentage", /\d+(\.\d+)?%/.test(mk), (mk.match(/\d+(\.\d+)?%/) || [])[0]);
check("the cheaper marketer is flagged good, the dearer one warn",
  mk.includes("mm-cpc-good") && mk.includes("mm-cpc-warn"));
check("oversight strip shows cost per paying customer", /FCFA/.test(strips["mk-strip"][4].textContent),
  strips["mk-strip"][4].textContent);

// A LONE marketer has nothing to compare against, so must get no colour at
// all. This is the other half of the median fix and would otherwise go
// unproven: the even-count case above passes either way if colouring is
// applied unconditionally.
ctx.apiAdmin = async () => ({
  success: true,
  data: [OVERSIGHT.data[1]],
  totals: { marketers: 1, signups: 4, paying_customers: 1, revenue_attributed: 50000,
            expenditure_by_currency: { XAF: 90000 },
      cost_by_currency: { XAF: {spend:90000,conversions:1,cost:90000} } },
});
await ctx.loadMarketers();
const solo = getEl("mk-table").innerHTML;
check("a single marketer is neither flagged good nor warn (nothing to compare)",
  !solo.includes("mm-cpc-good") && !solo.includes("mm-cpc-warn"),
  solo.includes("mm-cpc-good") ? "flagged good" : solo.includes("mm-cpc-warn") ? "flagged warn" : "neutral");
check("…but their cost per customer still shows", /90\s?000/.test(solo.replace(/ /g, " ")));

// empty state must not crash or divide by zero
ctx.apiAdmin = async () => ({ success: true, data: [], totals: { marketers: 0, signups: 0, paying_customers: 0, revenue_attributed: 0, expenditure_total: 0, cost_per_paying_customer: null } });
await ctx.loadMarketers();
check("empty oversight renders an empty state, not a crash",
  getEl("mk-table").innerHTML.includes("No marketers yet"));
check("…and cost-per-customer with zero everything is '—'", strips["mk-strip"][4].textContent === "—",
  strips["mk-strip"][4].textContent);


// ── the Add-admin role dropdown (Peter's bug) ───────────────────────────────
// The role existed and was gated server-side, but the modal offered only Admin
// and Staff, so a marketer could not be CREATED through the UI at all.
// Asserted against the RAW page source: these <option>s live inside a template
// literal that only executes when the modal is opened.
const addAt = html.indexOf('id="at-role"');
const addModal = html.slice(addAt, addAt + 600);
check("Add-admin dropdown offers Marketer", /<option value="marketer"/.test(addModal),
  (addModal.match(/<option value="[a-z_]+"/g) || []).join(" "));

const editAt = html.indexOf('id="at-role-edit"');
const editSel = html.slice(editAt, editAt + 700);
check("Change-role dropdown offers Marketer", /<option value="marketer"/.test(editSel),
  (editSel.match(/<option value="[a-z_]+"/g) || []).join(" "));
// Without this option a marketer's row rendered as the FIRST option (Admin),
// so one click of "Save role" silently PROMOTED them to full admin.
check("…and it is pre-selected when the admin IS a marketer",
  editSel.includes("=== 'marketer'") || editSel.includes('=== "marketer"'));
check("rolePill has a marketer style (not a bare fallback)", /marketer: 'pill-/.test(html));

// ── a marketer must LAND on their own screen and see nothing else ───────────
const navLinks = ["dashboard", "businesses", "my-marketing", "marketers", "settings", "admin-team"]
  .map((r) => {
    const e = makeEl();
    e._route = r;
    e.getAttribute = (k) => (k === "data-route" ? r : null);
    return e;
  });
document.querySelectorAll = (sel) => {
  const m = /^#([a-z-]+) \.stat-card \.stat-value$/.exec(sel);
  if (m && strips[m[1]]) return strips[m[1]];
  if (sel === ".sb-link") return navLinks;
  return [];
};
// showApp() hides the marketer-only / oversight links BY ID, while the marketer
// branch sweeps .sb-link. Point both at the same objects or the rig tests a
// different element than the code touches.
els.set("sb-link-mymarketing", navLinks.find((l) => l._route === "my-marketing"));
els.set("sb-link-marketers",   navLinks.find((l) => l._route === "marketers"));
let landedOn = null;
ctx.navigateTo = (route) => { landedOn = route; };
ctx.startNotifPolling = () => {};
ctx.enforceForcedPasswordChange = () => {};

ctx.showApp({ id: "m1", full_name: "Rig Marketer", email: "m@rig.test", role: "marketer" });
check("a marketer LANDS on my-marketing, not dashboard", landedOn === "my-marketing", String(landedOn));
const shown = navLinks.filter((l) => l.style.display !== "none").map((l) => l._route).sort();
check("…and sees ONLY my-marketing in the nav — not even Settings",
  JSON.stringify(shown) === JSON.stringify(["my-marketing"]), shown.join(",") || "(none)");
check("…and the sidebar labels them Marketer",
  getEl("sb-admin-role").textContent === "Marketer", getEl("sb-admin-role").textContent);

// A master_admin must be unaffected by any of this.
navLinks.forEach((l) => { l.style.display = ""; });
landedOn = null;
ctx.showApp({ id: "a1", full_name: "Peter", email: "p@rig.test", role: "master_admin" });
check("master_admin still sees the Marketers oversight link",
  navLinks.find((l) => l._route === "marketers").style.display !== "none");
check("…and does NOT see the marketer-only My marketing link",
  navLinks.find((l) => l._route === "my-marketing").style.display === "none");



// ── per-currency cost rendering ─────────────────────────────────────────────
// The member table must show each currency's cost separately, and the
// "not yet computable" case (spend in a currency with no conversions in it)
// must read as an em dash beside its currency — never 0, never Infinity, and
// never a number produced by dividing across currencies.
const ws = function (x) { return String(x).replace(/[   ]/g, " "); };
check("member spend renders BOTH currencies",
  /30 000 FCFA/.test(ws(teamHtml)) && /₦9,000/.test(ws(teamHtml)),
  teamHtml.includes("39000") ? "BLENDED 39000" : "separate");
check("…a currency with spend but no conversions renders '— NGN', not 0",
  /— NGN/.test(teamHtml) && !/₦0\b/.test(teamHtml));
check("…and no blended spend total appears (30000+9000)", !ws(teamHtml).includes("39 000"));
check("an expenditure row is labelled in ITS OWN currency",
  /₦12,000/.test(ws(spendHtml)) && /30 000 FCFA/.test(ws(spendHtml)),
  ws(spendHtml).includes("42 000") ? "BLENDED" : "per-row");

// Oversight: colouring compares within a currency, never across.
check("oversight cost cell shows per-currency lines",
  /FCFA/.test(mk) && /—\s*NGN/.test(mk), "");
check("…good/warn colouring still applied within a currency",
  mk.includes("mm-cpc-good") || mk.includes("mm-cpc-warn"));
check("…and a Lagos figure is never compared against a Douala one",
  !/mm-cpc-(good|warn)[^<]*>—/.test(mk));


// ── admin-side spend button (master_admin only) ─────────────────────────────
// The API refuses anyone but master_admin, so the button must not be offered
// to an ordinary admin - a visible control that always 403s is worse than none.
ctx.apiAdmin = async () => OVERSIGHT;
ctx.showApp({ id: "a1", full_name: "Peter", email: "p@x", role: "master_admin" });
await ctx.loadMarketers();
const mkMaster = getEl("mk-table").innerHTML;
check("master_admin sees a Log spend button per marketer",
  (mkMaster.match(/data-mk-spend=/g) || []).length === OVERSIGHT.data.length,
  (mkMaster.match(/data-mk-spend=/g) || []).length + " buttons");
ctx.showApp({ id: "a2", full_name: "Staffer", email: "s@x", role: "admin" });
await ctx.loadMarketers();
const mkAdmin = getEl("mk-table").innerHTML;
check("an ordinary admin IS offered the button (they may log spend)", /data-mk-spend=/.test(mkAdmin));
check("…and the column count matches master_admin's",
  (mkAdmin.match(/<th/g) || []).length === (mkMaster.match(/<th/g) || []).length,
  (mkAdmin.match(/<th/g) || []).length + " vs " + (mkMaster.match(/<th/g) || []).length);
const SPEND_ROW = [{ id: "e9", spent_on: "2026-08-01", category: "food", amount: 100, currency: "XAF", team_member_id: null }];
check("…but an admin gets NO delete control on a spend record",
  !/data-mk-delspend/.test(ctx.mkSpendRows(SPEND_ROW, "X")),
  /data-mk-delspend/.test(ctx.mkSpendRows(SPEND_ROW, "X")) ? "delete offered" : "withheld");
ctx.showApp({ id: "a1", full_name: "Peter", email: "p@x", role: "master_admin" });
await ctx.loadMarketers();
check("…while master_admin does get it",
  /data-mk-delspend/.test(ctx.mkSpendRows(SPEND_ROW, "X")));
check("openMarketerSpend is defined", typeof ctx.openMarketerSpend === "function", typeof ctx.openMarketerSpend);

console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} marketing render checks\n`);
process.exit(fails === 0 ? 0 : 1);
