import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: ["icon.svg"],
      manifest: {
        name:             "Mon Partenaire",
        short_name:       "Partenaire",
        description:      "POS & gestion de stock pour commerçants camerounais",
        theme_color:      "#1a1f2e",
        background_color: "#1a1f2e",
        display:          "standalone",
        orientation:      "portrait",
        start_url:        "/",
        scope:            "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      injectManifest: {
        // Only include app shell assets — not source maps
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // MP-ADMIN-PWA-V1: exclude admin shell assets so the MP service
        // worker doesn't precache them. The admin portal has its own
        // service worker (sw-admin.js) scoped to /admin.html; letting
        // MP's SW cache admin.html / sw-admin.js / admin-manifest.json
        // would create scope-overlap weirdness where the MP SW serves
        // a stale admin.html instead of letting the admin SW handle it.
        globIgnores: ["admin.html", "sw-admin.js", "admin-manifest.json"],
      }
    })
  ],
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
});
