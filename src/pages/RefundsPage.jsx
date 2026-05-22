// MP-REFUNDS-STAFF-ACCESS
//
// Operational refund/exchange page open to all roles
// (owner / manager / cashier). Previously refunds lived inside
// Reports → Sales Detail tab, which was owner/manager-only via
// nav RoleGuard, so cashiers couldn't process a customer return.
//
// This page is intentionally minimal: today's sales by default
// (most recent first), with a search-by-sale-number box and a
// "Refund" button per row that opens the existing
// VoidReturnModal with the sale loaded via GET /api/sales/:id.
//
// Endpoints used (both already exist, neither is role-gated):
//   GET /api/sales?date=YYYY-MM-DD&limit=&page=
//   GET /api/sales/:id  (returns sale with pa_sale_items)
// No new backend route needed; no plan gate (refunds are
// operational, not analytical — every shop needs them).
//
// VoidReturnModal hides the Void mode button when the user's
// role !== owner/manager (see canVoid in that component).
// Backend mirror: returns.js opens /return + /exchange to
// cashier; /void stays owner/manager.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";
import VoidReturnModal from "../components/common/VoidReturnModal";

export default function RefundsPage() {
  const { lang } = useLangStore();
  const fr = lang === "fr";

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]       = useState(today);
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const [selected, setSelected] = useState(null); // hydrated sale for the modal
  const [loadingSale, setLoadingSale] = useState(null); // sale id being fetched

  const PAGE_LIMIT = 30;
  // Reuse GET /api/sales — paginated by date, returns sale + customer
  // (not items). Items hydrate on click via GET /:id.
  const { data: salesResp, isLoading, refetch } = useQuery({
    queryKey: ["refunds-sales-list", date, page, PAGE_LIMIT],
    queryFn: () => api.get(`/sales?date=${date}&limit=${PAGE_LIMIT}&page=${page}`).then(r => r.data),
  });
  const sales = salesResp?.data || [];
  const total = salesResp?.total || 0;
  const hasNext = page * PAGE_LIMIT < total;

  // Client-side search-by-sale-number on top of the fetched page.
  // For the common case (today's 10–50 sales), the page already
  // holds everything; if the user types a number from a different
  // day, they switch the date filter.
  const visible = search.trim()
    ? sales.filter(s => (s.sale_number || "").toLowerCase().includes(search.trim().toLowerCase()))
    : sales;

  const handleRefund = async (saleId) => {
    setLoadingSale(saleId);
    try {
      const { data } = await api.get(`/sales/${saleId}`);
      // /api/sales/:id returns { success, data: fullSale }
      const sale = data?.data || data;
      if (!sale || !sale.id) throw new Error("Sale not found");
      setSelected(sale);
    } catch (err) {
      console.error("[refunds] failed to load sale", err);
    } finally {
      setLoadingSale(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">↩ {fr ? "Remboursements" : "Refunds"}</h1>
          <div className="page-sub">
            {fr
              ? "Sélectionnez la vente du client pour traiter un remboursement ou un échange."
              : "Pick the customer's sale to process a refund or exchange."}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label className="label" style={{ margin: 0 }}>{fr ? "Date" : "Date"}</label>
          <input className="input" type="date" value={date}
            onChange={e => { setDate(e.target.value); setPage(1); }}
            style={{ width: 160 }} />
        </div>
        <button className="btn btn-secondary"
          onClick={() => { setDate(today); setPage(1); }}
          disabled={date === today}>
          {fr ? "Aujourd'hui" : "Today"}
        </button>
        <input className="input" placeholder={fr ? "Chercher N° vente (VNT-…)" : "Search sale # (VNT-…)"}
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }} />
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {fr ? "Chargement…" : "Loading…"}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>🧾</div>
          <div style={{ fontWeight: 600 }}>
            {search.trim()
              ? (fr ? "Aucune vente correspondante" : "No matching sale")
              : (fr ? "Aucune vente ce jour" : "No sales on this day")}
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{fr ? "N° vente" : "Sale #"}</th>
                  <th>{fr ? "Heure" : "Time"}</th>
                  <th>{fr ? "Client" : "Customer"}</th>
                  <th style={{ textAlign: "right" }}>{fr ? "Total" : "Total"}</th>
                  <th>{fr ? "Statut" : "Status"}</th>
                  <th style={{ textAlign: "right" }}>{fr ? "Action" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(s => {
                  const timeStr = s.created_at
                    ? new Date(s.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                    : "—";
                  const statusColor = s.payment_status === "paid"   ? "#34d399"
                                    : s.payment_status === "partial" ? "#fbbf24"
                                    : s.payment_status === "credit"  ? "#f87171"
                                    : "var(--text-muted)";
                  const isVoided = s.is_voided;
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{s.sale_number}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{timeStr}</td>
                      <td>{s.pa_customers?.name || (fr ? "Comptoir" : "Walk-in")}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCFA(s.total_amount)}</td>
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${statusColor}22`, color: statusColor, fontWeight: 600 }}>
                          {s.payment_status}
                        </span>
                        {isVoided && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(100,100,100,0.15)", color: "var(--text-muted)", fontWeight: 600, marginLeft: 4 }}>
                            {fr ? "annulée" : "voided"}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          onClick={() => handleRefund(s.id)}
                          disabled={isVoided || loadingSale === s.id}
                          style={{
                            padding: "6px 12px", borderRadius: 8,
                            border: "1px solid rgba(251,191,36,0.4)",
                            background: isVoided ? "var(--bg-elevated)" : "rgba(251,191,36,0.10)",
                            color: isVoided ? "var(--text-muted)" : "#fbbf24",
                            fontWeight: 700, fontSize: 12,
                            cursor: isVoided ? "not-allowed" : "pointer",
                            opacity: isVoided ? 0.6 : 1,
                          }}>
                          {loadingSale === s.id
                            ? "…"
                            : (fr ? "↩ Rembourser" : "↩ Refund")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(page > 1 || hasNext) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}>
                ← {fr ? "Précédent" : "Previous"}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fr ? `Page ${page}` : `Page ${page}`}{total > 0 ? ` · ${total} ${fr ? "ventes" : "sales"}` : ""}
              </div>
              <button className="btn btn-secondary"
                disabled={!hasNext}
                onClick={() => setPage(p => p + 1)}>
                {fr ? "Suivant" : "Next"} →
              </button>
            </div>
          )}
        </div>
      )}

      {selected && (
        <VoidReturnModal
          sale={selected}
          lang={lang}
          onClose={() => { setSelected(null); refetch(); }}
        />
      )}
    </div>
  );
}
