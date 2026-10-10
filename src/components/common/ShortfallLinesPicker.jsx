// TRANSFER VARIANCE — PER-LINE OUTCOMES (Peter, 2026-10-11). One answer per short
// line, because one transfer can carry three stories (TRF-20261010-0001: head lamp
// GN damaged, Tube 275/18 stolen, Tube 300/17 left in the warehouse). Shared by the
// held-receipt approval (HoldShortfallFields) and the transfer screen
// (TransferDetailModal), so both ask the same question in the same words.
//
// NOTHING is preselected — with one exception: when "Decide later" is the ONLY
// answer this person may give (an ungranted manager), it is chosen for them, since
// there is nothing to choose between. Readiness is per line, and the lines still
// waiting are NAMED, so a dim button is never a mystery.
import { useEffect } from "react";
import { outcomeByKey, outcomeNoteRequired } from "../../utils/transferVarianceOutcomes";

export const LATER = "later";
const LATER_LABEL = { en: "Decide later", fr: "Décider plus tard",
  hintEn: "This line stays open on the transfer.", hintFr: "Cette ligne reste ouverte sur le transfert." };

const labelOf = (key, en) => key === LATER ? (en ? LATER_LABEL.en : LATER_LABEL.fr) : (en ? outcomeByKey(key).en : outcomeByKey(key).fr);
const hintOf = (key, en, sourceName) => {
  if (key === LATER) return en ? LATER_LABEL.hintEn : LATER_LABEL.hintFr;
  if (key === "return_to_source" && sourceName)
    return en ? `Put back into ${sourceName}'s stock now.` : `Remises maintenant dans le stock de ${sourceName}.`;
  const o = outcomeByKey(key); return en ? o.hintEn : o.hintFr;
};

/** Lines still waiting for an answer (or for the note "Other" needs). */
export function shortfallMissing(lines, answers) {
  return lines.filter((l) => {
    const a = answers[l.product_id];
    return !a || !a.reason || (outcomeNoteRequired(a.reason) && !String(a.note || "").trim());
  });
}

/** The `lines` body for the API. */
export function shortfallLinesBody(lines, answers) {
  return lines.map((l) => ({ product_id: l.product_id, reason: answers[l.product_id].reason,
    note: String(answers[l.product_id].note || "").trim() || null }));
}

export default function ShortfallLinesPicker({ en, lines, options, answers, setAnswers, allowLater = true, sourceName, disabled }) {
  const keys = [...options.map((o) => o.key), ...(allowLater ? [LATER] : [])];
  const onlyLater = keys.length === 1 && keys[0] === LATER;
  const lineKey = lines.map((l) => l.product_id).join(",");

  // Only answer available → it is the answer (see header). Never otherwise.
  useEffect(() => {
    if (!onlyLater) return;
    if (lines.every((l) => answers[l.product_id]?.reason === LATER)) return;
    setAnswers(Object.fromEntries(lines.map((l) => [l.product_id, { reason: LATER, note: "" }])));
  }, [onlyLater, lineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOne = (pid, patch) => setAnswers({ ...answers, [pid]: { ...(answers[pid] || { note: "" }), ...patch } });
  const applyAll = (reason) => {
    if (!reason) return;
    setAnswers(Object.fromEntries(lines.map((l) => [l.product_id, { reason, note: answers[l.product_id]?.note || "" }])));
  };
  const missing = shortfallMissing(lines, answers);
  const total = lines.reduce((s, l) => s + Number(l.missing || 0), 0);
  const selectStyle = { marginTop: 6, colorScheme: "dark" };

  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
        {en ? `${total} unit(s) did not arrive, on ${lines.length} line(s). What happened on each line?`
            : `${total} unité(s) ne sont pas arrivées, sur ${lines.length} ligne(s). Que s'est-il passé sur chaque ligne ?`}
      </div>

      {onlyLater && (
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.45 }}>
          {en ? "You can approve the receipt. What happened to the missing units is decided by the owner (or a manager allowed to), on the transfer."
              : "Vous pouvez approuver la réception. Le patron (ou un gérant autorisé) décidera du sort des unités manquantes, sur le transfert."}
        </div>
      )}

      {!onlyLater && lines.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 600 }}>
            {en ? "Same answer for every line (optional)" : "Même réponse pour toutes les lignes (facultatif)"}
          </label>
          <select className="input" value="" disabled={disabled} style={selectStyle} data-testid="shortfall-apply-all"
            onChange={(e) => applyAll(e.target.value)}>
            <option value="">{en ? "— apply to all lines —" : "— appliquer à toutes les lignes —"}</option>
            {keys.map((k) => <option key={k} value={k}>{labelOf(k, en)}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l) => {
          const a = answers[l.product_id] || {};
          const unanswered = missing.some((m) => m.product_id === l.product_id);
          return (
            <div key={l.product_id} data-testid={`shortfall-line-${l.product_id}`}
              style={{ border: `1px solid ${unanswered ? "rgba(251,191,36,0.45)" : "var(--border-hover, rgba(255,255,255,0.16))"}`,
                       borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{l.name}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#fbbf24", whiteSpace: "nowrap" }}>
                  −{l.missing}{l.detail ? <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}> · {l.detail}</span> : null}
                </span>
              </div>
              {onlyLater ? (
                <div style={{ fontSize: 12, color: "var(--brand)", marginTop: 6, fontWeight: 700 }}>● {labelOf(LATER, en)}</div>
              ) : (
                <>
                  <select className="input" value={a.reason || ""} disabled={disabled} style={selectStyle}
                    data-testid={`shortfall-select-${l.product_id}`}
                    onChange={(e) => setOne(l.product_id, { reason: e.target.value || null })}>
                    <option value="">{en ? "Choose what happened…" : "Choisissez ce qui s'est passé…"}</option>
                    {keys.map((k) => <option key={k} value={k}>{labelOf(k, en)}</option>)}
                  </select>
                  {a.reason && (
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                      {hintOf(a.reason, en, sourceName)}
                    </div>
                  )}
                  {a.reason && a.reason !== LATER && (
                    <input className="input" value={a.note || ""} disabled={disabled} style={{ marginTop: 6 }}
                      onChange={(e) => setOne(l.product_id, { note: e.target.value })}
                      placeholder={outcomeNoteRequired(a.reason) ? (en ? "Note (required)" : "Note (obligatoire)") : (en ? "Note (optional)" : "Note (facultative)")} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <div data-testid="shortfall-missing" style={{ fontSize: 12, color: "#fbbf24", marginTop: 8, lineHeight: 1.45 }}>
          {en ? `Choose an option above for: ${missing.map((m) => m.name).join(", ")}`
              : `Choisissez une option ci-dessus pour : ${missing.map((m) => m.name).join(", ")}`}
        </div>
      )}
    </div>
  );
}
