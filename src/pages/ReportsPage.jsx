import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore, useAuthStore, useSettingsStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";
import VoidReturnModal from "../components/common/VoidReturnModal";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

// Shared receipt-code generator (Sprint K). Code128 (sync canvas) +
// QR (async) → data URLs that print cleanly. Used by the per-sale
// receipt print so it matches the POS receipt.
async function genSaleCodes(saleNumber) {
  let barcode = "";
  try {
    const c = document.createElement("canvas");
    JsBarcode(c, saleNumber, { format: "CODE128", width: 2, height: 44, displayValue: false, margin: 0 });
    barcode = c.toDataURL("image/png");
  } catch { /* ignore */ }
  let qr = "";
  try { qr = await QRCode.toDataURL(saleNumber, { margin: 1, width: 130 }); } catch { /* ignore */ }
  return { barcode, qr };
}

export default function ReportsPage() {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const isOwner = user?.role === "owner";

  const [tab, setTab] = useState("daily");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [expandedSale, setExpandedSale] = useState(null);
  const [voidSale, setVoidSale] = useState(null);
  const { selectedLocation } = useSettingsStore();
  const [ledgerDate, setLedgerDate] = useState(new Date().toISOString().split("T")[0]);
  const [ledgerLoc, setLedgerLoc] = useState(selectedLocation?.id || "all");

  // Deep-link from the global order search: /reports?sale=<id>&on=<YYYY-MM-DD>.
  // Jump to the Sales Detail tab, widen the range to that day so the
  // sale is in the result set, expand it, then strip the params so a
  // refresh doesn't re-pin the view.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const saleId = p.get("sale");
    if (!saleId) return;
    const on = p.get("on");
    setTab("sales");
    if (on) { setFrom(on); setTo(on); }
    setExpandedSale(saleId);
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, clean);
  }, []);

  const setPreset = (days) => {
    const d = new Date();
    const f = new Date();
    if (days === 0) { f.setHours(0,0,0,0); }
    else f.setDate(f.getDate() - days);
    setFrom(f.toISOString().split("T")[0]);
    setTo(d.toISOString().split("T")[0]);
  };

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["reports-daily", from, to],
    queryFn: () => api.get("/reports/daily?from=" + from + "&to=" + to).then(r => r.data)
  });

  const { data: debtData, isLoading: debtLoading } = useQuery({
    queryKey: ["reports-debts"],
    queryFn: () => api.get("/reports/debts").then(r => r.data)
  });

  const { data: salesDetailData, isLoading: salesDetailLoading } = useQuery({
    queryKey: ["reports-sales-detail", from, to],
    queryFn: () => api.get(`/reports/sales-detail?from=${from}&to=${to}`).then(r => r.data),
    enabled: tab === "sales"
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const { data: todaySalesData, isLoading: todayLoading } = useQuery({
    queryKey: ["reports-today-sales"],
    queryFn: () => api.get(`/reports/sales-detail?date=${todayStr}`).then(r => r.data),
    enabled: tab === "daily_sales",
    refetchInterval: 60000
  });

  const { data: topProductsData, isLoading: topLoading } = useQuery({
    queryKey: ["reports-top-products", from, to],
    queryFn: () => api.get(`/reports/top-products?from=${from}&to=${to}`).then(r => r.data),
    enabled: tab === "products"
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    staleTime: 300000
  });
  const ledgerLocations = locationsData?.data || [];

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ["reports-ledger", ledgerDate, ledgerLoc],
    queryFn: () => api.get(`/reports/daily-ledger?date=${ledgerDate}&location_id=${ledgerLoc}`).then(r => r.data),
    enabled: tab === "ledger"
  });
  const ledger = ledgerData?.data || null;

  const printLedger = () => {
    if (!ledger) return;
    const L = [];
    const line = (l, r) => `${String(l).padEnd(24)}${String(r).padStart(14)}`;
    L.push("DAILY LEDGER");
    L.push(ledger.date + (ledger.location ? " — " + ledger.location.name : " — All locations"));
    L.push("------------------------------------");
    L.push("SALES");
    ledger.sales_by_product.forEach(g =>
      L.push(line(`${g.product_name} ${g.qty}x${g.unit_price}`, g.line_total.toLocaleString())));
    L.push("------------------------------------");
    L.push(line("Total sales:", ledger.gross_sales.toLocaleString()));
    if (ledger.returns_total > 0) {
      L.push(""); L.push("RETURNS");
      ledger.returns_today.forEach(r =>
        L.push(line(`${r.ret_ref} ${r.items_summary}`, "-" + r.refund_amount.toLocaleString())));
      L.push(line("Total returns:", "-" + ledger.returns_total.toLocaleString()));
      L.push(line("Net sales:", ledger.net_sales.toLocaleString()));
    }
    if (ledger.expenses_total > 0) {
      L.push(""); L.push("EXPENSES");
      ledger.expenses.forEach(e =>
        L.push(line(`${e.category ? e.category + " - " : ""}${e.description}`, "-" + e.amount.toLocaleString())));
      L.push(line("Total expenses:", "-" + ledger.expenses_total.toLocaleString()));
    }
    L.push("====================================");
    L.push(line("CASH BALANCE:", ledger.cash_balance.toLocaleString() + " FCFA"));
    L.push("====================================");
    const w = window.open("", "_blank", "width=380,height=600");
    w.document.write(`<pre style="font:12px/1.5 monospace;padding:12px;white-space:pre-wrap">${L.join("\n")}</pre>`);
    w.document.close(); w.focus(); setTimeout(() => { w.print(); }, 250);
  };

  const exportLedgerCSV = () => {
    if (!ledger) return;
    const rows = [["section", "description", "qty", "unit_price", "amount"]];
    ledger.sales_by_product.forEach(g => rows.push(["sale", g.product_name, g.qty, g.unit_price, g.line_total]));
    rows.push(["", "Total sales", "", "", ledger.gross_sales]);
    ledger.returns_today.forEach(r => rows.push(["return", `${r.ret_ref} ${r.items_summary}`, "", "", -r.refund_amount]));
    if (ledger.returns_total > 0) {
      rows.push(["", "Total returns", "", "", -ledger.returns_total]);
      rows.push(["", "Net sales", "", "", ledger.net_sales]);
    }
    ledger.expenses.forEach(e => rows.push(["expense", `${e.category ? e.category + " - " : ""}${e.description}`, "", "", -e.amount]));
    if (ledger.expenses_total > 0) rows.push(["", "Total expenses", "", "", -ledger.expenses_total]);
    rows.push(["", "CASH BALANCE", "", "", ledger.cash_balance]);
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ledger-${ledger.date}.csv`; a.click();
  };

  const shareLedgerWhatsApp = () => {
    if (!ledger) return;
    const en = lang === "en";
    const n = (x) => Number(x || 0).toLocaleString(en ? "en-US" : "fr-FR");
    const locName = ledger.location ? ledger.location.name : (en ? "All locations" : "Tous les sites");
    const longDate = new Date(ledger.date + "T00:00:00").toLocaleDateString(en ? "en-GB" : "fr-FR",
      { day: "numeric", month: "long", year: "numeric" });
    const L = [];
    L.push(`📊 ${en ? "Daily Ledger" : "Journal de Caisse"} — ${locName}`);
    L.push(longDate);
    L.push("");
    L.push(en ? "SALES" : "VENTES");
    ledger.sales_by_product.forEach(g =>
      L.push(`• ${g.product_name}  ${g.qty} × ${n(g.unit_price)} = ${n(g.line_total)}`));
    L.push(`${en ? "Total sales" : "Total ventes"}: ${n(ledger.gross_sales)} FCFA`);
    if (ledger.returns_total > 0) {
      L.push("");
      L.push(en ? "RETURNS" : "RETOURS");
      ledger.returns_today.forEach(r =>
        L.push(`• ${r.ret_ref} ${r.items_summary}  -${n(r.refund_amount)}`));
      L.push(`${en ? "Total returns" : "Total retours"}: -${n(ledger.returns_total)} FCFA`);
    }
    if (ledger.expenses_total > 0) {
      L.push("");
      L.push(en ? "EXPENSES" : "DÉPENSES");
      ledger.expenses.forEach(e =>
        L.push(`• ${e.category ? e.category + " (" + e.description + ")" : e.description}  -${n(e.amount)}`));
      L.push(`${en ? "Total expenses" : "Total dépenses"}: -${n(ledger.expenses_total)} FCFA`);
    }
    L.push("");
    L.push("═════════════════════");
    L.push(`${en ? "Cash balance" : "Solde caisse"}: ${n(ledger.cash_balance)} FCFA`);
    L.push("═════════════════════");
    L.push("");
    L.push(en ? "Sent from Mon Partenaire POS" : "Envoyé depuis Mon Partenaire POS");
    window.open(`https://wa.me/?text=${encodeURIComponent(L.join("\n"))}`, "_blank");
  };

  const { data: returnsData, isLoading: returnsLoading } = useQuery({
    queryKey: ["reports-returns", from, to],
    queryFn: () => api.get(`/returns?from=${from}&to=${to}`).then(r => r.data),
    enabled: tab === "returns"
  });
  const returns = returnsData?.data || [];
  const returnsStats = returnsData?.stats || {};

  const daily = dailyData?.data || [];
  const debts = debtData?.data || [];
  const salesDetail = salesDetailData?.data || [];
  const topProducts = topProductsData?.data || [];
  const todaySales = todaySalesData?.data || [];

  const totals = daily.reduce((acc, d) => ({
    gross_sales:       acc.gross_sales       + (+d.gross_sales || 0),
    cash_collected:    acc.cash_collected    + (+d.cash_collected || 0),
    credit_sales:      acc.credit_sales      + (+d.credit_sales || 0),
    total_cost:        acc.total_cost        + (+d.total_cost || 0),
    gross_profit:      acc.gross_profit      + (+d.gross_profit || 0),
    total_expenditure: acc.total_expenditure + (+d.total_expenditure || 0),
    net_profit:        acc.net_profit        + (+d.net_profit || 0),
    sale_count:        acc.sale_count        + (+d.sale_count || 0),
  }), { gross_sales:0, cash_collected:0, credit_sales:0, total_cost:0, gross_profit:0, total_expenditure:0, net_profit:0, sale_count:0 });

  const avgMargin = daily.length > 0
    ? (daily.reduce((s, d) => s + (+d.profit_margin_pct || 0), 0) / daily.length).toFixed(1)
    : 0;

  const totalDebt = debts.reduce((s, c) => s + (+c.total_debt || 0), 0);

  const exportCSV = () => {
    const headers = ["Date","Sales","Cash Collected","Credit Sales","Cost","Gross Profit","Margin%","Expenses","Net Profit","Transactions"];
    const rows = daily.map(d => [d.sale_date, d.gross_sales, d.cash_collected, d.credit_sales, d.total_cost, d.gross_profit, d.profit_margin_pct, d.total_expenditure, d.net_profit, d.sale_count]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "report_" + from + "_" + to + ".csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportSalesCSV = () => {
    const rows = [["Sale#", "Date", "Customer", "Product", "Qty", "Unit Price", "Line Total", "Payment Status"]];
    salesDetail.forEach(sale => {
      (sale.pa_sale_items || []).forEach(item => {
        rows.push([
          sale.sale_number,
          sale.sale_date,
          sale.pa_customers?.name || "Walk-in",
          item.pa_products?.name || "",
          item.quantity,
          item.unit_price,
          (item.quantity * item.unit_price).toFixed(0),
          sale.payment_status
        ]);
      });
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "sales_detail_" + from + "_" + to + ".csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Group sales by date for the Sales Detail tab
  const salesByDate = {};
  salesDetail.forEach(sale => {
    const date = sale.sale_date || sale.created_at?.split("T")[0];
    if (!salesByDate[date]) salesByDate[date] = [];
    salesByDate[date].push(sale);
  });
  const sortedDates = Object.keys(salesByDate).sort((a, b) => b.localeCompare(a));

  const TABS = [
    { key: "daily",       en: "Daily Summary",   fr: "Résumé journalier" },
    { key: "sales",       en: "Sales Detail",    fr: "Détail des ventes" },
    { key: "daily_sales", en: "Daily Sales",     fr: "Ventes du jour" },
    { key: "ledger",      en: "Daily Ledger",    fr: "Livre de caisse" },
    { key: "products",    en: "Top Products",    fr: "Meilleurs produits" },
    { key: "debts",       en: "Debt Report",     fr: "Rapport crédits" },
    { key: "returns",     en: "Returns",         fr: "Retours" },
  ];

  const DateFilter = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label className="label" style={{ margin: 0 }}>{lang === "en" ? "From" : "Du"}</label>
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label className="label" style={{ margin: 0 }}>{lang === "en" ? "To" : "Au"}</label>
        <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
      </div>
      {[
        { en: "Today", fr: "Aujourd'hui", days: 0 },
        { en: "7 days", fr: "7 jours", days: 7 },
        { en: "30 days", fr: "30 jours", days: 30 },
      ].map(p => (
        <button key={p.days} className="btn btn-secondary btn-sm" onClick={() => setPreset(p.days)}>
          {lang === "en" ? p.en : p.fr}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Reports" : "Rapports"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "daily" && <button className="btn btn-secondary" onClick={exportCSV}>📊 {lang === "en" ? "Export CSV" : "Exporter CSV"}</button>}
          {tab === "sales" && <button className="btn btn-secondary" onClick={exportSalesCSV}>📊 {lang === "en" ? "Export CSV" : "Exporter CSV"}</button>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? t.en : t.fr}
          </button>
        ))}
      </div>

      {/* ── DAILY SUMMARY ── */}
      {tab === "daily" && (
        <div>
          <DateFilter />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: lang === "en" ? "Total sales" : "Ventes totales", value: formatCFA(totals.gross_sales), sub: totals.sale_count + " transactions", color: "var(--brand-light)" },
              { label: lang === "en" ? "Cash collected" : "Espèces encaissées", value: formatCFA(totals.cash_collected), color: "#34d399" },
              { label: lang === "en" ? "Gross profit" : "Bénéfice brut", value: formatCFA(totals.gross_profit), sub: avgMargin + "% avg", color: "#34d399" },
              { label: lang === "en" ? "Expenses" : "Dépenses", value: formatCFA(totals.total_expenditure), color: "#f87171" },
              { label: lang === "en" ? "Net profit" : "Bénéfice net", value: formatCFA(totals.net_profit), color: totals.net_profit >= 0 ? "#34d399" : "#f87171" },
              { label: lang === "en" ? "Credit sales" : "Ventes crédit", value: formatCFA(totals.credit_sales), color: "#fbbf24" },
            ].map(card => (
              <div key={card.label} className="stat-card">
                <div className="stat-label">{card.label}</div>
                <div className="stat-value" style={{ color: card.color, fontSize: 18 }}>{card.value}</div>
                {card.sub && <div className="stat-sub">{card.sub}</div>}
              </div>
            ))}
          </div>

          {dailyLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : daily.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No sales in this period" : "Aucune vente sur cette période"}</div></div>
          : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 700 }}>
                <thead><tr>
                  <th>Date</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Sales" : "Ventes"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Cash" : "Espèces"}</th>
                  {isOwner && <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost" : "Coût"}</th>}
                  {isOwner && <th style={{ textAlign: "right" }}>{lang === "en" ? "Gross profit" : "Bénéfice brut"}</th>}
                  {isOwner && <th style={{ textAlign: "right" }}>Margin</th>}
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Expenses" : "Dépenses"}</th>
                  {isOwner && <th style={{ textAlign: "right" }}>{lang === "en" ? "Net profit" : "Bénéfice net"}</th>}
                </tr></thead>
                <tbody>
                  {daily.map((d, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{formatDate(d.sale_date, lang)}</td>
                      <td style={{ textAlign: "right" }}>{formatCFA(d.gross_sales)}<div style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.sale_count} sales</div></td>
                      <td style={{ textAlign: "right", color: "#34d399" }}>{formatCFA(d.cash_collected)}</td>
                      {isOwner && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{formatCFA(d.total_cost)}</td>}
                      {isOwner && <td style={{ textAlign: "right", color: "#34d399", fontWeight: 500 }}>{formatCFA(d.gross_profit)}</td>}
                      {isOwner && <td style={{ textAlign: "right" }}><span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: d.profit_margin_pct > 20 ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: d.profit_margin_pct > 20 ? "#34d399" : "#fbbf24" }}>{d.profit_margin_pct}%</span></td>}
                      <td style={{ textAlign: "right", color: "#f87171" }}>{formatCFA(d.total_expenditure)}</td>
                      {isOwner && <td style={{ textAlign: "right", fontWeight: 700, color: d.net_profit >= 0 ? "#34d399" : "#f87171" }}>{formatCFA(d.net_profit)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
                    <td style={{ padding: "12px 16px" }}>TOTAL</td>
                    <td style={{ textAlign: "right", padding: "12px 16px" }}>{formatCFA(totals.gross_sales)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{formatCFA(totals.cash_collected)}</td>
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-secondary)" }}>{formatCFA(totals.total_cost)}</td>}
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{formatCFA(totals.gross_profit)}</td>}
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px" }}>{avgMargin}%</td>}
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#f87171" }}>{formatCFA(totals.total_expenditure)}</td>
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: totals.net_profit >= 0 ? "#34d399" : "#f87171" }}>{formatCFA(totals.net_profit)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SALES DETAIL ── */}
      {tab === "sales" && (
        <div>
          <DateFilter />
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            {lang === "en" ? "Click any sale to see items sold" : "Cliquez sur une vente pour voir les articles vendus"}
          </div>

          {salesDetailLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : salesDetail.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No sales in this period" : "Aucune vente"}</div></div>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {sortedDates.map(date => {
                const daySales = salesByDate[date];
                const dayTotal = daySales.reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const dayReturns = daySales.reduce((s, sale) => s + (Number(sale.refunded_total) || 0), 0);
                const dayNet = dayTotal - dayReturns;
                return (
                  <div key={date}>
                    {/* Date header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 8, border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>📅 {formatDate(date, lang)}</div>
                      <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                        <span style={{ color: "var(--text-muted)" }}>{daySales.length} {lang === "en" ? "sales" : "ventes"}</span>
                        {dayReturns > 0 ? (
                          <>
                            <span style={{ color: "var(--text-muted)", textDecoration: "line-through" }}>{formatCFA(dayTotal)}</span>
                            <span style={{ color: "#f87171" }}>↩ -{formatCFA(dayReturns)}</span>
                            <span style={{ fontWeight: 800, color: "var(--brand-light)" }}>{formatCFA(dayNet)} {lang === "en" ? "NET" : "NET"}</span>
                          </>
                        ) : (
                          <span style={{ fontWeight: 700, color: "var(--brand-light)" }}>{formatCFA(dayTotal)}</span>
                        )}
                      </div>
                    </div>

                    {/* Sales for this day */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {daySales.map(sale => {
                        const isExpanded = expandedSale === sale.id;
                        const items = sale.pa_sale_items || [];
                        const statusColor = sale.payment_status === "paid" ? "#34d399" : sale.payment_status === "partial" ? "#fbbf24" : "#f87171";
                        return (
                          <div key={sale.id} style={{ background: "var(--bg-card)", border: `1px solid ${isExpanded ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", transition: "all 0.15s" }}>
                            {/* Sale header - clickable */}
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                              <div onClick={() => setExpandedSale(isExpanded ? null : sale.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 2 }}>
                                  <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{sale.sale_number}</span>
                                  <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: statusColor + "20", color: statusColor, fontWeight: 600 }}>
                                    {sale.payment_status}
                                  </span>
                                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sale.payment_method}</span>
                                  {(sale.has_returns || (sale.returns || []).length > 0) && (
                                    <span onClick={(e) => { e.stopPropagation(); setExpandedSale(sale.id); }}
                                      title={lang === "en" ? "Show return details" : "Voir les détails du retour"}
                                      style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "rgba(248,113,113,0.15)", color: "#f87171", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                                      ↩ {lang === "en" ? "Return" : "Retour"} ({(sale.returns || []).length})
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                  {sale.pa_customers?.name || (lang === "en" ? "Walk-in customer" : "Client de passage")}
                                  {" · "}
                                  {items.length} {lang === "en" ? "item(s)" : "article(s)"}
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                {Number(sale.refunded_total) > 0 ? (
                                  <>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "line-through" }}>{formatCFA(sale.total_amount)}</div>
                                    <div style={{ fontWeight: 800, fontSize: 15, color: Number(sale.net_amount) <= 0 ? "var(--text-muted)" : "var(--brand-light)" }}>
                                      {formatCFA(sale.net_amount)} {lang === "en" ? "NET" : "NET"}
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ fontWeight: 800, fontSize: 15, color: "var(--brand-light)" }}>{formatCFA(sale.total_amount)}</div>
                                )}
                                {sale.balance_due > 0 && <div style={{ fontSize: 11, color: "#f87171" }}>Due: {formatCFA(sale.balance_due)}</div>}
                              </div>
                                <div style={{ color: "var(--text-muted)", fontSize: 16, transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "none" }}>›</div>
                              </div>
                              {/* WhatsApp + Print per sale */}
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => setVoidSale(sale)}
                                  title="Void/Return"
                                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>
                                  ↩️
                                </button>
                                <button onClick={() => {
                                  const items = sale.pa_sale_items || [];
                                  const total = items.reduce((s,i) => s + i.quantity * i.unit_price, 0);
                                  let msg = `🧾 *Reçu*\n📅 ${sale.sale_date}\nN° ${sale.sale_number}\n─────────────────────\n`;
                                  items.forEach(i => { msg += `${i.pa_products?.name} × ${i.quantity} ... ${(i.quantity * i.unit_price).toLocaleString()} F\n`; });
                                  msg += `─────────────────────\n*Total: ${total.toLocaleString()} FCFA*`;
                                  if (sale.payment_status === "credit") msg += `\n🔴 CRÉDIT: ${total.toLocaleString()} F DÛ`;
                                  else if (sale.payment_status === "partial") msg += `\n🟡 PARTIEL — Reste: ${sale.balance_due?.toLocaleString()} F`;
                                  const phone = sale.pa_customers?.phone ? "237" + sale.pa_customers.phone.toString().replace(/^0/,"").replace(/\s/g,"") : "";
                                  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                                }} style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                  📱
                                </button>
<button onClick={async () => {
                                  const items = sale.pa_sale_items || [];
                                  const total = items.reduce((s,i) => s + i.quantity * i.unit_price, 0);
                                  const codes = sale.sale_number ? await genSaleCodes(sale.sale_number) : { barcode: "", qr: "" };
                                  const w = window.open("","_blank","width=350,height=500");
                                  w.document.write(`<html><head><style>body{font-family:monospace;font-size:12px;width:300px;margin:0 auto}.row{display:flex;justify-content:space-between}.line{border-top:1px dashed #000;margin:6px 0}.bold{font-weight:bold;font-size:14px}.center{text-align:center}</style></head><body>
                                    <div class="center" style="font-weight:bold;font-size:14px;margin-bottom:4px">REÇU</div>
                                    <div class="center">${sale.sale_date}</div>
                                    <div class="center" style="font-size:15px;font-weight:bold;margin:4px 0">${sale.sale_number || ""}</div>
                                    ${sale.pa_customers?.name ? `<div class="center">Client: ${sale.pa_customers.name}</div>` : ""}
                                    <div class="line"></div>
                                    ${items.map(i => `<div class="row"><span>${i.pa_products?.name} ×${i.quantity}</span><span>${(i.quantity*i.unit_price).toLocaleString()} F</span></div>`).join("")}
                                    <div class="line"></div>
                                    <div class="row bold"><span>TOTAL</span><span>${total.toLocaleString()} FCFA</span></div>
                                    ${sale.payment_status === "credit" ? `<div class="row" style="color:red"><span>🔴 CRÉDIT DÛ</span><span>${total.toLocaleString()} F</span></div>` : ""}
                                    ${sale.payment_status === "partial" ? `<div class="row" style="color:orange"><span>🟡 RESTE DÛ</span><span>${sale.balance_due?.toLocaleString()} F</span></div>` : ""}
                                    <div class="line"></div>
                                    ${codes.barcode ? `<div class="center"><img src="${codes.barcode}" style="height:44px;image-rendering:pixelated"/></div>` : ""}
                                    ${codes.qr ? `<div class="center"><img src="${codes.qr}" style="width:110px;height:110px"/></div>` : ""}
                                    ${sale.sale_number ? `<div class="center" style="font-size:11px">${sale.sale_number}</div>` : ""}
                                  </body></html>`);
                                  w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close(); }, 400);
                                }} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>
                                  🖨️
                                </button>
                              </div>
                            </div>

                            {/* Expanded items */}
                            {isExpanded && (
                              <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                                {items.map((item, idx) => (
                                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: idx < items.length - 1 ? "1px solid var(--border)" : "none" }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.pa_products?.name}</div>
                                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        {item.quantity} {item.pa_products?.unit} × {formatCFA(item.unit_price)}
                                      </div>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--brand-light)" }}>
                                      {formatCFA(item.quantity * item.unit_price)}
                                    </div>
                                  </div>
                                ))}
                                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", borderTop: "1px solid var(--border)", fontWeight: 700 }}>
                                  <span>{lang === "en" ? "Sold total" : "Total vendu"}</span>
                                  <span style={{ color: "var(--brand-light)" }}>{formatCFA(sale.total_amount)}</span>
                                </div>
                                {(sale.returns || []).length > 0 && (
                                  <div style={{ borderTop: "2px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.06)" }}>
                                    <div style={{ padding: "8px 20px", fontWeight: 700, fontSize: 12, color: "#f87171" }}>
                                      ↩ {lang === "en" ? "Returns linked to this sale" : "Retours liés à cette vente"}
                                    </div>
                                    {sale.returns.map(r => (
                                      <div key={r.id} style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                                          <span style={{ fontFamily: "monospace" }}>{r.return_ref}</span>
                                          <span style={{ color: "#f87171" }}>-{formatCFA(r.refund_amount)} {r.refund_method && r.refund_method !== "none" ? `(${r.refund_method})` : ""}</span>
                                        </div>
                                        <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                                          {new Date(r.created_at).toLocaleString()} · {r.processed_by_name || "—"}
                                          {r.reason ? ` · ${lang === "en" ? "reason" : "raison"}: ${r.reason}` : ""}
                                          {r.return_type ? ` · ${r.return_type}` : ""}
                                        </div>
                                        {(r.items_returned || []).map((ri, j) => (
                                          <div key={j} style={{ color: "var(--text-muted)", marginTop: 2 }}>
                                            • {ri.name || ri.product_id} × {ri.qty || ri.quantity} @ {formatCFA(ri.unit_price || 0)}
                                          </div>
                                        ))}
                                      </div>
                                    ))}
                                    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", borderTop: "1px solid var(--border)", fontWeight: 800 }}>
                                      <span>{lang === "en" ? "NET after returns" : "NET après retours"}</span>
                                      <span style={{ color: Number(sale.net_amount) <= 0 ? "var(--text-muted)" : "var(--brand-light)" }}>{formatCFA(sale.net_amount)}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── DAILY SALES ── */}
      {tab === "daily_sales" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>📅 {lang === "en" ? "Today's Sales" : "Ventes du jour"} — {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{lang === "en" ? "All items sold today combined" : "Tous les articles vendus aujourd'hui"}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => {
                if (!todaySales.length) return;
                const itemMap = {};
                todaySales.forEach(sale => {
                  (sale.pa_sale_items || []).forEach(item => {
                    const name = item.pa_products?.name || "?";
                    const unit = item.pa_products?.unit || "pce";
                    if (!itemMap[name]) itemMap[name] = { name, unit, qty: 0, total: 0 };
                    itemMap[name].qty += item.quantity;
                    itemMap[name].total += item.quantity * item.unit_price;
                  });
                });
                const items = Object.values(itemMap);
                const grandTotal = items.reduce((s, i) => s + i.total, 0);
                const paid = todaySales.filter(s => s.payment_status === "paid").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const credit = todaySales.filter(s => s.payment_status === "credit").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const partial = todaySales.filter(s => s.payment_status === "partial").reduce((s, sale) => s + parseFloat(sale.balance_due || 0), 0);
                const today = new Date().toLocaleDateString("fr-FR");
                let msg = `📊 *Ventes du jour — ${today}*
`;
                msg += `─────────────────────
`;
                items.forEach(i => { msg += `${i.name} × ${i.qty} ${i.unit} ... ${i.total.toLocaleString()} F
`; });
                msg += `─────────────────────
`;
                msg += `*Total: ${grandTotal.toLocaleString()} FCFA*
`;
                msg += `✅ Encaissé: ${paid.toLocaleString()} F
`;
                if (credit > 0) msg += `🔴 Crédit: ${credit.toLocaleString()} F
`;
                if (partial > 0) msg += `🟡 Restes dus: ${partial.toLocaleString()} F
`;
                msg += `📦 ${todaySales.length} ventes`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
              }} style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                📱 {lang === "en" ? "Share WhatsApp" : "Partager WhatsApp"}
              </button>
              <button onClick={() => {
                if (!todaySales.length) return;
                const itemMap = {};
                todaySales.forEach(sale => {
                  (sale.pa_sale_items || []).forEach(item => {
                    const name = item.pa_products?.name || "?";
                    const unit = item.pa_products?.unit || "pce";
                    if (!itemMap[name]) itemMap[name] = { name, unit, qty: 0, total: 0 };
                    itemMap[name].qty += item.quantity;
                    itemMap[name].total += item.quantity * item.unit_price;
                  });
                });
                const items = Object.values(itemMap);
                const grandTotal = items.reduce((s, i) => s + i.total, 0);
                const paid = todaySales.filter(s => s.payment_status === "paid").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const credit = todaySales.filter(s => s.payment_status === "credit").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const today = new Date().toLocaleDateString("fr-FR");
                const w = window.open("","_blank","width=350,height=600");
                w.document.write(`<html><head><style>body{font-family:monospace;font-size:12px;width:300px;margin:0 auto}.row{display:flex;justify-content:space-between;margin-bottom:4px}.line{border-top:1px dashed #000;margin:8px 0}.center{text-align:center}.bold{font-weight:bold;font-size:14px}</style></head><body>
                  <div class="center bold">VENTES DU JOUR</div>
                  <div class="center">${today}</div>
                  <div class="line"></div>
                  ${items.map(i => `<div class="row"><span>${i.name} × ${i.qty} ${i.unit}</span><span>${i.total.toLocaleString()} F</span></div>`).join("")}
                  <div class="line"></div>
                  <div class="row bold"><span>TOTAL</span><span>${grandTotal.toLocaleString()} FCFA</span></div>
                  <div class="row"><span>✅ Encaissé</span><span>${paid.toLocaleString()} F</span></div>
                  ${credit > 0 ? `<div class="row" style="color:red"><span>🔴 Crédit</span><span>${credit.toLocaleString()} F</span></div>` : ""}
                  <div class="row"><span>📦 Nb ventes</span><span>${todaySales.length}</span></div>
                </body></html>`);
                w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close(); }, 300);
              }} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                🖨️ {lang === "en" ? "Print" : "Imprimer"}
              </button>
            </div>
          </div>

          {todayLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : todaySales.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📭</div>
              <div style={{ fontWeight: 600 }}>{lang === "en" ? "No sales today yet" : "Aucune vente aujourd'hui"}</div>
            </div>
          ) : (() => {
            // Aggregate all items sold today
            const itemMap = {};
            let totalPaid = 0, totalCredit = 0, totalPartialDue = 0;
            todaySales.forEach(sale => {
              if (sale.payment_status === "paid") totalPaid += parseFloat(sale.total_amount);
              if (sale.payment_status === "credit") totalCredit += parseFloat(sale.total_amount);
              if (sale.payment_status === "partial") totalPartialDue += parseFloat(sale.balance_due || 0);
              (sale.pa_sale_items || []).forEach(item => {
                const name = item.pa_products?.name || "?";
                const unit = item.pa_products?.unit || "pce";
                if (!itemMap[name]) itemMap[name] = { name, unit, qty: 0, total: 0 };
                itemMap[name].qty += item.quantity;
                itemMap[name].total += item.quantity * item.unit_price;
              });
            });
            const items = Object.values(itemMap).sort((a, b) => b.total - a.total);
            const grandTotal = items.reduce((s, i) => s + i.total, 0);
            return (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{lang === "en" ? "Product" : "Produit"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "en" ? "Qty sold" : "Qté vendue"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "en" ? "Total" : "Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{item.qty} {item.unit}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{item.total.toLocaleString()} F</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-elevated)" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 700 }}>
                        {todaySales.length} {lang === "en" ? "sales" : "ventes"}
                      </td>
                      <td></td>
                      <td style={{ textAlign: "right", padding: "12px 16px", fontWeight: 800, fontSize: 16, color: "var(--brand-light)" }}>
                        {grandTotal.toLocaleString()} FCFA
                      </td>
                    </tr>
                    <tr style={{ background: "var(--bg-elevated)" }}>
                      <td colSpan={3} style={{ padding: "8px 16px" }}>
                        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
                          <span>✅ {lang === "en" ? "Collected:" : "Encaissé:"} <strong style={{ color: "#34d399" }}>{totalPaid.toLocaleString()} F</strong></span>
                          {totalCredit > 0 && <span>🔴 {lang === "en" ? "Credit:" : "Crédit:"} <strong style={{ color: "#f87171" }}>{totalCredit.toLocaleString()} F</strong></span>}
                          {totalPartialDue > 0 && <span>🟡 {lang === "en" ? "Partial due:" : "Restes dus:"} <strong style={{ color: "#fbbf24" }}>{totalPartialDue.toLocaleString()} F</strong></span>}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── TOP PRODUCTS ── */}
      {tab === "products" && (
        <div>
          <DateFilter />
          {topLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : topProducts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600 }}>No data</div></div>
          : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
              <table className="table">
                <thead><tr>
                  <th>#</th>
                  <th>{lang === "en" ? "Product" : "Produit"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Qty sold" : "Qté vendue"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Revenue" : "Chiffre d'affaires"}</th>
                </tr></thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--text-muted)", fontWeight: 700, width: 40 }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </td>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{p.total_qty.toLocaleString()} {p.unit}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{formatCFA(p.total_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DEBT REPORT ── */}
      {tab === "debts" && (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <div className="stat-card" style={{ flex: 1 }}>
              <div className="stat-label">{lang === "en" ? "Total outstanding" : "Total dû"}</div>
              <div className="stat-value" style={{ color: "#f87171" }}>{formatCFA(totalDebt)}</div>
            </div>
            <div className="stat-card" style={{ flex: 1 }}>
              <div className="stat-label">{lang === "en" ? "Customers with debt" : "Clients avec crédit"}</div>
              <div className="stat-value" style={{ color: "#fbbf24" }}>{debts.length}</div>
            </div>
          </div>

          {debtLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : debts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>✓ {lang === "en" ? "No outstanding debts!" : "Aucun crédit en cours!"}</div></div>
          : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
              <table className="table">
                <thead><tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Invoices" : "Factures"}</th>
                  <th>{lang === "en" ? "Due date" : "Échéance"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Total owed" : "Total dû"}</th>
                </tr></thead>
                <tbody>
                  {debts.map(c => {
                    const isOverdue = c.earliest_due && c.earliest_due < new Date().toISOString().split("T")[0];
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ color: "var(--text-muted)" }}>{c.phone || "—"}</td>
                        <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(79,70,229,0.1)", color: "var(--brand-light)" }}>{c.customer_type}</span></td>
                        <td style={{ textAlign: "right" }}>{c.open_invoices}</td>
                        <td style={{ color: isOverdue ? "#f87171" : "var(--text-secondary)", fontSize: 13 }}>
                          {c.earliest_due ? formatDate(c.earliest_due) + (isOverdue ? " ⚠️" : "") : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#f87171", fontSize: 15 }}>{formatCFA(c.total_debt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)" }}>
                    <td colSpan={5} style={{ padding: "12px 16px", fontWeight: 700 }}>TOTAL</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#f87171", padding: "12px 16px", fontSize: 16 }}>{formatCFA(totalDebt)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === "returns" && (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              [lang === "en" ? "Returns" : "Retours", returnsStats.count ?? 0],
              [lang === "en" ? "Total refunded" : "Total remboursé", formatCFA(returnsStats.total_refunded || 0)],
              [lang === "en" ? "Avg value" : "Valeur moy.", formatCFA(returnsStats.avg_value || 0)],
              [lang === "en" ? "Top reason" : "Raison principale", returnsStats.top_reason || "—"],
            ].map(([k, v], i) => (
              <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", minWidth: 130 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
              <thead><tr>
                {[lang === "en" ? "Return" : "Retour", lang === "en" ? "Sale" : "Vente",
                  lang === "en" ? "Type" : "Type", lang === "en" ? "Items" : "Articles",
                  lang === "en" ? "Refund" : "Remboursé", lang === "en" ? "Reason" : "Raison",
                  "Date", lang === "en" ? "By" : "Par"].map(h =>
                  <th key={h} style={{ textAlign: "left", padding: "10px 12px" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {returnsLoading ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{lang === "en" ? "Loading…" : "Chargement…"}</td></tr>
                ) : !returns.length ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{lang === "en" ? "No returns in this period." : "Aucun retour sur cette période."}</td></tr>
                ) : returns.map(r => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.return_ref || "—"}</td>
                    <td style={{ padding: "8px 12px" }}>{r.sale_number}</td>
                    <td style={{ padding: "8px 12px" }}>{r.return_type || "refund"}</td>
                    <td style={{ padding: "8px 12px" }}>{(r.items_returned || []).length}</td>
                    <td style={{ padding: "8px 12px", color: "#f87171" }}>{formatCFA(r.refund_amount || 0)}</td>
                    <td style={{ padding: "8px 12px" }}>{r.reason || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.processed_by_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "ledger" && (
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input type="date" className="input" value={ledgerDate} onChange={e => setLedgerDate(e.target.value)} style={{ width: "auto" }} />
            <select className="input" value={ledgerLoc} onChange={e => setLedgerLoc(e.target.value)} style={{ width: "auto" }}>
              <option value="all">{lang === "en" ? "All locations" : "Tous les sites"}</option>
              {ledgerLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={printLedger} disabled={!ledger}>🖨 {lang === "en" ? "Print" : "Imprimer"}</button>
            <button className="btn btn-secondary" onClick={exportLedgerCSV} disabled={!ledger}>📊 CSV</button>
            <button onClick={shareLedgerWhatsApp} disabled={!ledger}
              style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: ledger ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13, opacity: ledger ? 1 : 0.6 }}>
              📱 {lang === "en" ? "Share via WhatsApp" : "Partager via WhatsApp"}
            </button>
          </div>
          {ledgerLoading || !ledger ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>{lang === "en" ? "Loading…" : "Chargement…"}</div>
          ) : (
            <div className="card" style={{ maxWidth: 560, margin: "0 auto", padding: "18px 20px" }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>
                {lang === "en" ? "Sales" : "Ventes"}
              </div>
              {ledger.sales_by_product.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>{lang === "en" ? "No sales this day." : "Aucune vente ce jour."}</div>
              ) : ledger.sales_by_product.map((g, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>{g.product_name} <span style={{ color: "var(--text-muted)" }}>{g.qty} × {formatCFA(g.unit_price)}</span></span>
                  <span style={{ fontWeight: 600 }}>{formatCFA(g.line_total)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "8px 0", borderTop: "2px solid var(--border)", marginTop: 4 }}>
                <span>{lang === "en" ? "Total sales" : "Total ventes"}</span>
                <span style={{ color: "var(--brand-light)" }}>{formatCFA(ledger.gross_sales)}</span>
              </div>

              {ledger.returns_total > 0 && (
                <>
                  <div style={{ fontWeight: 800, fontSize: 15, margin: "16px 0 8px" }}>{lang === "en" ? "Returns" : "Retours"}</div>
                  {ledger.returns_today.map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                      <span><span style={{ fontFamily: "monospace" }}>{r.ret_ref}</span> <span style={{ color: "var(--text-muted)" }}>{r.items_summary}</span></span>
                      <span style={{ color: "#f87171" }}>-{formatCFA(r.refund_amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "8px 0", borderTop: "2px solid var(--border)" }}>
                    <span>{lang === "en" ? "Net sales" : "Ventes nettes"}</span>
                    <span style={{ color: "var(--brand-light)" }}>{formatCFA(ledger.net_sales)}</span>
                  </div>
                </>
              )}

              {ledger.expenses_total > 0 && (
                <>
                  <div style={{ fontWeight: 800, fontSize: 15, margin: "16px 0 8px" }}>{lang === "en" ? "Expenses" : "Dépenses"}</div>
                  {ledger.expenses.map((e, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>{e.category ? e.category + " - " : ""}{e.description}</span>
                      <span style={{ color: "#f87171" }}>-{formatCFA(e.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "8px 0", borderTop: "2px solid var(--border)" }}>
                    <span>{lang === "en" ? "Total expenses" : "Total dépenses"}</span>
                    <span style={{ color: "#f87171" }}>-{formatCFA(ledger.expenses_total)}</span>
                  </div>
                </>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 17, padding: "12px 0", borderTop: "3px double var(--border)", borderBottom: "3px double var(--border)", marginTop: 14 }}>
                <span>{lang === "en" ? "Cash balance (expected)" : "Solde caisse (attendu)"}</span>
                <span style={{ color: ledger.cash_balance < 0 ? "#f87171" : "#34d399" }}>{formatCFA(ledger.cash_balance)}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {voidSale && (
        <VoidReturnModal
          sale={voidSale}
          lang={lang}
          onClose={() => setVoidSale(null)}
        />
      )}
    </div>
  );
}
