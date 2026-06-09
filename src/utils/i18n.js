// MP-I18N-GROUNDWORK (build 10) — minimal bilingual dictionary so a future
// English (Nigeria) release is a translation pass, not a rewrite.
//
// Default language is FRENCH. There is NO language toggle yet and existing
// screens are intentionally NOT migrated. The rule going forward: any NEW or
// touched UI string routes through t(key, lang) instead of an inline
// `lang === "fr" ? ... : ...` ternary. Add keys here as you touch strings.
export const STRINGS = {
  amount_paid:  { fr: "Montant payé",    en: "Amount paid" },
  due_date:     { fr: "Date d'échéance", en: "Due date" },
  full_balance: { fr: "Solde total",     en: "Full balance" },
  print:        { fr: "Imprimer",        en: "Print" },
  share:        { fr: "Partager",        en: "Share" },
  close:        { fr: "Fermer",          en: "Close" },
};

// t("amount_paid", "fr") -> "Montant payé". Falls back to French, then the key.
export function t(key, lang = "fr") {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.fr || key;
}
