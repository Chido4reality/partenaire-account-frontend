// HELD-RECEIPT REMINDERS (Peter, 2026-10-04 — approved design). Visible where the
// owner already looks, not only as a notification that can be missed. One component,
// three surfaces, so they cannot disagree about thresholds (the server decides tiers):
//   variant="strip"     — Transfers screen (owner/manager): amber ≥ 8h, red ≥ 24h.
//   variant="pinned"    — Accountant Log / Team Approvals: a pinned "Stuck" section
//                         listing every receipt waiting 24h or more.
//   variant="dashboard" — Dashboard: red banner once anything has waited 7 days.
// Reading GET /transfers/held-summary also materialises any reminder now due
// (evaluate-on-read; claimed once server-side). Reminders only — nothing here acts.
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { useCurrency } from "../../utils/useCurrency";

export const HELD_SUMMARY_KEY = ["held-summary"];

export function useHeldSummary(enabled = true) {
  return useQuery({
    queryKey: HELD_SUMMARY_KEY,
    queryFn: () => api.get("/transfers/held-summary").then(r => r.data),
    refetchInterval: 120000, enabled, retry: 1,
  });
}

export const ageLabel = (h, en) => {
  if (h >= 48) { const d = Math.floor(h / 24); return en ? `${d} days` : `${d} jours`; }
  const hh = Math.floor(h); return en ? `${hh}h` : `${hh} h`;
};

export function HoldTierBadge({ tier, ageHours, en }) {
  if (!tier || tier === "pending") return null;
  const red = tier === "stuck" || tier === "week";
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, marginLeft: 6,
      background: red ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)", color: red ? "#f87171" : "#f59e0b",
      border: `1px solid ${red ? "rgba(239,68,68,0.45)" : "rgba(245,158,11,0.45)"}` }}>
      {red ? (en ? `Stuck · ${ageLabel(ageHours, en)}` : `Bloquée · ${ageLabel(ageHours, en)}`)
           : (en ? `Overdue · ${ageLabel(ageHours, en)}` : `En retard · ${ageLabel(ageHours, en)}`)}
    </span>
  );
}

export default function HeldReceiptsBanner({ variant = "strip", en, onOpen }) {
  const fmt = useCurrency();
  const { data } = useHeldSummary(true);
  const s = data?.data;
  if (!s || !s.count) return null;

  if (variant === "dashboard") {
    if (!s.week) return null;
    const oldest = s.items[0];
    return (
      <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 12, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.45)", color: "#f87171", fontSize: 13.5 }}
        onClick={onOpen} role={onOpen ? "button" : undefined}>
        🔴 <strong>{en ? `${s.week} held receipt(s) waiting more than a week.` : `${s.week} réception(s) en attente depuis plus d'une semaine.`}</strong>{" "}
        {en ? `The oldest (${oldest.transfer_number}, ${ageLabel(oldest.age_hours, en)}) is ${oldest.units} units in nobody's stock.`
            : `La plus ancienne (${oldest.transfer_number}, ${ageLabel(oldest.age_hours, en)}) : ${oldest.units} unités dans aucun stock.`}
      </div>
    );
  }

  if (variant === "pinned") {
    const stuck = s.items.filter(i => i.tier === "stuck" || i.tier === "week");
    if (!stuck.length) return null;
    return (
      <div className="card" style={{ marginBottom: 12, padding: "12px 14px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.06)" }}>
        <div style={{ fontWeight: 800, color: "#f87171", marginBottom: 6 }}>
          📌 {en ? `Stuck receipts — waiting ${s.thresholds?.stuck_h || 24}h or more` : `Réceptions bloquées — en attente depuis ${s.thresholds?.stuck_h || 24} h ou plus`}
        </div>
        {stuck.map(i => (
          <div key={i.approval_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
            <span><strong>{i.transfer_number}</strong> · {i.to_name}{i.receiver_name ? ` · ${en ? "counted by" : "compté par"} ${i.receiver_name}` : ""}</span>
            <span style={{ color: "#f87171", fontWeight: 700 }}>
              {i.units} {en ? "units" : "unités"}{i.value != null ? ` · ${fmt(i.value)}` : ""} · {ageLabel(i.age_hours, en)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // strip
  const red = s.stuck > 0;
  const amber = !red && s.overdue > 0;
  return (
    <div style={{ fontSize: 12.5, marginBottom: 10, padding: "8px 12px", borderRadius: 8,
      background: red ? "rgba(239,68,68,0.12)" : amber ? "rgba(245,158,11,0.12)" : "var(--bg-elevated)",
      border: `1px solid ${red ? "rgba(239,68,68,0.45)" : amber ? "rgba(245,158,11,0.45)" : "var(--border)"}`,
      color: red ? "#f87171" : amber ? "#f59e0b" : "var(--text-secondary)" }}>
      {red ? "🔴 " : amber ? "⏳ " : "⏸ "}
      {en ? `${s.count} receipt${s.count > 1 ? "s" : ""} waiting for your decision — ${s.units} units${s.value != null ? `, ${fmt(s.value)} at cost` : ""}, not in stock.`
          : `${s.count} réception${s.count > 1 ? "s" : ""} en attente de votre décision — ${s.units} unités${s.value != null ? `, ${fmt(s.value)} au prix d'achat` : ""}, hors stock.`}
      {" "}{en ? `Oldest: ${ageLabel(s.oldest_hours, en)}.` : `Plus ancienne : ${ageLabel(s.oldest_hours, en)}.`}
    </div>
  );
}
