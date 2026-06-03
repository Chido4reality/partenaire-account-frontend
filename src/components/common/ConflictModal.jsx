// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 3
//
// Conflict resolution modal for pending_sync rows that reached
// failed_permanent — usually a 409 from the backend
// (STOCK_CONFLICT / DEBT_CONFLICT / SHIFT_CLOSED) or an exhausted
// transient-retry budget. Surfaces the rows with two minimum-viable
// actions: Retry (queue it again, status='queued', attempts=0) and
// Discard (delete from queue).
//
// Slice 3 scope is "list + retry / discard". Full conflict-resolution
// UX (adjust qty, edit payment amount, reopen shift, etc.) is a
// follow-up — those flows touch each endpoint's payload shape and
// each deserves its own focused commit.

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useLangStore } from "../../store";
import { listFailedPermanent, retry, discard } from "../../utils/pendingSync";

function parseError(s) {
  if (!s) return { status: null, body: null, raw: null };
  try { return JSON.parse(s); } catch { return { status: null, body: null, raw: s }; }
}

function endpointLabel(endpoint, lang) {
  const en = lang === "en";
  if (/^\/sales$/.test(endpoint))                   return en ? "Sale" : "Vente";
  if (/^\/sales\/[^/]+\/payment/.test(endpoint))    return en ? "Payment" : "Paiement";
  if (/^\/returns\/return\//.test(endpoint))        return en ? "Refund" : "Remboursement";
  if (/^\/returns\/exchange\//.test(endpoint))      return en ? "Exchange" : "Échange";
  if (/^\/returns\/void\//.test(endpoint))          return en ? "Void" : "Annulation";
  if (/^\/expenditures$/.test(endpoint))            return en ? "Expense" : "Dépense";
  if (/^\/stock-transfers$/.test(endpoint))         return en ? "Transfer" : "Transfert";
  if (/^\/stock\/arrivals$/.test(endpoint))         return en ? "Arrival" : "Arrivée";
  return endpoint;
}

function shortCause(err, lang) {
  const en = lang === "en";
  const code = err.body?.code || err.body?.data?.code;
  if (code === "STOCK_CONFLICT")    return en ? "Stock conflict (insufficient on server)" : "Conflit de stock (insuffisant côté serveur)";
  if (code === "DEBT_CONFLICT")     return en ? "Customer debt drift (server differs)"    : "Dette client divergente (serveur diffère)";
  if (code === "SHIFT_CLOSED")      return en ? "Shift closed on the server"              : "Poste fermé côté serveur";
  if (code === "NO_OPEN_SHIFT")     return en ? "No open shift at this location"          : "Aucun poste ouvert sur ce site";
  if (code === "VOID_REASON_REQUIRED") return en ? "Reason required for void"             : "Raison requise pour l'annulation";
  if (code === "BELOW_MIN_PRICE")   return en ? "Price below minimum allowed"             : "Prix sous le minimum autorisé";
  const msg = err.body?.message || err.body?.data?.message || err.raw;
  return msg || (en ? "Server rejected this action" : "Action refusée par le serveur");
}

export default function ConflictModal({ onClose }) {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const reload = () => listFailedPermanent().then(setRows).catch(() => setRows([]));
  useEffect(() => { reload(); const t = setInterval(reload, 5000); return () => clearInterval(t); }, []);

  const handleRetry = async (id) => {
    setBusyId(id);
    try {
      await retry(id);
      toast.success(en ? "Re-queued for sync" : "Renvoyé à la file d'attente");
      reload();
    } finally { setBusyId(null); }
  };
  const handleDiscard = async (id) => {
    if (!confirm(en ? "Discard this queued action? It will be lost." : "Abandonner cette action ? Elle sera perdue.")) return;
    setBusyId(id);
    try {
      await discard(id);
      toast.success(en ? "Discarded" : "Abandonné");
      reload();
    } finally { setBusyId(null); }
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, maxWidth: 560, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>⚠ {en ? "Sync conflicts" : "Conflits de synchronisation"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {en
                ? `${rows.length} action${rows.length === 1 ? "" : "s"} the server rejected. Retry or discard each.`
                : `${rows.length} action${rows.length === 1 ? "" : "s"} refusée${rows.length === 1 ? "" : "s"} par le serveur. Réessayez ou abandonnez.`}
            </div>
          </div>
          <button onClick={onClose} aria-label="close"
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 18px" }}>
          {rows.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {en ? "No conflicts. ✓" : "Aucun conflit. ✓"}
            </div>
          )}
          {rows.map(r => {
            const err = parseError(r.last_error);
            const payload = (() => { try { return JSON.parse(r.payload_json); } catch { return {}; } })();
            const cause = shortCause(err, lang);
            return (
              <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{endpointLabel(r.endpoint, lang)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(r.created_at).toLocaleString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#f87171", marginBottom: 6 }}>
                  {cause}
                </div>
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
                    {en ? "View payload + server response" : "Afficher la requête + réponse"}
                  </summary>
                  <pre style={{ fontSize: 10, background: "var(--bg-elevated)", padding: 8, borderRadius: 6, overflow: "auto", maxHeight: 200, margin: "6px 0 0" }}>
{JSON.stringify({ endpoint: r.endpoint, attempts: r.attempts, payload, server: err.body || err.raw }, null, 2)}
                  </pre>
                </details>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleRetry(r.id)} disabled={busyId === r.id}
                    style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "var(--brand)", color: "#152B52", fontWeight: 700, fontSize: 12, cursor: busyId === r.id ? "not-allowed" : "pointer" }}>
                    ↻ {en ? "Retry" : "Réessayer"}
                  </button>
                  <button onClick={() => handleDiscard(r.id)} disabled={busyId === r.id}
                    style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.4)", background: "transparent", color: "#f87171", fontWeight: 700, fontSize: 12, cursor: busyId === r.id ? "not-allowed" : "pointer" }}>
                    🗑 {en ? "Discard" : "Abandonner"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
