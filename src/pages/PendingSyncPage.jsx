// MP-PENDING-SYNC-SCREEN — "En attente de synchronisation / Pending sync".
//
// Surfaces the SAME offline write queue the app already maintains
// (utils/pendingSync → localDb.pending_sync, the SQLite/in-memory store the
// offlineAwareAdapter enqueues into). This page does NOT invent a new queue —
// it reads listPending() and re-renders on the queue's own subscribe() events,
// so a cashier can confirm an offline action already went through (most
// importantly an order-picking sale) and not ring it a second time.
//
// Each row: type, key details (sale # / item count + total, customer, time),
// and a status badge — Pending (queued) / Syncing (sending) / Retrying
// (failed_transient, auto-retries) / Failed (failed_permanent, needs Retry).
// When a row reaches 'sent' the queue drops it from listPending(), so it
// clears from this screen automatically. Failed/Retrying rows get a Retry.

import { useEffect, useState, useCallback } from "react";
import { useLangStore } from "../store";
import { formatCFA } from "../utils/api";
import { listPending, subscribe, retry, retryAll } from "../utils/pendingSync";

// Map an offline-queue endpoint+method to a friendly type. Mirrors the
// OFFLINE_ELIGIBLE table in utils/api.js — order matters (most specific first).
function describeType(endpoint, method, lang) {
  const ep = endpoint || "";
  const fr = lang !== "en";
  const T = (frLabel, enLabel, emoji) => ({ label: fr ? frLabel : enLabel, emoji });
  if (/^\/sales\/[^/]+\/payment\/?$/.test(ep))            return T("Paiement de dette", "Debt payment", "💵");
  if (/^\/sales\/?$/.test(ep))                            return T("Vente", "Sale", "🛒");
  if (/^\/returns\/return\/[^/]+\/?$/.test(ep))           return T("Remboursement", "Refund", "↩");
  if (/^\/returns\/exchange\/[^/]+\/?$/.test(ep))         return T("Échange", "Exchange", "🔄");
  if (/^\/returns\/void\/[^/]+\/?$/.test(ep))             return T("Annulation", "Void", "⛔");
  if (/^\/customers\/[^/]+\/collect-debt\/?$/.test(ep))   return T("Encaissement dette", "Debt collection", "💳");
  if (/^\/expenditures\/?$/.test(ep))                     return T("Dépense", "Expense", "💸");
  if (/^\/shifts\/open\/?$/.test(ep))                     return T("Ouverture de caisse", "Shift open", "🔓");
  if (/^\/shifts\/[^/]+\/close\/?$/.test(ep))             return T("Fermeture de caisse", "Shift close", "🔒");
  if (/^\/transfers\/?$/.test(ep))                        return T("Transfert de stock", "Stock transfer", "📦");
  if (/^\/stock\/arrivals\/?$/.test(ep))                  return T("Arrivage de stock", "Stock arrival", "📥");
  if (/^\/stock\/count\/?$/.test(ep))                     return T("Comptage de stock", "Stock count", "🔢");
  if (/^\/stock\/adjust\/?$/.test(ep))                    return T("Ajustement de stock", "Stock adjust", "🔧");
  if (/^\/products\/?$/.test(ep) && (method || "").toUpperCase() === "POST")  return T("Nouveau produit", "New product", "🏷️");
  if (/^\/products\/[^/]+\/?$/.test(ep))                  return T("Modif. produit", "Product edit", "🏷️");
  return T("Action", "Action", "•");
}

function safeParse(json) { try { return JSON.parse(json) || {}; } catch { return {}; } }

// Human key-details line per row, read from the queued payload.
function describeDetails(endpoint, payload, lang) {
  const fr = lang !== "en";
  const ep = endpoint || "";
  const bits = [];
  const cust = payload.customer_name || payload.customer || null;

  if (/^\/sales\/?$/.test(ep)) {
    const n = Array.isArray(payload.items) ? payload.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0) : null;
    if (n != null) bits.push(fr ? `${n} article(s)` : `${n} item(s)`);
    if (payload.total_amount != null) bits.push(formatCFA(payload.total_amount));
    if (payload.paid_amount != null && Number(payload.paid_amount) < Number(payload.total_amount || 0)) {
      bits.push(fr ? `payé ${formatCFA(payload.paid_amount)}` : `paid ${formatCFA(payload.paid_amount)}`);
    }
  } else if (/^\/sales\/[^/]+\/payment\/?$/.test(ep) || /collect-debt/.test(ep)) {
    if (payload.amount != null) bits.push(formatCFA(payload.amount));
  } else if (/^\/returns\/(return|exchange|void)\//.test(ep)) {
    const items = payload.items_returned || payload.items || [];
    if (Array.isArray(items) && items.length) bits.push(fr ? `${items.length} ligne(s)` : `${items.length} line(s)`);
    if (payload.refund_method) bits.push(payload.refund_method);
  } else if (/^\/expenditures\/?$/.test(ep)) {
    if (payload.amount != null) bits.push(formatCFA(payload.amount));
    if (payload.category) bits.push(payload.category);
  } else if (/^\/shifts\/open\/?$/.test(ep)) {
    if (payload.opening_float != null) bits.push((fr ? "fond " : "float ") + formatCFA(payload.opening_float));
  } else if (/^\/shifts\/[^/]+\/close\/?$/.test(ep)) {
    if (payload.actual_cash != null) bits.push((fr ? "compté " : "counted ") + formatCFA(payload.actual_cash));
  } else if (/^\/transfers\/?$/.test(ep) || /^\/stock\//.test(ep)) {
    const items = payload.items || payload.lines || [];
    if (Array.isArray(items) && items.length) bits.push(fr ? `${items.length} produit(s)` : `${items.length} product(s)`);
  } else if (/^\/products/.test(ep)) {
    if (payload.name) bits.push(payload.name);
  }
  if (cust) bits.push("👤 " + cust);
  return bits.join(" · ");
}

// Status → badge. The queue's 4 live states collapse to the 3 the user asked
// for, with failed_transient shown as "Retrying" (it auto-retries on backoff).
function statusBadge(status, lang) {
  const fr = lang !== "en";
  switch (status) {
    case "queued":           return { text: fr ? "En attente" : "Pending",  bg: "rgba(148,163,184,0.18)", fg: "#94a3b8" };
    case "sending":          return { text: fr ? "Synchro…"   : "Syncing…", bg: "rgba(59,130,246,0.18)",  fg: "#60a5fa" };
    case "failed_transient": return { text: fr ? "Nouvel essai…" : "Retrying…", bg: "rgba(251,191,36,0.18)", fg: "#fbbf24" };
    case "failed_permanent": return { text: fr ? "Échec" : "Failed", bg: "rgba(239,68,68,0.18)", fg: "#f87171" };
    default:                 return { text: status, bg: "rgba(148,163,184,0.18)", fg: "#94a3b8" };
  }
}

function shortError(last_error, lang) {
  if (!last_error) return null;
  const parsed = safeParse(last_error);
  if (parsed && parsed.body && (parsed.body.message || parsed.body.error)) {
    return `${parsed.status || ""} ${parsed.body.message || parsed.body.error}`.trim();
  }
  // markTransient stores a raw string (network/timeout) — show it directly.
  return typeof last_error === "string" ? last_error.slice(0, 120) : null;
}

export default function PendingSyncPage() {
  const { lang } = useLangStore();
  const fr = lang !== "en";
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setRows(await listPending()); } catch { setRows([]); }
  }, []);

  useEffect(() => {
    refresh();
    // The queue calls notify() (→ subscribe callbacks) on every state change:
    // enqueue, attempt → sending, sent (row drops out), failed, retry. Re-list
    // on each so the screen reflects the live queue without polling.
    const unsub = subscribe(() => { refresh(); });
    return () => { unsub && unsub(); };
  }, [refresh]);

  const failedCount = rows.filter(r => r.status === "failed_permanent" || r.status === "failed_transient").length;

  const onRetry = async (id) => { setBusy(true); try { await retry(id); } finally { setBusy(false); refresh(); } };
  const onRetryAll = async () => { setBusy(true); try { await retryAll(); } finally { setBusy(false); refresh(); } };

  const fmtTime = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(fr ? "fr-FR" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">🔄 {fr ? "En attente de synchronisation" : "Pending sync"}</h1>
          <div className="page-sub">
            {fr
              ? "Actions créées hors-ligne, pas encore enregistrées sur le serveur. Vérifiez ici avant de ressaisir."
              : "Actions created offline, not yet saved to the server. Check here before re-entering them."}
          </div>
        </div>
        {failedCount > 0 && (
          <button className="btn btn-secondary" onClick={onRetryAll} disabled={busy}>
            ↻ {fr ? `Tout réessayer (${failedCount})` : `Retry all (${failedCount})`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: 34, marginBottom: 12, opacity: 0.6 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {fr ? "Tout est synchronisé" : "Everything is synced"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {fr ? "Aucune action en attente d'envoi au serveur." : "No actions waiting to reach the server."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const t = describeType(r.endpoint, r.method, lang);
            const payload = safeParse(r.payload_json);
            const details = describeDetails(r.endpoint, payload, lang);
            const badge = statusBadge(r.status, lang);
            const isFailed = r.status === "failed_permanent" || r.status === "failed_transient";
            const err = isFailed ? shortError(r.last_error, lang) : null;
            const ref = payload.sale_number || payload.return_ref || null;
            return (
              <div key={r.id} style={{
                background: "var(--bg-card)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${badge.fg}`, borderRadius: 12, padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
              }}>
                <div style={{ fontSize: 22, width: 26, textAlign: "center" }}>{t.emoji}</div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {t.label}
                    {ref && !String(ref).startsWith("OFFLINE-") && (
                      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{ref}</span>
                    )}
                  </div>
                  {details && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{details}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                    {fmtTime(r.created_at)}
                    {r.attempts > 0 && <span> · {fr ? `essai ${r.attempts}` : `attempt ${r.attempts}`}</span>}
                  </div>
                  {err && (
                    <div style={{ fontSize: 11, color: "#f87171", marginTop: 4, wordBreak: "break-word" }}>⚠ {err}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: badge.bg, color: badge.fg, whiteSpace: "nowrap" }}>
                  {badge.text}
                </span>
                {isFailed && (
                  <button className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }}
                    onClick={() => onRetry(r.id)} disabled={busy}>
                    ↻ {fr ? "Réessayer" : "Retry"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
