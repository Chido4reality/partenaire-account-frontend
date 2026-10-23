// PRICE ORDER (Peter, 2026-10-23) — the app's copy of the rule, and where it is wired.
//
// cost ≤ min ≤ wholesale ≤ sell, 0 = not set, the owner included. The server (backend
// src/lib/priceRules.js) is the real guard; this copy shows the SAME refusal under the price boxes
// before submit. So the strings below are the backend unit test's strings, word for word — a
// drift between the two copies fails here. Paul's two prod rows are the first cases.
// Also drives the REAL import parser (a bad row is listed with the fix, never sent).
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__price_order.mjs");
const XLSX = createRequire(import.meta.url)("xlsx");
await build({
  stdin: { contents: `export * from "./utils/priceRules.js"; export { parseProductImport } from "./utils/productImport.js";`, resolveDir: SRC, loader: "js" },
  bundle: true, format: "esm", platform: "node", outfile: OUT, logLevel: "silent", external: ["xlsx"],
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail !== "" ? `  [${detail}]` : ""}`); };
const P = (cost, min, wholesale, sell) => ({ cost_price: cost, min_price: min, wholesale_price: wholesale, sell_price: sell });
const fmt = (n) => `${new Intl.NumberFormat("fr-CM").format(n)} FCFA`;

try {
  const R = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const { priceOrderViolation: V, priceOrderMessage: M, priceOrderText: T, mergePrices } = R;

  console.log("the rule (same cases and strings as the backend's test-price-rules.js)");
  let v = V(P(400, 450, 100, 1000)), m = M(v, { fmt });
  check("Brake Cable: wholesale 100 < min 450 → EN", m.en === "Wholesale 100 FCFA is below Min 450 FCFA. Raise Wholesale to at least 450 FCFA.", m.en);
  check("…FR", m.fr === "Le prix de gros (100 FCFA) est inférieur au prix minimum (450 FCFA). Augmentez le prix de gros à au moins 450 FCFA.", m.fr);
  v = V(P(13400, 14000, 14500, 5000));
  check("Tyre 350-16: sell 5000 refused, no 'lower Wholesale' offered", v && v.field === "sell_price" && !/lower/.test(M(v, { fmt }).en));
  m = M(V(P(0, 350, 300, 0)), { fmt: String });
  check("Peter's example wording", m.en === "Wholesale 300 is below Min 350. Raise Wholesale to at least 350, or lower Min to 300 or less.", m.en);
  check("wholesale above sell refused", V(P(100, 200, 900, 800))?.field === "sell_price");
  check("cost above min refused", V(P(500, 400, 0, 0))?.field === "min_price");
  check("0 / empty / null = not set", V(P(0, "", null, 1000)) === null);
  const np = mergePrices(P(13400, 14000, 14500, 16000), { cost_price: 15000 });
  m = M(V(np), { fmt: String, newCost: true, prices: np });
  check("new cost 15000 > min 14000 (Receive Goods / buffer) → Peter's wording",
    m.en === "New cost 15000 is above Min 14000. Raise Min (and Wholesale if needed) to at least 15000 in this form, then save.", m.en);
  check("…FR", m.fr === "Le nouveau prix d'achat (15000) est supérieur au prix minimum (14000). Augmentez le prix minimum (et le prix de gros si besoin) à au moins 15000 dans ce formulaire, puis enregistrez.", m.fr);

  console.log("\nwho can make the fix (Peter, 2026-10-23) — same strings as the backend test");
  const { editablePrices: E } = R;
  check("Receive Goods rights: owner + manager all four, accountant cost/wholesale/walk-in, warehouse cost",
    E("manager", "receive-goods").length === 4 && E("accountant", "receive-goods").join() === "cost_price,wholesale_price,sell_price"
    && E("warehouse", "receive-goods").join() === "cost_price" && E("owner", "receive-goods").length === 4);
  const rise = mergePrices(P(13400, 14000, 14500, 16000), { cost_price: 15000 });
  m = M(V(rise), { fmt: String, newCost: true, prices: rise, editable: E("warehouse", "receive-goods") });
  check("warehouse on a cost rise: ask the owner or a manager (EN)",
    m.en === "New cost 15000 is above Min 14000. Ask the owner or a manager to raise Min (and Wholesale if needed) to at least 15000 first, then receive again.", m.en);
  check("…FR", m.fr === "Le nouveau prix d'achat (15000) est supérieur au prix minimum (14000). Demandez au propriétaire ou à un gérant d'augmenter d'abord le prix minimum (et le prix de gros si besoin) à au moins 15000, puis réceptionnez à nouveau.", m.fr);
  m = M(V(rise), { fmt: String, newCost: true, prices: rise, editable: E("manager", "receive-goods") });
  check("manager on a cost rise: 'Raise Min … in this form'", /Raise Min \(and Wholesale if needed\) to at least 15000 in this form, then save\.$/.test(m.en), m.en);
  m = M(V(P(13400, 14000, 14500, 5000)), { fmt: String });
  check("labels: 'Walk-in' / 'prix détail'", /^Walk-in 5000 is below Wholesale 14500\./.test(m.en) && /^Le prix détail \(5000\)/.test(m.fr), `${m.en} | ${m.fr}`);
  const inv0 = readFileSync(resolve(SRC, "pages/InventoryPage.jsx"), "utf8");
  check("Receive Goods screen uses the same rights table (manager may set Min there)", /const receivePriceFields = editablePrices\(role, "receive-goods"\);/.test(inv0)
    && /newCost: true, editable: receivePriceFields/.test(inv0));

  console.log("\npriceOrderText — what the boxes show");
  const brake = P(400, 450, 100, 1000);
  check("Edit: the stored broken prices re-sent unchanged (name edit) → no message", T({ ...brake }, { lang: "en", fmt, current: brake }) === null);
  check("Edit: any price change on it → the broken wholesale is named", /^Wholesale 100 FCFA is below Min 450 FCFA/.test(T({ ...brake, sell_price: 1100 }, { lang: "en", fmt, current: brake }) || ""));
  check("Receive Goods: only cost typed, above min → 'New cost … in this form' (FR)",
    /^Le nouveau prix d'achat \(15.000 FCFA\) est supérieur au prix minimum \(14.000 FCFA\)/.test(T({ cost_price: 15000 }, { lang: "fr", fmt, current: P(13400, 14000, 14500, 16000), newCost: true }) || ""));
  check("…and raising min + wholesale in the same form clears it",
    T({ cost_price: 15000, min_price: 15000, wholesale_price: 15500 }, { lang: "en", fmt, current: P(13400, 14000, 14500, 16000), newCost: true }) === null);
  check("Add (no current row): a good ladder → null", T(P(400, 450, 600, 1000), { lang: "en", fmt }) === null);
  // BUG 2026-10-23 (Peter's live test): "Upper arm" 200/350/300/400 released with its prefilled, unchanged prices
  const upper = P(200, 350, 300, 400);
  check("Release / Receive (always): an already-broken product with UNCHANGED prices → the message",
    T({ ...upper }, { lang: "en", fmt, current: upper, newCost: true, always: true }) === "Wholesale 300 FCFA is below Min 350 FCFA. Raise Wholesale to at least 350 FCFA, or lower Min to 300 FCFA or less.");
  check("…and with NO price sent at all (blank boxes)", /^Wholesale 300 FCFA is below Min 350 FCFA/.test(T({}, { lang: "en", fmt, current: upper, always: true }) || ""));
  check("…fixed in the same window → null", T({ ...upper, wholesale_price: 350 }, { lang: "en", fmt, current: upper, always: true }) === null);
  check("Edit keeps the change-only check (name edit on a broken product saves)", T({ ...upper }, { lang: "en", fmt, current: upper }) === null);
  const gbp = readFileSync(resolve(SRC, "pages/GoodsBufferPage.jsx"), "utf8"), invp = readFileSync(resolve(SRC, "pages/InventoryPage.jsx"), "utf8");
  check("the release window and Receive Goods both use always: true", /current: releaseCurrent, newCost: true, always: true/.test(gbp)
    && /editable: receivePriceFields, always: true/.test(invp));

  console.log("\nimport — a bad row is listed with the fix and never sent");
  const csv = ["name,cost_price,walk_in_price,wholesale_price,min_price,qty,location",
    "Brake Cable,400,1000,100,450,5,Boutique",       // row 2
    "Tyre 350-16,13400,5000,,14000,2,Boutique",      // row 3
    "Good one,400,1000,600,450,1,Boutique"].join("\n");   // row 4
  const bytes = new TextEncoder().encode(csv);
  const file = { name: "p.csv", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const { rows } = await R.parseProductImport(file, [{ id: "loc", name: "Boutique" }], XLSX);
  const row = (n) => rows.find((r) => r._rowNum === n);
  check("row 2 (Brake) not ok: 'Wholesale 100 is below Min 450. Raise Wholesale to at least 450.'",
    row(2) && !row(2).ok && row(2).errors.some((e) => e.en === "Wholesale 100 is below Min 450. Raise Wholesale to at least 450."), JSON.stringify(row(2) && row(2).errors));
  check("row 3 (Tyre) not ok, FR names prix détail / prix minimum (the box's own words)",
    row(3) && !row(3).ok && row(3).errors.some((e) => /^Le prix détail \(5000\) est inférieur au prix minimum \(14000\)/.test(e.fr)), JSON.stringify(row(3) && row(3).errors));
  check("row 4 (good) ok", row(4) && row(4).ok, JSON.stringify(row(4) && row(4).errors));

  console.log("\nwiring");
  const inv = readFileSync(resolve(SRC, "pages/InventoryPage.jsx"), "utf8");
  const buf = readFileSync(resolve(SRC, "pages/GoodsBufferPage.jsx"), "utf8");
  check("Add: handleAddProduct refuses on priceOrderError", /const handleAddProduct = \(\) => \{[\s\S]{0,120}priceOrderError\(newProduct\)/.test(inv));
  check("Rapid Entry: the mutation refuses before POST (button + both Enter keys)", /const rapidMutation[\s\S]{0,900}priceOrderError\(rapidItem\)[\s\S]{0,300}api\.post\("\/products"/.test(inv));
  check("Edit: the save button checks against the prices as stored (editBase)", /priceOrderError\(editProduct, \{ current: editBase, editable: editablePrices\(role, "product-edit"\) \}\); if \(e\) \{ toast\.error\(e\); return; \}/.test(inv));
  check("all three price boxes show the message live", (inv.match(/<PricingSection [^\n]*error=\{priceOrderError\(/g) || []).length === 3);
  const recv = inv.slice(inv.indexOf("const receiveMutation"), inv.indexOf("// ── RAPID ENTRY MUTATION"));
  check("Receive Goods: ONE request — the per-product PATCH is gone, prices ride the arrival",
    recv.length > 0 && !/api\.patch\(/.test(recv) && /\.\.\.receivePriceChanges\(i\)/.test(recv) && /price_source: "receive-goods"/.test(recv));
  check("Receive Goods: refuses before sending, each line shows its message", /receivePriceError\(i\)/.test(recv) && /priceError=\{receivePriceError\(item\)\}/.test(inv));
  check("Buffer release: refuses before sending + shows the message", /if \(priceErr\) return toast\.error\(priceErr\);/.test(buf) && /\{priceErr && \(/.test(buf));
  check("Prices to check + history are owner-only", /enabled: isOwner,/.test(inv) && /\{isOwner && <PriceHistoryList /.test(inv));
} finally {
  rmSync(OUT, { force: true });
}
console.log(fails ? `\n  ${fails} FAILED` : "\n  all passed");
process.exit(fails ? 1 : 0);
