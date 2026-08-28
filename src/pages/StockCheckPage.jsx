// MP-STOCK-CHECK: sidebar surface for physically re-counting received/transferred
// (or boss-watched) products, so miscounts/theft are caught at movement time.
// Pending list → Done | Mismatch (| owner Delete). A Mismatches view is the boss's
// permanent fraud-signal trail.
//
// MP-STOCK-CHECK-RESHAPE: the pending list is fed by THREE coexisting sources —
// SYSTEM sampling, boss "🔍 Flag for re-count", and persistent boss WATCHES (every
// movement of a watched product into its watched location auto-creates a check).
// The old manual "add product & count now" (which duplicated the full Count feature)
// is replaced by "➕ Watch a product" (owner-only). Resolution is Done / Mismatch,
// plus an owner-only Delete for false flags — staff can never erase a flag on their
// own movement (anti-fraud).
import { useState, useEffect, useRef } from "react";
import HelpButton from "../components/common/HelpButton";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import toast from "react-hot-toast";
import { unitLabel } from "../utils/units";
import DateRangeFilter, { inRange, wideRange } from "../components/common/DateRangeFilter";
import { genLocalId } from "../utils/pendingSync";
import { useStockCheckSummary, NOT_COUNTED_AMBER_AT } from "../utils/useStockCheckSummary";

// MP-STALE-PRODUCT-SCAN: mirrors backend lib/stockChecks.js's STALE_THRESHOLD_DAYS
// (fixed, not per-org configurable — Peter, 2026-07-14). Display-only.
const STALE_DAYS = 60;

// ── MP-COUNT-INTEGRITY (F2) — mirrors backend routes/stockChecks.js ─────────
// The old list asked the owner to pick from four outcomes that quietly conflated
// two different questions; "Miscount" claimed the COUNT was wrong and then
// corrected stock TO that count. There is only one question worth asking:
//
//                        WHICH NUMBER IS WRONG?
//
// Direction is never chosen — it is sign(corrected − expected), shown back to the
// owner as "stock goes down/up by N" before they commit.
const RESOLVE_BRANCHES = [
  { key: "stock_wrong", corrects: true,
    en: "The STOCK RECORD was wrong",  fr: "Le STOCK enregistré était faux",
    hintEn: "The count is right — correct the stock to what was counted.",
    hintFr: "Le comptage a raison — corriger le stock au nombre compté." },
  { key: "count_wrong", corrects: false,
    en: "The COUNT was wrong",         fr: "Le COMPTAGE était faux",
    hintEn: "The system is right — stock is left exactly as it is.",
    hintFr: "Le système a raison — le stock reste inchangé." },
  { key: "not_counted", corrects: false,
    en: "It was never actually counted", fr: "Il n'a jamais été compté",
    hintEn: "Close it without a count. A note is required, and it is counted for 30 days.",
    hintFr: "Fermer sans comptage. Note obligatoire, et compté pendant 30 jours." },
];

// Direction-scoped. 'damaged' exists ONLY in the shortfall list — you cannot damage
// your way into having more stock, so the surplus case is unrepresentable rather
// than merely discouraged. Audit-only except 'damaged', which feeds the pile.
const SUB_SHORTFALL = [
  { key: "damaged",         en: "Damaged",                  fr: "Endommagé" },
  { key: "theft",           en: "Theft",                    fr: "Vol" },
  { key: "expired",         en: "Expired",                  fr: "Périmé" },
  { key: "unrecorded_sale", en: "Sold, never recorded",     fr: "Vendu, jamais enregistré" },
  { key: "other",           en: "Other / don't know",       fr: "Autre / je ne sais pas" },
];
const SUB_SURPLUS = [
  { key: "found",              en: "Found / misplaced",          fr: "Retrouvé / mal rangé" },
  { key: "unrecorded_receipt", en: "Received, never recorded",   fr: "Reçu, jamais enregistré" },
  { key: "unrecorded_return",  en: "Customer return not logged", fr: "Retour client non enregistré" },
  { key: "other",              en: "Other / don't know",         fr: "Autre / je ne sais pas" },
];

// Display-only: rows resolved before F2 still carry these, and the Resolved tab
// must keep rendering them truthfully rather than showing a raw key.
const LEGACY_REASON_LABELS = {
  miscount:       { en: "Miscount — goods were there", fr: "Erreur de comptage — présents" },
  recovered:      { en: "Recovered / found",           fr: "Retrouvé" },
  damaged:        { en: "Damaged / written off",       fr: "Endommagé / radié" },
  confirmed_loss: { en: "Confirmed loss (theft/lost)", fr: "Perte confirmée (vol/perdu)" },
  // MP-STALE-OUT-OF-QUEUE: NEVER render this as "Verified". Nobody counted
  // anything — the row was acknowledged as a slow mover. Labelling it as a
  // verified count is the same class of lie as a "miscount" that rewrote stock.
  slow_mover:     { en: "Acknowledged — slow mover",   fr: "Acquitté — rotation lente" },
};
const reasonLabel = (key, en) => {
  const b = RESOLVE_BRANCHES.find(x => x.key === key);
  if (b) return en ? b.en : b.fr;
  const l = LEGACY_REASON_LABELS[key];
  return l ? (en ? l.en : l.fr) : (key || "—");
};
const subReasonLabel = (key, en) => {
  const s = [...SUB_SHORTFALL, ...SUB_SURPLUS].find(x => x.key === key);
  return s ? (en ? s.en : s.fr) : key;
};

// MP-COUNT-INTEGRITY: the instant the goods-buffer release started writing a
// movement row on prod. A check created BEFORE this could have had its stock move
// with no ledger entry at all, so its frozen "Expected" is not evidence of
// anything — Guard B cannot see those movements because they were never written.
// Rows older than this are shown as LEGACY and routed to Recount / Remove rather
// than to a normal resolve. Backend has the same constant for the same reason.
const LEGACY_CHECK_EPOCH = "2026-08-05T10:16:15Z";
// A RE-BASELINED ROW IS NO LONGER LEGACY, whatever its created_at says. /recount
// re-anchors qty_expected to live stock, which is precisely the thing "legacy"
// warns about — so a row that has been recounted must stop carrying the badge and
// stop being steered away from a normal resolve, or the fix would look like it
// hadn't worked. created_at keeps its original value by design (it is the forensic
// anchor), so age alone can no longer answer this question; rebaselined_at can.
const isLegacyCheck = (row) => !!(
  row && row.created_at && !row.rebaselined_at &&
  new Date(row.created_at) < new Date(LEGACY_CHECK_EPOCH)
);

function fmtDate(iso, en) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// MP-STOCK-CHECK: normalize ANY list/search response to an array before .map().
// Accepts a raw axios response, our {success,data:[…]} envelope body, a bare array,
// or a {results:[…]} shape — anything else → []. A truthy non-array object (e.g. the
// envelope) would slip past `x || []` and throw ".map is not a function"; this can't.
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.data)) return x.data;                 // envelope body: { data: [...] }
  if (Array.isArray(x?.data?.data)) return x.data.data;      // axios response: resp.data = { data: [...] }
  if (Array.isArray(x?.data?.results)) return x.data.results;
  if (Array.isArray(x?.results)) return x.results;
  return [];
}

// MP-DAMAGED-GOODS: how a pile of damaged units came to exist — shown per row.
function damageSourceLabel(sourceType, en) {
  if (sourceType === "transfer_variance") return en ? "🔁 transfer variance" : "🔁 écart de transfert";
  if (sourceType === "return")            return en ? "↩ returned"         : "↩ retourné";
  return en ? "🔨 marked damaged" : "🔨 marqué endommagé"; // manual_writeoff (+ any future source)
}

// How a check landed on the list — badge shown on each row.
function flaggedLabel(flaggedBy, en) {
  if (flaggedBy === "boss")     return en ? "🔍 boss-flagged"     : "🔍 signalé par le patron";
  if (flaggedBy === "watch")    return en ? "👁 watched"          : "👁 surveillé";
  if (flaggedBy === "transfer") return en ? "🔁 transfer variance" : "🔁 écart de transfert";
  if (flaggedBy === "stale")    return en ? "📦 not moving" : "📦 sans mouvement";
  return en ? "🎲 auto-check" : "🎲 auto-vérif";
}

export default function StockCheckPage() {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore(s => s.user?.role);
  const isOwner = role === "owner";
  // MP-DAMAGED-GOODS: owner/manager may write off sellable stock into a damaged pile.
  const canWriteoff = role === "owner" || role === "manager";
  const [tab, setTab] = useState("pending");           // pending | mismatch | resolved | damaged
  const [resolveFor, setResolveFor] = useState(null);  // pending row being counted (Done/Mismatch)
  const [varResolveFor, setVarResolveFor] = useState(null); // MISMATCH row being resolved-with-reason (owner)
  const [deleteFor, setDeleteFor] = useState(null);    // the pending row being deleted (owner)
  const [showWatch, setShowWatch] = useState(false);
  const [showWriteoff, setShowWriteoff] = useState(false); // MP-DAMAGED-GOODS: mark-damaged modal
  const [sellFor, setSellFor] = useState(null);        // MP-DAMAGED-GOODS: pile row being sold (qty prompt)
  const [scrapFor, setScrapFor] = useState(null);       // MP-DAMAGED-GOODS-SCRAP-OUT: pile row being scrapped (owner-only, qty prompt)
  const [range, setRange] = useState(wideRange());     // A2 date filter (≈1yr default → nothing hidden)
  const [damagedOnly, setDamagedOnly] = useState(false); // Resolved tab: shop's damage record

  // F2.3 one-time banner. Versioned key: a later change can raise its own banner
  // without un-dismissing this one, and this one never comes back.
  const F2_BANNER_KEY = "mp-stockcheck-f2-seen";
  const [showF2Banner, setShowF2Banner] = useState(() => {
    try { return localStorage.getItem(F2_BANNER_KEY) !== "1"; } catch { return false; }
  });
  const dismissF2Banner = () => {
    try { localStorage.setItem(F2_BANNER_KEY, "1"); } catch { /* private mode → just hide for this session */ }
    setShowF2Banner(false);
  };

  // F2.4 — the not-counted tally. Shared hook, NOT an inline useQuery: this key is
  // also read by Layout.jsx and AccountantLogPage.jsx, and react-query dedupes by
  // key, so a second declaration with a different queryFn shape would silently hand
  // one of them the other's data. That exact failure has already shipped twice
  // (["locations"], ["my-permissions"]).
  const summary = useStockCheckSummary();
  const notCounted30d = Number(summary.data?.data?.not_counted_30d) || 0;

  // MP-STOCK-CHECK-LIVE-VS-EXPECTED (Peter, 2026-07-17 — Paul was about to leave
  // over this): "Expected" freezes at movement time and silently drifts from
  // reality with every sale/transfer since — reading as a bug when it isn't
  // (chat verified the underlying stock is sound; only a handful of pre-Jul-11
  // rows are missing a LEDGER entry, never missing actual stock). Fix is to show
  // BOTH numbers, explicitly labelled, and keep "now" live: 5s poll instead of
  // 15s, and ONLY while this screen is actually open — refetchIntervalInBackground
  // is false (react-query's own default, set explicitly here so it's not an
  // accident of defaults), so it pauses the instant the tab/app loses focus, and
  // stops entirely the moment this component unmounts (navigating away).
  const list = useQuery({
    queryKey: ["stock-checks", tab],
    queryFn: () => api.get(`/stock-checks?status=${tab}`).then(r => toArray(r)),
    enabled: tab === "pending" || tab === "mismatch" || tab === "resolved", // damaged + stale are separate endpoints
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  // MP-DAMAGED-GOODS: the damaged-pile list (remaining_qty>0 rows), same date window.
  // MP-DAMAGED-GOODS-SCRAP-OUT: the response also carries scrap_loss (a separate
  // LOSS figure over the same window) — keep the envelope (r.data) instead of
  // unwrapping to a bare array with toArray() so both are readable.
  const damaged = useQuery({
    queryKey: ["stock-checks-damaged", range.from, range.to],
    queryFn: () => api.get(`/stock-checks/damaged?from=${range.from}&to=${range.to}`).then(r => r.data),
    enabled: tab === "damaged",
    refetchInterval: 15000,
  });

  // MP-STALE-PRODUCT-SCAN: the "not moving" ranked list — a snapshot, not
  // date-windowed (no range params). Separate endpoint/tab from Pending on
  // purpose (see the backend route's own comment).
  // MP-STOCK-CHECK-LIVE-VS-EXPECTED: "On hand" here is qty_before (a snapshot
  // from when it was flagged, same trust gap as Pending/Mismatch) — same 5s
  // live-while-open treatment, not just the label fix.
  const stale = useQuery({
    queryKey: ["stock-checks-stale"],
    queryFn: () => api.get("/stock-checks/stale").then(r => toArray(r)),
    enabled: tab === "stale",
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const watches = useQuery({
    queryKey: ["stock-check-watches"],
    queryFn: () => api.get("/stock-checks/watches").then(r => toArray(r)),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["stock-checks"] });
    qc.invalidateQueries({ queryKey: ["stock-checks-damaged"] });
    qc.invalidateQueries({ queryKey: ["stock-checks-stale"] });
    qc.invalidateQueries({ queryKey: ["stock-check-summary"] });
  };

  // MP-DAMAGED-GOODS: hand a damaged pile row off to the POS cart. We stash a
  // product-like payload + the pile row id in sessionStorage and route to /pos,
  // where a one-shot mount effect appends it as a DAMAGED line at the current
  // tier price. qty is clamped to remaining_qty (server also enforces ≤ remaining).
  const sellDamaged = (row, qty) => {
    const p = row.pa_products || {};
    const n = Math.max(1, Math.min(Number(qty) || 1, Number(row.remaining_qty) || 1));
    try {
      sessionStorage.setItem("mp-damaged-handoff", JSON.stringify({
        product_id: row.product_id,
        name: en ? (p.name_en || p.name) : p.name,
        unit: p.unit,
        barcode: p.barcode || null,
        sell_price: p.sell_price,
        wholesale_price: p.wholesale_price,
        min_price: p.min_price,
        // MP-DAMAGED-COST-NULL (audit finding P1.7, 2026-07-15): cost_price was
        // missing here, so the POS cart line built from this hand-off (below)
        // never had a cost to carry into pa_sale_items — every damaged-
        // clearance sale silently recorded cost_price NULL.
        cost_price: p.cost_price,
        quantity: n,
        is_damaged: true,
        damaged_source_id: row.id,
      }));
    } catch { /* storage full → POS just won't receive it; non-fatal */ }
    setSellFor(null);
    navigate("/pos");
  };

  // MP-DAMAGED-GOODS-SCRAP-OUT: owner-only second pile exit — a total loss, not a
  // sale. No POS hand-off; posts straight to the scrap endpoint.
  const scrapMut = useMutation({
    // MP-DAMAGED-OFFLINE-DEDUP (audit finding P1.5, 2026-07-15): local_id is
    // stamped once when the modal opens (see setScrapFor below) and reused
    // across every retry of THAT scrap attempt, so a network-timeout retry
    // can't double-consume the pile / double-log the loss.
    mutationFn: ({ id, quantity, note, local_id }) => api.post(`/stock-checks/damaged/${id}/scrap`, { quantity, note, local_id }).then(r => r.data),
    onSuccess: () => {
      toast.success(en ? "Scrapped — recorded as a loss" : "Mis au rebut — enregistré comme perte");
      setScrapFor(null);
      invalidateAll();
    },
    onError: (e) => {
      const code = e?.response?.data?.code;
      toast.error(code === "insufficient_stock"
        ? (en ? "Not enough left in the pile." : "Stock insuffisant dans la pile.")
        : (e?.response?.data?.message || (en ? "Failed" : "Échec")));
    },
  });

  // ── AUTO RE-BASELINE ON OPEN ────────────────────────────────────────────────
  // Paul's complaint: the system flags a product, staff sell some before he gets
  // to it, and his count is then refused for being measured against a stale
  // figure. The guard is right; he just had no way forward except a button he
  // could only see AFTER being refused.
  //
  // Opening the count screen now moves the baseline to live stock, so the number
  // he is shown is current at the moment he starts. It does NOT weaken the guard —
  // it narrows the window to the actual counting period (median 7m06s for this
  // org) instead of the days the check sat in the queue.
  //
  // Silent by design: this is a correction to what he is about to be shown, not an
  // event. A toast here would fire on every open and teach him to ignore toasts.
  const refreshBaselineMut = useMutation({
    mutationFn: (id) => api.post(`/stock-checks/${id}/refresh-baseline`).then(r => r.data),
    onSuccess: (res) => {
      // Only refetch when something actually moved — the endpoint no-ops otherwise.
      if (res && res.unchanged !== true) {
        setResolveFor((cur) => (cur && res.data && cur.id === res.data.id ? res.data : cur));
        invalidateAll();
      }
    },
    // A failure here must never block counting: he sees the old figure and the
    // guard still protects the write.
    onError: () => {},
  });
  // One entry point for "open the count screen", so the re-baseline cannot be
  // skipped by a second caller added later.
  const openCount = (row) => {
    setResolveFor(row);
    if (row && row.status === "pending") refreshBaselineMut.mutate(row.id);
  };

  const resolveMut = useMutation({
    mutationFn: ({ id, counted_qty, resolution }) =>
      api.post(`/stock-checks/${id}/verify`, { counted_qty, resolution }).then(r => r.data),
    onSuccess: (res) => {
      if (res.matches) {
        toast.success(en ? "✓ Counted — removed from the list" : "✓ Compté — retiré de la liste");
      } else {
        toast(en ? `⚠ Mismatch kept — expected ${res.expected}, counted ${res.counted}. The boss resolves it.`
                 : `⚠ Écart conservé — attendu ${res.expected}, compté ${res.counted}. Le patron le résout.`,
          { icon: "⚠️", duration: 6000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
      setResolveFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  // MP-COUNT-INTEGRITY (F2.3): a refused resolve must NOT be a toast that vanishes.
  // The refusal is the screen — it carries the two ways out (Recount / Remove), so
  // it is held in state and rendered inside the modal, which stays open.
  const [varRefusal, setVarRefusal] = useState(null);

  const recountMut = useMutation({
    mutationFn: (id) => api.post(`/stock-checks/${id}/recount`).then(r => r.data),
    onSuccess: (res) => {
      toast.success(en
        ? `Sent back to “To count” — now measured against today's stock (${res.rebaselined_to}).`
        : `Renvoyé dans « À compter » — mesuré sur le stock d'aujourd'hui (${res.rebaselined_to}).`,
        { duration: 6000 });
      setVarResolveFor(null); setVarRefusal(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  // MP-STALE-OUT-OF-QUEUE: "yes, it's genuinely just slow." Writes
  // verified + resolution_reason='slow_mover' + qty_counted null, which engages the
  // scan's existing 60-day cooldown WITHOUT claiming anyone counted anything.
  const ackSlowMut = useMutation({
    mutationFn: (id) => api.post(`/stock-checks/${id}/acknowledge-slow`).then(r => r.data),
    onSuccess: (res) => {
      toast.success(en
        ? `Acknowledged — we won't ask again for ${res.quiet_for_days || STALE_DAYS} days`
        : `Acquitté — nous n'en reparlerons pas avant ${res.quiet_for_days || STALE_DAYS} jours`);
      invalidateAll();
    },
    onError: (e) => {
      const b = e?.response?.data || {};
      toast.error((en ? b.message_en : b.message_fr) || b.message || (en ? "Failed" : "Échec"));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/stock-checks/${id}`).then(r => r.data),
    onSuccess: () => {
      toast.success(en ? "Flag deleted" : "Signalement supprimé");
      setDeleteFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  // F2.1: owner resolves a MISMATCH. stock_wrong corrects pa_stock to the true
  // quantity; count_wrong and not_counted leave it alone. Direction comes from the
  // sign of (resolved_qty − qty_expected), computed server-side and echoed back.
  const varResolveMut = useMutation({
    mutationFn: ({ id, reason, resolved_qty, sub_reason, note }) =>
      api.post(`/stock-checks/${id}/resolve`, { reason, resolved_qty, sub_reason, note }).then(r => r.data),
    onSuccess: (res) => {
      const msg = res.reason === "not_counted"
        ? (en ? "Removed from the list — recorded as not counted" : "Retiré de la liste — enregistré comme non compté")
        : res.corrected
          ? (en ? `Resolved — stock ${res.direction === "surplus" ? "raised" : "lowered"} to ${res.resolved_qty}`
                : `Résolu — stock ${res.direction === "surplus" ? "augmenté" : "réduit"} à ${res.resolved_qty}`)
          : (en ? "Resolved — stock left unchanged" : "Résolu — stock inchangé");
      toast.success(msg);
      setVarResolveFor(null); setVarRefusal(null);
      invalidateAll();
    },
    // A GUARD REFUSAL IS NOT AN ERROR TOAST. stale_count / baseline_mismatch /
    // resolve_on_transfer are the three the owner will actually meet, and each has
    // its own way forward; they go to the modal. Anything else is a genuine failure
    // and still gets a toast, so a real outage does not masquerade as a guard.
    onError: (e) => {
      const body = e?.response?.data || {};
      if (["stale_count", "baseline_mismatch", "resolve_on_transfer"].includes(body.code)) {
        setVarRefusal(body);
        return;
      }
      toast.error(body.message_en && en ? body.message_en : (body.message || (en ? "Failed" : "Échec")));
    },
  });

  const allRows = Array.isArray(list.data) ? list.data : [];
  // A2 date filter — by the timestamp that matters per tab (pending→created_at,
  // mismatch→verified_at, resolved→resolved_at), with created_at as a safe fallback.
  const rows = allRows.filter(r => {
    const ts = tab === "resolved" ? (r.resolved_at || r.created_at)
      : tab === "mismatch" ? (r.verified_at || r.created_at)
      : r.created_at;
    if (!inRange(ts, range.from, range.to)) return false;
    if (tab === "resolved" && damagedOnly && r.resolution_reason !== "damaged") return false;
    return true;
  });
  const watchList = Array.isArray(watches.data) ? watches.data : [];
  // MP-DAMAGED-GOODS: pile rows are already date-scoped + remaining_qty>0 server-side.
  const damagedRows = Array.isArray(damaged.data?.data) ? damaged.data.data : [];
  const scrapLoss = damaged.data?.scrap_loss || { quantity: 0, estimated_cost: 0 };
  const staleRows = Array.isArray(stale.data) ? stale.data : [];

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{en ? "Stock Check" : "Vérification de stock"}</div>
            <HelpButton topic="stock-check" />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, maxWidth: 620 }}>
            {en
              ? "Re-count products flagged at receive/transfer to catch miscounts early. This checks stock at movement time — it complements (doesn't replace) a full count."
              : "Recomptez les produits signalés à la réception/au transfert pour détecter tôt les écarts. Cela vérifie le stock au moment du mouvement — en complément d'un comptage complet."}
          </div>
        </div>
        {isOwner && (
          <button onClick={() => setShowWatch(true)} className="btn btn-primary" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
            ➕ {en ? "Watch a product" : "Surveiller un produit"}
          </button>
        )}
      </div>

      {/* ── MP-COUNT-INTEGRITY (F2.3) — ONE-TIME BANNER ──────────────────────
          Ships WITH the guard, never after. On day one the guard refuses 22 of the
          36 pending checks on prod, and every non-stale one of them, because those
          products have moved since they were flagged. Without this the owner opens
          a screen he has just been told is fixed and meets a wall of refusals with
          no explanation — which reads as the fix having broken it.
          Dismissed per-user in localStorage; the key is versioned so a future change
          can raise a new banner without clearing this one. */}
      {showF2Banner && (
        <div style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 12,
                      padding: "12px 14px", marginTop: 6, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ fontSize: 18, lineHeight: 1.2 }}>✅</div>
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            <div style={{ fontWeight: 800, color: "var(--text-primary, #fff)", marginBottom: 3 }}>
              {en ? "Counting is now protected" : "Le comptage est maintenant protégé"}
            </div>
            {en
              ? <>Two things changed. A count that finds a <b>difference can no longer be closed as done</b> — it is kept for you to resolve. And a variance <b>counted before the stock moved</b> is now refused instead of silently overwriting the sales and transfers since. You will see some refusals on older checks: use <b>Recount</b> to measure against today's stock, or <b>Remove from list</b> if it is not worth counting.</>
              : <>Deux changements. Un comptage qui trouve un <b>écart ne peut plus être clos comme « fait »</b> — il vous est conservé. Et un écart <b>compté avant que le stock ne bouge</b> est désormais refusé au lieu d'effacer les ventes et transferts survenus depuis. Vous verrez des refus sur d'anciennes vérifications : utilisez <b>Recompter</b> pour mesurer sur le stock d'aujourd'hui, ou <b>Retirer de la liste</b> si cela n'en vaut pas la peine.</>}
          </div>
          <button onClick={dismissF2Banner}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            {en ? "Got it" : "Compris"}
          </button>
        </div>
      )}

      {/* Watched products — persistent boss oversight. Owner adds/removes; every
          movement of a watched product into its location auto-creates a check. */}
      <WatchedSection watchList={watchList} loading={watches.isLoading} en={en} isOwner={isOwner}
        onRemoved={() => qc.invalidateQueries({ queryKey: ["stock-check-watches"] })} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        {["pending", "mismatch", "resolved", "damaged", "stale"].map(t => {
          // MP-STALE-OUT-OF-QUEUE: counts on the tabs, so the split is visible at a
          // glance instead of being something you have to click to discover. The
          // stale count is rendered MUTED and never joins the sidebar badge — an
          // observation should not look like a job.
          const n = t === "pending" ? summary.data?.data?.pending
            : t === "mismatch" ? summary.data?.data?.mismatch
            : t === "damaged" ? summary.data?.data?.damaged
            : t === "stale" ? summary.data?.data?.stale
            : null;
          return (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 700, fontSize: 13,
                background: tab === t ? "var(--brand-light)" : "transparent", color: tab === t ? "#1a1a2e" : "var(--text-secondary)" }}>
              {t === "pending" ? (en ? "To count" : "À compter")
                : t === "mismatch" ? (en ? "Mismatches" : "Écarts")
                : t === "resolved" ? (en ? "Resolved" : "Résolus")
                : t === "damaged" ? (en ? "Damaged" : "Endommagé")
                : (en ? "Not moving" : "Sans mouvement")}
              {n > 0 && (
                <span style={{ marginLeft: 6, fontWeight: 700, opacity: tab === t ? 0.75 : (t === "stale" ? 0.5 : 0.8) }}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* A2 date filter — applies to every tab except Not moving (a ranked
          snapshot, not a date-windowed list). */}
      {tab !== "stale" && <DateRangeFilter from={range.from} to={range.to} onChange={setRange} style={{ marginBottom: 12 }} />}

      {/* Resolved tab → "Damaged" filter = the shop's damage record (no separate table) */}
      {tab === "resolved" && (
        <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setDamagedOnly(v => !v)}
            style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${damagedOnly ? "#fbbf24" : "var(--border)"}`,
              background: damagedOnly ? "rgba(251,191,36,0.15)" : "transparent",
              color: damagedOnly ? "#fbbf24" : "var(--text-secondary)" }}>
            🔨 {en ? "Damaged only" : "Endommagés uniquement"}
          </button>

          {/* F2.4 — the not-counted tally. This is the condition attached to letting
              "not counted" exist at all: closing a real variance without counting it
              must cost something VISIBLE, or it is the Done hole again wearing a new
              label. Amber from 5 in 30 days — one is an exception, five is a habit. */}
          {notCounted30d > 0 && (
            <span title={en ? "Variances closed without a count in the last 30 days" : "Écarts clos sans comptage sur 30 jours"}
              style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                border: `1px solid ${notCounted30d >= NOT_COUNTED_AMBER_AT ? "#fbbf24" : "var(--border)"}`,
                background: notCounted30d >= NOT_COUNTED_AMBER_AT ? "rgba(251,191,36,0.15)" : "transparent",
                color: notCounted30d >= NOT_COUNTED_AMBER_AT ? "#fbbf24" : "var(--text-secondary)" }}>
              {notCounted30d >= NOT_COUNTED_AMBER_AT ? "⚠ " : ""}
              {en ? `Not counted (30 days): ${notCounted30d}` : `Non comptés (30 j) : ${notCounted30d}`}
            </span>
          )}
        </div>
      )}

      {/* MP-DAMAGED-GOODS: owner/manager can write sellable stock off into a pile. */}
      {tab === "damaged" && canWriteoff && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setShowWriteoff(true)} className="btn btn-primary" style={{ fontWeight: 700 }}>
            🔨 {en ? "Mark as damaged" : "Marquer endommagé"}
          </button>
        </div>
      )}

      {/* MP-DAMAGED-GOODS-SCRAP-OUT: a LOSS figure, kept visibly separate from
          Sell's revenue — same date window as the list below. Owner-only (a
          money-loss figure), same gate as the Scrap out action itself. */}
      {tab === "damaged" && isOwner && !damaged.isLoading && !damaged.isError && (scrapLoss.quantity > 0) && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12.5, color: "#f87171", fontWeight: 700 }}>
            🗑️ {en ? "Scrapped loss (this range)" : "Perte au rebut (cette période)"}
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#f87171" }}>
            {scrapLoss.quantity} {en ? "units" : "unités"} · ~{fmt(scrapLoss.estimated_cost)}
          </span>
        </div>
      )}

      {/* ── DAMAGED PILE tab: sell or record damaged goods ─────────────────── */}
      {tab === "damaged" && (<>
        {damaged.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
        {/* MP-DAMAGED-GOODS-ERROR-VISIBILITY: a fetch error was indistinguishable
            from a genuinely empty pile — both rendered "No damaged goods", so a
            transient failure silently hid rows that actually exist. */}
        {damaged.isError && (
          <div style={{ color: "#f87171", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid #f87171" }}>
            {en ? "Couldn't load the damaged pile. Pull to retry." : "Impossible de charger la pile endommagée. Tirez pour réessayer."}
          </div>
        )}
        {!damaged.isLoading && !damaged.isError && damagedRows.length === 0 && (
          <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
            {en ? "No damaged goods in this range." : "Aucune marchandise endommagée sur cette période."}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {damagedRows.map(r => {
            const p = r.pa_products || {};
            const loc = r.pa_locations || {};
            const remaining = Number(r.remaining_qty) || 0;
            const original = Number(r.original_qty) || 0;
            return (
              <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: "3px solid #fbbf24", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {en ? (p.name_en || p.name) : p.name}
                      {p.sku && <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{p.sku}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>📍 {loc.name || "—"}</span>
                      <span>{damageSourceLabel(r.source_type, en)}</span>
                      {r.source_ref && <span>#{r.source_ref}</span>}
                      <span>{fmtDate(r.created_at, en)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        {en ? "Remaining" : "Restant"}: <b style={{ color: "#fbbf24" }}>{remaining} {unitLabel(p.unit)}</b>
                        <span style={{ color: "var(--text-muted)" }}> {en ? "of" : "sur"} {original}</span>
                      </span>
                      {(p.sell_price != null) && <span style={{ color: "var(--text-muted)" }}>{en ? "Price" : "Prix"}: <b style={{ color: "var(--text-primary)" }}>{fmt(p.sell_price)}</b></span>}
                    </div>
                  </div>
                  <div style={{ alignSelf: "center", display: "flex", gap: 6 }}>
                    <button onClick={() => setSellFor(r)} className="btn btn-success" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      🛒 {en ? "Sell" : "Vendre"}
                    </button>
                    {/* MP-DAMAGED-GOODS-SCRAP-OUT: owner-only — beyond selling, a total loss. */}
                    {isOwner && (
                      <button onClick={() => setScrapFor({ ...r, _local_id: genLocalId() })} className="btn btn-secondary" style={{ fontWeight: 700, whiteSpace: "nowrap", color: "#f87171", borderColor: "#f87171" }}>
                        🗑️ {en ? "Scrap out" : "Mettre au rebut"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {(tab === "pending" || tab === "mismatch" || tab === "resolved") && (<>
      {list.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
      {!list.isLoading && rows.length === 0 && (
        <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
          {tab === "pending"
            ? (en ? "Nothing to re-count right now." : "Rien à recompter pour le moment.")
            : tab === "mismatch"
            ? (en ? "No mismatches in this range." : "Aucun écart sur cette période.")
            : (en ? "No resolved items in this range." : "Aucun élément résolu sur cette période.")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => {
          const p = r.pa_products || {};
          const loc = r.pa_locations || {};
          const isMismatch = r.status === "mismatch";
          const isResolved = r.status === "resolved";
          const showCounted = isMismatch || isResolved;
          const delta = showCounted ? (Number(r.qty_counted) - Number(r.qty_expected)) : null;
          const barColor = isResolved ? "#34d399" : isMismatch ? "#f87171" : "var(--brand-light)";
          return (
            <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: `3px solid ${barColor}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {en ? (p.name_en || p.name) : p.name}
                    {p.sku && <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{p.sku}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>📍 {loc.name || "—"}</span>
                    <span>{flaggedLabel(r.flagged_by, en)}</span>
                    <span>{r.movement_type === "receive" ? (en ? "receive" : "réception") : r.movement_type === "transfer" ? (en ? "transfer" : "transfert") : (en ? "manual" : "manuel")}</span>
                    {r.reference && <span>#{r.reference}</span>}
                    <span>{fmtDate(r.created_at, en)}</span>
                    {/* F2.3 LEGACY MARKER. Before the buffer RPC went live, stock could
                        change with no movement row, so Guard B's "has anything moved?"
                        test is blind for these rows and their frozen Expected proves
                        nothing. Say so on the row rather than only at the refusal. */}
                    {isLegacyCheck(r) && r.status !== "resolved" && (
                      <span title={en ? "Created before the counting fix — its Expected figure may be unreliable" : "Créée avant la correction — son « Attendu » peut être peu fiable"}
                        style={{ color: "#94a3b8", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 999, padding: "0 7px", fontSize: 11 }}>
                        🕗 {en ? "legacy" : "ancienne"}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Before" : "Avant"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_before)}</b></span>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Expected at movement time" : "Attendu au moment du mouvement"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_expected)} {unitLabel(p.unit)}</b></span>
                    {/* MP-STOCK-CHECK-LIVE-VS-EXPECTED: qty_now is live pa_stock, polled
                        every 5s while this screen is open — see attachLiveStock (backend)
                        and the list query above for how this stays fresh without hammering
                        the API. null only for the 'resolved' tab (enrichment skipped there). */}
                    {r.qty_now != null && (
                      <span style={{ color: "var(--text-muted)" }}>{en ? "In stock now" : "En stock actuellement"}: <b style={{ color: "#60a5fa" }}>{r.qty_now} {unitLabel(p.unit)}</b></span>
                    )}
                    {showCounted && <>
                      <span style={{ color: "var(--text-muted)" }}>{en ? "Counted" : "Compté"}: <b style={{ color: isResolved ? "var(--text-primary)" : "#f87171" }}>{Number(r.qty_counted)}</b></span>
                      <span style={{ color: isResolved ? "var(--text-muted)" : "#f87171", fontWeight: 700 }}>{delta > 0 ? "+" : ""}{delta}</span>
                    </>}
                  </div>
                  {/* Explain the gap instead of leaving it to guess — this exact
                      confusion ("Stock Check and Inventory don't agree") is what put
                      Paul's trust at risk. Sales/transfers since the flag are the normal,
                      expected reason; it's only worth a physical re-count either way. */}
                  {r.status === "pending" && r.qty_now != null && r.qty_now !== Number(r.qty_expected) && (
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4, fontStyle: "italic" }}>
                      {en
                        ? `Differs from a sale or transfer since this was flagged — that's expected. Count what's on the shelf now.`
                        : `Diffère à cause d'une vente ou d'un transfert depuis ce signalement — c'est normal. Comptez ce qui est sur l'étagère maintenant.`}
                    </div>
                  )}
                  {r.moved_by_name && (
                    <div style={{ fontSize: 12, color: isMismatch ? "#fca5a5" : "var(--text-muted)", marginTop: 4 }}>
                      👤 {en ? "Moved by" : "Déplacé par"}: <b>{r.moved_by_name}</b>
                      {showCounted && r.verified_by_name && <span> · {en ? "counted by" : "compté par"} {r.verified_by_name}</span>}
                    </div>
                  )}
                  {/* Part C: resolution audit line (what / why / who / when) */}
                  {isResolved && (() => {
                    // F2: not_counted is NOT a green success — nothing was verified.
                    // Rendering it in the same reassuring colour as a real resolution
                    // is exactly how a dismissal disguises itself as work done.
                    const dismissed = r.resolution_reason === "not_counted";
                    const noStockChange = dismissed || r.resolution_reason === "count_wrong" || r.resolution_reason === "confirmed_loss";
                    const c = dismissed ? { fg: "#94a3b8", bg: "rgba(148,163,184,0.09)", bd: "rgba(148,163,184,0.28)" }
                                        : { fg: "#34d399", bg: "rgba(52,211,153,0.08)", bd: "rgba(52,211,153,0.2)" };
                    return (
                      <div style={{ fontSize: 12, marginTop: 6, color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8, padding: "6px 10px" }}>
                        {dismissed ? "🕗" : "✅"} {reasonLabel(r.resolution_reason, en)}
                        {r.resolution_sub_reason && (
                          <span style={{ color: "var(--text-secondary)" }}> · {subReasonLabel(r.resolution_sub_reason, en)}</span>
                        )}
                        {!noStockChange && r.resolved_qty != null && (
                          <span style={{ color: "var(--text-secondary)" }}> · {en ? "corrected to" : "corrigé à"} <b>{Number(r.resolved_qty)}</b></span>
                        )}
                        {noStockChange && (
                          <span style={{ color: "var(--text-muted)" }}> · {en ? "stock unchanged" : "stock inchangé"}</span>
                        )}
                        {r.resolution_note && (
                          <div style={{ color: "var(--text-secondary)", marginTop: 3, fontStyle: "italic" }}>“{r.resolution_note}”</div>
                        )}
                        <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                          {r.resolved_by_name ? `${en ? "by" : "par"} ${r.resolved_by_name} · ` : ""}{fmtDate(r.resolved_at, en)}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {r.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, alignSelf: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={() => openCount(r)} className="btn btn-success" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      {en ? "Resolve count" : "Résoudre"}
                    </button>
                    {isOwner && (
                      <button onClick={() => setDeleteFor(r)} title={en ? "Delete this flag (no count)" : "Supprimer ce signalement"}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "#f87171", fontWeight: 700, padding: "0 12px", whiteSpace: "nowrap" }}>
                        🗑 {en ? "Delete" : "Supprimer"}
                      </button>
                    )}
                  </div>
                )}
                {/* Part B: owner resolves a mismatch (reason + corrected qty → stock fix). */}
                {isMismatch && isOwner && (
                  <div style={{ alignSelf: "center" }}>
                    <button onClick={() => setVarResolveFor(r)} className="btn btn-primary" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      🛠 {en ? "Resolve" : "Résoudre"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>)}

      {/* MP-STALE-PRODUCT-SCAN: "Not moving" — the inactivity mirror of Watch.
          Ranked by tied-up value (server-sorted); the boss triages worst-first
          rather than being nagged item-by-item. */}
      {tab === "stale" && (<>
        {stale.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
        {stale.isError && (
          <div style={{ color: "#f87171", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid #f87171" }}>
            {en ? "Couldn't load the stale-product list. Pull to retry." : "Impossible de charger la liste des produits sans mouvement. Tirez pour réessayer."}
          </div>
        )}
        {!stale.isLoading && !stale.isError && staleRows.length === 0 && (
          <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
            {en ? `Nothing flagged — everything has sold or moved in the last ${STALE_DAYS} days.` : `Rien à signaler — tout s'est vendu ou a bougé dans les ${STALE_DAYS} derniers jours.`}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
          {en ? `No sale and no receive/transfer in ${STALE_DAYS} days. Ranked by value tied up (highest first).`
              : `Aucune vente ni réception/transfert depuis ${STALE_DAYS} jours. Classé par valeur immobilisée (la plus élevée d'abord).`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {staleRows.map(r => {
            const p = r.pa_products || {};
            const loc = r.pa_locations || {};
            const qty = Number(r.qty_before) || 0;
            // MP-STOCK-CHECK-LIVE-VS-EXPECTED: "tied up" money should reflect what's
            // ACTUALLY on the shelf now, not the flag-time snapshot — falls back to
            // qty_before only if live stock is unavailable (no pa_stock row yet).
            const liveQty = r.qty_now != null ? r.qty_now : qty;
            const value = liveQty * (Number(p.cost_price) || 0);
            const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
            return (
              <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: "3px solid #94a3b8", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {en ? (p.name_en || p.name) : p.name}
                      {p.sku && <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{p.sku}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>📍 {loc.name || "—"}</span>
                      <span>{en ? `flagged ${days}d ago` : `signalé il y a ${days}j`}</span>
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        {en ? "On hand when flagged" : "En stock au signalement"}: <b style={{ color: "var(--text-primary)" }}>{qty} {unitLabel(p.unit)}</b>
                      </span>
                      {r.qty_now != null && (
                        <span style={{ color: "var(--text-muted)" }}>
                          {en ? "In stock now" : "En stock actuellement"}: <b style={{ color: "#60a5fa" }}>{r.qty_now} {unitLabel(p.unit)}</b>
                        </span>
                      )}
                      {value > 0 && <span style={{ color: "var(--text-muted)" }}>{en ? "Tied up" : "Immobilisé"}: <b style={{ color: "#f87171" }}>{fmt(value)}</b></span>}
                    </div>
                  </div>
                  <div style={{ alignSelf: "center", display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                    <button onClick={() => openCount(r)} className="btn btn-primary" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      🔍 {en ? "Count it" : "Compter"}
                    </button>
                    {/* MP-STALE-OUT-OF-QUEUE: the action that actually silences a slow
                        mover. Before this the only options were to count it or delete
                        it — and DELETE is the one thing that guarantees it returns,
                        because the nightly scan's 60-day cooldown keys on verified_at
                        and a deleted row has none. 27 cleared at midnight became 28 by
                        04:40. Owner-only, mirroring who can delete. */}
                    {isOwner && (
                      <button onClick={() => ackSlowMut.mutate(r.id)} disabled={ackSlowMut.isPending}
                        title={en ? `Stops asking for ${STALE_DAYS} days` : `N'en reparle plus pendant ${STALE_DAYS} jours`}
                        style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
                          border: "1px solid var(--border)", background: "transparent",
                          color: "var(--text-secondary)", fontSize: 12, fontWeight: 700 }}>
                        {ackSlowMut.isPending ? "…" : (en ? "It's just slow" : "C'est juste lent")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {resolveFor && (
        <ResolveModal row={resolveFor} en={en} busy={resolveMut.isPending}
          onCancel={() => setResolveFor(null)}
          onResolve={(counted_qty, resolution) => resolveMut.mutate({ id: resolveFor.id, counted_qty, resolution })} />
      )}

      {deleteFor && (
        <ConfirmDeleteModal row={deleteFor} en={en} busy={deleteMut.isPending}
          onCancel={() => setDeleteFor(null)} onConfirm={() => deleteMut.mutate(deleteFor.id)} />
      )}

      {varResolveFor && (
        <ResolveVarianceModal row={varResolveFor} en={en}
          busy={varResolveMut.isPending} recounting={recountMut.isPending}
          refusal={varRefusal}
          onClearRefusal={() => setVarRefusal(null)}
          onRecount={() => recountMut.mutate(varResolveFor.id)}
          onOpenTransfer={(id) => { setVarResolveFor(null); setVarRefusal(null); navigate(`/transfers?tr=${id}`); }}
          onCancel={() => { setVarResolveFor(null); setVarRefusal(null); }}
          onResolve={(payload) => varResolveMut.mutate({ id: varResolveFor.id, ...payload })} />
      )}

      {showWatch && <WatchProductModal en={en} onClose={() => setShowWatch(false)}
        onAdded={() => { setShowWatch(false); qc.invalidateQueries({ queryKey: ["stock-check-watches"] }); }} />}

      {/* MP-DAMAGED-GOODS: qty prompt then hand off to POS as a damaged line. */}
      {sellFor && (
        <SellDamagedModal row={sellFor} en={en} fmt={fmt}
          onCancel={() => setSellFor(null)}
          onSell={(qty) => sellDamaged(sellFor, qty)} />
      )}

      {/* MP-DAMAGED-GOODS-SCRAP-OUT: owner-only qty prompt, straight to the scrap endpoint. */}
      {scrapFor && (
        <ScrapDamagedModal row={scrapFor} en={en}
          busy={scrapMut.isPending}
          onCancel={() => setScrapFor(null)}
          onScrap={(qty, note) => scrapMut.mutate({ id: scrapFor.id, quantity: qty, note, local_id: scrapFor._local_id })} />
      )}

      {/* MP-DAMAGED-GOODS: owner/manager write-off (product + location + qty + note). */}
      {showWriteoff && (
        <MarkDamagedModal en={en} onClose={() => setShowWriteoff(false)}
          onDone={() => { setShowWriteoff(false); invalidateAll(); }} />
      )}
    </div>
  );
}

// Watched-products section — product · location · who · when, owner-only Remove.
function WatchedSection({ watchList, loading, en, isOwner, onRemoved }) {
  const [removing, setRemoving] = useState(null);
  const remove = async (w) => {
    setRemoving(w.id);
    try {
      await api.delete(`/stock-checks/watches/${w.id}`);
      toast.success(en ? "Stopped watching" : "Surveillance arrêtée");
      onRemoved();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
    } finally { setRemoving(null); }
  };
  if (loading) return null;
  if (!watchList.length) return null;
  return (
    <div style={{ marginTop: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-secondary)" }}>
        👁 {en ? "Watched products" : "Produits surveillés"}
        <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11.5 }}>
          {en ? "auto-checked on every movement into their location" : "auto-vérifiés à chaque mouvement vers leur emplacement"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {watchList.map(w => {
          const p = w.pa_products || {};
          const loc = w.pa_locations || {};
          return (
            <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--bg-elevated)", borderRadius: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>📍 {loc.name || "—"}</span>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {w.created_by_name ? `${en ? "by" : "par"} ${w.created_by_name} · ` : ""}{fmtDate(w.created_at, en)}
                </div>
              </div>
              {isOwner && (
                <button onClick={() => remove(w)} disabled={removing === w.id}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textDecoration: "underline", whiteSpace: "nowrap" }}>
                  {removing === w.id ? "…" : (en ? "Remove" : "Retirer")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MP-COUNT-INTEGRITY (F2.2/F2.3) — enter the physical count ────────────────
// REBUILT, not patched. The old modal presented Done and Mismatch as a CHOICE
// after typing a number, with Done as the green primary. Staff took the green
// button, a confirm dialog told them in plain words that the difference would not
// be recorded, and they took it anyway — because "Mismatch" reads as an accusation
// against yourself. That is not a copy problem; it is a question that should never
// have been asked. The count either matches or it doesn't, and that is arithmetic,
// not an opinion.
//
// So there is now ONE action — Record count — and the modal shows, live, what the
// number entered will be recorded as. The backend enforces the same rule (a
// difference can never be stamped verified), so the two cannot drift apart.
//
// The only remaining choice is the SAFE direction: escalate a MATCHING count to a
// mismatch, for "the number is right but something is wrong here". You can no
// longer suppress a difference, only raise one.
function ResolveModal({ row, en, onCancel, onResolve, busy }) {
  const p = row.pa_products || {};
  const expected = Number(row.qty_expected) || 0;
  const [value, setValue] = useState("");
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 0 && value !== "";
  const matches = valid && n === expected;
  const diff = valid ? n - expected : 0;

  // The snapshot has already drifted: "Expected" describes a moment that has passed.
  // Previously this was a grey footnote UNDER the input and the Done button sat
  // beside it regardless — the page showed the staleness and then let it be
  // overridden in the same breath. It is now stated first, above the field, in the
  // colour of a warning, because it changes what the number being typed MEANS.
  const stale = row.qty_now != null && row.qty_now !== expected;
  const legacy = isLegacyCheck(row);

  const submit = (resolution) => {
    if (!valid) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; }
    onResolve(n, resolution);
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 430 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Record count" : "Enregistrer le comptage"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>

        {/* Both numbers, equally weighted and explicitly labelled — not one number
            with the other as a footnote. */}
        <div style={{ display: "flex", gap: 8, marginBottom: stale || legacy ? 10 : 14 }}>
          <div style={{ flex: 1, background: "var(--bg-elevated, rgba(255,255,255,0.04))", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {en ? "Expected (when flagged)" : "Attendu (au signalement)"}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{expected}</div>
          </div>
          <div style={{ flex: 1, background: "var(--bg-elevated, rgba(255,255,255,0.04))", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {en ? "In stock now" : "En stock maintenant"}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: stale ? "#fbbf24" : undefined }}>
              {row.qty_now != null ? row.qty_now : "—"}
            </div>
          </div>
        </div>

        {(stale || legacy) && (
          <div style={{ fontSize: 12, lineHeight: 1.55, background: "rgba(251,191,36,0.09)", border: "1px solid rgba(251,191,36,0.3)",
                        borderRadius: 10, padding: "9px 11px", marginBottom: 14, color: "#fbbf24" }}>
            {legacy
              ? (en ? "⚠ This check is from before the counting fix. Its “Expected” figure may not be reliable. Count what is physically on the shelf — the boss will re-baseline it."
                    : "⚠ Cette vérification date d'avant la correction. Son « Attendu » peut être peu fiable. Comptez ce qui est physiquement en rayon — le patron refera la base.")
              : (en ? `⚠ Stock has moved since this was flagged (${expected} → ${row.qty_now}). Count what is physically there now; the difference will be kept for the boss.`
                    : `⚠ Le stock a bougé depuis le signalement (${expected} → ${row.qty_now}). Comptez ce qui est réellement là ; l'écart sera conservé pour le patron.`)}
          </div>
        )}

        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
          {en ? "How many did you physically count?" : "Combien avez-vous physiquement compté ?"}
        </label>
        <input className="input" type="number" min="0" autoFocus value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit(undefined)}
          placeholder={en ? "Counted quantity" : "Quantité comptée"} style={{ marginTop: 6 }} />

        {/* LIVE OUTCOME. The old flow made the user pick the outcome; this one
            states it before they commit, so there is nothing left to "click through". */}
        <div style={{ fontSize: 12.5, marginTop: 10, minHeight: 34, lineHeight: 1.5,
                      color: !valid ? "var(--text-muted)" : matches ? "#34d399" : "#fbbf24" }}>
          {!valid
            ? (en ? "Enter the count to see what will be recorded." : "Entrez le comptage pour voir ce qui sera enregistré.")
            : matches
              ? (en ? `✓ Matches (${expected}). This will be recorded as counted and cleared from the list.`
                    : `✓ Correspond (${expected}). Sera enregistré comme compté et retiré de la liste.`)
              : (en ? `⚠ Off by ${diff > 0 ? "+" : ""}${diff}. This will be kept as a MISMATCH for the boss to resolve — a difference cannot be closed as done.`
                    : `⚠ Écart de ${diff > 0 ? "+" : ""}${diff}. Sera conservé comme ÉCART à résoudre par le patron — un écart ne peut pas être clos comme « fait ».`)}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2, fontWeight: 700 }} disabled={busy || !valid} onClick={() => submit(undefined)}>
            {busy ? "…" : (en ? "Record count" : "Enregistrer")}
          </button>
        </div>

        {/* The one remaining escalation, and only in the safe direction. */}
        {matches && !busy && (
          <button onClick={() => submit("mismatch")}
            style={{ display: "block", margin: "10px auto 0", background: "none", border: "none", cursor: "pointer",
                     color: "var(--text-muted)", fontSize: 11.5, textDecoration: "underline" }}>
            {en ? "It matches, but something is still wrong — flag it anyway"
                : "Ça correspond, mais quelque chose cloche — signaler quand même"}
          </button>
        )}
      </div>
    </div>
  );
}

// Owner-only: delete a PENDING flag without counting (a false flag / duplicate).
function ConfirmDeleteModal({ row, en, onCancel, onConfirm, busy }) {
  const p = row.pa_products || {};
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{en ? "Delete this flag?" : "Supprimer ce signalement ?"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
          {en
            ? `This removes the pending check for "${p.name_en || p.name}" without counting it. Use this only for a false flag or a duplicate — it can't be undone.`
            : `Cela retire la vérification en attente pour « ${p.name} » sans la compter. À n'utiliser que pour un faux signalement ou un doublon — irréversible.`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn" style={{ flex: 1.6, background: "#7f1d1d", color: "#fecaca", fontWeight: 700 }} disabled={busy} onClick={onConfirm}>
            {busy ? "…" : (en ? "🗑 Delete flag" : "🗑 Supprimer")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MP-COUNT-INTEGRITY (F2.1/F2.3) — owner resolves a MISMATCH ───────────────
// REBUILT. Asks the one question that matters (which number is wrong?), derives
// direction from the sign rather than from a word, and — critically — renders the
// backend's REFUSALS as a first-class state with a way out of each.
//
// The refusal copy is not decoration. On the day this ships, 22 of the 36 pending
// checks on prod will be refused by Guard B, and every non-stale one of them will,
// because each of those products has moved since it was flagged. Without this panel
// the owner meets a wall of red toasts on the screen he has just been told is now
// trustworthy. The guard and this panel ship together or neither ships.
function ResolveVarianceModal({ row, en, busy, recounting, onCancel, onResolve, refusal, onClearRefusal, onRecount, onOpenTransfer }) {
  const p = row.pa_products || {};
  const expected = Number(row.qty_expected) || 0;
  const counted = Number(row.qty_counted) || 0;
  const legacy = isLegacyCheck(row);

  const [reason, setReason] = useState("stock_wrong");
  const [qty, setQty] = useState(String(counted));       // best available number
  const [subReason, setSubReason] = useState("");
  const [note, setNote] = useState("");

  // What the shelf holds RIGHT NOW. baseline_mismatch reports it authoritatively
  // (that refusal exists because it disagrees with the frozen figure); otherwise
  // fall back to the live qty_now the list query attaches to every non-resolved row.
  const liveNow = (refusal && typeof refusal.stock_now === "number") ? refusal.stock_now
    : (row.qty_now != null ? Number(row.qty_now) : null);

  const branch = RESOLVE_BRANCHES.find(b => b.key === reason) || RESOLVE_BRANCHES[0];
  const n = Number(qty);
  const qtyValid = Number.isFinite(n) && n >= 0 && qty !== "";
  // DIRECTION FROM THE SIGN — never from the reason word. Mirrors the backend.
  const delta = qtyValid ? n - expected : 0;
  const subOptions = delta < 0 ? SUB_SHORTFALL : SUB_SURPLUS;

  // Changing the answer invalidates a refusal that was about the previous answer.
  const pick = (key) => { setReason(key); if (refusal) onClearRefusal(); };
  // A sub reason chosen for one direction is meaningless in the other; drop it
  // rather than submit something the backend will (correctly) refuse.
  useEffect(() => {
    if (subReason && !subOptions.some(o => o.key === subReason)) setSubReason("");
  }, [delta < 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = reason === "not_counted" ? note.trim().length > 0
    : reason === "count_wrong" ? true
    : qtyValid && delta !== 0;

  const submit = () => {
    if (!canSubmit) return;
    onResolve({
      reason,
      // count_wrong asserts the SYSTEM figure stands; sending anything else is a
      // contradiction the backend rejects, so the UI never lets one be formed.
      resolved_qty: reason === "count_wrong" ? expected : (reason === "not_counted" ? expected : n),
      sub_reason: reason === "stock_wrong" && subReason ? subReason : null,
      note: note.trim() || null,
    });
  };

  // ── REFUSAL PANEL ─────────────────────────────────────────────────────────
  const code = refusal && refusal.code;
  const refusalView = () => {
    if (code === "resolve_on_transfer") {
      return (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {en ? "This check came from a transfer. The destination was already credited with what was received, so correcting it here would subtract the shortfall twice."
                : "Cette vérification vient d'un transfert. La destination a déjà été créditée de ce qui a été reçu ; corriger ici retirerait le manque deux fois."}
          </div>
          {refusal.transfer_number && (
            <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--text-secondary)" }}>
              {en ? "Resolve it on transfer" : "À résoudre sur le transfert"} <b>{refusal.transfer_number}</b>.
            </div>
          )}
        </>
      );
    }
    if (code === "baseline_mismatch") {
      return (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {en ? <>The count expected <b>{refusal.qty_expected}</b> but stock is at <b>{refusal.stock_now}</b>, with no movement recorded to explain the gap. Something changed this product outside the normal paths, so correcting it now would write a number we cannot justify. <b>Recount it.</b></>
              : <>Le comptage attendait <b>{refusal.qty_expected}</b> mais le stock est à <b>{refusal.stock_now}</b>, sans aucun mouvement pour l'expliquer. Ce produit a changé hors des chemins normaux ; corriger maintenant écrirait un chiffre injustifiable. <b>Recomptez.</b></>}
        </div>
      );
    }
    // stale_count — the common case on deploy day.
    // The date shown is counted_at, which is the BASELINE (greatest of created_at and
    // rebaselined_at) — not when the check was first raised. After a recount those
    // differ, and quoting the original date would tell the owner his count was stale
    // from three weeks before the recount he just performed.
    const since = refusal?.counted_at ? fmtDate(refusal.counted_at, en) : null;
    return (
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        {en ? <>This was <b>counted before the stock changed</b>{typeof refusal?.moved_count === "number" ? <> — {refusal.moved_count} movement{refusal.moved_count === 1 ? "" : "s"}{since ? ` since ${since}` : " since"}, net {refusal.net_since_count > 0 ? "+" : ""}{refusal.net_since_count}</> : null}. Correcting from the old count would wipe every sale and transfer that happened in between.</>
            : <>Ceci a été <b>compté avant que le stock ne change</b>{typeof refusal?.moved_count === "number" ? <> — {refusal.moved_count} mouvement(s){since ? ` depuis le ${since}` : " depuis"}, net {refusal.net_since_count > 0 ? "+" : ""}{refusal.net_since_count}</> : null}. Corriger à partir de l'ancien comptage effacerait toutes les ventes et transferts survenus entre-temps.</>}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && !recounting && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Resolve variance" : "Résoudre l'écart"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>

        {/* ── THE FOUR NUMBERS, EACH LABELLED BY WHEN IT WAS TRUE ────────────
            "System said" was wrong on both counts: it did not say WHEN, and there
            was no figure for now. On a stale check the panel therefore showed
            "SYSTEM SAID 88" beside a warning that stock is no longer 88, and never
            said what it actually is — the owner is told the number is wrong and not
            told the right one. The list row and the staff count modal have said
            "Expected (when flagged)" vs "In stock now" all along; the owner modal
            is the one place that did not, so it is the one place that confused.
            In stock now is sourced from the refusal when it carries one
            (baseline_mismatch reports stock_now authoritatively) and otherwise from
            the row's live qty_now, which the list query already attaches. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {[
            { label: en ? "Expected (when flagged)" : "Attendu (au signalement)", v: expected },
            { label: en ? "Counted" : "Compté", v: counted },
            { label: en ? "Difference" : "Différence", v: `${counted - expected > 0 ? "+" : ""}${counted - expected}`,
              amber: counted !== expected },
            ...(liveNow != null ? [{ label: en ? "In stock now" : "En stock maintenant", v: liveNow,
              amber: liveNow !== expected, live: true }] : []),
          ].map((t) => (
            <div key={t.label} style={{ flex: "1 1 40%", minWidth: 96,
              background: t.live && t.amber ? "rgba(251,191,36,0.10)" : "var(--bg-elevated, rgba(255,255,255,0.04))",
              border: t.live && t.amber ? "1px solid rgba(251,191,36,0.3)" : "1px solid transparent",
              borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: t.amber ? "#fbbf24" : undefined }}>{t.v}</div>
            </div>
          ))}
        </div>

        {legacy && !refusal && (
          <div style={{ fontSize: 12, lineHeight: 1.55, background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.3)",
                        borderRadius: 10, padding: "9px 11px", marginBottom: 12, color: "var(--text-secondary)" }}>
            {en ? "🕗 Legacy check — created before the counting fix. Stock could move without leaving a record back then, so these numbers may not be comparable. Prefer Recount."
                : "🕗 Vérification ancienne — créée avant la correction. Le stock pouvait bouger sans laisser de trace ; ces chiffres ne sont peut-être pas comparables. Préférez Recompter."}
          </div>
        )}

        {refusal ? (
          <>
            <div style={{ background: "rgba(251,191,36,0.09)", border: "1px solid rgba(251,191,36,0.32)",
                          borderRadius: 10, padding: "11px 13px", color: "#fbbf24" }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
                {code === "resolve_on_transfer"
                  ? (en ? "Resolve this on the transfer" : "À résoudre sur le transfert")
                  : (en ? "Counted before the update" : "Compté avant la mise à jour")}
              </div>
              {refusalView()}
            </div>

            {/* GUARD A'S EXIT. This is the whole reason not_counted is NOT exempt
                from Guard A: the transfer variance has somewhere to go, so it must
                be prompted rather than dismissed. The prompt is only a prompt if it
                actually opens the transfer — a refusal naming a transfer number with
                no way to reach it is a dead end wearing a hand-off's clothes.
                20 Complete Chain Bajaj left Principal Magazine and were credited
                nowhere; this button is what stops the next 20. */}
            {code === "resolve_on_transfer" && refusal.transfer_id && (
              <button className="btn btn-primary" style={{ width: "100%", marginTop: 14, fontWeight: 700 }}
                disabled={busy} onClick={() => onOpenTransfer(refusal.transfer_id)}>
                {en ? "Open the transfer" : "Ouvrir le transfert"} {refusal.transfer_number ? `· ${refusal.transfer_number}` : ""}
              </button>
            )}

            {code !== "resolve_on_transfer" && (
              <>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="btn btn-primary" style={{ flex: 1.5, fontWeight: 700 }} disabled={busy || recounting} onClick={onRecount}>
                    {recounting ? "…" : (en ? "↻ Use today's stock" : "↻ Utiliser le stock du jour")}
                  </button>
                  <button className="btn" style={{ flex: 1.5, background: "#3f3f46", color: "#e4e4e7", fontWeight: 600 }}
                    disabled={busy || recounting}
                    onClick={() => { setReason("not_counted"); onClearRefusal(); }}>
                    {en ? "Remove from list" : "Retirer de la liste"}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                  {en ? "This re-measures against today's stock and sends it back to “To count” — your walk of the shelf is not wasted. Remove closes it without a count — that needs a reason and is counted for 30 days."
                      : "Recompter le renvoie dans « À compter », mesuré sur le stock d'aujourd'hui. Retirer le ferme sans comptage — il faut une raison, et c'est compté pendant 30 jours."}
                </div>
              </>
            )}
            <button className="btn btn-secondary" style={{ width: "100%", marginTop: 10 }} disabled={busy || recounting} onClick={onCancel}>
              {en ? "Close" : "Fermer"}
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
              {en ? "Which number is wrong?" : "Quel chiffre est faux ?"}
            </label>
            <div style={{ marginTop: 8, marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {RESOLVE_BRANCHES.map(b => (
                <button key={b.key} onClick={() => pick(b.key)} disabled={busy}
                  style={{ textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                           background: reason === b.key ? "rgba(99,102,241,0.14)" : "transparent",
                           border: `1px solid ${reason === b.key ? "rgba(99,102,241,0.55)" : "var(--border, rgba(255,255,255,0.12))"}` }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{en ? b.en : b.fr}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.45 }}>{en ? b.hintEn : b.hintFr}</div>
                </button>
              ))}
            </div>

            {reason === "stock_wrong" && (<>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
                {en ? "True quantity on the shelf" : "Quantité réelle en rayon"}
              </label>
              <input className="input" type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} style={{ marginTop: 6 }} />
              {/* Direction is SHOWN, never chosen. */}
              <div style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5, color: !qtyValid ? "var(--text-muted)" : delta === 0 ? "#fbbf24" : delta < 0 ? "#f87171" : "#34d399" }}>
                {!qtyValid ? (en ? "Enter the corrected quantity." : "Entrez la quantité corrigée.")
                  : delta === 0 ? (en ? "That is already the system's figure — nothing to correct." : "C'est déjà le chiffre du système — rien à corriger.")
                  : delta < 0 ? (en ? `Stock goes DOWN by ${Math.abs(delta)} (${expected} → ${n}).` : `Le stock BAISSE de ${Math.abs(delta)} (${expected} → ${n}).`)
                  : (en ? `Stock goes UP by ${delta} (${expected} → ${n}).` : `Le stock MONTE de ${delta} (${expected} → ${n}).`)}
              </div>

              {qtyValid && delta !== 0 && (<>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, display: "block", marginTop: 12 }}>
                  {delta < 0 ? (en ? "Where did they go? (optional)" : "Où sont-elles passées ? (facultatif)")
                             : (en ? "Where did they come from? (optional)" : "D'où viennent-elles ? (facultatif)")}
                </label>
                <select className="input" value={subReason} onChange={e => setSubReason(e.target.value)} style={{ marginTop: 6 }}>
                  <option value="">{en ? "— not specified —" : "— non précisé —"}</option>
                  {subOptions.map(o => <option key={o.key} value={o.key}>{en ? o.en : o.fr}</option>)}
                </select>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                  {subReason === "damaged"
                    ? (en ? `📦 ${Math.abs(delta)} unit(s) will be added to the Damaged pile, where they can still be sold cheap or scrapped.`
                          : `📦 ${Math.abs(delta)} unité(s) iront dans la pile Endommagés, où elles peuvent encore être vendues ou mises au rebut.`)
                    : (en ? "Recorded for the record only — it does not change the correction."
                          : "Enregistré pour la trace uniquement — cela ne change pas la correction.")}
                </div>
              </>)}
            </>)}

            {reason === "count_wrong" && (
              <div style={{ fontSize: 12.5, lineHeight: 1.6, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)",
                            borderRadius: 10, padding: "10px 12px" }}>
                {en ? <>Stock stays at <b>{expected}</b>. Nothing is corrected and no adjustment is written — the variance is closed as a counting error.</>
                    : <>Le stock reste à <b>{expected}</b>. Rien n'est corrigé et aucun ajustement n'est écrit — l'écart est clos comme erreur de comptage.</>}
              </div>
            )}

            {reason === "not_counted" && (
              <div style={{ background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 8 }}>
                  {en ? "Stock is not touched. This is counted on your Resolved tab and in the Accountant Log for 30 days, so dismissals stay visible."
                      : "Le stock n'est pas modifié. Ceci est compté dans l'onglet Résolus et dans le Journal comptable pendant 30 jours, pour que les abandons restent visibles."}
                </div>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                  {en ? "Why was it not counted? (required)" : "Pourquoi n'a-t-il pas été compté ? (obligatoire)"}
                </label>
                <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 6, resize: "vertical" }}
                  placeholder={en ? "e.g. product no longer stocked, duplicate flag, shop was closed…" : "ex. produit arrêté, doublon, boutique fermée…"} />
              </div>
            )}

            {reason !== "not_counted" && (
              <>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, display: "block", marginTop: 12 }}>
                  {en ? "Note (optional)" : "Note (facultative)"}
                </label>
                <input className="input" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 6 }}
                  placeholder={en ? "Anything the boss should remember about this" : "Ce qu'il faut retenir à ce sujet"} />
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !canSubmit} onClick={submit}>
                {busy ? "…" : (en ? "Resolve" : "Résoudre")}
              </button>
            </div>
            <button onClick={onRecount} disabled={busy || recounting}
              style={{ display: "block", margin: "10px auto 0", background: "none", border: "none", cursor: "pointer",
                       color: "var(--text-muted)", fontSize: 11.5, textDecoration: "underline" }}>
              {recounting ? "…" : (en ? "↻ Send back for a recount instead" : "↻ Renvoyer pour un recomptage")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Owner-only: watch a product (fuzzy search via search_products_fuzzy, kit parents
// excluded) at a chosen location. Persists to pa_stock_check_watches → every future
// movement of it into that location auto-creates a check.
function WatchProductModal({ en, onClose, onAdded }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);   // { id, name }
  const [locId, setLocId] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useQuery({
    queryKey: ["stock-check-product-search", q],
    // Same fuzzy path POS/Inventory use (search_products_fuzzy). toArray() guarantees
    // an array regardless of the envelope shape, then drop kit parents (no stock row).
    queryFn: () => api.get(`/products?search=${encodeURIComponent(q)}`).then(r => toArray(r).filter(p => !p.is_multipart)),
    enabled: q.trim().length >= 1 && !picked,
  });
  // MP-LOCATIONS-CACHE-FIX: queryKey ["locations"] is shared app-wide (POS,
  // Transfers, Inventory, …) and MUST use the same queryFn shape as everyone
  // else — react-query dedupes by key, so a mismatched queryFn here never even
  // runs once another component's query has already populated the cache,
  // silently handing this component the other shape instead.
  const locs = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
  });
  const results = Array.isArray(search.data) ? search.data : [];
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  const add = async () => {
    if (!picked || !locId) return;
    setBusy(true);
    try {
      await api.post("/stock-checks/watches", { product_id: picked.id, location_id: locId });
      toast.success(en ? "Now watching this product" : "Produit maintenant surveillé");
      onAdded();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Watch a product" : "Surveiller un produit"}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {en
            ? "Every receive/transfer of this product into the chosen location will be auto-flagged for a re-count."
            : "Chaque réception/transfert de ce produit vers l'emplacement choisi sera auto-signalé pour un recomptage."}
        </div>

        {!picked ? (
          <>
            <input className="input" autoFocus placeholder={en ? "Search product (name / SKU)…" : "Chercher un produit (nom / SKU)…"}
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
              {search.isLoading && <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "Searching…" : "Recherche…"}</div>}
              {results.map(p => (
                <div key={p.id} onClick={() => setPicked({ id: p.id, name: en ? (p.name_en || p.name) : p.name })}
                  style={{ padding: "9px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseDown={e => e.preventDefault()}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{[p.sku, p.barcode].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              ))}
              {q.trim().length >= 1 && !search.isLoading && results.length === 0 &&
                <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "No match." : "Aucun résultat."}</div>}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700 }}>{picked.name}</span>
              <button onClick={() => { setPicked(null); }} style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 12 }}>{en ? "change" : "changer"}</button>
            </div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Location to watch" : "Emplacement à surveiller"}</label>
            <select className="input" value={locId} onChange={e => setLocId(e.target.value)} style={{ marginTop: 6 }}>
              <option value="">{en ? "— pick a location —" : "— choisir un emplacement —"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !picked || !locId} onClick={add}>
            {busy ? "…" : (en ? "➕ Watch this product" : "➕ Surveiller")}
          </button>
        </div>
      </div>
    </div>
  );
}

// MP-DAMAGED-GOODS: qty prompt before selling a damaged pile row. Defaults to the
// full remaining_qty and caps at it (the server also enforces ≤ remaining_qty).
function SellDamagedModal({ row, en, fmt, onCancel, onSell }) {
  const p = row.pa_products || {};
  const remaining = Number(row.remaining_qty) || 0;
  const [qty, setQty] = useState(String(remaining || 1));
  const n = Number(qty);
  const valid = Number.isFinite(n) && n >= 1 && n <= remaining && qty !== "";
  const submit = () => {
    if (!valid) { toast.error(en ? `Enter 1–${remaining}` : `Entrez 1–${remaining}`); return; }
    onSell(n);
  };
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Sell damaged item" : "Vendre l'article endommagé"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
          {en ? "Quantity to sell" : "Quantité à vendre"}
        </label>
        <input className="input" type="number" min="1" max={remaining} autoFocus value={qty}
          onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={{ marginTop: 6 }} />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
          {en ? `${remaining} ${unitLabel(p.unit)} remaining.` : `${remaining} ${unitLabel(p.unit)} restant(s).`}
          {p.sell_price != null && <span> {en ? "Sold at the normal tier price" : "Vendu au prix normal du palier"} ({fmt(p.sell_price)}); {en ? "a discount may be applied at the till." : "une remise peut être appliquée en caisse."}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-success" style={{ flex: 2, fontWeight: 700 }} disabled={!valid} onClick={submit}>
            🛒 {en ? "Add to sale" : "Ajouter à la vente"}
          </button>
        </div>
      </div>
    </div>
  );
}

// MP-DAMAGED-GOODS-SCRAP-OUT: owner-only — beyond selling, a total loss (thrown
// away). Straight POST to /stock-checks/damaged/:id/scrap, no POS hand-off. A
// second, distinct pile exit from Sell: this books NO revenue, just a loss.
function ScrapDamagedModal({ row, en, busy, onCancel, onScrap }) {
  const p = row.pa_products || {};
  const remaining = Number(row.remaining_qty) || 0;
  const [qty, setQty] = useState(String(remaining || 1));
  const [note, setNote] = useState("");
  const n = Number(qty);
  const valid = Number.isFinite(n) && n >= 1 && n <= remaining && qty !== "";
  const submit = () => {
    if (!valid) { toast.error(en ? `Enter 1–${remaining}` : `Entrez 1–${remaining}`); return; }
    onScrap(n, note.trim() || null);
  };
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>🗑️ {en ? "Scrap out" : "Mettre au rebut"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>
        <div style={{ fontSize: 12, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
          {en
            ? "For total losses — beyond selling. This removes stock from the damaged pile as a LOSS, with no sale and no revenue. Cannot be undone."
            : "Pour les pertes totales — au-delà de la vente. Ceci retire le stock de la pile endommagée comme une PERTE, sans vente ni revenu. Ne peut pas être annulé."}
        </div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
          {en ? "Quantity to scrap" : "Quantité à mettre au rebut"}
        </label>
        <input className="input" type="number" min="1" max={remaining} autoFocus value={qty}
          onChange={e => setQty(e.target.value)} style={{ marginTop: 6, marginBottom: 12 }} />
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Note (optional)" : "Note (facultatif)"}</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)}
          placeholder={en ? "e.g. beyond repair" : "ex. irréparable"} style={{ marginTop: 6 }} />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
          {en ? `${remaining} ${unitLabel(p.unit)} remaining.` : `${remaining} ${unitLabel(p.unit)} restant(s).`}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn" style={{ flex: 2, fontWeight: 700, background: "#ef4444", color: "#fff", border: "none" }} disabled={!valid || busy} onClick={submit}>
            {busy ? "…" : (en ? "🗑️ Confirm scrap" : "🗑️ Confirmer le rebut")}
          </button>
        </div>
      </div>
    </div>
  );
}

// MP-DAMAGED-GOODS: owner/manager write-off — pick a product + location, enter the
// damaged quantity + optional note → POST /stock-checks/damaged/writeoff. This
// decrements sellable stock and creates a pile row. Mirrors WatchProductModal's
// fuzzy product/location pickers.
function MarkDamagedModal({ en, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);   // { id, name }
  const [locId, setLocId] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // MP-DAMAGED-OFFLINE-DEDUP (audit finding P1.5, 2026-07-15): one local_id for
  // this modal's whole lifetime — every retry of the SAME write-off attempt (a
  // network-timeout retry, not a fresh "Mark as damaged" open) reuses it, so
  // the backend's dedup can't be defeated by generating a new id per retry.
  const localIdRef = useRef(genLocalId());

  const search = useQuery({
    queryKey: ["stock-check-product-search", q],
    queryFn: () => api.get(`/products?search=${encodeURIComponent(q)}`).then(r => toArray(r).filter(p => !p.is_multipart)),
    enabled: q.trim().length >= 1 && !picked,
  });
  // MP-LOCATIONS-CACHE-FIX: queryKey ["locations"] is shared app-wide (POS,
  // Transfers, Inventory, …) and MUST use the same queryFn shape as everyone
  // else — react-query dedupes by key, so a mismatched queryFn here never even
  // runs once another component's query has already populated the cache,
  // silently handing this component the other shape instead. That's why this
  // dropdown shipped empty in vc65 despite the org having active locations.
  const locs = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
  });
  const results = Array.isArray(search.data) ? search.data : [];
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  // Sensible default: with only one location there's nothing to choose.
  useEffect(() => {
    if (!locId && locList.length === 1) setLocId(locList[0].id);
  }, [locList, locId]);

  const n = Number(qty);
  const valid = !!picked && !!locId && Number.isFinite(n) && n >= 1 && qty !== "";

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post("/stock-checks/damaged/writeoff", { product_id: picked.id, location_id: locId, quantity: n, note: note.trim() || null, local_id: localIdRef.current });
      toast.success(en ? "Recorded as damaged" : "Enregistré comme endommagé");
      onDone();
    } catch (e) {
      const code = e?.response?.data?.error || e?.response?.data?.code;
      if (code === "insufficient_stock" || e?.response?.status === 400) {
        toast.error(en ? "Not enough stock on hand at this location." : "Stock insuffisant à cet emplacement.");
      } else {
        toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>🔨 {en ? "Mark as damaged" : "Marquer endommagé"}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {en
            ? "Removes the damaged units from sellable stock and adds them to the damaged pile (still sellable at a discount)."
            : "Retire les unités endommagées du stock vendable et les ajoute à la pile des articles endommagés (toujours vendables avec remise)."}
        </div>

        {!picked ? (
          <>
            <input className="input" autoFocus placeholder={en ? "Search product (name / SKU)…" : "Chercher un produit (nom / SKU)…"}
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 8 }}>
              {search.isLoading && <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "Searching…" : "Recherche…"}</div>}
              {results.map(p => (
                <div key={p.id} onClick={() => setPicked({ id: p.id, name: en ? (p.name_en || p.name) : p.name })}
                  style={{ padding: "9px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseDown={e => e.preventDefault()}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{[p.sku, p.barcode].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              ))}
              {q.trim().length >= 1 && !search.isLoading && results.length === 0 &&
                <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "No match." : "Aucun résultat."}</div>}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700 }}>{picked.name}</span>
              <button onClick={() => setPicked(null)} style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 12 }}>{en ? "change" : "changer"}</button>
            </div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Location" : "Emplacement"}</label>
            <select className="input" value={locId} onChange={e => setLocId(e.target.value)} style={{ marginTop: 6, marginBottom: 12 }}>
              <option value="">{en ? "— pick a location —" : "— choisir un emplacement —"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Damaged quantity" : "Quantité endommagée"}</label>
            <input className="input" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ marginTop: 6, marginBottom: 12 }} />
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Note (optional)" : "Note (facultatif)"}</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={en ? "e.g. water damage" : "ex. dégât des eaux"} style={{ marginTop: 6 }} />
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !valid} onClick={submit}>
            {busy ? "…" : (en ? "🔨 Record damage" : "🔨 Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}
