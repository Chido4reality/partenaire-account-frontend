import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";

// MP-STAFF-ACTIVITY-LEDGER Phase 3: the full plain-language transfer chain, reachable from
// the Transfers list, the Activity Ledger, and search (?tr=<id>). Shop-timezone times.
function fmtWhen(iso, en) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(en ? "en-GB" : "fr-FR",
      { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function Step({ icon, label, who, when }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0" }}>
      <div style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{who || "—"}</div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{when}</div>
    </div>
  );
}

export default function TransferDetailModal({ transferId, onClose }) {
  const { lang } = useLangStore();
  const en = lang === "en";

  const { data: resp, isLoading, isError } = useQuery({
    queryKey: ["transfer-detail", transferId],
    queryFn: () => api.get(`/transfers/${transferId}`).then((r) => r.data),
    enabled: !!transferId,
  });
  const t = resp?.data || null;
  const items = t?.pa_transfer_items || [];
  const itemCount = items.length;

  const varianceText = t
    ? (t.has_variance
        ? (t.variance_resolved_at
            ? `⚠️ ${en ? "Variance — resolved by" : "Écart — résolu par"} ${t.variance_resolved_by_name || "—"}`
            : `⚠️ ${en ? "Variance — unresolved" : "Écart — non résolu"}`)
        : `✓ ${en ? "No variance" : "Aucun écart"}`)
    : "";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: 16, padding: 20, maxWidth: 460, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>{en ? "Loading…" : "Chargement…"}</div>
        ) : isError || !t ? (
          <div style={{ textAlign: "center", color: "var(--danger, #dc2626)", padding: 30 }}>{en ? "Could not load this transfer." : "Impossible de charger ce transfert."}</div>
        ) : (
          <>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>📦 {t.transfer_number}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 12 }}>
              {t.from_name || "—"} <span style={{ color: "var(--brand)" }}>→</span> {t.to_name || (en ? "(no destination)" : "(sans destination)")}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
              <Step icon="📝" label={en ? "Started by" : "Initié par"} who={t.initiated_by_name} when={fmtWhen(t.transfer_date || t.created_at, en)} />
              {t.dispatched_at && <Step icon="📤" label={en ? "Dispatched by" : "Expédié par"} who={t.dispatched_by_name} when={fmtWhen(t.dispatched_at, en)} />}
              {t.received_at
                ? <Step icon="📥" label={en ? "Received by" : "Reçu par"} who={t.received_by_name} when={fmtWhen(t.received_at, en)} />
                : <Step icon="⏳" label={en ? "Received by" : "Reçu par"} who={en ? "Not yet received" : "Pas encore reçu"} when="" />}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <span style={pill}>{itemCount} {en ? (itemCount === 1 ? "item" : "items") : (itemCount === 1 ? "article" : "articles")}</span>
              <span style={pill}>{t.confirm_pin_verified ? `🔐 ${en ? "PIN verified" : "PIN vérifié"}` : `○ ${en ? "No PIN" : "Sans PIN"}`}</span>
              <span style={pill}>{varianceText}</span>
              <span style={pill}>{en ? "Status" : "Statut"}: {t.status}</span>
            </div>

            {itemCount > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{en ? "Items" : "Articles"}</div>
                {items.map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>{it.pa_products?.name || (en ? "Item" : "Article")}</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {en ? "sent" : "envoyé"} {it.quantity}
                      {it.received_quantity != null && ` · ${en ? "received" : "reçu"} ${it.received_quantity}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={onClose} className="btn btn-secondary" style={{ width: "100%", marginTop: 16 }}>{en ? "Close" : "Fermer"}</button>
          </>
        )}
      </div>
    </div>
  );
}

const pill = { fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 999, background: "var(--bg-elevated)", border: "1px solid var(--border)" };
