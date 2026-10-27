// APP LOCK SETTINGS (2026-10-27) — the pure rules behind the settings card (no imports, no storage, no
// network of its own): what the card shows and what a save may change. scripts/app-lock-settings-check.mjs
// tests this file.
//   F1  a save changes the card ONLY from the server's answer; a failure restores the stored values
//   F3  the real status line: active / off / no start date / starts later
//   F5  the personal fingerprint audit event is kept and retried until the server has it

export const MINUTES = [1, 2, 5, 10, 15, 30];
export const MODES = [
  { key: "both", android: true, web: true, fr: "Android et Web", en: "Android and web" },
  { key: "android", android: true, web: false, fr: "Android seulement", en: "Android only" },
  { key: "web", android: false, web: true, fr: "Web seulement", en: "Web only" },
  { key: "off", android: false, web: false, fr: "Désactivé", en: "Off" },
];
export const modeOf = (p) => (MODES.find((m) => m.android === !!p.lock_android && m.web === !!p.lock_web) || MODES[0]).key;
export const draftOf = (p) => ({ mode: modeOf(p), minutes: p.lock_after_minutes, bio: !!p.biometric_allowed });

// The form differs from what the server has → "Not saved yet".
export function isDirty(draft, policy) {
  if (!draft || !policy) return false;
  const s = draftOf(policy);
  return draft.mode !== s.mode || Number(draft.minutes) !== Number(s.minutes) || !!draft.bio !== s.bio;
}

// The server sends `status` (backend 2026-10-27); an older backend does not → derive the same answer.
export function policyStatus(p) {
  if (!p) return null;
  if (typeof p.status === "string") return p.status;
  if (!p.lock_android && !p.lock_web) return "off";
  if (!p.starts_at) return "no_start_date";
  return p.active ? "active" : "scheduled";
}

// `justStarted`: this save turned it on — say when it bites (never mid-session).
export function statusText(p, en, { justStarted = false } = {}) {
  const st = policyStatus(p);
  if (!st) return "";
  const day = (iso) => new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (st === "off") return en ? "Not active — the lock is off." : "Non actif — le verrouillage est désactivé.";
  if (st === "no_start_date")
    return typeof p.status === "string"
      ? (en ? "Not active — no start date yet. Save with Android or web chosen to start it."
            : "Non actif — pas encore de date de début. Enregistrez avec Android ou Web choisi pour le démarrer.")
      : (en ? "Not active — no start date yet." : "Non actif — pas encore de date de début.");
  if (st === "scheduled") return en ? `Not active yet — starts on ${day(p.starts_at)}.` : `Pas encore actif — commence le ${day(p.starts_at)}.`;
  if (justStarted)
    return en ? "Active from now — each person is asked at their next sign-in or app opening."
              : "Actif dès maintenant — chacun sera concerné à sa prochaine connexion ou ouverture de l'application.";
  return en ? `Active since ${day(p.starts_at)}.` : `Actif depuis le ${day(p.starts_at)}.`;
}

export function bodyOf(draft) {
  const m = MODES.find((x) => x.key === draft.mode) || MODES[0];
  return { lock_android: m.android, lock_web: m.web, lock_after_minutes: Number(draft.minutes), biometric_allowed: !!draft.bio };
}

// F1 — one save. `patch(body)` is the api call. Nothing local changes unless the server answered with the
// stored policy; on any failure the caller gets the error AND the stored values to put back.
//   → { ok: true, policy, justStarted } | { ok: false, error, draft }
export async function savePolicy(patch, draft, policy, en) {
  const fallback = en ? "Not saved — the app lock still has its previous setting. Check the connection and try again."
                      : "Non enregistré — le verrouillage garde son réglage précédent. Vérifiez la connexion et réessayez.";
  try {
    const r = await patch(bodyOf(draft));
    const d = r && r.data && r.data.data;
    if (!d || typeof d !== "object" || typeof d.lock_android !== "boolean") return { ok: false, error: fallback, draft: draftOf(policy) };
    return { ok: true, policy: d, justStarted: policyStatus(policy) !== "active" && policyStatus(d) === "active" };
  } catch (e) {
    const b = e && e.response && e.response.data;
    const msg = b && (en ? b.message_en : b.message_fr);
    return { ok: false, error: msg ? `${msg} ${en ? "Nothing was changed." : "Rien n'a été modifié."}` : fallback, draft: draftOf(policy) };
  }
}

// F5 — the personal fingerprint audit event. `get()`/`set(list)` keep a small list on the device;
// `send(ev)` posts it (throws / returns false on failure). An event is removed only once sent; another
// user's events are dropped (only that user's own session may report them).
// Each event carries an `id`; the write-back RE-READS the list, so an event added during a flush is kept.
export function makeEventQueue({ get, set, send, max = 20 }) {
  let busy = null;
  const read = async () => ((await get()) || []).filter((e) => e && typeof e === "object");
  async function flush(userId) {
    if (busy) return busy;
    busy = (async () => {
      const sentIds = new Set();
      for (const ev of await read()) {
        if (ev.user_id !== userId) continue;              // someone else's: never sent from this session
        let ok = false;
        try { ok = (await send(ev)) !== false; } catch { ok = false; }
        if (ok) sentIds.add(ev.id);
      }
      const keep = (await read()).filter((e) => e.user_id === userId && !sentIds.has(e.id));
      await set(keep);
      return { sent: sentIds.size, left: keep.length };
    })();
    try { return await busy; } finally { busy = null; }
  }
  async function add(ev) {
    const list = await read();
    list.push({ ...ev, id: ev.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
    await set(list.slice(-max));
    if (busy) await busy.catch(() => {});                 // a flush in flight: let it finish, then send this one
    return flush(ev.user_id);
  }
  return { add, flush };
}
