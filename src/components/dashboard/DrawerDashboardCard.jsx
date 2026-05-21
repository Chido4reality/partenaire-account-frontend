// MP-DRAWER-DASHBOARD-CARD
//
// "Caisse du jour" detailed card. Lives below the slim
// <ActiveShiftIndicator/> on the Dashboard. Reuses the same
// ["current-shift", locId] query key as the indicator so they share
// cache and update together.
//
// Three states (see task spec):
//   1. No open shift today    → empty card + "Ouvrir le poste" CTA
//   2. Shift currently open   → breakdown rows + clickable drilldowns + "Fermer le poste"
//   3. Shift closed today     → state 2 + actual_cash + variance + "Ouvrir un nouveau poste"
//
// The 3 clickable rows open detail modals that hit:
//   GET /api/shifts/:id/cash-sales
//   GET /api/shifts/:id/cash-refunds
//   GET /api/shifts/:id/cash-expenses
// Backed by routes added in shifts.js alongside this commit.
//
// Reuses OpenShiftModal / CloseShiftModal exported from
// components/common/ShiftWidgets.jsx (Stage 2) — no duplication.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore, useSettingsStore } from "../../store";
import api, { formatCFA } from "../../utils/api";
import { OpenShiftModal, CloseShiftModal } from "../common/ShiftWidgets";

// ── Row primitives ────────────────────────────────────────────────
function StaticRow({ label, value, valueColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <strong style={{ color: valueColor || "var(--text-primary)" }}>{value}</strong>
    </div>
  );
}

function ClickRow({ label, value, valueColor, onClick, title }) {
  return (
    <div role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      title={title}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 14px", fontSize: 13, cursor: "pointer", borderRadius: 8,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <span style={{ color: "var(--text-secondary)" }}>
        {label} <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 4 }}>↗</span>
      </span>
      <strong style={{ color: valueColor || "var(--text-primary)" }}>{value}</strong>
    </div>
  );
}

// ── DetailModal — one shared shell for the 3 drilldowns ───────────
function DetailModal({ kind, shiftId, onClose }) {
  const { lang } = useLangStore();
  const fr = lang === "fr";

  // Per-kind config: endpoint path, title, list key, columns, row render.
  const cfg = {
    sales: {
      path: "cash-sales", listKey: "sales",
      title: fr ? "Détail — Ventes en espèces" : "Detail — Cash sales",
      cols:  fr ? ["Heure", "Vente", "Client", "Montant"]
                : ["Time", "Sale", "Customer", "Amount"],
      row:   r => ({
        time:    new Date(r.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        a:       r.sale_number || "—",
        b:       r.customer_name || (fr ? "Comptoir" : "Walk-in"),
        amount:  Number(r.amount) || 0,
        key:     r.payment_id,
      }),
    },
    refunds: {
      path: "cash-refunds", listKey: "refunds",
      title: fr ? "Détail — Remboursements espèces" : "Detail — Cash refunds",
      cols:  fr ? ["Heure", "Vente", "Motif", "Montant"]
                : ["Time", "Sale", "Reason", "Amount"],
      row:   r => ({
        time:    new Date(r.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        a:       r.sale_number || "—",
        b:       r.refund_reason || (r.customer_name || "—"),
        amount:  Number(r.refund_amount) || 0,
        key:     r.return_id,
      }),
    },
    expenses: {
      path: "cash-expenses", listKey: "expenses",
      title: fr ? "Détail — Dépenses espèces" : "Detail — Cash expenses",
      cols:  fr ? ["Heure", "Catégorie", "Description", "Montant"]
                : ["Time", "Category", "Description", "Amount"],
      row:   r => ({
        time:    new Date(r.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        a:       r.category_name || "—",
        b:       r.description || (r.recorder_name || "—"),
        amount:  Number(r.amount) || 0,
        key:     r.expenditure_id,
      }),
    },
  }[kind];

  const { data, isLoading } = useQuery({
    queryKey: ["shift-detail", shiftId, kind],
    queryFn: () => api.get(`/shifts/${shiftId}/${cfg.path}`).then(r => r.data?.data),
    enabled: !!shiftId,
  });

  const rows = (data?.[cfg.listKey] || []).map(cfg.row);
  const total = Number(data?.total || 0);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 20, maxWidth: 640, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{cfg.title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {fr ? `${rows.length} ${rows.length === 1 ? "transaction" : "transactions"} · Total : ` : `${rows.length} ${rows.length === 1 ? "transaction" : "transactions"} · Total: `}
          <strong style={{ color: "var(--brand-light)" }}>{formatCFA(total)}</strong>
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, border: "1px solid var(--border)", borderRadius: 10 }}>
          {isLoading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {fr ? "Aucune transaction sur ce poste." : "No transactions in this shift."}
            </div>
          ) : (
            <table className="table" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  {cfg.cols.map((c, i) => (
                    <th key={i} style={{ textAlign: i === cfg.cols.length - 1 ? "right" : "left" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>{r.time}</td>
                    <td style={{ fontWeight: 500 }}>{r.a}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{r.b}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCFA(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button className="btn btn-secondary" onClick={onClose}>
            {fr ? "Fermer" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card shell (always renders the slim header row; conditional
//    expandable body via maxHeight + opacity transition). The body
//    children stay MOUNTED while collapsed (display preserved via
//    overflow:hidden) so drilldown / shift queries don't refetch on
//    every toggle. ────────────────────────────────────────────────
function Shell({ shellRef, header, children, expandable, isExpanded }) {
  return (
    <div ref={shellRef} style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: 14, width: "100%", maxWidth: 560,
      overflow: "hidden",
    }}>
      {header}
      {expandable && (
        <div style={{
          maxHeight: isExpanded ? 800 : 0,
          opacity:   isExpanded ? 1   : 0,
          overflow:  "hidden",
          transition: "max-height 250ms ease, opacity 200ms ease",
          // Keep the children mounted to preserve query state; the
          // outer maxHeight + opacity hide them visually.
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Header row builder (the always-visible slim summary line) ────
// Renders a single row with summary info on the left + optional
// trailing action button + chevron/× on the right. Whole row is
// the click target when `onToggle` is provided.
function Header({ onToggle, isExpanded, leading, trailing, action }) {
  const clickable = !!onToggle;
  return (
    <div
      onClick={clickable ? onToggle : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "12px 14px",
        cursor: clickable ? "pointer" : "default",
        userSelect: "none",
        minHeight: 48,
      }}
      title={clickable ? (isExpanded ? "Refermer" : "Détails") : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
        {leading}
      </div>
      {trailing}
      {action && (
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
          {action}
        </span>
      )}
      {clickable && (
        <span style={{
          marginLeft: 4,
          fontSize: isExpanded ? 20 : 12,
          lineHeight: 1,
          color: "var(--text-muted)",
          width: 18, textAlign: "center",
        }}>
          {isExpanded ? "×" : "▼"}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────
export default function DrawerDashboardCard() {
  const { lang } = useLangStore();
  const fr = lang === "fr";
  const { selectedLocation } = useSettingsStore();
  const locId = selectedLocation?.id || null;

  // Shared cache with <ActiveShiftIndicator/> — same queryKey.
  const { data: current, isLoading } = useQuery({
    queryKey: ["current-shift", locId],
    queryFn: () => api.get(`/shifts/current?location_id=${locId}`).then(r => r.data?.data),
    enabled: !!locId,
    refetchInterval: 30000,
  });

  // For state 3 — peek at the most recent closed shift to see if it
  // was today. Dedicated key (different limit from ShiftsPage's table).
  const { data: history } = useQuery({
    queryKey: ["shifts-history", locId, 1, 0],
    queryFn: () => api.get(`/shifts/history?location_id=${locId}&limit=1&offset=0`).then(r => r.data?.data),
    enabled: !!locId,
    refetchInterval: 30000,
  });

  const [showOpen, setShowOpen]     = useState(false);
  const [showClose, setShowClose]   = useState(false);
  const [drill, setDrill]           = useState(null); // 'sales' | 'refunds' | 'expenses'
  const [isExpanded, setIsExpanded] = useState(false);

  // ── Resolve state ───────────────────────────────────────────────
  const hasOpenShift = !!(current && current.shift_id);
  const recentClosed = history?.shifts?.[0];
  const todayIso     = new Date().toISOString().slice(0, 10);
  const closedToday  = !hasOpenShift && recentClosed
                    && recentClosed.shift_date === todayIso
                    && recentClosed.status === "closed";
  const shift        = hasOpenShift ? current : (closedToday ? recentClosed : null);

  // ── Click-outside + ESC to collapse. Guarded against modals so
  //    clicking inside a drilldown / open-shift / close-shift modal
  //    doesn't accidentally collapse the card behind them. ────────
  const cardRef       = useRef(null);
  const anyModalOpen  = showOpen || showClose || !!drill;
  useEffect(() => {
    if (!isExpanded) return;
    const onDown = (e) => {
      if (anyModalOpen) return;
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        setIsExpanded(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape" && !anyModalOpen) setIsExpanded(false);
    };
    document.addEventListener("mousedown",  onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown",    onKey);
    return () => {
      document.removeEventListener("mousedown",  onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown",    onKey);
    };
  }, [isExpanded, anyModalOpen]);

  const expanded = isExpanded;
  const toggle   = () => setIsExpanded(v => !v);

  // ── State 0: no location — slim hint, not expandable ────────────
  if (!locId) {
    return (
      <Shell shellRef={cardRef}
        header={<Header leading={
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            📍 {fr ? "Sélectionnez un emplacement pour voir la caisse." : "Select a location to see the drawer."}
          </span>
        } />}
      />
    );
  }

  // ── Loading — slim placeholder, not expandable ──────────────────
  if (isLoading) {
    return (
      <Shell shellRef={cardRef}
        header={<Header leading={
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            💰 {fr ? "Caisse du jour" : "Today's drawer"} · Loading…
          </span>
        } />}
      />
    );
  }

  // ── State 1: no shift today — slim row + Open button. NOT
  //    expandable (no extra detail to reveal — collapsed row IS the
  //    whole card per task spec). ──────────────────────────────────
  if (!shift) {
    return (
      <>
        <Shell shellRef={cardRef}
          header={<Header
            leading={
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>
                💰 {fr ? "Aucun poste de caisse aujourd'hui" : "No cash shift today"}
              </span>
            }
            action={
              <button onClick={() => setShowOpen(true)}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--brand)", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                {fr ? "Ouvrir le poste" : "Open shift"}
              </button>
            }
          />}
        />
        <OpenShiftModal open={showOpen} onClose={() => setShowOpen(false)} />
      </>
    );
  }

  // ── States 2 & 3: shift exists — collapsible card ───────────────
  const openedAt = new Date(shift.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const closedAt = closedToday
    ? new Date(shift.closed_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const variance      = closedToday ? Number(shift.variance || 0) : null;
  const varianceColor = variance == null ? "var(--text-primary)"
                      : variance === 0   ? "#34d399"
                      : variance > 0     ? "#fbbf24"
                                         : "#f87171";
  const expected      = Number(shift.expected_drawer || 0);

  // Headline (right-side summary number) varies by state.
  const headline = hasOpenShift
    ? (
      <span style={{ fontSize: 13 }}>
        {fr ? "Attendu : " : "Expected: "}
        <strong style={{ color: "var(--brand-light)" }}>{formatCFA(expected)}</strong>
      </span>
    )
    : (
      <span style={{ fontSize: 13 }}>
        {fr ? "Écart : " : "Variance: "}
        <strong style={{ color: varianceColor }}>
          {variance === 0
            ? `${formatCFA(0)} ${fr ? "(Exact)" : "(Exact)"}`
            : variance > 0
              ? `+${formatCFA(variance)} ${fr ? "(Excédent)" : "(Surplus)"}`
              : `−${formatCFA(Math.abs(variance))} ${fr ? "(Manquant)" : "(Shortage)"}`}
        </strong>
      </span>
    );

  // Leading text — emoji + title + "open since" / "closed at" sub.
  const leading = (
    <>
      <span style={{ fontSize: 14, fontWeight: 700 }}>
        💰 {fr ? "Caisse du jour" : "Today's drawer"}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        ·{" "}{hasOpenShift
          ? (fr ? `Ouvert depuis ${openedAt}` : `Open since ${openedAt}`)
          : (fr ? `Fermé à ${closedAt || openedAt}` : `Closed at ${closedAt || openedAt}`)}
      </span>
    </>
  );

  return (
    <>
      <Shell shellRef={cardRef} expandable isExpanded={expanded}
        header={<Header
          onToggle={toggle}
          isExpanded={expanded}
          leading={leading}
          trailing={headline}
        />}>
        {/* ── Expanded body ────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          <StaticRow
            label={fr ? "Solde d'ouverture" : "Opening float"}
            value={formatCFA(Number(shift.opening_float || 0))} />

          <ClickRow
            label={fr ? "+ Ventes en espèces" : "+ Cash sales"}
            value={formatCFA(Number(shift.cash_sales_received || 0))}
            valueColor="#34d399"
            onClick={() => setDrill("sales")}
            title={fr ? "Cliquer pour le détail" : "Click for detail"} />

          <ClickRow
            label={fr ? "− Remboursements espèces" : "− Cash refunds"}
            value={formatCFA(Number(shift.cash_refunds || 0))}
            valueColor="#f87171"
            onClick={() => setDrill("refunds")}
            title={fr ? "Cliquer pour le détail" : "Click for detail"} />

          <ClickRow
            label={fr ? "− Dépenses espèces" : "− Cash expenses"}
            value={formatCFA(Number(shift.cash_expenses || 0))}
            valueColor="#f87171"
            onClick={() => setDrill("expenses")}
            title={fr ? "Cliquer pour le détail" : "Click for detail"} />

          <div style={{ height: 1, background: "var(--border)", margin: "6px 14px" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>
              {fr ? "Caisse attendue" : "Expected drawer"}
            </span>
            <strong style={{ fontSize: 20, color: "var(--brand-light)" }}>
              {formatCFA(expected)}
            </strong>
          </div>

          {closedToday && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "0 14px 6px" }} />
              <StaticRow
                label={fr ? "Solde réel" : "Actual cash"}
                value={formatCFA(Number(shift.actual_cash || 0))} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>{fr ? "Écart" : "Variance"}</span>
                <strong style={{ color: varianceColor, fontWeight: 700 }}>
                  {variance === 0
                    ? `${formatCFA(0)} ${fr ? "(Exact)" : "(Exact)"}`
                    : variance > 0
                      ? `+${formatCFA(variance)} ${fr ? "(Excédent)" : "(Surplus)"}`
                      : `−${formatCFA(Math.abs(variance))} ${fr ? "(Manquant)" : "(Shortage)"}`}
                </strong>
              </div>
            </>
          )}

          <div style={{ padding: "10px 14px 12px" }}>
            {hasOpenShift ? (
              <button onClick={() => setShowClose(true)}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #ef4444", background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                🔒 {fr ? "Fermer le poste" : "Close shift"}
              </button>
            ) : (
              <button onClick={() => setShowOpen(true)}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--brand)", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                🔓 {fr ? "Ouvrir un nouveau poste" : "Open new shift"}
              </button>
            )}
          </div>
        </div>
      </Shell>

      {/* Reused modals from ShiftWidgets — they own their own
          mutations + invalidation, so this card stays read-only. */}
      <OpenShiftModal  open={showOpen}  onClose={() => setShowOpen(false)} />
      <CloseShiftModal open={showClose} onClose={() => setShowClose(false)} shift={current} />

      {drill && (
        <DetailModal
          kind={drill}
          shiftId={shift.shift_id || shift.id}
          onClose={() => setDrill(null)} />
      )}
    </>
  );
}
