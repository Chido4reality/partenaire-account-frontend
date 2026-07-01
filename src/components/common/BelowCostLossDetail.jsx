// MP-BELOW-COST-CLEAR-WORDING
//
// The amount on a below_cost_sale approval is the SHORTFALL — the total the
// line(s) fall BELOW the floor/min price — NOT the sale total. Shown bare as
// "150 FCFA" next to an item name it reads like a sale value and forces the
// owner to investigate. This shared block spells it out everywhere the below-
// cost approval surfaces (owner card, PIN modal, cashier's My Requests):
//   • the total loss below floor, clearly labelled
//   • the sale total, shown separately so the two can't be confused
//   • per-line make-up (qty × per-unit under floor = line loss) from
//     payload.below_cost, when space allows (compact hides the per-line list)
//
// fmt is the useCurrency() formatter from the host page.

// Mirror of the backend line-discount clamp so the sale total matches what the
// cashier actually collects (below-cost payloads rarely carry line discounts,
// but stay correct if they do).
function resolveDisc(type, value, base) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return 0;
  const a = type === "percent" ? Math.round(base * v / 100) : Math.round(v);
  return Math.max(0, Math.min(a, Math.round(base)));
}

export default function BelowCostLossDetail({ payload, shortfall, en, fmt, compact = false }) {
  const p = payload || {};
  const belowCost = Array.isArray(p.below_cost) ? p.below_cost : [];
  const items = Array.isArray(p.items) ? p.items : [];
  const loss = Number(shortfall != null ? shortfall : p.shortfall) || 0;

  const saleTotal = items.reduce((s, i) => {
    const gross = (Number(i.quantity) || 0) * (Number(i.unit_price) || 0);
    return s + (gross - resolveDisc(i.discount_type, i.discount_value, gross));
  }, 0);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5" }}>
        {en
          ? `⚠️ Below floor price — total loss: ${fmt(loss)}`
          : `⚠️ En dessous du prix plancher — perte totale : ${fmt(loss)}`}
      </div>
      {saleTotal > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
          {en ? `Sale total: ${fmt(saleTotal)}` : `Total de la vente : ${fmt(saleTotal)}`}
        </div>
      )}
      {!compact && belowCost.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
          {belowCost.map((l, idx) => {
            const qty = Number(l.qty) || 0;
            const floor = Number(l.floor != null ? l.floor : l.min_price) || 0;
            const unit = Number(l.unit_price) || 0;
            const under = Math.max(0, floor - unit); // per-unit shortfall
            return (
              <div key={idx}>
                • {(l.name || "").trim() || (en ? "item" : "article")}: {qty} × {fmt(under)} {en ? "under floor" : "sous le plancher"} = {fmt(Number(l.shortfall) || under * qty)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
