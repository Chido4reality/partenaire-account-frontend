// MP-DAY-SUMMARY: the SINGLE bilingual builder for the end-of-day WhatsApp summary.
// This is the shared "content engine" — both the owner on-demand button (Path 2)
// and the deferred blind shift-close path feed it a content object; it decides
// wording + which lines to emit. Money never disagrees with the app because the
// caller passes the same figures the Daily screen shows (Path 2) / the same
// /reports/day-summary figures the screen's /reports/daily uses (shift-close).
//
// A line is only emitted when its figure exists, so an empty day stays short.
export function buildDaySummaryText(content, { lang, fmt, shopName, dateLabel }) {
  const en = lang === "en";
  const {
    sales, sale_count, margin_pct,
    top_staff, net_cash, credit,
    things_to_check, has_daily,
  } = content || {};

  const L = [`📊 ${shopName || "Mon Partenaire"} — ${dateLabel}`];
  if (Number(sale_count) > 0) {
    L.push(`${en ? "Sales" : "Ventes"}: ${fmt(sales)} (${sale_count})`);
    L.push(`${en ? "Margin" : "Marge"}: ${margin_pct}%`);
  }
  if (top_staff && top_staff.name) {
    L.push(`${en ? "Top staff" : "Meilleur vendeur"}: ${top_staff.name} (${fmt(top_staff.total)})`);
  }
  if (has_daily) L.push(`${en ? "Net cash" : "Encaisse nette"}: ${fmt(net_cash)}`);
  if (Number(credit) > 0) L.push(`${en ? "Credit given" : "Crédit accordé"}: ${fmt(credit)}`);
  if (Number(things_to_check) > 0) {
    L.push(`⚠️ ${things_to_check} ${en ? "to check" : "à vérifier"}`);
  }
  if (L.length === 1) L.push(en ? "No sales for this day." : "Aucune vente ce jour.");
  return L.join("\n");
}
