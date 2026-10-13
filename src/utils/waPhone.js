// LAUNCH-BATCH-2 (Nigeria day-one) — WhatsApp deeplink numbers in the ORG's country.
//
// Four screens prefixed every customer/owner number with Cameroon's 237, so a Nigerian
// shop's receipt or debt reminder opened WhatsApp on a number that does not exist
// (0803 000 0000 → 2378030000000). The dialling code now follows the org — the same
// country test ReportsPage's resolveWaNumber already used — and a number that already
// carries 237 or 234 is left alone.
export function waDialCode(org) {
  const country = String(org?.country || "").toLowerCase();
  const currency = String(org?.currency || "").toUpperCase();
  return country.includes("niger") || currency === "NGN" ? "234" : "237";
}

export function waPhone(raw, org) {
  let p = String(raw || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);                   // 00234… international form
  if (p.startsWith("237") || p.startsWith("234")) return p;  // already international
  return waDialCode(org) + p.replace(/^0+/, "");             // 0803… → 234803…
}
