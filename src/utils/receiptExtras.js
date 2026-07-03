// MP-RECEIPT-ADVERT + MP-RECEIPT-RETURN-BARCODE — shared receipt-footer helpers
// used by every print path (thermal HTML, A4 facture HTML, on-screen preview,
// and ESC/POS via escpos.js).

// Exact advert copy — DO NOT alter the wording.
export const ADVERT_EN = "Powered by Mon Partenaire — run your shop smarter. Free on Play Store.";
export const ADVERT_FR = "Propulsé par Mon Partenaire — gérez votre boutique. Gratuit sur Play Store.";

// Whether the org's advert should be French-then-English (Cameroun) vs English
// only (Nigeria / unknown). Gate PRIMARILY on currency — a controlled 3-letter
// code with no spelling drift (NGN vs XAF) — because the prod `country` field is
// free text in French ("Nigeria" / "Cameroun") and has no ISO country_code.
// Fall back to a case-insensitive country substring when currency is missing,
// then default to English only (English is primary; never emit French to an
// org we can't positively identify as Cameroun).
export function isFrenchEnglishOrg(org) {
  const currency = String((org && org.currency) || "").trim().toUpperCase();
  if (currency === "XAF") return true;   // Cameroun (Central African CFA franc)
  if (currency === "NGN") return false;  // Nigeria
  const country = String((org && org.country) || "");
  if (/camer/i.test(country)) return true;   // "Cameroun" / "Cameroon"
  if (/niger/i.test(country)) return false;  // "Nigeria" / "Niger"
  return false;                          // safe default: English only
}

// Ordered advert lines for the org, or [] when the toggle is OFF. The toggle
// defaults ON, so only an explicit `false` suppresses it (an older cached org
// object without the field still shows the advert).
export function advertLines(org) {
  if (org && org.receipt_advert_enabled === false) return [];
  return isFrenchEnglishOrg(org) ? [ADVERT_FR, ADVERT_EN] : [ADVERT_EN];
}

// MP-RECEIPT-DOWNLOAD-QR — a small "scan to download the app" QR in the advert
// footer. EXACT Play Store URL (encoded as-is in the QR).
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.partenaire.monpartenaire";
const DL_CAPTION_EN = "Scan to download Mon Partenaire";
const DL_CAPTION_FR = "Scannez pour télécharger Mon Partenaire";

// Whether the app-download QR block should print — ONLY when the advert is on
// (it is part of the advert). Same toggle as advertLines().
export function showDownloadQr(org) {
  return !(org && org.receipt_advert_enabled === false);
}

// Caption line(s) above the download QR, following the advert language gate:
// Nigeria → English only; Cameroun → French + English. [] when advert off.
export function downloadQrCaptionLines(org) {
  if (!showDownloadQr(org)) return [];
  return isFrenchEnglishOrg(org) ? [DL_CAPTION_FR, DL_CAPTION_EN] : [DL_CAPTION_EN];
}
