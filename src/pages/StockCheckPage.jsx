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
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import toast from "react-hot-toast";
import { unitLabel } from "../utils/units";
import DateRangeFilter, { inRange, wideRange } from "../components/common/DateRangeFilter";
import { genLocalId } from "../utils/pendingSync";

// MP-STALE-PRODUCT-SCAN: mirrors backend lib/stockChecks.js's STALE_THRESHOLD_DAYS
// (fixed, not per-org configurable — Peter, 2026-07-14). Display-only.
const STALE_DAYS = 60;

// MP-STOCK-CHECK-RESOLVE (Part B): reason → does it correct stock? (mirrors backend)
const RESOLVE_REASONS = [
  { key: "miscount",       corrects: true,  en: "Miscount — goods were there",     fr: "Erreur de comptage — présents" },
  { key: "recovered",      corrects: true,  en: "Recovered / found",               fr: "Retrouvé" },
  { key: "damaged",        corrects: true,  en: "Damaged / written off",           fr: "Endommagé / radié" },
  { key: "confirmed_loss", corrects: false, en: "Confirmed loss (theft/lost)",     fr: "Perte confirmée (vol/perdu)" },
];
const reasonLabel = (key, en) => {
  const r = RESOLVE_REASONS.find(x => x.key === key);
  return r ? (en ? r.en : r.fr) : key;
};

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

  const list = useQuery({
    queryKey: ["stock-checks", tab],
    queryFn: () => api.get(`/stock-checks?status=${tab}`).then(r => toArray(r)),
    enabled: tab === "pending" || tab === "mismatch" || tab === "resolved", // damaged + stale are separate endpoints
    refetchInterval: 15000,
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
  const stale = useQuery({
    queryKey: ["stock-checks-stale"],
    queryFn: () => api.get("/stock-checks/stale").then(r => toArray(r)),
    enabled: tab === "stale",
    refetchInterval: 60000,
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

  const resolveMut = useMutation({
    mutationFn: ({ id, counted_qty, resolution }) =>
      api.post(`/stock-checks/${id}/verify`, { counted_qty, resolution }).then(r => r.data),
    onSuccess: (res) => {
      if (res.matches) {
        toast.success(en ? "✓ Done — removed from the list" : "✓ Fait — retiré de la liste");
      } else {
        toast(en ? `⚠ Mismatch kept — expected ${res.expected}, counted ${res.counted}`
                 : `⚠ Écart conservé — attendu ${res.expected}, compté ${res.counted}`,
          { icon: "⚠️", duration: 6000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
      setResolveFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
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

  // Part B: owner resolves a MISMATCH with a reason + corrected qty → status='resolved',
  // and (miscount/recovered/damaged) corrects pa_stock. confirmed_loss leaves stock.
  const varResolveMut = useMutation({
    mutationFn: ({ id, reason, resolved_qty }) =>
      api.post(`/stock-checks/${id}/resolve`, { reason, resolved_qty }).then(r => r.data),
    onSuccess: (res) => {
      toast.success(res.corrected
        ? (en ? `Resolved — stock corrected to ${res.resolved_qty}` : `Résolu — stock corrigé à ${res.resolved_qty}`)
        : (en ? "Resolved — stock unchanged (loss recorded)" : "Résolu — stock inchangé (perte enregistrée)"));
      setVarResolveFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
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
          <div style={{ fontWeight: 800, fontSize: 22 }}>{en ? "Stock Check" : "Vérification de stock"}</div>
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

      {/* Watched products — persistent boss oversight. Owner adds/removes; every
          movement of a watched product into its location auto-creates a check. */}
      <WatchedSection watchList={watchList} loading={watches.isLoading} en={en} isOwner={isOwner}
        onRemoved={() => qc.invalidateQueries({ queryKey: ["stock-check-watches"] })} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        {["pending", "mismatch", "resolved", "damaged", "stale"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 700, fontSize: 13,
              background: tab === t ? "var(--brand-light)" : "transparent", color: tab === t ? "#1a1a2e" : "var(--text-secondary)" }}>
            {t === "pending" ? (en ? "To count" : "À compter")
              : t === "mismatch" ? (en ? "Mismatches" : "Écarts")
              : t === "resolved" ? (en ? "Resolved" : "Résolus")
              : t === "damaged" ? (en ? "Damaged" : "Endommagé")
              : (en ? "Not moving" : "Sans mouvement")}
          </button>
        ))}
      </div>

      {/* A2 date filter — applies to every tab except Not moving (a ranked
          snapshot, not a date-windowed list). */}
      {tab !== "stale" && <DateRangeFilter from={range.from} to={range.to} onChange={setRange} style={{ marginBottom: 12 }} />}

      {/* Resolved tab → "Damaged" filter = the shop's damage record (no separate table) */}
      {tab === "resolved" && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setDamagedOnly(v => !v)}
            style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${damagedOnly ? "#fbbf24" : "var(--border)"}`,
              background: damagedOnly ? "rgba(251,191,36,0.15)" : "transparent",
              color: damagedOnly ? "#fbbf24" : "var(--text-secondary)" }}>
            🔨 {en ? "Damaged only" : "Endommagés uniquement"}
          </button>
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
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Before" : "Avant"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_before)}</b></span>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Expected" : "Attendu"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_expected)} {unitLabel(p.unit)}</b></span>
                    {showCounted && <>
                      <span style={{ color: "var(--text-muted)" }}>{en ? "Counted" : "Compté"}: <b style={{ color: isResolved ? "var(--text-primary)" : "#f87171" }}>{Number(r.qty_counted)}</b></span>
                      <span style={{ color: isResolved ? "var(--text-muted)" : "#f87171", fontWeight: 700 }}>{delta > 0 ? "+" : ""}{delta}</span>
                    </>}
                  </div>
                  {r.moved_by_name && (
                    <div style={{ fontSize: 12, color: isMismatch ? "#fca5a5" : "var(--text-muted)", marginTop: 4 }}>
                      👤 {en ? "Moved by" : "Déplacé par"}: <b>{r.moved_by_name}</b>
                      {showCounted && r.verified_by_name && <span> · {en ? "counted by" : "compté par"} {r.verified_by_name}</span>}
                    </div>
                  )}
                  {/* Part C: resolution audit line (what / why / who / when) */}
                  {isResolved && (
                    <div style={{ fontSize: 12, marginTop: 6, color: "#34d399", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8, padding: "6px 10px" }}>
                      ✅ {reasonLabel(r.resolution_reason, en)}
                      {r.resolved_qty != null && <span style={{ color: "var(--text-secondary)" }}> · {en ? "corrected to" : "corrigé à"} <b>{Number(r.resolved_qty)}</b></span>}
                      {r.resolution_reason === "confirmed_loss" && <span style={{ color: "var(--text-muted)" }}> · {en ? "stock unchanged" : "stock inchangé"}</span>}
                      <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                        {r.resolved_by_name ? `${en ? "by" : "par"} ${r.resolved_by_name} · ` : ""}{fmtDate(r.resolved_at, en)}
                      </div>
                    </div>
                  )}
                </div>
                {r.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, alignSelf: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={() => setResolveFor(r)} className="btn btn-success" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
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
            const value = qty * (Number(p.cost_price) || 0);
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
                        {en ? "On hand" : "En stock"}: <b style={{ color: "var(--text-primary)" }}>{qty} {unitLabel(p.unit)}</b>
                      </span>
                      {value > 0 && <span style={{ color: "var(--text-muted)" }}>{en ? "Tied up" : "Immobilisé"}: <b style={{ color: "#f87171" }}>{fmt(value)}</b></span>}
                    </div>
                  </div>
                  <div style={{ alignSelf: "center" }}>
                    <button onClick={() => setResolveFor(r)} className="btn btn-primary" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      🔍 {en ? "Count it" : "Compter"}
                    </button>
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
        <ResolveVarianceModal row={varResolveFor} en={en} busy={varResolveMut.isPending}
          onCancel={() => setVarResolveFor(null)}
          onResolve={(reason, resolved_qty) => varResolveMut.mutate({ id: varResolveFor.id, reason, resolved_qty })} />
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

// Resolve a pending check: enter the physical count, then ✓ Done (verified, wiped
// from the list — with a confirm warning) or ⚠ Mismatch (kept forever as the trail).
function ResolveModal({ row, en, onCancel, onResolve, busy }) {
  const p = row.pa_products || {};
  const expected = Number(row.qty_expected) || 0;
  const [value, setValue] = useState("");
  const [confirmDone, setConfirmDone] = useState(false);
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 0 && value !== "";
  const matches = valid && n === expected;

  const goMismatch = () => { if (!valid) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; } onResolve(n, "mismatch"); };
  const goDone = () => { if (!valid) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; } setConfirmDone(true); };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Resolve count" : "Résoudre le comptage"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>

        {!confirmDone ? (
          <>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
              {en ? "How many did you physically count?" : "Combien avez-vous physiquement compté ?"}
            </label>
            <input className="input" type="number" min="0" autoFocus value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && goDone()} placeholder={en ? "Counted quantity" : "Quantité comptée"} style={{ marginTop: 6 }} />
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
              {en ? `System expects ${expected}.` : `Le système attend ${expected}.`}
              {valid && !matches && <span style={{ color: "#fbbf24" }}> {en ? `Off by ${n - expected > 0 ? "+" : ""}${n - expected}.` : `Écart de ${n - expected > 0 ? "+" : ""}${n - expected}.`}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn" style={{ flex: 1.4, background: "#92400e", color: "#fde68a", fontWeight: 700 }} disabled={busy} onClick={goMismatch}>
                ⚠ {en ? "Mismatch" : "Écart"}
              </button>
              <button className="btn btn-success" style={{ flex: 1.4, fontWeight: 700 }} disabled={busy} onClick={goDone}>
                ✓ {en ? "Done" : "Fait"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, padding: 12 }}>
              {matches
                ? (en ? `Count matches (${expected}). Marking this Done removes it from the list.`
                      : `Le comptage correspond (${expected}). Marquer « Fait » le retire de la liste.`)
                : (en ? `Counted ${n} vs expected ${expected}. Marking Done anyway will accept it as OK and remove it from the list — it will NOT be recorded as a mismatch. Continue?`
                      : `Compté ${n} contre ${expected} attendu. Marquer « Fait » quand même l'accepte et le retire de la liste — il ne sera PAS enregistré comme écart. Continuer ?`)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => setConfirmDone(false)}>{en ? "Back" : "Retour"}</button>
              <button className="btn btn-success" style={{ flex: 2, fontWeight: 700 }} disabled={busy} onClick={() => onResolve(n, "done")}>
                {busy ? "…" : (en ? "✓ Confirm Done" : "✓ Confirmer")}
              </button>
            </div>
          </>
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

// Part B: owner resolves a MISMATCH — pick a reason, enter the corrected true
// quantity, Update. miscount/recovered/damaged correct stock; confirmed_loss doesn't.
function ResolveVarianceModal({ row, en, busy, onCancel, onResolve }) {
  const p = row.pa_products || {};
  const expected = Number(row.qty_expected) || 0;
  const counted = Number(row.qty_counted) || 0;
  const [reason, setReason] = useState("miscount");
  // Pre-fill the corrected qty with what was physically counted (the boss's best number).
  const [qty, setQty] = useState(String(counted));
  const chosen = RESOLVE_REASONS.find(r => r.key === reason);
  const corrects = !!(chosen && chosen.corrects);
  const n = Number(qty);
  const valid = Number.isFinite(n) && n >= 0 && qty !== "";
  const submit = () => {
    if (corrects && !valid) { toast.error(en ? "Enter a valid quantity" : "Entrez une quantité valide"); return; }
    // confirmed_loss ignores the qty for stock, but we still send it for the record.
    onResolve(reason, corrects ? n : (valid ? n : counted));
  };
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Resolve variance" : "Résoudre l'écart"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 12 }}>
          {en ? "Expected" : "Attendu"}: <b>{expected}</b> · {en ? "counted" : "compté"}: <b>{counted}</b> ({counted - expected > 0 ? "+" : ""}{counted - expected})
        </div>

        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Reason / outcome" : "Raison / résultat"}</label>
        <select className="input" value={reason} onChange={e => setReason(e.target.value)} style={{ marginTop: 6, marginBottom: 12 }}>
          {RESOLVE_REASONS.map(r => <option key={r.key} value={r.key}>{en ? r.en : r.fr}</option>)}
        </select>

        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
          {en ? "Corrected true quantity" : "Quantité réelle corrigée"}
        </label>
        <input className="input" type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}
          placeholder={en ? "True quantity now" : "Quantité réelle actuelle"} style={{ marginTop: 6 }}
          disabled={!corrects} />
        <div style={{ fontSize: 11.5, color: corrects ? "var(--text-muted)" : "#fbbf24", marginTop: 6, lineHeight: 1.5 }}>
          {corrects
            ? (en ? `Stock at this location will be set to this number (${chosen.key === "damaged" ? "damaged units removed" : "corrected"}).`
                  : `Le stock à cet emplacement sera fixé à ce nombre (${chosen.key === "damaged" ? "unités endommagées retirées" : "corrigé"}).`)
            : (en ? "Confirmed loss: stock is left as-is — the gap is recorded as a real loss."
                  : "Perte confirmée : le stock reste inchangé — l'écart est enregistré comme perte réelle.")}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy} onClick={submit}>{busy ? "…" : (en ? "Update" : "Mettre à jour")}</button>
        </div>
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
