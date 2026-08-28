// F-D — why this stock number is being changed.
//
// TWO BRANCHES, because "goods broke" and "the app was wrong" are not two
// flavours of one thing. The first is shrinkage — the shop owner's own business
// fact. The second is a BUG REPORT, and we were destroying it: a +31 that
// absorbed a -5 caused by our own bundled-approval bug surfaced only because we
// happened to be investigating the sale, four days late, with the underlying
// fact already unrecoverable.
//
// ⚠️ THIS LIST MIRRORS A LIVE DB CHECK CONSTRAINT
// (pa_stock_movements_adjust_sub_reason_check) which PAIRS each sub-reason to its
// branch — app_wrong + 'theft' is unrepresentable, not merely discouraged. If you
// add a value here you must add it to the constraint AND to lib/stockAdjust.js in
// the same change. Drift shows up as a 500 on a live screen, not as a test
// failure.
//
// COPY RULE: Paul's org is English throughout, so ENGLISH is what gets judged.
// French ships as normal product hygiene. Every label is a thing an owner would
// actually say — no vocabulary to learn, because a taxonomy that needs studying
// is what produced a +18 surplus filed as "confirmed loss".

export const ADJUST_BRANCHES = [
  {
    value: "stock_wrong",
    en: "The stock is wrong",
    fr: "Le stock est faux",
    // What actually happened in the shop.
    hintEn: "The goods really did change — breakage, theft, something found",
    hintFr: "Les marchandises ont vraiment changé — casse, vol, retrouvé",
    subs: [
      { value: "damaged",            en: "Damaged or broken",        fr: "Endommagé ou cassé" },
      { value: "theft",              en: "Stolen",                   fr: "Volé" },
      { value: "expired",            en: "Expired",                  fr: "Périmé" },
      { value: "found",              en: "Found extra stock",        fr: "Stock retrouvé" },
      { value: "unrecorded_sale",    en: "Sold but never rung up",   fr: "Vendu sans être enregistré" },
      { value: "unrecorded_receipt", en: "Received but never entered", fr: "Reçu sans être saisi" },
      { value: "unrecorded_return",  en: "Returned but never entered", fr: "Retourné sans être saisi" },
      { value: "other",              en: "Something else",           fr: "Autre chose" },
    ],
  },
  {
    value: "app_wrong",
    en: "The app is wrong",
    fr: "L'application est fausse",
    // The goods never moved — the NUMBER is wrong. This is the bug report.
    hintEn: "The goods are fine — the number in the app doesn't match",
    hintFr: "Les marchandises vont bien — le nombre dans l'app ne correspond pas",
    subs: [
      { value: "sale_wrong",       en: "A sale didn't record right",        fr: "Une vente ne s'est pas enregistrée correctement" },
      { value: "receipt_missing",  en: "Goods I received never showed up",  fr: "Des marchandises reçues ne sont jamais apparues" },
      { value: "transfer_missing", en: "A transfer never arrived",          fr: "Un transfert n'est jamais arrivé" },
      { value: "duplicate",        en: "Something was recorded twice",      fr: "Quelque chose a été enregistré deux fois" },
      { value: "count_lost",       en: "A stock count didn't save",         fr: "Un inventaire ne s'est pas enregistré" },
      // REQUIRED, and worded so it doesn't read as a failure to comply. An owner
      // who can't name the mechanism still carries the signal that something
      // broke; forcing him to pick a wrong specific is worse than letting him
      // say he doesn't know.
      { value: "dont_know",        en: "I don't know — it was just wrong",  fr: "Je ne sais pas — c'était juste faux" },
    ],
  },
];

export const branchOf = (value) => ADJUST_BRANCHES.find((b) => b.value === value) || null;
export const subsFor  = (value) => (branchOf(value)?.subs) || [];
export const label    = (o, en) => (en ? o.en : o.fr);

// The Save gate, as a pure predicate so it can be tested without a browser.
// BOTH taps are required — this is the entire mechanism. An optional field was
// skipped 89% of the time on prod; the fastest path through the modal must be a
// complete one, so the button is unreachable until the row would be complete.
export function canSubmitAdjust(reason, subReason) {
  if (!reason || !subReason) return false;
  const subs = subsFor(reason).map((x) => x.value);
  // Cross-branch pairings are unreachable in the UI, unrepresentable in the DB,
  // and rejected by the route. Checked here too so the button can never enable
  // on a combination the server would refuse.
  return subs.includes(subReason);
}
