// MP-REPORT-TZ — boss-facing report times must render in the SHOP's timezone, not the
// viewer's device zone. A Cameroon shop's shift stored 09:25Z was printing "11:25" on a
// Stockholm (CEST, +2) machine. Mirrors backend/src/lib/orgTime.js: both live markets
// (Cameroun, Nigeria) are WAT / UTC+1 year-round with NO daylight saving, so a fixed WAT
// zone is exact. If a market with a different offset is ever added, change it HERE and in
// orgTime.js together (there is no per-org timezone column today).
export const SHOP_TZ = "Africa/Lagos"; // WAT, UTC+1, no DST (same instant as Africa/Douala)

// TRANSFER "Started 01:00" (Peter, 2026-10-16): pa_stock_transfers.transfer_date is a DATE
// ("2026-10-16"). new Date("2026-10-16") is UTC MIDNIGHT, which WAT prints as 01:00 — a time
// nobody started anything. A date-only value has no time: it is shown as a date, never as
// a time. A real instant (created_at, dispatched_at, …) is shown in shop time.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function fmtShopDateTime(v, en) {
  if (!v) return "—";
  try {
    if (DATE_ONLY.test(String(v))) return fmtShopDate(v, en);
    return new Date(v).toLocaleString(en ? "en-GB" : "fr-FR",
      { timeZone: SHOP_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function fmtShopDate(v, en) {
  if (!v) return "—";
  try {
    const s = String(v);
    // A bare date is a calendar day already — format it AS that day (noon UTC can never
    // cross a day boundary in WAT), not as an instant.
    const d = DATE_ONLY.test(s) ? new Date(s + "T12:00:00Z") : new Date(s);
    return d.toLocaleDateString(en ? "en-GB" : "fr-FR", { timeZone: SHOP_TZ, day: "numeric", month: "short", year: "numeric" });
  } catch { return "—"; }
}
