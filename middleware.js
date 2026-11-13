// STAGING PROBE (2026-11-13) — Vercel Routing Middleware for /api on STAGING hosts only.
//
// WHY: the vercel.json external rewrite lets a caller-sent x-vercel-forwarded-for / x-forwarded-for
// through on about half of requests (measured 23/40), with or without our header-delete steps,
// so the API's per-address rate limits can be dodged through the proxy. Here the address is read
// at Vercel's edge (x-real-ip, what @vercel/functions ipAddress() reads), every caller-sent address
// header is removed, and the request is rewritten to the API with our own headers.
//
// Same protocol as @vercel/functions rewrite() (x-middleware-rewrite + override-headers), written
// out so no dependency is added. Prod hosts (book. / pos.) are NOT handled here: they return
// undefined and keep the vercel.json route exactly as today.
export const config = { matcher: "/api/:path*" };

const STAGING_API = "https://partenaire-account-server-staging.onrender.com";
const DROP = ["host", "x-forwarded-for", "x-vercel-forwarded-for", "x-real-ip", "forwarded",
  "x-forwarded-host", "x-stenamo-proxy"];   // TEETH: caller's x-stenamo-client-ip kept

export default function middleware(request) {
  const url = new URL(request.url);
  const h = url.hostname;
  if (!(h === "staging.stenamo.com" || /\.vercel\.app$/.test(h))) return undefined;

  const ip = request.headers.get("x-real-ip") || "";
  const out = new Headers(request.headers);
  for (const k of DROP) out.delete(k);
  if (!out.has("x-stenamo-client-ip")) out.set("x-stenamo-client-ip", ip);   // TEETH: caller wins
  out.set("x-vercel-forwarded-for", ip);
  out.set("x-real-ip", ip);   // PROBE: does a non-XFF header set here reach the API unforged?
  out.set("x-stenamo-proxy", process.env.STENAMO_PROXY_SECRET || "");

  // Marker on the RESPONSE so a caller can see the middleware ran (no address in it).
  const res = new Headers({ "x-middleware-rewrite": STAGING_API + url.pathname + url.search, "x-stenamo-mw": "1" });
  const keys = [];
  for (const [k, v] of out) { res.set("x-middleware-request-" + k, v); keys.push(k); }
  res.set("x-middleware-override-headers", keys.join(","));
  return new Response(null, { headers: res });
}
