// BAR CART FIX — teeth for scripts/bar-fit/branch-cart.mjs. Each set is applied to a COPY inside the
// bundle (bundle.mjs `mutate`); the tree is never touched, and an anchor that is not found exactly once
// makes the bundle FAIL, so a teeth run can never pass on an unmutated file.
//   1 = the fix removed (BarPage mounts the POS before the app location switched; POSPage reads the
//       saved cart by the app location even when it is not the bar's) — the probe must go red on the cart.
//   2 = 1 + the pay/hold guard removed — the probe must ALSO catch a sale paid with the other branch's lines.
const BAR = /src\/pages\/BarPage\.jsx$/, POS = /src\/pages\/POSPage\.jsx$/;
const FIX = [
  { file: BAR, from: `{selectedLocation?.id !== barId ? <div className="bar-msg" role="status">{L(lang, "Loading…", "Chargement…")}</div> :`, to: `{false ? null :` },
  { file: POS, from: `const locId  = embedLocWrong ? undefined : selectedLocation?.id;`, to: `const locId  = selectedLocation?.id;` },
];
const GUARD = [
  { file: POS, from: `    if (wrong) toast.error(`, to: `    if (false) toast.error(` },
  { file: POS, from: `    return wrong;\n  };`, to: `    return false;\n  };` },
];
export const CART_TEETH = { 1: FIX, 2: [...FIX, ...GUARD] };
// 3 = BAR CART FIX 2 removed (2026-11-19): the bar reads/writes New Sale's draft key, restored lines with no or
//     another branch come back (and get stamped local), the guard lets a line with no branch through, the store
//     keeps old bar-written carts, /bar reopens on bars[0] — P7/P9/P10/P10s must go red.
const FIX2 = [
  { file: POS, from: "const draftLoc = (l) => (embed && l ? `${l}::bar` : l);", to: "const draftLoc = (l) => l;" },
  { file: POS, from: "const draft = embed ? { ...draft0, items: (draft0.items || []).filter((it) => it && it.barLoc === embed.locationId) } : draft0;", to: "const draft = draft0;" },
  { file: POS, from: "if (embed && !draft.items.length) {", to: "if (false) {" },
  { file: POS, from: "|| cart.some((l) => !l || l.barLoc !== embed.locationId);", to: "|| cart.some((l) => l && l.barLoc && l.barLoc !== embed.locationId);" },
  { file: /src\/store\/index\.js$/, from: "if (!barWritten) kept[k] = d;", to: "kept[k] = d;" },
  { file: BAR, from: "isBar(last) ? last : isBar(selectedLocation?.id) ? selectedLocation.id : (bars[0]?.id || null);", to: "(bars[0]?.id || null);" },
];
// 4 = the in-place shift removed: no hint, no Open shift button, Take payment never disabled — P11 must go red
const SHIFT = [
  { file: BAR, from: "const noShift = !!(shift && shift.need);", to: "const noShift = false;" },
];
CART_TEETH[3] = FIX2;
CART_TEETH[4] = SHIFT;
// 5 = the lost-pay read-back removed (2026-11-20). Since the bill (same day) the pay leaves from the POS panel, so
//     the read-back that matters is POSPage's bill one: every lost/409 answer goes straight to the error — P12a/b/c red
CART_TEETH[5] = [{ file: POS, from: "          if (lost) {", to: "          if (false) {" }];
// 6 = the bill's cart NOT locked: setters live again and the lines render with ✕ / − / + / qty / discount — P13b red
CART_TEETH[6] = [
  { file: POS, from: "  const setCart = bill ? BILL_CART_LOCKED : setCartRaw;", to: "  const setCart = setCartRaw;" },
  { file: POS, from: ") : cart.map((item, idx) => item.billLine ? (", to: ") : cart.map((item, idx) => false ? (" },
];
// 7 = "Send request to boss" on a bill takes the New Sale path (parks a held cart, no bar_tab_id) — P13e red
CART_TEETH[7] = [{ file: POS, from: "      if (bill) {\n        await api.post(\"/sales/bundled-approval-request\", {", to: "      if (false) {\n        await api.post(\"/sales/bundled-approval-request\", {" }];
