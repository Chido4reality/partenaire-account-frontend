import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { transferCountLabel } from "../utils/transferCount"; // MP-APPROVAL-FULL-DETAIL

// ── MP-TRANSFER-VARIANCE-CLOSE (F4) ─────────────────────────────────────────
// What happened to the missing pieces. Mirrors the backend's three reasons.
// Only received_late moves sellable stock; the other two are records, not
// corrections — see the route comment for why writing a "loss" movement would
// double-subtract stock the shop still has.
const VARIANCE_REASONS = [
  { key: "received_late", en: "They arrived later", fr: "Elles sont arrivées plus tard",
    hintEn: "Add them to the destination's stock now.",
    hintFr: "Les ajouter maintenant au stock de la destination." },
  { key: "damaged", en: "They arrived broken", fr: "Elles sont arrivées cassées",
    hintEn: "Record them in the damaged pile — not added to sellable stock.",
    hintFr: "Les enregistrer dans la pile Endommagés — pas en stock vendable." },
  { key: "lost_in_transit", en: "They never arrived", fr: "Elles ne sont jamais arrivées",
    hintEn: "Record the loss. Stock already reflects it — nothing is deducted twice.",
    hintFr: "Enregistrer la perte. Le stock en tient déjà compte — rien n'est déduit deux fois." },
];

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
  const qc = useQueryClient();
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const [reason, setReason] = useState("received_late");
  const [note, setNote] = useState("");

  const { data: resp, isLoading, isError } = useQuery({
    queryKey: ["transfer-detail", transferId],
    queryFn: () => api.get(`/transfers/${transferId}`).then((r) => r.data),
    enabled: !!transferId,
  });
  const t = resp?.data || null;
  const items = t?.pa_transfer_items || [];
  const itemCount = items.length;
  const varianceOpen = !!t?.variance_open;
  const outstanding = t?.variance_lines || [];
  const nameFor = (pid) => items.find((i) => i.product_id === pid)?.pa_products?.name || (en ? "Item" : "Article");
  const totalOutstanding = outstanding.reduce((s, l) => s + Number(l.outstanding || 0), 0);

  const resolveMut = useMutation({
    mutationFn: () => api.post(`/transfers/${transferId}/resolve-variance`, { reason, note: note.trim() || null }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res.stock_changed
        ? (en ? `Variance closed — ${res.credited} added to stock` : `Écart clos — ${res.credited} ajoutées au stock`)
        : (en ? "Variance closed — stock unchanged" : "Écart clos — stock inchangé"));
      qc.invalidateQueries({ queryKey: ["transfer-detail", transferId] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["stock-checks"] });
      qc.invalidateQueries({ queryKey: ["stock-check-summary"] });
    },
    onError: (e) => toast.error(e?.response?.data?.[en ? "message_en" : "message_fr"] || e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  // display_status is DERIVED server-side; t.status is left untouched in the DB so
  // no existing consumer changes behaviour. Showing the raw "completed" beside an
  // unresolved-variance badge is what made a transfer with six missing pieces read
  // as finished — the same shape as Paul's 20 Complete Chain Bajaj.
  const statusText = t?.display_status === "completed_with_variance"
    ? (en ? "Completed — variance unresolved" : "Terminé — écart non résolu")
    : (t?.status || "—");

  const varianceText = t
    ? (t.has_variance
        ? (t.variance_resolved_at
            ? `✓ ${en ? "Variance — resolved by" : "Écart — résolu par"} ${t.variance_resolved_by_name || "—"}`
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
              {/* MP-APPROVAL-FULL-DETAIL: was "{n} items/articles", which conflated
                  distinct products with total pieces. Same wording as every other
                  transfer count summary now. */}
              <span style={pill}>{transferCountLabel(items, en, { short: true })}</span>
              <span style={pill}>{t.confirm_pin_verified ? `🔐 ${en ? "PIN verified" : "PIN vérifié"}` : `○ ${en ? "No PIN" : "Sans PIN"}`}</span>
              <span style={varianceOpen ? pillWarn : pill}>{varianceText}</span>
              <span style={varianceOpen ? pillWarn : pill}>{en ? "Status" : "Statut"}: {statusText}</span>
            </div>

            {/* ── F4: the variance is the thing to ACT on, so it sits above the
                item list rather than as a pill you can read past. Owner-only,
                matching /stock-checks/:id/resolve. ── */}
            {varianceOpen && (
              <div style={{ marginTop: 14, borderRadius: 12, padding: "12px 14px",
                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.32)" }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: "#fbbf24", marginBottom: 6 }}>
                  {en ? `${totalOutstanding} piece(s) unaccounted for` : `${totalOutstanding} pièce(s) non justifiée(s)`}
                </div>
                {outstanding.map((l) => (
                  <div key={l.check_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0", color: "var(--text-secondary)" }}>
                    <span>{nameFor(l.product_id)}</span><span style={{ fontWeight: 700 }}>−{l.outstanding}</span>
                  </div>
                ))}

                {!isOwner ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                    {en ? "The owner closes this. Until then it stays open on the transfer."
                        : "Le patron doit le clore. En attendant, il reste ouvert sur le transfert."}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", margin: "10px 0 6px" }}>
                      {en ? "What happened to them?" : "Que leur est-il arrivé ?"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {VARIANCE_REASONS.map((r) => (
                        <button key={r.key} onClick={() => setReason(r.key)} disabled={resolveMut.isPending}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 10, cursor: "pointer",
                            background: reason === r.key ? "rgba(99,102,241,0.14)" : "transparent",
                            border: `1px solid ${reason === r.key ? "rgba(99,102,241,0.55)" : "var(--border)"}` }}>
                          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{en ? r.en : r.fr}</div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{en ? r.hintEn : r.hintFr}</div>
                        </button>
                      ))}
                    </div>
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={en ? "Note (optional)" : "Note (facultative)"} style={{ marginTop: 8 }} />
                    <button className="btn btn-primary" style={{ width: "100%", marginTop: 8, fontWeight: 700 }}
                      disabled={resolveMut.isPending} onClick={() => resolveMut.mutate()}>
                      {resolveMut.isPending ? "…" : (en ? "Close this variance" : "Clore cet écart")}
                    </button>
                  </>
                )}
              </div>
            )}

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
const pillWarn = { ...pill, background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24" };
