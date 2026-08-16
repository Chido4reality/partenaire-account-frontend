// MP-CASHIER-PHASE-1b — the pure rules behind the cashier queue's refusal panel
// and its departure notice. NO React, NO stores, NO api: extracted from
// TicketListPage precisely so they can be exercised directly. The panel is a
// div and the list is a map; what can actually be WRONG is in here.

// ── THE REFUSAL, AS A PURE FUNCTION ───────────────────────────────────────
// Extracted from the mutation's onError so it can be exercised without mounting
// the page. The panel itself is a div; what can actually be WRONG is this
// mapping — which server field becomes the title, whether the language pick is
// right, whether a body with no message_* still yields a sentence. Those are the
// things worth proving, and they were unprovable while this lived inside a hook.
//
// The server composes the sentence bilingually from the ticket's REAL state
// (STATUS_EN/STATUS_FR in lib/saleTickets.js). Rendering it verbatim means one
// wording to maintain; composing a client-side message here would be a second
// source of truth that drifts — which is exactly what the state line below was.
//
// ⚠️ THE STATE LINE READS current_status_en / current_status_fr, NEVER
// current_status. Two separate bugs came out of reading the raw column:
//
//   1. IT CONTRADICTED THE MESSAGE. is_voided is orthogonal to status, so a
//      voided queue ticket is is_voided=true AND status='pending_payment'. The
//      panel therefore said "This ticket was voided." and "Current state:
//      pending_payment." three lines apart, on EVERY voided refusal.
//   2. IT LEAKED A RAW ENUM. `État actuel : pending_payment` — untranslated, to
//      a French cashier, in a box that is supposed to be the clear explanation.
//
// The server now composes both labels from the same place as the message
// (stateLabels in lib/saleTickets.js), so they cannot disagree. There is NO
// fallback to current_status: against an older backend the state line is simply
// omitted, because no line is better than a contradictory one.
//
// saleNumber is passed IN by the caller, not read from the body. The client knows
// which row was pressed; the server does not need to tell it. Without it the
// panel says "this ticket" above a queue of four and identifies none of them,
// which makes "do not take payment for it" unactionable — "it" is unidentified.
export function refusalFromError(err, en, opts = {}) {
  const b = (err && err.response && err.response.data) || {};
  const label = en ? b.current_status_en : b.current_status_fr;
  return {
    saleId: b.sale_id || opts.saleId || null,
    saleNumber: opts.saleNumber || b.sale_number || null,
    code: b.code || "error",
    title: (en ? b.message_en : b.message_fr) || b.message
      || (en ? "That did not work." : "Cela n'a pas fonctionné."),
    detail: label
      ? (en ? `Current state: ${label}.` : `État actuel : ${label}.`)
      : null,
  };
}

// ── WHAT LEFT THE LIST, AND WHY ───────────────────────────────────────────
// Pure diff of two snapshots plus the server's recently_settled. Exported so the
// rule can be checked directly: the failure modes here are all silent ones —
// announcing your own action back at you, announcing on first load, or
// announcing a row the user dismissed themselves.
//
// `ownIds` are tickets THIS user just settled. They already got a receipt and a
// state change they initiated; telling them their own payment "was taken by you"
// would be noise, and worse, would train them to ignore the line that matters.
export function departedTickets({ prev, next, settled, ownIds, dismissedIds }) {
  if (!prev) return [];                       // first load announces nothing
  const nextIds = new Set((next || []).map(t => t.id));
  const byId = new Map((settled || []).map(s => [s.id, s]));
  return (prev || [])
    .filter(t => !nextIds.has(t.id))
    .filter(t => !(ownIds && ownIds.has(t.id)))
    .filter(t => !(dismissedIds && dismissedIds.has(t.id)))
    .map(t => {
      const s = byId.get(t.id) || null;
      return {
        id: t.id,
        // Last known identity comes from the snapshot, so the line is still
        // useful when the server had nothing to say about where it went.
        sale_number: t.sale_number || (s && s.sale_number) || null,
        customer_name: (t.pa_customers && t.pa_customers.name) || (s && s.customer_name) || null,
        total_amount: t.total_amount != null ? t.total_amount : (s && s.total_amount),
        status: s ? s.status : "unknown",
        by_name: s ? s.by_name : null,
        at: s ? s.at : null,
      };
    });
}

// The sentence. Kept next to the diff so wording and data cannot drift apart,
// and pure so both languages are checkable.
//
// THREE DISTINCT CASES, deliberately worded apart:
//   known status + name  -> "was paid by Boss Dozie"      (the daily two-till case)
//   known status, no name-> "was paid by a colleague"      (never invent the who)
//   unknown              -> "is no longer in this list"    (honest about not knowing)
export function departureSentence(d, en) {
  const who = d.by_name || null;
  const num = d.sale_number || (en ? "A ticket" : "Un ticket");
  if (d.status === "paid") {
    return who ? (en ? `${num} was paid by ${who} a moment ago.` : `${num} a été encaissé par ${who} à l'instant.`)
               : (en ? `${num} was paid by a colleague a moment ago.` : `${num} a été encaissé par un collègue à l'instant.`);
  }
  if (d.status === "released") {
    return who ? (en ? `${num} was handed over by ${who} a moment ago.` : `${num} a été remis par ${who} à l'instant.`)
               : (en ? `${num} was handed over by a colleague a moment ago.` : `${num} a été remis par un collègue à l'instant.`);
  }
  // cancelled_by is a bare uuid with no name column, so this branch can never
  // name anyone today. Stating "was cancelled" without a who is honest; the
  // alternative is a migration — see the note on the server's recently_settled.
  if (d.status === "cancelled") {
    return en ? `${num} was cancelled a moment ago.` : `${num} a été annulé à l'instant.`;
  }
  if (d.status === "voided") {
    return en ? `${num} was voided a moment ago.` : `${num} a été annulé (void) à l'instant.`;
  }
  return en ? `${num} is no longer in this list.` : `${num} n'est plus dans cette liste.`;
}
