import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { transferCountLabel } from "../utils/transferCount"; // MP-APPROVAL-FULL-DETAIL
import { useMyPermissions } from "../utils/useMyPermissions";
import { allowedOutcomes } from "../utils/transferVarianceOutcomes";
import ShortfallLinesPicker, { LATER, shortfallMissing, shortfallLinesBody } from "./common/ShortfallLinesPicker";

// ── MP-TRANSFER-VARIANCE-CLOSE (F4) + VARIANCE OUTCOMES (2026-10-10, per line 2026-10-11)
// What happened to the missing pieces — ONE answer per short line (the shared
// ShortfallLinesPicker). NO default: the old list preselected "arrived later", so one
// tap on Close credited sellable stock that never existed (TRF-20261009-0001, where
// the owner meant Damaged).

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

// initialReason / initialProduct: ONLY an answer the owner already gave elsewhere — the
// stock-check mismatch's "Where did they go?" for that product — carried through the
// hand-off so it is not lost. It fills that one line and still needs the Close tap;
// it is never a default.
export default function TransferDetailModal({ transferId, onClose, initialReason = null, initialProduct = null }) {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const { perms: myPerms } = useMyPermissions({ enabled: role === "manager" });
  const options = allowedOutcomes({ isOwner: role === "owner", canCancelTransfers: role === "manager" && !!myPerms?.can_cancel_transfers });
  const [answers, setAnswers] = useState({});

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
  // One picker line per PRODUCT (the server keys answers by product).
  const shortLines = Object.values(outstanding.reduce((acc, l) => {
    const pid = String(l.product_id);
    acc[pid] = { product_id: pid, name: nameFor(l.product_id), missing: (acc[pid]?.missing || 0) + Number(l.outstanding || 0) };
    return acc;
  }, {}));
  const missingAnswers = shortfallMissing(shortLines, answers);
  const allLater = shortLines.length > 0 && shortLines.every((l) => answers[l.product_id]?.reason === LATER);

  // The carried stock-check answer fills its own line, once the line and (for a
  // manager) the grant are known.
  const carriedOk = initialReason && initialProduct && options.some((o) => o.key === initialReason)
    && shortLines.some((l) => l.product_id === String(initialProduct));
  useEffect(() => {
    if (carriedOk && !answers[String(initialProduct)])
      setAnswers((a) => ({ ...a, [String(initialProduct)]: { reason: initialReason, note: "" } }));
  }, [carriedOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveMut = useMutation({
    mutationFn: () => api.post(`/transfers/${transferId}/resolve-variance`, { lines: shortfallLinesBody(shortLines, answers) }).then((r) => r.data),
    onSuccess: (res) => {
      const parts = [];
      if (res.piled) parts.push(en ? `${res.piled} to the Damaged pile` : `${res.piled} en pile Endommagés`);
      if (res.written_off) parts.push(en ? `${res.written_off} written off` : `${res.written_off} passées en perte`);
      if (res.credited) parts.push(en ? `${res.credited} added to ${t?.to_name || "the destination"}` : `${res.credited} ajoutées à ${t?.to_name || "la destination"}`);
      if (res.returned) parts.push(en ? `${res.returned} returned to ${t?.from_name || "the source"}` : `${res.returned} renvoyées à ${t?.from_name || "la source"}`);
      toast.success(res.already ? (en ? "Already closed" : "Déjà clos")
        : `${res.variance_closed ? (en ? "Variance closed" : "Écart clos") : (en ? `${res.later} line(s) left open` : `${res.later} ligne(s) laissée(s) ouverte(s)`)}${parts.length ? " — " + parts.join(", ") : ""}`);
      setAnswers({});
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
  const statusText = t?.display_status === "completed_on_hold"
    // RECEIVE-MISMATCH GATE: held / recount lines are counted nowhere yet.
    ? (en ? `Completed — ${(t.held_lines || 0) + (t.recount_lines || 0)} line(s) on hold`
          : `Terminé — ${(t.held_lines || 0) + (t.recount_lines || 0)} ligne(s) en attente`)
    : t?.display_status === "completed_with_variance"
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

                {options.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.5 }}>
                    {en ? "The owner closes this. Until then it stays open on the transfer."
                        : "Le patron doit le clore. En attendant, il reste ouvert sur le transfert."}
                  </div>
                ) : (
                  <>
                    <div style={{ marginTop: 10 }}>
                      <ShortfallLinesPicker en={en} lines={shortLines} options={options} answers={answers}
                        setAnswers={setAnswers} allowLater sourceName={t.from_name} disabled={resolveMut.isPending} />
                    </div>
                    {carriedOk && answers[String(initialProduct)]?.reason === initialReason && (
                      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.45 }}>
                        {en ? `${nameFor(initialProduct)}: filled in from your answer on the stock check. Check it, then close.`
                            : `${nameFor(initialProduct)} : rempli depuis votre réponse sur la vérification. Vérifiez, puis clôturez.`}
                      </div>
                    )}
                    <button className="btn btn-primary" style={{ width: "100%", marginTop: 10, fontWeight: 700 }}
                      disabled={resolveMut.isPending || missingAnswers.length > 0 || allLater} onClick={() => resolveMut.mutate()}>
                      {resolveMut.isPending ? "…"
                        : missingAnswers.length ? (en ? `Choose for ${missingAnswers.length} more line(s)` : `Choisissez pour ${missingAnswers.length} ligne(s) de plus`)
                        : allLater ? (en ? "Every line is “Decide later”" : "Toutes les lignes : « Décider plus tard »")
                        : (en ? "Close these lines" : "Clore ces lignes")}
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
                      {/* BLIND COUNT: absent (not 0) for a receiver whose count is awaited — the server withheld it. */}
                      {it.quantity === undefined || it.quantity === null
                        ? (en ? "sent: hidden until you count" : "envoyé : masqué jusqu'à votre comptage")
                        : `${en ? "sent" : "envoyé"} ${it.quantity}`}
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
