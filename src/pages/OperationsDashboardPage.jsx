// MP-OWNER-OPERATIONS-DASHBOARD-V1
//
// Owner/manager deep-view across multi-day activity, per-cashier
// performance, anomalies, debt aging, and inventory health.
//
// Five sections, all sourced from /api/dashboard/* endpoints:
//   1. Multi-day overview (stacked bar + cumulative cash line + DoD deltas)
//   2. Per-cashier scoreboard
//   3. Auto-detected anomalies (client-side dismiss in sessionStorage)
//   4. Outstanding debt aging
//   5. Inventory health
//
// Date range picker drives sections 1+2+3. Sections 4+5 are always-
// current snapshots and don't react to the range.
//
// Sidecar to the existing Dashboard at "/" — mounted at /operations
// so the existing landing page survives untouched.

import { useEffect, useMemo, useState } from "react";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import { Link, useNavigate } from "react-router-dom";
import { useLangStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { openWhatsApp } from "../utils/whatsapp";
import { opsAnomalyGuidance, opsSeverityCue } from "../utils/anomalyExplain";
import { momoLabel, momoLabelShort } from "../utils/paymentLabels";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell,
} from "recharts";

// ── Date helpers ────────────────────────────────────────────────

// MP-REPORT-LOCAL-DAY: LOCAL calendar date (YYYY-MM-DD) from local components,
// NOT toISOString() (which shifts to UTC and off-by-ones a UTC+ org at night).
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toIso(d); };

// ── Anomaly suppression (sessionStorage, v1) ────────────────────
//
// Persisted server-side suppression is deferred to v1.1; for now the
// owner can dismiss an anomaly and it stays hidden for the rest of
// the session. localStorage would persist across tabs and that's
// generally what an owner wants — but it would also block useful
// re-surfaces tomorrow, and we don't yet have a "reviewed at"
// timestamp model. sessionStorage is the conservative middle.

const DISMISS_KEY = "mp_ops_dash_dismissed";
function loadDismissed() {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); }
  catch { /* noop */ }
}

// ── Reusable bits ───────────────────────────────────────────────

function Card({ title, sub, children, action }) {
  return (
    <div style={{
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px", marginBottom: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function DeltaPill({ pct }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>;
  }
  const up = pct >= 0;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700,
      color: up ? "#34d399" : "#f87171",
      background: up ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
      padding: "2px 6px", borderRadius: 999,
    }}>
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
    </span>
  );
}

function MetricBlock({ label, value, delta }) {
  const fmt = useCurrency();
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{fmt(value)}</div>
      {delta != null && <div style={{ marginTop: 4 }}><DeltaPill pct={delta} /></div>}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function OperationsDashboardPage() {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const fmt = useCurrency();
  const navigate = useNavigate();
  // MP-OPS-MONEY-EXPLAINABLE: open the underlying receipt — the Refunds portal
  // searches by sale_number and opens the sale (with its issued timestamp).
  const openReceipt = (saleNumber) => {
    if (!saleNumber) return;
    navigate(`/refunds?ref=${encodeURIComponent(saleNumber)}`);
  };

  // Range state — default last 7 days. Custom range honoured via the
  // two date inputs; the chip presets reset to known windows.
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(toIso(new Date()));
  const [dismissed, setDismissed] = useState(loadDismissed);
  const dismiss = (id) => setDismissed(prev => { const n = new Set(prev); n.add(id); saveDismissed(n); return n; });
  const undoDismiss = (id) => setDismissed(prev => { const n = new Set(prev); n.delete(id); saveDismissed(n); return n; });

  // ── Queries ──────────────────────────────────────────────────
  const overview = useOfflineCachedQuery({
    queryKey: ["dash-overview", from, to],
    queryFn:  () => api.get(`/dashboard/overview?from=${from}&to=${to}`).then(r => r.data?.data || null),
    staleTime: 30000,
  });
  const anomalies = useOfflineCachedQuery({
    queryKey: ["dash-anomalies", from, to],
    queryFn:  () => api.get(`/dashboard/anomalies?from=${from}&to=${to}`).then(r => r.data?.data || { anomalies: [] }),
    staleTime: 30000,
  });
  const debtAging = useOfflineCachedQuery({
    queryKey: ["dash-debt-aging"],
    queryFn:  () => api.get(`/dashboard/debt-aging`).then(r => r.data?.data || null),
    staleTime: 60000,
  });
  const invHealth = useOfflineCachedQuery({
    queryKey: ["dash-inventory-health"],
    queryFn:  () => api.get(`/dashboard/inventory-health`).then(r => r.data?.data || null),
    staleTime: 60000,
  });

  // ── MP-SCOREBOARD-DEBT-TAPTHROUGH: which customers a cashier's debt total came
  // from. Tapping a Debt figure fetches the itemised debt-collection payments for
  // that cashier over the SAME range (optionally filtered to cash/momo).
  const [debtDetail, setDebtDetail] = useState(null); // { cashier_name, label, loading, items, total, error }
  const openDebtDetail = async (c, method) => {
    const label = method === "cash" ? (en ? "Debt (Cash)" : "Dette (Espèces)")
      : method === "momo" ? `${en ? "Debt (" : "Dette ("}${momoLabelShort(fmt.currency, en)})`
      : (en ? "Debt collected" : "Dette encaissée");
    setDebtDetail({ cashier_name: c.cashier_name, label, loading: true, items: [], total: 0 });
    try {
      const q = `?from=${from}&to=${to}&cashier_id=${encodeURIComponent(c.cashier_id)}${method ? `&method=${method}` : ""}`;
      const d = await api.get(`/dashboard/debt-collections${q}`).then(r => r.data?.data || { items: [], total: 0 });
      setDebtDetail(prev => prev ? { ...prev, loading: false, items: d.items || [], total: d.total || 0 } : null);
    } catch {
      setDebtDetail(prev => prev ? { ...prev, loading: false, items: [], total: 0, error: true } : null);
    }
  };
  const methodDisplay = (bucket, raw) =>
    bucket === "cash" ? (en ? "Cash" : "Espèces")
    : bucket === "momo" ? momoLabel(fmt.currency, en)
    : (raw || "—");

  // ── Chart data ───────────────────────────────────────────────
  const chartData = useMemo(() => {
    const rows = overview.data?.per_day || [];
    return rows.map(r => ({
      date: r.date.slice(5), // MM-DD for compact x-axis
      cash_sales:     r.cash_sales,
      debt_collected: r.debt_collected,
      // Negative bars: refunds + expenses render below the axis.
      refunds_voids:  -r.refunds_voids,
      expenses:       -r.expenses,
      cumulative:     r.cumulative_net_cash,
    }));
  }, [overview.data]);

  const visibleAnomalies = (anomalies.data?.anomalies || [])
    .filter(a => !dismissed.has(a.id));
  const dismissedCount = (anomalies.data?.anomalies || []).length - visibleAnomalies.length;

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>
            {en ? "Operations Dashboard" : "Tableau de bord opérations"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {en
              ? "Multi-day signals, per-cashier performance, anomalies, debt aging, inventory."
              : "Signaux multi-jours, performance par caissier, anomalies, vieillissement des dettes, inventaire."}
          </div>
        </div>
      </div>

      {/* ── Range picker ───────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <button onClick={() => { setFrom(daysAgo(6));  setTo(toIso(new Date())); }}
          style={chipStyle(from === daysAgo(6))}>{en ? "Last 7 days" : "7 derniers jours"}</button>
        <button onClick={() => { setFrom(daysAgo(29)); setTo(toIso(new Date())); }}
          style={chipStyle(from === daysAgo(29))}>{en ? "Last 30 days" : "30 derniers jours"}</button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "From" : "Du"}</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={dateInputStyle} />
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "To" : "Au"}</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={dateInputStyle} />
      </div>

      {/* ── SECTION 1: Multi-day overview ──────────────────── */}
      <Card
        title={en ? "1. Multi-day overview" : "1. Vue multi-jours"}
        sub={en
          ? "Per-day cash flow components, with previous-day deltas on the latest day."
          : "Composantes du flux par jour, avec écarts vs jour précédent."}
      >
        {/* MP: label the "today" figures with the actual date — UNCONDITIONAL (shows
            even on an all-0 / <2-day range where `deltas` is null) and high-contrast
            so it's unmistakably visible under the section header. */}
        <div style={{
          display: "inline-block", fontSize: 13, fontWeight: 800, color: "var(--brand-light)",
          background: "rgba(251,197,3,0.10)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "4px 10px", marginBottom: 12,
        }}>
          📅 {en ? "Today" : "Aujourd'hui"} · {new Date().toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </div>

        {overview.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {overview.isError && <div style={errorStyle}>{en ? "Failed to load overview." : "Échec du chargement."}</div>}
        {overview.data && (
          <>
            {overview.data.deltas && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
                <MetricBlock label={en ? "Sales received (today)" : "Ventes encaissées (jour)"} value={overview.data.deltas.cash_sales.current}     delta={overview.data.deltas.cash_sales.pct} />
                <MetricBlock label={en ? "Debt collected"       : "Dette encaissée"}        value={overview.data.deltas.debt_collected.current} delta={overview.data.deltas.debt_collected.pct} />
                <MetricBlock label={en ? "Refunds & voids"      : "Remb. & annulations"}     value={overview.data.deltas.refunds_voids.current}  delta={overview.data.deltas.refunds_voids.pct} />
                <MetricBlock label={en ? "Expenses"             : "Dépenses"}                value={overview.data.deltas.expenses.current}       delta={overview.data.deltas.expenses.pct} />
                <MetricBlock label={en ? "Net cash flow"        : "Flux net espèces"}        value={overview.data.deltas.net_cash_flow.current}  delta={overview.data.deltas.net_cash_flow.pct} />
              </div>
            )}
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                  <Tooltip
                    formatter={(value) => fmt(Math.abs(Number(value) || 0))}
                    contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cash_sales"     name={en ? "Sales received"  : "Ventes encaissées"} stackId="a" fill="#10b981" />
                  <Bar dataKey="debt_collected" name={en ? "Debt collected" : "Dette encaissée"} stackId="a" fill="#3b82f6" />
                  <Bar dataKey="refunds_voids"  name={en ? "Refunds & voids" : "Remb. & annulations"} stackId="b" fill="#ef4444" />
                  <Bar dataKey="expenses"       name={en ? "Expenses" : "Dépenses"} stackId="b" fill="#f59e0b" />
                  <Line type="monotone" dataKey="cumulative" name={en ? "Cumulative net cash" : "Cumul flux net"}
                        stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      {/* ── SECTION 2: Cashier scoreboard ──────────────────── */}
      <Card
        title={en ? "2. Cashier scoreboard" : "2. Performance par caissier"}
        sub={en
          ? `Bridge: Total sales = Cash (valid) + ${momoLabelShort(fmt.currency, en)} (valid) + Credit given. Voided receipts (paid then cancelled) sit OUTSIDE — never inside cash. Flag = variance 2+ shifts, refunds > 5%, > 3 voids, or a void after payment.`
          : `Pont : Ventes totales = Espèces (valides) + ${momoLabelShort(fmt.currency, en)} (valides) + Crédit accordé. Les reçus annulés (payés puis annulés) sont EN DEHORS — jamais dans les espèces. Drapeau = écart 2+ postes, remb. > 5%, > 3 annul., ou annulation après paiement.`}
      >
        {overview.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {overview.data && (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStickyLeft}>{en ? "Cashier" : "Caissier"}</th>
                  <th style={thStyle}>{en ? "Shifts" : "Postes"}</th>
                  <th style={thStyleRight}>{en ? "Total sales" : "Ventes totales"}</th>
                  <th style={thStyleRight}>{en ? "Cash (valid)" : "Espèces (valides)"}</th>
                  <th style={thStyleRight}>{momoLabelShort(fmt.currency, en)}</th>
                  <th style={thStyleRight}>{en ? "Credit given" : "Crédit accordé"}</th>
                  <th style={thStyleRight}>{en ? "Debt collected" : "Dette encaissée"}</th>
                  <th style={thStyleRight}>{en ? "Debt (Cash)" : "Dette (Espèces)"}</th>
                  <th style={thStyleRight}>{(en ? "Debt (" : "Dette (") + momoLabelShort(fmt.currency, en) + ")"}</th>
                  <th style={thStyleRight}>{en ? "Total income" : "Revenu total"}</th>
                  <th style={thStyleRight}>{en ? "Voided ⚠" : "Annulés ⚠"}</th>
                  <th style={thStyleRight}>{en ? "Refunds" : "Remb."}</th>
                  <th style={thStyleRight}>{en ? "Voids" : "Annul."}</th>
                  <th style={thStyleRight}>{en ? "Cancels" : "Annulations"}</th>
                  <th style={thStyleRight}>{en ? "Avg shift" : "Poste moyen"}</th>
                  <th style={thStyleRight}>{en ? "Variance ct" : "Écart x"}</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {(overview.data.cashiers || []).map(c => (
                  <tr key={c.cashier_id}
                    style={{ borderTop: "1px solid var(--border)",
                             background: c.flagged ? "rgba(251,191,36,0.05)" : "transparent" }}>
                    <td style={tdStickyLeft}>
                      <strong>{c.cashier_name}</strong>
                    </td>
                    <td style={tdStyle}>{c.shifts_opened}</td>
                    <td style={tdStyleRight}>{fmt(c.total_sales)}</td>
                    <td style={tdStyleRight}><strong>{fmt(c.cash_valid != null ? c.cash_valid : c.cash_collected)}</strong></td>
                    <td style={tdStyleRight}>{fmt(c.momo_collected || 0)}</td>
                    <td style={tdStyleRight}>{fmt(c.credit_given || 0)}</td>
                    {/* MP-SCOREBOARD-DEBT-COLLECTED: debt collected this period (all
                        methods, payment date, non-voided) — distinct from Cash (valid),
                        which is sales cash. Makes a debt-collecting day visible. */}
                    {/* MP-SCOREBOARD-DEBT-TAPTHROUGH: tap a debt figure → which customers paid. */}
                    <td style={tdStyleRight}>
                      {Number(c.debt_collected) > 0
                        ? <span onClick={() => openDebtDetail(c, "")} title={en ? "See which customers paid" : "Voir quels clients ont payé"}
                            style={{ color: "#3b82f6", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>{fmt(c.debt_collected)}</span>
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    {/* MP-SCOREBOARD-INCOME: debt split by method (tappable) */}
                    <td style={tdStyleRight}>
                      {Number(c.debt_collected_cash) > 0
                        ? <span onClick={() => openDebtDetail(c, "cash")} title={en ? "See which customers paid" : "Voir quels clients ont payé"}
                            style={{ cursor: "pointer", textDecoration: "underline" }}>{fmt(c.debt_collected_cash)}</span>
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={tdStyleRight}>
                      {Number(c.debt_collected_momo) > 0
                        ? <span onClick={() => openDebtDetail(c, "momo")} title={en ? "See which customers paid" : "Voir quels clients ont payé"}
                            style={{ cursor: "pointer", textDecoration: "underline" }}>{fmt(c.debt_collected_momo)}</span>
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    {/* Total income = all money RECEIVED (sales cash+MoMo + debt cash+MoMo),
                        excludes Credit given. Small split shows cash-in vs momo-in. */}
                    <td style={tdStyleRight}>
                      {(() => {
                        const cashIn = (Number(c.cash_valid ?? c.cash_collected) || 0) + (Number(c.debt_collected_cash) || 0);
                        const momoIn = (Number(c.momo_collected) || 0) + (Number(c.debt_collected_momo) || 0);
                        const income = c.total_income != null ? Number(c.total_income) : cashIn + momoIn;
                        return (
                          <>
                            <div style={{ fontWeight: 800, color: "#34d399" }}>{fmt(income)}</div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                              {en ? "Cash" : "Esp."} {fmt(cashIn)} · {momoLabelShort(fmt.currency, en)} {fmt(momoIn)}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td style={tdStyleRight}>
                      {Number(c.voided_receipts_total) > 0
                        ? <span style={{ color: "#f87171", fontWeight: 700 }}>{fmt(c.voided_receipts_total)}</span>
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={tdStyleRight}>{c.refunds_processed}</td>
                    <td style={tdStyleRight} title={c.voids > 3 ? "flagged" : ""}>
                      <span style={{ color: c.voids > 3 ? "#f87171" : "inherit" }}>{c.voids}</span>
                    </td>
                    {/* MP-SCOREBOARD-INCOME: approval requests THIS cashier cancelled. */}
                    <td style={tdStyleRight}>{Number(c.cancels) > 0 ? c.cancels : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                    <td style={tdStyleRight}>{c.avg_shift_minutes != null ? `${c.avg_shift_minutes} min` : "—"}</td>
                    <td style={tdStyleRight}>
                      <span style={{ color: c.drawer_variance_count >= 2 ? "#f87171" : "inherit" }}>
                        {c.drawer_variance_count}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {c.flagged && (
                        <span title={c.flag_reasons.join(", ")} style={{ color: "#fbbf24", fontSize: 14 }}>⚠</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(overview.data.cashiers || []).length === 0 && (
                  <tr><td colSpan={17} style={{ ...tdStyle, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>
                    {en ? "No cashier activity in this range." : "Aucune activité de caissier dans cette plage."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── SECTION 3: Anomalies ───────────────────────────── */}
      <Card
        title={en ? "3. Anomalies" : "3. Anomalies"}
        sub={en
          ? "Auto-flagged patterns over the range. Dismiss to hide for this browser session."
          : "Motifs détectés sur la plage. Masquer pour cette session navigateur."}
        action={dismissedCount > 0 && (
          <button onClick={() => { sessionStorage.removeItem(DISMISS_KEY); setDismissed(new Set()); }}
            style={smallBtnStyle}>
            {en ? `Show ${dismissedCount} dismissed` : `Afficher ${dismissedCount} masquées`}
          </button>
        )}
      >
        {anomalies.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {anomalies.data && visibleAnomalies.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            {en ? "No anomalies in this range. ✓" : "Aucune anomalie dans cette plage. ✓"}
          </div>
        )}
        {visibleAnomalies.map(a => {
          const sevColor = a.severity === "critical" ? "#f87171"
                        : a.severity === "warning"  ? "#fbbf24"
                        : "#3b82f6";
          const sevBg = a.severity === "critical" ? "rgba(248,113,113,0.08)"
                      : a.severity === "warning"  ? "rgba(251,191,36,0.08)"
                      : "rgba(59,130,246,0.08)";
          // MP-OPS-MONEY-EXPLAINABLE: prefer the bilingual message; tap a
          // sale-linked anomaly to open the underlying receipt.
          const text = (en ? a.message_en : a.message_fr) || a.message;
          const saleNo = a.link && a.link.type === "sale" ? a.link.sale_number : null;
          const tappable = !!saleNo;
          // MP-ANOMALY-EXPLAIN: jargon-free severity cue + plain WHY / WHAT-TO-DO,
          // matching the Accountant Log + bell so all three read the same way.
          const cue = opsSeverityCue(a.severity, en);
          const guide = opsAnomalyGuidance(a.kind, en);
          return (
            <div key={a.id} style={{
              padding: "10px 12px", marginBottom: 6, borderRadius: 8,
              background: sevBg, border: `1px solid ${sevColor}33`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div
                  onClick={tappable ? () => openReceipt(saleNo) : undefined}
                  style={{ minWidth: 0, cursor: tappable ? "pointer" : "default" }}
                  title={tappable ? (en ? "Open receipt" : "Ouvrir le reçu") : ""}>
                  <span style={{ color: cue.dot, fontWeight: 800, fontSize: 11, whiteSpace: "nowrap" }}>
                    {cue.label}
                  </span>
                  <div style={{ fontSize: 13, marginTop: 3, textDecoration: tappable ? "underline" : "none" }}>
                    {text}
                  </div>
                  {/* MP-OPS-ANOMALY-CASHIER-NAME: who rang the flagged sale (large_sale,
                      void_after_payment). Backend resolves + trims pa_users.full_name;
                      show a neutral fallback when unresolved. */}
                  {a.link && a.link.type === "sale" && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, textDecoration: "none" }}>
                      👤 {en ? "Cashier: " : "Caissier : "}
                      <b>{(a.cashier_name && String(a.cashier_name).trim()) || (en ? "Unknown" : "Inconnu")}</b>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(a.timestamp).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button onClick={() => dismiss(a.id)} style={smallBtnStyle} title={en ? "Dismiss" : "Masquer"}>✓</button>
                </div>
              </div>
              {(guide.why || guide.do) && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${sevColor}22` }}>
                  {guide.why && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}><b>{en ? "Why: " : "Pourquoi : "}</b>{guide.why}</div>}
                  {guide.do && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4, marginTop: 2 }}><b>{en ? "Do: " : "À faire : "}</b>{guide.do}</div>}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* ── Voided receipts (paid then cancelled) ──────────── */}
      <Card
        title={en ? "Voided receipts (paid then cancelled)" : "Reçus annulés (payés puis annulés)"}
        sub={en
          ? "Receipts cancelled after a payment was recorded. NOT counted in cash collected — confirm the cash was returned. Tap to open the receipt."
          : "Reçus annulés après l'enregistrement d'un paiement. NON comptés dans les espèces — confirmez que l'argent a été rendu. Touchez pour ouvrir le reçu."}
      >
        {overview.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {overview.data && (() => {
          const vr = overview.data.voided_receipts || { items: [], total: 0 };
          if (!vr.items.length) return (
            <div style={{ padding: 12, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              {en ? "No voided receipts in this range. ✓" : "Aucun reçu annulé dans cette plage. ✓"}
            </div>
          );
          return (
            <div style={{ overflowX: "auto" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#f87171" }}>
                {en ? "Total voided: " : "Total annulé : "}{fmt(vr.total)}
              </div>
              <table style={tableStyle}>
                <thead><tr>
                  <th style={thStyle}>{en ? "Receipt" : "Reçu"}</th>
                  <th style={thStyle}>{en ? "Cashier" : "Caissier"}</th>
                  <th style={thStyleRight}>{en ? "Amount" : "Montant"}</th>
                  <th style={thStyle}>{en ? "Method" : "Méthode"}</th>
                  <th style={thStyle}>{en ? "Paid / Voided" : "Payé / Annulé"}</th>
                  <th style={thStyle}>{en ? "Reason" : "Raison"}</th>
                </tr></thead>
                <tbody>
                  {vr.items.map((v, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)", cursor: v.sale_number ? "pointer" : "default" }}
                      onClick={v.sale_number ? () => openReceipt(v.sale_number) : undefined}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", textDecoration: v.sale_number ? "underline" : "none" }}>{v.sale_number || "—"}</td>
                      <td style={tdStyle}>{v.cashier_name || "—"}</td>
                      <td style={{ ...tdStyleRight, color: "#f87171", fontWeight: 700 }}>{fmt(v.amount)}</td>
                      <td style={tdStyle}>{v.method === "mobile_money" ? momoLabelShort(fmt.currency, en) : v.method === "cash" ? (en ? "Cash" : "Espèces") : (v.method || "—")}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-muted)" }}>
                        {v.paid_at ? new Date(v.paid_at).toLocaleTimeString(en ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        {v.voided_at ? " → " + new Date(v.voided_at).toLocaleTimeString(en ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12 }}>{v.void_reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      {/* ── MoMo received (mobile money, valid receipts) ────── */}
      <Card
        title={`${momoLabel(fmt.currency, en)} ${en ? "received" : "reçu"}`}
        sub={en
          ? `${momoLabel(fmt.currency, en)} payments on valid receipts — who, which receipt, when, how much. Tap to open the receipt.`
          : `Paiements ${momoLabel(fmt.currency, en)} sur reçus valides — qui, quel reçu, quand, combien. Touchez pour ouvrir le reçu.`}
      >
        {overview.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {overview.data && (() => {
          const mm = overview.data.momo_received || { items: [], total: 0 };
          if (!mm.items.length) return (
            <div style={{ padding: 12, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              {en ? `No ${momoLabel(fmt.currency, en).toLowerCase()} payments in this range.` : `Aucun paiement ${momoLabel(fmt.currency, en)} dans cette plage.`}
            </div>
          );
          return (
            <div style={{ overflowX: "auto" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#10b981" }}>
                {(en ? "Total " : "Total ") + momoLabelShort(fmt.currency, en) + (en ? ": " : " : ")}{fmt(mm.total)}
              </div>
              <table style={tableStyle}>
                <thead><tr>
                  <th style={thStyle}>{en ? "Receipt" : "Reçu"}</th>
                  <th style={thStyle}>{en ? "Cashier" : "Caissier"}</th>
                  <th style={thStyleRight}>{en ? "Amount" : "Montant"}</th>
                  <th style={thStyle}>{en ? "When" : "Quand"}</th>
                </tr></thead>
                <tbody>
                  {mm.items.map((m, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)", cursor: m.sale_number ? "pointer" : "default" }}
                      onClick={m.sale_number ? () => openReceipt(m.sale_number) : undefined}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", textDecoration: m.sale_number ? "underline" : "none" }}>
                        {m.sale_number || "—"}
                        {m.kind === "debt_collection" && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#3b82f6", fontFamily: "system-ui" }}>
                            {en ? "· debt" : "· dette"}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{m.cashier_name || "—"}</td>
                      <td style={{ ...tdStyleRight, color: "#10b981", fontWeight: 700 }}>{fmt(m.amount)}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-muted)" }}>
                        {m.paid_at ? new Date(m.paid_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      {/* ── SECTION 4: Debt aging ──────────────────────────── */}
      <Card
        title={en ? "4. Outstanding debt aging" : "4. Vieillissement des créances"}
        sub={en
          ? "Customer debt by oldest unpaid sale. Send WhatsApp reminders directly from the top-debtor list."
          : "Dette client selon la plus vieille vente impayée. Envoyez un rappel WhatsApp depuis la liste."}
      >
        {debtAging.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {debtAging.data && (
          <>
            {/* MP-MOBILE-UI: 4-bucket aging cards; force 2 cols on
                mobile so the bold FCFA value (e.g. "1,250,000 FCFA")
                doesn't bleed past a ~75px column on a 360px phone.
                Desktop layout unchanged. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3.5">
              {(debtAging.data.buckets || []).map((b, i) => {
                const colors = ["#10b981", "#3b82f6", "#fbbf24", "#f87171"];
                return (
                  <div key={i} style={{
                    background: "var(--bg-card)", border: `1px solid ${colors[i]}33`,
                    borderRadius: 10, padding: "10px 12px",
                  }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{b.label}</div>
                    <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4, color: colors[i] }}>
                      {fmt(b.total)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                      {b.count} {en ? "customer(s)" : "client(s)"}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              {en ? "Top 10 debtors" : "Top 10 débiteurs"}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{en ? "Customer" : "Client"}</th>
                    <th style={thStyleRight}>{en ? "Total debt" : "Dette totale"}</th>
                    <th style={thStyle}>{en ? "Bucket" : "Tranche"}</th>
                    <th style={thStyleRight}>{en ? "Days since last pay" : "Jours depuis dern. paiement"}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {(debtAging.data.top_debtors || []).map(d => (
                    <tr key={d.customer_id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={tdStyle}><strong>{d.customer_name}</strong></td>
                      <td style={tdStyleRight}><strong>{fmt(d.total_debt)}</strong></td>
                      <td style={tdStyle}>{d.bucket}</td>
                      <td style={tdStyleRight}>{d.days_since_last_pay != null ? `${d.days_since_last_pay} j` : "—"}</td>
                      <td style={tdStyle}>
                        {d.customer_phone && (
                          <button onClick={(e) => {
                            const phone = String(d.customer_phone).replace(/\D/g, "");
                            const msg = en
                              ? `Hello ${d.customer_name}, this is a friendly reminder about your outstanding balance of ${fmt(d.total_debt)}. Thank you!`
                              : `Bonjour ${d.customer_name}, petit rappel pour votre solde en attente de ${fmt(d.total_debt)}. Merci!`;
                            openWhatsApp(e, phone, msg);
                          }} style={{
                            ...smallBtnStyle,
                            background: "#25D366", border: "none", color: "#fff",
                          }}>
                            📱 {en ? "Remind" : "Rappeler"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(debtAging.data.top_debtors || []).length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdStyle, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>
                      {en ? "No outstanding debt. ✓" : "Aucune créance en cours. ✓"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              {en
                ? `Total open debtors: ${debtAging.data.total_debtors} · combined: ${fmt(debtAging.data.total_debt)}`
                : `Total débiteurs: ${debtAging.data.total_debtors} · combiné: ${fmt(debtAging.data.total_debt)}`}
            </div>
          </>
        )}
      </Card>

      {/* ── SECTION 5: Inventory health ────────────────────── */}
      <Card
        title={en ? "5. Inventory health" : "5. Santé de l'inventaire"}
        sub={en
          ? "Low stock alerts, slow movers (no movement in 30d), and top sellers (units sold in last 30d)."
          : "Alertes stock bas, articles lents (sans mouvement en 30j), meilleures ventes (30j)."}
      >
        {invHealth.isLoading && <div style={loadingStyle}>{en ? "Loading…" : "Chargement…"}</div>}
        {invHealth.data && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {/* Low stock */}
            <div>
              <div style={subhStyle}>⚠ {en ? `Low stock (${invHealth.data.low_stock.length})` : `Stock bas (${invHealth.data.low_stock.length})`}</div>
              {invHealth.data.low_stock.slice(0, 10).map((s, i) => (
                <div key={i} style={miniRowStyle}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.product_name} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>· {s.location_name}</span>
                  </span>
                  <span style={{ color: "#f87171", fontWeight: 700 }}>{s.quantity} / {s.min_quantity}</span>
                </div>
              ))}
              {invHealth.data.low_stock.length === 0 && <div style={emptyStyle}>{en ? "All stock above threshold. ✓" : "Tout le stock au-dessus du seuil. ✓"}</div>}
            </div>
            {/* Slow movers */}
            <div>
              <div style={subhStyle}>🐌 {en ? `Slow movers (${invHealth.data.slow_movers.length})` : `Articles lents (${invHealth.data.slow_movers.length})`}</div>
              {invHealth.data.slow_movers.slice(0, 10).map((p, i) => (
                <div key={i} style={miniRowStyle}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.product_name}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{en ? "0 in 30d" : "0 en 30j"}</span>
                </div>
              ))}
              {invHealth.data.slow_movers.length === 0 && <div style={emptyStyle}>{en ? "Everything is moving. ✓" : "Tout bouge. ✓"}</div>}
            </div>
            {/* Top sellers */}
            <div>
              <div style={subhStyle}>🔥 {en ? "Top sellers (30d)" : "Meilleures ventes (30j)"}</div>
              {invHealth.data.top_sellers.map((p, i) => (
                <div key={i} style={miniRowStyle}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.product_name}</span>
                  <span style={{ color: "#34d399", fontWeight: 700 }}>{p.units_sold_30d} {p.unit}</span>
                </div>
              ))}
              {invHealth.data.top_sellers.length === 0 && <div style={emptyStyle}>{en ? "No sales in 30 days." : "Aucune vente en 30j."}</div>}
            </div>
          </div>
        )}
      </Card>

      <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>
        <Link to="/reports" style={{ color: "var(--brand-light)", textDecoration: "none" }}>
          {en ? "→ Single-day Daily Report" : "→ Rapport quotidien (un jour)"}
        </Link>
      </div>

      {/* MP-SCOREBOARD-DEBT-TAPTHROUGH: which customers a cashier's debt total came from. */}
      {debtDetail && (
        <div onClick={() => setDebtDetail(null)}
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, width: "100%", maxWidth: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{debtDetail.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {debtDetail.cashier_name} · {from}{from !== to ? ` → ${to}` : ""}
                </div>
              </div>
              <button onClick={() => setDebtDetail(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: "8px 18px 16px" }}>
              {debtDetail.loading ? (
                <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
              ) : debtDetail.error ? (
                <div style={{ padding: 20, textAlign: "center", color: "#f87171" }}>{en ? "Could not load" : "Échec du chargement"}</div>
              ) : debtDetail.items.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "No debt-collection payments." : "Aucun paiement de dette."}</div>
              ) : (
                <>
                  {debtDetail.items.map((it, i) => (
                    <div key={it.payment_id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{it.customer_name || (en ? "(unknown customer)" : "(client inconnu)")}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {methodDisplay(it.method_bucket, it.payment_method)} · {new Date(it.paid_at).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "short" })}
                          {it.sale_number ? ` · ${it.sale_number}` : ""}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{fmt(it.amount)}</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontWeight: 800 }}>
                    <span>{en ? "Total" : "Total"}</span>
                    <span>{fmt(debtDetail.total)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline styles ───────────────────────────────────────────────

const chipStyle = (active) => ({
  padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
  border: `1px solid ${active ? "var(--brand-light)" : "var(--border)"}`,
  background: active ? "var(--brand-light)" : "var(--bg-card)",
  color: active ? "#0b1220" : "var(--text-primary)",
  cursor: "pointer",
});
const dateInputStyle = {
  padding: "5px 8px", borderRadius: 6, fontSize: 12,
  border: "1px solid var(--border)", background: "var(--bg-card)",
  color: "var(--text-primary)",
};
const loadingStyle = { padding: 20, color: "var(--text-muted)", textAlign: "center", fontSize: 13 };
const errorStyle   = { padding: 20, color: "#f87171", textAlign: "center", fontSize: 13 };
const tableStyle   = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle      = { padding: "8px 10px", textAlign: "left",  fontWeight: 700, color: "var(--text-muted)", fontSize: 11, borderBottom: "1px solid var(--border)" };
const thStyleRight = { ...thStyle, textAlign: "right" };
const tdStyle      = { padding: "8px 10px", textAlign: "left",  color: "var(--text-primary)" };
const tdStyleRight = { ...tdStyle, textAlign: "right" };
// MP-SCOREBOARD-INCOME: the board is now wide — keep the Cashier column pinned
// (sticky) while the rest scrolls horizontally on a phone. Solid background so
// scrolling cells pass underneath it cleanly.
const thStickyLeft = { ...thStyle, position: "sticky", left: 0, zIndex: 2, background: "var(--bg-elevated)" };
const tdStickyLeft = { ...tdStyle, position: "sticky", left: 0, zIndex: 1, background: "var(--bg-elevated)" };
const smallBtnStyle = {
  padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg-card)",
  color: "var(--text-primary)", cursor: "pointer",
};
const subhStyle = { fontWeight: 800, fontSize: 12, marginBottom: 8, color: "var(--text-primary)" };
const miniRowStyle = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12,
};
const emptyStyle = { padding: "8px 0", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" };
