// MP-APPROVAL-DETAIL — the boss's plain-language view of what he's about to approve.
//
// Paul (owner) needs to grasp an approval request in ~3 seconds, especially a bundled
// ("global") sale that folds several reasons into one. This renders, from the already-
// stored payload (NOTHING new is captured):
//   1. WHY approval is needed  — one clear line per reason (below-cost / credit /
//      discount / oversell / back-date), plain words, not field names.
//   2. THE ORDER               — the items (name × qty @ price, discount, damaged),
//      the customer, the payment mode, paid vs owed.
// The headline (who · where · what · amount) is already on the row/modal that hosts this.
//
// THREE HARD RULES (this can sit on a screen that blocks a live sale):
//   1. NEVER crash/hang on an old or partial payload. Every field is read defensively;
//      a missing key renders nothing, never an error. Two shapes exist in live data
//      (with/without completed_sale_*); older rows lack keys.
//   2. Detail loads ON EXPAND (lazy GET /staff/approvals/:id) — the list stays light.
//   3. ALWAYS FALL BACK. If the detail can't load, the host row still shows requester +
//      amount + type and the boss can still approve/reject. Worst case = today's view.
//
// min_price / floor is OWNER-only info — this component is used ONLY on the boss's
// surfaces (never the cashier's My Requests).

import { useEffect, useState } from "react";
import api from "../../utils/api";
import { useLangStore } from "../../store";
import { useCurrency } from "../../utils/useCurrency";

const num = (x) => Number(x) || 0;
const has = (v) => v !== null && v !== undefined && v !== "";

// ── MP-APPROVAL-FULL-DETAIL: id → name, always with a graceful fallback ──────────
// The backend attaches `resolved` (one batched lookup per card). Anything it could
// NOT resolve — a since-deleted product, a renamed-away branch, an old row — degrades
// to a short id stub or "unknown". Never a crash, and never a full raw UUID in the
// boss's face. An older backend that sends no `resolved` at all lands here too, so
// the card still renders.
const shortId = (id) => (typeof id === "string" && id.length > 8 ? `#${id.slice(0, 8)}` : (has(id) ? String(id) : ""));

function makeLookup(detail, en) {
  const r = (detail && detail.resolved && typeof detail.resolved === "object") ? detail.resolved : {};
  const pick = (map, id) => ((map && typeof map === "object" && has(id)) ? map[id] : null);
  return {
    product: (id) => {
      const p = pick(r.products, id);
      if (p && p.name) return p.name;
      const unknown = en ? "Unknown item" : "Article inconnu";
      return has(id) ? `${unknown} ${shortId(id)}` : unknown;
    },
    // A NULL location is meaningful, not missing: an external-source receive.
    location: (id) => {
      if (!has(id)) return en ? "outside supplier" : "fournisseur externe";
      const l = pick(r.locations, id);
      if (l && l.name) return l.name;
      return `${en ? "Unknown branch" : "Succursale inconnue"} ${shortId(id)}`;
    },
    customer: (id) => pick(r.customers, id),
    sale: (id) => pick(r.sales, id),
    // The sale's human number, or a stub — used wherever a payload holds only a sale uuid.
    saleNumber: (id) => {
      const s = pick(r.sales, id);
      if (s && s.sale_number) return s.sale_number;
      return has(id) ? shortId(id) : (en ? "unknown sale" : "vente inconnue");
    },
  };
}

const fmtDate = (d, en) => {
  if (!has(d)) return "—";
  try { return new Date(d).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return String(d); }
};

const payModeLabel = (m, en) => {
  const k = String(m || "").toLowerCase();
  if (k === "cash") return en ? "Cash" : "Espèces";
  if (k === "momo" || k === "mobile_money") return "Mobile money";
  if (k === "bank" || k === "bank_transfer") return en ? "Bank" : "Virement";
  if (k === "credit" || k === "unpaid") return en ? "Credit (unpaid)" : "Crédit (impayé)";
  return has(m) ? m : "—";
};

const returnTypeLabel = (t, en) => {
  const k = String(t || "").toLowerCase();
  if (k === "refund") return en ? "cash refund" : "remboursement";
  if (k === "replace_same") return en ? "same-item swap" : "échange identique";
  if (k === "replace_different") return en ? "different-item swap" : "échange différent";
  if (k === "mixed") return en ? "mixed return" : "retour mixte";
  return has(t) ? t : (en ? "return" : "retour");
};

// A per-item discount badge, e.g. "10%" or "500 off".
const discBadge = (it, en, fmt) => {
  if (!has(it.discount_value) || num(it.discount_value) === 0) return "";
  const type = String(it.discount_type || "").toLowerCase();
  if (type.startsWith("perc") || type === "%") return `−${Math.round(num(it.discount_value))}%`;
  return `−${fmt(num(it.discount_value))}`;
};

const oversellLine = (it, en) => {
  const name = it.name || (en ? "an item" : "un article");
  if (it.no_row) return en ? `Overselling ${name}: not stocked here` : `Survente ${name} : non stocké ici`;
  return en
    ? `Overselling ${name}: need ${num(it.need)}, only ${num(it.available)} in stock`
    : `Survente ${name} : besoin ${num(it.need)}, seulement ${num(it.available)} en stock`;
};

// ── WHY: one plain line per reason. tone drives the colour cue. ──────────────────
function buildReasons(row, en, fmt, lk) {
  const p = (row && row.payload && typeof row.payload === "object") ? row.payload : {};
  const out = [];

  // Bundled sale: reasons live in payload.actions[].
  if (row.action_type === "bundled_sale" || Array.isArray(p.actions)) {
    for (const a of (Array.isArray(p.actions) ? p.actions : [])) {
      if (!a || typeof a !== "object") continue;
      if (a.type === "below_cost") {
        const name = a.name || (en ? "an item" : "un article");
        // MP-MANAGER-DELEGATION polish: speak in COST terms (not "floor"), and phrase a
        // missing/zero cost gracefully rather than printing "0". Older rows without
        // cost_price fall to the same graceful message.
        const costLine = (a.cost_price != null && Number(a.cost_price) > 0)
          ? (en ? `the cost price is ${fmt(num(a.cost_price))}` : `le prix de revient est ${fmt(num(a.cost_price))}`)
          : (en ? "no cost price set" : "aucun prix de revient défini");
        out.push({ tone: "danger", text: en
          ? `Below cost: ${name}${has(a.quantity) ? ` ×${a.quantity}` : ""} at ${fmt(num(a.attempted_price))} — ${costLine}`
          : `En dessous du coût : ${name}${has(a.quantity) ? ` ×${a.quantity}` : ""} à ${fmt(num(a.attempted_price))} — ${costLine}` });
      } else if (a.type === "credit") {
        out.push({ tone: "warn", text: en
          ? `On credit: ${fmt(num(a.balance_due))} left unpaid`
          : `À crédit : ${fmt(num(a.balance_due))} impayé` });
      } else if (a.type === "discount") {
        const pct = has(a.effective_pct) ? `${Math.round(num(a.effective_pct))}%` : "";
        const amt = has(a.total_discount) ? `${fmt(num(a.total_discount))} ${en ? "off" : "de remise"}` : "";
        out.push({ tone: "info", text: `${en ? "Discount" : "Remise"}: ${[pct, amt && `(${amt})`].filter(Boolean).join(" ") || (en ? "applied" : "appliquée")}` });
      } else if (a.type === "oversell") {
        const items = Array.isArray(a.items) ? a.items : [];
        if (items.length) items.forEach(it => out.push({ tone: "warn", text: oversellLine(it, en) }));
        else out.push({ tone: "warn", text: en ? "Selling an out-of-stock item" : "Vente d'un article en rupture" });
      } else if (a.type === "sold_date") {
        out.push({ tone: "info", text: `${en ? "Back-dated sale" : "Vente antidatée"}: ${fmtDate(a.sold_date, en)}` });
      }
    }
    return out;
  }

  // Standalone types — the type itself is the reason.
  switch (row.action_type) {
    case "credit_sale":
      out.push({ tone: "warn", text: en
        ? `On credit: ${fmt(num(p.balance_due))} unpaid — of ${fmt(num(p.total_amount))}, paid ${fmt(num(p.paid_amount))}`
        : `À crédit : ${fmt(num(p.balance_due))} impayé — sur ${fmt(num(p.total_amount))}, payé ${fmt(num(p.paid_amount))}` });
      break;
    case "discount": {
      const pct = has(p.effective_pct) ? `${Math.round(num(p.effective_pct))}%` : "";
      const amt = has(p.total_discount) ? `${fmt(num(p.total_discount))} ${en ? "off" : "de remise"}` : "";
      out.push({ tone: "info", text: `${en ? "Discount" : "Remise"}: ${[pct, amt && `(${amt})`].filter(Boolean).join(" ") || (en ? "applied" : "appliquée")}` });
      break;
    }
    case "oversell": {
      const items = Array.isArray(p.items) ? p.items : [];
      if (items.length) items.forEach(it => out.push({ tone: "warn", text: oversellLine(it, en) }));
      else out.push({ tone: "warn", text: en ? "Selling an out-of-stock item" : "Vente d'un article en rupture" });
      break;
    }
    case "void": {
      // The payload holds only sale_id — resolve it to the sale NUMBER and its total so
      // the boss knows which sale, and how much, before cancelling it.
      const s = lk.sale(p.sale_id);
      const amt = (s && has(s.total_amount)) ? ` — ${fmt(num(s.total_amount))}` : "";
      out.push({ tone: "danger", text: en
        ? `Cancel sale ${lk.saleNumber(p.sale_id)}${amt}${has(p.reason) ? `: ${p.reason}` : ""}${has(p.cashier_name) ? ` — rung by ${p.cashier_name}` : ""}`
        : `Annuler la vente ${lk.saleNumber(p.sale_id)}${amt}${has(p.reason) ? ` : ${p.reason}` : ""}${has(p.cashier_name) ? ` — encaissée par ${p.cashier_name}` : ""}` });
      break;
    }
    case "refund": {
      const onSale = has(p.p_sale_id) ? `${en ? " on sale " : " sur la vente "}${lk.saleNumber(p.p_sale_id)}` : "";
      out.push({ tone: "warn", text: en
        ? `Refund ${fmt(num(p.p_refund_amount))}${onSale}${has(p.p_return_type) ? ` — ${returnTypeLabel(p.p_return_type, en)}` : ""}${has(p.p_reason) ? ` (${p.p_reason})` : ""}`
        : `Remboursement ${fmt(num(p.p_refund_amount))}${onSale}${has(p.p_return_type) ? ` — ${returnTypeLabel(p.p_return_type, en)}` : ""}${has(p.p_reason) ? ` (${p.p_reason})` : ""}` });
      if (has(p.p_price_difference) && num(p.p_price_difference) !== 0) {
        out.push({ tone: "info", text: en
          ? `Price difference: ${fmt(num(p.p_price_difference))}`
          : `Différence de prix : ${fmt(num(p.p_price_difference))}` });
      }
      break;
    }
    case "transfer": {
      // Item lines are { product_id, quantity, note } and from/to are location UUIDs —
      // all resolved to names by the backend. The full list renders below in THE ITEMS;
      // this line is the headline: how much, from where, to where.
      const items = Array.isArray(p.items) ? p.items : [];
      const n = items.length;
      const units = items.reduce((s, it) => s + num(it && it.quantity), 0);
      out.push({ tone: "info", text: en
        ? `Move ${units} unit${units === 1 ? "" : "s"} across ${n} item${n === 1 ? "" : "s"}: ${lk.location(p.from_location)} → ${lk.location(p.to_location)}`
        : `Déplacer ${units} unité${units === 1 ? "" : "s"} sur ${n} article${n === 1 ? "" : "s"} : ${lk.location(p.from_location)} → ${lk.location(p.to_location)}` });
      if (has(p.notes)) out.push({ tone: "info", text: `${en ? "Note" : "Note"}: ${p.notes}` });
      break;
    }
    case "debt_adjust": {
      const u = (p.updates && typeof p.updates === "object") ? p.updates : {};
      const cust = lk.customer(p.customer_id);
      const who = (cust && cust.name) || u.name;
      // Show the CURRENT balance next to the proposed one — a debt change is
      // unjudgeable without knowing what it's changing FROM.
      if (has(u.total_debt)) {
        const from = (cust && has(cust.total_debt)) ? fmt(num(cust.total_debt)) : (en ? "unknown" : "inconnu");
        out.push({ tone: "warn", text: en
          ? `Debt: ${from} → ${fmt(num(u.total_debt))}`
          : `Dette : ${from} → ${fmt(num(u.total_debt))}` });
      }
      if (has(u.credit_limit)) {
        const from = (cust && has(cust.credit_limit)) ? fmt(num(cust.credit_limit)) : (en ? "unknown" : "inconnu");
        out.push({ tone: "info", text: en
          ? `Credit limit: ${from} → ${fmt(num(u.credit_limit))}`
          : `Limite de crédit : ${from} → ${fmt(num(u.credit_limit))}` });
      }
      out.unshift({ tone: "warn", text: en
        ? `Change customer${has(who) ? ` ${who}` : ""}`
        : `Modifier le client${has(who) ? ` ${who}` : ""}` });
      break;
    }
    case "below_cost_sale": { // legacy standalone (retired path, but old rows exist)
      const short = has(p.shortfall) ? num(p.shortfall) : (has(row.amount) ? Math.abs(num(row.amount)) : null);
      out.push({ tone: "danger", text: en
        ? `Below cost${has(p.customer_name) ? ` — ${p.customer_name}` : ""}${short != null ? ` — short by ${fmt(short)} in total` : ""}`
        : `En dessous du coût${has(p.customer_name) ? ` — ${p.customer_name}` : ""}${short != null ? ` — manque ${fmt(short)} au total` : ""}` });
      // One line per offending item: what's being charged vs what it cost.
      for (const b of (Array.isArray(p.below_cost) ? p.below_cost : [])) {
        if (!b || typeof b !== "object") continue;
        const nm = b.name || lk.product(b.product_id);
        const floor = has(b.cost_price) && num(b.cost_price) > 0
          ? (en ? `cost ${fmt(num(b.cost_price))}` : `revient ${fmt(num(b.cost_price))}`)
          : (has(b.min_price) ? (en ? `floor ${fmt(num(b.min_price))}` : `plancher ${fmt(num(b.min_price))}`) : (en ? "no cost set" : "aucun coût défini"));
        out.push({ tone: "danger", text: en
          ? `${nm}${has(b.qty) ? ` ×${num(b.qty)}` : ""} at ${fmt(num(b.unit_price))} — ${floor}${has(b.shortfall) ? ` (short ${fmt(num(b.shortfall))})` : ""}`
          : `${nm}${has(b.qty) ? ` ×${num(b.qty)}` : ""} à ${fmt(num(b.unit_price))} — ${floor}${has(b.shortfall) ? ` (manque ${fmt(num(b.shortfall))})` : ""}` });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ── THE ORDER: the sale items + customer + payment, when the payload carries them. ──
function orderView(row, lk, en) {
  const p = (row && row.payload && typeof row.payload === "object") ? row.payload : {};
  const base = { items: [], customer: null, pay_mode: null, paid_amount: null, title: null, where: null };
  if (row.action_type === "bundled_sale" || p.sale_request) {
    const sr = (p.sale_request && typeof p.sale_request === "object") ? p.sale_request : {};
    return {
      ...base,
      items: Array.isArray(sr.items) ? sr.items : [],
      customer: p.customer_name,
      pay_mode: sr.pay_mode,
      paid_amount: sr.paid_amount,
      notes: sr.notes,
      sold_date: sr.sold_date,
      where: has(sr.location_id) ? lk.location(sr.location_id) : (has(p.location_id) ? lk.location(p.location_id) : null),
    };
  }
  if (row.action_type === "discount") {
    return { ...base, items: Array.isArray(p.items) ? p.items : [], customer: p.customer_name,
             where: has(p.location_id) ? lk.location(p.location_id) : null };
  }
  if (row.action_type === "refund") {
    // p_items_returned use {qty, name, unit_price, reason, notes}
    return { ...base, items: Array.isArray(p.p_items_returned) ? p.p_items_returned : [],
             pay_mode: p.p_refund_method,
             title: en ? "Items returned" : "Articles retournés",
             where: has(p.p_location_id) ? lk.location(p.p_location_id) : null };
  }
  if (row.action_type === "below_cost_sale") {
    // The offending lines (price vs cost) are already itemised in WHY — show the WHOLE
    // cart here instead, so the boss sees what else is on the sale. Older rows that
    // carry no full `items` fall back to the below-cost lines rather than showing nothing.
    const full = Array.isArray(p.items) && p.items.length ? p.items : (Array.isArray(p.below_cost) ? p.below_cost : []);
    return { ...base, items: full, customer: p.customer_name,
             where: has(p.location_id) ? lk.location(p.location_id) : null };
  }
  if (row.action_type === "transfer") {
    // The payload's own lines carry NO name — resolve each product_id. `note` is
    // per-line and worth surfacing (it's how staff explain an odd quantity).
    const items = (Array.isArray(p.items) ? p.items : []).map((it) => ({
      name: lk.product(it && it.product_id),
      quantity: it && it.quantity,
      note: it && it.note,
    }));
    return { ...base, items,
             title: en ? "What's being moved" : "Ce qui est déplacé",
             where: `${lk.location(p.from_location)} → ${lk.location(p.to_location)}` };
  }
  if (row.action_type === "void") {
    // Nothing about the sale is in the payload — the lines come from the resolved sale.
    const s = lk.sale(p.sale_id);
    const items = (s && Array.isArray(s.items) ? s.items : []).map((it) => ({
      name: it.name || lk.product(it.product_id),
      quantity: it.quantity,
      unit_price: it.unit_price,
    }));
    return { ...base, items,
             title: en ? "What's on that sale" : "Ce que contient cette vente" };
  }
  return base;
}

function ItemLine({ it, en, fmt }) {
  const qty = num(has(it.quantity) ? it.quantity : it.qty);
  const name = it.name || (en ? "Item" : "Article");
  const price = has(it.unit_price) ? fmt(num(it.unit_price)) : null;
  const disc = discBadge(it, en, fmt);
  // MP-APPROVAL-FULL-DETAIL: a per-line note/reason is often the only explanation for an
  // odd quantity or a return — surface it under the line rather than dropping it.
  const sub = [it.note, it.reason, it.notes].filter((x) => has(x)).join(" · ");
  return (
    <div style={{ padding: "3px 0", fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--text-secondary)", minWidth: 0 }}>
          {qty ? `${qty}× ` : ""}{name}
          {it.is_damaged ? <span style={{ color: "#f59e0b" }}>{en ? " · damaged" : " · abîmé"}</span> : null}
        </span>
        <span style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>
          {price || ""}{disc ? ` · ${disc}` : ""}
        </span>
      </div>
      {sub ? (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", paddingLeft: 2, fontStyle: "italic" }}>{sub}</div>
      ) : null}
    </div>
  );
}

const TONE = { danger: "#f87171", warn: "#fbbf24", info: "#60a5fa" };

// MP-CREDIT-TRUST: does this request extend credit, and to whom? bundled_sale (Σ credit
// actions' balance_due) or credit_sale (payload.balance_due). Returns null when there's no
// credit or no customer (walk-in) → the trust line is simply omitted.
function creditInfo(row) {
  const p = (row && row.payload && typeof row.payload === "object") ? row.payload : {};
  const customer_id = p.customer_id || (p.sale_request && p.sale_request.customer_id) || null;
  if (!customer_id) return null;
  let amount = 0;
  if (row.action_type === "credit_sale") amount = num(p.balance_due);
  else if (Array.isArray(p.actions)) for (const a of p.actions) if (a && a.type === "credit") amount += num(a.balance_due);
  if (amount <= 0) return null;
  return { customer_id, credit_amount: amount };
}

// The CUSTOMER-TRUST line — live standing so the boss isn't approving blind. Flags
// visually when risky (new customer / first purchase / after-debt crossing ~80% of limit).
function TrustLine({ trust, creditAmount, en, fmt }) {
  const totalDebt = num(trust.total_debt);
  const after = totalDebt + num(creditAmount);
  const limit = (trust.credit_limit === null || trust.credit_limit === undefined) ? null : num(trust.credit_limit);
  const pct = (limit && limit > 0) ? Math.round((after / limit) * 100) : null; // never /0
  let isNew = false, ms = null;
  if (trust.created_at) { ms = Date.now() - new Date(trust.created_at).getTime(); isNew = ms >= 0 && ms < 2 * 24 * 3600 * 1000; }
  const first = num(trust.sales_count) <= 1;
  const risky = isNew || first || (pct != null && pct >= 80);

  let history;
  if (isNew) {
    const when = ms != null && ms < 24 * 3600 * 1000 ? (en ? "today" : "aujourd'hui") : (en ? "this week" : "cette semaine");
    history = en ? `New customer (created ${when}${first ? ", first purchase" : ""})`
                 : `Nouveau client (créé ${when}${first ? ", premier achat" : ""})`;
  } else {
    const since = trust.created_at ? new Date(trust.created_at).toLocaleDateString(en ? "en-GB" : "fr-FR", { month: "short", year: "numeric" }) : "—";
    const n = num(trust.sales_count);
    history = en ? `Customer since ${since} · ${n} purchase${n === 1 ? "" : "s"}`
                 : `Client depuis ${since} · ${n} achat${n === 1 ? "" : "s"}`;
  }
  const debt = en ? `owes ${fmt(totalDebt)} now → ${fmt(after)} after` : `doit ${fmt(totalDebt)} → ${fmt(after)} après`;
  const lim = (limit && limit > 0) ? (en ? `${pct}% of ${fmt(limit)} limit` : `${pct}% de la limite ${fmt(limit)}`)
                                   : (en ? "no limit set" : "aucune limite définie");

  return (
    <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
      border: `1px solid ${risky ? "#f87171" : "var(--border)"}`,
      background: risky ? "rgba(248,113,113,0.10)" : "var(--bg-subtle, rgba(0,0,0,0.02))",
      color: risky ? "#f87171" : "var(--text-secondary)" }}>
      {risky ? "⚠ " : ""}{`${history} · ${debt} · ${lim}`}
    </div>
  );
}

export default function ApprovalDetailView({ approval, defaultOpen = false }) {
  const en = useLangStore(s => s.lang) === "en";
  const fmt = useCurrency();
  const [open, setOpen] = useState(!!defaultOpen);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || detail || loading || !approval?.id) return;
    let alive = true;
    setLoading(true); setError(false);
    api.get(`/staff/approvals/${approval.id}`)
      .then(r => r.data?.data || null)
      .then(d => { if (alive) { setDetail(d); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, approval?.id]);

  // MP-CREDIT-TRUST: for a credit request, fetch the customer's LIVE standing at expand
  // time (never snapshotted). ANY failure → omit the line silently; approve/reject stay.
  const ci = detail ? creditInfo(detail) : null;
  const [trust, setTrust] = useState(null); // the customer-trust data, or null
  useEffect(() => {
    const cid = ci && ci.customer_id;
    if (!cid) { setTrust(null); return; }
    let alive = true;
    setTrust(null);
    api.get(`/staff/customer-trust/${cid}`)
      .then(r => r.data?.data || null)
      .then(d => { if (alive && d) setTrust(d); })
      .catch(() => { if (alive) setTrust(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ci && ci.customer_id]);

  const lk = makeLookup(detail, en);
  const reasons = detail ? buildReasons(detail, en, fmt, lk) : [];
  const order = detail ? orderView(detail, lk, en) : { items: [] };
  const hasOrder = order.items.length > 0 || has(order.customer) || has(order.pay_mode) || has(order.where);

  return (
    <div style={{ marginTop: 8 }}>
      {!defaultOpen && (
        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px",
                   fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer", width: "100%", textAlign: "left" }}>
          {open ? "▾ " : "▸ "}{en ? "Why & what — details" : "Pourquoi & quoi — détails"}
        </button>
      )}

      {open && (
        <div style={{ marginTop: defaultOpen ? 0 : 8, border: defaultOpen ? "none" : "1px solid var(--border)",
                      borderRadius: 10, padding: defaultOpen ? 0 : "10px 12px", background: defaultOpen ? "transparent" : "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{en ? "Loading details…" : "Chargement des détails…"}</div>
          ) : error || !detail ? (
            // FALLBACK: never block — the host row already shows requester + amount + type.
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {en ? "Couldn't load the full detail — you can still approve or reject from the amount and type above."
                  : "Détails indisponibles — vous pouvez quand même approuver ou rejeter d'après le montant et le type ci-dessus."}
            </div>
          ) : (
            <>
              {/* 0. CUSTOMER TRUST (credit requests) — the line that prevents blind approval */}
              {ci && trust && (
                <TrustLine trust={trust} creditAmount={ci.credit_amount} en={en} fmt={fmt} />
              )}

              {/* 1. WHY */}
              {reasons.length > 0 && (
                <div style={{ marginBottom: hasOrder ? 10 : 0 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-muted)", marginBottom: 4 }}>
                    {en ? "Why it needs you" : "Pourquoi votre accord"}
                  </div>
                  {reasons.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, fontSize: 13, fontWeight: 600, padding: "2px 0", color: TONE[r.tone] || "var(--text-primary)" }}>
                      <span>•</span><span>{r.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 2. THE ORDER */}
              {hasOrder && (
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-muted)", marginBottom: 4 }}>
                    {order.title || (en ? "The order" : "La commande")}
                  </div>
                  {(has(order.customer) || has(order.pay_mode) || has(order.paid_amount) || has(order.where)) && (
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: order.items.length ? 6 : 0 }}>
                      {[
                        has(order.where) ? `${en ? "Where" : "Où"}: ${order.where}` : null,
                        has(order.customer) ? `${en ? "Customer" : "Client"}: ${order.customer}` : null,
                        has(order.pay_mode) ? `${en ? "Paid by" : "Paiement"}: ${payModeLabel(order.pay_mode, en)}` : null,
                        has(order.paid_amount) ? `${en ? "Paid" : "Payé"}: ${fmt(num(order.paid_amount))}` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {order.items.map((it, i) => <ItemLine key={i} it={it} en={en} fmt={fmt} />)}
                </div>
              )}

              {reasons.length === 0 && !hasOrder && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {en ? "No extra detail was recorded for this request." : "Aucun détail supplémentaire enregistré pour cette demande."}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
