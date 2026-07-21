// MP-CREDIT-DRILLDOWN — shared "Credit given" drill-down modal for fraud / red-flag
// review. Tapping any "Credit given" figure (operations scoreboard, daily report,
// shift-close) opens this: the individual credit sales behind that number, for the
// tapped scope. Each row = one credit sale (customer who RECEIVED it + cashier who
// GAVE it + amount + time). Tap a row → the full sale (items / qty / ref — "what
// happened") from GET /sales/:id.
//
// Data source is the credit_extended flow (GET /sales/credit-given → the
// dashboard_credit_given_detail RPC), NOT the balance_due snapshot, so it does not
// drift and it reconciles to the daily-report header. Permissions are enforced
// server-side (owner/manager/accountant see all; a cashier sees only their own).
//
// Props:
//   scope  = null (closed) | {
//     label,                     // header title, already localised by the caller
//     subtitle,                  // small line under the title (cashier / range / shift)
//     from, to,                  // YYYY-MM-DD (day/location mode)
//     location_id, cashier_id,   // optional filters (day mode)
//     shift_id,                  // optional (shift mode — from/to ignored)
//   }
//   onClose()

import { useEffect, useState } from "react";
import api from "../../utils/api";
import { useLangStore } from "../../store";
import { useCurrency } from "../../utils/useCurrency";

// One row — self-manages its expand + lazy /sales/:id fetch for the item detail.
function CreditRow({ it, en, fmt }) {
  const [open, setOpen]       = useState(false);
  const [detail, setDetail]   = useState(null); // sale object
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true); setError(false);
      try {
        const s = await api.get(`/sales/${it.sale_id}`).then(r => r.data?.data || null);
        setDetail(s);
      } catch { setError(true); }
      finally { setLoading(false); }
    }
  };

  const when = it.created_at
    ? new Date(it.created_at).toLocaleString(en ? "en-GB" : "fr-FR",
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

  // product lines only (exclude the debt-payment pseudo-line).
  const lines = (detail?.pa_sale_items || []).filter(li => li.line_type !== "debt_payment");

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div onClick={toggle}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", cursor: "pointer" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {open ? "▾ " : "▸ "}{it.customer_name || (en ? "(unknown customer)" : "(client inconnu)")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {(en ? "by " : "par ") + (it.cashier_name || "—")} · {when}
            {it.sale_number ? ` · ${it.sale_number}` : ""}
          </div>
        </div>
        <div style={{ fontWeight: 800, whiteSpace: "nowrap", color: "#fbbf24" }}>{fmt(it.amount)}</div>
      </div>

      {open && (
        <div style={{ padding: "2px 0 12px 14px", fontSize: 12 }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
          ) : error ? (
            <div style={{ color: "#f87171" }}>{en ? "Could not load the sale." : "Échec du chargement."}</div>
          ) : detail ? (
            <>
              {lines.length === 0 ? (
                <div style={{ color: "var(--text-muted)" }}>{en ? "No item lines." : "Aucun article."}</div>
              ) : lines.map((li, i) => {
                const name = li.pa_products?.name || li.pa_products?.name_en || (en ? "Item" : "Article");
                const lineTotal = Number(li.total_price ?? li.net_amount ?? (li.quantity * li.unit_price)) || 0;
                return (
                  <div key={li.id || i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                    <span style={{ color: "var(--text-muted)" }}>
                      {Number(li.quantity) || 0}{li.pa_products?.unit ? ` ${li.pa_products.unit}` : ""} × {name}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>{fmt(lineTotal)}</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 6, marginTop: 4, borderTop: "1px dashed var(--border)", fontWeight: 700 }}>
                <span>{en ? "Sale total" : "Total vente"}{detail.sale_number ? ` · ${detail.sale_number}` : ""}</span>
                <span>{fmt(Number(detail.total_amount) || 0)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-muted)" }}>
                <span>{en ? "Left on credit (now)" : "Reste à crédit (actuel)"}</span>
                <span>{fmt(Number(detail.balance_due) || 0)}</span>
              </div>
              {it.carryover > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-muted)", marginTop: 2 }}>
                  <span>{en ? "…of which old debt rolled in" : "…dont ancienne dette reportée"}</span>
                  <span>{fmt(it.carryover)}</span>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function CreditGivenModal({ scope, onClose }) {
  const lang = useLangStore(s => s.lang);
  const en   = lang === "en";
  const fmt  = useCurrency();
  const [state, setState] = useState({ loading: true, items: [], total: 0, error: false });

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    setState({ loading: true, items: [], total: 0, error: false });
    const p = new URLSearchParams();
    if (scope.shift_id)    p.set("shift_id", scope.shift_id);
    if (scope.from)        p.set("from", scope.from);
    if (scope.to)          p.set("to", scope.to);
    if (scope.location_id) p.set("location_id", scope.location_id);
    if (scope.cashier_id)  p.set("cashier_id", scope.cashier_id);
    api.get(`/sales/credit-given?${p.toString()}`)
      .then(r => r.data?.data || { items: [], total: 0 })
      .then(d => { if (alive) setState({ loading: false, items: d.items || [], total: d.total || 0, error: false }); })
      .catch(() => { if (alive) setState({ loading: false, items: [], total: 0, error: true }); });
    return () => { alive = false; };
  }, [scope]);

  if (!scope) return null;

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "82vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{scope.label || (en ? "Credit given" : "Crédit accordé")}</div>
            {scope.subtitle && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{scope.subtitle}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: "8px 18px 16px" }}>
          {state.loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
          ) : state.error ? (
            <div style={{ padding: 20, textAlign: "center", color: "#f87171" }}>{en ? "Could not load" : "Échec du chargement"}</div>
          ) : state.items.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "No credit given in this scope." : "Aucun crédit accordé dans cette vue."}</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "2px 0 6px" }}>
                {en ? "Tap a sale to see what was sold." : "Touchez une vente pour voir ce qui a été vendu."}
              </div>
              {state.items.map((it, i) => (
                <CreditRow key={it.sale_id || i} it={it} en={en} fmt={fmt} />
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontWeight: 800 }}>
                <span>{en ? "Total credit given" : "Total crédit accordé"}</span>
                <span style={{ color: "#fbbf24" }}>{fmt(state.total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
