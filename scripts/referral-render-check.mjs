// MP-REFERRAL-LINK — the browser half.
//
// Renders the REAL RegisterPage at /register?code=… and asserts what a visitor
// following a marketer's link actually sees.
//
// This is only testable because the code is derived DURING RENDER rather than
// in a useEffect: effects never run under renderToString, so an effect-based
// prefill would leave this harness rendering an empty, unlocked field while
// reporting success. That trap has bitten this codebase before.
//
// It proves the link path and the lock. It cannot prove the submit path — that
// needs a live server, which scripts/referral-link-check.mjs (backend) covers.

import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TMP = resolve(HERE, "__refstub");
const OUT = resolve(HERE, "__register.mjs");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

mkdirSync(TMP, { recursive: true });
writeFileSync(resolve(TMP, "store.js"), `
  export const useAuthStore = () => ({ login(){} });
  export const useLangStore = () => ({ lang: globalThis.__LANG || "en" });
`);
writeFileSync(resolve(TMP, "api.js"), `export default { get: async () => ({ data: { data: [] } }), post: async () => ({ data: {} }) };`);
writeFileSync(resolve(TMP, "setLanguage.js"), `export const setLanguageLocalPending = () => {};`);

await build({
  entryPoints: [resolve(ROOT, "src/pages/RegisterPage.jsx")],
  outfile: OUT, bundle: true, format: "esm", jsx: "automatic", logLevel: "silent",
  external: ["react", "react-dom", "react-router-dom", "react-hot-toast"],
  // esbuild's `alias` option rejects relative specifiers, so redirect by
  // suffix with a resolve plugin, the way mount-check does.
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /(?:store|api|setLanguage)$/ }, (args) => {
        if (args.path.endsWith("/store")) return { path: resolve(TMP, "store.js") };
        if (args.path.endsWith("utils/api")) return { path: resolve(TMP, "api.js") };
        if (args.path.endsWith("utils/setLanguage")) return { path: resolve(TMP, "setLanguage.js") };
        return null;
      });
    },
  }],
});
const mod = await import("file://" + OUT.replace(/\\/g, "/"));
const RegisterPage = mod.default;
const { referralCodeFromQuery } = mod;

// react-router calls useLayoutEffect, which React warns about under
// renderToString. It is noise from a dependency, not a signal about this page —
// but only THAT warning is swallowed, so a genuine React warning (a missing
// key, a bad prop) still reaches the console and is still visible.
const realError = console.error;
console.error = (...a) => {
  if (/useLayoutEffect does nothing on the server/.test(String(a[0]))) return;
  realError(...a);
};

const render = (url, lang) => {
  globalThis.__LANG = lang || "en";
  return renderToString(
    React.createElement(MemoryRouter, { initialEntries: [url] },
      React.createElement(RegisterPage))
  );
};

console.log("\n── referral link: what the visitor sees ────────────────────\n");

// ── the pure sanitiser, tested directly ─────────────────────────────────────
const sp = (q) => new URLSearchParams(q);
check("?code= is read", referralCodeFromQuery(sp("code=KARO234")) === "KARO234");
check("?ref= is accepted too", referralCodeFromQuery(sp("ref=JOR237")) === "JOR237");
check("lowercase is normalised", referralCodeFromQuery(sp("code=karo234")) === "KARO234");
check("punctuation is stripped", referralCodeFromQuery(sp("code=KA-RO_234!")) === "KARO234");
check("markup cannot survive", !/[<>"'/=]/.test(referralCodeFromQuery(sp("code=%3Cimg%20src%3Dx%3E"))),
  referralCodeFromQuery(sp("code=<img src=x>")));
check("a too-short code is ignored (not a 1-char 'code')", referralCodeFromQuery(sp("code=A")) === "");
check("over-long input is clamped to 20", referralCodeFromQuery(sp("code=" + "A".repeat(40))).length === 20);
check("no param yields nothing", referralCodeFromQuery(sp("")) === "");

// ── a VALID link ────────────────────────────────────────────────────────────
const linked = render("/register?code=KARO234");
check("the code is prefilled into the field", /value="KARO234"/.test(linked),
  (linked.match(/value="[A-Z0-9]{3,20}"/) || [])[0] || "not found");
check("the field is LOCKED (readonly)", /data-testid="promo-input"[^>]*readonly/i.test(linked)
  || /readonly[^>]*data-testid="promo-input"/i.test(linked));
check("the banner says WILL BE applied, not 'applied'",
  /will be applied when you create your account/i.test(linked) && !/KARO234 applied/i.test(linked));
check("the banner names the code", /Referral code KARO234/.test(linked));
check("a Change affordance is offered (a bad link is not a trap)",
  /data-testid="promo-change"/.test(linked));

// ── no link: unchanged behaviour ────────────────────────────────────────────
const plain = render("/register");
check("without a link the field is EMPTY and editable",
  !/data-testid="promo-input"[^>]*readonly/i.test(plain) && !/Referral code/.test(plain));
check("…and no banner is shown", !/promo-banner/.test(plain));

// ── junk in the link degrades to the normal form, never a broken page ───────
const junk = render("/register?code=%3Cscript%3E");
check("a junk code does not lock the field or crash the page",
  junk.length > 500 && !/Referral code\s*<\/span>/.test(junk), junk.length + " chars");
check("…and no script tag reaches the DOM", !/<script/i.test(junk));

// ── bilingual ───────────────────────────────────────────────────────────────
const fr = render("/register?code=KARO234", "fr");
check("French: the banner is translated", /Code de parrainage KARO234/.test(fr));
check("French: 'sera appliqué', still not a claim of success",
  /sera appliqué/.test(fr) && !/appliqué\./.test(fr.replace(/sera appliqué[^<]*/g, "")));
check("French: the Change affordance is 'Modifier'", /Modifier/.test(fr));

// ── the link a Copy button produces round-trips ─────────────────────────────
const shared = "https://pos.partenairedozie.com/register?code=" + encodeURIComponent("KARO234");
const path = shared.replace("https://pos.partenairedozie.com", "");
const pasted = render(path);
check("pasting the SHARED url renders the locked, prefilled state",
  /Referral code KARO234/.test(pasted) && /value="KARO234"/.test(pasted), path);

try { rmSync(OUT, { force: true }); rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} referral render checks\n`);
process.exit(fails === 0 ? 0 : 1);
