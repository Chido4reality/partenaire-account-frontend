// ORDERS (JOB 3 PHASE 1, Peter 2026-11-28; plan be-orange docs/JOB3_PLAN_orders_vip_86.md §b).
//   OrdersButton  — "📋 Orders (5)" in the bar header. The badge = rounds still waiting at this bar, from
//                   GET /bar/:loc/orders/summary (< 200 bytes) every 10 s while the screen is visible (React Query
//                   stops polling in the background). 👑 + gold when a VIP table's order is waiting.
//   OrdersPanel   — ONE list: VIP first, then the oldest first (the server sorts). One row = one round. The age
//                   turns amber at 10 min, red at 20 min. The full list is fetched only while it is open, and again
//                   when the badge's count / latest time changes.
//   Order details — tap a row: lines, table, waiter, time, source, and the actions in one place: Serve, Cancel
//                   round (with a reason), Open tab. Serve / Cancel call the SAME routes as the table card
//                   (/bar/rounds/:id/serve|cancel) with the same instant-tap lock — no parallel path.
import { useEffect, useState } from "react";
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
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ }); } catch { return ""; } };
export const AMBER_MIN = 10, RED_MIN = 20;
export const ageMinutes = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
export const ageColor = (min) => (min >= RED_MIN ? "#f87171" : min >= AMBER_MIN ? "#fbbf24" : "#cbd5e1");
const where = (lang, o) => o.table ? [o.table.label, o.table.zone].filter(Boolean).join(" · ")
  : `${o.tab?.name || "?"} (${L(lang, "counter", "comptoir")})`;
const lineName = (lang, l) => (lang === "en" && l.name_en) || l.name || "?";
const qty = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const sourceWord = (lang, s) => ({ staff: L(lang, "staff", "serveur"), qr: "QR", pad: "pad" })[s] || s;

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
    <button type="button" className={`bar-outline-btn bar-orders-btn${vip ? " is-vip" : ""}`} aria-pressed={open}
      aria-label={`${label}${vip ? ` — ${vip} VIP` : ""}`} onClick={onToggle} data-count={n} data-vip={vip}
      style={vip ? { borderColor: "#f59e0b", color: "#fbbf24" } : undefined}>
      <span aria-hidden="true">{vip ? "👑" : "📋"}</span>
      <span className="bar-lbl-long"> {L(lang, "Orders", "Commandes")}</span>
      {n > 0 && <span className="bar-orders-badge" style={{ marginLeft: 6, minWidth: 20, padding: "1px 7px", borderRadius: 999, fontSize: 13, fontWeight: 800,
        background: vip ? "#f59e0b" : "#2563eb", color: vip ? "#1f1300" : "#fff" }}>{n}</span>}
    </button>
  );
}

export default function OrdersPanel({ lang, barId, canServe, isOnline, fmt, onOpenTab, onChanged }) {
  const qc = useQueryClient();
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

  if (list.isLoading) return <section className="bar-orders" role="status">{L(lang, "Loading the orders…", "Chargement des commandes…")}</section>;
  if (list.isError && !orders.length) return <section className="bar-orders" role="alert">{errText(lang, list.error)}</section>;

  const msg = note && <div role="status" className="bar-msg" style={{ borderColor: note.ok ? "#22c55e" : "#ef4444", color: note.ok ? "#86efac" : "#fca5a5" }}>{note.text}</div>;

  if (o) {
    const min = ageMinutes(o.created_at, now);
    const serveP = `/bar/rounds/${o.round_id}/serve`, cancelP = `/bar/rounds/${o.round_id}/cancel`;
    return (
      <section className="bar-orders bar-order-details" aria-label={L(lang, "Order details", "Détail de la commande")} style={{ display: "grid", gap: 10 }}>
        <button type="button" className="bar-cbtn" style={{ justifySelf: "start" }} onClick={() => { setSel(null); setCancelling(false); }}>← {L(lang, "All orders", "Toutes les commandes")}</button>
        <h3 style={{ margin: 0 }}>{o.is_vip && <span title="VIP">👑 </span>}{where(lang, o)} · {L(lang, "Round", "Tournée")} {o.round_no}</h3>
        <div style={{ fontSize: 14, opacity: 0.9 }}>
          {L(lang, "Sent by", "Envoyée par")} {o.sent_by_name || "?"} · {hhmm(o.created_at)} · <span style={{ color: ageColor(min), fontWeight: 700 }}>{min} min</span> · {sourceWord(lang, o.source)}
          {o.tab?.waiter_name && <> · {L(lang, "Waiter", "Serveur")} {o.tab.waiter_name}</>}
        </div>
        <ul className="bar-order-lines" style={{ margin: 0, paddingLeft: 18 }}>
          {o.lines.map((l, i) => <li key={i}>{qty(l.quantity)} × {lineName(lang, l)} — {fmt(l.line_total)}</li>)}
        </ul>
        <div style={{ fontWeight: 700 }}>{L(lang, "Total", "Total")} : {fmt(o.total)}</div>
        {msg}
        {!cancelling ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canServe && <button type="button" className="bar-cmain" disabled={runL.busy}
              onClick={() => runL.fire({ path: serveP, body: { version: o.version, sale_version: o.tab?.sale_version ?? null }, okText: L(lang, "Round served.", "Tournée servie.") })}>
              {saving(serveP) ? `⏳ ${savingText(lang)}` : L(lang, "Serve", "Servir")}</button>}
            <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => { setCancelling(true); setNote(null); }}>{L(lang, "Cancel round", "Annuler la tournée")}</button>
            <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => onOpenTab && onOpenTab(o)}>{L(lang, "Open tab", "Ouvrir la note")} ›</button>
          </div>
        ) : (
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
            onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return;
              runL.fire({ path: cancelP, body: { version: o.version, reason: reason.trim() }, okText: L(lang, "Round cancelled.", "Tournée annulée.") }); }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required autoFocus
              aria-label={L(lang, "Reason for cancelling", "Raison de l'annulation")}
              placeholder={L(lang, "Why? (e.g. customer changed mind)", "Pourquoi ? (ex. le client a changé d'avis)")} style={{ padding: 8, borderRadius: 8, minWidth: 220 }} />
            <button type="submit" className="bar-cmain" disabled={runL.busy || !reason.trim()}>
              {saving(cancelP) ? `⏳ ${savingText(lang)}` : L(lang, "Cancel the round", "Annuler la tournée")}</button>
            <button type="button" className="bar-cbtn" disabled={runL.busy} onClick={() => { setCancelling(false); setReason(""); }}>{L(lang, "Keep it", "Garder")}</button>
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="bar-orders" aria-label={L(lang, "Orders", "Commandes")} style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>📋 {L(lang, "Orders", "Commandes")} {orders.length ? `(${orders.length})` : ""}</h3>
      {msg}
      {!orders.length && <div role="status" style={{ opacity: 0.75 }}>{L(lang, "No order is waiting.", "Aucune commande en attente.")}</div>}
      {orders.map((x) => {
        const min = ageMinutes(x.created_at, now);
        const what = x.lines.map((l) => `${qty(l.quantity)} ${lineName(lang, l)}`).join(", ");
        return (
          <button type="button" key={x.round_id} className={`bar-order-row${x.is_vip ? " is-vip" : ""}`} data-round={x.round_id} data-vip={x.is_vip ? "1" : "0"}
            onClick={() => { setSel(x.round_id); setCancelling(false); setNote(null); }}
            style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: 10, alignItems: "center", textAlign: "left", padding: "10px 12px",
              borderRadius: 10, border: `1px solid ${x.is_vip ? "#f59e0b" : "rgba(148,163,184,.3)"}`, background: x.is_vip ? "rgba(245,158,11,.10)" : "rgba(15,31,63,.6)",
              color: "inherit", cursor: "pointer" }}>
            <strong style={{ whiteSpace: "nowrap" }}>{x.is_vip ? "👑 " : ""}{where(lang, x)}</strong>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{what}</span>
            <span className="bar-order-age" style={{ color: ageColor(min), fontWeight: 700, whiteSpace: "nowrap" }}>{min} min</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{sourceWord(lang, x.source)}</span>
            <span aria-hidden="true">›</span>
          </button>
        );
      })}
    </section>
  );
}
