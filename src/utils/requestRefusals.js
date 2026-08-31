// MP-SCOPED-GRANT — the cashier-facing record of a refused completion.
//
// The executor refuses when the boss's approval no longer covers what the sale
// needs (stock moved, amount over the ceiling, price now below the floor). Before
// this, that arrived as a toast: it vanished, and the request sat in My Requests
// still reading "Approved" with a Complete button and no explanation. Wisdom is
// standing at the counter with a customer; a disappeared message is no message.
//
// ⚠️ WHY THIS IS CLIENT-SIDE. A refusal deliberately leaves the approval row at
// 'approved' (the cashier must be able to re-send), and pa_action_approvals has no
// "refused" status. Adding one means touching the executor, which belongs to
// 2100ef8, not to this task. So the refusal is recorded here, in localStorage,
// keyed by approval id.
//
// KNOWN LIMIT, worth stating rather than discovering later: this is per-device.
// On a SHARED shop login (Paul has these — "Bepanda Shop" is a login, not a
// person) a refusal recorded on one phone will not appear on another. The durable
// fix is a server field; see the report. Everything else here survives an app
// close/reopen, which is the property that actually matters at the counter.

const KEY = "mp.request.refusals.v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // a refusal older than a week is noise

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // corrupt/unavailable storage must never break the page
  }
}

function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* quota — non-fatal */ }
}

// Drop stale entries so the store can't grow forever on a till that never clears.
function prune(map) {
  const now = Date.now();
  let changed = false;
  for (const [id, v] of Object.entries(map)) {
    if (!v || typeof v.at !== "number" || now - v.at > MAX_AGE_MS) { delete map[id]; changed = true; }
  }
  return changed;
}

export function getRefusals() {
  const map = readAll();
  if (prune(map)) writeAll(map);
  return map;
}

export function getRefusal(approvalId) {
  return getRefusals()[approvalId] || null;
}

export function recordRefusal(approvalId, body) {
  const map = getRefusals();
  map[approvalId] = {
    at: Date.now(),
    code: body?.code || null,
    actions: Array.isArray(body?.actions) ? body.actions : [],
    items: Array.isArray(body?.items) ? body.items : [],
    // Server copy kept only as a fallback for a reason we don't have a sentence for.
    message_en: body?.message_en || body?.message || null,
    message_fr: body?.message_fr || body?.message || null,
  };
  writeAll(map);
}

export function clearRefusal(approvalId) {
  const map = getRefusals();
  if (map[approvalId]) { delete map[approvalId]; writeAll(map); }
}

// ── THE SERVER'S COPY, WHICH WINS ───────────────────────────────────────────
// The executor now records the refusal in pa_action_approvals.execution_error, so
// it follows the cashier to a second device — which is the real case: the heavy
// users are named, single-location cashiers on more than one handset (Wisdom 337
// sales/14d, Kosi 271, Kingsley 213), not the shared shop logins, which are idle.
//
// Returns the same shape recordRefusal stores, so both paths render identically.
// Returns null for anything that is not one of our refusal blobs — execution_error
// predates this and carries plain error strings for genuinely 'failed' rows, and a
// raw string must never be mistaken for a refusal.
export function parseServerRefusal(executionError) {
  if (!executionError || typeof executionError !== "string") return null;
  let v = null;
  try { v = JSON.parse(executionError); } catch { return null; }  // legacy plain text
  if (!v || v.kind !== "refusal") return null;
  return {
    at: Date.parse(v.at) || Date.now(),
    code: v.code || null,
    actions: Array.isArray(v.actions) ? v.actions : [],
    items: Array.isArray(v.items) ? v.items : [],
    message_en: v.message_en || null,
    message_fr: v.message_fr || null,
    source: "server",
  };
}

// Server first, local only when the server has none — so a refusal raised on
// another device wins, and anything already stored locally before this shipped
// still renders instead of vanishing.
export function resolveRefusal(row, localMap) {
  return parseServerRefusal(row && row.execution_error)
    || agedOutRefusal(row)
    || (localMap && localMap[row && row.id])
    || null;
}

// ── MP-APPROVAL-AGED-OUT ────────────────────────────────────────────────────
// The server flags a stale grant on the LIST (grant_aged_out), before the
// cashier has tried anything. Without this the row would still read "Approved"
// with a Complete button, and the only way to discover it is dead would be to
// press it at the counter with a customer waiting — which is the exact failure
// the scoped-grant refusal was built to remove.
//
// `grant_aged_out` is computed server-side on purpose: duplicating the TTL here
// would drift the moment either side moved.
export function agedOutRefusal(row) {
  if (!row || row.grant_aged_out !== true) return null;
  return {
    at: Date.parse(row.decided_at) || Date.now(),
    code: "approval_aged_out",
    actions: [], items: [],
    message_en: null, message_fr: null,   // wording comes from refusalSentences
    source: "aged_out",
  };
}

// ── IS THIS A REFUSAL, OR IS THE NETWORK DOWN? ──────────────────────────────
// These must never look the same. A refusal states what changed and offers the
// two exits; an outage says try again. Conflating them teaches the cashier to
// ignore both — and "try again" on a genuine refusal is a loop with no exit.
//
// A refusal is a DELIBERATE server answer: it carries resend:true, or one of the
// known refusal codes. Anything without a response body (timeout, DNS, offline)
// or any 5xx that isn't one of those is an outage.
const REFUSAL_CODES = new Set([
  "stock_changed_since_request",
  "approval_ceiling_exceeded",
  "price_below_floor_now",
  "approval_no_longer_covers",
  "approval_aged_out",   // MP-APPROVAL-AGED-OUT
]);

export function isRefusal(err) {
  const body = err?.response?.data;
  if (!body) return false;                       // no response at all => outage
  return body.resend === true || REFUSAL_CODES.has(body.code);
}

// ── THE SENTENCES ───────────────────────────────────────────────────────────
// Built from actions[], NOT from the server's single message string. The server
// returns one message for the FIRST matching reason; a sale can fail two gates at
// once (stock AND the ceiling) and the cashier needs both, each as its own
// sentence. Never show the error code — that is for the log.
//
// Leads with the numbers, because "10 requested, 5 available now" is the thing
// that tells Wisdom what to do; the reason name does not.
export function refusalSentences(refusal, en) {
  const out = [];
  const actions = (refusal && refusal.actions) || [];
  const q = (s) => (en ? `"${s}"` : `« ${s} »`);

  // MP-APPROVAL-AGED-OUT: carries no actions[] — nothing about the ORDER
  // changed, the approval simply got old — so it is answered from the code
  // rather than falling through to the generic "something changed".
  if (refusal && refusal.code === "approval_aged_out") {
    return [en
      ? "The boss approved this a while ago and the approval has gone stale. Send it again to get a fresh one."
      : "Le patron a approuvé ceci il y a un moment et l'accord n'est plus valable. Renvoyez la demande pour en obtenir un nouveau."];
  }

  for (const a of actions) {
    if (!a || !a.type) continue;

    if (a.type === "oversell") {
      const lines = Array.isArray(a.items) && a.items.length
        ? a.items
        : (refusal.items || []);
      for (const l of lines) {
        const name = l?.name || (en ? "an item" : "un article");
        out.push(en
          ? `Stock changed since you sent this. ${q(name)}: ${l?.need} requested, ${l?.available} available now.`
          : `Le stock a changé depuis l'envoi. ${q(name)} : ${l?.need} demandés, ${l?.available} disponibles maintenant.`);
      }
      if (!lines.length) {
        out.push(en
          ? "Stock changed since you sent this and there is no longer enough."
          : "Le stock a changé depuis l'envoi et ne suffit plus.");
      }
    } else if (a.type === "high_value") {
      out.push(en
        ? "This sale is above your approval limit, and the boss's approval did not cover that."
        : "Cette vente dépasse votre plafond, et l'accord du patron ne couvrait pas cela.");
    } else if (a.type === "below_cost") {
      const name = a.name || (en ? "an item" : "un article");
      out.push(en
        ? `The minimum price changed. ${q(name)} is now below the lowest price allowed.`
        : `Le prix minimum a changé. ${q(name)} est maintenant sous le prix plancher.`);
    } else if (a.type === "credit") {
      out.push(en
        ? "This sale now goes out on credit, and the boss's approval did not cover that."
        : "Cette vente part maintenant à crédit, et l'accord du patron ne couvrait pas cela.");
    } else if (a.type === "discount") {
      out.push(en
        ? "The discount on this sale now needs the boss's approval."
        : "La remise sur cette vente nécessite maintenant l'accord du patron.");
    } else if (a.type === "sold_date") {
      out.push(en
        ? "The sale date on this order now needs the boss's approval."
        : "La date de vente de cette commande nécessite maintenant l'accord du patron.");
    }
  }

  // Nothing recognised: fall back to the server's own wording rather than
  // inventing a vague one. Still never the code.
  if (!out.length) {
    const m = en ? refusal?.message_en : refusal?.message_fr;
    out.push(m || (en
      ? "Something changed since the boss approved this."
      : "Quelque chose a changé depuis l'approbation du patron."));
  }
  return out;
}

export default { getRefusal, getRefusals, recordRefusal, clearRefusal, isRefusal, refusalSentences };
