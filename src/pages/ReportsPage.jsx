import { useState, useEffect } from "react";
import HelpButton from "../components/common/HelpButton";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore, useAuthStore, useSettingsStore } from "../store";
import api, { formatDate } from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { openWhatsApp } from "../utils/whatsapp"; // MP-DAY-SUMMARY (Feature A)
import { buildDaySummaryText } from "../utils/daySummaryText"; // MP-DAY-SUMMARY shared engine
import { momoLabelShort } from "../utils/paymentLabels";
import { unitLabel } from "../utils/units";
import VoidReturnModal from "../components/common/VoidReturnModal";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";
import { buildLedgerTextV2 as buildLedgerTextUtil, buildWeeklyText as buildWeeklyTextUtil,
  refundKindLabel, shortRetRef } from "../utils/reportText";
import CollapsibleBlock from "../components/common/CollapsibleBlock";

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
const itemUnit    = (i) => isDebtItem(i) ? "—" : unitLabel(i?.pa_products?.unit || "pce");
const itemAmount  = (i) => (Number(i?.quantity) || 0) * (Number(i?.unit_price) || 0);
// MP-DAMAGED-GOODS-REPORT-VISIBILITY: /reports/sales-detail now selects
// is_damaged on each line — surface it here too (WhatsApp text + the inline
// report row), matching PaymentEventReceipt's own "(DAMAGED GOODS)" wording.
const isDamagedItem = (i) => i?.is_damaged === true;
const dmgSuffix     = (i, lang) => isDamagedItem(i) ? (lang === "en" ? " (DAMAGED GOODS)" : " (MARCHANDISE ENDOMMAGÉE)") : "";
// MP-SOLD-DATE-NOTE-VISIBILITY: fixed DD/MM/YYYY for the note specifically —
// same convention as every other sold-date-note render path this session.
const fmtSoldDateBadge = (isoDate) => {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return (y && m && d) ? `${d}/${m}/${y}` : String(isoDate);
};

export default function ReportsPage() {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const isOwner = user?.role === "owner";

  const [tab, setTab] = useState("daily");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
  const [to, setTo]     = useState(new Date().toISOString().split("T")[0]);
  const [expandedSale, setExpandedSale] = useState(null);
  const [expandedDisc, setExpandedDisc] = useState(null); // MP-DISCOUNT drill-down
  const [voidSale, setVoidSale] = useState(null);
  // MP-REPORTS-REPRINT-OVERLAY: reprint a past receipt through the SAME in-app
  // overlay the completed-sale receipt uses (PaymentEventReceipt), instead of the
  // old window.open()/window.print() facture that dead-ended on the Android WebView.
  const [receiptSale, setReceiptSale] = useState(null);
  // MP-DASHBOARD-REPORT-CONSISTENCY: location filter for the daily /
  // daily-sales / sales-detail aggregations. "" = All locations (default,
  // same as Dashboard) so the two pages show the same canonical number.
  const [repLoc, setRepLoc] = useState("");
  const { selectedLocation } = useSettingsStore();
  const [ledgerDate, setLedgerDate] = useState(new Date().toISOString().split("T")[0]);
  const [ledgerLoc, setLedgerLoc] = useState(selectedLocation?.id || "all");
  // MP-REFUNDS-LIST-TYPED-LABELS: filter chips above the refunds list
  // in the daily report. Pure client-side narrowing of ledger.refunds.items.
  const [refundFilter, setRefundFilter] = useState("all"); // all | refunds | exchanges | voids

  // MP-DAILY-REPORT-COLLAPSIBLE-BLOCKS: accordion expand state for the
  // 3-block daily report. State lives here (not inside CollapsibleBlock)
  // so the Ledger tab survives intra-session re-renders + tab switches
  // without resetting to defaults. Block 1 (Day Flow) defaults open;
  // Blocks 2 (Shifts) + 3 (Outstanding) default closed.
  const [blockExpanded, setBlockExpanded] = useState({
    day_flow:    true,
    shifts:      false,
    drawer:      false,   // TASK 3 drawer reconciliation
    outstanding: false,
  });
  const toggleBlock = (key) => (next) =>
    setBlockExpanded(prev => ({ ...prev, [key]: typeof next === "boolean" ? next : !prev[key] }));

  const fmt = useCurrency();

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

  const { data: dailyData, isLoading: dailyLoading } = useOfflineCachedQuery({
    queryKey: ["reports-daily", from, to, repLoc],
    queryFn: () => api.get("/reports/daily?from=" + from + "&to=" + to + locQS).then(r => r.data)
  });

  // MP-DISCOUNT: Gross → −Discounts → Net + breakdowns + drill-down.
  const { data: discData } = useOfflineCachedQuery({
    queryKey: ["reports-discounts", from, to, repLoc],
    queryFn: () => api.get("/reports/discounts?from=" + from + "&to=" + to + locQS).then(r => r.data),
  });
  const disc = discData?.data || null;

  const { data: debtData, isLoading: debtLoading } = useOfflineCachedQuery({
    queryKey: ["reports-debts"],
    queryFn: () => api.get("/reports/debts").then(r => r.data)
  });

  // Org letterhead for the FACTURE print (shared ["org-settings"] cache).
  const { data: orgResp } = useOfflineCachedQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data)
  });
  const orgSettings = orgResp?.data || {};

  const { data: salesDetailData, isLoading: salesDetailLoading } = useOfflineCachedQuery({
    queryKey: ["reports-sales-detail", from, to, repLoc],
    // OPTION A: most-recent-N sample (page 1). Totals come from the RPC and
    // cover the full range regardless; real paging can be added later if needed.
    queryFn: () => api.get(`/reports/sales-detail?from=${from}&to=${to}${locQS}&page_size=100`).then(r => r.data),
    enabled: tab === "sales"
  });

  // MP-TIMEZONE-CONVERGE: org-LOCAL today (WAT/UTC+1 — both markets), the same day
  // boundary the backend money windows use, so a sale near midnight lands on the same
  // "today" as Reports rather than the device's UTC date.
  const todayStr = new Date(Date.now() + 60 * 60000).toISOString().slice(0, 10);

  const { data: todaySalesData, isLoading: todayLoading } = useOfflineCachedQuery({
    queryKey: ["reports-today-sales", repLoc],
    // Single day: request a generous page so the day's sales aren't paginated
    // out from under the daily-summary sums below (a day never exceeds this).
    queryFn: () => api.get(`/reports/sales-detail?date=${todayStr}${locQS}&page_size=500`).then(r => r.data),
    enabled: tab === "daily_sales",
    refetchInterval: 60000
  });

  // MP-DAILY-SALES-BASIS: the Daily-Sales product breakdown + grand total come from a
  // set-based RPC on the EXACT pa_daily_summary.product_sales basis — Σ net_amount per
  // product for non-debt lines, damaged INCLUDED, full-range, cap-safe. So the tab's
  // breakdown + grand total always equal the Reports→Daily headline, on damaged days
  // too (Top Products excludes damaged by design, so it can't be reused here). Payment
  // split below stays from the sales list. See /reports/daily-product-sales.
  const { data: dailyProductsData } = useOfflineCachedQuery({
    queryKey: ["reports-daily-products", todayStr, repLoc],
    queryFn: () => api.get(`/reports/daily-product-sales?from=${todayStr}&to=${todayStr}${locQS}`).then(r => r.data),
    enabled: tab === "daily_sales",
    refetchInterval: 60000
  });

  const { data: topProductsData, isLoading: topLoading } = useOfflineCachedQuery({
    queryKey: ["reports-top-products", from, to, repLoc],
    queryFn: () => api.get(`/reports/top-products?from=${from}&to=${to}${locQS}`).then(r => r.data),  // MP-LOCATION-SCOPE: respect the screen's location filter
    enabled: tab === "products"
  });

  const { data: locationsData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    staleTime: 300000
  });
  const ledgerLocations = locationsData?.data || [];

  const { data: ledgerData, isLoading: ledgerLoading } = useOfflineCachedQuery({
    queryKey: ["reports-ledger", ledgerDate, ledgerLoc],
    queryFn: () => api.get(`/reports/daily-ledger?date=${ledgerDate}&location_id=${ledgerLoc}`).then(r => r.data),
    enabled: tab === "ledger"
  });
  const ledger = ledgerData?.data || null;

  // MP-REPORT-SIMPLIFY-AND-AUTOSEND: text body is built by the
  // shared util so the shift-close prompt in ShiftWidgets produces
  // the same bytes. Page-local wrapper keeps the (ledger, lang)
  // args implicit for the print/copy/WA buttons below.
  const buildLedgerText = () => buildLedgerTextUtil(ledger, lang);
  // buildWeeklyText is also available from the util (used by the
  // shift-close prompt); ReportsPage doesn't currently render
  // weekly data in the Ledger tab, so we don't expose it here yet.
  void buildWeeklyTextUtil;

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

  const { data: returnsData, isLoading: returnsLoading } = useOfflineCachedQuery({
    queryKey: ["reports-returns", from, to, repLoc],
    queryFn: () => api.get(`/returns?from=${from}&to=${to}${locQS}`).then(r => r.data),  // MP-LOCATION-SCOPE: respect the screen's location filter
    enabled: tab === "returns"
  });
  const returns = returnsData?.data || [];
  const returnsStats = returnsData?.stats || {};

  const daily = dailyData?.data || [];
  const debts = debtData?.data || [];
  const salesDetail = salesDetailData?.data || [];
  const salesTotals = salesDetailData?.totals || null;       // complete range totals (from RPC)
  const salesPagination = salesDetailData?.pagination || null;
  const topProducts = topProductsData?.data || [];
  const todaySales = todaySalesData?.data || [];
  // MP-DAILY-SALES-BASIS: net (damaged-INCLUSIVE), full-range per-product breakdown
  // (+ grand total) for the Daily-Sales tab — shared by the table, WhatsApp, and Print
  // so they never diverge, and equal to the Reports→Daily headline (product_sales).
  // damaged carries the per-product damaged-clearance portion so it can be shown folded
  // into the product's row while Σ rows still equals the grand total.
  const dailyProducts = (dailyProductsData?.data || [])
    .map(p => ({ name: p.name || "?", unit: unitLabel(p.unit || "pce"), qty: Number(p.total_qty) || 0, total: Number(p.total_revenue) || 0, damaged: Number(p.damaged_revenue) || 0 }))
    .sort((a, b) => b.total - a.total);
  const dailyProductsTotal = dailyProducts.reduce((s, p) => s + p.total, 0);

  const totals = daily.reduce((acc, d) => ({
    gross_sales:       acc.gross_sales       + (+d.gross_sales || 0),
    cash_collected:    acc.cash_collected    + (+d.cash_collected || 0),
    credit_given:      acc.credit_given      + (+d.credit_given || 0),  // MP-CREDIT-CONVERGE: credit GIVEN today (flow), was broken credit_sales
    total_cost:        acc.total_cost        + (+d.total_cost || 0),
    gross_profit:      acc.gross_profit      + (+d.gross_profit || 0),
    total_expenditure: acc.total_expenditure + (+d.total_expenditure || 0),
    net_profit:        acc.net_profit        + (+d.net_profit || 0),
    sale_count:        acc.sale_count        + (+d.sale_count || 0),
  }), { gross_sales:0, cash_collected:0, credit_given:0, total_cost:0, gross_profit:0, total_expenditure:0, net_profit:0, sale_count:0 });

  const avgMargin = daily.length > 0
    ? (daily.reduce((s, d) => s + (+d.profit_margin_pct || 0), 0) / daily.length).toFixed(1)
    : 0;

  // ── MP-DAY-SUMMARY (Feature A): "Send today's summary" to WhatsApp ──────────
  // Money lines reuse the EXACT on-screen totals/avgMargin (can't disagree with the
  // app); top-staff + things-to-check come from the read-only /reports/day-summary.
  const [summaryModal, setSummaryModal] = useState(null);      // { number, text } | null
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Default recipient: whatsapp_number (fallback phone's first number if slash-
  // separated), digits only, PREPEND the org country code if missing (237 CM / 234 NG)
  // — same country logic as the Help contact card. Boss can edit before sending.
  const resolveWaNumber = (org) => {
    let raw = String(org?.whatsapp_number || "").trim();
    if (!raw) raw = String(org?.phone || "").split(/[/,;]/)[0].trim();
    let digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    const cc = String(org?.country || "").toLowerCase().includes("niger") ? "234" : "237";
    if (!digits.startsWith(cc)) digits = cc + digits;
    return digits;
  };

  const buildDaySummary = async () => {
    setSummaryLoading(true);
    try {
      // top-staff + things-to-check from the read-only endpoint; MONEY stays the
      // EXACT on-screen totals/avgMargin/net_cash_real so the text can't disagree
      // with what the owner is looking at. Shared builder = buildDaySummaryText.
      const resp = await api.get(`/reports/day-summary?from=${from}&to=${to}${locQS}`).then(r => r.data).catch(() => null);  // MP-LOCATION-SCOPE: top_staff + money respect the screen's location
      const ds = (resp && resp.data) || {};
      const dateLabel = from === to ? formatDate(from, lang) : `${formatDate(from, lang)} → ${formatDate(to, lang)}`;
      const netCashReal = daily.reduce((s, d) => s + (Number(d.net_cash_real) || 0), 0);
      const text = buildDaySummaryText({
        sales: totals.gross_sales,
        sale_count: totals.sale_count,
        margin_pct: avgMargin,
        top_staff: ds.top_staff || null,
        net_cash: netCashReal,
        credit: totals.credit_given,   // MP-CREDIT-CONVERGE: "credit given today" flow
        things_to_check: Number(ds.things_to_check) || 0,
        has_daily: daily.length > 0,
      }, { lang, fmt, shopName: orgSettings.name, dateLabel });
      setSummaryModal({ number: resolveWaNumber(orgSettings), text });
    } catch (e) {
      toast(lang === "en" ? "Couldn't build the summary" : "Impossible de générer le résumé");
    } finally { setSummaryLoading(false); }
  };

  const totalDebt = debts.reduce((s, c) => s + (+c.total_debt || 0), 0);

  const exportCSV = () => {
    if (!daily.length) {
      toast(lang === "en" ? "No report data in this range" : "Aucune donnée dans cette période");
      return;
    }
    const headers = ["Date","Sales","Cash Collected","Credit Given","Cost","Gross Profit","Margin%","Expenses","Net Profit","Transactions"];
    const rows = daily.map(d => [d.sale_date, d.gross_sales, d.cash_collected, d.credit_given, d.total_cost, d.gross_profit, d.profit_margin_pct, d.total_expenditure, d.net_profit, d.sale_count]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "report_" + from + "_" + to + ".csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportSalesCSV = async () => {
    // MP-REPORTS-ROW-CAP: the on-screen list is paginated (one page), but the
    // export must cover the WHOLE range. Loop the paginated endpoint (page_size
    // 500, safely under PostgREST's 1000 cap) until every sale is pulled.
    let all = [];
    try {
      const size = 500;
      let page = 1, total = Infinity;
      while ((page - 1) * size < total) {
        const resp = await api
          .get(`/reports/sales-detail?from=${from}&to=${to}${locQS}&page=${page}&page_size=${size}`)
          .then(r => r.data);
        const batch = resp?.data || [];
        all = all.concat(batch);
        total = resp?.pagination?.total ?? batch.length;
        if (!batch.length || page > 100) break; // hard safety stop
        page++;
      }
    } catch (e) {
      toast(lang === "en" ? "Export failed" : "Échec de l'export");
      return;
    }
    // Empty-result honesty: don't hand the user a header-only file for a range
    // with no sales — tell them plainly instead.
    if (!all.length) {
      toast(lang === "en" ? "No sales in this range" : "Aucune vente dans cette période");
      return;
    }
    const rows = [["Sale#", "Date", "Customer", "Product / Line Type", "Qty", "Unit Price", "Line Total", "Payment Status"]];
    all.forEach(sale => {
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 className="page-title" style={{ margin: 0 }}>{lang === "en" ? "Reports" : "Rapports"}</h1>
          <HelpButton topic="reports" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "daily" && <button className="btn btn-secondary" onClick={exportCSV}>📊 {lang === "en" ? "Export CSV" : "Exporter CSV"}</button>}
          {/* MP-DAY-SUMMARY (Feature A): send the day's summary to WhatsApp. */}
          {tab === "daily" && isOwner && <button className="btn btn-secondary" onClick={buildDaySummary} disabled={summaryLoading} style={{ borderColor: "#25D366", color: "#25D366" }}>📲 {summaryLoading ? (lang === "en" ? "…" : "…") : (lang === "en" ? "Send summary" : "Envoyer le résumé")}</button>}
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
      {/* MP-DAY-SUMMARY (Feature A): editable-recipient + preview before sending. */}
      {summaryModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, maxWidth: 440, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 10 }}>📲 {lang === "en" ? "Send today's summary" : "Envoyer le résumé du jour"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{lang === "en" ? "WhatsApp number (with country code)" : "Numéro WhatsApp (avec indicatif)"}</div>
            <input className="input" inputMode="numeric" value={summaryModal.number}
              onChange={e => setSummaryModal(m => ({ ...m, number: e.target.value.replace(/\D/g, "") }))}
              placeholder="2376XXXXXXXX" style={{ width: "100%", marginBottom: 12 }} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{lang === "en" ? "Preview" : "Aperçu"}</div>
            <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, fontSize: 12.5, fontFamily: "inherit", margin: "0 0 14px", maxHeight: 220, overflowY: "auto" }}>{summaryModal.text}</pre>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setSummaryModal(null)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" disabled={!summaryModal.number}
                onClick={(e) => { openWhatsApp(e, summaryModal.number, summaryModal.text); setSummaryModal(null); }}
                style={{ background: "#25D366", border: "none" }}>💬 {lang === "en" ? "Send" : "Envoyer"}</button>
            </div>
          </div>
        </div>
      )}

      {tab === "daily" && (
        <div>
          <DateFilter />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: lang === "en" ? "Total sales" : "Ventes totales", value: fmt(totals.gross_sales), sub: totals.sale_count + " transactions", color: "var(--brand-light)" },
              { label: lang === "en" ? "Cash collected" : "Espèces encaissées", value: fmt(totals.cash_collected), color: "#34d399" },
              { label: lang === "en" ? "Gross profit" : "Bénéfice brut", value: fmt(totals.gross_profit), sub: avgMargin + "% avg", color: "#34d399" },
              { label: lang === "en" ? "Expenses" : "Dépenses", value: fmt(totals.total_expenditure), color: "#f87171" },
              { label: lang === "en" ? "Net profit" : "Bénéfice net", value: fmt(totals.net_profit), color: totals.net_profit >= 0 ? "#34d399" : "#f87171" },
              { label: lang === "en" ? "Credit given today" : "Crédit accordé (jour)", value: fmt(totals.credit_given), color: "#fbbf24" },
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
                      <td style={{ textAlign: "right" }}>{fmt(d.gross_sales)}<div style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.sale_count} sales</div></td>
                      <td style={{ textAlign: "right", color: "#34d399" }}>{fmt(d.cash_collected)}</td>
                      {isOwner && <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{fmt(d.total_cost)}</td>}
                      {isOwner && <td style={{ textAlign: "right", color: "#34d399", fontWeight: 500 }}>{fmt(d.gross_profit)}</td>}
                      {isOwner && <td style={{ textAlign: "right" }}><span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: d.profit_margin_pct > 20 ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: d.profit_margin_pct > 20 ? "#34d399" : "#fbbf24" }}>{d.profit_margin_pct}%</span></td>}
                      <td style={{ textAlign: "right", color: "#f87171" }}>{fmt(d.total_expenditure)}</td>
                      {isOwner && <td style={{ textAlign: "right", fontWeight: 700, color: d.net_profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(d.net_profit)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
                    <td style={{ padding: "12px 16px" }}>TOTAL</td>
                    <td style={{ textAlign: "right", padding: "12px 16px" }}>{fmt(totals.gross_sales)}</td>
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{fmt(totals.cash_collected)}</td>
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-secondary)" }}>{fmt(totals.total_cost)}</td>}
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: "#34d399" }}>{fmt(totals.gross_profit)}</td>}
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px" }}>{avgMargin}%</td>}
                    <td style={{ textAlign: "right", padding: "12px 16px", color: "#f87171" }}>{fmt(totals.total_expenditure)}</td>
                    {isOwner && <td style={{ textAlign: "right", padding: "12px 16px", color: totals.net_profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(totals.net_profit)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── MP-DISCOUNT: Gross → −Discounts → Net + breakdowns + drill-down ── */}
          {disc && disc.totals && disc.totals.discounted_sale_count > 0 && (
            <CollapsibleBlock title={`${lang === "en" ? "Discounts" : "Remises"} (${disc.totals.discounted_sale_count})`} defaultExpanded={false}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
                {[
                  { label: lang === "en" ? "Gross" : "Brut", value: fmt(disc.totals.gross), color: "var(--text-secondary)" },
                  { label: lang === "en" ? "Discounts" : "Remises", value: "−" + fmt(disc.totals.discount), color: "#34d399" },
                  { label: lang === "en" ? "Net" : "Net", value: fmt(disc.totals.net), color: "var(--brand-light)" },
                ].map(c => (
                  <div key={c.label} className="stat-card">
                    <div className="stat-label">{c.label}</div>
                    <div className="stat-value" style={{ color: c.color, fontSize: 18 }}>{c.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{lang === "en" ? "By cashier" : "Par caissier"}</div>
                  {(disc.by_cashier || []).map(c => (
                    <div key={c.cashier_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>{c.name} <span style={{ color: "var(--text-muted)" }}>({c.count})</span></span>
                      <strong style={{ color: "#34d399" }}>−{fmt(c.discount_total)}</strong>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{lang === "en" ? "By day" : "Par jour"}</div>
                  {(disc.by_day || []).map(d => (
                    <div key={d.date} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>{formatDate(d.date, lang)} <span style={{ color: "var(--text-muted)" }}>({d.count})</span></span>
                      <strong style={{ color: "#34d399" }}>−{fmt(d.discount_total)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{lang === "en" ? "Discounted sales" : "Ventes avec remise"}</div>
              {(disc.sales || []).map(s => (
                <div key={s.sale_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div onClick={() => setExpandedDisc(expandedDisc === s.sale_id ? null : s.sale_id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", cursor: "pointer", fontSize: 12, gap: 8 }}>
                    <span style={{ fontFamily: "monospace" }}>{s.sale_number} <span style={{ color: "var(--text-muted)" }}>· {formatDate(s.date, lang)} · {s.cashier_name}</span></span>
                    <span style={{ whiteSpace: "nowrap" }}><span style={{ color: "var(--text-muted)", textDecoration: "line-through", marginRight: 6 }}>{fmt(s.gross)}</span><strong style={{ color: "var(--brand-light)" }}>{fmt(s.net)}</strong> <span style={{ color: "#34d399" }}>(−{fmt(s.discount_total)})</span></span>
                  </div>
                  {expandedDisc === s.sale_id && (
                    <div style={{ padding: "4px 0 10px 12px", fontSize: 11, color: "var(--text-secondary)" }}>
                      {(s.line_discounts || []).map((l, i) => (
                        <div key={i}>• {l.name}: <span style={{ textDecoration: "line-through" }}>{fmt(l.original)}</span> −{fmt(l.discount_amount)} {l.type === "percent" ? `(${l.value}%)` : ""} — <em>{l.reason || "—"}</em></div>
                      ))}
                      {s.sale_discount && (
                        <div>• {lang === "en" ? "Whole sale" : "Vente entière"}: −{fmt(s.sale_discount.amount)} {s.sale_discount.type === "percent" ? `(${s.sale_discount.value}%)` : ""} — <em>{s.sale_discount.reason || "—"}</em></div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CollapsibleBlock>
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

          {/* MP-REPORTS-ROW-CAP: range totals come from the server RPC (complete,
              independent of which page is loaded) — NOT summed from the visible
              rows, which are now paginated. */}
          {salesTotals && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              <div className="stat-card" style={{ flex: 1, minWidth: 150 }}>
                <div className="stat-label">{lang === "en" ? "Net sales (whole range)" : "Ventes nettes (période)"}</div>
                <div className="stat-value" style={{ color: "var(--brand-light)" }}>{fmt(salesTotals.net_sales)}</div>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 110 }}>
                <div className="stat-label">{lang === "en" ? "Sales" : "Ventes"}</div>
                <div className="stat-value">{salesTotals.sale_count.toLocaleString()}</div>
              </div>
              {salesTotals.refunded_total > 0 && (
                <div className="stat-card" style={{ flex: 1, minWidth: 110 }}>
                  <div className="stat-label">{lang === "en" ? "Returns" : "Retours"}</div>
                  <div className="stat-value" style={{ color: "#f87171" }}>-{fmt(salesTotals.refunded_total)}</div>
                </div>
              )}
              {salesTotals.debt_payment_total > 0 && (
                <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
                  <div className="stat-label">{lang === "en" ? "Debt collected" : "Dette encaissée"}</div>
                  <div className="stat-value">{fmt(salesTotals.debt_payment_total)}</div>
                </div>
              )}
            </div>
          )}

          {/* OPTION A honesty: when the range holds more sales than the sample
              shown, say so plainly — the totals band above is complete, only the
              drill-down list below is a most-recent sample. */}
          {salesPagination && salesPagination.total > salesPagination.returned && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {lang === "en"
                ? `Showing the ${salesPagination.returned.toLocaleString()} most recent of ${salesPagination.total.toLocaleString()} sales — the totals above cover the full range. Narrow the dates to drill into older sales.`
                : `Affichage des ${salesPagination.returned.toLocaleString()} ventes les plus récentes sur ${salesPagination.total.toLocaleString()} — les totaux ci-dessus couvrent toute la période. Réduisez les dates pour voir les ventes plus anciennes.`}
            </div>
          )}

          {salesDetailLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : salesDetail.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600 }}>{lang === "en" ? "No sales in this period" : "Aucune vente"}</div></div>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {sortedDates.map(date => {
                const daySales = salesByDate[date];
                // MP-REPORTS-DEBT-DOUBLECOUNT: day SALES = Σ product-line net
                // (server `product_net`), NOT total_amount (which includes the
                // debt_payment line). Falls back to total_amount for any older
                // cached row lacking product_net.
                const saleSalesValue = (sale) => Number(sale.product_net != null ? sale.product_net : sale.total_amount) || 0;
                const dayTotal = daySales.reduce((s, sale) => s + saleSalesValue(sale), 0);
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
                            <span style={{ color: "var(--text-muted)", textDecoration: "line-through" }}>{fmt(dayTotal)}</span>
                            <span style={{ color: "#f87171" }}>↩ -{fmt(dayReturns)}</span>
                            <span style={{ fontWeight: 800, color: "var(--brand-light)" }}>{fmt(dayNet)} {lang === "en" ? "NET" : "NET"}</span>
                          </>
                        ) : (
                          <span style={{ fontWeight: 700, color: "var(--brand-light)" }}>{fmt(dayTotal)}</span>
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
                            {/* Sale header - clickable. MP-INVOICE-ROW-MOBILE-REACH:
                                row wraps + flex:1 groups get minWidth:0 so on a 360px
                                viewport the amount + per-sale actions (Void/WhatsApp/Print)
                                reflow into view instead of being clipped by the card's
                                overflow:hidden (the monospace sale number + status badges
                                used to force the row to ~367px). */}
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
                              <div onClick={() => setExpandedSale(isExpanded ? null : sale.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: 0 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
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
                                  {/* MP-SOLD-DATE-NOTE (Peter, 2026-07-19): collapsed line shows the
                                      sold-date VALUE inline — no hover needed. The FULL note (recorder
                                      + record stamp) is a PERMANENT line on the EXPANDED card below;
                                      a hover title is invisible on touch and 100% of users are on
                                      phones, so NO title attribute here — nothing relies on hover. */}
                                  {sale.sold_date_note && (
                                    <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "rgba(251,197,3,0.15)", color: "var(--brand-light)", fontWeight: 700 }}>
                                      📝 {lang === "en" ? "Sold" : "Vendu"}: {fmtSoldDateBadge(sale.sold_date_note)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                  {sale.pa_customers?.name || (lang === "en" ? "Walk-in customer" : "Client de passage")}
                                  {" · "}
                                  {items.length} {lang === "en" ? "item(s)" : "article(s)"}
                                  {/* MP-SALE-CASHIER-NAME: who rang this sale. */}
                                  {sale.cashier_name && <> · {lang === "en" ? "Sold by" : "Vendu par"}: {sale.cashier_name}</>}
                                </div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                {/* MP-REPORTS-DEBT-DOUBLECOUNT: the sale's value is its
                                    product-line net (goods). A debt_payment line is shown
                                    separately as "Debt collected", never as sale revenue. */}
                                {Number(sale.refunded_total) > 0 ? (
                                  <>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "line-through" }}>{fmt(sale.product_net != null ? sale.product_net : sale.total_amount)}</div>
                                    <div style={{ fontWeight: 800, fontSize: 15, color: Number(sale.net_amount) <= 0 ? "var(--text-muted)" : "var(--brand-light)" }}>
                                      {fmt(sale.net_amount)} {lang === "en" ? "NET" : "NET"}
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ fontWeight: 800, fontSize: 15, color: "var(--brand-light)" }}>{fmt(sale.product_net != null ? sale.product_net : sale.total_amount)}</div>
                                )}
                                {Number(sale.debt_payment_amount) > 0 && (
                                  <div style={{ fontSize: 11, color: "#fbbf24" }}>💰 {lang === "en" ? "Debt collected" : "Dette encaissée"}: {fmt(sale.debt_payment_amount)}</div>
                                )}
                                {sale.balance_due > 0 && <div style={{ fontSize: 11, color: "#f87171" }}>Due: {fmt(sale.balance_due)}</div>}
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
                                      : `${itemLabel(i, lang)}${dmgSuffix(i, lang)} × ${i.quantity} ... ${itemAmount(i).toLocaleString()} F\n`;
                                  });
                                  msg += `─────────────────────\n*Total: ${total.toLocaleString()} ${fmt.symbol}*`;
                                  if (sale.payment_status === "credit") msg += `\n🔴 CRÉDIT: ${total.toLocaleString()} F DÛ`;
                                  else if (sale.payment_status === "partial") msg += `\n🟡 PARTIEL — Reste: ${sale.balance_due?.toLocaleString()} F`;
                                  // MP-SOLD-DATE-NOTE-VISIBILITY: this is a SEPARATE WhatsApp text
                                  // builder from receiptText.js's buildMonospaceReceipt (POS's own
                                  // WhatsApp share) — the note has to be added here independently
                                  // or this specific surface stays blind to it.
                                  if (sale.sold_date_note) {
                                    msg += lang === "en"
                                      ? `\nNOTE — Sold Date: ${fmtSoldDateBadge(sale.sold_date_note)}${sale.sold_date_note_by_name ? ` (recorded by ${sale.sold_date_note_by_name})` : ""}`
                                      : `\nNOTE — Date de vente : ${fmtSoldDateBadge(sale.sold_date_note)}${sale.sold_date_note_by_name ? ` (saisi par ${sale.sold_date_note_by_name})` : ""}`;
                                  }
                                  const phone = sale.pa_customers?.phone ? "237" + sale.pa_customers.phone.toString().replace(/^0/,"").replace(/\s/g,"") : "";
                                  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                                }} style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                  📱
                                </button>
<button onClick={() => {
                                  // MP-REPORTS-REPRINT-OVERLAY: reprint through the shared
                                  // PaymentEventReceipt overlay (A4 facture + 58/80mm thermal +
                                  // Bluetooth ESC/POS), the SAME path the completed-sale receipt
                                  // uses. Debt-payment lines map to qty 1 (amount as P.U.) and are
                                  // tagged type:'debt_payment' so the receipt renders them correctly.
                                  // MP-DAMAGED-GOODS-REPORT-VISIBILITY: carry is_damaged through so
                                  // PaymentEventReceipt's own "(DAMAGED GOODS)" badge logic fires —
                                  // dropping it here silently produced a receipt indistinguishable
                                  // from a normal sale.
                                  const items = (sale.pa_sale_items || []).map(i => isDebtItem(i)
                                    ? { name: itemLabel(i, lang), quantity: 1, unit_price: itemAmount(i), type: "debt_payment" }
                                    : { name: itemLabel(i, lang), quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0, is_damaged: i.is_damaged === true });
                                  setReceiptSale({
                                    sale_number:    sale.sale_number || "",
                                    sale_date:      sale.sale_date || "",
                                    created_at:     sale.created_at || sale.sale_date || null,
                                    total_amount:   sale.total_amount != null ? Number(sale.total_amount) : null,
                                    paid_amount:    sale.paid_amount != null ? Number(sale.paid_amount) : null,
                                    balance_due:    sale.balance_due != null ? Number(sale.balance_due) : null,
                                    payment_status: sale.payment_status || "",
                                    payment_method: sale.payment_method || "",
                                    customer_name:  sale.pa_customers?.name || null,
                                    customer_phone: sale.pa_customers?.phone || null,
                                    cashier_name:   sale.cashier_name || null, // MP-SALE-CASHIER-NAME
                                    // MP-SOLD-DATE-NOTE: without these, a reprint from history would
                                    // silently drop the note even though the backend returns it —
                                    // this object is an explicit field allowlist, not a spread.
                                    sold_date_note:         sale.sold_date_note || null,
                                    sold_date_note_by_name: sale.sold_date_note_by_name || null,
                                    sold_date_note_at:      sale.sold_date_note_at || null, // record stamp (full note on receipt)
                                    items,
                                  });
                                }} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}>
                                  🖨️
                                </button>
                              </div>
                            </div>

                            {/* Expanded items */}
                            {isExpanded && (
                              <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                                {/* MP-SOLD-DATE-NOTE (Peter, 2026-07-19): PERMANENT full note on the
                                    expanded card — always readable on a phone, no hover/tooltip. */}
                                {sale.sold_date_note && (
                                  <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--border)", background: "rgba(251,197,3,0.10)", fontSize: 12, color: "var(--brand-light)", lineHeight: 1.5 }}>
                                    📝 {lang === "en" ? "Sold Date: " : "Date de vente : "}
                                    <strong>{fmtSoldDateBadge(sale.sold_date_note)}</strong>
                                    {sale.sold_date_note_by_name ? (lang === "en" ? ` · recorded by ${sale.sold_date_note_by_name}` : ` · saisi par ${sale.sold_date_note_by_name}`) : ""}
                                    {sale.sold_date_note_at ? (lang === "en"
                                      ? ` · recorded ${new Date(sale.sold_date_note_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                                      : ` · enregistré ${new Date(sale.sold_date_note_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`) : ""}
                                  </div>
                                )}
                                {items.map((item, idx) => (
                                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: idx < items.length - 1 ? "1px solid var(--border)" : "none" }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                                        {itemLabel(item, lang)}
                                        {/* MP-DAMAGED-GOODS-REPORT-VISIBILITY: this line's stock came
                                            from the damaged pile, not sellable stock — flag it here too. */}
                                        {isDamagedItem(item) && (
                                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            🔨 {lang === "en" ? "Damaged" : "Endommagé"}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        {isDebtItem(item)
                                          ? (lang === "en" ? "applied to customer debt" : "appliqué à la dette client")
                                          : `${item.quantity} ${itemUnit(item)} × ${fmt(item.unit_price)}`}
                                      </div>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--brand-light)" }}>
                                      {fmt(itemAmount(item))}
                                    </div>
                                  </div>
                                ))}
                                {/* MP-REPORTS-DEBT-DOUBLECOUNT: goods vs debt split. */}
                                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", borderTop: "1px solid var(--border)", fontWeight: 700 }}>
                                  <span>{lang === "en" ? "Goods total" : "Total marchandise"}</span>
                                  <span style={{ color: "var(--brand-light)" }}>{fmt(sale.product_net != null ? sale.product_net : sale.total_amount)}</span>
                                </div>
                                {Number(sale.debt_payment_amount) > 0 && (
                                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 20px", fontSize: 12, color: "#fbbf24" }}>
                                    <span>💰 {lang === "en" ? "Debt collected (not sales)" : "Dette encaissée (hors ventes)"}</span>
                                    <span>{fmt(sale.debt_payment_amount)}</span>
                                  </div>
                                )}
                                {(sale.returns || []).length > 0 && (
                                  <div style={{ borderTop: "2px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.06)" }}>
                                    <div style={{ padding: "8px 20px", fontWeight: 700, fontSize: 12, color: "#f87171" }}>
                                      ↩ {lang === "en" ? "Returns linked to this sale" : "Retours liés à cette vente"}
                                    </div>
                                    {sale.returns.map(r => (
                                      <div key={r.id} style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", fontSize: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                                          <span style={{ fontFamily: "monospace" }}>{r.return_ref}</span>
                                          <span style={{ color: "#f87171" }}>-{fmt(r.refund_amount)} {r.refund_method && r.refund_method !== "none" ? `(${r.refund_method})` : ""}</span>
                                        </div>
                                        <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                                          {new Date(r.created_at).toLocaleString()} · {r.processed_by_name || "—"}
                                          {r.reason ? ` · ${lang === "en" ? "reason" : "raison"}: ${r.reason}` : ""}
                                          {r.return_type ? ` · ${r.return_type}` : ""}
                                        </div>
                                        {(r.items_returned || []).map((ri, j) => (
                                          <div key={j} style={{ color: "var(--text-muted)", marginTop: 2 }}>
                                            • {ri.name || ri.product_id} × {ri.qty || ri.quantity} @ {fmt(ri.unit_price || 0)}
                                          </div>
                                        ))}
                                      </div>
                                    ))}
                                    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", borderTop: "1px solid var(--border)", fontWeight: 800 }}>
                                      <span>{lang === "en" ? "NET after returns" : "NET après retours"}</span>
                                      <span style={{ color: Number(sale.net_amount) <= 0 ? "var(--text-muted)" : "var(--brand-light)" }}>{fmt(sale.net_amount)}</span>
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
                // Breakdown + total from the net full-range RPC (dailyProducts); payment
                // split from the sales list.
                const items = dailyProducts;
                const grandTotal = dailyProductsTotal;
                const paid = todaySales.filter(s => s.payment_status === "paid").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const credit = todaySales.filter(s => s.payment_status === "credit").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const partial = todaySales.filter(s => s.payment_status === "partial").reduce((s, sale) => s + parseFloat(sale.balance_due || 0), 0);
                const today = new Date().toLocaleDateString("fr-FR");
                let msg = `📊 *Ventes du jour — ${today}*
`;
                msg += `─────────────────────
`;
                items.forEach(i => { msg += `${i.name} × ${i.qty} ${i.unit} ... ${i.total.toLocaleString()} F${i.damaged > 0 ? ` (dont ${i.damaged.toLocaleString()} F abîmé)` : ""}
`; });
                msg += `─────────────────────
`;
                msg += `*Total: ${grandTotal.toLocaleString()} ${fmt.symbol}*
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
                // Breakdown + total from the net full-range RPC (same as the WhatsApp share).
                const items = dailyProducts;
                const grandTotal = dailyProductsTotal;
                const paid = todaySales.filter(s => s.payment_status === "paid").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const credit = todaySales.filter(s => s.payment_status === "credit").reduce((s, sale) => s + parseFloat(sale.total_amount), 0);
                const today = new Date().toLocaleDateString("fr-FR");
                const w = window.open("","_blank","width=350,height=600");
                w.document.write(`<html><head><style>body{font-family:monospace;font-size:12px;width:300px;margin:0 auto}.row{display:flex;justify-content:space-between;margin-bottom:4px}.line{border-top:1px dashed #000;margin:8px 0}.center{text-align:center}.bold{font-weight:bold;font-size:14px}</style></head><body>
                  <div class="center bold">VENTES DU JOUR</div>
                  <div class="center">${today}</div>
                  <div class="line"></div>
                  ${items.map(i => `<div class="row"><span>${i.name} × ${i.qty} ${i.unit}${i.damaged > 0 ? ` (dont ${i.damaged.toLocaleString()} F abîmé)` : ""}</span><span>${i.total.toLocaleString()} F</span></div>`).join("")}
                  <div class="line"></div>
                  <div class="row bold"><span>TOTAL</span><span>${grandTotal.toLocaleString()} ${fmt.symbol}</span></div>
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
            // MP-DAILY-SALES-RPC-TOTAL: product breakdown + grand total = net full-range
            // RPC (dailyProducts/dailyProductsTotal); payment split stays sale-level
            // (from the sales list) so it's correct even on debt-only days.
            let totalPaid = 0, totalCredit = 0, totalPartialDue = 0;
            todaySales.forEach(sale => {
              if (sale.payment_status === "paid") totalPaid += parseFloat(sale.total_amount);
              if (sale.payment_status === "credit") totalCredit += parseFloat(sale.total_amount);
              if (sale.payment_status === "partial") totalPartialDue += parseFloat(sale.balance_due || 0);
            });
            const items = dailyProducts;
            const grandTotal = dailyProductsTotal;
            return (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
                <table className="table" style={{ minWidth: 500 }}>
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
                        <td style={{ fontWeight: 600 }}>
                          {item.name}
                          {item.damaged > 0 && (
                            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "#fbbf24" }}>
                              🔧 {lang === "en" ? `incl. ${item.damaged.toLocaleString()} damaged` : `dont ${item.damaged.toLocaleString()} abîmé`}
                            </span>
                          )}
                        </td>
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
                        {grandTotal.toLocaleString()} {fmt.symbol}
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
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 540 }}>
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
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>{fmt(p.total_revenue)}</td>
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
              <div className="stat-value" style={{ color: "#f87171" }}>{fmt(totalDebt)}</div>
            </div>
            <div className="stat-card" style={{ flex: 1 }}>
              <div className="stat-label">{lang === "en" ? "Customers with debt" : "Clients avec crédit"}</div>
              <div className="stat-value" style={{ color: "#fbbf24" }}>{debts.length}</div>
            </div>
          </div>

          {debtLoading ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          : debts.length === 0 ? <div className="empty-state"><div style={{ fontWeight: 600, color: "#34d399" }}>✓ {lang === "en" ? "No outstanding debts!" : "Aucun crédit en cours!"}</div></div>
          : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
              <table className="table" style={{ minWidth: 760 }}>
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
                        <td><span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(251,197,3,0.1)", color: "var(--brand-light)" }}>{c.customer_type}</span></td>
                        <td style={{ textAlign: "right" }}>{c.open_invoices}</td>
                        <td style={{ color: isOverdue ? "#f87171" : "var(--text-secondary)", fontSize: 13 }}>
                          {c.earliest_due ? formatDate(c.earliest_due) + (isOverdue ? " ⚠️" : "") : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#f87171", fontSize: 15 }}>{fmt(c.total_debt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)" }}>
                    <td colSpan={5} style={{ padding: "12px 16px", fontWeight: 700 }}>TOTAL</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#f87171", padding: "12px 16px", fontSize: 16 }}>{fmt(totalDebt)}</td>
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
              [lang === "en" ? "Total refunded" : "Total remboursé", fmt(returnsStats.total_refunded || 0)],
              [lang === "en" ? "Avg value" : "Valeur moy.", fmt(returnsStats.avg_value || 0)],
              [lang === "en" ? "Top reason" : "Raison principale", returnsStats.top_reason || "—"],
            ].map(([k, v], i) => (
              <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", minWidth: 130 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: "auto" }}>
            <table className="data-table" style={{ width: "100%", fontSize: 13, minWidth: 900 }}>
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
                    <td style={{ padding: "8px 12px", color: "#f87171" }}>{fmt(r.refund_amount || 0)}</td>
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
                <span style={{ color }}>{fmt(value)}</span>
              </div>
            );

            // MP-REPORT-SIMPLIFY-AND-AUTOSEND: simplified summary
            // block — same math as buildLedgerText so the on-screen
            // panel and the WhatsApp message match. Shown at the top
            // of the card; per-section item lists below are the
            // cashier audit trail.
            const totalReceived = (Number(ps.total) || 0) + (Number(dc.total) || 0);
            const debtIssued    = Number(tot.impaye_aujourdhui || 0);
            const drCounted     = dr && dr.actual != null ? Number(dr.actual) : null;
            const drVariance    = dr && dr.variance != null ? Number(dr.variance) : null;
            const cashAtHand    = drCounted != null ? drCounted - Number(ex.total || 0) : null;
            const SimpleRow = ({ label, value, bold, color }) => (
              <div style={{ display: "flex", justifyContent: "space-between", padding: bold ? "8px 0 4px" : "4px 0", fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 500 }}>
                <span style={{ color: color || (bold ? "var(--text-primary)" : "var(--text-muted)") }}>{label}</span>
                <span style={{ color: color || (bold ? "var(--brand-light)" : "var(--text-primary)") }}>{value}</span>
              </div>
            );

            // MP-DAILY-REPORT-PROFESSIONAL-REDESIGN: in-app 3-block
            // render. Reads ledger.blocks; if absent (older backend),
            // falls back to the legacy SimpleRow summary so a stale
            // backend doesn't blank the page.
            const bl = ledger.blocks || null;
            const tfmt = (iso) => iso
              ? new Date(iso).toLocaleTimeString(lang === "en" ? "en-GB" : "fr-FR",
                  { hour: "2-digit", minute: "2-digit" })
              : "—";
            const BlockRow = ({ label, value, indent, bold, color, sign }) => (
              <div style={{ display: "flex", justifyContent: "space-between",
                            padding: bold ? "8px 0 4px" : "3px 0",
                            paddingLeft: indent ? 14 : 0,
                            fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 500 }}>
                <span style={{ color: color || (bold ? "var(--text-primary)" : "var(--text-muted)") }}>{label}</span>
                <span style={{ color: color || (bold ? "var(--brand-light)" : "var(--text-primary)") }}>
                  {sign === "-" ? "−" : ""}{value}
                </span>
              </div>
            );

            return (
              <div className="card" style={{ maxWidth: 620, margin: "0 auto", padding: "20px 22px" }}>

                {/* ── 3-BLOCK PROFESSIONAL REPORT (when backend provides blocks) ── */}
                {bl ? (() => {
                  // MP-DAILY-REPORT-COLLAPSIBLE-BLOCKS (revised):
                  // single subtotal number per collapsed block — no
                  // verbose summary. Computed from existing block data.
                  //   Block 1: "Day net: ±X FCFA" (net_cash_flow)
                  //   Block 2: sum(expected_drawer) across shifts
                  //   Block 3: net new credit extended today
                  //            (impaye_aujourdhui / debt_issued_today;
                  //            same value the daily report uses for
                  //            "Credit issued today").
                  const shiftsList    = bl.shifts || [];
                  const shiftDrawer   = shiftsList.reduce(
                    (s, r) => s + (Number(r.expected_drawer) || 0), 0);
                  const dayFlowSubtotal = lang === "en"
                    ? `Day net: ${fmt(bl.day_flow.net_cash_flow)}`
                    : `Net du jour: ${fmt(bl.day_flow.net_cash_flow)}`;
                  const shiftsSubtotal = shiftsList.length === 0
                    ? (lang === "en" ? "no shifts" : "aucun poste")
                    : `${fmt(shiftDrawer)} ${fmt.symbol}`;
                  // MP-REPORTS-DEBT-DOUBLECOUNT: the Outstanding headline is the
                  // ACTUAL current receivable (Σ customer debt), not gross credit
                  // issued today. "Debt issued today" stays as a detail row.
                  const outstandingSubtotal = `${fmt(bl.outstanding.total_customer_debt_all_time)} ${fmt.symbol}`;
                  return (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, textAlign: "center", letterSpacing: "0.3px" }}>
                      {lang === "en" ? "DAILY REPORT" : "RAPPORT DU JOUR"}
                      {ledger.location?.name && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> — {ledger.location.name}</span>}
                    </div>

                    {/* ── BLOCK 1 — DAY FLOW (default expanded) ─ */}
                    <CollapsibleBlock
                      title={`📊 ${lang === "en" ? "DAY FLOW" : "MOUVEMENT DU JOUR"}`}
                      subtotalValue={dayFlowSubtotal}
                      expanded={blockExpanded.day_flow}
                      onToggle={toggleBlock("day_flow")}>
                      <BlockRow label={lang === "en" ? "Sales today" : "Ventes du jour"} value={fmt(bl.day_flow.sales.total)} bold />
                      <BlockRow indent label={lang === "en" ? "Paid cash" : "Payé espèces"} value={fmt(bl.day_flow.sales.paid_cash)} />
                      <BlockRow indent label={`${lang === "en" ? "Paid " : "Payé "}${momoLabelShort(fmt.currency, lang === "en")}`} value={fmt(bl.day_flow.sales.paid_momo)} />
                      <BlockRow indent label={lang === "en" ? "Paid bank" : "Payé banque"} value={fmt(bl.day_flow.sales.paid_bank)} />
                      <BlockRow indent label={lang === "en" ? "On credit" : "À crédit"} value={fmt(bl.day_flow.sales.on_credit)} color="#fbbf24" />
                      <div style={{ height: 8 }} />
                      <BlockRow label={lang === "en" ? "Debt collected" : "Dette encaissée"} value={fmt(bl.day_flow.debt_collected.total)} bold />
                      <BlockRow indent label={lang === "en" ? "Cash" : "Espèces"} value={fmt(bl.day_flow.debt_collected.cash)} />
                      <BlockRow indent label={momoLabelShort(fmt.currency, lang === "en")} value={fmt(bl.day_flow.debt_collected.momo)} />
                      <BlockRow indent label={lang === "en" ? "Bank" : "Banque"} value={fmt(bl.day_flow.debt_collected.bank)} />
                      <div style={{ height: 8 }} />
                      {/* MP-VOID-PHYSICS: both legs explicit — cash-in on voided sales (+) then the cash-out (−). */}
                      {bl.drawer && Number(bl.drawer.cash_received_on_voided_sales) > 0 && (
                        <BlockRow label={lang === "en" ? "Cash received on voided sales" : "Espèces reçues sur ventes annulées"}
                                  value={fmt(bl.drawer.cash_received_on_voided_sales)}
                                  color="#34d399" sign="+" />
                      )}
                      <BlockRow label={lang === "en" ? "Refunds & voids paid out" : "Remboursements & annulations décaissés"}
                                value={fmt(bl.day_flow.refunds_voids_cash_out)}
                                color={bl.day_flow.refunds_voids_cash_out > 0 ? "#f87171" : undefined}
                                sign={bl.day_flow.refunds_voids_cash_out > 0 ? "-" : ""} />
                      {bl.day_flow.exchanges && bl.day_flow.exchanges.count > 0 && (
                        <BlockRow label={`${lang === "en" ? "Exchanges" : "Échanges"} (${bl.day_flow.exchanges.count})`}
                                  value={fmt(Math.abs(bl.day_flow.exchanges.net))}
                                  color={bl.day_flow.exchanges.net < 0 ? "#f87171" : bl.day_flow.exchanges.net > 0 ? "#34d399" : undefined}
                                  sign={bl.day_flow.exchanges.net < 0 ? "-" : ""} />
                      )}
                      <BlockRow label={lang === "en" ? "Expenses" : "Dépenses"}
                                value={fmt(bl.day_flow.expenses)}
                                color={bl.day_flow.expenses > 0 ? "#f87171" : undefined}
                                sign={bl.day_flow.expenses > 0 ? "-" : ""} />
                      <div style={{ height: 1, background: "var(--border)", margin: "8px 0 4px" }} />
                      <BlockRow label={lang === "en" ? "Net cash flow" : "Flux net espèces"}
                                value={fmt(bl.day_flow.net_cash_flow)} bold
                                color={bl.day_flow.net_cash_flow < 0 ? "#f87171" : "#34d399"} />
                    </CollapsibleBlock>

                    {/* ── BLOCK 2 — SHIFTS (default collapsed) ── */}
                    <CollapsibleBlock
                      title={`🗂️ ${lang === "en" ? "SHIFTS" : "POSTES"}`}
                      subtotalValue={shiftsSubtotal}
                      expanded={blockExpanded.shifts}
                      onToggle={toggleBlock("shifts")}>
                      {bl.shifts.length === 0 ? (
                        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>
                          {lang === "en" ? "No shift opened today." : "Aucun poste ouvert aujourd'hui."}
                        </div>
                      ) : bl.shifts.map((s, i) => {
                        const closed = !!s.closed_at;
                        return (
                          <div key={s.shift_id} style={{ padding: "8px 0", borderTop: i > 0 ? "1px dashed var(--border)" : "none" }}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                              ▸ {lang === "en" ? "Shift" : "Poste"} {i + 1}: {s.cashier_name || "—"}
                              {s.location_name && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {s.location_name}</span>}
                              <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 12, marginLeft: 6 }}>
                                ({tfmt(s.opened_at)} → {closed ? tfmt(s.closed_at) : (lang === "en" ? "open" : "ouvert")})
                              </span>
                            </div>
                            <BlockRow indent label={lang === "en" ? "Opening float" : "Fond d'ouverture"} value={fmt(s.opening_float)} />
                            <BlockRow indent label={lang === "en" ? "Cash sales" : "Ventes espèces"} value={fmt(s.cash_sales)} />
                            <BlockRow indent label={lang === "en" ? "Debt collected (cash)" : "Dette encaissée (espèces)"} value={fmt(s.debt_collected_cash)} />
                            <BlockRow indent label={lang === "en" ? "Cash refunds" : "Remboursements espèces"} value={fmt(s.cash_refunds)} color={s.cash_refunds > 0 ? "#f87171" : undefined} sign={s.cash_refunds > 0 ? "-" : ""} />
                            {((s.exchange_cash_in || 0) > 0 || (s.exchange_cash_out || 0) > 0) && (() => {
                              const exNet = (s.exchange_cash_in || 0) - (s.exchange_cash_out || 0);
                              return <BlockRow indent label={lang === "en" ? "Exchanges (net)" : "Échanges (net)"} value={fmt(Math.abs(exNet))} color={exNet < 0 ? "#f87171" : exNet > 0 ? "#34d399" : undefined} sign={exNet < 0 ? "-" : ""} />;
                            })()}
                            <BlockRow indent label={lang === "en" ? "Expenses" : "Dépenses"} value={fmt(s.expenses)} color={s.expenses > 0 ? "#f87171" : undefined} sign={s.expenses > 0 ? "-" : ""} />
                            <BlockRow indent label={lang === "en" ? "Expected drawer" : "Caisse attendue"} value={fmt(s.expected_drawer)} bold />
                            {closed && s.counted_at_close != null && (
                              <>
                                <BlockRow indent label={lang === "en" ? "Counted at close" : "Comptée à la clôture"} value={fmt(s.counted_at_close)} />
                                {s.variance != null && s.variance !== 0 && (
                                  <BlockRow indent
                                    label={s.variance < 0
                                      ? (lang === "en" ? "Variance (short)" : "Écart (manquant)")
                                      : (lang === "en" ? "Variance (surplus)" : "Écart (excédent)")}
                                    value={`${s.variance > 0 ? "+" : "−"}${fmt(Math.abs(s.variance))}`}
                                    color={s.variance < 0 ? "#f87171" : "#fbbf24"} />
                                )}
                              </>
                            )}
                            {!closed && (
                              <BlockRow indent label={lang === "en" ? "Status" : "Statut"}
                                value={lang === "en" ? "open — not counted" : "ouvert — pas compté"}
                                color="var(--text-muted)" />
                            )}
                          </div>
                        );
                      })}
                    </CollapsibleBlock>

                    {/* ── DRAWER — Expected drawer / variance / unattributed (TASK 3) ── */}
                    {bl.drawer && (
                      <CollapsibleBlock
                        title={`💵 ${lang === "en" ? "DRAWER" : "CAISSE"}`}
                        subtotalValue={bl.drawer.expected_drawer}
                        expanded={blockExpanded.drawer}
                        onToggle={toggleBlock("drawer")}>
                        <BlockRow label={lang === "en" ? "Expected drawer" : "Caisse attendue"} value={fmt(bl.drawer.expected_drawer)} bold />
                        {bl.drawer.drawer_variance != null && bl.drawer.drawer_variance !== 0 && (
                          // Non-zero variance stands out: red, signed, ⚠.
                          <BlockRow
                            label={lang === "en" ? "Drawer variance" : "Écart de caisse"}
                            value={`⚠ ${bl.drawer.drawer_variance > 0 ? "+" : "−"}${fmt(Math.abs(bl.drawer.drawer_variance))}`}
                            color="#f87171" bold />
                        )}
                        {bl.drawer.drawer_variance === 0 && (
                          <BlockRow label={lang === "en" ? "Drawer variance" : "Écart de caisse"} value={fmt(0)} color="#34d399" />
                        )}
                        {bl.drawer.drawer_variance == null && (
                          <BlockRow label={lang === "en" ? "Drawer variance" : "Écart de caisse"}
                            value={lang === "en" ? "— (shift not counted)" : "— (caisse non comptée)"} color="var(--text-muted)" />
                        )}
                        {Number(bl.drawer.unattributed_cash) > 0 && (
                          <BlockRow label={lang === "en" ? "Unattributed cash (no shift)" : "Espèces hors caisse (sans quart)"}
                            value={fmt(bl.drawer.unattributed_cash)} color="#fbbf24" />
                        )}
                        {bl.drawer.reconciliation_warning && (
                          <div style={{ color: "#f87171", fontSize: 12, padding: "4px 0", fontWeight: 600 }}>
                            ⚠ {lang === "en" ? "Reconciliation mismatch — figures may be off." : "Écart de rapprochement — chiffres possiblement erronés."}
                          </div>
                        )}
                        <div style={{ color: "var(--text-muted)", fontSize: 11, padding: "4px 0" }}>
                          {lang === "en"
                            ? "Expected = opening float + cash sales + cash on voided sales + cash debt collected − refunds/voids paid out − expenses."
                            : "Attendu = fond de caisse + ventes espèces + espèces sur ventes annulées + dette encaissée (espèces) − remboursements/annulations décaissés − dépenses."}
                        </div>
                      </CollapsibleBlock>
                    )}

                    {/* ── BLOCK 3 — OUTSTANDING (default collapsed) ── */}
                    <CollapsibleBlock
                      title={`📒 ${lang === "en" ? "OUTSTANDING" : "EN SUSPENS"}`}
                      subtotalValue={outstandingSubtotal}
                      expanded={blockExpanded.outstanding}
                      onToggle={toggleBlock("outstanding")}>
                      <BlockRow label={lang === "en" ? "Debt issued today" : "Crédit accordé aujourd'hui"}
                                value={fmt(bl.outstanding.debt_issued_today)}
                                color={bl.outstanding.debt_issued_today > 0 ? "#fbbf24" : undefined} />
                      <BlockRow label={lang === "en" ? "Total customer debt (all time)" : "Dette client totale (tous comptes)"}
                                value={fmt(bl.outstanding.total_customer_debt_all_time)} bold />
                    </CollapsibleBlock>
                  </>
                  );
                })() : (
                  /* ── FALLBACK: legacy SimpleRow summary (back-compat with older backends) ── */
                  <div style={{ marginBottom: 22, padding: "16px 18px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, textAlign: "center", letterSpacing: "0.3px" }}>
                      {lang === "en" ? "DAILY REPORT" : "RAPPORT DU JOUR"}
                      {ledger.location?.name && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> — {ledger.location.name}</span>}
                    </div>
                    <SimpleRow label={lang === "en" ? "Amount sold"    : "Ventes du jour"}   value={fmt(ps.total)} />
                    <SimpleRow label={lang === "en" ? "Debt collected" : "Dette encaissée"} value={fmt(dc.total)} />
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                    <SimpleRow label={lang === "en" ? "Total money received" : "Total reçu"}
                      value={fmt(totalReceived)} bold />
                    {drCounted != null && (
                      <>
                        <div style={{ height: 12 }} />
                        <SimpleRow label={lang === "en" ? "Counted in drawer" : "Caisse comptée"}
                          value={fmt(drCounted)} />
                        {drVariance != null && drVariance < 0 && (
                          <SimpleRow label={lang === "en" ? "Lost (drawer short)" : "Manquant"}
                            value={fmt(Math.abs(drVariance))} color="#f87171" />
                        )}
                        {drVariance != null && drVariance > 0 && (
                          <SimpleRow label={lang === "en" ? "Drawer surplus" : "Excédent caisse"}
                            value={`+${fmt(drVariance)}`} color="#fbbf24" />
                        )}
                        {Number(ex.total) > 0 && (
                          <SimpleRow label={lang === "en" ? "Expenses" : "Dépenses"}
                            value={fmt(ex.total)} color="#f87171" />
                        )}
                        <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                        <SimpleRow label={lang === "en" ? "Cash at hand" : "Cash en main"}
                          value={fmt(cashAtHand)} bold color={cashAtHand < 0 ? "#f87171" : "#34d399"} />
                      </>
                    )}
                    {drCounted == null && dr && (
                      <div style={{ marginTop: 10, padding: "8px 10px", fontSize: 12, color: "var(--text-muted)", background: "var(--bg-card)", border: "1px dashed var(--border)", borderRadius: 8 }}>
                        {lang === "en"
                          ? "Drawer not counted yet — shift still open"
                          : "Caisse non comptée — poste encore ouvert"}
                      </div>
                    )}
                    {debtIssued > 0 && (
                      <>
                        <div style={{ height: 12 }} />
                        <SimpleRow label={lang === "en" ? "Debt issued (on credit)" : "Crédit du jour"}
                          value={fmt(debtIssued)} color="#fbbf24" />
                      </>
                    )}
                  </div>
                )}

                {/* ── Detail sections below (cashier audit trail) ── */}

                {/* ── NEW PRODUCT SALES ───────────────────────── */}
                <SectionHeader icon="🛒"
                  title={lang === "en" ? "New product sales" : "Ventes produits"}
                  count={ps.items.length} color="var(--text-primary)" />
                {ps.items.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>—</div>
                ) : ps.items.map((g, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>{g.product_name} <span style={{ color: "var(--text-muted)" }}>{g.qty} × {fmt(g.unit_price)}</span></span>
                    <span style={{ fontWeight: 600 }}>{fmt(g.line_total)}</span>
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
                    <span style={{ fontWeight: 600, color: "#34d399" }}>{fmt(d.amount)}</span>
                  </div>
                ))}
                <Subtotal label={lang === "en" ? "debt collections" : "recouvrements"} value={dc.total} color="#34d399" />

                {/* ── REFUNDS (typed labels + filter chips) ───────
                    MP-REFUNDS-LIST-TYPED-LABELS. Each row carries its
                    primary kind label; secondary "with credit split"
                    appended when has_credit_split. Filter chips above
                    narrow by primary category (Refunds / Exchanges /
                    Voids). Old responses (kind unset) fall under
                    "Refunds" so legacy data isn't dropped. */}
                {rf.total > 0 && (() => {
                  const filterMatch = (kind) => {
                    if (refundFilter === "all") return true;
                    if (refundFilter === "voids")     return kind === "void_refund";
                    if (refundFilter === "exchanges") return kind === "exchange_same" || kind === "exchange_diff";
                    if (refundFilter === "refunds")   return kind === "refund_full" || kind === "refund_partial" || !kind;
                    return true;
                  };
                  const filteredItems = rf.items.filter(r => filterMatch(r.kind));
                  const filteredTotal = filteredItems.reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);
                  const chips = [
                    { id: "all",       label: lang === "en" ? "All"       : "Tous"    },
                    { id: "refunds",   label: lang === "en" ? "Refunds"   : "Remboursements" },
                    { id: "exchanges", label: lang === "en" ? "Exchanges" : "Échanges" },
                    { id: "voids",     label: lang === "en" ? "Voids"     : "Annulations" },
                  ];
                  return (
                    <>
                      <SectionHeader icon="↩"
                        title={lang === "en" ? "Refunds" : "Remboursements"}
                        count={rf.items.length} color="var(--text-primary)" />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 10px" }}>
                        {chips.map(c => {
                          const active = refundFilter === c.id;
                          return (
                            <button key={c.id} type="button" onClick={() => setRefundFilter(c.id)}
                              style={{
                                padding: "4px 10px", fontSize: 11, fontWeight: 600,
                                borderRadius: 999, cursor: "pointer",
                                border: `1px solid ${active ? "var(--brand-light)" : "var(--border)"}`,
                                background: active ? "var(--brand-light)" : "var(--bg-card)",
                                color: active ? "#0b1220" : "var(--text-primary)",
                              }}>{c.label}</button>
                          );
                        })}
                      </div>
                      {filteredItems.length === 0 ? (
                        <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 0", fontStyle: "italic" }}>
                          {lang === "en" ? "No rows match this filter." : "Aucune ligne ne correspond à ce filtre."}
                        </div>
                      ) : filteredItems.map((r, i) => {
                        const primary  = refundKindLabel(r.kind, lang);
                        const splitTag = r.has_credit_split
                          ? (lang === "en" ? " · with credit split" : " · split crédit")
                          : "";
                        const isVoid   = r.kind === "void_refund";
                        const tStr = r.created_at
                          ? new Date(r.created_at).toLocaleTimeString(lang === "en" ? "en-GB" : "fr-FR",
                              { hour: "2-digit", minute: "2-digit" })
                          : "";
                        return (
                          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                              <div style={{ fontSize: 12 }}>
                                <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{shortRetRef(r.ret_ref)}</span>
                                <span style={{ marginLeft: 8, fontWeight: 700,
                                               color: isVoid ? "#fbbf24" : "var(--text-primary)" }}>
                                  {primary}{splitTag}
                                </span>
                              </div>
                              <div style={{ color: "#f87171", fontWeight: 700, fontSize: 13 }}>
                                −{fmt(r.refund_amount)}
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {isVoid && <span style={{ color: "#fbbf24" }}>{lang === "en" ? "Void of sale " : "Annulation de "}</span>}
                              {r.customer_name && <strong style={{ color: "var(--text-primary)" }}>{r.customer_name}</strong>}
                              {r.customer_name && r.sale_number && " — "}
                              {r.sale_number && <span style={{ fontFamily: "monospace" }}>{r.sale_number}</span>}
                            </div>
                            {r.items_summary && (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{r.items_summary}</div>
                            )}
                            {(r.kind === "exchange_same" || r.kind === "exchange_diff") && r.replacement_summary && (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                                ↪ {lang === "en" ? "Replaced with" : "Remplacé par"}: {r.replacement_summary}
                                {Number(r.price_difference) !== 0 && (
                                  <span style={{ marginLeft: 8, color: r.price_difference > 0 ? "#34d399" : "#fbbf24" }}>
                                    {r.price_difference > 0
                                      ? (lang === "en" ? `+${fmt(r.price_difference)} cash back` : `+${fmt(r.price_difference)} rendu`)
                                      : (lang === "en" ? `${fmt(r.price_difference)} customer paid` : `${fmt(r.price_difference)} payé par client`)}
                                  </span>
                                )}
                              </div>
                            )}
                            {r.has_credit_split && (
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, paddingLeft: 12 }}>
                                ↳ {fmt(r.credit_portion)} {lang === "en" ? "to credit account" : "au compte crédit"},
                                {" "}{fmt(r.cash_portion)} {lang === "en" ? "cash out" : "en espèces"}
                              </div>
                            )}
                            {r.reason && (
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, fontStyle: "italic" }}>
                                {lang === "en" ? "Reason" : "Motif"}: {r.reason}
                              </div>
                            )}
                            {(r.processed_by || tStr) && (
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                                {r.processed_by && (lang === "en" ? `Cashier ${r.processed_by}` : `Caissier ${r.processed_by}`)}
                                {r.processed_by && tStr && " · "}
                                {tStr}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <Subtotal
                        label={refundFilter === "all"
                          ? (lang === "en" ? "refunds" : "remboursements")
                          : (lang === "en" ? `refunds (${chips.find(c=>c.id===refundFilter)?.label.toLowerCase()})` : `remboursements (${chips.find(c=>c.id===refundFilter)?.label.toLowerCase()})`)}
                        value={-filteredTotal} color="#f87171" />
                    </>
                  );
                })()}

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
                        <span style={{ color: "#f87171", fontWeight: 600 }}>−{fmt(e.amount)}</span>
                      </div>
                    ))}
                    <Subtotal label={lang === "en" ? "expenses" : "dépenses"} value={-ex.total} color="#f87171" />
                  </>
                )}

                {/* MP-REPORT-SIMPLIFY-AND-AUTOSEND: the old
                    "ACTIVITÉ + ARGENT REÇU" double block was removed
                    here — its info is now in the simplified summary
                    above the per-section lists. */}

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
                        <span>{fmt(dr.opening_float)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                        <span style={{ color: "var(--text-muted)" }}>+ {lang === "en" ? "Cash sales this shift" : "Ventes espèces ce poste"}</span>
                        <span style={{ color: "#34d399" }}>{fmt(sCash)}</span>
                      </div>
                      {sRef > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                          <span style={{ color: "var(--text-muted)" }}>− {lang === "en" ? "Refunds this shift" : "Remboursements ce poste"}</span>
                          <span style={{ color: "#f87171" }}>−{fmt(sRef)}</span>
                        </div>
                      )}
                      {sExp > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                          <span style={{ color: "var(--text-muted)" }}>− {lang === "en" ? "Expenses this shift" : "Dépenses ce poste"}</span>
                          <span style={{ color: "#f87171" }}>−{fmt(sExp)}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, padding: "8px 0 4px", borderTop: "2px solid var(--border)", marginTop: 4 }}>
                        <span>{lang === "en" ? "Expected drawer" : "Caisse attendue"}</span>
                        <span style={{ color: "var(--brand-light)" }}>{fmt(dr.expected)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0 2px" }}>
                        <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Actual cash" : "Caisse réelle"}</span>
                        <span style={{ fontWeight: 600 }}>
                          {drIsClosed
                            ? fmt(dr.actual)
                            : <em style={{ color: "var(--text-muted)" }}>— {lang === "en" ? "(count at end of shift)" : "(à compter en fin de poste)"}</em>}
                        </span>
                      </div>
                      {drIsClosed && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0", fontWeight: 700 }}>
                          <span>{lang === "en" ? "Variance" : "Écart"}</span>
                          <span style={{ color: (dr.variance || 0) === 0 ? "#34d399" : (dr.variance || 0) > 0 ? "#fbbf24" : "#f87171" }}>
                            {(dr.variance || 0) === 0
                              ? `${fmt(0)} ${lang === "en" ? "(Exact)" : "(Exact)"}`
                              : (dr.variance || 0) > 0
                                ? `+${fmt(dr.variance)} ${lang === "en" ? "(Surplus)" : "(Excédent)"}`
                                : `−${fmt(Math.abs(dr.variance))} ${lang === "en" ? "(Shortage)" : "(Manquant)"}`}
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

      {/* MP-REPORTS-REPRINT-OVERLAY: reprint a past receipt via the shared,
          Android-safe overlay (Print → share sheet on native / window.print on
          web; Close = React state; Bluetooth ESC/POS for real thermal). */}
      {receiptSale && (
        <PaymentEventReceipt
          eventType="sale"
          data={receiptSale}
          org={orgSettings}
          lang={lang}
          onClose={() => setReceiptSale(null)}
        />
      )}
    </div>
  );
}
