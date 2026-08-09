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

  // MP-CASHIER-PHASE-1b
  cashier_queue:      { fr: "Caissier",              en: "Cashier" },
  pickup_list:        { fr: "Retrait",               en: "Pickup" },
  awaiting_payment:   { fr: "En attente de paiement", en: "Waiting for payment" },
  awaiting_pickup:    { fr: "À remettre",            en: "Ready for collection" },
  take_payment:       { fr: "Encaisser",             en: "Take payment" },
  release_goods:      { fr: "Remettre",              en: "Hand over" },
  send_to_cashier:    { fr: "Envoyer au caissier",   en: "Send to cashier" },
  order_total:        { fr: "Total de la commande",  en: "Order total" },
  sent_by:            { fr: "Envoyé par",            en: "Sent by" },
  waiting_for:        { fr: "En attente depuis",     en: "Waiting" },
  items_count:        { fr: "articles",              en: "items" },
  queue_empty:        { fr: "Aucun ticket en attente de paiement.", en: "No tickets waiting for payment." },
  pickup_empty:       { fr: "Rien à remettre pour le moment.",      en: "Nothing to hand over right now." },
  not_cashier_till:   { fr: "Cette caisse n'utilise pas le circuit caissier.", en: "This till does not use the cashier workflow." },
  reload_list:        { fr: "Recharger la liste",    en: "Reload the list" },
  offline_online_only:{ fr: "Hors ligne — encaisser et remettre exigent une connexion. Rien n'est mis en file d'attente.",
                        en: "Offline — taking payment and handing over need a connection. Nothing is queued." },
  ticket_sent:        { fr: "Ticket envoyé au caissier", en: "Sent to the cashier" },
  minutes_short:      { fr: "min",                   en: "min" },
  hours_short:        { fr: "h",                     en: "h" },
};

// t("amount_paid", "fr") -> "Montant payé". Falls back to French, then the key.
export function t(key, lang = "fr") {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.fr || key;
}
