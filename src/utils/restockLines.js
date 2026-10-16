// To Buy line rules — pure, shared by RestockPage and its release check.

// GOODS-BUFFER (Peter, 2026-10-16): a row the Goods Buffer fully covers comes back with
// Buy 0 — it is on the list for its "transfer it" hint, not to be ordered. It starts
// UNTICKED; ticking it only matters once a quantity is typed.
export const restockLineDefault = (suggested) => ({ checked: Number(suggested) > 0, qty: suggested });

// What "Send to supplier (N)" counts and what the WhatsApp order carries: ticked lines with a
// quantity above 0 — never a Buy-0 line, ticked or not. Exported for the release check.
export function restockSendItems({ buyRows, lines, manual, en }) {
  const out = [];
  for (const r of buyRows || []) {
    const st = (lines || {})[r.product_id] || restockLineDefault(r.suggested_qty);
    if (st.checked && Number(st.qty) > 0) out.push({ product_id: r.product_id, name: en ? (r.name_en || r.name) : r.name, quantity: Number(st.qty) });
  }
  for (const m of manual || []) {
    if (m.checked && Number(m.qty) > 0) out.push({ product_id: m.product_id, name: m.name, quantity: Number(m.qty) });
  }
  return out;
}
