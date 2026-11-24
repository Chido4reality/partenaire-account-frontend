// BAR CART FIX — teeth for scripts/bar-fit/branch-cart.mjs. Each set is applied to a COPY inside the
// bundle (bundle.mjs `mutate`); the tree is never touched, and an anchor that is not found exactly once
// makes the bundle FAIL, so a teeth run can never pass on an unmutated file.
//   1 = the fix removed (BarPage mounts the POS before the app location switched; POSPage reads the
//       saved cart by the app location even when it is not the bar's) — the probe must go red on the cart.
//   2 = 1 + the pay/hold guard removed — the probe must ALSO catch a sale paid with the other branch's lines.
const BAR = /src\/pages\/BarPage\.jsx$/, POS = /src\/pages\/POSPage\.jsx$/;
const FIX = [
  // the HOME POS mount guard — the bill screen has the same guard line since be52396, so the anchor carries the
  // <POSPage line that follows it (exactly once again)
  { file: BAR, from: `{selectedLocation?.id !== barId ? <div className="bar-msg" role="status">{L(lang, "Loading…", "Chargement…")}</div> :\n          <POSPage key={barId} embed={{`, to: `{false ? null :\n          <POSPage key={barId} embed={{` },
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
// 5 = the bill's POST /sales WITHOUT bar_tab_id (2026-11-23: the bill = New Sale + bar_tab_id; the old lost-pay
//     read-back is deleted — New Sale's local_id replay replaces it) — P11g red
CART_TEETH[5] = [{ file: POS, from: "        ...(bill ? { bar_tab_id: bill.tabId } : {}),\n        location_id:    selectedLocation?.id,", to: "        location_id:    selectedLocation?.id," }];
// 6 = the bill's cart NOT locked: setters live again and the lines render with ✕ / − / + / qty / discount — P13b red
CART_TEETH[6] = [
  { file: POS, from: "  const setCart = bill ? BILL_CART_LOCKED : setCartRaw;", to: "  const setCart = setCartRaw;" },
  { file: POS, from: ") : cart.map((item, idx) => item.billLine ? (", to: ") : cart.map((item, idx) => false ? (" },
];
// 7 = "Send request to boss" on a bill parks a held cart and clears the screen (the New Sale tail) — P13e red
CART_TEETH[7] = [{ file: POS, from: "      if (bill) {\n        setApprovalBundle(null);", to: "      if (false) {\n        setApprovalBundle(null);" }];
// 8 = the bill's offline guard removed (it would go to New Sale's offline queue) — P12c red
CART_TEETH[8] = [{ file: POS, from: "if (bill && typeof navigator !== \"undefined\" && navigator.onLine === false) {", to: "if (false) {" }];
// 9 = an empty bill mounts the POS panel (no "nothing to pay" / close-off-empty) — P14 red
CART_TEETH[9] = [{ file: BAR, from: "  if (!lines.length) return (", to: "  if (false) return (" }];
// 10 = the shift-age warning never shows — P15a/c red
CART_TEETH[10] = [{ file: /src\/components\/bar\/ShiftAgeWarning\.jsx$/, from: "if (!Number.isFinite(t) || now - t <= SHIFT_TOO_OLD_MS) return null;", to: "return null;" }];
// 11 = a lost answer on a bill said as "Tab paid." (the offline_queued branch removed) — P12a red
CART_TEETH[11] = [{ file: POS, from: "          if (data?.offline_queued) toast(", to: "          if (false) toast(" }];
