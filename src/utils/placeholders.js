// LAUNCH-BATCH-2 (Nigeria day-one) — form placeholders in the UI's language and the
// org's country.
//
// Placeholders were hard-coded once, mostly in French and for Cameroon: an English UI
// showed "Ex: Tube, Huile palme...", "A-01, Rayon 2...", and every phone box read
// "6XXXXXXXX" (a Cameroon number) to a Nigerian shop. A placeholder is an example of
// what to type, so it follows both: the language the person reads, and the country
// whose numbers, names and streets they will type.
import { useAuthStore, useLangStore } from "../store";

export function isNigeria(org) {
  return String(org?.country || "").toLowerCase().includes("niger") || String(org?.currency || "").toUpperCase() === "NGN";
}

export function placeholders(lang, org) {
  const en = lang === "en";
  const ng = isNigeria(org);
  const eg = en ? "e.g." : "Ex :";
  return {
    productName: en ? (ng ? "e.g. Rice 50kg, Palm oil..." : "e.g. Tube, Palm oil...") : "Ex : Tube, Huile palme...",
    barcode:     en ? "Scan or type" : "Scanner ou saisir",
    slot:        en ? "A-01, Shelf 2..." : "A-01, Rayon 2...",
    optional:    en ? "Optional" : "Facultatif",
    phone:       ng ? "0803 000 0000" : "6XX XX XX XX",
    whatsapp:    ng ? "234803XXXXXXX" : "2376XXXXXXXX",
    personName:  ng ? "Ada Okafor" : "Jean Dupont",
    city:        ng ? "Lagos" : "Douala",
    email:       en ? "shop@example.com" : "boutique@exemple.com",
    shopName:    `${eg} ${ng ? "Ikeja Main Shop" : "Boutique Akwa"}...`,
    storeName:   `${eg} ${ng ? "Ada Stores" : "Stenamo Market Store"}`,
    address:     `${eg} ${ng ? "12 Allen Avenue, Ikeja" : "Rue Joss, Douala"}`,
    shopAddress: `${eg} ${ng ? "12 Allen Avenue, Ikeja" : "Nouvelle route, Bonaberri"}`,
  };
}

// Hook form: the signed-in org + current language.
export function usePlaceholders() {
  const lang = useLangStore(s => s.lang);
  const org = useAuthStore(s => s.org);
  return placeholders(lang, org);
}
