// MP-DATE-RANGE-FILTER — shared date-range toolbar, extracted verbatim from the
// Operations dashboard's inline filter so every screen (Operations, Stock Transfers,
// Stock Check) filters identically. Controlled: parent owns { from, to } (ISO
// yyyy-mm-dd strings) and gets onChange({ from, to }). Chips: Today / Last 7 / Last
// 30; plus From/To date inputs. Bilingual FR/EN.
import { useLangStore } from "../../store";

// ISO yyyy-mm-dd in LOCAL time (matches the Operations helpers byte-for-byte).
export const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toIso(d); };
// Default window used by callers that want a sane initial range.
export const defaultRange = () => ({ from: daysAgo(29), to: toIso(new Date()) });
// WIDE default (≈1 year) for "find a past item" lists (Stock Transfers / Stock Check)
// so nothing is hidden until the user deliberately narrows with a chip or the inputs.
export const wideRange = () => ({ from: daysAgo(365), to: toIso(new Date()) });

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

export default function DateRangeFilter({ from, to, onChange, showTodayChip = false, style }) {
  const en = useLangStore(s => s.lang) === "en";
  const today = toIso(new Date());
  const set = (f, t) => onChange({ from: f, to: t });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...style }}>
      <button onClick={() => set(today, today)} style={chipStyle(from === today && to === today)}>{en ? "Today" : "Aujourd'hui"}</button>
      <button onClick={() => set(daysAgo(6), today)} style={chipStyle(from === daysAgo(6) && to === today)}>{en ? "Last 7 days" : "7 derniers jours"}</button>
      <button onClick={() => set(daysAgo(29), today)} style={chipStyle(from === daysAgo(29) && to === today)}>{en ? "Last 30 days" : "30 derniers jours"}</button>
      <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />
      <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "From" : "Du"}</label>
      <input type="date" value={from} onChange={e => set(e.target.value, to)} style={dateInputStyle} />
      <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "To" : "Au"}</label>
      <input type="date" value={to} onChange={e => set(from, e.target.value)} style={dateInputStyle} />
      {showTodayChip && (
        <div style={{
          marginLeft: "auto", display: "inline-block", fontSize: 13, fontWeight: 800,
          color: "var(--brand-light)", background: "rgba(251,197,3,0.10)",
          border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px",
        }}>
          📅 {en ? "Today" : "Aujourd'hui"} · {new Date().toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </div>
      )}
    </div>
  );
}

// Inclusive local-day range test for a row timestamp (created_at / verified_at /
// resolved_at). `from`/`to` are yyyy-mm-dd; compares on the row's LOCAL calendar day.
export function inRange(iso, from, to) {
  if (!iso) return false;
  const day = toIso(new Date(iso));
  return day >= from && day <= to;
}
