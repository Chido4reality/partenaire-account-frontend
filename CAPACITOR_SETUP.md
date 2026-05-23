# Mon Partenaire — Capacitor Android wrap setup

MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 2 shipped the Capacitor scaffold (config + plugins + connectivity bar). This file documents the local steps to build the Android APK — they need to run on Peter's machine (Android SDK + keystore live on the dev box, not in CI yet).

Dozie is deliberately not wrapped here: its current architecture is a static HTML page hosted by the backend and Electron-wrapped, not a Vite SPA. Wrapping it in Capacitor needs a separate conversation about whether to rebuild as an SPA or point `server.url` at the remote.

---

## Prerequisites (one time per dev machine)

1. Node 18+ already installed (you have this).
2. Android Studio installed: https://developer.android.com/studio
   - During setup, accept the SDK licences and let it download the default platform (Android 14 / API 34 is fine).
3. JDK 17 — usually bundled with Android Studio (`File → Project Structure → SDK Location → Gradle Settings → Gradle JDK`).
4. `ANDROID_HOME` env var pointing at the SDK location, e.g.
   `C:\Users\Admin\AppData\Local\Android\Sdk`
5. `platform-tools` (`adb`) on PATH for `npx cap run android`.

---

## First-time scaffold

```powershell
cd C:\Users\Admin\Desktop\partenaire_account\frontend

# 1. Install the new Capacitor deps (added in Slice 2).
npm install

# 2. Build the web bundle so cap has something to copy into android/.
npm run build

# 3. Scaffold the android/ folder once. After this it lives in git
#    and you don't re-run cap add.
npx cap add android

# 4. Sync the web build + plugin native bridges into android/.
npx cap sync android
```

At this point `android/` exists and is a normal Android Studio project.

---

## Day-to-day dev loop

```powershell
# Edit React code as usual, then:
npm run cap:sync           # vite build + cap sync android in one step
npm run cap:open:android   # opens Android Studio (or)
npm run cap:run:android    # builds + installs on the first connected device
```

`cap sync` is the step that copies `dist/` into `android/app/src/main/assets/public/`. If you forget it, the device runs whatever was last synced — not your latest edit.

---

## Debug APK (no signing — for sideload on personal devices)

In Android Studio:

1. Open the `android/` folder (`File → Open`).
2. Wait for Gradle sync to finish (status bar bottom-right).
3. `Build → Build Bundle(s) / APK(s) → Build APK(s)`.
4. Output lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
5. `adb install app-debug.apk` or transfer + open on the device.

The debug APK is NOT acceptable for the Play Store — it's signed with Android Studio's debug keystore which is local to your machine.

---

## Release keystore (one time)

You need a single signing key that you reuse for every Play Store upload. Losing this key locks you out of pushing updates — store the `.keystore` file + passwords in a password manager.

```powershell
# Generate once, anywhere. Recommend ~/.android/release-keys/mon-partenaire.keystore.
keytool -genkey -v -keystore mon-partenaire.keystore -alias mp_release -keyalg RSA -keysize 4096 -validity 10000
```

Answer the prompts. Set the keystore password + key password — **alphanumeric only** (matches the org rule for all passwords in this project).

Wire it into `android/app/build.gradle`:

```gradle
android {
  signingConfigs {
    release {
      storeFile file('/absolute/path/to/mon-partenaire.keystore')
      storePassword 'YOUR_STORE_PW'
      keyAlias      'mp_release'
      keyPassword   'YOUR_KEY_PW'
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
}
```

(Better long-term: read the passwords from a `keystore.properties` file gitignored at the repo root. Skip for first build, add when you start a CI pipeline.)

---

## Release build → Play Console internal track

1. In Android Studio: `Build → Generate Signed Bundle / APK → Android App Bundle (AAB)`.
2. Pick the release keystore.
3. Output lands at `android/app/release/app-release.aab`.
4. Play Console:
   - Create app (one time) — bundle ID `com.partenaire.monpartenaire`.
   - `Internal testing → Create new release → Upload .aab`.
   - Add internal testers by email (Peter + the Bonaberri/Akwa shop owners).
   - Roll out.

Internal track is the fastest path to a real-device install via Google Play.

---

## Versioning

`capacitor.config.ts` does NOT carry the Android version — that's in `android/app/build.gradle`:

```gradle
defaultConfig {
  versionCode 2      // bump by 1 every Play upload
  versionName "1.0.1"  // semver, match package.json when it makes sense
}
```

`versionCode` must strictly increase between Play uploads or the console rejects. `versionName` is what users see on the install page.

---

## Verifying Slice 2 (no APK needed)

These should all work right now via plain `npm run dev`:

1. `npm run dev` — web app loads on localhost. Connectivity bar at top shows `🟢 Online` (collapsed to a 4px stripe).
2. Open DevTools → Network → check `Offline`. Within ~1s the bar expands to red `🔴 Offline` / `🔴 Hors ligne`.
3. Uncheck `Offline`. Bar collapses back to the 4px stripe.

These should all work after the first APK install:

1. `npx cap add android` runs without error.
2. Android Studio opens the `android/` folder, Gradle sync finishes green.
3. Debug `.apk` installs on a real device, app loads, the splash holds for ~1.5s on the brand colour, then the React shell mounts with the connectivity bar visible.

---

## What this slice did NOT do (Slice 3 territory)

- No local SQLite mirror — read-side state still comes from the backend on every page load.
- No `pending_sync` write queue — POS writes still go straight to the backend; if the device is offline, they fail.
- No interceptor on the 6 write paths from Slice 1 (`/sales`, `/sales/:id/payment`, `/returns`, `/expenditures`, `/stock-transfers`, `/arrivals`) — `local_id` isn't stamped on the client yet.
- No background sync, no encrypted SQLite, no conflict resolution UI — all explicitly deferred.

The connectivity bar is wired to accept `pendingCount` + `syncing` props from Slice 3 when the queue lands; no refactor needed at that point.
