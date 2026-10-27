// APP LOCK SETTINGS (2026-10-27) — src/utils/appLockSettings.js + the wiring around it.
//   F1 a save changes the card only from the server's answer; a failure restores the stored values
//   F2 a saved policy reaches the running lock at once
//   F3 the status line: active / off / no start date / starts later — EN + FR, old backend too
//   F5 the personal fingerprint audit event is kept and retried until the server has it
// Run: node scripts/app-lock-settings-check.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, "..", p), "utf8");
const S = await import("data:text/javascript;base64," + Buffer.from(read("src/utils/appLockSettings.js")).toString("base64"));

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  [" + detail + "]" : ""}`); };

const STORED = { lock_android: true, lock_web: true, lock_after_minutes: 5, biometric_allowed: true,
  starts_at: "2026-10-23T06:59:41.937Z", active: true, status: "active" };
const PAUL = { ...STORED, lock_after_minutes: 1, starts_at: null, active: false, status: "no_start_date" };

console.log("F1 — form vs server");
const d0 = S.draftOf(STORED);
check("draft of the stored policy is not dirty", !S.isDirty(d0, STORED));
check("1 minute chosen, not saved → dirty ('Not saved yet')", S.isDirty({ ...d0, minutes: 1 }, STORED));
check("mode or fingerprint rule changed → dirty", S.isDirty({ ...d0, mode: "android" }, STORED) && S.isDirty({ ...d0, bio: false }, STORED));
check("the body sends all four, from the draft", JSON.stringify(S.bodyOf({ mode: "web", minutes: 1, bio: false })) ===
  JSON.stringify({ lock_android: false, lock_web: true, lock_after_minutes: 1, biometric_allowed: false }));

console.log("F1 — one save");
{
  let sent = null;
  const r = await S.savePolicy(async (b) => { sent = b; return { data: { success: true, data: { ...STORED, lock_after_minutes: 1 } } }; }, { ...d0, minutes: 1 }, STORED, true);
  check("server answers → ok, the card takes the SERVER's policy", r.ok && r.policy.lock_after_minutes === 1 && sent.lock_after_minutes === 1);
  check("…already active → not 'just started'", r.justStarted === false);
}
{
  const r = await S.savePolicy(async () => ({ data: { data: { ...PAUL, starts_at: "2026-10-27T09:00:00Z", active: true, status: "active" } } }), S.draftOf(PAUL), PAUL, true);
  check("Paul's org: the save that starts it → justStarted", r.ok && r.justStarted === true);
}
{
  const offline = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
  const r = await S.savePolicy(async () => { throw offline; }, { ...d0, minutes: 1 }, STORED, true);
  check("offline / no answer → not ok, error says the old setting is kept", !r.ok && /previous setting/.test(r.error), r.error);
  check("…and the STORED values come back (5 min, not the 1 typed)", r.draft.minutes === 5 && r.draft.mode === "both");
  const f = await S.savePolicy(async () => { throw offline; }, { ...d0, minutes: 1 }, STORED, false);
  check("…in French too", /réglage précédent/.test(f.error), f.error);
}
{
  const bad = Object.assign(new Error("400"), { response: { status: 400, data: { message_en: "Lock after: choose 1, 2, 5, 10, 15, 30 minutes.", message_fr: "Verrouiller après : choisissez 1, 2, 5, 10, 15, 30 minutes." } } });
  const r = await S.savePolicy(async () => { throw bad; }, { ...d0, minutes: 1 }, STORED, true);
  check("server refusal → its own message + 'Nothing was changed', values restored", !r.ok && /choose 1, 2, 5/.test(r.error) && /Nothing was changed/.test(r.error) && r.draft.minutes === 5, r.error);
  const fr = await S.savePolicy(async () => { throw bad; }, { ...d0, minutes: 1 }, STORED, false);
  check("…French message + 'Rien n'a été modifié'", /choisissez/.test(fr.error) && /Rien n'a été modifié/.test(fr.error), fr.error);
}
{
  const r = await S.savePolicy(async () => ({ data: { success: true } }), { ...d0, minutes: 1 }, STORED, true);
  check("a 2xx WITHOUT the stored policy is a failure (never trust a guess)", !r.ok && r.draft.minutes === 5);
}

console.log("F3 — status line");
check("active → 'Active since <date>' / 'Actif depuis le'", /^Active since 23 October 2026\.$/.test(S.statusText(STORED, true)) && /^Actif depuis le 23 octobre 2026\.$/.test(S.statusText(STORED, false)), S.statusText(STORED, true));
check("just started → 'Active from now — … next sign-in or app opening'", /Active from now/.test(S.statusText(STORED, true, { justStarted: true })) && /Actif dès maintenant/.test(S.statusText(STORED, false, { justStarted: true })));
check("no start date (new backend) → 'Not active — no start date yet. Save …'", /^Not active — no start date yet\. Save/.test(S.statusText(PAUL, true)) && /^Non actif — pas encore de date de début\. Enregistrez/.test(S.statusText(PAUL, false)));
check("off → 'Not active — the lock is off.'", S.statusText({ ...STORED, status: "off" }, true) === "Not active — the lock is off." && /désactivé/.test(S.statusText({ ...STORED, status: "off" }, false)));
check("scheduled → 'Not active yet — starts on …'", /^Not active yet — starts on 1 December 2026\.$/.test(S.statusText({ ...STORED, status: "scheduled", starts_at: "2026-12-01T00:00:00Z", active: false }, true)));
const OLD = (x) => { const { status, ...rest } = { ...STORED, ...x }; return rest; };   // an older backend: no `status`
check("old backend (no status): derived — off / no start date (no 'Save to start' promise) / active",
  S.policyStatus(OLD({ lock_android: false, lock_web: false })) === "off" && S.statusText(OLD({ starts_at: null, active: false }), true) === "Not active — no start date yet."
  && S.policyStatus(OLD({})) === "active");

console.log("F5 — fingerprint audit event queue");
{
  let box = null; const sent = []; let online = false;
  const q = S.makeEventQueue({ get: async () => box, set: async (l) => { box = l; }, send: async (ev) => { if (!online) throw new Error("offline"); sent.push(ev.event); return true; } });
  const r1 = await q.add({ event: "biometric_enabled", user_id: "peter" });
  check("offline: the event is KEPT on the device (not lost)", r1.left === 1 && box.length === 1 && sent.length === 0);
  online = true;
  const r2 = await q.flush("peter");
  check("back online: sent once, removed", r2.sent === 1 && box.length === 0 && sent.join() === "biometric_enabled");
  online = false;
  await q.add({ event: "biometric_disabled", user_id: "demo-owner" });
  online = true;
  const r3 = await q.flush("peter");
  check("another user's event is never sent from this session, and is dropped", r3.sent === 0 && box.length === 0 && sent.length === 1);
}
{
  let box = []; let release; const gate = new Promise((r) => { release = r; }); const sent = [];
  const q = S.makeEventQueue({ get: async () => box, set: async (l) => { box = l; }, send: async (ev) => { if (ev.event === "first") await gate; sent.push(ev.event); return true; } });
  const p1 = q.add({ event: "first", user_id: "u" });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = q.add({ event: "second", user_id: "u" });             // added WHILE the first flush is sending
  release(); await p1; await p2;
  check("an event added during a flush is not overwritten — both sent, list empty", sent.join() === "first,second" && box.length === 0, `${sent.join()} / ${box.length}`);
}
{
  let box = []; let n = 0;
  const q = S.makeEventQueue({ get: async () => box, set: async (l) => { box = l; }, send: async () => { n++; return false; } });
  await q.add({ event: "biometric_enabled", user_id: "u" });
  check("send() returning false counts as not sent (kept)", box.length === 1 && n === 1);
}

console.log("wiring");
const card = read("src/components/AppLockSettingsCard.jsx");
const lock = read("src/utils/appLock.js");
const outer = read("src/components/AppLock.jsx");
check("card: saves through savePolicy, never writes the device copy itself", card.includes("savePolicy(") && !card.includes("savePolicyCopy"));
check("card: on failure the stored values are put back", /setErr\(r\.error\); setDraft\(r\.draft\)/.test(card));
check("card: names the business, shows 'Not saved yet', the status line and both fingerprint scopes",
  card.includes("App lock for ${orgName") && card.includes("Not saved yet") && card.includes("statusText(policy") && card.includes("My fingerprint / face on THIS phone")
  && card.includes("Let everyone in this business use fingerprint / face (Android)"));
check("F2: the card announces a saved policy; AppLock listens for it", card.includes("announcePolicy(org.id, r.policy)") && lock.includes('POLICY_EVENT = "mp-app-lock-policy"')
  && outer.includes("window.addEventListener(POLICY_EVENT, onSaved)") && outer.includes("window.removeEventListener(POLICY_EVENT, onSaved)"));
check("F5: enable/disable record through the queue (no bare fire-and-forget)", lock.includes('recordBioEvent(user.id, "biometric_enabled")') && lock.includes('recordBioEvent(user.id, "biometric_disabled"')
  && !/reportEvent\("biometric_(enabled|disabled)"/.test(lock));
check("F5: retried at login, start, resume and when the connection returns", lock.includes("setTimeout(() => flushBioEvents(user.id), 2000)") && lock.includes('addEventListener("online"')
  && (outer.match(/flushBioEvents\(user\.id\)/g) || []).length >= 2);
check("PATCH /app-lock/policy stays OUT of the offline queue (a save offline must fail, not be faked)", !read("src/utils/api.js").includes("app-lock"));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
