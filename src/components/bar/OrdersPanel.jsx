// ORDERS (JOB 3 PHASE 1, Peter 2026-11-28; plan be-orange docs/JOB3_PLAN_orders_vip_86.md §b).
//   OrdersButton  — "📋 Orders (5)" in the bar header. The badge = rounds still waiting at this bar, from
//                   GET /bar/:loc/orders/summary (< 200 bytes) every 10 s while the screen is visible (React Query
//                   stops polling in the background). 👑 + gold when a VIP table's order is waiting.
//   OrdersPanel   — a POPOVER under the button (Peter's test 2026-11-28: it pushed the page down; now like the
//                   notifications panel): fixed, closes on a tap outside / Esc / a second tap on the button / resize.
//                   ONE list: VIP first, then the oldest first (the server sorts). One row = one round, in words:
//                   "👑 VIP · T1 Terrasse — Round 1: 2 × Castel · 3,000 FCFA · sent by Boss Dozie · waiting 12 min".
//                   Ages read like people talk ("12 min", "2 h 5 min", "10 days"); amber ≥ 10 min, red ≥ 20 min, and a
//                   round waiting ≥ 6 h is tagged STALE (forgotten — cancel it).
//   Order details — tap a row: the bar's own card (cream, big buttons) with the lines, table, sender, time, and
//                   Serve / Cancel round (a reason) / Open tab. Serve / Cancel call the SAME routes as the table card
//                   (/bar/rounds/:id/serve|cancel) with the same instant-tap lock and "Saving…".
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../utils/api";
import { useTapLock, savingText } from "../../utils/tapLock";
import { SHOP_TZ } from "../../utils/shopTime";

const L = (lang, en, fr) => (lang === "en" ? en : fr);
const errText = (lang, e) => {
  const d = e?.response?.data;
  if (d) return (lang === "en" ? d.message_en : d.message_fr) || d.message || L(lang, "Refused.", "Refusé.");
  return L(lang, "No connection — try again.", "Pas de connexion — réessayez.");
};
const whenText = (lang, iso) => { try {
  const d = new Date(iso);
  const day = d.toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", timeZone: SHOP_TZ }).replace(/\.$/, "");
  const t = d.toLocaleTimeString(lang === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ });
  return `${day}, ${t}`;
} catch { return ""; } };

export const AMBER_MIN = 10, RED_MIN = 20, STALE_MIN = 6 * 60;
export const ageMinutes = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
export const ageColor = (min) => (min >= RED_MIN ? "#f87171" : min >= AMBER_MIN ? "#fbbf24" : "#cbd5e1");
// "12 min" · "2 h 5 min" · "3 h" · "1 day" / "10 days" (FR: "1 jour" / "10 jours")
export function ageText(lang, min) {
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(min / (24 * 60));
  return lang === "en" ? `${d} ${d === 1 ? "day" : "days"}` : `${d} ${d === 1 ? "jour" : "jours"}`;
}
const where = (lang, o) => o.table ? [o.table.label, o.table.zone].filter(Boolean).join(" ")
  : `${o.tab?.name || "?"} (${L(lang, "counter", "comptoir")})`;
const lineName = (lang, l) => (lang === "en" && l.name_en) || l.name || "?";
const qty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const sourceWord = (lang, s) => ({ staff: L(lang, "staff", "serveur"), qr: "QR", pad: "pad" })[s] || s;

const POP_CSS = `
#bar-orders-pop{position:fixed;top:0;left:-9999px;width:460px;max-width:calc(100vw - 16px);z-index:1200;display:flex;flex-direction:column;
  background:#0f1f3f;color:#f8fafc;border:1px solid var(--bar-line,rgba(148,163,184,.28));border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.5);overflow:hidden}
#bar-orders-pop .bop-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(148,163,184,.25);font-weight:800;font-size:15px;flex:none}
#bar-orders-pop .bop-head button{margin-left:auto;background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px}
#bar-orders-pop .bop-body{flex:1;min-height:0;overflow-y:auto;padding:10px;display:grid;gap:8px;align-content:start}
#bar-orders-pop .bar-order-row{display:block;width:100%;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.3);
  background:rgba(255,255,255,.04);color:inherit;cursor:pointer;font-size:14px;line-height:1.35}
#bar-orders-pop .bar-order-row:hover{background:rgba(255,255,255,.08)}
#bar-orders-pop .bar-order-row.is-vip{border-color:#f59e0b;background:rgba(245,158,11,.12)}
#bar-orders-pop .bar-order-row .bor-what{font-weight:700}
#bar-orders-pop .bar-order-row .bor-sub{display:block;margin-top:3px;font-size:13px;color:#cbd5e1}
#bar-orders-pop .bor-vip{color:#fbbf24;font-weight:800}
#bar-orders-pop .bor-stale{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:#7f1d1d;color:#fecaca;font-size:11px;font-weight:800;letter-spacing:.03em}
#bar-orders-pop .bar-card{border-radius:14px}
#bar-orders-pop .bod-head{padding:12px 14px 4px}
#bar-orders-pop .bod-head h3{margin:0;font-size:18px}
#bar-orders-pop .bod-meta{padding:0 14px;font-size:13px;color:#4b5563}
#bar-orders-pop .bod-lines{margin:10px 14px 0;padding:0;list-style:none;border-top:1px solid #e7dcc5}
#bar-orders-pop .bod-lines li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #e7dcc5;font-size:15px}
#bar-orders-pop .bod-total{display:flex;justify-content:space-between;padding:8px 14px 0;font-weight:800;font-size:16px}
#bar-orders-pop .bod-foot{display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px 14px}
#bar-orders-pop .bod-foot .bar-cmain,#bar-orders-pop .bod-foot .bar-cbtn{min-height:44px}
#bar-orders-pop .bod-foot .bar-cmain{flex:1 1 140px}
#bar-orders-pop .bod-foot input{flex:1 1 200px;padding:10px;border-radius:10px;border:1.5px solid #c9bfa9;font-size:15px;color:#13203a;background:#fff}
#bar-orders-pop .bar-card button:disabled{opacity:.6;cursor:default}
#bar-orders-pop .bod-back{background:none;border:none;color:#93c5fd;font-weight:700;cursor:pointer;padding:0 0 6px;font-size:14px}
`;

// the badge's answer — shared by the button and the panel (same key, same shape)
export function useOrdersSummary(barId) {
  return useQuery({
    queryKey: ["bar-orders-summary", barId], enabled: !!barId,
    queryFn: () => api.get(`/bar/${barId}/orders/summary`).then((r) => r.data?.data || { count: 0, vip_count: 0, latest_at: null }),
    refetchInterval: 10000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: 0,
  });
}

export function OrdersButton({ lang, barId, open, onToggle }) {
  const s = useOrdersSummary(barId).data;
  const n = s ? s.count : 0, vip = s ? s.vip_count : 0;
  const label = `${L(lang, "Orders", "Commandes")}${n ? ` (${n})` : ""}`;
  return (
    <button type="button" id="bar-orders-btn" className={`bar-outline-btn bar-orders-btn${vip ? " is-vip" : ""}`} aria-pressed={open} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label}${vip ? ` — ${vip} VIP` : ""}`} onClick={onToggle} data-count={n} data-vip={vip}
      style={vip ? { borderColor: "#f59e0b", color: "#fbbf24" } : undefined}>
      <span aria-hidden="true">{vip ? "👑" : "📋"}</span>
      <span className="bar-lbl-long"> {L(lang, "Orders", "Commandes")}</span>
      {n > 0 && <span className="bar-orders-badge" style={{ marginLeft: 6, minWidth: 20, padding: "1px 7px", borderRadius: 999, fontSize: 13, fontWeight: 800,
        background: vip ? "#f59e0b" : "#2563eb", color: vip ? "#1f1300" : "#fff" }}>{n}</span>}
    </button>
  );
}

// placed under the trigger, right edges aligned, clamped into the viewport; the list scrolls inside
function usePlaceUnder(ref, triggerId) {
  useLayoutEffect(() => {
    const el = ref.current, trigger = document.getElementById(triggerId);
    if (!el || !trigger) return;
    const r = trigger.getBoundingClientRect(), GAP = 6, MARGIN = 8;
    const w = Math.min(460, window.innerWidth - 2 * MARGIN);
    el.style.width = w + "px";
    el.style.left = Math.max(MARGIN, Math.min(r.right - w, window.innerWidth - w - MARGIN)) + "px";
    el.style.top = (r.bottom + GAP) + "px";
    el.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - GAP - MARGIN) + "px";
  });
}

export default function OrdersPanel({ lang, barId, canServe, isOnline, fmt, onOpenTab, onChanged, onClose }) {
  const qc = useQueryClient();
  const popRef = useRef(null);
  usePlaceUnder(popRef, "bar-orders-btn");
  // close: a tap outside (the button toggles itself), Esc, a resize
  useEffect(() => {
    const inside = (t) => t && t.closest && (t.closest("#bar-orders-pop") || t.closest("#bar-orders-btn"));
    const onDown = (e) => { if (!inside(e.target)) onClose && onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    const onResize = () => onClose && onClose();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [onClose]);

  const summary = useOrdersSummary(barId).data;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const [sel, setSel] = useState(null);         // round_id of the order open in details
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(null);       // { ok, text }
  // the list: fetched while open, and again whenever the badge's count / latest time moves
  const list = useQuery({
    queryKey: ["bar-orders", barId, summary ? `${summary.count}|${summary.latest_at}` : ""], enabled: !!barId,
    queryFn: () => api.get(`/bar/${barId}/orders`).then((r) => r.data?.data || { orders: [] }),
    placeholderData: (prev) => prev, refetchOnWindowFocus: true,
  });
  const orders = list.data?.orders || [];
  const o = sel ? orders.find((x) => x.round_id === sel) : null;
  useEffect(() => { if (sel && list.isSuccess && !list.isFetching && !o) { setSel(null); setCancelling(false); } }, [sel, o, list.isSuccess, list.isFetching]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["bar-orders-summary", barId] });
    qc.invalidateQueries({ queryKey: ["bar-orders", barId] });
    qc.invalidateQueries({ queryKey: ["bar-tab"] });
    if (onChanged) onChanged();
  };
  const run = useMutation({
    mutationFn: async ({ path, body }) => {
      if (!isOnline) { const e = new Error("offline"); e.offline = true; throw e; }
      return api.post(path, body).then((r) => r.data?.data);
    },
    onSuccess: (_d, vars) => { setNote({ ok: true, text: vars.okText }); setSel(null); setCancelling(false); setReason(""); refreshAll(); },
    onError: (e) => { setNote({ ok: false, text: e.offline ? L(lang, "No connection — nothing was sent. Try again when you are online.", "Pas de connexion — rien n'a été envoyé. Réessayez une fois en ligne.") : errText(lang, e) }); refreshAll(); },
  });
  const runL = useTapLock(run);
  const saving = (path) => runL.savingFor((v) => v.path === path);

  const msg = note && <div role="status" className="bar-msg" style={{ margin: 0, borderColor: note.ok ? "#22c55e" : "#ef4444", color: note.ok ? "#86efac" : "#fca5a5" }}>{note.text}</div>;
  const total = orders.length;
  const head = (
    <div className="bop-head">
      <span>📋 {L(lang, "Orders", "Commandes")}{total ? ` (${total})` : ""}</span>
      <button type="button" aria-label={L(lang, "Close", "Fermer")} onClick={() => onClose && onClose()}>✕</button>
    </div>
  );

  let body;
  if (list.isLoading) body = <div role="status" style={{ opacity: 0.8 }}>{L(lang, "Loading the orders…", "Chargement des commandes…")}</div>;
  else if (list.isError && !orders.length) body = <div role="alert" style={{ color: "#fca5a5" }}>{errText(lang, list.error)}</div>;
  else if (o) {
    const min = ageMinutes(o.created_at, now), stale = min >= STALE_MIN;
    const serveP = `/bar/rounds/${o.round_id}/serve`, cancelP = `/bar/rounds/${o.round_id}/cancel`;
    body = (
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" className="bod-back" onClick={() => { setSel(null); setCancelling(false); }}>← {L(lang, "All orders", "Toutes les commandes")}</button>
        {msg}
        <section className="bar-card bar-order-details" aria-label={L(lang, "Order details", "Détail de la commande")}>
          <div className="bod-head">
            <h3>{o.is_vip && <span title="VIP">👑 VIP · </span>}{where(lang, o)} — {L(lang, "Round", "Tournée")} {o.round_no}</h3>
          </div>
          <div className="bod-meta">
            {L(lang, "Sent by", "Envoyée par")} {o.sent_by_name || "?"} · {whenText(lang, o.created_at)} · <span className="bar-order-age" style={{ color: min >= RED_MIN ? "#b91c1c" : min >= AMBER_MIN ? "#b45309" : "#4b5563", fontWeight: 700 }}>
              {L(lang, "waiting", "attend depuis")} {ageText(lang, min)}</span>
            {stale && <span className="bor-stale" style={{ marginLeft: 6, padding: "0 7px", borderRadius: 999, background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 800 }}>{L(lang, "STALE", "ANCIENNE")}</span>}
            {" "}· {sourceWord(lang, o.source)}{o.tab?.waiter_name ? <> · {L(lang, "waiter", "serveur")} {o.tab.waiter_name}</> : null}
          </div>
          {stale && <div className="bod-meta" style={{ color: "#991b1b", marginTop: 4 }}>{L(lang, "Waiting far too long — probably forgotten. Serve it or cancel it.", "Attend depuis bien trop longtemps — sans doute oubliée. Servez-la ou annulez-la.")}</div>}
          <ul className="bod-lines">
            {o.lines.map((l, i) => <li key={i}><span>{qty(l.quantity)} × {lineName(lang, l)}</span><span>{fmt(l.line_total)}</span></li>)}
          </ul>
          <div className="bod-total"><span>{L(lang, "Total", "Total")}</span><span>{fmt(o.total)}</span></div>
          {!cancelling ? (
            <div className="bod-foot">
              {canServe && <button type="button" className="bar-cmain" disabled={runL.busy}
                onClick={() => runL.fire({ path: serveP, body: { version: o.version, sale_version: o.tab?.sale_version ?? null }, okText: L(lang, "Round served.", "Tournée servie.") })}>
                {saving(serveP) ? `⏳ ${savingText(lang)}` : `✓ ${L(lang, "Serve", "Servir")}`}</button>}
              <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => { setCancelling(true); setNote(null); }}>{L(lang, "Cancel round", "Annuler la tournée")}</button>
              <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => { if (onOpenTab) onOpenTab(o); if (onClose) onClose(); }}>{L(lang, "Open tab", "Ouvrir la note")} ›</button>
            </div>
          ) : (
            <form className="bod-foot" onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return;
              runL.fire({ path: cancelP, body: { version: o.version, reason: reason.trim() }, okText: L(lang, "Round cancelled.", "Tournée annulée.") }); }}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required autoFocus
                aria-label={L(lang, "Reason for cancelling", "Raison de l'annulation")}
                placeholder={L(lang, "Why? (e.g. customer changed mind)", "Pourquoi ? (ex. le client a changé d'avis)")} />
              <button type="submit" className="bar-cmain" disabled={runL.busy || !reason.trim()}>
                {saving(cancelP) ? `⏳ ${savingText(lang)}` : L(lang, "Cancel the round", "Annuler la tournée")}</button>
              <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => { setCancelling(false); setReason(""); }}>{L(lang, "Keep it", "Garder")}</button>
            </form>
          )}
        </section>
      </div>
    );
  } else {
    body = (
      <>
        {msg}
        {!orders.length && <div role="status" style={{ opacity: 0.75, padding: "6px 2px" }}>{L(lang, "No order is waiting.", "Aucune commande en attente.")}</div>}
        {orders.map((x) => {
          const min = ageMinutes(x.created_at, now), stale = min >= STALE_MIN;
          const what = x.lines.map((l) => `${qty(l.quantity)} × ${lineName(lang, l)}`).join(", ");
          return (
            <button type="button" key={x.round_id} className={`bar-order-row${x.is_vip ? " is-vip" : ""}`} data-round={x.round_id} data-vip={x.is_vip ? "1" : "0"}
              data-stale={stale ? "1" : "0"} onClick={() => { setSel(x.round_id); setCancelling(false); setNote(null); }}>
              <span className="bor-what">{x.is_vip && <span className="bor-vip">👑 VIP · </span>}{where(lang, x)} — {L(lang, "Round", "Tournée")} {x.round_no}{lang === "en" ? ":" : " :"} {what}</span>
              <span className="bor-sub">{fmt(x.total)} · {L(lang, "sent by", "envoyée par")} {x.sent_by_name || "?"} · <span className="bar-order-age" style={{ color: ageColor(min), fontWeight: 700 }}>
                {L(lang, "waiting", "attend depuis")} {ageText(lang, min)}</span>{stale && <span className="bor-stale">{L(lang, "STALE", "ANCIENNE")}</span>}</span>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <div id="bar-orders-pop" ref={popRef} className="bar-orders" role="dialog" aria-label={L(lang, "Orders", "Commandes")}>
      <style>{POP_CSS}</style>
      {head}
      <div className="bop-body">{body}</div>
    </div>
  );
}
