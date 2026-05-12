# Mon Partenaire — APK Build Guide

## Option A: Capacitor (Recommended for full native features)

### Prerequisites
- Node.js 18+, Android Studio, Java 17+

### Steps

```bash
# 1. Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Initialize Capacitor
npx cap init "Mon Partenaire" "com.monpartenaire.app" --web-dir dist

# 3. Build the Vite app
npm run build

# 4. Add Android platform
npx cap add android

# 5. Sync
npx cap sync android

# 6. Open in Android Studio to build APK
npx cap open android
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

### Update after code changes
```bash
npm run build && npx cap sync android
```

---

## Option B: TWA (Trusted Web Activity) — Lighter, no native code

TWA wraps the hosted URL as an Android app. Requires the site to be deployed with HTTPS and a valid `/.well-known/assetlinks.json`.

### Steps

```bash
# Install bubblewrap (Google's TWA tool)
npm install -g @bubblewrap/cli

# Init — uses your deployed URL
bubblewrap init --manifest https://your-deployed-url.vercel.app/manifest.json

# Build APK
bubblewrap build
```

### Add assetlinks.json (required for TWA address bar to disappear)
Get your SHA-256 signing fingerprint from the generated keystore, then add:

**`public/.well-known/assetlinks.json`**
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.monpartenaire.app",
    "sha256_cert_fingerprints": ["YOUR_FINGERPRINT_HERE"]
  }
}]
```

Serve this file statically at `https://your-domain/.well-known/assetlinks.json`.

---

## Recommended: Capacitor for Mon Partenaire

Use Capacitor because:
- Camera barcode scanning works better with native WebView
- Push notifications can be added later via `@capacitor/push-notifications`
- Offline SQLite storage available via `@capacitor-community/sqlite`

## Deploy target

The `start_url` in `manifest.json` should point to the production Vercel URL once deployed.
Current: `https://partenaire-account-frontend.vercel.app` (update in manifest.json)
