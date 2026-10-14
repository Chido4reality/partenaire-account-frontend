// Fix 3 (Peter's staging test): a sale's payment status in the user's language, and the
// "Due" figure every screen shows. The backend (lib/effectiveDue.js) already nets refunds
// that went to the sale's debt into balance_due / payment_status; effective_balance_due is
// the debt screens' older name for the same figure.
const LABELS = {
  paid:    { en: "Paid",    fr: "Payé" },
  partial: { en: "Partial", fr: "Partiel" },
  credit:  { en: "Credit",  fr: "Crédit" },
  pending: { en: "Pending", fr: "En attente" },
  voided:  { en: "Voided",  fr: "Annulée" },
};

export function saleStatusLabel(status, lang) {
  const l = LABELS[status];
  return l ? (lang === "en" ? l.en : l.fr) : (status || "");
}

export function saleDue(sale) {
  if (!sale) return 0;
  const v = sale.effective_balance_due != null ? sale.effective_balance_due : sale.balance_due;
  return Math.max(0, Number(v) || 0);
}
