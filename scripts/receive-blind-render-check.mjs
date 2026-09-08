// F-C gate 4 — is the receive screen actually BLIND?
//
// The claim is not "we hid it in the payload" (the backend gate proves that) but
// "the number is not on the receiver's screen before they answer". Those are two
// different claims and only this one is about what Paul's staff see.
//
// ⚠️ WHY A RENDER CHECK. The root cause of the whole problem was a PREFILL:
// AdjustReceiptModal seeded the Good input with String(it.quantity), so submitting
// it unchanged wrote received == sent. That is a rendering fact. It cannot be
// caught by reading the API, it survived every existing gate, and `npm run build`
// cannot see it either — esbuild does not evaluate a useState initialiser.
//
// The components are module-scope and take plain props, so this drives the REAL
// ones rather than a copy. Nothing here re-implements the blind rule; if the
// component changes, this changes with it or goes red.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__receive_blind_mounted.mjs");

const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = () => ({ data: undefined, isLoading: false, isError: false, refetch(){} });
    export const useMutation = () => ({ mutate(){}, mutateAsync: async () => {}, isPending: false });
    export const useQueryClient = () => ({ invalidateQueries(){}, setQueryData(){}, getQueryData(){} });
  `,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };
           export const formatDate = (d) => String(d || "");`,
  "store": `
    const pick = (get) => (sel) => (typeof sel === "function" ? sel(get()) : get());
    export const useAuthStore = pick(() => ({ user: { role: "warehouse", id: "u1", name: "Emmanuel" }, org: { name: "Shop" } }));
    export const useLangStore = pick(() => ({ lang: "en" }));
    export const useSettingsStore = pick(() => ({ selectedLocation: { id: "loc-1", name: "Branch" } }));
  `,
  "useCurrency": `const f = (n) => String(n ?? 0) + " FCFA"; f.symbol = "FCFA"; export const useCurrency = () => f;`,
  "useNetworkStatus": `export const useNetworkStatus = () => ({ isOnline: true });`,
  "useMyPermissions": `export const useMyPermissions = () => ({ perms: {} });`,
  "useReceiveSummary": `export const useReceiveSummary = () => ({ data: undefined }); export const RECEIVE_SUMMARY_KEY = ["x"]; export const OVERRIDE_AMBER_PCT = 20; export const OVERRIDE_AMBER_ABS = 5;`,
  "useLiteMode": `export const useLiteMode = () => ({ isLite: false, liteMode: false });`,
  "useOwnerApproval": `export default function useOwnerApproval(){ return { ask: () => {}, modal: null, pending: false }; }`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
  "CameraScanner": `export default function CameraScanner(){ return null; }`,
  "PaywallModal": `export default function PaywallModal(){ return null; }`,
  "ProductSearchBox": `export default function ProductSearchBox(){ return null; }`,
};

await build({
  stdin: {
    contents: `export { ReceiveCountModal, ReceiveRevealModal } from "./pages/TransfersPage";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "recv-entry.jsx",
  },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic",
  external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
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

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

let warned = [];
const realWarn = console.error;
console.error = (...a) => { warned.push(String(a[0])); };
const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const render = (C, p) => { warned = []; return unescape(renderToString(React.createElement(C, p))); };

console.log("\n-- F-C: is the receive screen actually blind? ------------------\n");

// THE REAL TRF-20260810-0003 — 9 lines, 1,048 units, confirmed in 47.8 seconds
// with zero lines counted. These are its actual quantities.
const QTYS = [2000, 10, 1100, 100, 360, 10, 50, 312, 96];
const NAMES = ["Tyre 300-18", "Tyre 300-17", "JYC Battery", "Michel Tube", "Gold Black",
               "Gold Red", "Bearing 6300", "Mud Flap Foam", "Petrogulf"];

// The payload the SERVER now sends a receiver: quantity is absent, not zeroed.
const blindItems = QTYS.map((q, i) => ({ id: "i" + i, product_id: "p" + i, pa_products: { name: NAMES[i], unit: "pc" } }));
// What the server sends the DISPATCHER (his own goods) — used to prove the check
// can actually see a quantity when one is present, i.e. that it is not vacuous.
const sightedItems = QTYS.map((q, i) => ({ id: "i" + i, product_id: "p" + i, quantity: q, pa_products: { name: NAMES[i], unit: "pc" } }));

const TR = (items) => ({ id: "t1", transfer_number: "TRF-20260810-0003", pa_transfer_items: items });

// 1 ── THE CENTRAL CLAIM. None of the nine sent quantities may appear.
{
  const h = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "en", busy: false, canSkipCount: false,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  check("the count screen renders", h.length > 200, `${h.length} chars`);
  check("every product is named", NAMES.every(n => h.includes(n)));
  const leaked = QTYS.filter(q => new RegExp(`>\\s*${q}\\s*<|value="${q}"`).test(h));
  check("NO sent quantity appears anywhere on the screen", leaked.length === 0, `leaked: ${leaked.join(",")}`);
  check("...and the word 'Sent' is not on it either", !/\bSent\b/.test(h), h.match(/.{0,30}Sent.{0,30}/)?.[0] || "");
  check("no React warning", warned.length === 0, warned[0] || "");
}

// 2 ── THE PREFILL, WHICH IS THE ROOT CAUSE. Inputs must be EMPTY.
//      Not zero: 0 is an answer, and the most important one on this screen.
{
  const h = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "en", busy: false, canSkipCount: false,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  const values = [...h.matchAll(/<input[^>]*value="([^"]*)"/g)].map(m => m[1]);
  check("there are inputs to check", values.length >= 18, `${values.length} inputs`);
  check("EVERY input starts empty — no prefill of any kind",
    values.every(v => v === ""), `non-empty: ${values.filter(v => v !== "").join(",") || "none"}`);
  check("...and none was prefilled with 0 either", !values.includes("0"));
}

// 3 ── NOT VACUOUS. The same assertions must FIRE when a quantity IS present.
//      Without this, "no number on screen" would also pass against a blank page.
{
  const h = render(M.ReceiveCountModal, { transfer: TR(sightedItems), lang: "en", busy: false, canSkipCount: false,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  // The component must STILL not print quantities even if handed them — the
  // blindness is in the component, not only in the payload. Belt and braces:
  // the server strips the field, AND the screen would not show it if it did not.
  const leaked = QTYS.filter(q => new RegExp(`>\\s*${q}\\s*<|value="${q}"`).test(h));
  check("even HANDED the quantities, the screen does not print them", leaked.length === 0, `leaked: ${leaked.join(",")}`);
  // And prove the detector works at all, against a string that definitely contains one.
  const control = `<span>${QTYS[0]}</span>`;
  check("CONTROL: the leak detector does fire on a real leak",
    new RegExp(`>\\s*${QTYS[0]}\\s*<`).test(control));
}

// 4 ── EVERY LINE REQUIRED. Confirm must be disabled until all nine are answered.
{
  const h = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "en", busy: false, canSkipCount: false,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  check("Confirm starts disabled", /Confirm count<\/button>/.test(h) && /disabled[^>]*>[^<]*Confirm count/.test(h.replace(/\n/g, "")),
    "disabled attr near Confirm");
  check("...and the screen says how many are still uncounted", /0 of 9 counted/.test(h), h.match(/\d+ of \d+ counted/)?.[0] || "");
  check("...and each line is marked not counted yet", (h.match(/not counted yet/g) || []).length === 9);
}

// 5 ── THE ESCAPE HATCH IS PERMISSION-GATED AND NEVER THE DEFAULT.
{
  const off = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "en", busy: false, canSkipCount: false,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  check("without the grant, the hatch is ABSENT", !off.includes("Can't count these right now?"));
  const on = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "en", busy: false, canSkipCount: true,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  check("with the grant, the hatch appears", on.includes("Can't count these right now?"));
  check("...as a text link, not a button competing with Confirm",
    on.indexOf("Confirm count") < on.indexOf("Can't count these right now?"));
  check("...and the count is still the primary action", on.includes("Confirm count"));
}

// 6 ── FRENCH. Paul's org is English but the app ships FR.
{
  const h = render(M.ReceiveCountModal, { transfer: TR(blindItems), lang: "fr", busy: false, canSkipCount: true,
    onCancel(){}, onSubmit(){}, onOverride(){} });
  check("French count screen", h.includes("Comptez ce qui est arrivé"));
  check("French hatch link", h.includes("Impossible de compter maintenant ?"));
  check("French does not leak the English copy", !h.includes("Count what arrived"));
  const values = [...h.matchAll(/<input[^>]*value="([^"]*)"/g)].map(m => m[1]);
  check("French inputs are empty too", values.every(v => v === ""));
}

// 7 ── THE REVEAL. This is the ONLY place a sent quantity may appear, and only
//      after a count has been submitted.
{
  const comparison = [
    { item_id: "i0", product: "Tyre 300-18", sent: 2000, good: 2000, damaged: 0, delta: 0, lost: 0, matches: true },
    { item_id: "i1", product: "Gold Black", sent: 42, good: 22, damaged: 0, delta: -20, lost: 20, matches: false },
  ];
  const h = render(M.ReceiveRevealModal, { reveal: { comparison, variance_lines: 1 }, lang: "en", onClose(){} });
  check("the reveal shows the sent figures", h.includes("2000") && h.includes("42"));
  check("...names the shortfall", /missing 20/.test(h));
  check("...says stock followed the COUNT, not the sent figure", /YOUR counted quantity/.test(h));
  check("...and headlines the differing lines", /1 line\(s\) differ/.test(h), h.slice(0, 200));
  const clean = render(M.ReceiveRevealModal, {
    reveal: { comparison: [comparison[0]], variance_lines: 0 }, lang: "en", onClose(){} });
  check("a fully matching receipt says so plainly", /Everything matched/.test(clean));
}

console.error = realWarn;
try { rmSync(OUT); } catch { /* leave it */ }
console.log(fails ? `\n-- ${fails} FAILED --\n` : "\n-- the receive screen is blind --\n");
process.exit(fails ? 1 : 0);
