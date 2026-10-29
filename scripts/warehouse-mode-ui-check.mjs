// WAREHOUSE MODE — the SCREEN half of Peter's staging hand test (2026-10-29). Light: plain Node, no build.
//   1. a virtual store never appears in a stock / inventory location picker (Inventory, Count, Stock
//      Check, Goods Buffer release) — only as a transfer destination and in Settings → Locations
//   2. New Transfer: "+ New virtual store" is an option INSIDE the destination dropdown (owner /
//      allowed manager), and choosing it opens the name field instead of selecting a location
// Each block also re-derives the OLD behaviour and shows it was the leak, so a revert fails.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const read = (p) => readFileSync(resolve(SRC, p), "utf8");
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`); };

// ── 1. the helper, run on a warehouse-view list ────────────────────────────────
const { withoutVirtualStores, withoutGoodsBuffer } = await import(pathToFileURL(resolve(SRC, "utils/locations.js")).href);
const LIST = [
  { id: "wh", name: "Magasin Test", type: "warehouse", kind: null },
  { id: "buf", name: "Zone tampon", type: "warehouse", kind: "goods_buffer" },
  { id: "v", name: "Smoke Depot", type: "shop", kind: "virtual" },
];
const ids = (l) => l.map((x) => x.id).join(",");
check("withoutVirtualStores drops the virtual store, keeps warehouse + buffer", ids(withoutVirtualStores(LIST)) === "wh,buf", ids(withoutVirtualStores(LIST)));
check("…and the OLD raw list is the leak (it holds Smoke Depot)", LIST.some((l) => l.kind === "virtual"));
check("withoutVirtualStores is safe on a non-array (offline cache shape drift)", Array.isArray(withoutVirtualStores(undefined)) && withoutVirtualStores(null).length === 0);
check("withoutGoodsBuffer (Receive Goods, Restock, Check Expiry/Low) already drops virtual stores", ids(withoutGoodsBuffer(LIST)) === "wh");

// ── 1b. every stock picker uses it ──────────────────────────────────────────────
const PICKERS = [
  ["Inventory", "pages/InventoryPage.jsx", /const locations = withoutVirtualStores\(locationsData\?\.data \|\| \[\]\);/, /const locations = locationsData\?\.data \|\| \[\];/],
  ["Count", "pages/StockCountPage.jsx", /const locations = withoutVirtualStores\(locData\?\.data \|\| \[\]\);/, /const locations = locData\?\.data \|\| \[\];/],
  ["Stock Check (search)", "pages/StockCheckPage.jsx", /const locList = withoutVirtualStores\(Array\.isArray\(locs\.data\?\.data\) \? locs\.data\.data : \[\]\);/, /const locList = Array\.isArray\(locs\.data\?\.data\) \? locs\.data\.data : \[\];/],
  ["Goods Buffer release", "pages/GoodsBufferPage.jsx", /const locList = withoutVirtualStores\(Array\.isArray\(locsQ\.data\?\.data\) \? locsQ\.data\.data : \[\]\);/, /const locList = Array\.isArray\(locsQ\.data\?\.data\) \? locsQ\.data\.data : \[\];/],
];
for (const [name, file, fixed, old] of PICKERS) {
  const s = read(file);
  check(`${name}: location list leaves out virtual stores`, fixed.test(s) && !old.test(s));
}
const sc = read("pages/StockCheckPage.jsx"), rs = read("pages/RestockPage.jsx"), ex = read("pages/CheckExpiryLowPage.jsx");
check("Stock Check (main), Restock, Check Expiry/Low go through withoutGoodsBuffer (virtual-free)",
  /withoutGoodsBuffer\(Array\.isArray\(locs\.data\?\.data\)/.test(sc) && /withoutGoodsBuffer\(Array\.isArray\(locs\.data\?\.data\)/.test(rs) && /withoutGoodsBuffer\(Array\.isArray\(locsQ\.data\?\.data\)/.test(ex));

// ── 2. New Transfer: the dropdown option ────────────────────────────────────────
const tp = read("pages/TransfersPage.jsx"), nv = read("components/common/NewVirtualStoreButton.jsx");
check("destination dropdown ends with a '+ New virtual store' option, only for who may create one",
  /\{canNewVirtual && <option value=\{NEW_VIRTUAL\}>\+ \{lang === "en" \? "New virtual store" : "Nouveau magasin virtuel"\}<\/option>\}/.test(tp)
  && /const canNewVirtual = useCanCreateVirtualStore\(\);/.test(tp));
check("choosing it opens the name field and never becomes the destination",
  /onChange=\{e => \{ if \(e\.target\.value === NEW_VIRTUAL\) setNewVirtualOpen\(true\); else setToLoc\(e\.target\.value\); \}\}/.test(tp)
  && /open=\{newVirtualOpen\} onOpenChange=\{setNewVirtualOpen\}/.test(tp));
check("…the button takes that open state (controlled) and still works on its own (Settings)",
  /const open = openProp \?\? openState;/.test(nv) && /if \(onOpenChange\) onOpenChange\(v\);/.test(nv));
check("…a new store is selected as the destination once created", /onCreated=\{\(loc\) => setToLoc\(loc\.id\)\}/.test(tp));
check("a virtual store is still never a SOURCE", /locations\.filter\(l => !isVirtualStore\(l\)\)\.map\(l => <option/.test(tp));
check("who may create one is unchanged: owner, or a manager granted it, in Warehouse Mode only",
  /if \(!wh\) return false;\s*if \(role === "owner"\) return true;\s*return role === "manager" && !!perms && perms\.can_create_virtual_stores === true;/.test(nv));

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
