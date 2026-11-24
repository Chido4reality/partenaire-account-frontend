// TEST A FIX 3 (2026-11-23, Peter): the "Shift open since … — close it" warning is TAPPABLE and opens Close shift
// for that branch. Exercises the REAL ShiftAgeWarning (bundled with esbuild, called as a function — it has no hooks,
// so the returned element's props are exactly what React attaches): click, Enter and Space call onOpen; other
// keys do not; without onOpen it is a plain, non-focusable warning (no handlers); ≤ 24 h renders nothing.
// Then the two screens that show it must pass onOpen (bar floor → Close shift modal; Cash → the close request).
// Teeth: the same checks run on a copy with the handlers removed and must FAIL.
import { build } from "esbuild";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(HERE, "../src/components/bar/ShiftAgeWarning.jsx");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

async function load(srcFile, tag) {
  const out = resolve(HERE, `__shift_warning_${tag}.mjs`);
  await build({ entryPoints: [srcFile], outfile: out, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    logLevel: "silent", external: ["react", "react/jsx-runtime"] });
  try { return await import("file:///" + out.replace(/\\/g, "/") + `?t=${Date.now()}`); } finally { rmSync(out, { force: true }); }
}

const NOW = Date.parse("2026-11-24T10:00:00Z");
const OLD = { shift_id: "s1", opened_at: "2026-11-19T08:00:00Z" };          // 5 days
const FRESH = { shift_id: "s1", opened_at: "2026-11-24T08:00:00Z" };        // 2 h
const key = (k) => { let prevented = false; return { key: k, preventDefault: () => { prevented = true; }, get prevented() { return prevented; } }; };

function behaviour(W, label) {
  const res = [];
  let calls = 0; const onOpen = () => { calls++; };
  const el = W({ lang: "en", shift: OLD, now: NOW, onOpen });
  const p = (el && el.props) || {};
  res.push([`${label}: with onOpen → focusable (tabIndex 0) + spoken as a tap target`, p.tabIndex === 0 && /tap to close the shift/.test(p["aria-label"] || ""), `${p.tabIndex} ${p["aria-label"]}`]);
  calls = 0; try { p.onClick && p.onClick({}); } catch { /* */ }
  res.push([`${label}: click → opens Close shift once`, calls === 1, String(calls)]);
  for (const k of ["Enter", " "]) { calls = 0; const e = key(k); try { p.onKeyDown && p.onKeyDown(e); } catch { /* */ }
    res.push([`${label}: key ${JSON.stringify(k)} → opens it (and stops the page scrolling)`, calls === 1 && e.prevented, `${calls} ${e.prevented}`]); }
  calls = 0; try { p.onKeyDown && p.onKeyDown(key("a")); } catch { /* */ }
  res.push([`${label}: another key → nothing`, calls === 0, String(calls)]);
  const plain = W({ lang: "en", shift: OLD, now: NOW });
  const q = (plain && plain.props) || {};
  res.push([`${label}: without onOpen → a plain warning (no tabIndex, no handlers)`, !!plain && q.tabIndex === undefined && !q.onClick && !q.onKeyDown, Object.keys(q).join(",")]);
  res.push([`${label}: shift open ≤ 24 h → nothing shown`, W({ lang: "en", shift: FRESH, now: NOW, onOpen }) === null, ""]);
  const fr = W({ lang: "fr", shift: OLD, now: NOW, onOpen });
  res.push([`${label}: French tap name`, /touchez pour fermer le shift/.test((fr && fr.props && fr.props["aria-label"]) || ""), fr && fr.props && fr.props["aria-label"]]);
  return res;
}

console.log("── shift warning: the real component ──");
const real = await load(MOD, "real");
for (const [l, ok, d] of behaviour(real.default, "warning")) check(l, ok, d);

console.log("\n── the two screens pass onOpen ──");
const bar = readFileSync(resolve(HERE, "../src/pages/BarPage.jsx"), "utf8");
const cash = readFileSync(resolve(HERE, "../src/pages/ShiftsPage.jsx"), "utf8");
check("bar floor: <ShiftAgeWarning … onOpen> opens the Close shift modal", /<ShiftAgeWarning[^>]*onOpen=\{\(\) => setShowCloseShift\(true\)\}/.test(bar));
check("bar floor: the Close shift modal opens on that flag (for this bar's shift)", /<CloseShiftModal open=\{showCloseShift && [^}]*shift_id\)\} shift=\{shiftQ\.data\}/.test(bar));
check("Cash screen: <ShiftAgeWarning … onOpen> sends the close request", /<ShiftAgeWarning[^>]*onOpen=\{\(\) => setCloseReq\(/.test(cash));
check("Cash screen: the request reaches the shift widget", /<ActiveShiftIndicator[^>]*closeRequest=\{closeReq\}/.test(cash));

console.log("\n── teeth (handlers removed in a copy → must FAIL) ──");
const src = readFileSync(MOD, "utf8");
const mutated = src.replace(/onClick: onOpen, onKeyDown: \(e\) => \{[^}]*\}[^}]*\} /, "");
if (mutated === src) check("teeth: the mutation applied", false, "anchor not found");
else {
  const tmp = resolve(HERE, "__shift_warning_mut.jsx");
  writeFileSync(tmp, mutated);
  try { const m = await load(tmp, "mut"); const red = behaviour(m.default, "mutated").filter(([, ok]) => !ok).length;
    check("teeth: without the handlers the behaviour checks go red", red >= 3, `${red} failed`); }
  finally { rmSync(tmp, { force: true }); }
}

console.log(fails ? `\n${fails} FAILED` : "\n  ALL shift-warning tap checks passed");
process.exit(fails ? 1 : 0);
