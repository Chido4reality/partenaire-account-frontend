// PAYMENT PANEL CUSTOMER PICK (Peter 2026-11-18) — the Customers page's "Add New Customer" modal moved
// to components/common/AddCustomerModal so the sale screen can reuse it. Proof the Customers page did
// not change: its modal markup at BASE (the committed CustomersPage, cut out of `git show`) and the new
// component render BYTE-IDENTICAL — EN + FR, with and without the same-phone match — and the create
// logic is the same code (same POST body, same 409 code, same three cache refreshes).
// BASE: CUSTOMER_PICK_BASE (default HEAD — the commit before this change while it is uncommitted;
// after committing run with CUSTOMER_PICK_BASE=HEAD~1).
// Teeth: CUSTOMER_PICK_TEETH=1 changes one character of the component's markup in the bundle → must go red.
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");
// default base: HEAD while its CustomersPage still holds the modal (this change uncommitted), else the
// parent of the commit that took the modal out (pickaxe on its first line)
const MARK = `<div className="modal-overlay" onClick={() => setShowAdd(false)}>`;
const gitc = (...x) => execFileSync("git", x, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const BASE = process.env.CUSTOMER_PICK_BASE || (gitc("show", "HEAD:src/pages/CustomersPage.jsx").includes(MARK)
  ? "HEAD" : gitc("log", "-1", "--format=%H", "-S", MARK, "--", "src/pages/CustomersPage.jsx").trim() + "^");
const TEETH = !!process.env.CUSTOMER_PICK_TEETH;
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`); };
console.log(`\n── Add Customer modal: Customers page unchanged (base ${BASE}) ──${TEETH ? "  !! TEETH" : ""}\n`);

const oldPage = execFileSync("git", ["show", `${BASE}:src/pages/CustomersPage.jsx`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const a = oldPage.indexOf("      {showAdd && (\n        <div className=\"modal-overlay\"");
const b = oldPage.indexOf("      {/* MP-COLLECT-DEBT-NO-INVOICE: collect modal */}");
if (a < 0 || b < 0) { console.log("  FAIL  base modal not found in the base CustomersPage"); process.exit(1); }
const oldJsx = oldPage.slice(a, b).trim().replace(/^\{showAdd && \(/, "").replace(/\)\}$/, "");
const typesSrc = oldPage.match(/const TYPES = \[[\s\S]*?\];/)[0];

const STUBS = {
  "@tanstack/react-query": `export const useMutation = (o) => { globalThis.__cm.mutation = o; return { isPending: false, mutate() {} }; };
    export const useQueryClient = () => ({ invalidateQueries: (k) => globalThis.__cm.inval.push(JSON.stringify(k)) });`,
  "react-hot-toast": `export default { success() {}, error() {} };`,
  "utils/api": `export default { post: (u, body) => { globalThis.__cm.posts.push({ u, body }); return Promise.resolve({ data: { data: { id: "new" } } }); } };`,
  "store": `export const useLangStore = () => ({ lang: globalThis.__cm.lang });`,
  "utils/placeholders": `export const usePlaceholders = () => ({ personName: "Ex: Jean", phone: "6XX XX XX XX", city: "Douala" });`,
  "utils/useCurrency": `const f = (n) => String(n) + " F"; f.symbol = "FCFA"; export const useCurrency = () => f;`,
};
const OLD_ENTRY = `import { useState } from "react";
import { useLangStore } from "./store"; import { usePlaceholders } from "./utils/placeholders"; import { useCurrency } from "./utils/useCurrency";
${typesSrc}
export function OldModal() {
  const { lang } = useLangStore(); const PH = usePlaceholders(); const fmt = useCurrency();
  const form = { name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "", total_debt: "" };
  const [dupeMatch] = useState(globalThis.__cm.dupe); const setF = () => {}; const setShowAdd = () => {};
  const openExistingCustomer = () => {}; const handleAddCustomer = () => {}; const addMutation = { isPending: false };
  return (${oldJsx});
}
export { default as NewModal } from "./components/common/AddCustomerModal";`;
const OUT = resolve(HERE, "__customer_pick_check.mjs");
await build({
  stdin: { contents: OLD_ENTRY, resolveDir: SRC, loader: "jsx", sourcefile: "cp-entry.jsx" },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic", external: ["react", "react/jsx-runtime"], logLevel: "silent", platform: "node",
  plugins: [{ name: "stubs", setup(bb) {
    bb.onResolve({ filter: /.*/ }, (x) => { for (const k of Object.keys(STUBS).sort((p, q) => q.length - p.length)) if (x.path === k || x.path.endsWith("/" + k)) return { path: k, namespace: "stub" }; return null; });
    bb.onLoad({ filter: /.*/, namespace: "stub" }, (x) => ({ contents: STUBS[x.path], loader: "js" }));
    // the new component's dupeMatch starts from the test's value (same as the old wrapper) — and the teeth
    bb.onLoad({ filter: /AddCustomerModal\.jsx$/ }, (x) => {
      let s = readFileSync(x.path, "utf8");
      const from = "const [dupeMatch, setDupeMatch] = useState(null);";
      if (s.split(from).length !== 2) throw new Error("dupeMatch anchor");
      s = s.replace(from, "const [dupeMatch, setDupeMatch] = useState(globalThis.__cm.dupe);");
      if (TEETH) { const t = `{lang === "en" ? "Add New Customer" : "Ajouter un client"}`; if (s.split(t).length !== 2) throw new Error("teeth anchor"); s = s.replace(t, `{lang === "en" ? "Add new customer" : "Ajouter un client"}`); }
      return { contents: s, loader: "jsx" };
    });
  } }],
});
const M = await import("file:///" + OUT.replace(/\\/g, "/"));
rmSync(OUT, { force: true });
const r = (C, cfg, props = {}) => { globalThis.__cm = { lang: "en", dupe: null, posts: [], inval: [], ...cfg }; return renderToString(React.createElement(C, props)); };
for (const lang of ["en", "fr"]) for (const dupe of [null, { id: "c1", name: "Ngono Marie", phone: "677000002" }]) {
  const o = r(M.OldModal, { lang, dupe }), n = r(M.NewModal, { lang, dupe }, { existingVerb: "open", onClose() {}, onExisting() {} });
  let i = 0; while (i < o.length && o[i] === n[i]) i++;
  check(`${lang}${dupe ? " + same-phone match" : ""}: modal markup byte-identical to the base Customers page (${o.length} chars)`, o === n, `at ${i}: base …${o.slice(i - 40, i + 60)}… new …${n.slice(i - 40, i + 60)}…`);
}
// the sale screen's variant: only the duplicate offer's verb differs
{
  const dupe = { id: "c1", name: "Ngono Marie", phone: "677000002" };
  const n = r(M.NewModal, { lang: "en", dupe }, { existingVerb: "use", onClose() {}, onExisting() {} });
  check("sale screen variant: the duplicate offer says “Use Ngono Marie” (Customers page keeps “Open …”)", n.includes("Use Ngono Marie") && !n.includes("Open Ngono Marie"));
}
// the create logic: same body + same refreshes as the base page's addMutation
{
  r(M.NewModal, { lang: "en" }, { onClose() {}, onExisting() {} });
  const mu = globalThis.__cm.mutation;
  const src = readFileSync(resolve(SRC, "components/common/AddCustomerModal.jsx"), "utf8");
  const baseFn = oldPage.match(/mutationFn: \(\) => api\.post\("\/customers", \{ \.\.\.form, credit_limit: \+form\.credit_limit \|\| 0, total_debt: \+form\.total_debt \|\| 0 \}\)/);
  check("create: the same POST /customers body expression as the base page", !!baseFn && src.includes(baseFn[0]));
  await mu.mutationFn(); await mu.onSuccess({ data: { data: { id: "new" } } });
  check("create: the same three cache refreshes (customers, customer-summary, pos-customers)",
    JSON.stringify(globalThis.__cm.inval) === JSON.stringify(['["customers"]', '["customer-summary"]', '["pos-customers"]']), JSON.stringify(globalThis.__cm.inval));
  check("create: the same 409 CUSTOMER_PHONE_EXISTS handling", src.includes(`err.response?.status === 409 && err.response?.data?.code === "CUSTOMER_PHONE_EXISTS"`) && oldPage.includes(`err.response?.status === 409 && err.response?.data?.code === "CUSTOMER_PHONE_EXISTS"`));
}
console.log(`\n${fails ? `FAIL — ${fails} check(s) failed` : "PASS — the Customers page's Add Customer modal is unchanged"}${TEETH ? (fails ? "  (TEETH: red as required)" : "  (TEETH: STILL GREEN — no teeth!)") : ""}\n`);
process.exit(TEETH ? (fails ? 0 : 1) : (fails ? 1 : 0));
