// MP-TXN-HISTORY — read-only full-history timeline of one transaction
// (sold → returned/swapped → refunded, to any depth). Renders the `history` payload
// attached to GET /sales/:id (assembled server-side in lib/saleHistory.js). Display-only:
// it never triggers a write. Returns null for a plain sale with no evolution.
//
// Summary (top): NET = cash in − refunds out = the cash the shop still holds for this
// sale (the MAX still refundable). Labeled by sign so it can never be misread as "owed":
// net > 0 → cash held; net < 0 → owed to customer; 0 → settled. Below it: the price of
// the item(s) in the most recent return, so staff can explain the net to the customer.

export default function TransactionTimeline({ history, lang = "fr", fmt }) {
  const en = lang === "en";
  if (!history || !history.summary || !history.summary.has_evolution) return null;
  const { events = [], summary = {} } = history;
  const money = (n) => (fmt ? fmt(n) : Number(n || 0).toLocaleString());

  const when = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(en ? "en-GB" : "fr-FR",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return String(iso); }
  };
  const staffOf = (e) => e.staff || (en ? "unknown staff" : "personnel inconnu");
  const itemsLabel = (arr) => (arr || []).map((l) => `${l.qty}× ${l.name}`).join(", ");

  const net = Number(summary.net || 0);
  // Sign-aware label — money-safety: a positive net is cash the shop HOLDS, not owed.
  const netLabel = net > 0
    ? (en ? "Net cash held (max refundable)" : "Solde net encaissé (remb. max)")
    : net < 0
      ? (en ? "Refund owed to customer" : "Remboursement dû au client")
      : (en ? "Settled — nothing owed" : "Réglé — rien dû");
  const netColor = net > 0 ? "#34d399" : net < 0 ? "#f87171" : "var(--text-muted)";

  const dot = { sold: "🧾", swap: "🔄", refund: "↩️" };
  const eventTitle = (e) => {
    if (e.kind === "sold") return en ? "Sold" : "Vendu";
    if (e.kind === "swap") return en ? "Returned & swapped" : "Retourné et échangé";
    return en ? "Refunded" : "Remboursé";
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
        🕑 {en ? "Transaction history" : "Historique de la transaction"}
      </div>

      {/* Dual summary — NET prominent on top, per-item price below */}
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{netLabel}</span>
          <span style={{ fontWeight: 800, fontSize: 20, color: netColor }}>{money(Math.abs(net))}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {en ? "Paid in" : "Encaissé"} {money(summary.cash_in)} · {en ? "Refunded" : "Remboursé"} {money(summary.refunded_out)}
          {Number(summary.debt_reversed) > 0 && (
            <> · {en ? "of which debt reversed" : "dont dette annulée"} {money(summary.debt_reversed)}</>
          )}
        </div>
        {Number(summary.last_returned_value) > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
            {en ? "Price of item returned" : "Prix de l'article retourné"}:{" "}
            <strong>{money(summary.last_returned_value)}</strong>
          </div>
        )}
      </div>

      {/* Chronological chain, oldest → newest */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0 }}>{dot[e.kind] || "•"}</span>
            <div style={{ flex: 1 }}>
              <div>
                <strong>{eventTitle(e)}</strong>
                {" "}{en ? "by" : "par"} <strong>{staffOf(e)}</strong>
                <span style={{ color: "var(--text-muted)" }}> · {when(e.at)}{e.ref ? ` · ${e.ref}` : ""}</span>
              </div>
              {e.kind === "sold" && (
                <div style={{ color: "var(--text-secondary)" }}>
                  {itemsLabel(e.items)}{e.items?.length ? " · " : ""}{money(e.amount)}
                </div>
              )}
              {e.kind === "swap" && (
                <div style={{ color: "var(--text-secondary)" }}>
                  {en ? "Returned" : "Retourné"} {itemsLabel(e.returned)}
                  {e.replacement?.length ? <> → {en ? "took" : "pris"} {itemsLabel(e.replacement)}</> : null}
                  {e.price_difference > 0 && (
                    <span style={{ color: "#34d399" }}> · {en ? "customer paid" : "client a payé"} +{money(e.price_difference)}</span>
                  )}
                  {e.price_difference < 0 && (
                    <span style={{ color: "#f87171" }}> · {en ? "refunded" : "remboursé"} {money(Math.abs(e.price_difference))}</span>
                  )}
                </div>
              )}
              {e.kind === "refund" && (
                <div style={{ color: "var(--text-secondary)" }}>
                  {itemsLabel(e.returned)}
                  <span style={{ color: "#f87171" }}> · −{money(e.refund_amount)}</span>
                  {e.refund_method ? ` (${e.refund_method})` : ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
