// ── MOUNT CHECK — does it RENDER, not just parse ────────────────────────────
//   npm run mount-check
//
// WHY THIS EXISTS. On 2026-08-18 this shipped to a user's screen:
//
//     ) : (
//       {rowsMarkup}     <-- a JS expression context, so this is an OBJECT
//     )}                     LITERAL with a shorthand property
//
// `cond ? a : ({x})` is valid JavaScript. esbuild passed it, vite built it, the
// bundle deployed, and the page was dead for anyone with a till open. A parse
// check answers "is this JavaScript". Only a mount answers "does this render".
//
// That was the FIFTH time in one session a text-level edit shipped something no
// parser could see: a banner inserted twice, two of three call sites replaced, a
// guard reading a column absent from its select, a select list missing a field
// the UI read, and this. Every one built cleanly.
//
// ⚠️ EVERY STATE, NOT THE HAPPY ONE. The object-literal crash lived in exactly
// one branch — till open — and the other branch rendered fine, which is why one
// user saw a dead page and another saw a 403. A harness that only renders the
// common case would have passed it.
//
// ⚠️ FIXTURES ARE READ FROM THE SERVER'S RETURN STATEMENT, NEVER FROM MEMORY.
// The oversight fixtures below were wrong FOUR times running — cashiers vs
// per_cashier, drawer:null vs an always-present object, methods vs by_method,
// cashier_id vs user_id — every one because they were written from a
// recollection of code read hours earlier. A fixture that does not match reality
// tests nothing while looking like it does: the green-suite-with-a-hole in a new
// costume. Same rule as SQL bodies — go to the source of truth
// (backend/src/lib/cashierOversight.js) and copy the shape it actually returns.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(HERE, "../src");
// Must sit inside the project so `react` resolves from it.
const OUT  = resolve(HERE, "__mounted.mjs");

globalThis.__S = {};   // the scenario being rendered; mutated between renders

// Stubs keyed by the tail of the import path. Deliberately dumb — the point is
// to exercise OUR render logic, not react-query or axios.
const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = (o) => {
      const s = globalThis.__S, key = JSON.stringify(o.queryKey), hit = s.queries || {};
      for (const k of Object.keys(hit)) if (key.includes(k)) return { data: hit[k], isLoading: !!s.isLoading, isError: !!s.isError, refetch(){} };
      return { data: undefined, isLoading: !!s.isLoading, isError: !!s.isError, refetch(){} };
    };
    export const useMutation = () => ({ mutate(){}, isPending: false, variables: undefined });
    export const useQueryClient = () => ({ invalidateQueries(){} });
  `,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };`,
  "store": `
    export const useAuthStore = (sel) => sel({ user: { role: globalThis.__S.role || "cashier", id: "u1", name: "Ada" }, org: { name: "Shop" } });
    export const useLangStore = (sel) => sel({ lang: globalThis.__S.lang || "en" });
    export const useSettingsStore = (sel) => sel({ selectedLocation: { id: "loc-1", name: "Bepanda" } });
  `,
  "useCurrency": `const f = (n) => String(n ?? 0) + " FCFA"; f.symbol = "FCFA"; f.currency = "XAF"; export const useCurrency = () => f;`,
  "useNetworkStatus": `export const useNetworkStatus = () => ({ isOnline: globalThis.__S.isOnline !== false });`,
  "useTicketSummary": `
    export const ticketSummaryKey = (l) => ["ticket-summary", l];
    export const useTicketSummary = () => ({ summary: globalThis.__S.summary ?? { mode: "cashier" } });
    export const ticketNavVisible = () => globalThis.__S.allowed !== false;
  `,
  "useMyPermissions": `export const useMyPermissions = () => ({ perms: { can_receive_payment: true, can_release_goods: true, can_pay_expenses: true } });`,
  "ShiftWidgets": `
    export const useActiveShift = () => ({ hasShift: !!globalThis.__S.hasShift, locId: "loc-1" });
    export const noShiftHint = () => "Open your shift";
  `,
  "PaymentEventReceipt": `export default function PaymentEventReceipt(){ return null; }`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
};

// stdin entry + resolveDir: no temp file to leave behind in src/.
await build({
  stdin: {
    contents: `
      export { default as ExpensePayoutPage } from "./pages/ExpensePayoutPage";
      export { default as TicketListPage } from "./pages/TicketListPage";
      export { default as CashierOversightTab } from "./components/CashierOversightTab";
      export { default as ThresholdReviewPage } from "./pages/ThresholdReviewPage";
    `,
    resolveDir: SRC, loader: "jsx", sourcefile: "mount-entry.jsx",
  },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic",
  external: ["react", "react/jsx-runtime"], logLevel: "silent",
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        for (const k of Object.keys(STUBS)) if (a.path === k || a.path.endsWith("/" + k)) return { path: k, namespace: "stub" };
        return null;
      });
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
    },
  }],
});

const M = await import("file:///" + OUT.replace(/\\/g, "/"));

const ticket = (id, n, extra = {}) => ({
  id, sale_number: n, total_amount: 1500, paid_amount: 1500, version: 0,
  created_at: new Date().toISOString(), pa_customers: { name: "Awa" },
  pa_sale_ticket_items: [{ id: "l1", product_id: "p1", quantity: 2, unit_price: 750, pa_products: { name: "Rice" } }],
  pa_sale_items:        [{ id: "l1", product_id: "p1", quantity: 2, unit_price: 750, pa_products: { name: "Rice" } }],
  ...extra,
});
const expenseRow = (id, amt, d) => ({ id, amount: amt, description: d, version: 0,
  created_at: new Date().toISOString(), recorded_by_name: "Boss",
  pa_expenditure_categories: { name: "utilities" } });

const THREE_TICKETS = { data: [ticket("a", "VNT-1"), ticket("b", "VNT-2"), ticket("c", "VNT-3")] };
const CREDIT_TICKET = { data: [ticket("d", "VNT-4", { paid_amount: 0, total_amount: 12000 })] };
const THREE_PAYOUTS = { data: [expenseRow("e1", 5000, "electric"), expenseRow("e2", 2500, "water"), expenseRow("e3", 500, "food")] };

// Shape copied from backend/src/lib/cashierOversight.js — see the fixture rule above.
const OVERSIGHT = { data: {
  per_cashier: [{ user_id: "u1", name: "Ada", collected_total: 9000, ticket_count: 3,
                  by_method: { cash: 9000, mobile_money: 0, bank: 0, other: 0 }, self_served_count: 1, self_served_value: 500 }],
  per_cashier_totals: { collected_total: 9000, ticket_count: 3,
                        by_method: { cash: 9000, mobile_money: 0, bank: 0, other: 0 }, self_served_count: 1, self_served_value: 500 },
  per_salesperson: [{ user_id: "u2", name: "Boss", sent_count: 3, sent_total: 9000, uncollected_total: 1500, uncollected_count: 1 }],
  per_salesperson_totals: { sent_total: 9000, sent_count: 3, uncollected_total: 1500, uncollected_count: 1 },
  tickets: [
    { id: "a", sale_number: "VNT-1", status: "paid", amount: 1500, raised_by_name: "Boss", paid_by_name: "Ada", released_by_name: null, raised_at: new Date().toISOString(), paid_at: new Date().toISOString(), released_at: null, self_served: false, is_voided: false, version: 0 },
    { id: "b", sale_number: "VNT-2", status: "pending_payment", amount: 2000, raised_by_name: "Boss", paid_by_name: null, released_by_name: null, raised_at: new Date().toISOString(), self_served: false, is_voided: true, version: 0 },
    { id: "c", sale_number: "VNT-3", status: "cancelled", amount: 900, raised_by_name: "Boss", paid_by_name: null, raised_at: new Date().toISOString(), self_served: false, is_voided: false, version: 1, cancel_reason: "customer left", cancelled_by_name: "Boss", cancelled_at: new Date().toISOString() },
  ],
  ticket_count: 3, truncated: false,
  expenses: [
    { id: "e1", description: "electric", category: "utilities", amount: 5000, status: "paid", raised_by_name: "Boss", paid_by_name: "Ada", payment_method: "cash", raised_at: new Date().toISOString(), paid_at: new Date().toISOString(), self_paid: false },
    { id: "e2", description: "water", category: "utilities", amount: 2500, status: "pending_payout", raised_by_name: "Boss", paid_by_name: null, raised_at: new Date().toISOString(), self_paid: false },
    { id: "e3", description: "food", category: null, amount: 500, status: "cancelled", raised_by_name: "Ada", paid_by_name: null, raised_at: new Date().toISOString(), cancelled_at: new Date().toISOString(), cancel_reason: "duplicate", self_paid: false },
  ],
  expense_totals: { paid_count: 1, paid_total: 5000, pending_count: 1, pending_total: 2500,
                    cancelled_count: 1, cancelled_total: 500, self_paid_count: 0, self_paid_total: 0 },
  drawer: { available: true,
    shifts: [{ shift_id: "s1", cashier_name: "Ada", shift_date: "2026-08-18", opening_float: 1000,
               cash_sales_received: 9000, cash_refunds: 0, cash_expenses: 5000, expected_drawer: 5000,
               actual_cash: 5000, variance: 0, status: "closed", counted: true }],
    totals: { expected: 5000, actual: 5000, variance: 0, expected_open: 0, counted_shifts: 1, open_shifts: 0 } },
  notes: { anchor_en: "a", anchor_fr: "a", self_served_en: "b", self_served_fr: "b" },
} };

const OV_PROPS = { from: "2026-08-01", to: "2026-08-18", locationId: "loc-1", lang: "en" };

// MP-THRESHOLD-REVIEW fixture. COPIED VERBATIM from a real pa_threshold_review()
// call on staging, not written from memory — four oversight fixtures were wrong
// the last time I typed one out from recollection.
// ⚠️ The numerics are STRINGS: PostgREST returns numeric as text, so a component
// doing arithmetic on them has to coerce. A fixture using JS numbers would hide
// exactly that bug.
// ⚠️ "Scope Probe" is the row that matters most: a staff member with NO sales, so
// half_under and biggest are NULL. Without this case the screen would happily
// render "half of their sales are under null" and nobody would notice.
const TR_ROWS = [
  { user_id: "u-k", full_name: "Kusi", role: "cashier", is_active: true,
    threshold: "5000", confirmed_at: null, sales_90d: 9, half_under: "6000",
    biggest: "15000", would_gate: 5, pct_gated: "55.6" },
  { user_id: "u-a", full_name: "Ada", role: "cashier", is_active: true,
    threshold: "200000", confirmed_at: null, sales_90d: 4, half_under: "11000",
    biggest: "36000", would_gate: 0, pct_gated: "0.0" },
  { user_id: "u-s", full_name: "Scope Probe", role: "warehouse", is_active: false,
    threshold: "100", confirmed_at: null, sales_90d: 0, half_under: null,
    biggest: null, would_gate: 0, pct_gated: "0" },
];
const TR_MIXED = { success: true, data: TR_ROWS, needs_review: true };
const TR_EMPTY = { success: true, data: [], needs_review: false };

const CASES = [
  ["Payouts · 3 rows, NO till open", M.ExpensePayoutPage, {}, { queries: { "expense-payouts": THREE_PAYOUTS }, hasShift: false }],
  ["Payouts · 3 rows, till open",    M.ExpensePayoutPage, {}, { queries: { "expense-payouts": THREE_PAYOUTS }, hasShift: true }],
  ["Payouts · offline",              M.ExpensePayoutPage, {}, { queries: { "expense-payouts": THREE_PAYOUTS }, hasShift: true, isOnline: false }],
  ["Payouts · empty",                M.ExpensePayoutPage, {}, { queries: { "expense-payouts": { data: [] } }, hasShift: true }],
  ["Payouts · loading",              M.ExpensePayoutPage, {}, { isLoading: true, hasShift: true }],
  ["Payouts · fetch failed",         M.ExpensePayoutPage, {}, { isError: true, hasShift: true }],
  ["Payouts · not allowed",          M.ExpensePayoutPage, {}, { allowed: false }],
  ["Payouts · direct mode",          M.ExpensePayoutPage, {}, { allowed: false, summary: { mode: "direct" } }],

  ["Queue · 3 tickets",              M.TicketListPage, { variant: "queue" },  { queries: { tickets: THREE_TICKETS } }],
  ["Queue · FULL-CREDIT ticket",     M.TicketListPage, { variant: "queue" },  { queries: { tickets: CREDIT_TICKET } }],
  ["Queue · empty",                  M.TicketListPage, { variant: "queue" },  { queries: { tickets: { data: [] } } }],
  ["Queue · loading",                M.TicketListPage, { variant: "queue" },  { isLoading: true }],
  ["Queue · fetch failed",           M.TicketListPage, { variant: "queue" },  { isError: true }],
  ["Queue · offline",                M.TicketListPage, { variant: "queue" },  { queries: { tickets: THREE_TICKETS }, isOnline: false }],
  ["Queue · not allowed",            M.TicketListPage, { variant: "queue" },  { allowed: false }],
  ["Queue · direct mode",            M.TicketListPage, { variant: "queue" },  { allowed: false, summary: { mode: "direct" } }],
  ["Pickup · 3 tickets",             M.TicketListPage, { variant: "pickup" }, { queries: { tickets: THREE_TICKETS } }],
  ["Pickup · empty",                 M.TicketListPage, { variant: "pickup" }, { queries: { tickets: { data: [] } } }],
  ["Pickup · fetch failed",          M.TicketListPage, { variant: "pickup" }, { isError: true }],

  ["Oversight · full data",          M.CashierOversightTab, OV_PROPS,                { queries: { "cashier-oversight": OVERSIGHT }, role: "owner" }],
  ["Oversight · full data (FR)",     M.CashierOversightTab, { ...OV_PROPS, lang: "fr" }, { queries: { "cashier-oversight": OVERSIGHT }, role: "owner", lang: "fr" }],
  ["Oversight · loading",            M.CashierOversightTab, OV_PROPS,                { isLoading: true, role: "owner" }],
  ["Oversight · fetch failed",       M.CashierOversightTab, OV_PROPS,                { isError: true, role: "owner" }],

  ["Threshold · mixed + no-sales row", M.ThresholdReviewPage, {}, { queries: { "threshold-review": TR_MIXED }, role: "owner" }],
  ["Threshold · mixed (FR)",           M.ThresholdReviewPage, {}, { queries: { "threshold-review": TR_MIXED }, role: "owner", lang: "fr" }],
  ["Threshold · nothing set",          M.ThresholdReviewPage, {}, { queries: { "threshold-review": TR_EMPTY }, role: "owner" }],
  ["Threshold · loading",              M.ThresholdReviewPage, {}, { isLoading: true, role: "owner" }],
  ["Threshold · fetch failed",         M.ThresholdReviewPage, {}, { isError: true, role: "owner" }],
];

// A React warning is a failure here. "Each child in a list needs a key" is how a
// fixture/component mismatch announces itself, and it is the only warning this
// harness has ever produced — it meant the fixture was wrong, both times.
let warned = [];
const realWarn = console.error;
console.error = (...a) => { warned.push(String(a[0])); };

let bad = 0;
for (const [name, Comp, props, state] of CASES) {
  globalThis.__S = state;
  warned = [];
  if (typeof Comp !== "function") { bad++; realWarn(`  MISSING ${name}`); continue; }
  try {
    const html = renderToString(React.createElement(Comp, props));
    if (!html || html.length < 20) { bad++; realWarn(`  EMPTY  ${name} — ${html.length} chars`); continue; }
    if (warned.length) { bad++; realWarn(`  WARN   ${name}\n           ${warned[0].split("\n")[0]}`); continue; }
    // DUMP="<substring>" prints the rendered HTML for matching cases. A clean
    // render proves the component did not throw; it proves nothing about what it
    // SAYS. Reading the output is how you catch "half of their sales are under
    // null" — valid HTML, no warning, and wrong.
    if (process.env.DUMP && name.includes(process.env.DUMP)) {
      realWarn(`\n----- ${name} -----\n${html.replace(/></g, ">\n<")}\n-----\n`);
    }
    realWarn(`  ok     ${name}  (${html.length})`);
  } catch (e) {
    bad++;
    realWarn(`  CRASH  ${name}\n           ${String(e.message).split("\n")[0]}`);
  }
}
console.error = realWarn;
try { rmSync(OUT, { force: true }); } catch { /* best effort */ }
console.log(`\n  ${CASES.length - bad}/${CASES.length} rendered clean`);
process.exit(bad ? 1 : 0);
