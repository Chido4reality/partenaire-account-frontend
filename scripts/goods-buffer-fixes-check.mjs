// GOODS-BUFFER STAGING FIXES (Peter's test, 2026-10-16) — the SCREEN half.
//   1. every approve / reject / reveal box takes the LOGIN password: letters kept, no numeric
//      keypad, labelled "Your password"; Approve is live for "Boss2026"
//   3. the buffer's name follows the APP language (stored "Zone tampon" reads "Goods Buffer" in
//      English), its icon letter too, and no location dropdown prints a raw name
//   4. a transfer's "Started" time is created_at in shop time — never the date-only
//      transfer_date read as UTC midnight ("01:00")
// (2, To Buy, is server-side: backend goods-buffer-fixes-check + goods-buffer-fixes-probe.)
//   5. change my password: the card (every role: Settings → Account + /my-account), same rules
//   6. To Buy: a Buy-0 line starts unticked and is never counted or sent
//   7. hide the cash amount on EVERY device (was phones only) until the password; text/CSV too
// Each block re-derives the OLD behaviour and shows it was the bug, so a revert fails.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__goods_buffer_fixes.mjs");

const STUBS = {
  "@tanstack/react-query": `export const useQuery = ({ queryKey }) => ({ data: queryKey && queryKey[0] === "settings" ? globalThis.__SETTINGS : null, isLoading: false, isError: false });`,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };`,
  "store": `const pick = (get) => (sel) => (typeof sel === "function" ? sel(get()) : get());
    export const useLangStore = pick(() => ({ lang: globalThis.__LANG || "en" }));
    export const useAuthStore = pick(() => ({ user: { role: "owner", id: "u1" }, org: { currency: "XAF" } }));
    useAuthStore.getState = () => ({ user: { role: "owner", id: "u1" }, org: { currency: "XAF" } });
    export const useSettingsStore = pick(() => ({}));`,
};

await build({
  stdin: {
    contents: `
      export { default as HoldRejectFields, holdRejectReady } from "./components/common/HoldRejectFields";
      export { default as ApproverPasswordInput, approverPasswordReady } from "./components/common/ApproverPasswordInput";
      export { approveBlockedReason } from "./components/common/HoldShortfallFields";
      export { default as RevealPinModal } from "./components/common/RevealPinModal";
      export { locationLabel, locationNameLabel, locationInitial } from "./utils/locations";
      export { fmtShopDateTime, fmtShopDate } from "./utils/shopTime";
      export { default as ChangePasswordCard, newPasswordProblem } from "./components/common/ChangePasswordCard";
      export { restockLineDefault, restockSendItems } from "./utils/restockLines";
      export { buildLedgerTextV2 } from "./utils/reportText";
      export { DrawerRevealButton } from "./components/common/DrawerMask";
      import { createElement } from "react";
      import { useDrawerReveal } from "./utils/useDrawerReveal";
      import { useDrawerMask } from "./components/common/DrawerMask";
      export function GateProbe({ enabled }) { const g = useDrawerReveal({ enabled }); return createElement("i", null, g.gateOn + "|" + g.revealed); }
      export function MaskProbe() { const m = useDrawerMask(); return createElement("i", null, m.masked + "|" + m.maskMoney((n) => "X" + n)(5)); }`,
    resolveDir: SRC, loader: "jsx", sourcefile: "gb-fixes-entry.jsx",
  },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic",
  external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
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

let M;
try { M = await import("file:///" + OUT.replace(/\\/g, "/")); }
finally { try { rmSync(OUT); } catch { /* already gone */ } }

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`); };
const render = (Comp, props) => renderToString(React.createElement(Comp, props)).replace(/&#x27;/g, "'");
const read = (p) => readFileSync(resolve(SRC, p), "utf8");

// ── 1 approval password ─────────────────────────────────────────────────────
console.log("\n-- 1 the approval box takes the login password --\n");
{
  const OLD_STRIP = (v) => v.replace(/\D/g, "");              // what every box did on change
  check("OLD: typing 'Boss2026' left '2026' in the box (the bug)", OLD_STRIP("Boss2026") === "2026");
  const h = render(M.HoldRejectFields, { en: true, mode: "return_to_source", setMode() {}, pin: "", setPin() {}, sourceName: "Zone tampon" });
  check("reject 'send everything back': labelled 'Your password'", h.includes("Your password"));
  check("…no numeric keypad on it", !/inputmode="numeric"/i.test(h), h.match(/<input[^>]*type="password"[^>]*>/)?.[0]);
  const hf = render(M.HoldRejectFields, { en: false, mode: "return_to_source", setMode() {}, pin: "", setPin() {}, sourceName: "Zone tampon" });
  check("…'Votre mot de passe' in French", hf.includes("Votre mot de passe"));
  let typed = null;
  const el = M.ApproverPasswordInput({ value: "", onChange: (v) => { typed = v; } });
  el.props.onChange({ target: { value: "Boss2026" } });
  check("typing 'Boss2026' keeps every letter", typed === "Boss2026", typed);
  check("reject is ready with 'Boss2026'", M.holdRejectReady("return_to_source", "Boss2026") === true);
  check("OLD Approve gate refused 'Boss2026'; now Approve is live", !/^\d{4,6}$/.test("Boss2026")
    && M.approveBlockedReason({ en: true, pin: "Boss2026", hold: null }) === null);
  check("…and an empty box still says why", M.approveBlockedReason({ en: true, pin: "", hold: null }) === "Enter your password.");
  globalThis.__LANG = "en";
  const rv = render(M.RevealPinModal, { open: true, onClose() {}, onRevealed() {} });
  check("drawer reveal box: 'Your password', no numeric keypad", rv.includes("Your password") && !/inputmode="numeric"/i.test(rv));
  for (const f of ["components/common/HoldRejectFields.jsx", "components/common/RevealPinModal.jsx", "components/common/OwnerApprovalModal.jsx",
                   "pages/TeamApprovalsPage.jsx", "pages/AccountantLogPage.jsx"]) {
    const s = read(f);
    check(`${f}: no approval box strips letters or forces the numeric keypad`, !/replace\(\/\\D\/g/.test(s) && !/inputMode="numeric"/.test(s));
  }
  const st = read("pages/SettingsPage.jsx");
  check("Settings: the 'Owner PIN' card that overwrote the login password is gone", !st.includes("/settings/set-pin") && !st.includes("Save PIN"));
}

// ── 3 names ─────────────────────────────────────────────────────────────────
console.log("\n-- 3 the buffer's name follows the app language --\n");
{
  const buf = { id: "b", kind: "goods_buffer", name: "Zone tampon", type: "warehouse" };
  check("OLD: the Dashboard dropdown printed l.name → 'Zone tampon' in English, icon 'Z'", buf.name === "Zone tampon" && buf.name.charAt(0) === "Z");
  check("English: 'Goods Buffer', icon 'G'", M.locationLabel(buf, "en") === "Goods Buffer" && M.locationInitial(buf, "en") === "G");
  check("French: 'Zone tampon', icon 'Z'", M.locationLabel(buf, "fr") === "Zone tampon" && M.locationInitial(buf, "fr") === "Z");
  check("an English org's 'Goods Buffer' reads 'Zone tampon' in French", M.locationLabel({ kind: "goods_buffer", name: "Goods Buffer" }, "fr") === "Zone tampon");
  check("a frozen name with no row (payload, ledger) is labelled too", M.locationNameLabel("Zone tampon", "en") === "Goods Buffer" && M.locationNameLabel("Bonaberri", "en") === "Bonaberri");
  // No dropdown, icon letter or approval/transfer header may print a raw location name.
  const files = [];
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx|js)$/.test(n)) files.push(p); } })(SRC);
  const raw = [];
  for (const p of files) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/<option[^>]*>\{(l|loc|location)\.name/.test(line) || /\bloc\.name\.charAt\(0\)/.test(line)) raw.push(`${relative(SRC, p)}:${i + 1}`);
    });
  }
  check("no location <option> or icon letter prints a raw name", raw.length === 0, raw.slice(0, 5).join(", "));
  const raws = [
    ["components/TransferDetailModal.jsx", /\{t\.from_name \|\||\{t\.to_name \|\|/],
    ["components/common/HeldReceiptsBanner.jsx", /· \{i\.to_name\}/],
    ["components/BufferDetailModal.jsx", /value=\{b\.location_name\}/],
    ["pages/ReportsPage.jsx", /— \{ledger\.location\.name\}/],
    ["pages/AccountantLogPage.jsx", /metaRef\(a\), a\.branch_name\]|\$\{r\.branch_name\}/],
  ];
  for (const [f, re] of raws) check(`${f}: the location name goes through the label`, !re.test(read(f)));
}

// ── 4 transfer times ────────────────────────────────────────────────────────
console.log("\n-- 4 'Started' is the real time, in shop time --\n");
{
  const OLD = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  // TRF-20261016-0002: transfer_date 2026-10-16, created ~07:14 UTC.
  check("OLD: transfer_date '2026-10-16' rendered as 01:00 (the bug)", OLD("2026-10-16").includes("01:00"), OLD("2026-10-16"));
  check("created_at 07:14 UTC → 08:14 shop time", M.fmtShopDateTime("2026-10-16T07:14:00Z", true).includes("08:14"), M.fmtShopDateTime("2026-10-16T07:14:00Z", true));
  check("a date-only value is never shown as a time", !/\d{2}:\d{2}/.test(M.fmtShopDateTime("2026-10-16", true)) && M.fmtShopDateTime("2026-10-16", true).includes("16"),
    M.fmtShopDateTime("2026-10-16", true));
  check("French, shop time", M.fmtShopDateTime("2026-10-16T07:14:00Z", false).includes("08:14"));
  check("the date never slips a day (late UTC evening = next day in WAT)", M.fmtShopDate("2026-10-16T23:30:00Z", true).startsWith("17"), M.fmtShopDate("2026-10-16T23:30:00Z", true));
  const tdm = read("components/TransferDetailModal.jsx");
  check("details modal: 'Started' uses created_at first", /fmtWhen\(t\.created_at \|\| t\.transfer_date, en\)/.test(tdm) && !/t\.transfer_date \|\| t\.created_at/.test(tdm));
  check("transfers list: created_at in shop time, not formatDate(transfer_date)", !/formatDate\(tr\.transfer_date\)/.test(read("pages/TransfersPage.jsx")));
}

// ── 5 change my password (2026-10-16) ───────────────────────────────────────
console.log("\n-- 5 change my password: every role, own password only --\n");
{
  const h = render(M.ChangePasswordCard, { en: true });
  const hf = render(M.ChangePasswordCard, { en: false });
  check("the card renders: current + new + confirm, 'Change password'", h.includes("Change password") && h.includes("Current password")
    && h.includes("New password") && h.includes("Confirm new password") && (h.match(/type="password"/g) || []).length === 3);
  check("…in French: 'Changer le mot de passe'", hf.includes("Changer le mot de passe") && hf.includes("Mot de passe actuel"));
  const P = (current, next, confirm = next) => M.newPasswordProblem({ current, next, confirm }, true);
  check("a valid change has no problem", P("Boss2026", "Boss2027x") === null);
  check("special character refused, in words", /letters and numbers only/i.test(P("Boss2026", "Boss#2027") || ""));
  check("fewer than 6 refused", /at least 6/.test(P("Boss2026", "Ab123") || "") && P("Boss2026", "Ab1234") === null);
  check("same as current refused; confirm must match", /different/.test(P("Boss2026", "Boss2026") || "") && /do not match/.test(P("Boss2026", "Boss2027x", "x") || ""));
  check("French errors", /lettres et des chiffres/.test(M.newPasswordProblem({ current: "a", next: "Boss#1", confirm: "Boss#1" }, false) || ""));
  // Reachable by EVERY role: Settings is owner/manager, so staff get /my-account — in all 3 places.
  const app = read("App.jsx"), nav = read("components/common/Layout.jsx"), drawer = read("components/layout/NavDrawer.jsx");
  const ALL = ["owner", "manager", "accountant", "cashier", "warehouse"];
  const access = (app.match(/"\/my-account":\s*\[([^\]]*)\]/) || [])[1] || "";
  check("App ROUTE_ACCESS: /my-account open to all 5 roles", ALL.every((r) => access.includes(`"${r}"`)), access);
  check("App: the /my-account route renders MyAccountPage", /path="my-account"[^\n]*MyAccountPage/.test(app));
  const navRow = (nav.match(/\{ to: "\/my-account"[^\n]*/) || [""])[0];
  check("Layout NAV: 'My account' for all 5 roles", ALL.every((r) => navRow.includes(`"${r}"`)), navRow);
  check("NavDrawer (mobile) lists /my-account", /"\/my-account"/.test(drawer));
  check("Settings → Account renders the same card (owner/manager)", /<ChangePasswordCard en=/.test(read("pages/SettingsPage.jsx")));
}

// ── 6 To Buy: Buy-0 lines start unticked and are never sent ─────────────────
console.log("\n-- 6 To Buy: a Buy-0 line (buffer covers it) is unticked and never counted --\n");
{
  // Peter's list on staging: 18 rows, Brake Pad + Push Test Carton have Buy 0 (buffer covers them).
  const rows = Array.from({ length: 16 }, (_, i) => ({ product_id: "p" + i, name: "P" + i, suggested_qty: 3 }))
    .concat([{ product_id: "brake", name: "Brake Pad", suggested_qty: 0, buffer_qty: 20 },
             { product_id: "push", name: "Push Test Carton", suggested_qty: 0, buffer_qty: 10 }]);
  const OLD_DEFAULT = (s) => ({ checked: true, qty: s });
  check("OLD: Brake Pad started TICKED (the bug)", OLD_DEFAULT(0).checked === true);
  check("Brake Pad / Push Test Carton start UNTICKED", M.restockLineDefault(0).checked === false && M.restockLineDefault(3).checked === true);
  const sent = M.restockSendItems({ buyRows: rows, lines: {}, manual: [], en: true });
  check("'Send to supplier (N)': N = 16 and neither Buy-0 product is in the order", sent.length === 16 && !sent.some((s) => s.product_id === "brake" || s.product_id === "push"));
  const ticked = M.restockSendItems({ buyRows: rows, lines: { brake: { checked: true, qty: 0 } }, manual: [], en: true });
  check("ticking a Buy-0 line without a quantity still sends nothing for it", ticked.length === 16 && !ticked.some((s) => s.product_id === "brake"));
  const typed = M.restockSendItems({ buyRows: rows, lines: { brake: { checked: true, qty: 4 } }, manual: [], en: true });
  check("…but typing a quantity on it is an honest order line", typed.length === 17 && typed.some((s) => s.product_id === "brake" && s.quantity === 4));
  check("RestockPage uses these rules (no inline 'checked: true' default left)", /restockLineDefault\(/.test(read("pages/RestockPage.jsx"))
    && /restockSendItems\(/.test(read("pages/RestockPage.jsx")) && !/\{ checked: true, qty: (suggested|r\.suggested_qty) \}/.test(read("pages/RestockPage.jsx")));
}

// ── 7 hide the cash amount on EVERY device (2026-10-16) ─────────────────────
console.log("\n-- 7 hide the cash amount: every device, until the password --\n");
{
  // This check runs in Node: no Capacitor, no touch pointer, no 768px phone — i.e. exactly
  // what the OLD gate called a "computer" and left unmasked ("No effect on computers").
  const OLD_IS_HANDHELD = false;
  check("OLD: on a computer the gate was off (the bug)", (true && OLD_IS_HANDHELD) === false);
  check("setting ON → the gate is on here too (computer), and masked until the password",
    render(M.GateProbe, { enabled: true }).includes("true|false"), render(M.GateProbe, { enabled: true }));
  check("setting OFF → no gate, shown as today", render(M.GateProbe, { enabled: false }).includes("false|true"));
  globalThis.__SETTINGS = { data: { hide_drawer_amount: true } };
  check("useDrawerMask: setting ON → every drawer figure reads •••••", render(M.MaskProbe, {}).includes("true|•••••"), render(M.MaskProbe, {}));
  globalThis.__SETTINGS = { data: { hide_drawer_amount: false } };
  check("useDrawerMask: setting OFF → the real figure", render(M.MaskProbe, {}).includes("false|X5"), render(M.MaskProbe, {}));
  globalThis.__SETTINGS = undefined;
  check("useDrawerMask: setting not loaded yet → hidden (server default ON)", render(M.MaskProbe, {}).includes("true|•••••"));
  const btn = render(M.DrawerRevealButton, { en: true, masked: true });
  check("the 'Show' button names what is hidden; nothing when unmasked",
    btn.includes("Cash amounts hidden") && render(M.DrawerRevealButton, { en: true, masked: false }) === "");
  // The shared WhatsApp/report text must not be a way round the password.
  const ledger = { date: "2026-10-16", location: null, blocks: { day_flow: {}, outstanding: {},
    shifts: [{ cashier_name: "Kusi", opened_at: "2026-10-16T07:00:00Z", closed_at: "2026-10-16T17:00:00Z", opening_float: 5000,
      cash_sales: 12345, debt_collected_cash: 0, cash_refunds: 0, expenses: 0, expected_drawer: 17345, counted_at_close: 17345, variance: 0 }],
    drawer: { expected_drawer: 17345, drawer_variance: 0, unattributed_cash: 0 } } };
  const shown = M.buildLedgerTextV2(ledger, "en");
  const hidden = M.buildLedgerTextV2(ledger, "en", { hideDrawer: true });
  const has = (t, n) => new RegExp(String(n).replace(/(\d)(?=(\d{3})+$)/g, "$1[\\s\\u202f\\u00a0,.]?")).test(t);
  check("shared text, unmasked: expected 17 345 is in it", has(shown, 17345), shown.slice(0, 200));
  check("shared text, masked: no float, cash sales, expected or counted figure — •••••",
    !has(hidden, 17345) && !has(hidden, 12345) && !has(hidden, 5000) && hidden.includes("•••••"), hidden.slice(0, 400));
  // Every drawer surface goes through the mask (a raw fmt() would bypass it).
  const sw = read("components/common/ShiftWidgets.jsx");
  const close = sw.slice(sw.indexOf("export function CloseShiftModal"), sw.indexOf("export function", sw.indexOf("export function CloseShiftModal") + 10));
  check("close-shift: float, cash in/out, expected and variance use the mask", /fmtD\(expected\)/.test(close) && /fmtD\(shift\.opening_float/.test(close)
    && /Variance hidden/.test(close) && /<DrawerRevealButton/.test(close) && !/\{fmt\(expected\)\}/.test(close));
  check("close-shift: category totals masked (CategoryRow)", /function CategoryRow[\s\S]{0,200}useDrawerMask\(\)\.maskMoney\(useCurrency\(\)\)/.test(sw));
  const rp = read("pages/ReportsPage.jsx");
  check("Daily Ledger: SHIFTS + DRAWER blocks and the drawer summary use the mask; text + CSV too",
    /value=\{fmtD\(s\.expected_drawer\)\}/.test(rp) && /value=\{fmtD\(bl\.drawer\.expected_drawer\)\}/.test(rp) && /\{fmtD\(dr\.expected\)\}/.test(rp)
    && /hideDrawer: drawerMasked/.test(rp) && /dv\(dr\.expected\)/.test(rp) && !/value=\{fmt\(s\.expected_drawer\)\}/.test(rp));
  check("Shifts history: every drawer column uses the mask", /fmtD\(s\.expected_drawer/.test(read("pages/ShiftsPage.jsx")) && !/\{fmt\(s\.expected_drawer/.test(read("pages/ShiftsPage.jsx")));
  check("Cashier oversight: drawer totals use the mask", /fmtD\(d\.drawer\.totals\.expected\)/.test(read("components/CashierOversightTab.jsx")));
  // Peter (2026-10-16): the shift-closed report to the owner ALWAYS carries the real figures,
  // and asks the server for the CLOSED shift (only its closer may read that ledger).
  const prompt = sw.slice(sw.indexOf("function SendReportPromptModal"), sw.indexOf("function SendReportPromptModal") + 6000);
  check("shift-closed report: real figures (no hideDrawer) and the closed shift_id on both fetches",
    /const dailyTxt  = ledger \? buildLedgerText\(ledger, lang\) : ""/.test(prompt)
    && (prompt.match(/shift_id=\$\{shiftId\}/g) || []).length === 2 && /setReportPromptShift\(data\?\.shift_id/.test(sw));
  // A shared drawer the server sends WITHOUT figures (amounts_hidden) is never shown as 0.
  check("amounts_hidden: banner, drawer card and close-shift say owner/manager only, no password prompt",
    /data\?\.amounts_hidden \?/.test(sw) && /const roleHidden = !!shift\?\.amounts_hidden/.test(sw)
    && /const roleHidden = !!current\?\.amounts_hidden/.test(read("components/dashboard/DrawerDashboardCard.jsx")));
  const st = read("pages/SettingsPage.jsx");
  check("Settings: 'Hide the cash amount until password', all devices, no 'No effect on computers'",
    st.includes("Hide the cash amount until password") && st.includes("Masquer le montant de la caisse jusqu'au mot de passe")
    && !st.includes("No effect on computers") && !st.includes("Sans effet sur ordinateur") && st.includes("On every device"));
  check("the reveal is the viewer's own password (verify-my-pin = the approval-box check)", /\/auth\/verify-my-pin/.test(read("utils/useDrawerReveal.js")));
}

// ── 8 "Can see the Daily Ledger" (accountants, owner-granted, default off) ────
console.log("\n-- 8 Daily Ledger access for accountants --\n");
{
  const al = read("pages/AccountantLogPage.jsx");
  const block = al.slice(al.indexOf('staff.role === "accountant" && ('), al.indexOf('staff.role === "accountant" && (') + 2600);
  check("Permissions screen: an ACCOUNTANT-only toggle 'Can see the Daily Ledger' / 'Peut voir le journal de caisse'",
    block.includes("Can see the Daily Ledger") && block.includes("Peut voir le journal de caisse") && /can_view_daily_ledger: o\.val/.test(block));
  check("…with the one-line note, in both languages",
    block.includes("Lets this person see cash figures (drawer, expected, counted, variance).") && block.includes("montants de caisse"));
  check("…and the save sends it every time (a save about something else never clears it)", /can_view_daily_ledger: !!perms\.can_view_daily_ledger/.test(al));
  const rp = read("pages/ReportsPage.jsx");
  check("Reports: an accountant without the grant gets no Daily Summary / Daily Ledger tab and no cash query",
    /const ledgerAllowed = !isAccountant \|\| myPerms\?\.can_view_daily_ledger === true/.test(rp)
    && /TABS\.filter\(t => ledgerAllowed \|\| \(t\.key !== "daily" && t\.key !== "ledger"\)\)/.test(rp)
    && /enabled: tab === "ledger" && ledgerAllowed/.test(rp) && /enabled: ledgerAllowed && !permsLoading/.test(rp));
  check("…a clear 'Ask the owner for access' message instead of a blank or an error", rp.includes("Ask the owner for access") && rp.includes("Demandez l'accès au patron"));
  check("…and the day's 'Collected' total shows —, never a 0 it was not allowed to read", /collectedToday == null \? "—"/.test(rp) && /paid == null \? "—"/.test(rp));
}

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
