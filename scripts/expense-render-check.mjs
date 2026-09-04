// MP-EXPENSE-TRACKER — does the Expense tracker screen actually RENDER?
//
// admin.html has no build step, so `node --check` proves nothing about scope
// and the page can ship parsing-but-broken. This evaluates the REAL inline
// script out of public/admin.html (the artefact, not a copy) and drives
// loadExpenses against stubbed API payloads, asserting on rendered HTML.
//
// The things it is here to catch, all of which look fine in review:
//   • the currency table silently converting (it must NEVER convert)
//   • the estimate tile printing a number while a rate is missing, which would
//     understate the total by a whole currency
//   • USD losing its cents to the shared whole-unit formatter
//   • a hostile description becoming live markup
//   • the screen breaking outright on an empty account
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

function makeEl(id = "") {
  return {
    id, _html: "", textContent: "", value: "", checked: false, dataset: {},
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    addEventListener() {}, removeEventListener() {},
    getAttribute() { return null; }, setAttribute() {},
    closest() { return null; }, focus() {}, querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; }, remove() {},
    getContext() { return {}; },
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
const localStorage = { getItem: () => "tok", setItem() {}, removeItem() {} };
const sandbox = {
  document, localStorage, console,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, location: { hash: "" }, prompt: () => null },
  location: { hash: "", href: "http://x/admin.html", origin: "http://x", hostname: "admin.test", protocol: "http:", pathname: "/admin.html", search: "" },
  navigator: { userAgent: "node", language: "en" },
  setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON,
  fetch: async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }),
  prompt: () => null, alert: () => {}, confirm: () => true,
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
// Capture the chart config the page actually builds, so the two income series
// can be asserted on rather than eyeballed in a browser.
let lastChart = null;
sandbox.Chart = class { constructor(_ctx, cfg) { lastChart = cfg; } destroy() { lastChart = null; } };
sandbox.window.Chart = sandbox.Chart;

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let script = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
{
  const t = script.trim();
  const open = t.indexOf("(function () {");
  const close = t.lastIndexOf("})();");
  if (open === 0 && close > 0) script = t.slice("(function () {".length, close);
}

console.log("\n── expense tracker render check ─────────────────────────────\n");
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

for (const fn of ["loadExpenses", "wireExpenses", "expToBase", "fmtExpCur", "expRenderCurrencyTable", "expRenderEstimate", "incRenderList"]) {
  check(`${fn} is defined`, typeof ctx[fn] === "function", typeof ctx[fn]);
}

// ── payload: USD tooling + local spend, income in XAF, no rate set yet ──────
const SUMMARY = {
  success: true,
  data: {
    generated: 0,
    expense_totals: { USD: 45.5, XAF: 15000, NGN: 22000 },
    breakdown: {
      own: { USD: 45.5, XAF: 15000, NGN: 0 },
      marketing: { USD: 0, XAF: 0, NGN: 20000 },
      commissions_owed: { USD: 0, XAF: 0, NGN: 2000 },
      commissions_paid: { USD: 0, XAF: 0, NGN: 0 },
    },
    marketing_per_marketer: [{ marketer_id: "m1", name: "Aisha Bello", totals: { NGN: 20000 } }],
    income_subscription_totals: { USD: 0, XAF: 480000, NGN: 0 },
    income_manual_totals: { USD: 0, XAF: 60000, NGN: 0 },
    income_manual_by_category: { support: { XAF: 60000 } },
    income_is_gross: true,
    gateway_fees: { available: false, totals: { USD: 0, XAF: 0, NGN: 0 },
                    captured_count: 0, uncaptured_count: 2, no_gateway_count: 3,
                    reason: "not captured yet" },
    fx: {},
    series: [{ month: "2026-08", expense: { USD: 20, XAF: 0, NGN: 0 },
               income_subscription: { USD: 0, XAF: 240000, NGN: 0 },
               income_manual: { USD: 0, XAF: 60000, NGN: 0 } }],
  },
};
const LIST = {
  success: true,
  data: [
    { id: "e1", description: "Claude", amount: 23.47, currency: "USD", expense_date: "2026-08-31",
      source: "recurring", template_id: "t1", period: "2026-08", template_amount: 20, amount_adjusted: true, notes: "overage" },
    { id: "e2", description: "Printing", amount: 15000, currency: "XAF", expense_date: "2026-08-04",
      source: "manual", template_id: null, period: null, template_amount: null, amount_adjusted: false, notes: null },
  ],
};
const INCOME = { success: true, data: [
  { id: "i1", description: "Support from Paul", amount: 60000, currency: "XAF",
    received_date: "2026-08-24", category: "support", notes: "EST LE SOLDEUR - not a subscription", is_active: true },
  { id: "i2", description: "Mis-entry", amount: 999, currency: "XAF",
    received_date: "2026-08-01", category: "other", notes: null, is_active: false },
] };
const TPLS = { success: true, data: [
  { id: "t1", name: "Claude", amount: 20, currency: "USD", anchor_day: 31, start_date: "2026-01-01", is_active: true },
  { id: "t2", name: "Old host", amount: 5, currency: "USD", anchor_day: 1, start_date: "2025-01-01", is_active: false },
] };

ctx.apiAdmin = async (method, path) => {
  if (path.startsWith("/admin/expenses/summary")) return SUMMARY;
  if (path.startsWith("/admin/expenses/templates")) return TPLS;
  if (path.startsWith("/admin/expenses/income")) return INCOME;
  if (path.startsWith("/admin/expenses")) return LIST;
  throw new Error("unexpected path " + path);
};
ctx.showToast = () => {};

await ctx.loadExpenses();

// ── 1. NO RATE SET — the authoritative table must be unaffected ─────────────
console.log("\n  with NO conversion rate set");
const curHtml = getEl("exp-currency-tbody").innerHTML;
check("the per-currency table still renders every currency",
  curHtml.includes("USD") && curHtml.includes("XAF") && curHtml.includes("NGN"));
check("USD keeps its CENTS (45.50, not 46)", curHtml.includes("$45.50"), curHtml.includes("$46") ? "ROUNDED" : "");
check("XAF renders unconverted at 15 000", /15\s|15 |15,/.test(curHtml) && /FCFA/.test(curHtml));
check("NGN renders unconverted with its own symbol", /₦/.test(curHtml));
check("the estimate tile REFUSES to invent a number without a rate",
  getEl("exp-tile-expense").textContent === "Set a rate", getEl("exp-tile-expense").textContent);
check("...and says so, pointing at the authoritative table",
  /No conversion rate set/.test(getEl("exp-estimate-note").innerHTML));
check("income is labelled GROSS on screen", /GROSS/.test(getEl("exp-fee-note").innerHTML));
// MP-FLW-FEE-CAPTURE: with nothing captured the line must say so and must NOT
// print a zero, which would claim the gateway took nothing.
{
  const fee = getEl("exp-fee-note").innerHTML;
  check("with no fee captured, the line says so rather than showing a total",
    /No gateway fee captured yet/.test(fee));
  check("...names the earlier payments as UNAVAILABLE, not zero",
    /unavailable<\/strong>, not zero/.test(fee) && /not estimated/.test(fee), fee.slice(0, 60));
  check("...and separates cash/momo, which carry no fee at all",
    /carry no gateway fee at all/.test(fee));
  const cur = getEl("exp-currency-tbody").innerHTML;
  check("the gateway-fee CELL is an em dash, never 0, while uncaptured",
    /<td class="num">—<\/td>/.test(cur), cur.includes(">0 FCFA<") ? "SHOWS ZERO" : "em dash");
}

// ── 2. RATES SET — one estimate, everything else unchanged ─────────────────
console.log("\n  with rates set");
SUMMARY.data.fx = {
  fx_usd_xaf: { value: 600, updated_at: "2026-08-01T00:00:00Z" },
  fx_usd_ngn: { value: 1500, updated_at: "2026-08-02T00:00:00Z" },
};
await ctx.loadExpenses();
// 15000 XAF + 45.5 USD*600 (=27300) + 22000 NGN /1500*600 (=8800) = 51100
const est = getEl("exp-tile-expense").textContent;
check("the estimate tile now shows one converted total", /51\s*100|51,100|51100|51 100/.test(est.replace(/\s/g, " ")), est);
check("the rate AND its date are shown on screen",
  /1 USD = 600 XAF/.test(getEl("exp-estimate-note").innerHTML) && /set /.test(getEl("exp-estimate-note").innerHTML));
check("it is labelled an ESTIMATE", /Estimate only/.test(getEl("exp-estimate-note").innerHTML));
check("the authoritative table is STILL unconverted",
  getEl("exp-currency-tbody").innerHTML.includes("$45.50"));

// ── 3. the list, the templates, the marketers ──────────────────────────────
console.log("\n  list, templates, marketing");
const listHtml = getEl("exp-tbody").innerHTML;
check("a recurring row renders", listHtml.includes("Claude") && listHtml.includes("Recurring"));
check("a manual row renders", listHtml.includes("Printing") && listHtml.includes("Manual"));
check("an edited generated row is FLAGGED as adjusted", /adjusted/.test(listHtml));
check("...and names the template amount it differs from", /template amount of 20/.test(listHtml));
const tplHtml = getEl("exp-tpl-tbody").innerHTML;
check("an active template offers Deactivate", tplHtml.includes("Deactivate"));
check("an inactive template offers Reactivate, not delete",
  tplHtml.includes("Reactivate") && !/>Delete</.test(tplHtml));
check("marketing spend renders per marketer, by name",
  getEl("exp-marketer-tbody").innerHTML.includes("Aisha Bello"));
check("...in its own currency, unconverted", /₦/.test(getEl("exp-marketer-tbody").innerHTML));

// ── 3a2. CAPTURED GATEWAY FEES RENDER AS REAL FIGURES ──────────────────
console.log("\n  gateway fee capture");
SUMMARY.data.gateway_fees = { available: true, totals: { USD: 0, XAF: 1500, NGN: 0 },
  captured_count: 1, uncaptured_count: 2, no_gateway_count: 3, reason: "captured" };
SUMMARY.data.breakdown.gateway_fees = { USD: 0, XAF: 1500, NGN: 0 };
await ctx.loadExpenses();
{
  const fee = getEl("exp-fee-note").innerHTML;
  check("a captured fee shows as a real amount", /Gateway fees captured/.test(fee) && /1\s?500/.test(fee.replace(/&nbsp;| | /g, " ")), fee.slice(0, 80));
  check("...alongside the count of payments it came from", /across 1 payment/.test(fee));
  check("...while STILL flagging the 2 uncaptured as unavailable, not zero",
    /2<\/strong> earlier Flutterwave payments/.test(fee) && /unavailable<\/strong>, not zero/.test(fee));
  check("the per-currency table shows the captured fee in its own column",
    /1\s?500/.test(getEl("exp-currency-tbody").innerHTML.replace(/&nbsp;| | /g, " ")));
}
// restore the uncaptured state for the assertions that follow
SUMMARY.data.gateway_fees = { available: false, totals: { USD: 0, XAF: 0, NGN: 0 },
  captured_count: 0, uncaptured_count: 2, no_gateway_count: 3, reason: "not captured yet" };
delete SUMMARY.data.breakdown.gateway_fees;
await ctx.loadExpenses();

// ── 3b. THE TWO INCOME STREAMS MUST NEVER MERGE ────────────────────────────
console.log("\n  income separation (the thing that matters most)");
const cur2 = getEl("exp-currency-tbody").innerHTML;
check("subscription income renders in its own cell (480 000)", /480/.test(cur2));
check("other income renders in its OWN separate cell (60 000)", /60\s?000|60,000/.test(cur2));
check("no cell shows the BLENDED 540 000", !/540\s?000|540,000/.test(cur2),
  /540/.test(cur2) ? "BLENDED — support counted as revenue" : "kept apart");
check("the subscription tile shows ONLY subscription income",
  /480/.test(getEl("exp-tile-income").textContent), getEl("exp-tile-income").textContent);
check("a SEPARATE tile carries other income", /60/.test(getEl("exp-tile-other").textContent),
  getEl("exp-tile-other").textContent);
check("the subscription tile is NOT the blended figure",
  !/540/.test(getEl("exp-tile-income").textContent), getEl("exp-tile-income").textContent);
// Net is the one place both are intentionally combined, and it is labelled so.
check("net combines both (480k+60k-51.1k) and is the ONLY place they meet",
  /488|489/.test(getEl("exp-tile-net").textContent.replace(/[\s,]/g, "")),
  getEl("exp-tile-net").textContent);

const incHtml = getEl("inc-tbody").innerHTML;
check("the support entry is listed with its category badge",
  incHtml.includes("Support from Paul") && incHtml.includes("support"));
check("a voided income row still shows, marked, not deleted",
  incHtml.includes("Mis-entry") && incHtml.includes("voided") && incHtml.includes("Restore"));

// ── 3c. THE CHART MUST SHOW THEM DISTINGUISHABLY ───────────────────
console.log("\n  chart");
check("a chart was built", !!lastChart, lastChart ? "yes" : "none");
const ds = (lastChart && lastChart.data && lastChart.data.datasets) || [];
check("THREE datasets: expenses + TWO income series", ds.length === 3, String(ds.length));
const dSub = ds.filter(function (d) { return /Subscription income/.test(d.label); })[0];
const dOth = ds.filter(function (d) { return /Other income/.test(d.label); })[0];
const dExp = ds.filter(function (d) { return /Expenses/.test(d.label); })[0];
check("subscription income is its own series", !!dSub, dSub && dSub.label);
check("other income is a SEPARATE series", !!dOth, dOth && dOth.label);
check("its legend label names it support/donation, not just income",
  !!dOth && /support|donation/i.test(dOth.label), dOth && dOth.label);
check("the two income series are VISUALLY distinct (different fill)",
  !!dSub && !!dOth && dSub.backgroundColor !== dOth.backgroundColor,
  (dSub && dSub.backgroundColor) + " vs " + (dOth && dOth.backgroundColor));
check("other income is further marked with a dashed border",
  !!dOth && Array.isArray(dOth.borderDash) && dOth.borderDash.length > 0);
check("income stacks together but SEPARATELY from expenses",
  !!dSub && !!dOth && !!dExp && dSub.stack === dOth.stack && dExp.stack !== dSub.stack,
  dExp && (dExp.stack + " / " + dSub.stack));
check("the axes are configured stacked so the two segments sit on one bar",
  !!lastChart && lastChart.options && lastChart.options.scales &&
  lastChart.options.scales.y && lastChart.options.scales.y.stacked === true);
check("support money is NOT folded into the subscription series",
  !!dSub && Number(dSub.data[0]) === 240000 * 0 + 240000, dSub && String(dSub.data[0]));

// ── 4. hostile input must not become markup ────────────────────────────────
console.log("\n  safety");
LIST.data[1].description = '<img src=x onerror="alert(1)">';
await ctx.loadExpenses();
const xss = getEl("exp-tbody").innerHTML;
check("a hostile description is escaped, not injected",
  !xss.includes("<img src=x") && xss.includes("&lt;img"), xss.includes("<img src=x") ? "INJECTED" : "escaped");
LIST.data[1].description = "Printing";

// ── 5. an empty account must not break the screen ──────────────────────────
SUMMARY.data = {
  generated: 0, expense_totals: { USD: 0, XAF: 0, NGN: 0 },
  breakdown: { own: {}, marketing: {}, commissions_owed: {}, commissions_paid: {} },
  marketing_per_marketer: [],
  income_subscription_totals: { USD: 0, XAF: 0, NGN: 0 },
  income_manual_totals: { USD: 0, XAF: 0, NGN: 0 },
  income_manual_by_category: {},
  income_is_gross: true, gateway_fees: { available: false }, fx: {}, series: [],
};
LIST.data = []; TPLS.data = []; INCOME.data = [];
await ctx.loadExpenses();
check("an empty account renders empty states, not a crash",
  /Nothing recorded yet/.test(getEl("exp-currency-tbody").innerHTML) &&
  /No expenses/.test(getEl("exp-tbody").innerHTML) &&
  /No recurring costs/.test(getEl("exp-tpl-tbody").innerHTML) &&
  /No non-subscription income/.test(getEl("inc-tbody").innerHTML));

console.log(`\n  ${fails === 0 ? "ALL expense render checks passed" : fails + " FAILED"}\n`);
process.exit(fails === 0 ? 0 : 1);
