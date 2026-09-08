// F-A — do the two duplicate-capture surfaces actually SAY the right thing?
//
// WHY THIS EXISTS SEPARATELY FROM THE STAGING RIG
// -----------------------------------------------
// backend/scripts/buffer-duplicate-capture-check.mjs proves the API refuses with
// 409 and that /release-info returns `possible_duplicates`. Neither proves the
// SCREEN. "The endpoint returns the sibling" and "the warning appears" are two
// different claims, and only the second one is what Paul sees.
//
// ⚠️ BOTH SURFACES ARE UNREACHABLE THROUGH THEIR PARENTS HERE. The prompt appears
// off a mutation's onError; the release warning off a fetch in useEffect. NEITHER
// runs under renderToString. That is exactly why both were hoisted to module
// scope and take plain props — rendering GoodsBufferPage and asserting on the
// output would have produced a green run against a screen that never showed
// anything, which has already happened five times in this codebase.
//
// So: render the components directly, with props, and assert the COPY.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__buffer_dup_mounted.mjs");

const STUBS = {
  "@tanstack/react-query": `
    export const useQuery = () => ({ data: undefined, isLoading: false, isError: false, refetch(){} });
    export const useMutation = () => ({ mutate(){}, mutateAsync: async () => {}, isPending: false });
    export const useQueryClient = () => ({ invalidateQueries(){}, setQueryData(){}, getQueryData(){} });
  `,
  "api": `export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`,
  "store": `
    const pick = (get) => (sel) => (typeof sel === "function" ? sel(get()) : get());
    export const useAuthStore = pick(() => ({ user: { role: "owner", id: "u1" }, org: { name: "Shop" } }));
    export const useLangStore = pick(() => ({ lang: "en" }));
    export const useSettingsStore = pick(() => ({ selectedLocation: { id: "loc-1", name: "Bepanda" } }));
  `,
  "useCurrency": `const f = (n) => String(n ?? 0) + " FCFA"; f.symbol = "FCFA"; export const useCurrency = () => f;`,
  "useNetworkStatus": `export const useNetworkStatus = () => ({ isOnline: true });`,
  "useMyPermissions": `export const useMyPermissions = () => ({ perms: {} });`,
  "useLiteMode": `export const useLiteMode = () => ({ isLite: false, liteMode: false });`,
  "useOwnerApproval": `export default function useOwnerApproval(){ return { ask: () => {}, modal: null, pending: false }; }`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
  "CameraScanner": `export default function CameraScanner(){ return null; }`,
  "PaywallModal": `export default function PaywallModal(){ return null; }`,
  "MultipartBuilder": `export default function MultipartBuilder(){ return null; }
                       export const partsToPayload = (p) => p; export const emptyPart = () => ({});`,
  "MultipartAvailability": `export default function MultipartAvailability(){ return null; }`,
  "DoziePublishModal": `export default function DoziePublishModal(){ return null; }`,
};

await build({
  stdin: {
    contents: `export { DuplicateCapturePrompt, DuplicateSiblingWarning } from "./pages/GoodsBufferPage";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "buf-entry.jsx",
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

// A React warning is a failure — "each child in a list needs a key" is how a
// fixture/component mismatch announces itself.
let warned = [];
const realWarn = console.error;
console.error = (...a) => { warned.push(String(a[0])); };
// ⚠️ renderToString ESCAPES the text it emits: "d'intervalle" comes back as
// "d&#x27;intervalle". Asserting on the raw output would have quietly failed
// every French string carrying an apostrophe — and French copy here is full of
// them ("S'agit-il", "d'intervalle", "Rien n'a"). Compare against what a reader
// actually sees, not against the transport encoding.
const unescape = (s) => s
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const render = (Comp, props) => { warned = []; return unescape(renderToString(React.createElement(Comp, props))); };

console.log("\n-- F-A: the duplicate-capture surfaces say the right thing ------\n");

// The 409 body the backend actually sends, field for field (goodsBuffer.js).
const INFO = {
  code: "duplicate_capture_suspected",
  confirm_field: "confirm_duplicate",
  window_hours: 6,
  earlier: { buffer_id: "b1", buffer_number: "BUF-20260809-0027", qty_received: 800 },
  message_en: "Kosi captured 800 Bearing 6300 into Principal Magazine 5 minutes ago (BUF-20260809-0027). Is this a separate delivery?",
  message_fr: "Kosi a enregistré 800 Bearing 6300 dans Principal Magazine il y a 5 minutes (BUF-20260809-0027). S'agit-il d'une livraison distincte ?",
};

// 1 ── THE CAPTURE PROMPT, English.
{
  const h = render(M.DuplicateCapturePrompt, { info: INFO, en: true, busy: false });
  check("prompt renders the server's own sentence, not a rewrite", h.includes("Kosi captured 800 Bearing 6300"), `${h.length} chars`);
  check("prompt names the earlier record", h.includes("BUF-20260809-0027"));
  check("prompt asks the answerable question", h.includes("Is this a separate delivery?"));
  check("prompt states that nothing was saved", h.includes("Nothing has been saved yet"));
  check("the confirm button states the CLAIM, not a bare OK", h.includes("Yes, separate delivery"));
  check("cancelling is offered first", h.indexOf("Cancel") < h.indexOf("Yes, separate delivery"));
  check("no React warning", warned.length === 0, warned[0] || "");
}

// 2 ── THE CAPTURE PROMPT, French. Paul's org is English, but the app ships FR.
{
  const h = render(M.DuplicateCapturePrompt, { info: INFO, en: false, busy: false });
  // Apostrophes on purpose — these are the strings the escaping trap hid.
  check("French prompt uses the French sentence", h.includes("S'agit-il d'une livraison distincte ?"));
  check("French says nothing was saved yet", h.includes("Rien n'a encore été enregistré"));
  check("French confirm button", h.includes("Oui, livraison distincte"));
  check("French does NOT leak the English copy", !h.includes("Nothing has been saved yet"));
}

// 3 ── IN-FLIGHT. Double-confirming would write two rows and two override records.
{
  const h = render(M.DuplicateCapturePrompt, { info: INFO, en: true, busy: true });
  check("while confirming, the button is disabled", h.includes("disabled"));
  check("...and shows progress instead of the label", !h.includes("Yes, separate delivery"));
}

// 4 ── NO INFO, NO MODAL. The guard has to be reachable or it is decoration.
{
  check("no prompt without a refusal", render(M.DuplicateCapturePrompt, { info: null, en: true }) === "");
}

const SIB = (o = {}) => ({
  buffer_id: "s1", buffer_number: "BUF-20260809-0027", qty_received: 800,
  actor_name: "Kosi", minutes_apart: 5, status: "pending", ...o,
});

// 5 ── THE RELEASE WARNING. This is the assertion the staging rig cannot make.
{
  const h = render(M.DuplicateSiblingWarning, { siblings: [SIB()], en: true });
  check("release warning appears at all", h.length > 0, `${h.length} chars`);
  check("...and says the goods were captured more than once", h.includes("captured more than once"));
  check("...names the earlier record", h.includes("BUF-20260809-0027"));
  check("...names who captured it", h.includes("Kosi"));
  check("...names the quantity", h.includes("800"));
  check("...states the gap", h.includes("5 min apart"));
  check("...says what releasing both would DO", h.includes("releasing both adds both to stock"));
  check("no React warning", warned.length === 0, warned[0] || "");
}

// 6 ── TWO SIBLINGS. The 9 Aug event was a triple, not a pair.
{
  const h = render(M.DuplicateSiblingWarning, {
    siblings: [SIB(), SIB({ buffer_id: "s2", buffer_number: "BUF-20260809-0032", minutes_apart: 9 })], en: true });
  check("both siblings are listed", h.includes("BUF-20260809-0027") && h.includes("BUF-20260809-0032"));
  check("no key warning on a list", warned.length === 0, warned[0] || "");
}

// 7 ── MISSING FIELDS MUST NOT RENDER AS "null". release-info leaves actor_name
//      null when the user row cannot be read, and that lookup is best-effort.
{
  const h = render(M.DuplicateSiblingWarning, {
    siblings: [SIB({ actor_name: null, minutes_apart: null, buffer_number: null, status: null })], en: true });
  check("a missing actor degrades to 'someone'", h.includes("someone"));
  check("...and never prints null", !h.toLowerCase().includes("null"), h);
  check("...and omits the gap rather than inventing one", !h.includes("min apart"));
}

// 8 ── FRENCH.
{
  const h = render(M.DuplicateSiblingWarning, { siblings: [SIB()], en: false });
  check("French release warning", h.includes("enregistrées plusieurs fois"));
  check("French gap phrasing", h.includes("5 min d'intervalle"));
}

// 9 ── NO FALSE POSITIVE. Most captures have no twin; the banner must be absent,
//      not empty-but-present, or every release grows a permanent warning box.
{
  check("no siblings renders NOTHING", render(M.DuplicateSiblingWarning, { siblings: [], en: true }) === "");
  check("undefined siblings renders NOTHING", render(M.DuplicateSiblingWarning, { siblings: undefined, en: true }) === "");
}

// 10 ── TEETH. If the components ever start returning null unconditionally — the
//       pre-F-A state of this screen — every assertion above goes hollow while
//       still passing, because "" contains nothing to contradict. Assert the
//       populated and empty renders actually DIFFER.
{
  const populated = render(M.DuplicateSiblingWarning, { siblings: [SIB()], en: true });
  const empty = render(M.DuplicateSiblingWarning, { siblings: [], en: true });
  check("populated and empty renders are genuinely different",
    populated.length > 100 && empty === "" && populated !== empty, `${populated.length} vs ${empty.length}`);
}

console.error = realWarn;
try { rmSync(OUT); } catch { /* leave it */ }
console.log(fails ? `\n-- ${fails} FAILED --\n` : "\n-- all duplicate-capture surface checks passed --\n");
process.exit(fails ? 1 : 0);
