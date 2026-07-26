// MP-STAFF-ACTIVITY-LEDGER: shared activity-type labels + time formatting, used by the
// owner's Accountant-Log LedgerView and the staff-only MyActivity view.
export const LEDGER_TYPES = {
  sale:              { icon: "🧾", en: "Sale",                 fr: "Vente" },
  void:              { icon: "❌", en: "Void",                 fr: "Annulation" },
  return:            { icon: "↩️", en: "Refund / return",      fr: "Remboursement" },
  transfer_sent:     { icon: "📤", en: "Transfer sent",        fr: "Transfert envoyé" },
  transfer_received: { icon: "📥", en: "Transfer received",    fr: "Transfert reçu" },
  goods_received:    { icon: "📦", en: "Goods received",       fr: "Marchandises reçues" },
  goods_released:    { icon: "🏷️", en: "Goods priced/released", fr: "Marchandises tarifées" },
  debt_collection:   { icon: "💰", en: "Debt collected",       fr: "Dette encaissée" },
  credit_given:      { icon: "📝", en: "Credit given",         fr: "Crédit accordé" },
  discount:          { icon: "🔖", en: "Discount",             fr: "Remise" },
  stock_adjustment:  { icon: "📊", en: "Stock adjusted",       fr: "Stock ajusté" },
  shift_open:        { icon: "🔓", en: "Shift opened",         fr: "Poste ouvert" },
  shift_close:       { icon: "🔒", en: "Shift closed",         fr: "Poste fermé" },
  price_change:      { icon: "💲", en: "Price changed",        fr: "Prix modifié" },
  cost_change:       { icon: "💵", en: "Cost changed",         fr: "Coût modifié" },
  expense:           { icon: "💸", en: "Expense",              fr: "Dépense" },
  login:             { icon: "🔑", en: "Login",                fr: "Connexion" },
  debt_adjustment:   { icon: "⚖️", en: "Debt adjusted",        fr: "Dette ajustée" },
};
export const LEDGER_TYPE_ORDER = ["sale", "void", "return", "transfer_sent", "transfer_received",
  "goods_received", "goods_released", "debt_collection", "credit_given", "discount",
  "stock_adjustment", "price_change", "cost_change", "expense", "shift_open", "shift_close"];

export function ltLabel(type, en) { const t = LEDGER_TYPES[type]; return t ? (en ? t.en : t.fr) : type; }

// Shop-timezone rendering (WAT/Africa/Lagos), mirroring the M1 report-time fix.
export function fmtLedgerWhen(iso, en) {
  try {
    return new Date(iso).toLocaleString(en ? "en-GB" : "fr-FR",
      { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
