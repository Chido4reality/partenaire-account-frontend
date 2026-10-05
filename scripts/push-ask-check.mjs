// PUSH ASK — the permission card protects Android's TWO dialogs (2026-10-05).
//
// Android shows the notification-permission dialog at most twice per install; the second
// refusal blocks it for good. The app used to open it bare at login. These guards drive the
// REAL utils/push.js, utils/pushAsk.js, utils/pushAskStore.js and the two card components,
// with only the native side faked: a scripted PushNotifications plugin (counts every
// requestPermissions call and the permission state it was made in) and an in-memory
// Preferences. It proves the JS decides correctly — NOT how a real phone or a real Android
// dialog behaves (that is read from the Capacitor source, never observed here).
//
//   G1  state mapping — each Capacitor answer → the honest state, the right card, the right words
//   G2  "Plus tard" opens NOTHING on Android, and does not count as a dialog
//   G3  the 3/7/14/30 ladder — hidden before the wait, shown after it
//   G4  nothing opens Android's dialog except a tap on yes (login, moments: zero requests)
//   G5  the Settings badge reads THIS phone, never the server's device count
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__push_ask.mjs");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");

const STUBS = {
  "./api": `export default {
      post: async (url, body) => { globalThis.__fp.posts.push({ url, body }); return { data: { success: true } }; },
      get: async () => ({ data: { data: {} } }), delete: async () => ({ data: { revoked: 0 } }) };`,
  "@capacitor/push-notifications": `
      const S = () => globalThis.__fp;
      export const PushNotifications = {
        createChannel: async () => {},
        checkPermissions: async () => ({ receive: S().receive }),
        requestPermissions: async () => {
          S().requests.push(S().receive);                 // the state the request was made IN
          if (S().receive !== "granted") S().receive = S().answer;
          return { receive: S().receive };
        },
        addListener: (ev, cb) => { S().listeners[ev] = cb; return { remove() {} }; },
        register: async () => { setTimeout(() => S().listeners.registration && S().listeners.registration({ value: "tok-" + "x".repeat(40) }), 5); },
      };`,
  "@capacitor/preferences": `
      export const Preferences = {
        get: async ({ key }) => ({ value: globalThis.__prefs.has(key) ? globalThis.__prefs.get(key) : null }),
        set: async ({ key, value }) => { globalThis.__prefs.set(key, value); },
      };`,
  "react-hot-toast": `const t = () => {}; t.success = t; t.error = t; t.dismiss = t; export default t;`,
  // vc114 in-repo NotificationSettings plugin, scripted: globalThis.__ns = { status, opened[] } or null (= no plugin).
  "@capacitor/core": `
      export const Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === "NotificationSettings" && !!globalThis.__ns };
      export const registerPlugin = () => ({
        getStatus: async () => globalThis.__ns.status,
        openSettings: async ({ target }) => { globalThis.__ns.opened.push(target); return { opened: target === "channel" ? "channel" : "app_notifications" }; },
      });`,
  "@capacitor/app": `export const App = { getInfo: async () => ({ build: globalThis.__build || "114", version: "2.4.0" }) };`,
};

await build({
  stdin: {
    contents: `
      export * as push from "./utils/push.js";
      export * as ask from "./utils/pushAsk.js";
      export * as store from "./utils/pushAskStore.js";
      export { PushAskCardView } from "./components/common/PushAskCard.jsx";
      export { PushAlertsCardView, deriveSettings } from "./components/common/PushAlertsCard.jsx";`,
    resolveDir: SRC, loader: "jsx", sourcefile: "push-ask-entry.jsx",
  },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic", platform: "node", logLevel: "silent",
  external: ["react", "react/jsx-runtime"],
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (STUBS[a.path] !== undefined ? { path: a.path, namespace: "stub" } : null));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
    },
  }],
});

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// French copy uses NON-BREAKING spaces before ? : » and after « (so "?" never sits alone on a
// line at 390px). Text assertions compare what a reader sees, so they normalise them;
// `raw` keeps them, for the check that they are there.
const raw = (C, p) => unescape(renderToString(React.createElement(C, p)));
const render = (C, p) => raw(C, p).replace(/ /g, " ");

// ── the fake phone ──────────────────────────────────────────────────────────────────────
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), clear: () => ls.clear() };
globalThis.window = { Capacitor: { isNativePlatform: () => true }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
const phone = (receive, answer = receive, prefs = {}, native = { enabled: true, channelExists: true, channelBlocked: false }) => {
  globalThis.__fp = { receive, answer, requests: [], posts: [], listeners: {} };
  globalThis.__ns = native ? { status: native, opened: [] } : null;
  globalThis.__prefs = new Map(Object.keys(prefs).length ? [["mp-push-ask-v1", JSON.stringify(prefs)]] : []);
  ls.clear();
};
const DAY = 24 * 3600 * 1000;

try {
  const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const { push, ask, store } = M;
  const yesterday = store.localDay(new Date(Date.now() - DAY));

  // ── G1 ────────────────────────────────────────────────────────────────────────────────
  console.log("G1  state mapping — Capacitor's answer → honest state → card → words");
  const C = ask.classify;
  check("granted → active", C("granted").state === "active");
  check("prompt (never asked) → not_asked", C("prompt", {}).state === "not_asked");
  check("prompt-with-rationale → refused_once", C("prompt-with-rationale").state === "refused_once");
  check("denied after ≥2 dialogs → blocked, not flagged as maybe", C("denied", { dialogsOpened: 2 }).state === "blocked" && !C("denied", { dialogsOpened: 2 }).maybeNotBlocked);
  check("denied after ≤1 dialog → blocked BUT maybeNotBlocked (Capacitor's swipe-away guess)", C("denied", { dialogsOpened: 1 }).maybeNotBlocked === true);
  check("prompt on a phone that was granted before → blocked/switchedOff (never blank)", C("prompt", { everGranted: true }).state === "blocked" && C("prompt", { everGranted: true }).switchedOff === true);
  check("unreadable (null) → unknown, never a confident state", C(null).state === "unknown");

  const cases = [
    ["prompt", "owner", "approvals", "owner"], ["prompt", "manager", "approvals", "manager"],
    ["prompt", "cashier", "request_sent", "staff_request"], ["prompt-with-rationale", "owner", "approvals", "refused_once"],
    ["denied", "owner", "approvals", "blocked"],
  ];
  for (const [receive, role, moment, variant] of cases) {
    phone(receive, receive, { firstSeenDay: yesterday }); ask.__resetSession();
    const d = await ask.evaluateMoment(moment, role);
    check(`real readPushPermission '${receive}' · ${role} · ${moment} → card '${variant}'`, d.show && d.variant === variant, JSON.stringify(d));
  }
  phone("granted"); ask.__resetSession();
  check("granted → NO card at any moment", !(await ask.evaluateMoment("approvals", "owner")).show);
  phone("prompt"); ask.__resetSession();
  check("cashier opening approvals is not a cashier moment → no card", !(await ask.evaluateMoment("approvals", "cashier")).show);
  check("owner is never shown the 'request sent' card", !ask.decideAsk({ moment: "request_sent", role: "owner", receive: "prompt", store: {} }).show);
  check("day-2 fallback: owner on day 1 → no card", !ask.decideAsk({ moment: "dashboard_day2", role: "owner", receive: "prompt", store: { firstSeenDay: store.localDay() } }).show);
  check("day-2 fallback: owner on a later day → owner card", ask.decideAsk({ moment: "dashboard_day2", role: "owner", receive: "prompt", store: { firstSeenDay: yesterday } }).variant === "owner");
  check("day-2 fallback: never in the session that recorded day 1", !ask.decideAsk({ moment: "dashboard_day2", role: "owner", receive: "prompt", store: { firstSeenDay: yesterday }, firstSessionToday: true }).show);
  phone("prompt", "prompt", { firstSeenDay: yesterday }); ask.__resetSession();
  await ask.evaluateMoment("approvals", "owner");
  check("at most ONE card per app session", !(await ask.evaluateMoment("bell_request", "owner")).show);

  const owner = render(M.PushAskCardView, { variant: "owner", lang: "fr", hasDigest: false });
  check("owner card (FR) carries the 'appuyez sur « Autoriser »' line", owner.includes("Android va vous demander l'autorisation : appuyez sur « Autoriser »."));
  check("owner card offers 'Oui, me prévenir' and 'Plus tard'", owner.includes("Oui, me prévenir") && owner.includes("Plus tard"));
  check("owner card without accountant_log does NOT promise the evening summary", !owner.includes("résumé de la journée"));
  check("owner card on Pro+ promises it", render(M.PushAskCardView, { variant: "owner", lang: "fr", hasDigest: true }).includes("Et le soir, le résumé de la journée."));
  check("refused-once card says plainly there is ONE dialog left", render(M.PushAskCardView, { variant: "refused_once", lang: "fr" }).includes("qu'une seule fois encore"));
  const blockedFr = render(M.PushAskCardView, { variant: "blocked", lang: "fr", maybeNotBlocked: false });
  check("blocked card: the steps name 'Stenamo Book', and offer Vérifier + Réessayer", blockedFr.includes("Stenamo Book") && blockedFr.includes("J'ai activé — vérifier") && blockedFr.includes("Réessayer"));
  check("blocked card: 'Android may still ask' only when maybeNotBlocked", !blockedFr.includes("Il se peut") && render(M.PushAskCardView, { variant: "blocked", lang: "fr", maybeNotBlocked: true }).includes("Il se peut qu'Android vous redemande"));
  const staffRaw = raw(M.PushAskCardView, { variant: "staff_request", lang: "fr" });
  check("French punctuation is held by non-breaking spaces (« Autoriser », fermée ?)",
    staffRaw.includes("« Autoriser »") && staffRaw.includes("fermée ?"));
  check("English owner card reads English", render(M.PushAskCardView, { variant: "owner", lang: "en" }).includes("Android will ask for permission next: tap “Allow”."));
  const swipe = render(M.PushAlertsCardView, { lang: "fr", badge: "not_asked" });
  check("Settings after a swipe-away: 'PAS ENCORE DEMANDÉ', and never the word 'refusé'", swipe.includes("PAS ENCORE DEMANDÉ") && !/refus/i.test(swipe), swipe.match(/data-push-badge[^>]*>([^<]*)/)?.[1]);

  // ── G2 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG2  'Plus tard' opens nothing on Android");
  phone("prompt", "prompt", { firstSeenDay: yesterday }); ask.__resetSession();
  const shown = await ask.evaluateMoment("approvals", "owner");
  await ask.putOff();
  const s2 = await store.readAsk();
  check("card shown, then 'Plus tard' → requestPermissions called 0 times", shown.show && globalThis.__fp.requests.length === 0, `requests=${JSON.stringify(globalThis.__fp.requests)}`);
  check("…and it is not counted as a dialog (dialogsOpened stays 0)", s2.dialogsOpened === 0, `dialogsOpened=${s2.dialogsOpened}`);
  phone("prompt", "granted");
  const out = await ask.sayYes();
  check("'Oui, me prévenir' → exactly ONE requestPermissions, counted as one dialog", globalThis.__fp.requests.length === 1 && (await store.readAsk()).dialogsOpened === 1 && out === "granted", `requests=${globalThis.__fp.requests.length} out=${out}`);
  check("…and the token reached the server", globalThis.__fp.posts.some((p) => p.url === "/devices/token"));
  phone("prompt", "prompt-with-rationale");
  await ask.sayYes();
  check("a refusal in the dialog climbs the ladder (next ask waits 3 days)", (await store.readAsk()).nextAt > Date.now() + 2.9 * DAY);

  // ── G3 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG3  the 3 / 7 / 14 / 30 ladder");
  phone("prompt", "prompt", { firstSeenDay: yesterday });
  let t = Date.now();
  for (const [n, days] of [[1, 3], [2, 7], [3, 14], [4, 30], [5, 30]]) {
    const st = await ask.putOff(t);
    const at = (dt) => ask.decideAsk({ moment: "approvals", role: "owner", receive: "prompt", store: st, now: t + dt }).show;
    check(`put-off #${n}: hidden at ${days}d − 1 min, shown at ${days}d + 1 min`, !at(days * DAY - 60e3) && at(days * DAY + 60e3), `nextAt−t=${((st.nextAt - t) / DAY).toFixed(2)}d`);
    t = st.nextAt + 60e3;
  }
  check("the ladder lives in Preferences, so a logout's localStorage.clear() leaves it", (localStorage.clear(), (await store.readAsk()).dismissals === 5));

  // ── G4 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG4  nothing opens Android's dialog except a tap on yes");
  for (const r of ["prompt", "prompt-with-rationale", "denied"]) {
    phone(r, "granted");
    const o = await push.ensureRegisteredOnLogin();
    check(`login with permission '${r}' → 0 requestPermissions, outcome not_granted`, globalThis.__fp.requests.length === 0 && o === "not_granted", `requests=${JSON.stringify(globalThis.__fp.requests)} out=${o}`);
  }
  phone("granted");
  const og = await push.ensureRegisteredOnLogin();
  check("login with permission already granted → registers silently, never asked in a non-granted state",
    og === "granted" && globalThis.__fp.requests.every((s) => s === "granted"), `out=${og} requests=${JSON.stringify(globalThis.__fp.requests)}`);
  phone("prompt", "granted", { firstSeenDay: yesterday }); ask.__resetSession();
  for (const m of ["approvals", "bell_request", "dashboard_day2"]) await ask.evaluateMoment(m, "owner");
  await ask.recheck();
  check("raising every moment + 'vérifier' → 0 requestPermissions", globalThis.__fp.requests.length === 0, JSON.stringify(globalThis.__fp.requests));
  phone("denied", "granted", { dialogsOpened: 1 });
  const od = await ask.sayYes();
  check("a TAP on 'Réessayer' reaches Android even when Capacitor says 'denied' (its guess, not a fact)", globalThis.__fp.requests.length === 1 && od === "granted", `requests=${globalThis.__fp.requests.length} out=${od}`);

  // ── G5 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG5  the Settings badge reads THIS phone");
  const server3 = { push_configured: true, my_live_devices: 3 };
  const a = M.deriveSettings({ receive: "denied", store: { dialogsOpened: 2 }, storedToken: null, status: server3 });
  check("phone 'denied' while the server says 3 live devices → BLOQUÉ, not ON", a.badge === "blocked", a.badge);
  const b = M.deriveSettings({ receive: "granted", store: {}, storedToken: null, status: server3 });
  check("granted but this phone never stored a token, server says 3 → NON ENREGISTRÉ, not ON", b.badge === "unregistered", b.badge);
  const c = M.deriveSettings({ receive: "granted", store: {}, storedToken: "tok", status: { push_configured: true, my_live_devices: 0 } });
  check("granted + this phone's token, server count 0 → ACTIVÉ (the count is not consulted)", c.badge === "active", c.badge);
  const html = render(M.PushAlertsCardView, { lang: "fr", badge: a.badge });
  check("…and the card renders 'BLOQUÉ' with the steps", html.includes("BLOQUÉ") && html.includes("Stenamo Book"));

  // ── G6 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG6  vc114 'app_update' moment — the first start of a new build, for people already signed in");
  phone("prompt");
  check("first start of build 114, started signed in → 'app_update'", (await ask.noteAppStart({ build: "114", startedSignedIn: true })) === "app_update");
  check("second start of the same build → nothing (once per build per phone)", (await ask.noteAppStart({ build: "114", startedSignedIn: true })) === null);
  check("…and the next build asks again", (await ask.noteAppStart({ build: "115", startedSignedIn: true })) === "app_update");
  phone("prompt");
  check("first start that began signed OUT (new signup) → nothing…", (await ask.noteAppStart({ build: "114", startedSignedIn: false })) === null);
  check("…and the build is consumed: a later signed-in start of 114 does not ask either", (await ask.noteAppStart({ build: "114", startedSignedIn: true })) === null);
  check("build unreadable → nothing", (await ask.noteAppStart({ build: null, startedSignedIn: true })) === null);
  const up = (role, receive = "prompt", store = {}) => ask.decideAsk({ moment: "app_update", role, receive, store });
  check("app_update: owner → owner card, manager → manager card", up("owner").variant === "owner" && up("manager").variant === "manager");
  check("app_update: cashier and warehouse → the 'staff' card (not 'Demande envoyée')", up("cashier").variant === "staff" && up("warehouse").variant === "staff");
  check("app_update: already granted → no card", !up("cashier", "granted").show);
  check("app_update: blocked phone → the guidance card", up("owner", "denied", { dialogsOpened: 2 }).variant === "blocked");
  check("app_update still respects the ladder ('Plus tard' is not bypassed)", !ask.decideAsk({ moment: "app_update", role: "owner", receive: "prompt", store: { nextAt: Date.now() + DAY } }).show);
  phone("prompt", "prompt", { firstSeenDay: yesterday }); ask.__resetSession();
  await ask.evaluateMoment("app_update", "cashier");
  check("raising app_update opens NOTHING on Android (our card first)", globalThis.__fp.requests.length === 0);
  const staffCard = render(M.PushAskCardView, { variant: "staff", lang: "fr" });
  check("staff card (FR) carries the 'appuyez sur « Autoriser »' line and Plus tard", staffCard.includes("appuyez sur « Autoriser »") && staffCard.includes("Plus tard"));

  // ── G7 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG7  vc114 native state — 'granted' is corrected by the phone's real switch");
  const E = ask.effectiveReceive;
  check("granted + app notifications OFF → 'off'", E("granted", { enabled: false, channelBlocked: false }) === "off");
  check("granted + only the mp_alerts channel set to NONE → 'off'", E("granted", { enabled: true, channelBlocked: true }) === "off");
  check("granted + all on → granted", E("granted", { enabled: true, channelBlocked: false }) === "granted");
  check("no plugin (null) → Capacitor's answer unchanged", E("granted", null) === "granted" && E("prompt", null) === "prompt");
  check("'off' classifies as blocked, osOff", C("off").state === "blocked" && C("off").osOff === true);
  phone("granted", "granted", { firstSeenDay: yesterday }, { enabled: false, channelExists: true, channelBlocked: false }); ask.__resetSession();
  const offD = await ask.evaluateMoment("approvals", "owner");
  check("real evaluateMoment: Android 12-style 'granted' but switched off → blocked card, osOff", offD.show && offD.variant === "blocked" && offD.osOff === true, JSON.stringify(offD));
  phone("granted", "granted", {}, { enabled: true, channelExists: true, channelBlocked: true });
  const chOut = await ask.sayYes();
  check("'Oui' with the mp_alerts channel off → 'os_off', never a false 'Alertes activées'", chOut === "os_off", chOut);
  phone("granted", "granted", {}, { enabled: false, channelExists: true, channelBlocked: false });
  check("Settings badge: granted + phone switch off → BLOQUÉ", M.deriveSettings({ receive: (await ask.readPhoneState()).receive, store: {}, storedToken: "tok", status: server3 }).badge === "blocked");
  const osCard = render(M.PushAskCardView, { variant: "blocked", lang: "fr", osOff: true, canOpenSettings: true });
  check("blocked card with the plugin → 'Ouvrir les réglages'; osOff → no pointless 'Réessayer'", osCard.includes("Ouvrir les réglages") && !osCard.includes("Réessayer"));
  check("blocked card WITHOUT the plugin → no 'Ouvrir les réglages', written steps only", !render(M.PushAskCardView, { variant: "blocked", lang: "fr" }).includes("Ouvrir les réglages"));
  check("channel off → the card names the « Alertes / Alerts » category", render(M.PushAskCardView, { variant: "blocked", lang: "fr", osOff: true, channelBlocked: true }).includes("catégorie « Alertes / Alerts »"));

  // ── G8 ────────────────────────────────────────────────────────────────────────────────
  console.log("\nG8  vc114 native wiring (static — the files the APK is built from)");
  const { readFileSync } = await import("node:fs");
  const A = (p) => readFileSync(resolve(HERE, "../android/app/src/main", p), "utf8");
  const man = A("AndroidManifest.xml");
  check("manifest points fullBackupContent and dataExtractionRules at our rules", man.includes('android:fullBackupContent="@xml/backup_rules"') && man.includes('android:dataExtractionRules="@xml/data_extraction_rules"'));
  const ex = (x) => [...x.matchAll(/<exclude domain="([^"]+)" path="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  const old = ex(A("res/xml/backup_rules.xml")), dx = A("res/xml/data_extraction_rules.xml");
  const cloud = ex(dx.split("<device-transfer>")[0]), xfer = ex(dx.split("<device-transfer>")[1] || "");
  const need = ["sharedpref:PluginPermStates.xml", "sharedpref:CapacitorStorage.xml", "root:app_webview/"];
  check("backup rules (≤11), cloud backup and device transfer (12+) all exclude the three, identically",
    [old, cloud, xfer].every((l) => need.every((n) => l.includes(n)) && l.length === need.length), JSON.stringify({ old, cloud, xfer }));
  const java = A("java/com/partenaire/monpartenaire/NotificationSettingsPlugin.java");
  check("plugin is registered in MainActivity", A("java/com/partenaire/monpartenaire/MainActivity.java").includes("registerPlugin(NotificationSettingsPlugin.class)"));
  check("plugin name matches the JS side (NotificationSettings) and checks channel mp_alerts",
    java.includes('@CapacitorPlugin(name = "NotificationSettings")') && java.includes('"mp_alerts"') &&
    readFileSync(resolve(SRC, "utils/notifSettings.js"), "utf8").includes('registerPlugin("NotificationSettings")'));
  check("mp_alerts is the same channel id push.js creates", readFileSync(resolve(SRC, "utils/push.js"), "utf8").includes('id: "mp_alerts"'));
} catch (e) {
  console.error("!! rig error:", e.stack || e.message); fails++;
} finally {
  try { rmSync(OUT, { force: true }); } catch { /* noop */ }
}
console.log(fails ? `\n  ${fails} FAILED\n` : "\n  all passed\n");
process.exit(fails ? 1 : 0);
