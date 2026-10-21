// APP LOCK (2026-10-21) — the pure rules in src/utils/appLockCore.js, plus the wiring that keeps the lock an
// OUTER layer (it renders its children, draws the screen through a portal, never edits the logout code).
// Run: node scripts/app-lock-check.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, "..", p), "utf8");
const C = await import("data:text/javascript;base64," + Buffer.from(read("src/utils/appLockCore.js")).toString("base64"));

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); };
const START = "2026-11-08T07:00:00.000Z", T0 = Date.parse(START);
const P = (x = {}) => ({ ...C.DEFAULT_POLICY, active: true, starts_at: START, ...x });

console.log("armed: the lock applies to this session?");
check("no start date / not active → never", !C.armed({ ...C.DEFAULT_POLICY }, { native: true, sessionStartedAt: T0 + 1 }) && !C.armed(P({ active: false }), { native: true, sessionStartedAt: T0 + 1 }));
check("Android only: armed on the phone, not on the web", C.armed(P({ lock_web: false }), { native: true, sessionStartedAt: T0 + 1 }) && !C.armed(P({ lock_web: false }), { native: false, sessionStartedAt: T0 + 1 }));
check("Web only: the reverse", !C.armed(P({ lock_android: false }), { native: true, sessionStartedAt: T0 + 1 }) && C.armed(P({ lock_android: false }), { native: false, sessionStartedAt: T0 + 1 }));
check("a session opened BEFORE the start date is never locked (waits for the next cold start / login)", !C.armed(P(), { native: true, sessionStartedAt: T0 - 1000 }));
check("admin 'log in as' → never", !C.armed(P(), { native: true, sessionStartedAt: T0 + 1, impersonating: true }));

console.log("lockAtStart / lockAfterIdle");
const now = T0 + 3600e3;
check("cold start / new tab, record on the device → lock", C.lockAtStart({ isArmed: true, hasHash: true, online: false, lastUnlockAt: 0, now, minutes: 5 }));
check("just logged in or unlocked within X minutes (a web reload) → no lock", !C.lockAtStart({ isArmed: true, hasHash: true, online: true, lastUnlockAt: now - 60e3, now, minutes: 5 }));
check("no record on this device + offline → never locked (nobody stranded)", !C.lockAtStart({ isArmed: true, hasHash: false, online: false, lastUnlockAt: 0, now, minutes: 5 }));
check("no record + online → locked (the server can check)", C.lockAtStart({ isArmed: true, hasHash: false, online: true, lastUnlockAt: 0, now, minutes: 5 }));
check("idle 4:59 → no; 5:00 → lock", !C.lockAfterIdle({ isArmed: true, hasHash: true, online: true, idleMs: 299e3, minutes: 5 }) && C.lockAfterIdle({ isArmed: true, hasHash: true, online: true, idleMs: 300e3, minutes: 5 }));

console.log("afterWrong (5 wrong → sign out)");
const seq = [1, 2, 3, 4].map((n) => C.afterWrong({ deviceFails: n }));
check("offline: 4, 3, 2, 1 left, no logout", seq.map((x) => x.left).join() === "4,3,2,1" && seq.every((x) => !x.logout));
check("offline: the 5th → logout", C.afterWrong({ deviceFails: 5 }).logout === true);
check("online: the server's own count wins when lower, and its logout:true is obeyed", C.afterWrong({ deviceFails: 2, serverLeft: 1 }).left === 1 && C.afterWrong({ deviceFails: 1, serverLeft: 3, serverLogout: true }).logout);

console.log("PBKDF2 record (A3)");
const user = { id: "u-1" }, org = { id: "o-1" };
const t1 = Date.now();
const rec = await C.makeRecord({ password: "kosi2026", user, org });
const ms = Date.now() - t1;
check(`record: v1, salt, ${C.PBKDF2_ITERATIONS} iterations, no password inside`, rec.v === 1 && rec.iter === C.PBKDF2_ITERATIONS && rec.salt.length > 10 && !JSON.stringify(rec).includes("kosi2026"), `${ms} ms on this PC`);
check("right password → match", (await C.checkRecord(rec, { password: "kosi2026", user, org })) === "match");
check("wrong password → mismatch", (await C.checkRecord(rec, { password: "kosi2025", user, org })) === "mismatch");
check("another signed-in USER → refused (none)", (await C.checkRecord(rec, { password: "kosi2026", user: { id: "u-2" }, org })) === "none");
check("another ORG → refused (none)", (await C.checkRecord(rec, { password: "kosi2026", user, org: { id: "o-2" } })) === "none");
check("tampered / weak record → refused", (await C.checkRecord({ ...rec, iter: 1 }, { password: "kosi2026", user, org })) === "none" && (await C.checkRecord(null, { password: "x", user, org })) === "none");
const rec2 = await C.makeRecord({ password: "kosi2026", user, org });
check("same password, new salt → a different hash", rec2.hash !== rec.hash && rec2.salt !== rec.salt);

console.log("outer layer (wiring)");
const app = read("src/App.jsx"), lock = read("src/components/AppLock.jsx"), lib = read("src/utils/appLock.js");
check("App.jsx: Guard → AppLock → LockGate → Layout", app.includes("<Guard><AppLock><LockGate><Layout /></LockGate></AppLock></Guard>"));
check("AppLock always renders its children; the screen goes through a portal; #root made inert", /\{children\}/.test(lock) && /createPortal\(/.test(lock) && /root\.inert = cover/.test(lock));
check("no edits to the logout code: Layout.jsx / api.js untouched; LoginPage only shows the ?flash=app_lock message (FR/EN)",
  !read("src/components/common/Layout.jsx").includes("appLock") && !read("src/utils/api.js").includes("app-lock")
  && !read("src/pages/LoginPage.jsx").includes("appLock") && /flash === "app_lock"/.test(read("src/pages/LoginPage.jsx"))
  && /après 5 mots de passe incorrects/.test(read("src/pages/LoginPage.jsx")) && /after 5 wrong passwords/.test(read("src/pages/LoginPage.jsx")));
check("My account shows the same fingerprint card (cashier / warehouse / accountant reach it there)", /<AppLockSettingsCard lang=\{lang\} \/>/.test(read("src/pages/MyAccountPage.jsx")));
check("never touches the offline queue or approvals", !/pendingSync|enqueue|approval/i.test(lib.replace(/\/\/.*$/gm, "")));
check("A2: every logout path is covered by the auth-store subscription + a start-up sweep", /useAuthStore\.subscribe\(/.test(lib) && /export async function sweepOtherUsers/.test(lib) && /wipeUser\(before\)/.test(lib));
check("the Preferences proxy is never returned from an async function (it is thenable: 'Preferences.then() is not implemented')",
  /\(await M\(\)\)\.Preferences\.get/.test(lib) && !/return prefs\b/.test(lib) && !/\)\)\.Preferences;\s*return/.test(lib));
check("A3: the record is kept in Preferences on Android, localStorage on the web", /@capacitor\/preferences/.test(lib) && /localStorage\.setItem\(k, v\)/.test(lib));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
