// MP-UNIT-LABEL (display-only)
//
// The "pieces" unit is STORED as 'pce' on pa_products (existing rows + the app's
// default). Business wants it SHOWN as 'pcs'. This is label-only: the stored
// value stays 'pce' everywhere (no migration, existing products unaffected).
//   • unitLabel(u)  → what to DISPLAY   ('pce' → 'pcs', everything else as-is)
//   • unitValue(u)  → what to STORE     (normalise a typed/imported 'pcs' back to
//                                        the canonical 'pce'; everything else as-is)
export function unitLabel(u) {
  return u === "pce" ? "pcs" : (u || "");
}

export function unitValue(u) {
  return String(u == null ? "" : u).trim().toLowerCase() === "pcs" ? "pce" : u;
}
