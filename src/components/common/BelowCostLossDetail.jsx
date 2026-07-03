// MP-APPROVAL-PLAIN-LANGUAGE
//
// Plain-language below-cost approval detail for a non-technical boss. Shown
// everywhere a below_cost_sale approval surfaces (owner inbox card, owner PIN
// modal, cashier's My Requests) — ONE per-item line each, then a total loss.
// Includes the requesting cashier's name (trimmed; prod full_name has trailing
// spaces). English primary / French secondary via `en` (the host page gates by
// org currency, same as the receipt advert). `fmt` is useCurrency() (adds the
// FCFA/₦ symbol). `compact` shows just the total. Data comes from
// payload.below_cost[] (name, unit_price, floor/min_price, shortfall, qty) — no
// new fields.

export default function BelowCostLossDetail({ payload, shortfall, en, fmt, cashier, compact = false }) {
  const p = payload || {};
  const belowCost = Array.isArray(p.below_cost) ? p.below_cost : [];
  const who = String(cashier || "").trim() || (en ? "A cashier" : "Un caissier");

  const lineLoss = (l) => Number(l.shortfall)
    || Math.max(0, (Number(l.floor != null ? l.floor : l.min_price) || 0) - (Number(l.unit_price) || 0)) * (Number(l.qty) || 0);
  const totalLoss = belowCost.length
    ? belowCost.reduce((s, l) => s + lineLoss(l), 0)
    : (Number(shortfall != null ? shortfall : p.shortfall) || 0);

  return (
    <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      {!compact && belowCost.map((l, idx) => {
        const item = String(l.name || "").trim() || (en ? "this item" : "cet article");
        const unit = Number(l.unit_price) || 0;
        const floor = Number(l.floor != null ? l.floor : l.min_price) || 0;
        return (
          <div key={idx} style={{ marginBottom: 5 }}>
            {en
              ? `${who} wants to sell ${item} for ${fmt(unit)} — below the minimum price of ${fmt(floor)}. You lose ${fmt(lineLoss(l))} on this item.`
              : `${who} veut vendre ${item} à ${fmt(unit)} — en dessous du prix minimum de ${fmt(floor)}. Vous perdez ${fmt(lineLoss(l))} sur cet article.`}
          </div>
        );
      })}
      <div style={{ fontWeight: 700, color: "#fca5a5" }}>
        {en ? `Total loss: ${fmt(totalLoss)}` : `Perte totale : ${fmt(totalLoss)}`}
      </div>
    </div>
  );
}
