// SHIFT OPEN TOO LONG (Peter 2026-11-21). A shift left open since an earlier night should be closed. Shown on the bar floor and the Cash
// 2026-11-28 (Peter): the "Sales here count on the day this shift opened" line is GONE — bar sales now take the POS
// date (the bill is paid through New Sale), so that sentence was wrong. Only "Shift open since <date> — close it ›".
// screen (bar branches) when the CURRENT shift has been open more than 24 h. A warning only — nothing is blocked.
// Reads the shared ["current-shift", locId] answer (opened_at); renders nothing otherwise.
export const SHIFT_TOO_OLD_MS = 24 * 3600 * 1000;

export function shiftAgeText(lang, openedAt) {
  const d = new Date(openedAt);
  const day = d.toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short" }).replace(/\.$/, "");
  return lang === "en" ? `Shift open since ${day} — close it` : `Shift ouvert depuis le ${day} — fermez-le`;
}

// CLICKABLE (Peter 2026-11-23): with onOpen, tapping the warning opens Close shift for THIS branch's shift.
export default function ShiftAgeWarning({ lang, shift, now = Date.now(), onOpen }) {
  const openedAt = shift && shift.shift_id && shift.opened_at;
  if (!openedAt) return null;
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t) || now - t <= SHIFT_TOO_OLD_MS) return null;
  const tap = typeof onOpen === "function";
  return (
    <div role="alert" className="bar-msg shift-age-warning"
      {...(tap ? { tabIndex: 0, "aria-label": `${shiftAgeText(lang, openedAt)} — ${lang === "en" ? "tap to close the shift" : "touchez pour fermer le shift"}`,
        onClick: onOpen, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } } : {})}
      style={{ border: "1px solid #f59e0b", borderRadius: 10, padding: "8px 12px", color: "#fbbf24",
        background: "rgba(245,158,11,.10)", fontWeight: 700, fontSize: 14, cursor: tap ? "pointer" : undefined }}>
      ⚠ {shiftAgeText(lang, openedAt)}{tap && <span aria-hidden="true"> ›</span>}
    </div>
  );
}
