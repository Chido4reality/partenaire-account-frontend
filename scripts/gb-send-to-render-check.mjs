// GB-SEND-TO — does the release result SAY what happened to each destination?
// The result screen appears only after the release mutation succeeds, which never happens
// under renderToString — so SendToResult is module-scope with plain props and rendered here
// directly, with the exact `transfers` shape backend lib/gbSendTo.js returns.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__gb_send_to_mounted.mjs");

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
    contents: `export { SendToResult, ReleaseResultActions, staysAfterRelease } from "./pages/GoodsBufferPage";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "gbs-entry.jsx",
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
console.error = (...a) => { warned.push(String(a[0])); };
const unescape = (s) => s.replace(/<!-- -->/g, "")   // React text-node separators
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const render = (props) => { warned = []; return unescape(renderToString(React.createElement(M.SendToResult, props))); };

console.log("\n-- GB-SEND-TO: the release result names every destination ------\n");

// The shape lib/gbSendTo.js createReleaseTransfers returns, field for field.
const T = {
  created: [
    { location_id: "a", location_name: "Bepanda Shop", quantity: 6, transfer_id: "t1", transfer_number: "TRF-20261027-0001", status: "pending" },
    { location_id: "b", location_name: "Bonaberi Shop", quantity: 3, transfer_id: "t2", transfer_number: "TRF-20261027-0002", status: "pending" },
  ],
  awaiting_approval: [{ location_id: "c", location_name: "Akwa Shop", quantity: 2, approval_id: "ap1" }],
  failed: [{ location_id: "d", location_name: "Deido Shop", quantity: 1, code: "transfer_create_failed",
    message_en: "The transfer to Deido Shop could not be created — those goods stay in the Goods Buffer. Create it from Transfers.",
    message_fr: "Le transfert vers Deido Shop n'a pas pu être créé — la marchandise reste dans la zone tampon. Créez-le depuis Transferts." }],
};

{
  const h = render({ transfers: T, en: true, kit: false });
  check("each created transfer: its TRF number", h.includes("TRF-20261027-0001") && h.includes("TRF-20261027-0002"));
  check("…its destination and quantity", h.includes("Bepanda Shop · 6") && h.includes("Bonaberi Shop · 3"));
  check("…and that it awaits dispatch (with a link affordance)", (h.match(/Awaiting dispatch/g) || []).length === 2 && (h.match(/data-send-created/g) || []).length === 2);
  check("awaiting approval: destination + what happens next", h.includes("Akwa Shop · 2") && h.includes("waiting for the boss's approval"));
  check("a failure: destination + the server's English message", h.includes("Deido Shop · 1") && h.includes("those goods stay in the Goods Buffer"));
  check("no React warning", warned.length === 0, warned[0] || "");
}
{
  const h = render({ transfers: T, en: false, kit: false });
  check("French: awaiting dispatch", (h.match(/En attente d'envoi/g) || []).length === 2);
  check("French: approval wording", h.includes("en attente de l'accord du patron"));
  check("French: the server's French failure message", h.includes("n'a pas pu être créé") && !h.includes("could not be created"));
}
{
  const h = render({ transfers: { created: [{ ...T.created[0], quantity: 4 }], awaiting_approval: [], failed: [] }, en: true, kit: true });
  check("kit release: quantities read in kits", h.includes("Bepanda Shop · 4 kits"));
}
{
  const h = render({ transfers: undefined, en: true, kit: false });
  check("old backend (no transfers in the reply): says NOT created, goods in the buffer", h.includes("NOT created") && h.includes("Goods Buffer"));
  const f = render({ transfers: undefined, en: false, kit: false });
  check("…and in French", f.includes("n'ont PAS été créés"));
}
{
  const h = render({ transfers: { created: [], awaiting_approval: [], failed: [] }, en: true, kit: false });
  check("an empty result renders no rows (and no false 'not created')", !h.includes("NOT created") && !h.includes("data-send-created"));
}

console.log("\n-- GB-SEND-TO: 'Transfer now' only while something stays in the buffer --\n");
{
  const act = (released, sentTo, canMoveBuffer = true) => unescape(renderToString(React.createElement(M.ReleaseResultActions,
    { en: true, canMoveBuffer, stays: M.staysAfterRelease(released, sentTo), onLater() {}, onTransfer() {} })));
  const now = (h) => h.includes("data-transfer-now") && h.includes("Transfer now");
  const tr = (created, awaiting = [], failed = []) => ({ created: created.map((q, i) => ({ location_id: "c" + i, quantity: q })),
    awaiting_approval: awaiting.map((q, i) => ({ location_id: "a" + i, quantity: q })), failed: failed.map((q, i) => ({ location_id: "f" + i, quantity: q })) });
  const cases = [
    ["no Send to: 8 released, all stay → shown", { released_now: 8 }, false, true],
    ["Send to took everything (5+3 of 8) → hidden", { released_now: 8, transfers: tr([5, 3]) }, true, false],
    ["Send to left 1 (5+2 of 8) → shown", { released_now: 8, transfers: tr([5, 2]) }, true, true],
    ["awaiting approval counts as sent (5 created + 3 awaiting of 8) → hidden", { released_now: 8, transfers: tr([5], [3]) }, true, false],
    ["a FAILED destination stays in the buffer (5 created, 3 failed of 8) → shown", { released_now: 8, transfers: tr([5], [], [3]) }, true, true],
    ["old backend (no transfers key) created nothing → shown", { released_now: 8 }, true, true],
    ["kit: all 4 kits sent → hidden", { kits_released: 4, transfers: tr([3, 1]) }, true, false],
    ["kit: 3 of 4 kits sent → shown", { kits_released: 4, transfers: tr([3]) }, true, true],
  ];
  for (const [label, released, sentTo, want] of cases) {
    const h = act(released, sentTo);
    check(label, now(h) === want, `stays ${M.staysAfterRelease(released, sentTo)}`);
    check("…'Later' is always there", h.includes("Later"));
  }
  check("no buffer-move right → never shown, even with goods left", !now(act({ released_now: 8 }, false, false)));
  const fr = unescape(renderToString(React.createElement(M.ReleaseResultActions, { en: false, canMoveBuffer: true, stays: 1 })));
  check("French label", fr.includes("Transférer maintenant") && fr.includes("Plus tard"));
}

try { rmSync(OUT); } catch { /* leave it */ }
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
