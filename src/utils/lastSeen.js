// MP-LAST-SEEN — honest "last seen" presence for the boss.
//
// pa_users.last_seen_at is bumped by the server heartbeat, THROTTLED to 5 min
// (raised deliberately to cut DB IO). So this is presence, NOT live realtime:
// treat "recently active" as seen within ~10 min, and the copy says
// "Active X ago" — never "Online now".
export const ONLINE_WINDOW_MS = 10 * 60 * 1000;

// Fallback client-side recency check. The server also returns an authoritative
// `online` flag (computed on the server clock); prefer that when present and use
// this only as a fallback.
export function isRecentlyActive(iso, nowMs = Date.now()) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && (nowMs - t) < ONLINE_WINDOW_MS;
}

// Relative "last seen" label. Returns "never"/"jamais" for a null timestamp.
export function formatLastSeen(iso, en) {
  if (!iso) return en ? "never" : "jamais";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return en ? "just now" : "à l'instant";
  if (mins < 60) return en ? `${mins} min ago` : `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return en ? `${hrs}h ago` : `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return en ? "yesterday" : "hier";
  if (days < 7) return en ? `${days} days ago` : `il y a ${days} j`;
  return new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR");
}
