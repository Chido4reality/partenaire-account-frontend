// Every marketer-facing string must have a French entry.
//
// i18n() falls back to the English key when a translation is missing. That is the
// right RUNTIME behaviour — a French marketer seeing one English word beats a
// crash or a raw key like "marketing.signups". But it is the wrong SHIPPING
// behaviour: without this gate, a forgotten translation looks identical to a
// deliberate one and nobody finds out until a marketer does.
//
// So: extract every i18n('…') literal from the REAL admin.html and require a
// MARKETER_FR entry for each. Also drives the real code both ways to prove the
// switch actually swaps the copy, rather than only checking the dictionary.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

console.log("\n── marketer French coverage ────────────────────────────────\n");

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let src = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
{
  const tr = src.trim(), open = tr.indexOf("(function () {"), close = tr.lastIndexOf("})();");
  if (open === 0 && close > 0) src = tr.slice("(function () {".length, close);
}

// Evaluate just the dictionary so the rig reads the SHIPPED table, not a copy.
const dictSrc = src.slice(src.indexOf("const MARKETER_FR = {"), src.indexOf("function i18n(s) {"));
const ctx = {};
vm.createContext(ctx);
new vm.Script(dictSrc + "\n;globalThis.__FR = MARKETER_FR;").runInContext(ctx);
const FR = ctx.__FR;
check("the French dictionary parses and is non-trivial", FR && Object.keys(FR).length > 30,
  `${Object.keys(FR || {}).length} entries`);

// Every i18n('literal') in the source must be covered.
const used = new Set();
for (const m of src.matchAll(/\bi18n\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) used.add(m[1].replace(/\\'/g, "'"));
// i18n(cond ? 'a' : 'b') — a ternary inside the call, which the simple form above
// cannot see. Missing these made two LIVE strings look like dead dictionary
// entries: the gate was wrong about the code, not the code about the gate.
for (const m of src.matchAll(/\bi18n\([^)]*?\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\)/g)) {
  used.add(m[1]);
  used.add(m[2]);
}
// data-i18n / data-i18n-ph attributes go through t() too.
for (const m of html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) used.add(m[1]);
check("marketer strings are actually wired through i18n()/data-i18n", used.size >= 30, `${used.size} strings`);

const missing = [...used].filter((k) => !Object.prototype.hasOwnProperty.call(FR, k));
check("EVERY wired string has a French entry", missing.length === 0,
  missing.length ? missing.slice(0, 6).map((s) => `"${s.slice(0, 40)}"`).join(" | ") : "none missing");

// Unused dictionary entries are dead weight and usually a rename that half-landed.
const unused = Object.keys(FR || {}).filter((k) => !used.has(k));
check("no orphaned dictionary entries (a half-finished rename)", unused.length === 0,
  unused.length ? unused.slice(0, 6).join(" | ") : "none");

// Translations must differ from the English, or the entry is a placeholder.
const okSameSrc = src.slice(src.indexOf("MARKETER_FR_IDENTICAL_OK"));
const okSame = new Set(
  (okSameSrc.slice(okSameSrc.indexOf("[") + 1, okSameSrc.indexOf("]")) || "")
    .split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean));
const identical = Object.entries(FR || {}).filter(([k, v]) => k === v && !okSame.has(k));
check("no French entry is a placeholder copy of the English (allowlist aside)", identical.length === 0,
  identical.map(([k]) => k).slice(0, 4).join(" | ") || "none");

// ── drive the REAL i18n() both ways ───────────────────────────────────────────
const tSrc = src.slice(src.indexOf("const ADMIN_LANG_KEY"), src.indexOf("function setAdminLang"));
const c2 = {
  localStorage: { getItem: () => "fr", setItem() {} },
  navigator: { language: "fr-CM" },
};
vm.createContext(c2);
new vm.Script(tSrc + "\n;globalThis.__t = i18n;").runInContext(c2);
check("with lang=fr, 'Signups' becomes 'Inscriptions'", c2.__t("Signups") === "Inscriptions", c2.__t("Signups"));
check("…an unknown string degrades to English, never to a blank or a key",
  c2.__t("Some untranslated thing") === "Some untranslated thing", c2.__t("Some untranslated thing"));

const c3 = { localStorage: { getItem: () => "en", setItem() {} }, navigator: { language: "en-GB" } };
vm.createContext(c3);
new vm.Script(tSrc + "\n;globalThis.__t = i18n;").runInContext(c3);
check("with lang=en, English is returned unchanged", c3.__t("Signups") === "Signups", c3.__t("Signups"));

// A French browser with no stored choice should land in French.
const c4 = { localStorage: { getItem: () => null, setItem() {} }, navigator: { language: "fr-CM" } };
vm.createContext(c4);
new vm.Script(tSrc + "\n;globalThis.__t = i18n;").runInContext(c4);
check("a French browser defaults to French with no stored preference",
  c4.__t("Signups") === "Inscriptions", c4.__t("Signups"));

// ── the translator must never be SHADOWED ──────────────────────────────────
// This already happened: `const t = mmData.team_total` inside loadMyMarketing
// shadowed the translator for that whole function body, so every call hit the
// object instead. It parsed fine and only surfaced when the render rig ran it.
// The translator was renamed t -> i18n because `t` collides with nine unrelated
// `const t =` declarations in this file; this keeps the new name clean.
const shadows = [...src.matchAll(/(?:const|let|var)\s+i18n\s*=|function\s*\([^)]*\bi18n\b/g)].map((m) => m[0]);
check("nothing shadows the i18n translator", shadows.length === 0, shadows.slice(0, 3).join(" | ") || "no shadows");

// ── applyMarketingLang actually rewrites the STATIC markup ──────────────────
// The dictionary and i18n() can both be perfect while the static labels stay
// English, because those go through data-i18n attributes and a DOM walk rather
// than through a call. Drive that walk against real elements.
const applySrc = src.slice(src.indexOf("function applyMarketingLang"),
  src.indexOf("}", src.indexOf("if (btn) btn.textContent")) + 1);
const mkEl = (attrs) => ({
  _a: attrs, textContent: "", _ph: "",
  getAttribute: (k) => (k in attrs ? attrs[k] : null),
  setAttribute(k, v) { if (k === "placeholder") this._ph = v; },
});
const label = mkEl({ "data-i18n": "Paying customers" });
const input = mkEl({ "data-i18n-ph": "Amount" });
const toggle = mkEl({});
const host = {
  querySelectorAll: (sel) =>
    sel === "[data-i18n]" ? [label] : sel === "[data-i18n-ph]" ? [input] : [],
};
const c5 = {
  localStorage: { getItem: () => "fr", setItem() {} },
  navigator: { language: "fr-CM" },
  $: (id) => (id === "route-my-marketing" ? host : id === "mm-lang-toggle" ? toggle : null),
};
vm.createContext(c5);
new vm.Script(tSrc + applySrc + "\n;globalThis.__apply = applyMarketingLang;").runInContext(c5);
c5.__apply();
check("a static label is rewritten in French", label.textContent === "Clients payants", label.textContent);
check("a placeholder is rewritten in French", input._ph === "Montant", input._ph);
check("the toggle offers the OTHER language, not the current one",
  toggle.textContent === "English", toggle.textContent);


console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} marketer i18n checks\n`);
process.exit(fails === 0 ? 0 : 1);
