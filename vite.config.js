import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir:     "src",
      filename:   "sw.js",
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
      }
    })
  ],
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
});
