// GOODS-BUFFER LOCATION (Peter, 2026-10-15) — in buffer mode (the plan includes transfers)
// the ONLY place goods land is the Goods Buffer, so the Goods Buffer screen must not offer a
// location anywhere:
//   1. the register form has no "Where it landed" picker
//   2. the "Waiting to be added to stock" list has no location filter
//   4. editing your own line has no location field (and sends none)
//   3. Lite / no-transfer plans keep the picker, the filter and the edit field
// The backend enforces 1 and 4 too (goods-buffer-location-probe §9). This proves the SCREEN:
// the real GoodsBufferPage and EditModal are rendered, with the queries stubbed.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__goods_buffer_landing.mjs");

const LOCS = [
  { id: "loc-1", name: "Bepanda", type: "shop", kind: null, is_active: true },
  { id: "loc-2", name: "Bonaberri", type: "shop", kind: null, is_active: true },
  { id: "buf-1", name: "Zone tampon", type: "warehouse", kind: "goods_buffer", is_active: true },
];

const STUBS = {
  // Each query answers from globalThis.__GB (set per render below), keyed by its first key.
  "@tanstack/react-query": `
    export const useQuery = ({ queryKey }) => {
      const d = (globalThis.__GB || {})[queryKey[0]];
      return { data: d, isLoading: false, isError: false, refetch(){} };
    };
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
  "useExpiryFeature": `export default function useExpiryFeature(){ return { enabled: false }; }`,
  "react-router-dom": `export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];`,
  "react-hot-toast": `const t = () => {}; t.success = () => {}; t.error = () => {}; export default t;`,
  "BufferDetailModal": `export default function BufferDetailModal(){ return null; }`,
  "ProductSearchBox": `export default function ProductSearchBox(){ return null; }`,
  "whatsapp": `export const openWhatsApp = () => {};`,
  "ExpiryFields": `export default function ExpiryFields(){ return null; } export const TrackExpiryToggle = () => null; export const expiryMissing = () => false;`,
};

await build({
  stdin: {
    contents: `export { default as GoodsBufferPage, EditModal } from "./pages/GoodsBufferPage";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "gb-landing-entry.jsx",
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

let M;
try { M = await import("file:///" + OUT.replace(/\\/g, "/")); }
finally { try { rmSync(OUT); } catch { /* already gone */ } }

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};
const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const render = (Comp, props) => unescape(renderToString(React.createElement(Comp, props)));

const BUFFER_ACCESS = { can_release: true, buffer_mode: true, buffer_location: LOCS[2], buffer_visible: true, buffer_units: 0, can_move_buffer: true };
const LITE_ACCESS = { can_release: true, buffer_mode: false, buffer_location: null, buffer_visible: false, buffer_units: 0, can_move_buffer: true };
const page = (access, locs) => {
  globalThis.__GB = { "goods-buffer-access": access, "locations": { data: locs }, "goods-buffer-pending": [] };
  return render(M.GoodsBufferPage, {});
};

console.log("\n-- Goods Buffer screen: in buffer mode the only place is the Goods Buffer --\n");
{
  const h = page(BUFFER_ACCESS, LOCS);
  check("the page renders (register form present)", h.includes("Register arrival"), `${h.length} chars`);
  check("buffer mode: no 'Where it landed' picker", !h.includes("Where it landed"));
  check("buffer mode: no location filter on the waiting list", h.includes("Waiting to be added to stock") && !h.includes("All locations"));
  check("buffer mode: no branch is offered anywhere on the page", !h.includes(">Bonaberri<") && !h.includes(">Bepanda<"));
}
{
  const h = page(LITE_ACCESS, LOCS.slice(0, 2));
  check("Lite: the 'Where it landed' picker is still there", h.includes("Where it landed"));
  check("Lite: the location filter is still there", h.includes("All locations"));
  check("Lite: the branches are offered", h.includes(">Bonaberri<") && h.includes(">Bepanda<"));
}
{
  const row = { buffer_id: "b1", qty_received: 5, landed_location_id: "loc-1", is_new_product: false, product_label: "Brake Pad" };
  const hb = render(M.EditModal, { row, en: true, locList: LOCS, bufferMode: true, onClose() {}, onDone() {} });
  check("buffer mode: editing your own line has no location field", !hb.includes(">Location<") && !hb.includes(">Bonaberri<"));
  const hl = render(M.EditModal, { row, en: true, locList: LOCS.slice(0, 2), bufferMode: false, onClose() {}, onDone() {} });
  check("Lite: editing keeps the location field", hl.includes(">Location<") && hl.includes(">Bonaberri<"));
}

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
