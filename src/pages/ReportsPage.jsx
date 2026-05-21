import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useAuthStore, useSettingsStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";
import VoidReturnModal from "../components/common/VoidReturnModal";
import { genSaleCodes } from "../utils/receiptCodes";

// MP-DEBT-LINE-FULL-VISIBILITY: pa_sale_items can now hold debt-payment
// rows (line_type='debt_payment', product_id=NULL). Helpers to keep
// every iteration site consistent.
//   isDebtItem(i)       — true for a debt-payment row (joined product is null)
//   itemLabel(i, lang)  — display name ("💰 Debt Repayment" for debt rows)
//   itemUnit(i)         — unit string (— for debt rows, no quantity)
//   itemAmount(i)       — line total (qty * unit_price; works for both)
// Product aggregations (top-products, revenue-by-product) should SKIP
// debt rows since they have no product_id and no SKU to group by.
const isDebtItem  = (i) => i?.line_type === "debt_payment" || (i && i.product_id === null);
const itemLabel   = (i, lang) => isDebtItem(i)
  ? (lang === "en" ? "💰 Debt Repayment" : "💰 Remboursement dette")
  : (i?.pa_products?.name || "?");
const itemUnit    = (i) => isDebtItem(i) ? "—" : (i?.pa_products?.unit || "pce");
const itemAmount  = (i) => (Number(i?.quantity) || 0) * (Number(i?.unit_price) || 0);

export default function ReportsPage() {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const isOwner = user?.role === "owner";

  const [tab, setTab] = useState("daily");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [expandedSale, setExpandedSale] = useState(null);
  const [voidSale, setVoidSale] = useState(null);
  // MP-DASHBOARD-REPORT-CONSISTENCY: location filter for the daily /
  // daily-sales / sales-detail aggregations. "" = All locations (default,
  // same as Dashboard) so the two pages show the same canonical number.
  const [repLoc, setRepLoc] = useState("");
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

  // Shared location query-string (backend /reports/* already supports
  // location_id; empty => all locations).
  const locQS = repLoc ? `&location_id=${repLoc}` : "";

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["reports-daily", from, to, repLoc],
    queryFn: () => api.get("/reports/daily?from=" + from + "&to=" + to + locQS).then(r => r.data)
  });

  const { data: debtData, isLoading: debtLoading } = useQuery({
    queryKey: ["reports-debts"],
    queryFn: () => api.get("/reports/debts").then(r => r.data)
  });

  const { data: salesDetailData, isLoading: salesDetailLoading } = useQuery({
    queryKey: ["reports-sales-detail", from, to, repLoc],
    queryFn: () => api.get(`/reports/sales-detail?from=${from}&to=${to}${locQS}`).then(r => r.data),
    enabled: tab === "sales"
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const { data: todaySalesData, isLoading: todayLoading } = useQuery({
    queryKey: ["reports-today-sales", repLoc],
    queryFn: () => api.get(`/reports/sales-detail?date=${todayStr}${locQS}`).then(r => r.data),
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

  // MP-LEDGER-CLARITY: the three helpers below all consume the new
  // sectioned shape from /reports/daily-ledger:
  //   ledger.product_sales    { total, items: [{product_name, qty, unit_price, line_total}] }
  //   ledger.debt_collections { total, items: [{customer_name, amount, sale_number, time}] }
  //   ledger.refunds          { total, items: [{ret_ref, sale_number, customer_name, refund_amount, items_summary}] }
  //   ledger.expenses         { total, items: [{category, description, amount}] }
  //   ledger.drawer           { opening_float, expected, actual, variance, status, cashier_name } | null
  //   ledger.totals           { argent_recu, net_cash_real }
  // Helper: build the shared plain-text body for print / copy / WA.
  const buildLedgerText = () => {
    if (!ledger) return "";
    const en   = lang === "en";
    const n    = (x) => Number(x || 0).toLocaleString(en ? "en-US" : "fr-FR");
    const ps   = ledger.product_sales    || { total: 0, items: [] };
    const dc   = ledger.debt_collections || { total: 0, items: [] };
    const rf   = ledger.refunds          || { total: 0, items: [] };
    const ex   = ledger.expenses         || { total: 0, items: [] };
    const dr   = ledger.drawer || null;
    const tot  = ledger.totals || { argent_recu: 0, net_cash_real: 0 };
    const locName = ledger.location ? ledger.location.name : (en ? "All locations" : "Tous les sites");
    const longDate = new Date(ledger.date + "T00:00:00").toLocaleDateString(en ? "en-GB" : "fr-FR",
      { day: "numeric", month: "long", year: "numeric" });

    const L = [];
    L.push(`📊 ${en ? "Daily Report" : "Rapport du jour"} — ${locName}`);
    L.push(`${longDate}${dr?.cashier_name ? " — " + dr.cashier_name : ""}`);
    L.push("");
    L.push(`🛒 ${en ? "Product sales" : "Ventes produits"}: ${n(ps.total)} FCFA (${ps.items.length} ${ps.items.length === 1 ? (en ? "transaction" : "transaction") : (en ? "transactions" : "transactions")})`);
    L.push(`💰 ${en ? "Debt collections" : "Recouvrements"}: ${n(dc.total)} FCFA (${dc.items.length} ${dc.items.length === 1 ? "transaction" : "transactions"})`);
    L.push(`↩ ${en ? "Refunds" : "Remboursements"}: ${n(rf.total)} FCFA${rf.total > 0 ? ` (${rf.items.length})` : ""}`);
    L.push(`💸 ${en ? "Expenses" : "Dépenses"}: ${n(ex.total)} FCFA${ex.total > 0 ? ` (${ex.items.length})` : ""}`);
    L.push("");
    L.push(`💵 ${en ? "Cash received" : "Argent reçu"}: ${n(tot.argent_recu)} FCFA`);
    if (dr) {
      // MP-LEDGER-DRAWER-MATH-FIX: shift-scoped figures, and only
      // surface actual/variance when the shift is closed AND
      // counted. Mirror the on-screen drawer panel exactly.
      L.push(`📦 ${en ? "Expected drawer" : "Caisse attendue"}: ${n(dr.expected)} FCFA (${en ? "with opening float" : "avec solde d'ouverture"} ${n(dr.opening_float)})`);
      const drIsClosed = dr.status === "closed" && dr.actual != null;
      if (drIsClosed) {
        L.push(`💼 ${en ? "Actual cash" : "Solde réel"}: ${n(dr.actual)} FCFA`);
        const v = Number(dr.variance || 0);
        const label = v === 0
          ? (en ? "(Exact)" : "(Exact)")
          : v > 0
            ? (en ? `+${n(v)} (Surplus)` : `+${n(v)} (Excédent)`)
            : (en ? `−${n(Math.abs(v))} (Shortage)` : `−${n(Math.abs(v))} (Manquant)`);
        L.push(`⚖ ${en ? "Variance" : "Écart"}: ${label}`);
      } else {
        L.push(`💼 ${en ? "Actual cash" : "Solde réel"}: — ${en ? "(count at end of shift)" : "(à compter en fin de poste)"}`);
      }
    }
    L.push("");
    L.push(en ? "Sent from Mon Partenaire POS" : "Envoyé depuis Mon Partenaire POS");
    return L.join("\n");
  };

  const printLedger = () => {
    const txt = buildLedgerText();
    if (!txt) return;
    const w = window.open("", "_blank", "width=380,height=620");
    w.document.write(`<pre style="font:12px/1.5 monospace;padding:12px;white-space:pre-wrap">${txt.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
    w.document.close(); w.focus(); setTimeout(() => { w.print(); }, 250);
  };

  const exportLedgerCSV = () => {
    if (!ledger) return;
    const ps = ledger.product_sales    || { total: 0, items: [] };
    const dc = ledger.debt_collections || { total: 0, items: [] };
    const rf = ledger.refunds          || { total: 0, items: [] };
    const ex = ledger.expenses         || { total: 0, items: [] };
    const dr = ledger.drawer || null;
    const tot = ledger.totals || { argent_recu: 0, net_cash_real: 0 };

    const rows = [["section", "description", "qty", "unit_price", "amount"]];
    ps.items.forEach(g => rows.push(["product_sale", g.product_name, g.qty, g.unit_price, g.line_total]));
    rows.push(["", "Sub-total product sales", "", "", ps.total]);
    dc.items.forEach(d => rows.push(["debt_collection", `Recouvrement — ${d.customer_name}${d.sale_number ? ` (${d.sale_number})` : ""}`, "", "", d.amount]));
    rows.push(["", "Sub-total debt collections", "", "", dc.total]);
    rf.items.forEach(r => rows.push(["refund", `${r.ret_ref || ""} ${r.customer_name || ""} ${r.items_summary || ""}`.trim(), "", "", -r.refund_amount]));
    if (rf.total > 0) rows.push(["", "Sub-total refunds", "", "", -rf.total]);
    ex.items.forEach(e => rows.push(["expense", `${e.category ? e.category + " — " : ""}${e.description}`, "", "", -e.amount]));
    if (ex.total > 0) rows.push(["", "Sub-total expenses", "", "", -ex.total]);
    rows.push(["", "ARGENT REÇU", "", "", tot.argent_recu]);
    rows.push(["", "NET CASH (after refunds + expenses)", "", "", tot.net_cash_real]);
    if (dr) {
      rows.push(["drawer", "Opening float", "", "", dr.opening_float]);
      rows.push(["drawer", "Expected drawer", "", "", dr.expected]);
      if (dr.actual != null) rows.push(["drawer", "Actual cash", "", "", dr.actual]);
      if (dr.variance != null) rows.push(["drawer", "Variance", "", "", dr.variance]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ledger-${ledger.date}.csv`; a.click();
  };

  const shareLedgerWhatsApp = () => {
    const txt = buildLedgerText();
    if (!txt) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
  };

  // MP-LEDGER-CLARITY: "Envoyer au propriétaire" copy-to-clipboard.
  // Uses the same plain-text body as printLedger / shareLedgerWhatsApp
  // so what the boss receives matches what's on screen byte-for-byte.
  const copyLedgerToClipboard = async () => {
    const txt = buildLedgerText();
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      toast.success(lang === "en" ? "Report copied — paste into WhatsApp / SMS" : "Rapport copié — collez dans WhatsApp / SMS");
    } catch {
      // Older browsers / non-secure contexts: fall back to a hidden
      // textarea + execCommand. The toast still tells the user what
      // happened.
      const ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast.success(lang === "en" ? "Report copied" : "Rapport copié"); }
      catch { toast.error(lang === "en" ? "Copy failed — long-press to copy from the report below" : "Copie échouée — touchez-presser sur le rapport ci-dessous"); }
      finally { document.body.removeChild(ta); }
    }
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
    const rows = [["Sale#", "Date", "Customer", "Product / Line Type", "Qty", "Unit Price", "Line Total", "Payment Status"]];
    salesDetail.forEach(sale => {
      (sale.pa_sale_items || []).forEach(item => {
        rows.push([
          sale.sale_number,
          sale.sale_date,
          sale.pa_customers?.name || "Walk-in",
          isDebtItem(item) ? "Debt Repayment" : (item.pa_products?.name || ""),
          item.quantity,
          item.unit_price,
          itemAmount(item).toFixed(0),
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
      {/* MP-DASHBOARD-REPORT-CONSISTENCY: same location filter + default
          (All) as Dashboard, so the numbers reconcile. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label className="label" style={{ margin: 0 }}>{lang === "en" ? "Location" : "Site"}</label>
        <select className="input" value={repLoc} onChange={e => setRepLoc(e.target.value)} style={{ width: 180 }}>
          <option value="">{lang === "en" ? "All locations" : "Tous les sites"}</option>
          {ledgerLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
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
                                  const total = items.reduce((s,i) => s + itemAmount(i), 0);
                                  let msg = `🧾 *Reçu*\n📅 ${sale.sale_date}\nN° ${sale.sale_number}\n─────────────────────\n`;
                                  items.forEach(i => {
                                    msg += isDebtItem(i)
                                      ? `${itemLabel(i, lang)} ... ${itemAmount(i).toLocaleString()} F\n`
                                      : `${itemLabel(i, lang)} × ${i.quantity} ... ${itemAmount(i).toLocaleString()} F\n`;
                                  });
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
                                  const total = items.reduce((s,i) => s + itemAmount(i), 0);
                                  const codes = sale.sale_number ? await genSaleCodes(sale.sale_number) : { barcode: "", qr: "" };
                                  const w = window.open("","_blank","width=350,height=500");
                                  w.document.write(`<html><head><style>body{font-family:monospace;font-size:12px;width:300px;margin:0 auto}.row{display:flex;justify-content:space-between}.line{border-top:1px dashed #000;margin:6px 0}.bold{font-weight:bold;font-size:14px}.center{text-align:center}</style></head><body>
                                    <div class="center" style="font-weight:bold;font-size:14px;margin-bottom:4px">REÇU</div>
                                    <div class="center">${sale.sale_date}</div>
                                    <div class="center" style="font-size:15px;font-weight:bold;margin:4px 0">${sale.sale_number || ""}</div>
                                    ${sale.pa_customers?.name ? `<div class="center">Client: ${sale.pa_customers.name}</div>` : ""}
                                    <div class="line"></div>
                                    ${items.map(i => isDebtItem(i)
                                      ? `<div class="row"><span>${itemLabel(i, lang)}</span><span>${itemAmount(i).toLocaleString()} F</span></div>`
                                      : `<div class="row"><span>${itemLabel(i, lang)} ×${i.quantity}</span><span>${itemAmount(i).toLocaleString()} F</span></div>`).join("")}
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
                                      <div style={{ fontWeight: 600, fontSize: 13 }}>{itemLabel(item, lang)}</div>
                                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        {isDebtItem(item)
                                          ? (lang === "en" ? "applied to customer debt" : "appliqué à la dette client")
                                          : `${item.quantity} ${itemUnit(item)} × ${formatCFA(item.unit_price)}`}
                                      </div>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--brand-light)" }}>
                                      {formatCFA(itemAmount(item))}
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
                // Aggregate by product name. Skip debt-payment rows
                // (line_type='debt_payment') — they have no SKU to group
                // by and would all collapse into a meaningless "?" row.
                const itemMap = {};
                todaySales.forEach(sale => {
                  (sale.pa_sale_items || []).filter(i => !isDebtItem(i)).forEach(item => {
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
                // Same product-aggregation as the WhatsApp share above —
                // debt-payment rows skipped (no SKU to group by).
                const itemMap = {};
                todaySales.forEach(sale => {
                  (sale.pa_sale_items || []).filter(i => !isDebtItem(i)).forEach(item => {
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
            // Aggregate products sold today. Debt-payment rows skipped
            // (no SKU). totalPaid/Credit/PartialDue come from sale-level
            // fields so they stay correct even on debt-only days.
            const itemMap = {};
            let totalPaid = 0, totalCredit = 0, totalPartialDue = 0;
            todaySales.forEach(sale => {
              if (sale.payment_status === "paid") totalPaid += parseFloat(sale.total_amount);
              if (sale.payment_status === "credit") totalCredit += parseFloat(sale.total_amount);
              if (sale.payment_status === "partial") totalPartialDue += parseFloat(sale.balance_due || 0);
              (sale.pa_sale_items || []).filter(i => !isDebtItem(i)).forEach(item => {
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
            <button className="btn btn-primary" onClick={copyLedgerToClipboard} disabled={!ledger}
              title={lang === "en" ? "Copy plain-text report — paste into WhatsApp / SMS" : "Copier le rapport — collez dans WhatsApp / SMS"}>
              📋 {lang === "en" ? "Send to owner" : "Envoyer au propriétaire"}
            </button>
            <button className="btn btn-secondary" onClick={printLedger}      disabled={!ledger}>🖨 {lang === "en" ? "Print" : "Imprimer"}</button>
            <button className="btn btn-secondary" onClick={exportLedgerCSV} disabled={!ledger}>📊 CSV</button>
            <button onClick={shareLedgerWhatsApp} disabled={!ledger}
              style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", cursor: ledger ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13, opacity: ledger ? 1 : 0.6 }}>
              📱 WhatsApp
            </button>
          </div>
          {ledgerLoading || !ledger ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>{lang === "en" ? "Loading…" : "Chargement…"}</div>
          ) : (() => {
            // MP-LEDGER-CLARITY: sectioned read for a boss-on-WhatsApp.
            // Product sales separate from debt collections so "revenue"
            // and "receivables collected" don't get added together
            // unexpectedly. Drawer math at the bottom when a shift
            // exists at this location for this date.
            const ps  = ledger.product_sales    || { total: 0, items: [] };
            const dc  = ledger.debt_collections || { total: 0, items: [] };
            const rf  = ledger.refunds          || { total: 0, items: [] };
            const ex  = ledger.expenses         || { total: 0, items: [] };
            const dr  = ledger.drawer || null;
            const tot = ledger.totals || { argent_recu: 0, net_cash_real: 0 };

            const SectionHeader = ({ icon, title, count, color }) => (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18, marginBottom: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color }}>
                  {icon} {title} <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 12 }}>({count})</span>
                </div>
              </div>
            );
            const Subtotal = ({ label, value, color }) => (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
                <span>{lang === "en" ? "Sub-total" : "Sous-total"} — {label}</span>
                <span style={{ color }}>{formatCFA(value)}</span>
              </div>
            );

            return (
              <div className="card" style={{ maxWidth: 620, margin: "0 auto", padding: "20px 22px" }}>

                {/* ── NEW PRODUCT SALES ───────────────────────── */}
                <SectionHeader icon="🛒"
                  title={lang === "en" ? "New product sales" : "Ventes produits"}
                  count={ps.items.length} color="var(--text-primary)" />
                {ps.items.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>—</div>
                ) : ps.items.map((g, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>{g.product_name} <span style={{ color: "var(--text-muted)" }}>{g.qty} × {formatCFA(g.unit_price)}</span></span>
                    <span style={{ fontWeight: 600 }}>{formatCFA(g.line_total)}</span>
                  </div>
                ))}
                <Subtotal label={lang === "en" ? "product sales" : "ventes produits"} value={ps.total} color="var(--brand-light)" />

                {/* ── DEBT COLLECTIONS ────────────────────────── */}
                <SectionHeader icon="💰"
                  title={lang === "en" ? "Debt collections" : "Recouvrements"}
                  count={dc.items.length} color="var(--text-primary)" />
                {dc.items.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>—</div>
                ) : dc.items.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>
                      {lang === "en" ? "Debt collection" : "Recouvrement"} — <strong>{d.customer_name}</strong>
                      {d.sale_number && <span style={{ color: "var(--text-muted)", fontFamily: "monospace", marginLeft: 6, fontSize: 11 }}>{d.sale_number}</span>}
                    </span>
                    <span style={{ fontWeight: 600, color: "#34d399" }}>{formatCFA(d.amount)}</span>
                  </div>
                ))}
                <Subtotal label={lang === "en" ? "debt collections" : "recouvrements"} value={dc.total} color="#34d399" />

                {/* ── REFUNDS (only if > 0) ──────────────────── */}
                {rf.total > 0 && (
                  <>
                    <SectionHeader icon="↩"
                      title={lang === "en" ? "Refunds" : "Remboursements"}
                      count={rf.items.length} color="var(--text-primary)" />
                    {rf.items.map((r, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                        <span>
                          <span style={{ fontFamily: "monospace", fontSize: 11 }}>{r.ret_ref || ""}</span>
                          {r.sale_number && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{r.sale_number}</span>}
                          {r.customer_name && <span style={{ marginLeft: 6 }}>{r.customer_name}</span>}
                          {r.items_summary && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>— {r.items_summary}</span>}
                        </span>
                        <span style={{ color: "#f87171", fontWeight: 600 }}>−{formatCFA(r.refund_amount)}</span>
                      </div>
                    ))}
                    <Subtotal label={lang === "en" ? "refunds" : "remboursements"} value={-rf.total} color="#f87171" />
                  </>
                )}

                {/* ── EXPENSES (only if > 0) ─────────────────── */}
                {ex.total > 0 && (
                  <>
                    <SectionHeader icon="💸"
                      title={lang === "en" ? "Expenses" : "Dépenses"}
                      count={ex.items.length} color="var(--text-primary)" />
                    {ex.items.map((e, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                        <span>
                          {e.category && <strong>{e.category}</strong>}
                          {e.category && e.description ? " — " : ""}
                          {e.description}
                        </span>
                        <span style={{ color: "#f87171", fontWeight: 600 }}>−{formatCFA(e.amount)}</span>
                      </div>
                    ))}
                    <Subtotal label={lang === "en" ? "expenses" : "dépenses"} value={-ex.total} color="#f87171" />
                  </>
                )}

                {/* ── ARGENT REÇU (highlighted) ─────────────── */}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 16, padding: "14px 0", borderTop: "3px double var(--border)", borderBottom: "3px double var(--border)", marginTop: 18 }}>
                  <div>
                    <div>{lang === "en" ? "CASH RECEIVED" : "ARGENT REÇU"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginTop: 2 }}>
                      ({lang === "en" ? "Sales" : "Ventes"} {formatCFA(ps.total)} + {lang === "en" ? "Collections" : "Recouvrements"} {formatCFA(dc.total)})
                    </div>
                  </div>
                  <span style={{ color: "var(--brand-light)" }}>{formatCFA(tot.argent_recu)}</span>
                </div>

                {/* ── DRAWER MATH (only when a shift exists for this loc+date) ───
                    MP-LEDGER-DRAWER-MATH-FIX: all numbers in this box are
                    SHIFT-scoped (dr.cash_sales_received / dr.cash_refunds /
                    dr.cash_expenses) — not day-wide totals. Actual cash +
                    variance render ONLY when the shift is closed AND the
                    cashier has counted (dr.actual != null). For an open
                    shift the actual line shows "à compter en fin de poste"
                    and no variance is displayed (the cashier hasn't done
                    the count yet — anything we'd show would be made up). */}
                {dr ? (() => {
                  const drIsClosed = dr.status === "closed" && dr.actual != null;
                  const openedTime = new Date(dr.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                  const closedTime = dr.closed_at
                    ? new Date(dr.closed_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                    : null;
                  const heading = dr.status === "closed"
                    ? (lang === "en"
                        ? `Cash drawer — shift closed at ${closedTime || openedTime}${dr.cashier_name ? " — " + dr.cashier_name : ""}`
                        : `Caisse — poste fermé à ${closedTime || openedTime}${dr.cashier_name ? " — " + dr.cashier_name : ""}`)
                    : (lang === "en"
                        ? `Cash drawer — shift open since ${openedTime}${dr.cashier_name ? " — " + dr.cashier_name : ""}`
                        : `Caisse — poste ouvert depuis ${openedTime}${dr.cashier_name ? " — " + dr.cashier_name : ""}`);
                  const sCash = Number(dr.cash_sales_received) || 0;
                  const sRef  = Number(dr.cash_refunds)        || 0;
                  const sExp  = Number(dr.cash_expenses)       || 0;
                  return (
                    <div style={{ marginTop: 18, padding: "12px 14px", background: "var(--bg-elevated)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>💼 {heading}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                        <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Opening float" : "Solde d'ouverture"}</span>
                        <span>{formatCFA(dr.opening_float)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                        <span style={{ color: "var(--text-muted)" }}>+ {lang === "en" ? "Cash sales this shift" : "Ventes espèces ce poste"}</span>
                        <span style={{ color: "#34d399" }}>{formatCFA(sCash)}</span>
                      </div>
                      {sRef > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                          <span style={{ color: "var(--text-muted)" }}>− {lang === "en" ? "Refunds this shift" : "Remboursements ce poste"}</span>
                          <span style={{ color: "#f87171" }}>−{formatCFA(sRef)}</span>
                        </div>
                      )}
                      {sExp > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                          <span style={{ color: "var(--text-muted)" }}>− {lang === "en" ? "Expenses this shift" : "Dépenses ce poste"}</span>
                          <span style={{ color: "#f87171" }}>−{formatCFA(sExp)}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, padding: "8px 0 4px", borderTop: "2px solid var(--border)", marginTop: 4 }}>
                        <span>{lang === "en" ? "Expected drawer" : "Caisse attendue"}</span>
                        <span style={{ color: "var(--brand-light)" }}>{formatCFA(dr.expected)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0 2px" }}>
                        <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Actual cash" : "Caisse réelle"}</span>
                        <span style={{ fontWeight: 600 }}>
                          {drIsClosed
                            ? formatCFA(dr.actual)
                            : <em style={{ color: "var(--text-muted)" }}>— {lang === "en" ? "(count at end of shift)" : "(à compter en fin de poste)"}</em>}
                        </span>
                      </div>
                      {drIsClosed && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0", fontWeight: 700 }}>
                          <span>{lang === "en" ? "Variance" : "Écart"}</span>
                          <span style={{ color: (dr.variance || 0) === 0 ? "#34d399" : (dr.variance || 0) > 0 ? "#fbbf24" : "#f87171" }}>
                            {(dr.variance || 0) === 0
                              ? `${formatCFA(0)} ${lang === "en" ? "(Exact)" : "(Exact)"}`
                              : (dr.variance || 0) > 0
                                ? `+${formatCFA(dr.variance)} ${lang === "en" ? "(Surplus)" : "(Excédent)"}`
                                : `−${formatCFA(Math.abs(dr.variance))} ${lang === "en" ? "(Shortage)" : "(Manquant)"}`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })() : ledgerLoc !== "all" && (
                  <div style={{ marginTop: 18, padding: "10px 14px", fontSize: 12, color: "var(--text-muted)", background: "var(--bg-elevated)", borderRadius: 10, border: "1px dashed var(--border)" }}>
                    {lang === "en"
                      ? "No cash shift was opened at this location on this day — drawer math unavailable."
                      : "Aucun poste de caisse ouvert à cet emplacement ce jour — math caisse indisponible."}
                  </div>
                )}
              </div>
            );
          })()}
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
