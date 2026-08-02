// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 2
//
// Capacitor config for Mon Partenaire (POS) Android wrap.
//
// Bundle ID:   com.partenaire.monpartenaire  (Play Store target)
// Web bundle:  dist/  (vite build output — `npm run build` then
//                      `npx cap sync android` copies into android/app/
//                      src/main/assets/public/)
//
// Run order for a fresh device install (full steps in
// CAPACITOR_SETUP.md):
//   npm install                  # picks up the new @capacitor/* deps
//   npx cap add android          # scaffolds android/ once
//   npm run build                # vite build → dist/
//   npx cap sync android         # copies dist → android, refreshes plugins
//   npx cap open android         # opens Android Studio
//   (Android Studio) Build → Build APK(s) for debug, or Generate
//   Signed Bundle / APK with the release keystore for Play Console.

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:    'com.partenaire.monpartenaire',
  appName:  'Mon Partenaire Dozie',
  webDir:   'dist',

  // androidScheme:'https' lets the Android WebView treat
  // capacitor-served assets as a secure origin so cookies, service
  // workers, and the navigator.serviceWorker registration in the
  // existing PWA setup all keep working in the wrap.
  server: {
    androidScheme: 'https',
    // cleartext NOT enabled — production API is HTTPS (Render).
  },

  // Match the dark brand background so the WebView's first paint
  // doesn't flash white before the React shell mounts.
  backgroundColor: '#152B52',

  // ── FIELD DIAGNOSTICS — REVERT BOTH BEFORE THE NEXT PLAY UPLOAD ──────────────
  // 'production' forwards JS console output to logcat in RELEASE builds too;
  // the default 'debug' only does it for debug builds, which is why a release
  // APK produced no [push] lines at all over USB — the traces were being written
  // and thrown away. Debugging the push chain without this was guesswork with
  // extra steps.
  loggingBehavior: 'production',
  android: {
    // Enables chrome://inspect against the release WebView. Does NOT set
    // android:debuggable, so `run-as` and the app's private data stay closed.
    webContentsDebuggingEnabled: true,
  },
  // ─────────────────────────────────────────────────────────────────────────────

  plugins: {
    SplashScreen: {
      // Brand-colour splash held for 1.5s, then fades into the React
      // shell. launchAutoHide:false would let the React code dismiss
      // via SplashScreen.hide() — but we keep auto-hide to avoid a
      // dependency on JS-side mount ordering on cold start.
      launchShowDuration: 1500,
      launchAutoHide:     true,
      backgroundColor:    '#152B52',
      androidSplashResourceName: 'splash',
      androidScaleType:   'CENTER_CROP',
      showSpinner:        false,
    },
    StatusBar: {
      // Style:DARK = light icons on dark background. Matches the
      // bg-elevated colour used by the React shell so the system
      // status bar blends into the app chrome.
      style:           'DARK',
      backgroundColor: '#152B52',
      overlaysWebView: false,
    },
    Keyboard: {
      // 'native' resizes the WebView when the IME opens so the focused
      // POS input stays visible. 'body' / 'ionic' overshoot for our
      // non-Ionic layout.
      resize: 'native',
      style:  'DARK',
    },
  },
};

export default config;
