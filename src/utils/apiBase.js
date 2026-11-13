// ORANGE PROD STEP 3a (2026-11-13) — the ONE place the app decides which API address it calls.
//
// WHY: Orange Cameroun resets connections to the Render-hosted API names, while the Vercel sites
// load. vercel.json proxies "/api/*" on book.stenamo.com and pos.partenairedozie.com to the prod
// API and adds the proxy secret, so the server still sees each caller's own address (rate limits).
//
// THE RULE (each line is a red guard in scripts/api-base-check.mjs):
//   • The web app on book.stenamo.com or pos.partenairedozie.com → "/api" on that same site.
//     Same origin: no CORS, no preflight; the browser sends the same headers as before.
//   • Android (Capacitor) → the BUILT address, never "/api": the APK's page is https://localhost,
//     so "/api" would ask the APK's own files. The APK keeps .env.production
//     (https://api.partenairedozie.com/api) — this module does not change it.
//   • Any other host (staging, previews, local dev, the admin portal) → the BUILT address, as before.
//   • No automatic fallback to the direct address: the page itself is served by Vercel, and a
//     write that cannot get through goes to the offline queue exactly as before.
//
// Rollback = Promote the previous deployment; nothing here is stored on the device.

// Vite replaces this exact expression at build time; any other runtime gets the web default.
let BUILT = "/api";
try { BUILT = import.meta.env.VITE_API_URL || "/api"; } catch { /* non-Vite runtime (checks) */ }

export const SAME_SITE = "/api";
export const PROXY_HOSTS = ["book.stenamo.com", "pos.partenairedozie.com"];

export function chooseApiBase({ built, hostname, native }) {
  if (native) return built || SAME_SITE;
  const h = String(hostname || "").toLowerCase();
  return PROXY_HOSTS.includes(h) ? SAME_SITE : (built || SAME_SITE);
}

function detectNative() {
  try { return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
}
function detectHost() {
  try { return typeof location !== "undefined" ? location.hostname : ""; } catch { return ""; }
}

export const API_BASE = chooseApiBase({ built: BUILT, hostname: detectHost(), native: detectNative() });

// True only when this page calls the prod API through the Vercel proxy (a longer path).
export const VIA_SAME_SITE_PROXY = API_BASE === SAME_SITE && BUILT !== SAME_SITE;

// "/api/sales?x=1" → "/sales?x=1". Only a LEADING base is removed (String.replace removed the first
// "/api" anywhere, which "/api" as a base would make dangerous).
export function stripApiBase(url, base = API_BASE) {
  const u = String(url || "");
  return base && u.startsWith(base) ? u.slice(base.length) : u;
}
