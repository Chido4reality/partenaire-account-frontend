// ORANGE PROXY — Vercel Routing Middleware for /api/* (2026-11-13).
//
// WHY: Orange Cameroun resets connections to the Render-hosted API names; the Vercel sites load.
// So /api/* on the web sites is forwarded to the API from here. The API rate-limits per caller
// address, so it must learn the caller's REAL address — and Vercel's own forwarding headers cannot
// carry it: measured 2026-11-13, a caller's own x-vercel-forwarded-for / x-forwarded-for reached the
// API on ~half of requests through a vercel.json rewrite (with or without deleting them, 25/40 and
// 23/40) and even when this middleware overrode them (44/80). Vercel re-derives those two headers
// from the original request on the way out.
//
// THE RULE (scripts/proxy-middleware-check.mjs holds each line):
//   • the address is read HERE, at Vercel's edge (x-real-ip as Vercel sets it for middleware — what
//     @vercel/functions ipAddress() reads); a caller-sent x-real-ip does not survive to this point
//     (80/80 on staging with every address header forged);
//   • every address header the caller sent is removed, including any x-stenamo-client-ip;
//   • the API gets x-stenamo-client-ip (a name Vercel does not manage) and the proxy secret
//     (Vercel env STENAMO_PROXY_SECRET); the API believes the address only when the secret matches;
//   • book.stenamo.com / pos.partenairedozie.com → the prod API; staging.stenamo.com and *.vercel.app
//     previews → the staging API (same split as before); any other host is not handled (404).
//
// LIMITS: a request body over ~4.5 MB is refused by Vercel here (6 MB → 413 measured; 4.2 MB passed),
// which is why every photo is compressed (utils/photoCompress.js). Every /api request is one
// middleware invocation (Vercel usage).
//
// Same protocol as @vercel/functions rewrite() (x-middleware-rewrite + x-middleware-override-headers),
// written out so no dependency is added. vercel.json must stay in the "rewrites" form: with the legacy
// "routes" form this file is silently not run.
export const config = { matcher: "/api/:path*" };

export const PROD_API = "https://api.partenairedozie.com";
export const STAGING_API = "https://partenaire-account-server-staging.onrender.com";

// Removed from what the API receives: caller-supplied address headers, our own two (only we set
// them), and host (the destination sets its own).
export const DROP = ["host", "x-forwarded-for", "x-vercel-forwarded-for", "x-real-ip", "forwarded",
  "x-forwarded-host", "x-stenamo-proxy", "x-stenamo-client-ip"];

export function apiFor(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h === "book.stenamo.com" || h === "pos.partenairedozie.com") return PROD_API;
  if (h === "staging.stenamo.com" || /\.vercel\.app$/.test(h)) return STAGING_API;
  return null;
}

export default function middleware(request) {
  const url = new URL(request.url);
  const api = apiFor(url.hostname);
  if (!api) return undefined;

  const ip = request.headers.get("x-real-ip") || "";
  const out = new Headers(request.headers);
  for (const k of DROP) out.delete(k);
  out.set("x-stenamo-client-ip", ip);
  out.set("x-stenamo-proxy", process.env.STENAMO_PROXY_SECRET || "");

  // x-stenamo-mw on the RESPONSE: lets anyone see the middleware ran (it carries no address).
  const res = new Headers({ "x-middleware-rewrite": api + url.pathname + url.search, "x-stenamo-mw": "1" });
  const keys = [];
  for (const [k, v] of out) { res.set("x-middleware-request-" + k, v); keys.push(k); }
  res.set("x-middleware-override-headers", keys.join(","));
  return new Response(null, { headers: res });
}
