// TRANSFER VARIANCE — PER-LINE OUTCOMES (Peter, 2026-10-11) + SPLIT (2026-10-12).
// One answer per short line, because one transfer can carry three stories
// (TRF-20261010-0001: head lamp GN damaged, Tube 275/18 stolen, Tube 300/17 left in
// the warehouse) — and one LINE can carry two (6 missing = 4 damaged + 2 stolen).
// Shared by the held-receipt approval (HoldShortfallFields) and the transfer screen
// (TransferDetailModal), so both ask the same question in the same words.
//
// An answer is { entries: [{ reason, qty, note }] }. ONE entry with no qty covers the
// whole line. "+ split" adds parts; a split line needs a qty on every part and the
// parts must add up to exactly the line's missing units ("x of 6 assigned") — the
// server refuses anything else, naming the line.
//
// NOTHING is preselected — with one exception: when "Decide later" is the ONLY
// answer this person may give (an ungranted manager), it is chosen for them, since
// there is nothing to choose between. Lines still waiting are NAMED.
import { useEffect } from "react";
import { outcomeByKey, outcomeNoteRequired } from "../../utils/transferVarianceOutcomes";

export const LATER = "later";
const LATER_LABEL = { en: "Decide later", fr: "Décider plus tard",
  hintEn: "This stays open on the transfer.", hintFr: "Ceci reste ouvert sur le transfert." };

const labelOf = (key, en) => key === LATER ? (en ? LATER_LABEL.en : LATER_LABEL.fr) : (en ? outcomeByKey(key).en : outcomeByKey(key).fr);
const hintOf = (key, en, sourceName) => {
  if (key === LATER) return en ? LATER_LABEL.hintEn : LATER_LABEL.hintFr;
  if (key === "return_to_source" && sourceName)
    return en ? `Put back into ${sourceName}'s stock now.` : `Remises maintenant dans le stock de ${sourceName}.`;
  const o = outcomeByKey(key); return en ? o.hintEn : o.hintFr;
};

/** The parts of one line's answer ([] when unanswered). */
export const entriesOf = (answer) => (answer && Array.isArray(answer.entries) ? answer.entries : []);
const isSplit = (entries) => entries.length > 1;
const qtyNum = (q) => (q === "" || q == null ? null : Number(q));
/** Units assigned on a split line (sum of the parts' quantities). */
export const assignedOf = (entries) => entries.reduce((s, e) => s + (Number(qtyNum(e.qty)) || 0), 0);

/** Is this line fully answered? */
function lineReady(line, answer) {
  const entries = entriesOf(answer);
  if (!entries.length) return false;
  for (const e of entries) {
    if (!e.reason) return false;
    if (outcomeNoteRequired(e.reason) && !String(e.note || "").trim()) return false;
    if (isSplit(entries) && !(qtyNum(e.qty) > 0)) return false;
  }
  return !isSplit(entries) || Math.abs(assignedOf(entries) - Number(line.missing)) < 1e-9;
}

/** Lines still waiting for a full answer. */
export function shortfallMissing(lines, answers) {
  return lines.filter((l) => !lineReady(l, answers[l.product_id]));
}

/** Every part of every line is "Decide later". */
export function shortfallAllLater(lines, answers) {
  return lines.length > 0 && lines.every((l) => entriesOf(answers[l.product_id]).every((e) => e.reason === LATER));
}

/** The `lines` body for the API: one element per part; a qty only on a split line. */
export function shortfallLinesBody(lines, answers) {
  return lines.flatMap((l) => {
    const entries = entriesOf(answers[l.product_id]);
    return entries.map((e) => ({ product_id: l.product_id, reason: e.reason,
      note: String(e.note || "").trim() || null,
      ...(isSplit(entries) ? { qty: Number(e.qty) } : {}) }));
  });
}

/** A whole-line answer (one part, no qty). */
export const wholeLine = (reason) => ({ entries: [{ reason, qty: "", note: "" }] });

export default function ShortfallLinesPicker({ en, lines, options, answers, setAnswers, allowLater = true, sourceName, disabled }) {
  const keys = [...options.map((o) => o.key), ...(allowLater ? [LATER] : [])];
  const onlyLater = keys.length === 1 && keys[0] === LATER;
  const lineKey = lines.map((l) => l.product_id).join(",");

  // Only answer available → it is the answer (see header). Never otherwise.
  useEffect(() => {
    if (!onlyLater) return;
    if (shortfallAllLater(lines, answers) && !shortfallMissing(lines, answers).length) return;
    setAnswers(Object.fromEntries(lines.map((l) => [l.product_id, wholeLine(LATER)])));
  }, [onlyLater, lineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEntries = (pid, entries) => setAnswers({ ...answers, [pid]: { entries } });
  const setPart = (pid, i, patch) => {
    const entries = entriesOf(answers[pid]).length ? [...entriesOf(answers[pid])] : [{ reason: null, qty: "", note: "" }];
    entries[i] = { ...entries[i], ...patch };
    setEntries(pid, entries);
  };
  const addPart = (line) => {
    const entries = entriesOf(answers[line.product_id]).length ? [...entriesOf(answers[line.product_id])] : [{ reason: null, qty: "", note: "" }];
    // Splitting: the parts now need quantities; nothing is guessed for the new part.
    setEntries(line.product_id, [...entries, { reason: null, qty: "", note: "" }]);
  };
  const removePart = (pid, i) => {
    const entries = entriesOf(answers[pid]).filter((_, j) => j !== i);
    // Back to one part = a whole-line answer again (its qty no longer applies).
    setEntries(pid, entries.length === 1 ? [{ ...entries[0], qty: "" }] : entries);
  };
  const applyAll = (reason) => {
    if (!reason) return;
    setAnswers(Object.fromEntries(lines.map((l) => [l.product_id, wholeLine(reason)])));
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
          const entries = entriesOf(answers[l.product_id]);
          const parts = entries.length ? entries : [{ reason: null, qty: "", note: "" }];
          const split = isSplit(parts);
          const assigned = assignedOf(parts);
          const exact = Math.abs(assigned - Number(l.missing)) < 1e-9;
          const unanswered = missing.some((m) => m.product_id === l.product_id);
          return (
            <div key={l.product_id} data-testid={`shortfall-line-${l.product_id}`}
              style={{ border: `1px solid ${unanswered ? "rgba(251,191,36,0.45)" : "var(--border-hover, rgba(255,255,255,0.16))"}`,
                       borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{l.name}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#fbbf24", whiteSpace: "nowrap" }}>−{l.missing}</span>
              </div>
              {onlyLater ? (
                <div style={{ fontSize: 12, color: "var(--brand)", marginTop: 6, fontWeight: 700 }}>● {labelOf(LATER, en)}</div>
              ) : (
                <>
                  {parts.map((e, i) => (
                    <div key={i} data-testid={`shortfall-part-${l.product_id}-${i}`}
                      style={split ? { borderTop: i ? "1px dashed var(--border-hover, rgba(255,255,255,0.16))" : "none", marginTop: i ? 8 : 0, paddingTop: i ? 6 : 0 } : undefined}>
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                        {split && (
                          <input className="input" type="number" min="1" inputMode="numeric" value={e.qty ?? ""} disabled={disabled}
                            data-testid={`shortfall-qty-${l.product_id}-${i}`} aria-label={en ? "Quantity" : "Quantité"}
                            onChange={(ev) => setPart(l.product_id, i, { qty: ev.target.value })}
                            placeholder={en ? "Qty" : "Qté"} style={{ ...selectStyle, width: 72, flex: "0 0 72px" }} />
                        )}
                        <select className="input" value={e.reason || ""} disabled={disabled} style={{ ...selectStyle, flex: 1 }}
                          data-testid={`shortfall-select-${l.product_id}${split ? `-${i}` : ""}`}
                          onChange={(ev) => setPart(l.product_id, i, { reason: ev.target.value || null })}>
                          <option value="">{en ? "Choose what happened…" : "Choisissez ce qui s'est passé…"}</option>
                          {keys.map((k) => <option key={k} value={k}>{labelOf(k, en)}</option>)}
                        </select>
                        {split && (
                          <button type="button" onClick={() => removePart(l.product_id, i)} disabled={disabled}
                            aria-label={en ? "Remove this part" : "Retirer cette partie"}
                            style={{ background: "none", border: "1px solid var(--border-hover, rgba(255,255,255,0.16))", borderRadius: 8,
                                     color: "var(--text-secondary)", cursor: "pointer", padding: "8px 10px", flex: "0 0 auto" }}>✕</button>
                        )}
                      </div>
                      {e.reason && (
                        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                          {hintOf(e.reason, en, sourceName)}
                        </div>
                      )}
                      {e.reason && e.reason !== LATER && (
                        <input className="input" value={e.note || ""} disabled={disabled} style={{ marginTop: 6 }}
                          onChange={(ev) => setPart(l.product_id, i, { note: ev.target.value })}
                          placeholder={outcomeNoteRequired(e.reason) ? (en ? "Note (required)" : "Note (obligatoire)") : (en ? "Note (optional)" : "Note (facultative)")} />
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
                    <button type="button" onClick={() => addPart(l)} disabled={disabled} data-testid={`shortfall-split-${l.product_id}`}
                      style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontWeight: 700, fontSize: 12, padding: 0 }}>
                      {en ? "+ split" : "+ partager"}
                    </button>
                    {split && (
                      <span data-testid={`shortfall-assigned-${l.product_id}`}
                        style={{ fontSize: 12, fontWeight: 700, color: exact ? "#34d399" : "#fbbf24" }}>
                        {en ? `${assigned} of ${l.missing} assigned` : `${assigned} sur ${l.missing} réparties`}
                      </span>
                    )}
                  </div>
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
