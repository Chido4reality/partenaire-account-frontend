// TRANSFER RESERVATION (2026-10-27) — do the screens show what is really free to transfer?
// A pending transfer reserves its units at the source (the server refuses anything over
// stock − Σ pending). Prod: Send to put 50 lamps on TRF-0005 and nothing on screen said so —
// the transfer picker offered the same 50 again.
//   §1 availabilityOf: 50/50/0 (today's case), 50/30/20, the edited transfer excluded, no data = plain stock
//   §2 the text in both languages; a server refusal shown in the reader's language
//   §3 AvailabilityLine renders the three numbers and the pending TRF numbers
//   §4 wiring: the transfer picker, the Goods Buffer stock screen (and so "Transfer now", which opens
//      the picker with the buffer as source) use it; no transfer toast shows the French `message` to EN
// Teeth: run on bfc1d59 → fails (no util, no wiring).
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__transfer_availability_mounted.mjs");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

console.log("\n-- TRANSFER RESERVATION: in stock · assigned · available ----------------------\n");
let U = null;
try { U = await import(pathToFileURL(resolve(SRC, "utils/transferAvailability.js")).href); } catch (e) { check("utils/transferAvailability.js loads", false, e.message); }

if (U) {
  const R = { lamp: { assigned: 50, pending: [{ transfer_id: "t5", transfer_number: "TRF-20261027-0005", quantity: 50 }] },
              b: { assigned: 30, pending: [{ transfer_id: "t1", transfer_number: "TRF-1", quantity: 20 }, { transfer_id: "t2", transfer_number: "TRF-2", quantity: 10 }] } };
  const a1 = U.availabilityOf("50.000", R, "lamp");
  check("§1 today's case: 50 in the buffer, 50 on TRF-0005 → available 0", a1.inStock === 50 && a1.assigned === 50 && a1.available === 0, JSON.stringify(a1));
  const a2 = U.availabilityOf(50, R, "b");
  check("…50 in stock, 30 pending → available 20", a2.available === 20 && a2.assigned === 30);
  const a3 = U.availabilityOf(50, R, "b", "t1");
  check("…editing TRF-1: its own 20 do not count against it → assigned 10, available 40", a3.assigned === 10 && a3.available === 40 && a3.pending.length === 1);
  const a4 = U.availabilityOf(7, {}, "x");
  check("…nothing reserved (or an older server) → plain stock", a4.assigned === 0 && a4.available === 7);
  const a5 = U.availabilityOf(10, R, "lamp");
  check("…stock under the pending total never shows a negative available", a5.available === 0);
  check("§2 EN: 'In stock 50 · assigned 30 · available 20'", U.availabilityText(a2, true) === "In stock 50 · assigned 30 · available 20", U.availabilityText(a2, true));
  check("…FR: 'En stock 50 · attribué 30 · disponible 20'", U.availabilityText(a2, false) === "En stock 50 · attribué 30 · disponible 20", U.availabilityText(a2, false));
  const body = { message: "Seulement 0 disponible…", message_fr: "Seulement 0 disponible…", message_en: "Only 0 available…" };
  check("…a refusal is shown in the reader's language", U.serverMessage(body, true) === "Only 0 available…" && U.serverMessage(body, false) === "Seulement 0 disponible…");
  check("…an older server (only `message`) still shows something", U.serverMessage({ message: "x" }, true) === "x" && U.serverMessage(null, true) === "Error");
}

try {
  await build({
    stdin: { contents: `export { AvailabilityLine } from "./components/common/TransferAvailability";`, resolveDir: SRC, loader: "jsx", sourcefile: "ta-entry.jsx" },
    bundle: true, format: "esm", outfile: OUT, jsx: "automatic", external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^@tanstack\/react-query$|\/api$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ loader: "js", contents: a.path.startsWith("@tanstack")
        ? "export const useQuery = () => ({ data: undefined });" : "export default { get: async () => ({ data: {} }) };" }));
    } }],
  });
  const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const html = renderToString(React.createElement(M.AvailabilityLine, { a: U.availabilityOf(50, { p: { assigned: 50, pending: [{ transfer_id: "t", transfer_number: "TRF-20261027-0005", quantity: 50 }] } }, "p"), en: true }));
  check("§3 renders 'In stock 50 · assigned 50 · available 0' and names TRF-20261027-0005", /data-availability="50\/50\/0"/.test(html)
    && html.includes("In stock 50 · assigned 50 · available 0") && html.includes("TRF-20261027-0005"), html.replace(/<[^>]+>/g, "").slice(0, 120));
  const free = renderToString(React.createElement(M.AvailabilityLine, { a: U.availabilityOf(12, {}, "p"), en: false }));
  check("…nothing assigned: 'En stock 12 · attribué 0 · disponible 12', no TRF list", free.includes("En stock 12 · attribué 0 · disponible 12") && !/data-assigned-to/.test(free));
} catch (e) { check("§3 AvailabilityLine renders", false, e.message); }
finally { try { rmSync(OUT, { force: true }); } catch { /* none */ } }

const TP = readFileSync(resolve(SRC, "pages/TransfersPage.jsx"), "utf8");
const GB = readFileSync(resolve(SRC, "pages/GoodsBufferPage.jsx"), "utf8");
check("§4 transfer picker: reserved figures for the SOURCE, the edited transfer excluded", /useReservedAt\(fromLoc\)/.test(TP) && /availabilityOf\([^)]*editingId\)/.test(TP));
check("…limits use what is AVAILABLE (pick qty, add, clamp), and the row shows the three numbers", /const availOf = [^\n]*availInfo\(product\)\.available/.test(TP)
  && /const max = availOf\(p\)/.test(TP) && /<AvailabilityLine a=\{info\}/.test(TP) && !/const avail = p\.stock\?\.quantity/.test(TP));
check("…a product with nothing available cannot be ticked", /disabled=\{avail <= 0 && !checked\}/.test(TP));
const blocks = ["createMutation", "dispatchMutation", "saveMutation", "cancelMutation"].map((n) => {
  const i = TP.indexOf(`const ${n} = useMutation`); return i < 0 ? "" : TP.slice(i, TP.indexOf("\n  });", i));
});
check("…create / dispatch / edit / cancel errors in the reader's language", blocks.every((b) => b && /serverMessage\(err\.response\?\.data, lang === "en"\)/.test(b) && !/err\.response\?\.data\?\.message \|\| "Error"/.test(b)));
check("…figures refreshed after create / edit / cancel / dispatch", blocks.every((b) => /transfers-reserved/.test(b)));
const tab = GB.slice(GB.indexOf("function BufferStockTab"));
check("§4 Goods Buffer stock screen: each line 'In stock · assigned · available'", /useReservedAt\(buf\?\.id\)/.test(tab) && /<AvailabilityLine a=\{availabilityOf\(it\.quantity, reserved, it\.product_id\)\}/.test(tab));
check("…'Transfer now' opens the transfer picker with the buffer as source (so the same figures)", /navigate\("\/transfers\?from=" \+ bufferLoc\.id\)/.test(GB));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
