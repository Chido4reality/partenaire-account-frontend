// MP-REPORT-TZ — boss-facing report times must render in the SHOP's timezone, not the
// viewer's device zone. A Cameroon shop's shift stored 09:25Z was printing "11:25" on a
// Stockholm (CEST, +2) machine. Mirrors backend/src/lib/orgTime.js: both live markets
// (Cameroun, Nigeria) are WAT / UTC+1 year-round with NO daylight saving, so a fixed WAT
// zone is exact. If a market with a different offset is ever added, change it HERE and in
// orgTime.js together (there is no per-org timezone column today).
export const SHOP_TZ = "Africa/Lagos"; // WAT, UTC+1, no DST (same instant as Africa/Douala)
