// BAR MODE upgrade step 1.0 (Peter 2026-11-19): the tab's money, as the SERVER computed it
// (be-orange lib/barTabMoney.js — one source of truth): Ordered / Paid / Balance due, plus the
// service status and the payment status, which are independent of each other.
// Fixes "a round worth 24,700 FCFA while the tab shows 0" — the old line showed the served total only.
// No `figures` (a backend not yet updated — frontend deploys first) → the old single Total line.
import { useCurrency } from "../../utils/useCurrency";

const L = (lang, en, fr) => (lang === "en" ? en : fr);

export const serviceWord = (lang, s) => ({
  waiting: L(lang, "Waiting at the bar", "En attente au bar"),
  served: L(lang, "All served", "Tout servi"),
  nothing: L(lang, "Nothing ordered", "Rien commandé"),
}[s] || s);

export const paymentWord = (lang, s) => ({
  unpaid: L(lang, "Not paid", "Non payé"),
  part_paid: L(lang, "Part paid", "Payé en partie"),
  paid: L(lang, "Paid", "Payé"),
  nothing_due: L(lang, "Nothing to pay", "Rien à payer"),
}[s] || s);

const chip = (bg, fg) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color: fg });
const SERVICE_STYLE = { waiting: chip("rgba(245,158,11,.18)", "#b45309"), served: chip("rgba(16,185,129,.16)", "#047857"), nothing: chip("rgba(148,163,184,.2)", "#475569") };
const PAY_STYLE = { unpaid: chip("rgba(239,68,68,.14)", "#b91c1c"), part_paid: chip("rgba(245,158,11,.18)", "#b45309"), paid: chip("rgba(16,185,129,.16)", "#047857"), nothing_due: chip("rgba(148,163,184,.2)", "#475569") };

// Full block (the tab's bill footer)
export default function TabMoney({ lang, figures, fallbackTotal }) {
  const fmt = useCurrency();
  if (!figures) return <div className="bar-total"><span>{L(lang, "Total", "Total")}</span><b>{fmt(Number(fallbackTotal) || 0)}</b></div>;
  const f = figures;
  const row = (label, value, strong, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 600, color }}>
      <span>{label}</span><span>{fmt(value)}</span>
    </div>
  );
  return (
    <div className="bar-money" data-testid="tab-money" style={{ display: "grid", gap: 3, minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={SERVICE_STYLE[f.service_status]} data-status="service">{serviceWord(lang, f.service_status)}</span>
        <span style={PAY_STYLE[f.payment_status]} data-status="payment">{paymentWord(lang, f.payment_status)}</span>
      </div>
      {row(L(lang, "Ordered", "Commandé"), f.ordered)}
      {f.waiting > 0 && row(L(lang, "· of which waiting at the bar", "· dont en attente au bar"), f.waiting, false, "#b45309")}
      {row(L(lang, "Paid", "Payé"), f.paid)}
      {row(L(lang, "Balance due", "Reste à payer"), f.balance_due, true, f.balance_due > 0 ? "#b91c1c" : undefined)}
    </div>
  );
}

// One line (counter-tab lists)
export function tabMoneyLine(lang, figures, fmt) {
  if (!figures) return null;
  return `${L(lang, "Ordered", "Commandé")} ${fmt(figures.ordered)} · ${L(lang, "Balance due", "Reste à payer")} ${fmt(figures.balance_due)}`;
}
