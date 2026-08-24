// MP-OFFLINE-GATE — "does this cart need a decision only the server can make?"
//
// WHY THIS EXISTS
// api.js's adapter enqueues an offline-eligible write and returns an OPTIMISTIC
// success whenever the network is down OR merely "degraded". For an ordinary
// sale that is exactly right — it is why offline mode exists. For a sale the
// server would have REFUSED, it is a lie told at the till: the app says
// completed, prints a receipt, and the goods leave, for a sale that will 403 on
// replay (proven with a blocked cashier's credit sale, 2026-08-22 item 13).
//
// ⚠️ THIS ANSWERS "WHETHER", NEVER "WHAT".
// It must not become a second copy of the server's rules — that is the
// one-fact-many-readers shape this codebase keeps getting hurt by, and a client
// copy would drift silently. It returns "a server decision is required", and the
// server remains the only thing that decides the outcome. Being deliberately
// coarse also means it can be WRONG IN THE SAFE DIRECTION: over-reporting costs
// one online round-trip, under-reporting costs a false sale.
//
// ⚠️ UNKNOWN IS A GATE, NOT A PASS.
// react-query has no persister, so after a reload while offline `perms` is null.
// A null perms object means we cannot rule out a gate, so gate-relevant carts
// are treated as gated. It must NOT mean "everything is gated", or an offline
// shop could not sell at all — the gate-relevance test below deliberately needs
// no permissions data, only the cart.

const n = (v) => Number(v) || 0;

// The reasons a cart could need the server. Each is a property of the CART, not
// of the staffer — so this works with perms === null.
export function gateReasons(cart, opts = {}) {
  const { paidAmount, saleDiscountValue, perms } = opts;
  const items = Array.isArray(cart) ? cart : [];
  const reasons = [];

  const gross = items.reduce((s, i) => s + n(i.quantity) * n(i.unit_price), 0);

  // CREDIT — any unpaid balance. Uses the money, not payment_status: the label
  // has been wrong before and the server computes from the figures.
  if (paidAmount != null && n(paidAmount) < gross) reasons.push("credit");

  // DISCOUNT — sale-level or any line-level.
  if (n(saleDiscountValue) > 0) reasons.push("discount");
  else if (items.some((i) => n(i.discount_value) > 0)) reasons.push("discount");

  // BELOW-COST — any line under its own floor. min_price rides on the cart line
  // already (POSPage stamps it when the item is added).
  if (items.some((i) => n(i.min_price) > 0 && n(i.unit_price) < n(i.min_price)))
    reasons.push("below_cost");

  // OVERSELL — selling more than the till believes is there. available is
  // whatever the caller knows locally; absent means "cannot tell", not "fine".
  if (items.some((i) => i.available != null && n(i.quantity) > n(i.available)))
    reasons.push("oversell");

  // HIGH VALUE — the owner's own "ask me above X". Needs BOTH the amount and the
  // review stamp: an unconfirmed threshold is dormant server-side, so gating on
  // it would refuse sales the server would happily take.
  if (perms && perms.approve_above_amount != null && perms.approve_above_confirmed_at
      && gross >= n(perms.approve_above_amount)) {
    reasons.push("high_value");
  }

  return reasons;
}

export function needsServerDecision(cart, opts = {}) {
  return gateReasons(cart, opts).length > 0;
}

// The message shown when a gated cart cannot be completed because there is
// genuinely no network. Option 2 (Peter, 2026-08-24): refuse outright — nothing
// should ever show "completed" for a sale that isn't.
export function offlineRefusalMessage(reasons, lang) {
  const en = lang === "en";
  const has = (r) => reasons.includes(r);
  const why = has("credit")     ? (en ? "it is not paid in full" : "elle n'est pas entièrement payée")
            : has("below_cost") ? (en ? "a price is below the minimum" : "un prix est sous le minimum")
            : has("oversell")   ? (en ? "there is not enough stock" : "le stock est insuffisant")
            : has("discount")   ? (en ? "it has a discount" : "elle comporte une remise")
            : has("high_value") ? (en ? "it is a large sale" : "c'est une grosse vente")
            : (en ? "it needs approval" : "elle nécessite une approbation");
  return en
    ? `This sale needs the boss's approval because ${why}, and there is no connection right now. Take payment in full, or wait until you are back online.`
    : `Cette vente nécessite l'accord du patron car ${why}, et il n'y a pas de connexion. Encaissez le montant total, ou attendez le retour du réseau.`;
}
