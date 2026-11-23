// SHIFT OPEN TOO LONG (Peter 2026-11-21). A bar sale is dated on its shift's OPENING day (locked rule), so a
// shift left open since an earlier night puts tonight's sales on that night. Shown on the bar floor and the Cash
// screen (bar branches) when the CURRENT shift has been open more than 24 h. A warning only — nothing is blocked.
// Reads the shared ["current-shift", locId] answer (opened_at); renders nothing otherwise.
export const SHIFT_TOO_OLD_MS = 24 * 3600 * 1000;

export function shiftAgeText(lang, openedAt) {
  const d = new Date(openedAt);
  const day = d.toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short" }).replace(/\.$/, "");
  return lang === "en" ? `Shift open since ${day} — close it` : `Shift ouvert depuis le ${day} — fermez-le`;
}

export default function ShiftAgeWarning({ lang, shift, now = Date.now() }) {
  const openedAt = shift && shift.shift_id && shift.opened_at;
  if (!openedAt) return null;
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t) || now - t <= SHIFT_TOO_OLD_MS) return null;
  return (
    <div role="alert" className="bar-msg shift-age-warning"
      style={{ border: "1px solid #f59e0b", borderRadius: 10, padding: "8px 12px", color: "#fbbf24",
        background: "rgba(245,158,11,.10)", fontWeight: 700, fontSize: 14 }}>
      ⚠ {shiftAgeText(lang, openedAt)}
      <div style={{ fontWeight: 500, fontSize: 12, opacity: 0.85, marginTop: 2 }}>
        {lang === "en" ? "Sales here count on the day this shift opened until it is closed."
          : "Les ventes d'ici comptent sur le jour d'ouverture de ce shift tant qu'il n'est pas fermé."}
      </div>
    </div>
  );
}
