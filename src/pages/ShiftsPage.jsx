// MP-CASH-SHIFTS-UI (Stage 2)
//
// Rewritten to use the Stage 1 backend contract (commit aa71d81):
//   GET  /shifts/current?location_id=  → live indicator + close-modal data
//   POST /shifts/open                  → triggered from <ActiveShiftIndicator/>
//   POST /shifts/:id/close             → triggered from <ActiveShiftIndicator/>
//   GET  /shifts/history?location_id=  → the recent-shifts table below
//
// The legacy ShiftsPage was a per-cashier per-day open form plus a
// manual close form; both lived inline. Both are now consolidated into
// the indicator + its modals (one place, used everywhere — see also
// POSPage and Dashboard, which mount the same indicator at the top).
//
// The legacy /shifts/my-shift, /shifts, /shifts/close/:id endpoints
// stay reachable in the backend for any cached client; nothing on this
// page hits them.

import { useState } from "react";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { ActiveShiftIndicator } from "../components/common/ShiftWidgets";

const PAGE_LIMIT = 20;

export default function ShiftsPage() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const isOwner   = user?.role === "owner";
  const isManager = user?.role === "manager";
  const canSeeHistory = isOwner || isManager;

  const fmt = useCurrency();
  const locId = selectedLocation?.id || null;
  const [offset, setOffset] = useState(0);

  const { data: historyResp, isLoading: histLoading } = useOfflineCachedQuery({
    queryKey: ["shifts-history", locId, PAGE_LIMIT, offset],
    queryFn: () => api.get(
      `/shifts/history?location_id=${locId}&limit=${PAGE_LIMIT}&offset=${offset}`
    ).then(r => r.data?.data),
    enabled: !!locId && canSeeHistory,
  });

  const shifts = historyResp?.shifts || [];
  const total  = historyResp?.total  || 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_LIMIT < total;

  // Variance color/label, shared across cells.
  const varianceColor = (v) =>
    v == null ? "var(--text-muted)" :
    v === 0   ? "#34d399" :
    v > 0     ? "#fbbf24" :
                "#f87171";
  const varianceLabel = (v) => {
    if (v == null) return "—";
    if (v === 0)   return `${fmt(0)} ${lang === "fr" ? "(Exact)"     : "(Exact)"}`;
    if (v > 0)     return `+${fmt(v)} ${lang === "fr" ? "(Excédent)" : "(Surplus)"}`;
    return `−${fmt(Math.abs(v))} ${lang === "fr" ? "(Manquant)"      : "(Shortage)"}`;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">💰 {lang === "fr" ? "Gestion de caisse" : "Cash register"}</h1>
          <div className="page-sub">
            {lang === "fr"
              ? "Ouvrez le poste au début de la journée, fermez-le à la fin pour réconcilier la caisse."
              : "Open the shift at the start of day; close it at the end to reconcile the drawer."}
          </div>
        </div>
      </div>

      {/* The indicator owns the open/close modals AND the live math.
          Same component lives at the top of POSPage and Dashboard, so
          the cashier sees identical state everywhere. */}
      <div style={{ marginBottom: 24 }}>
        <ActiveShiftIndicator />
      </div>

      {/* ── RECENT SHIFTS (manager/owner only) ──────────────────── */}
      {canSeeHistory && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              📋 {lang === "fr" ? "Postes récents" : "Recent shifts"}
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                {selectedLocation?.name ? `• ${selectedLocation.name}` : ""}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {total > 0 && (lang === "fr"
                ? `${offset + 1}–${Math.min(offset + PAGE_LIMIT, total)} sur ${total}`
                : `${offset + 1}–${Math.min(offset + PAGE_LIMIT, total)} of ${total}`)}
            </div>
          </div>

          {!locId ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 13 }}>
              📍 {lang === "fr"
                ? "Sélectionnez un emplacement dans la barre du haut pour voir l'historique."
                : "Select a location in the top bar to see history."}
            </div>
          ) : histLoading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
          ) : shifts.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 13 }}>
              {lang === "fr" ? "Aucun poste fermé pour cet emplacement." : "No closed shifts for this location."}
            </div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>{lang === "fr" ? "Caissier"   : "Cashier"}</th>
                      <th>{lang === "fr" ? "Date"       : "Date"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Fond"       : "Float"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Ventes"     : "Sales"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Remb."      : "Refunds"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Dépenses"   : "Expenses"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Attendu"    : "Expected"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Compté"     : "Counted"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "fr" ? "Écart"      : "Variance"}</th>
                      <th>{lang === "fr" ? "Statut" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map(s => {
                      const v = s.variance != null ? Number(s.variance) : null;
                      return (
                        <tr key={s.shift_id}>
                          <td style={{ fontWeight: 500 }}>{s.cashier_name || "—"}</td>
                          <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{s.shift_date}</td>
                          <td style={{ textAlign: "right" }}>{fmt(s.opening_float || 0)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(s.cash_sales_received || 0)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(s.cash_refunds || 0)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(s.cash_expenses || 0)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(s.expected_drawer || 0)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>
                            {s.actual_cash != null ? fmt(s.actual_cash) : "—"}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: varianceColor(v), whiteSpace: "nowrap" }}>
                            {varianceLabel(v)}
                          </td>
                          <td>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10,
                              background: s.status === "open" ? "rgba(16,185,129,0.15)" : "rgba(100,100,100,0.15)",
                              color:      s.status === "open" ? "#34d399" : "var(--text-muted)",
                              fontWeight: 600 }}>
                              {s.status === "open"
                                ? (lang === "fr" ? "Ouvert" : "Open")
                                : (lang === "fr" ? "Fermé"  : "Closed")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(hasPrev || hasNext) && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
                  <button className="btn btn-secondary"
                    disabled={!hasPrev}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}>
                    ← {lang === "fr" ? "Précédent" : "Previous"}
                  </button>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {Math.floor(offset / PAGE_LIMIT) + 1} / {Math.max(1, Math.ceil(total / PAGE_LIMIT))}
                  </div>
                  <button className="btn btn-secondary"
                    disabled={!hasNext}
                    onClick={() => setOffset(offset + PAGE_LIMIT)}>
                    {lang === "fr" ? "Suivant" : "Next"} →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
