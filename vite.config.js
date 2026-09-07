import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Opt-in staging rig target. UNSET in normal use — see the `preview` block below.
// Kept as a module-level const so both `server` and `preview` read one value.
const RIG_TARGET = process.env.VITE_RIG_TARGET || null;

// MP-PHASE-2-LEVEL-1-PWA: a SAFE service worker (Level-1 shell precache)
// so the app opens with ZERO network — Paul currently can't launch MP
// offline at all, which makes the Phase 1A/1B offline-write fixes moot
// until the shell loads.
//
// This is deliberately NOT the SW retired in Slice 3. That one ran in
// injectManifest mode with a hand-written fetch handler that intercepted
// POST /api/sales and wrote pending sales into POS_OfflineDB — fighting
// the axios offlineAwareAdapter and colliding with Dexie on that IDB
// name. generateSW mode structurally prevents BOTH failure modes:
//   • There is no custom fetch handler to write, so nothing can grab a
//     write. Workbox ignores non-GET requests entirely.
//   • /api/* is NetworkOnly (pass-through) — the SW never caches an API
//     request or response; axios + Slice-3 own the offline-write path.
//   • The SW uses ONLY the Cache API — it never opens any IndexedDB, so
//     it cannot collide with Slice-3's Dexie/SQLite regardless of init
//     order.
// The admin portal keeps its own SW (public/sw-admin.js, scoped to
// /admin.html); navigateFallbackDenylist + globIgnores keep this SW off
// /admin and /api.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",   // skipWaiting + clients.claim → fresh shell next load
      injectRegister: false,        // registration is manual + platform-gated in main.jsx (native skips the SW to avoid stale-install)
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        // MP-BLANK-SCREEN-FIX: the main bundle is ~2.4 MB and Workbox's DEFAULT limit is
        // 2 MiB, so it was being SILENTLY DROPPED from the precache manifest (every build
        // logged "won't be precached" and it was missed). That left the SW holding
        // index.html but NOT the JS that shell points at — the shell/bundle skew behind
        // the blank screen. Precaching both puts them in ONE Workbox revision, and a
        // precache install is atomic: the new SW takes the whole manifest or none of it,
        // so the cached shell can never reference a bundle the SW doesn't hold.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // A new SW must take over the CURRENT page, not the one after. registerType
        // 'autoUpdate' sets skipWaiting, but clientsClaim was absent from the built
        // sw.js — so an activated SW sat idle for one more load.
        clientsClaim: true,
        // Never precache the admin portal's standalone shell/assets — it
        // has its own SW; precaching it here would make the two fight.
        globIgnores: ["**/admin.html", "**/admin-manifest.json", "**/sw-admin.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/admin/, /^\/privacy/, /^\/suppression-compte/],
        runtimeCaching: [
          {
            // API is NEVER cached — pass straight to network so the axios
            // adapter + pendingSync handle offline writes and the app's
            // own caches handle reads. SW must not see writes at all.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "Stenamo Business",
        // short_name is the HOME-SCREEN ICON LABEL, not an abbreviation of the
        // brand. Android truncates around 12-13 characters, so "Stenamo Business"
        // would render as "Stenamo Busi…". "Stenamo" fits, and is what people
        // actually say. The same string is used for the Android launcher label
        // (android app_name) for the same reason — the full name lives in `name`
        // above and in the Play listing.
        short_name: "Stenamo",
        description: "POS & gestion de stock pour commerçants",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#152B52",
        theme_color: "#152B52",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
    }),
  ],
  // ── LOCAL DEV PROXY ─────────────────────────────────────────────────────────
  // Defaults to a local backend. Point it elsewhere with VITE_RIG_TARGET (below)
  // instead of editing this file.
  server: {
    proxy: { "/api": { target: RIG_TARGET || "http://localhost:3001", changeOrigin: true } },
  },

  // ── STAGING PREVIEW RIG — opt-in, via env, never by editing this file ────────
  // Previously this block lived here as an uncommitted local edit marked
  // "DO NOT COMMIT". It survived several commits only because someone noticed it
  // in `git diff --cached` each time — i.e. it was kept safe BY CONVENTION, which
  // is the same failure mode as a dedupe key that two writers had to agree about.
  // Gating it on an env var makes it structural: there is nothing uncommitted, so
  // there is nothing to slip in.
  //
  // ⚠️ SAFE BY CONSTRUCTION, NOT BY CARE. `server` and `preview` are dev-only Vite
  // keys — neither is read by `vite build`, so this cannot reach a production
  // bundle even with the variable set. (Verified: builds with and without the rig
  // present produced an identical bundle hash, index-w07beJTF.js.)
  //
  //   VITE_RIG_TARGET=https://partenaire-account-server-staging.onrender.com   //     npm run build -- --mode rig && npm run preview
  //
  // --mode rig loads .env.rig, which sets VITE_API_URL empty so api.js falls back
  // to a relative "/api" and every request is SAME-ORIGIN. That sidesteps CORS:
  // the staging backend's allowlist is hardcoded and cannot contain a DHCP LAN IP
  // or a random tunnel hostname, and an unlisted origin is rejected with a 500.
  ...(RIG_TARGET ? {
    preview: {
      proxy: {
        "/api": {
          target: RIG_TARGET,
          // NOTE: changeOrigin rewrites the HOST header only. It does NOT touch
          // Origin — which is the whole bug this hook exists to fix.
          changeOrigin: true,
          configure: (proxy) => {
            // The browser sends `Origin` on a SAME-ORIGIN POST (it only omits it
            // for same-origin GET/HEAD). The proxy forwarded that Origin —
            // http://192.168.0.40:4173 — straight to staging, whose allowlist is
            // hardcoded and rejects it with a 500. The page could still READ that
            // response because, to the browser, it was same-origin all along.
            //
            // Stripping the header makes the backend treat it as a no-origin
            // (server-to-server) call, which its CORS check permits. Nothing about
            // the app changes; this is the rig being honest about what it is.
            //
            // Every curl test passed because curl sends no Origin. A passing curl
            // is NOT proof a browser will pass.
            proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
          },
        },
      },
      // Quick tunnels hand out a random hostname; accept whatever it is.
      allowedHosts: true,
    },
  } : {}),
});
