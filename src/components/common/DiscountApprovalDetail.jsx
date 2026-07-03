// MP-APPROVAL-PLAIN-LANGUAGE
//
// Plain-language DISCOUNT approval detail (mirror of BelowCostLossDetail). Shown
// on the owner inbox card, owner PIN modal, and the cashier's My Requests — ONE
// per-discounted-item line, then the cart total discount. Includes the requesting
// cashier's name (trimmed). EN primary / FR secondary via `en`. `fmt` is
// useCurrency() (adds FCFA/₦). Data from payload.items[] (name, quantity,
// unit_price, discount_type, discount_value) + payload.total_discount — no new
// fields. Only lines that actually carry a discount are listed.

// Mirror of the backend line-discount clamp so the per-line figure matches what
// the cashier actually deducted.
function resolveDisc(type, value, base) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return 0;
  const a = type === "percent" ? Math.round(base * v / 100) : Math.round(v);
  return Math.max(0, Math.min(a, Math.round(base)));
}

export default function DiscountApprovalDetail({ payload, en, fmt, cashier, compact = false }) {
  const p = payload || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const who = String(cashier || "").trim() || (en ? "A cashier" : "Un caissier");
  const discounted = items.filter((i) => i.discount_type && Number(i.discount_value) > 0);
  const total = Number(p.total_discount)
    || discounted.reduce((s, i) => s + resolveDisc(i.discount_type, i.discount_value, (Number(i.quantity) || 0) * (Number(i.unit_price) || 0)), 0);

  return (
    <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      {!compact && discounted.map((i, idx) => {
        const item = String(i.name || "").trim() || (en ? "this item" : "cet article");
        const gross = (Number(i.quantity) || 0) * (Number(i.unit_price) || 0);
        const lineDisc = resolveDisc(i.discount_type, i.discount_value, gross);
        // "10%" for a percent discount; "300 FCFA" for an amount discount.
        const val = i.discount_type === "percent" ? `${Number(i.discount_value)}%` : fmt(Number(i.discount_value) || 0);
        return (
          <div key={idx} style={{ marginBottom: 5 }}>
            {en
              ? `${who} wants to give a ${val} discount on ${item}. Discount: ${fmt(lineDisc)}.`
              : `${who} veut accorder une remise de ${val} sur ${item}. Remise : ${fmt(lineDisc)}.`}
          </div>
        );
      })}
      <div style={{ fontWeight: 700, color: "var(--brand-light)" }}>
        {en ? `Total discount: ${fmt(total)}` : `Remise totale : ${fmt(total)}`}
      </div>
    </div>
  );
}
