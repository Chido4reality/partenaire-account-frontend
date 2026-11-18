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
