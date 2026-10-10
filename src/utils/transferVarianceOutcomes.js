// TRANSFER VARIANCE OUTCOMES (Peter, 2026-10-10) — what happened to a transfer's
// missing units. Mirrors backend lib/transferVariance.js + pa_transfer_variance_resolve.
// Shared by the transfer screen (TransferDetailModal) and the held-receipt approval
// (ApprovalDetailView), so both offer the same choice in the same words.
//
// There is NO default. TRF-20261009-0001: the old list preselected "arrived later",
// and 3 units that did not exist were credited as sellable when "Damaged" was meant.
//
// WORDING (Peter, 2026-10-11): plain trader language, never accounting words
// ("credited", "written off", "sellable stock"), and REAL branch names — {src} is
// where the goods came from, {dst} where they were going (see outcomeHint).
export const VARIANCE_OUTCOMES = [
  { key: "damaged", en: "Damaged", fr: "Endommagées",
    hintEn: "They arrived broken. Moved to the Damaged list at {dst} — can't be sold as normal.",
    hintFr: "Arrivées cassées. Mises dans la liste Endommagés de {dst} — ne se vendent pas normalement." },
  { key: "expired", en: "Expired", fr: "Périmées",
    hintEn: "They arrived expired. Moved to the Damaged list at {dst}.",
    hintFr: "Arrivées périmées. Mises dans la liste Endommagés de {dst}." },
  { key: "theft", en: "Theft", fr: "Vol",
    hintEn: "Stolen. Removed from stock.",
    hintFr: "Volées. Retirées du stock." },
  { key: "lost_in_transit", en: "Lost in transit", fr: "Perdues en route",
    hintEn: "Lost on the way. Removed from stock.",
    hintFr: "Perdues pendant le trajet. Retirées du stock." },
  { key: "unrecorded_sale", en: "Sold, never recorded", fr: "Vendues sans être enregistrées",
    hintEn: "Sold without a receipt. Removed from stock.",
    hintFr: "Vendues sans ticket. Retirées du stock." },
  { key: "other", en: "Other", fr: "Autre",
    hintEn: "Something else — explain in the note.",
    hintFr: "Autre chose — expliquez dans la note." },
  { key: "received_late", en: "Received late", fr: "Reçues plus tard",
    hintEn: "They turned up after the count. Added to {dst}'s stock now.",
    hintFr: "Arrivées après le comptage. Ajoutées maintenant au stock de {dst}." },
  { key: "return_to_source", en: "Never left the warehouse", fr: "Jamais sorties de l'entrepôt",
    hintEn: "The missing goods are still at {src}. Put them back in its stock now.",
    hintFr: "Les marchandises manquantes sont encore à {src}. Les remettre dans son stock maintenant." },
];

/** An outcome's description with the real branch names filled in. */
export function outcomeHint(o, en, { src, dst } = {}) {
  const s = src || (en ? "the warehouse" : "l'entrepôt");
  const d = dst || (en ? "the shop" : "la boutique");
  return String(en ? o.hintEn : o.hintFr).replaceAll("{src}", s).replaceAll("{dst}", d);
}

export const outcomeByKey = (k) => VARIANCE_OUTCOMES.find((o) => o.key === k) || null;

/** The outcomes this user may choose: ALL of them for the owner or a manager granted
 *  can_cancel_transfers (Peter, 2026-10-10 — a manager given full control must be
 *  able to say Damaged too); none for anyone else. The server re-checks. */
export function allowedOutcomes({ isOwner, canCancelTransfers }) {
  return isOwner || canCancelTransfers ? VARIANCE_OUTCOMES : [];
}

/** A stock-check "Where did they go?" answer → the transfer outcome it means. Only an
 *  answer the owner actually gave is carried; nothing is invented. */
export function outcomeFromStockCheckSub(sub) {
  return ["damaged", "expired", "theft", "unrecorded_sale", "other"].includes(sub) ? sub : null;
}

export function outcomeNoteRequired(key) { return key === "other"; }
