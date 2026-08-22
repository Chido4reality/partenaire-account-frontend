// MP-THRESHOLD-REVIEW / MP-APPROVAL-BUNDLE — the reason text for a bundled sale.
//
// WHY THIS IS A MODULE AND NOT INLINE JSX
// A bundled sale carries payload.actions[], and THREE separate places turn those
// into words: the POS sentence sent with the request, the POS confirmation modal,
// and the boss's ApprovalDetailView. Each was its own if/else chain over the same
// types, and every one of them DROPPED a type it did not recognise —
// POSPage returned "" into a .filter(Boolean), the modal filtered per known type,
// ApprovalDetailView's chain had no else.
//
// So adding a reason type on the server produced a request that listed every
// reason EXCEPT the new one, and the person who added it could never see the bug:
// their own build knows the type. An APK in the field is an older build by
// definition, so this is not a hypothetical — it is scheduled.
//
// One module, one fallback, and a pure function the mount harness can assert on
// directly. The modal branch is driven by component state that SSR cannot set, so
// without this the only "test" possible was rendering a page that never reaches
// the branch — a check that cannot fail.

// Every type this build knows. Anything outside it hits the fallback rather than
// vanishing. Keep in step with sales.js neededActions.push().
export const KNOWN_BUNDLE_TYPES = [
  "below_cost", "discount", "credit", "oversell", "sold_date", "high_value",
];

const money = (fmt, v) => (typeof fmt === "function" ? fmt(v) : String(v ?? ""));

// The phrase used in the REQUEST sentence — "Ada wants to <phrase>, and <phrase>".
// Always returns a non-empty string.
export function bundleSentence(a, lang, fmt) {
  const en = lang === "en";
  const t = a && a.type;
  if (t === "below_cost") {
    return en
      ? `sell "${a.name}" for ${money(fmt, a.attempted_price)} (below the ${money(fmt, a.min_price)} floor)`
      : `vendre "${a.name}" à ${money(fmt, a.attempted_price)} (sous le plancher de ${money(fmt, a.min_price)})`;
  }
  if (t === "discount") {
    return en ? `give a total discount of ${money(fmt, a.total_discount)}`
              : `accorder une remise totale de ${money(fmt, a.total_discount)}`;
  }
  if (t === "credit") {
    return en ? `sell ${money(fmt, a.balance_due)} on credit`
              : `vendre ${money(fmt, a.balance_due)} à crédit`;
  }
  if (t === "oversell") {
    const names = (a.items || []).map((it) => it.name).filter(Boolean).join(", ");
    return en ? `sell more than the stock shows (${names})`
              : `vendre plus que le stock affiché (${names})`;
  }
  if (t === "sold_date") {
    return en ? `record this sale as actually sold on ${a.sold_date}`
              : `enregistrer cette vente comme ayant eu lieu le ${a.sold_date}`;
  }
  if (t === "high_value") {
    // GROSS, and it says so. The cashier sees the discounted figure on screen and
    // would otherwise think the app is quoting the wrong number.
    return en ? `ring up a large sale of ${money(fmt, a.gross)} (before any discount)`
              : `enregistrer une grosse vente de ${money(fmt, a.gross)} (avant remise)`;
  }
  return en ? `do something that needs your approval (${t || "unknown"})`
            : `effectuer une action nécessitant votre approbation (${t || "inconnue"})`;
}

// The line shown in the POS confirmation modal. Same fallback guarantee.
export function bundleReasonLine(a, lang, fmt) {
  const en = lang === "en";
  const t = a && a.type;
  if (t === "credit") {
    return en ? `Credit sale: ${money(fmt, a.balance_due)} on the customer's account.`
              : `Vente à crédit : ${money(fmt, a.balance_due)} sur le compte du client.`;
  }
  if (t === "sold_date") {
    return en ? `Sold-date note: this sale will show as actually sold on ${a.sold_date}.`
              : `Note de date de vente : cette vente indiquera avoir eu lieu le ${a.sold_date}.`;
  }
  if (t === "high_value") {
    return en ? `Large sale: ${money(fmt, a.gross)} before any discount — the owner asked to approve sales this big.`
              : `Grosse vente : ${money(fmt, a.gross)} avant remise — le patron souhaite approuver les ventes de ce montant.`;
  }
  return en ? `Also needs approval (${t || "unknown"}) — update the app to see the detail.`
            : `Nécessite aussi une approbation (${t || "inconnue"}) — mettez l'application à jour pour le détail.`;
}
