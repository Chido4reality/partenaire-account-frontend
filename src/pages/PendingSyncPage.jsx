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
import { useLangStore, useSettingsStore } from "../store";
import { formatCFA } from "../utils/api";
import { getCachedData } from "../utils/offlineStore";
import { listPending, subscribe, retry, retryAll } from "../utils/pendingSync";

// Resolve a line's product name WITHOUT a server call: the queued payload now
// carries `name` (POSPage stamps it onto each item/line before enqueue), with a
// best-effort fallback to the offline product cache for rows queued before that
// change. Debt lines have no product.
function lineName(item, productNames, lang) {
  const fr = lang !== "en";
  if (item.type === "debt_payment" || item.product_id == null) {
    return item.name || (fr ? "Remboursement dette" : "Debt repayment");
  }
  return item.name || productNames[item.product_id] || (fr ? "Produit" : "Item");
}

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

// Expanded detail for a queued row, read entirely from its payload (no server
// call — these are unsynced, so the cart/items live in the queued record).
function RowDetail({ endpoint, payload, productNames, lang }) {
  const fr = lang !== "en";
  const ep = endpoint || "";
  const muted = { fontSize: 11, color: "var(--text-muted)" };
  const ItemRow = ({ name, qty, unit, total, neg }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
      <span style={{ flex: 1 }}>
        {name}
        <span style={{ color: "var(--text-muted)" }}> · {qty} × {formatCFA(unit)}</span>
      </span>
      <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: neg ? "#f87171" : "var(--text-primary)" }}>
        {neg ? "−" : ""}{formatCFA(total)}
      </span>
    </div>
  );
  const Wrap = ({ children }) => (
    <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10 }}>{children}</div>
  );

  // ── SALE ──────────────────────────────────────────────────────────────
  if (/^\/sales\/?$/.test(ep)) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
    const paid = payload.paid_amount != null ? Number(payload.paid_amount) : total;
    const balance = Math.max(0, total - paid);
    const cust = payload.customer_name || (payload.customer_id ? (fr ? "Client" : "Customer") : (fr ? "Client de passage" : "Walk-in"));
    return (
      <Wrap>
        <div style={{ ...muted, marginBottom: 6 }}>👤 {cust}</div>
        {items.length === 0
          ? <div style={muted}>{fr ? "Aucun article dans la file." : "No items in the queued record."}</div>
          : items.map((i, k) => (
              <ItemRow key={k} name={lineName(i, productNames, lang)}
                qty={Number(i.quantity) || 1} unit={Number(i.unit_price) || 0}
                total={(Number(i.quantity) || 1) * (Number(i.unit_price) || 0)} />
            ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontWeight: 800, fontSize: 14 }}>
          <span>{fr ? "Total" : "Total"}</span><span>{formatCFA(total)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12, color: "var(--text-secondary)" }}>
          <span>{fr ? "Payé" : "Paid"}: {formatCFA(paid)}</span>
          {balance > 0 && <span style={{ color: "#fbbf24" }}>{fr ? "Crédit" : "Credit"}: {formatCFA(balance)}</span>}
        </div>
      </Wrap>
    );
  }

  // ── REFUND / EXCHANGE ────────────────────────────────────────────────
  if (/^\/returns\/(return|exchange)\//.test(ep)) {
    const returned = Array.isArray(payload.items_returned) ? payload.items_returned : [];
    const replaced = Array.isArray(payload.replacement_items) ? payload.replacement_items : [];
    return (
      <Wrap>
        <div style={{ ...muted, marginBottom: 4 }}>{fr ? "Articles retournés" : "Returned items"}</div>
        {returned.length === 0 ? <div style={muted}>—</div> : returned.map((i, k) => (
          <ItemRow key={"r"+k} name={lineName(i, productNames, lang)}
            qty={Number(i.qty || i.quantity) || 1} unit={Number(i.unit_price) || 0}
            total={(Number(i.qty || i.quantity) || 1) * (Number(i.unit_price) || 0)} neg />
        ))}
        {replaced.length > 0 && (<>
          <div style={{ ...muted, margin: "8px 0 4px" }}>{fr ? "Articles de remplacement" : "Replacement items"}</div>
          {replaced.map((i, k) => (
            <ItemRow key={"x"+k} name={lineName(i, productNames, lang)}
              qty={Number(i.qty || i.quantity) || 1} unit={Number(i.unit_price) || 0}
              total={(Number(i.qty || i.quantity) || 1) * (Number(i.unit_price) || 0)} />
          ))}
        </>)}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          <span>{fr ? "Mode" : "Method"}: {payload.refund_method || "—"}</span>
          {payload.return_type && <span>{payload.return_type}</span>}
        </div>
      </Wrap>
    );
  }

  // ── DEBT PAYMENT / COLLECT-DEBT ──────────────────────────────────────
  if (/^\/sales\/[^/]+\/payment\/?$/.test(ep) || /collect-debt/.test(ep)) {
    return (
      <Wrap>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}>
          <span>{fr ? "Montant" : "Amount"}</span><span>{formatCFA(Number(payload.amount) || 0)}</span>
        </div>
        <div style={{ ...muted, marginTop: 4 }}>
          {fr ? "Mode" : "Method"}: {payload.payment_method || "cash"}
          {payload.customer_name ? ` · 👤 ${payload.customer_name}` : ""}
        </div>
      </Wrap>
    );
  }

  // ── Fallback (expenses, shifts, stock, products): show known fields ───
  const generic = [];
  if (payload.amount != null) generic.push([fr ? "Montant" : "Amount", formatCFA(payload.amount)]);
  if (payload.opening_float != null) generic.push([fr ? "Fond" : "Float", formatCFA(payload.opening_float)]);
  if (payload.actual_cash != null) generic.push([fr ? "Compté" : "Counted", formatCFA(payload.actual_cash)]);
  if (payload.category) generic.push([fr ? "Catégorie" : "Category", String(payload.category)]);
  if (payload.name) generic.push([fr ? "Nom" : "Name", String(payload.name)]);
  const gItems = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.lines) ? payload.lines : []);
  return (
    <Wrap>
      {generic.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
          <span style={{ color: "var(--text-muted)" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      {gItems.map((i, k) => (
        <ItemRow key={k} name={lineName(i, productNames, lang)}
          qty={Number(i.quantity || i.qty) || 1} unit={Number(i.unit_price || i.cost_price) || 0}
          total={(Number(i.quantity || i.qty) || 1) * (Number(i.unit_price || i.cost_price) || 0)} />
      ))}
      {generic.length === 0 && gItems.length === 0 && (
        <div style={muted}>{fr ? "Aucun détail supplémentaire." : "No further detail."}</div>
      )}
    </Wrap>
  );
}

export default function PendingSyncPage() {
  const { lang } = useLangStore();
  const fr = lang !== "en";
  const { selectedLocation } = useSettingsStore();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [productNames, setProductNames] = useState({});

  // Best-effort product-name map from the offline cache POSPage populates
  // (key "pos-products-<locId>"). Only a fallback — new queued sales already
  // carry item.name in their payload. No network call.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await getCachedData("pos-products-" + (selectedLocation?.id || "all"))
          || await getCachedData("pos-products-all");
        const list = cached?.data || cached || [];
        if (!alive || !Array.isArray(list)) return;
        const map = {};
        for (const p of list) if (p && p.id) map[p.id] = p.name;
        setProductNames(map);
      } catch { /* fallback only */ }
    })();
    return () => { alive = false; };
  }, [selectedLocation?.id]);

  const toggle = (id) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
            const isOpen = expanded.has(r.id);
            return (
              <div key={r.id} style={{
                background: "var(--bg-card)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${badge.fg}`, borderRadius: 12, padding: "12px 16px",
              }}>
                {/* Header row — tap to expand the queued-action detail. */}
                <div onClick={() => toggle(r.id)}
                  style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }}>
                  <div style={{ fontSize: 22, width: 26, textAlign: "center" }}>{t.emoji}</div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)", fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
                      {t.label}
                      {ref && !String(ref).startsWith("OFFLINE-") && (
                        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{ref}</span>
                      )}
                    </div>
                    {details && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2, paddingLeft: 12 }}>{details}</div>}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, paddingLeft: 12 }}>
                      {fmtTime(r.created_at)}
                      {r.attempts > 0 && <span> · {fr ? `essai ${r.attempts}` : `attempt ${r.attempts}`}</span>}
                      {!isOpen && <span> · {fr ? "toucher pour détails" : "tap for details"}</span>}
                    </div>
                    {err && (
                      <div style={{ fontSize: 11, color: "#f87171", marginTop: 4, wordBreak: "break-word", paddingLeft: 12 }}>⚠ {err}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10, background: badge.bg, color: badge.fg, whiteSpace: "nowrap" }}>
                    {badge.text}
                  </span>
                  {isFailed && (
                    <button className="btn btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }}
                      onClick={(e) => { e.stopPropagation(); onRetry(r.id); }} disabled={busy}>
                      ↻ {fr ? "Réessayer" : "Retry"}
                    </button>
                  )}
                </div>
                {/* Expanded detail — full line items, read from the queued payload. */}
                {isOpen && <RowDetail endpoint={r.endpoint} payload={payload} productNames={productNames} lang={lang} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
