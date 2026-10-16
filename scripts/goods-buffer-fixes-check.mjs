// GOODS-BUFFER STAGING FIXES (Peter's test, 2026-10-16) — the SCREEN half.
//   1. every approve / reject / reveal box takes the LOGIN password: letters kept, no numeric
//      keypad, labelled "Your password"; Approve is live for "Boss2026"
//   3. the buffer's name follows the APP language (stored "Zone tampon" reads "Goods Buffer" in
//      English), its icon letter too, and no location dropdown prints a raw name
//   4. a transfer's "Started" time is created_at in shop time — never the date-only
//      transfer_date read as UTC midnight ("01:00")
// (2, To Buy, is server-side: backend goods-buffer-fixes-check + goods-buffer-fixes-probe.)
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
  "@tanstack/react-query": `export const useQuery = () => ({ data: null, isLoading: false, isError: false });`,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };`,
  "store": `const pick = (get) => (sel) => (typeof sel === "function" ? sel(get()) : get());
    export const useLangStore = pick(() => ({ lang: globalThis.__LANG || "en" }));
    export const useAuthStore = pick(() => ({ user: { role: "owner", id: "u1" }, org: {} }));
    export const useSettingsStore = pick(() => ({}));`,
  "useDrawerReveal": `export const revealWithPin = async () => ({ ok: true }); export const REVEAL_MS = 30000;`,
};

await build({
  stdin: {
    contents: `
      export { default as HoldRejectFields, holdRejectReady } from "./components/common/HoldRejectFields";
      export { default as ApproverPasswordInput, approverPasswordReady } from "./components/common/ApproverPasswordInput";
      export { approveBlockedReason } from "./components/common/HoldShortfallFields";
      export { default as RevealPinModal } from "./components/common/RevealPinModal";
      export { locationLabel, locationNameLabel, locationInitial } from "./utils/locations";
      export { fmtShopDateTime, fmtShopDate } from "./utils/shopTime";`,
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

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
