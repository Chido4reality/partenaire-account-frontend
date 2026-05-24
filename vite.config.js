import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MP-SLICE-3-RETIRE-LEGACY-SERVICE-WORKER: VitePWA + src/sw.js retired.
// Slice 3 (offlineAwareAdapter + pendingSync + localDb mirror) owns the
// offline-write path end-to-end. The legacy SW competed with the axios
// adapter (intercepting POST /api/sales before defaults.adapter ran) and
// its queue collided with Dexie on the shared 'POS_OfflineDB' IDB name.
// Admin portal still has its own SW (public/sw-admin.js, scoped to
// /admin.html); that one is registered from admin.html itself and is
// unaffected by removing this plugin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
});
