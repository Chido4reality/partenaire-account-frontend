// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 3 + MP-PAUL-SYNC-VISIBILITY
//
// Visible sync queue. Lists EVERY pending_sync row that isn't yet confirmed
// on the server — queued (waiting), sending (in flight), failed_transient
// (retrying on backoff) and failed_permanent (server rejected / retries
// exhausted) — so the cashier can SEE exactly what hasn't synced, WHY, and
// act on it: Retry per item, Retry all, or Discard. Previously this only
// listed failed_permanent, so a sale stuck in queued/transient was invisible
// (Paul: "some sales didn't sync and there's nowhere to see them").
//
// Durability note: failed/transient/queued rows persist in localDb
// (SQLite native / IndexedDB web) across app restarts and are never silently
// dropped — only 'sent' rows are GC'd. So this list survives a relaunch and
// an APK upgrade (same signing key keeps app data), letting Paul flush
// pending sales before switching versions.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useLangStore } from "../../store";
import { listPending, retry, retryAll, discard } from "../../utils/pendingSync";

function parseError(s) {
  if (!s) return { status: null, body: null, raw: null };
  try { return JSON.parse(s); } catch { return { status: null, body: null, raw: s }; }
}

function endpointLabel(endpoint, lang) {
  const en = lang === "en";
  if (/^\/sales$/.test(endpoint))                   return en ? "Sale" : "Vente";
  if (/^\/sales\/[^/]+\/payment/.test(endpoint))    return en ? "Payment" : "Paiement";
  if (/^\/shifts\/open/.test(endpoint))             return en ? "Open shift" : "Ouverture de poste";
  if (/^\/returns\/return\//.test(endpoint))        return en ? "Refund" : "Remboursement";
  if (/^\/returns\/exchange\//.test(endpoint))      return en ? "Exchange" : "Échange";
  if (/^\/returns\/void\//.test(endpoint))          return en ? "Void" : "Annulation";
  if (/^\/expenditures$/.test(endpoint))            return en ? "Expense" : "Dépense";
  if (/^\/stock-transfers$/.test(endpoint))         return en ? "Transfer" : "Transfert";
  if (/^\/stock\/arrivals$/.test(endpoint))         return en ? "Arrival" : "Arrivée";
  if (/^\/products$/.test(endpoint))                return en ? "Product" : "Produit";
  if (/^\/customers$/.test(endpoint))               return en ? "Customer" : "Client";
  return endpoint;
}

// Per-status presentation. 'sending'/'queued' are normal in-flight states, not
// errors — neutral/amber. 'failed_transient' is retrying. 'failed_permanent'
// is the only red "needs you" state.
function statusMeta(status, lang) {
  const en = lang === "en";
  switch (status) {
    case "failed_permanent": return { color: "#f87171", label: en ? "Failed" : "Échec" };
    case "failed_transient": return { color: "#fbbf24", label: en ? "Retrying" : "Nouvel essai" };
    case "sending":          return { color: "#60a5fa", label: en ? "Sending…" : "Envoi…" };
    case "queued":
    default:                 return { color: "var(--text-muted)", label: en ? "Waiting" : "En attente" };
  }
}

function reasonText(r, lang) {
  const en = lang === "en";
  if (r.status === "queued")  return en ? "Waiting for connection to sync." : "En attente de connexion pour synchroniser.";
  if (r.status === "sending") return en ? "Sending to server now…" : "Envoi au serveur en cours…";
  const err = parseError(r.last_error);
  const code = err.body?.code || err.body?.data?.code;
  const MAP = {
    STOCK_CONFLICT:      en ? "Stock conflict (insufficient on server)" : "Conflit de stock (insuffisant côté serveur)",
    DEBT_CONFLICT:       en ? "Customer debt drift (server differs)"    : "Dette client divergente (serveur diffère)",
    SHIFT_CLOSED:        en ? "Shift closed on the server"              : "Poste fermé côté serveur",
    NO_OPEN_SHIFT:       en ? "No open shift at this location"          : "Aucun poste ouvert sur ce site",
    VOID_REASON_REQUIRED:en ? "Reason required for void"               : "Raison requise pour l'annulation",
    BELOW_MIN_PRICE:     en ? "Price below minimum allowed"            : "Prix sous le minimum autorisé",
  };
  if (code && MAP[code]) return MAP[code];
  const msg = err.body?.message || err.body?.data?.message || err.raw || r.last_error;
  if (msg) return msg;
  return r.status === "failed_transient"
    ? (en ? "Temporary failure — will retry automatically." : "Échec temporaire — nouvel essai automatique.")
    : (en ? "Server rejected this action." : "Action refusée par le serveur.");
}

export default function ConflictModal({ onClose }) {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);

  const reload = () => listPending().then(setRows).catch(() => setRows([]));
  useEffect(() => { reload(); const t = setInterval(reload, 4000); return () => clearInterval(t); }, []);

  const failedCount  = rows.filter(r => r.status === "failed_permanent" || r.status === "failed_transient").length;
  const waitingCount = rows.filter(r => r.status === "queued" || r.status === "sending").length;

  // Dependent-ordering visibility: when a /shifts/open is still unsynced, the
  // queued sales for that shift are deliberately HELD (they'd hit NO_OPEN_SHIFT
  // if they raced ahead). Surface that relationship so the user sees the full
  // set waiting, not just the shift row.
  const isSaleEp  = (ep) => /^\/sales(\/|$)/.test(ep || "");
  const isShiftEp = (ep) => /^\/shifts\/open/.test(ep || "");
  const pendingShift = rows.find(r => isShiftEp(r.endpoint) && r.status !== "sent");
  const salesWaiting = pendingShift
    ? rows.filter(r => isSaleEp(r.endpoint) && r.status !== "sent").length
    : 0;

  const handleRetry = async (id) => {
    setBusyId(id);
    try { await retry(id); toast.success(en ? "Re-queued for sync" : "Renvoyé à la file"); reload(); }
    finally { setBusyId(null); }
  };
  const handleRetryAll = async () => {
    setBusyAll(true);
    try { const n = await retryAll(); toast.success(en ? `Re-queued ${n} item(s)` : `${n} élément(s) renvoyé(s)`); reload(); }
    finally { setBusyAll(false); }
  };
  const handleDiscard = async (r) => {
    const isSale = /^\/sales/.test(r.endpoint);
    const msg = isSale
      ? (en ? "Discard this SALE? It will be permanently lost and never recorded. Only do this if it was a mistake."
            : "Abandonner cette VENTE ? Elle sera définitivement perdue et jamais enregistrée. À ne faire que si c'était une erreur.")
      : (en ? "Discard this queued action? It will be lost." : "Abandonner cette action ? Elle sera perdue.");
    if (!confirm(msg)) return;
    setBusyId(r.id);
    try { await discard(r.id); toast.success(en ? "Discarded" : "Abandonné"); reload(); }
    finally { setBusyId(null); }
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, maxWidth: 560, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>🔄 {en ? "Sync queue" : "File de synchronisation"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {rows.length === 0
                ? (en ? "Everything is synced. ✓" : "Tout est synchronisé. ✓")
                : (en
                    ? `${waitingCount} waiting · ${failedCount} need attention`
                    : `${waitingCount} en attente · ${failedCount} à vérifier`)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {failedCount > 0 && (
              <button onClick={handleRetryAll} disabled={busyAll}
                style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#152B52", fontWeight: 700, fontSize: 12, cursor: busyAll ? "not-allowed" : "pointer" }}>
                ↻ {en ? "Retry all" : "Tout réessayer"}
              </button>
            )}
            <button onClick={onClose} aria-label="close"
              style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 18px" }}>
          {pendingShift && (
            <div style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
              ⏳ {en
                ? `A shift-open is still syncing. ${salesWaiting} sale${salesWaiting === 1 ? "" : "s"} ${salesWaiting === 1 ? "is" : "are"} waiting for it — they'll send automatically once the shift lands on the server. They keep retrying on every reconnect; nothing is lost.`
                : `Une ouverture de poste est en cours de synchronisation. ${salesWaiting} vente${salesWaiting === 1 ? "" : "s"} ${salesWaiting === 1 ? "attend" : "attendent"} — elles s'enverront automatiquement une fois le poste enregistré. Elles réessaient à chaque reconnexion ; rien n'est perdu.`}
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {en ? "No pending or failed items. Everything is synced. ✓" : "Aucun élément en attente ou en échec. Tout est synchronisé. ✓"}
            </div>
          )}
          {rows.map(r => {
            const err = parseError(r.last_error);
            const payload = (() => { try { return JSON.parse(r.payload_json); } catch { return {}; } })();
            const sm = statusMeta(r.status, lang);
            const canRetry = r.status === "failed_permanent" || r.status === "failed_transient";
            const canDiscard = r.status !== "sending";
            return (
              <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{endpointLabel(r.endpoint, lang)}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: sm.color, border: `1px solid ${sm.color}`, borderRadius: 8, padding: "1px 7px", flexShrink: 0 }}>{sm.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                    {new Date(r.created_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: canRetry && r.status === "failed_permanent" ? "#f87171" : "var(--text-secondary)", marginBottom: 6 }}>
                  {reasonText(r, lang)}
                </div>
                {isSaleEp(r.endpoint) && pendingShift && r.status !== "failed_permanent" && (
                  <div style={{ fontSize: 11, color: "#fbbf24", marginBottom: 6 }}>
                    ⏳ {en ? "Held until the shift-open syncs (then sends automatically)" : "En attente de l'ouverture de poste (envoi automatique ensuite)"}
                  </div>
                )}
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
                    {en ? "View payload + server response" : "Afficher la requête + réponse"}
                  </summary>
                  <pre style={{ fontSize: 10, background: "var(--bg-elevated)", padding: 8, borderRadius: 6, overflow: "auto", maxHeight: 200, margin: "6px 0 0" }}>
{JSON.stringify({ endpoint: r.endpoint, status: r.status, attempts: r.attempts, payload, server: err.body || err.raw }, null, 2)}
                  </pre>
                </details>
                {(canRetry || canDiscard) && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {canRetry && (
                      <button onClick={() => handleRetry(r.id)} disabled={busyId === r.id}
                        style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#152B52", fontWeight: 700, fontSize: 12, cursor: busyId === r.id ? "not-allowed" : "pointer" }}>
                        ↻ {en ? "Retry" : "Réessayer"}
                      </button>
                    )}
                    {canDiscard && (
                      <button onClick={() => handleDiscard(r)} disabled={busyId === r.id}
                        style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", background: "transparent", color: "#f87171", fontWeight: 700, fontSize: 12, cursor: busyId === r.id ? "not-allowed" : "pointer" }}>
                        🗑 {en ? "Discard" : "Abandonner"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
