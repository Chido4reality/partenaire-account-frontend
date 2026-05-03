import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function ReportsPage() {
  const { lang } = useLangStore();
  const [tab, setTab] = useState("daily");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
  const [to, setTo]   = useState(new Date().toISOString().split("T")[0]);

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["reports-daily", from, to],
    queryFn: () => api.get("/reports/daily?from=" + from + "&to=" + to).then(r => r.data)
  });

  const { data: debtData, isLoading: debtLoading } = useQuery({
    queryKey: ["reports-debts"],
    queryFn: () => api.get("/reports/debts").then(r => r.data)
  });

  const daily = dailyData?.data || [];
  const debts = debtData?.data || [];

  const totals = daily.reduce((acc, d) => ({
    gross_sales:      acc.gross_sales      + (+d.gross_sales || 0),
    cash_collected:   acc.cash_collected   + (+d.cash_collected || 0),
    credit_sales:     acc.credit_sales     + (+d.credit_sales || 0),
    total_cost:       acc.total_cost       + (+d.total_cost || 0),
    gross_profit:     acc.gross_profit     + (+d.gross_profit || 0),
    total_expenditure:acc.total_expenditure+ (+d.total_expenditure || 0),
    net_profit:       acc.net_profit       + (+d.net_profit || 0),
    sale_count:       acc.sale_count       + (+d.sale_count || 0),
  }), { gross_sales:0, cash_collected:0, credit_sales:0, total_cost:0, gross_profit:0, total_expenditure:0, net_profit:0, sale_count:0 });

  const avgMargin = daily.length > 0
    ? (daily.reduce((s, d) => s + (+d.profit_margin_pct || 0), 0) / daily.length).toFixed(1)
    : 0;

  const totalDebt = debts.reduce((s, c) => s + (+c.total_debt || 0), 0);

  const exportCSV = () => {
    const headers = ["Date", "Sales", "Cash Collected", "Credit Sales", "Cost", "Gross Profit", "Margin%", "Expenses", "Net Profit", "Transactions"];
    const rows = daily.map(d => [
      d.sale_date, d.gross_sales, d.cash_collected, d.credit_sales,
      d.total_cost, d.gross_profit, d.profit_margin_pct,
      d.total_expenditure, d.net_profit, d.sale_count
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "report_" + from + "_" + to + ".csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const TABS = [
    { key: "daily",   en: "Daily Summary",  fr: "Resume journalier" },
    { key: "debts",   en: "Debt Report",    fr: "Rapport credits" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Reports" : "Rapports"}</h1>
        {tab === "daily" && (
          <button className="btn btn-secondary" onClick={exportCSV}>
            {lang === "en" ? "Export CSV" : "Exporter CSV"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? t.en : t.fr}
          </button>
        ))}
      </div>

      {tab === "daily" && (
        <div>
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
              { en: "Today", fr: "Aujourd hui", days: 0 },
              { en: "7 days", fr: "7 jours", days: 7 },
              { en: "30 days", fr: "30 jours", days: 30 },
            ].map(p => (
              <button key={p.days} className="btn btn-secondary btn-sm" onClick={() => { const d = new Date(); const f = new Date(); f.setDate(f.getDate() - p.days); setFrom(f.toISOString().split("T")[0]); setTo(d.toISOString().split("T")[0]); }}>
                {lang === "en" ? p.en : p.fr}
              </button>
            ))}
          </div>

          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: lang === "en" ? "Total sales" : "Ventes totales", value: formatCFA(totals.gross_sales), sub: totals.sale_count + " transactions", color: "var(--brand-light)" },
              { label: lang === "en" ? "Cash collected" : "Especes encaissees", value: formatCFA(totals.cash_collected), color: "#34d399" },
              { label: lang === "en" ? "Gross profit" : "Benefice brut", value: formatCFA(totals.gross_profit), sub: avgMargin + "% avg margin", color: "#34d399" },
              { label: lang === "en" ? "Total expenses" : "Depenses totales", value: formatCFA(totals.total_expenditure), color: "#f87171" },
              { label: lang === "en" ? "Net profit" : "Benefice net", value: formatCFA(totals.net_profit), color: totals.net_profit >= 0 ? "#34d399" : "#f87171" },
              { label: lang === "en" ? "Credit sales" : "Ventes credit", value: formatCFA(totals.credit_sales), color: "#fbbf24" },
            ].map(card => (
              <div key={card.label} className="stat-card">
                <div className="stat-label">{card.label}</div>
                <div className="stat-value" style={{ color: card.color, fontSize: 18 }}>{card.value}</div>
                {card.sub && <div className="stat-sub">{card.sub}</div>}
              </div>
            ))}
          </div>

          {/* Daily table */}
          {dailyLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : daily.length === 0 ? (
            <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No sales in this period" : "Aucune vente sur cette periode"}</div></div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 700 }}>
                <thead><tr>
                  <th>{lang === "en" ? "Date" : "Date"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Sales" : "Ventes"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Cash" : "Especes"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Cost" : "Cout"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Gross profit" : "Benefice brut"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Margin" : "Marge"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Expenses" : "Depenses"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Net profit" : "Benefice net"}</th>
                </tr></thead>
                <tbody>
                  {daily.map((d, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{formatDate(d.sale_date, lang)}</td>
                      <td style={{ textAlign: "right" }}>{formatCFA(d.gross_sales)}<div style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.sale_count} sales</div></td>
                      <td style={{ textAlign: "right", color: "#34d399" }}>{formatCFA(d.cash_collected)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{formatCFA(d.total_cost)}</td>
                      <td style={{ textAlign: "right", color: "#34d399", fontWeight: 500 }}>{formatCFA(d.gross_profit)}</td>
                      <td style={{ textAlign: "right" }}><span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: d.profit_margin_pct > 20 ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: d.profit_margin_pct > 20 ? "#34d399" : "#fbbf24" }}>{d.profit_margin_pct}%</span></td>
                      <td style={{ textAlign: "right", color: "#f87171" }}>{formatCFA(d.total_expenditure)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: d.net_profit >= 0 ? "#34d399" : "#f87171" }}>{formatCFA(d.net_profit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
                    <td style={{ padding: "12px 16px" }}>TOTAL</td>
                    <td style={{ textAlign: "right", padding: "12px 16px" }}>{formatCFA(totals.gross_sales)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{formatCFA(totals.cash_collected)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-secondary)" }}>{formatCFA(totals.total_cost)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{formatCFA(totals.gross_profit)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px" }}>{avgMargin}%</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#f87171" }}>{formatCFA(totals.total_expenditure)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: totals.net_profit >= 0 ? "#34d399" : "#f87171" }}>{formatCFA(totals.net_profit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "debts" && (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <div className="stat-card" style={{ flex: 1 }}>
              <div className="stat-label">{lang === "en" ? "Total outstanding" : "Total du"}</div>
              <div className="stat-value" style={{ color: "#f87171" }}>{formatCFA(totalDebt)}</div>
            </div>
            <div className="stat-card" style={{ flex: 1 }}>
              <div className="stat-label">{lang === "en" ? "Customers with debt" : "Clients avec credit"}</div>
              <div className="stat-value" style={{ color: "#fbbf24" }}>{debts.length}</div>
            </div>
          </div>

          {debtLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : debts.length === 0 ? (
            <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>{lang === "en" ? "No outstanding debts!" : "Aucun credit en cours!"}</div></div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
              <table className="table">
                <thead><tr>
                  <th>{lang === "en" ? "Customer" : "Client"}</th>
                  <th>{lang === "en" ? "Phone" : "Telephone"}</th>
                  <th>{lang === "en" ? "Type" : "Type"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Open invoices" : "Factures ouvertes"}</th>
                  <th>{lang === "en" ? "Earliest due" : "Prochaine echeance"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Total owed" : "Total du"}</th>
                </tr></thead>
                <tbody>
                  {debts.map(c => {
                    const isOverdue = c.earliest_due && c.earliest_due < new Date().toISOString().split("T")[0];
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ color: "var(--text-muted)" }}>{c.phone || "-"}</td>
                        <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(79,70,229,0.1)", color: "var(--brand-light)" }}>{c.customer_type}</span></td>
                        <td style={{ textAlign: "right" }}>{c.open_invoices}</td>
                        <td style={{ color: isOverdue ? "#f87171" : "var(--text-secondary)", fontSize: 13 }}>{c.earliest_due ? formatDate(c.earliest_due) + (isOverdue ? " (OVERDUE)" : "") : "-"}</td>
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
    </div>
  );
}
