// WHO SEES COST (2026-10-08) — the below-cost popup when the floor IS the cost.
// The server now sends min_price: null to a cashier (or ungranted manager) when no
// min_price is set and the floor would be the cost. The popup must then say "below
// the minimum price" with NO amounts — not "below 0" / "You lose 0" — and keep the
// old wording when a real floor is sent.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "__below_cost_floor.mjs");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");
await build({ entryPoints: [resolve(HERE, "../src/components/common/BelowCostLossDetail.jsx")], outfile: OUT, bundle: true,
  format: "esm", platform: "node", jsx: "automatic", logLevel: "silent", external: ["react", "react/jsx-runtime"] });

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const fmt = (n) => `XAF ${Number(n)}`;
const text = (el) => renderToString(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
try {
  const { default: D } = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const hidden = text(React.createElement(D, { payload: { below_cost: [{ name: "Pneu", unit_price: 500, min_price: null, qty: 1 }] }, en: true, fmt, cashier: "Kusi" }));
  check("floor withheld → 'below the minimum price', no amount but the cashier's own price", /below the minimum price\./.test(hidden) && !/XAF 0|lose|Total loss/.test(hidden), hidden);
  const shown = text(React.createElement(D, { payload: { below_cost: [{ name: "Huile", unit_price: 700, min_price: 800, qty: 1 }] }, en: true, fmt, cashier: "Kusi" }));
  check("real floor sent → unchanged wording with floor, loss and total", /minimum price of XAF 800/.test(shown) && /You lose XAF 100/.test(shown) && /Total loss: XAF 100/.test(shown), shown);
  const fr = text(React.createElement(D, { payload: { below_cost: [{ name: "Pneu", unit_price: 500, min_price: null, qty: 1 }] }, en: false, fmt, cashier: "Kusi" }));
  check("French: 'en dessous du prix minimum', no amount", /en dessous du prix minimum\./.test(fr) && !/perdez|Perte totale/.test(fr), fr);
} catch (e) { fails++; console.log(`  FAIL  threw: ${e.message}`); }
finally { rmSync(OUT, { force: true }); }
console.log(`\n${fails ? `FAIL (${fails})` : "PASS"}`);
process.exit(fails ? 1 : 0);
