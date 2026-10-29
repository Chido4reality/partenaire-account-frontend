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
check("a virtual store is still never a SOURCE (the source list goes through allowedSourceLocations)",
  /\{sourceLocations\.map\(l => <option/.test(tp) && /const sourceLocations = allowedSourceLocations\(locations, allowedSrcIds\);/.test(tp));
check("who may create one is unchanged: owner, or a manager granted it, in Warehouse Mode only",
  /if \(!wh\) return false;\s*if \(role === "owner"\) return true;\s*return role === "manager" && !!perms && perms\.can_create_virtual_stores === true;/.test(nv));

// ── 3. New Transfer SOURCE: only where this user may send from (Peter's hand test 2026-10-29) ──
// Ware Keeper is pinned to Bonaberri (a shop); Magasin Test → Smoke Depot was refused only at Confirm.
const { allowedSourceLocations } = await import(pathToFileURL(resolve(SRC, "utils/locations.js")).href);
// workMode.js imports the store (not loadable in plain Node): take its VIEW_PATHS regex from the source.
const vpSrc = /const VIEW_PATHS = (\/.+\/);\n/.exec(read("utils/workMode.js"));
const VIEW_RE = vpSrc ? new Function(`return ${vpSrc[1]};`)() : /$^/;
const takesWarehouseView = (p) => VIEW_RE.test(p);
const POS = [
  { id: "bon", name: "Bonaberri", type: "shop", kind: null },
  { id: "wh", name: "Magasin Test", type: "warehouse", kind: null },
  { id: "buf", name: "Zone tampon", type: "warehouse", kind: "goods_buffer" },
  { id: "v", name: "Smoke Depot", type: "shop", kind: "virtual" },
];
check("source list = the server's allowed ids (pinned to Bonaberri → Bonaberri only)", ids(allowedSourceLocations(POS, ["bon"])) === "bon");
check("…the OLD list offered Magasin Test, which the server refuses", ids(withoutVirtualStores(POS)).includes("wh"));
check("…never a virtual store, even if listed as allowed", ids(allowedSourceLocations(POS, ["v", "wh"])) === "wh");
check("…no server answer (offline / older server) → today's list", ids(allowedSourceLocations(POS, null)) === "bon,wh,buf");
check("…an empty answer → an empty list (not today's list)", allowedSourceLocations(POS, []).length === 0);
check("the request carries the warehouse view in Warehouse Mode (hidden shops left out by the server)",
  takesWarehouseView("/transfers/allowed-sources") && takesWarehouseView("/transfers") && !takesWarehouseView("/transfers/reserved"));
check("TransfersPage asks the server, keyed by mode",
  /api\.get\("\/transfers\/allowed-sources"\)/.test(tp) && /queryKey: \["transfers-allowed-sources", wh \? "wh" : "pos"\]/.test(tp));

// ── 4. Warehouse Mode, assigned to a hidden shop: a clear message, not an empty form ──
check("assigned to a hidden shop with nothing to send from → the message replaces step 1",
  /const assignedShopHidden = wh && !!srcData\?\.data\?\.assigned_hidden && !!allowedSrcIds && sourceLocations\.length === 0;/.test(tp)
  && /\{step === 1 && assignedShopHidden && \(/.test(tp) && /\{step === 1 && !assignedShopHidden && \(/.test(tp));
check("…in both languages", /is a shop\. Ask the owner to assign you to a warehouse, or switch to POS Mode\./.test(tp)
  && /est une boutique\. Demandez au patron de vous affecter à un entrepôt, ou passez en Mode Caisse\./.test(tp));

// ── 5. Settings → Staff in Warehouse Mode: move a shop-assigned staffer to a warehouse directly ──
const st = read("pages/SettingsPage.jsx");
check("the read-only 'Set in POS Mode' box is gone", !/\{lang === "en" \? "Set in POS Mode" : "À définir en Mode Caisse"\}/.test(st));
check("…replaced by a select: the current shop (kept) + the warehouses only",
  /data-testid="wh-assign-from-shop" value=\{staffForm\.assigned_location_id\}/.test(st)
  && /<option value=\{staffForm\.assigned_location_id\}>/.test(st)
  && /locations\.filter\(l => l\.type === "warehouse" && !isGoodsBuffer\(l\) && !isVirtualStore\(l\)\)\.map/.test(st));

// ── 6. The owner's approve dialog (Peter's hand test 2026-10-29) ──
const al = read("pages/AccountantLogPage.jsx"), ta = read("pages/TeamApprovalsPage.jsx"), apiSrc = read("utils/api.js");
check("approve waits up to 30 s (it can carry the action out; 6 s gave up while the server finished)",
  /else if \(\/\^\\\/staff\\\/approvals\\\/\[\^\/\]\+\\\/\(approve\|reject\|finalize\)\\\/\?\$\/\.test\(_p\)\) config\.timeout = 30000;/.test(apiSrc));
check("one decision per request: a second tap is dropped while the first is in flight",
  /if \(approveInFlight\.current\) return;/.test(al) && /onSettled: \(\) => \{ approveInFlight\.current = false; \}/.test(al)
  && /onClick=\{\(\) => submitApprove\(\{ id: pinFor\.id/.test(al) && !/onClick=\{\(\) => approveMut\.mutate\(/.test(al));
check("already executed → 'Already approved and done' (FR/EN), dialog closed — not a red error (both screens)",
  /\(en \? "Already approved and done" : "Déjà approuvé et exécuté"\)/.test(al) && /closeApproveDialog\(\);\s*return;/.test(al)
  && /\(en \? "Already approved and done\." : "Déjà approuvé et exécuté\."\)/.test(ta));
check("virtual-store transfer: 'sends the goods out now' with the real names, FR + EN (not 'green light')",
  /Approving sends the goods out now: stock leaves \$\{from\} immediately\. \$\{to\} is a virtual store and keeps no stock\./.test(al)
  && /Approuver fait sortir la marchandise maintenant : le stock quitte \$\{from\} immédiatement\. \$\{to\} est un magasin virtuel et ne garde aucun stock\./.test(al)
  && /pinFor\.virtual_destination === true/.test(al) && /pinFor\.virtual_transfer\?\.from_name/.test(al));

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
