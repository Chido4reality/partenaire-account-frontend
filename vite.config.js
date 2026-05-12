import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
      workbox: {
        // Activate new SW immediately without waiting for all tabs to close
        skipWaiting: true,
        clientsClaim: true,
        // Load our custom offline-sales handler into the generated SW
        importScripts: ["/sw-offline-sales.js"],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // Only cache GET requests — POST to /api/sales is handled by
            // sw-offline-sales.js, never by NetworkFirst
            urlPattern: ({ request, url }) =>
              request.method === "GET" &&
              url.hostname === "partenaire-account-api.onrender.com",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 }
            }
          }
        ]
      }
    })
  ],
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
});
