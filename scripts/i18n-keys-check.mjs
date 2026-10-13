// LAUNCH-BATCH-2 — no raw translation keys on screen.
//
// useLangStore().t(key) returns THE KEY ITSELF when the dictionary has no entry, so a
// missing entry does not crash or warn — the user just reads "stock.arrivals" on a
// button (the dashboard's Quick Actions showed three of them, in both languages).
// This resolves every literal t("a.b") in src/ against BOTH dictionaries and fails on
// any key that is missing in either.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const dictSrc = readFileSync(join(SRC, "i18n/translations.js"), "utf8").replace("export const translations =", "return");
const translations = new Function(dictSrc)();

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p); } };
walk(SRC);

const KEY = /\bt\(\s*["']([A-Za-z_]+\.[A-Za-z_.]+)["']\s*\)/g;
const lookup = (lang, key) => key.split(".").reduce((v, p) => (v == null ? v : v[p]), translations[lang]);
const missing = [];
let used = 0;
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(KEY)) {
    used++;
    for (const lang of ["en", "fr"]) {
      if (typeof lookup(lang, m[1]) !== "string") {
        const line = s.slice(0, m.index).split("\n").length;
        missing.push(`${m[1]} [${lang}]  ${relative(SRC, f).replace(/\\/g, "/")}:${line}`);
      }
    }
  }
}
for (const x of missing) console.log("  FAIL  missing " + x);
console.log(missing.length ? `\n  ${missing.length} FAILED (of ${used} key uses)` : `\n  all passed (${used} key uses resolve in en + fr)`);
process.exit(missing.length ? 1 : 0);
