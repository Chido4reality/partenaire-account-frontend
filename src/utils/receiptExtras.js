// MP-RECEIPT-ADVERT + MP-RECEIPT-RETURN-BARCODE — shared receipt-footer helpers
// used by every print path (thermal HTML, A4 facture HTML, on-screen preview,
// and ESC/POS via escpos.js).

// Exact advert copy — DO NOT alter the wording.
export const ADVERT_EN = "Powered by Mon Partenaire — run your shop smarter. Free on Play Store.";
export const ADVERT_FR = "Propulsé par Mon Partenaire — gérez votre boutique. Gratuit sur Play Store.";

// The org's country is free text ("Nigeria" / "Cameroun"). Nigeria orgs get
// English only; everyone else (Cameroon default) gets French first, then English.
export function isNigeriaOrg(org) {
  return /niger/i.test(String((org && org.country) || ""));
}

// Ordered advert lines for the org, or [] when the toggle is OFF. The toggle
// defaults ON, so only an explicit `false` suppresses it (an older cached org
// object without the field still shows the advert).
export function advertLines(org) {
  if (org && org.receipt_advert_enabled === false) return [];
  return isNigeriaOrg(org) ? [ADVERT_EN] : [ADVERT_FR, ADVERT_EN];
}
