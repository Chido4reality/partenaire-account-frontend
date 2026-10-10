// TRANSFER VARIANCE OUTCOMES (Peter, 2026-10-10) — what happened to a transfer's
// missing units. Mirrors backend lib/transferVariance.js + pa_transfer_variance_resolve.
// Shared by the transfer screen (TransferDetailModal) and the held-receipt approval
// (ApprovalDetailView), so both offer the same choice in the same words.
//
// There is NO default. TRF-20261009-0001: the old list preselected "arrived later",
// and 3 units that did not exist were credited as sellable when "Damaged" was meant.
export const VARIANCE_OUTCOMES = [
  { key: "damaged", en: "Damaged", fr: "Endommagées",
    hintEn: "They arrived broken. Recorded in the Damaged pile at the destination — not sellable stock.",
    hintFr: "Arrivées cassées. Enregistrées dans la pile Endommagés de la destination — pas en stock vendable." },
  { key: "expired", en: "Expired", fr: "Périmées",
    hintEn: "They arrived expired. Recorded in the Damaged pile as expired — not sellable stock.",
    hintFr: "Arrivées périmées. Enregistrées dans la pile Endommagés comme périmées — pas en stock vendable." },
  { key: "theft", en: "Theft", fr: "Vol",
    hintEn: "Written off. No branch is credited — stock already reflects the loss.",
    hintFr: "Passées en perte. Aucune boutique n'est créditée — le stock en tient déjà compte." },
  { key: "lost_in_transit", en: "Lost in transit", fr: "Perdues en route",
    hintEn: "Written off. No branch is credited — stock already reflects the loss.",
    hintFr: "Passées en perte. Aucune boutique n'est créditée — le stock en tient déjà compte." },
  { key: "unrecorded_sale", en: "Sold, never recorded", fr: "Vendues sans être enregistrées",
    hintEn: "Written off as an unrecorded sale. No branch is credited.",
    hintFr: "Passées en perte comme vente non enregistrée. Aucune boutique n'est créditée." },
  { key: "other", en: "Other", fr: "Autre",
    hintEn: "Written off. Say what happened in the note (required).",
    hintFr: "Passées en perte. Précisez dans la note (obligatoire)." },
  { key: "received_late", en: "Received late", fr: "Reçues plus tard",
    hintEn: "They turned up after the count. Added to the destination's sellable stock now.",
    hintFr: "Arrivées après le comptage. Ajoutées maintenant au stock vendable de la destination." },
  { key: "return_to_source", en: "Return to source", fr: "Renvoyer à la source",
    hintEn: "The source packed short. Put back into the source branch's stock now.",
    hintFr: "La source a envoyé moins. Remises maintenant dans le stock de la boutique source." },
];

export const outcomeByKey = (k) => VARIANCE_OUTCOMES.find((o) => o.key === k) || null;

/** The outcomes this user may choose. The owner: all. A manager granted
 *  can_cancel_transfers: return to source only. Anyone else: none. The server
 *  re-checks every one. */
export function allowedOutcomes({ isOwner, canCancelTransfers }) {
  if (isOwner) return VARIANCE_OUTCOMES;
  if (canCancelTransfers) return VARIANCE_OUTCOMES.filter((o) => o.key === "return_to_source");
  return [];
}

/** A stock-check "Where did they go?" answer → the transfer outcome it means. Only an
 *  answer the owner actually gave is carried; nothing is invented. */
export function outcomeFromStockCheckSub(sub) {
  return ["damaged", "expired", "theft", "unrecorded_sale", "other"].includes(sub) ? sub : null;
}

export function outcomeNoteRequired(key) { return key === "other"; }
