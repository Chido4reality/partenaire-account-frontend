// RECEIVE-MISMATCH GATE (Peter, 2026-10-02) — the two ways to reject a held receipt.
// Shared by the owner's Accountant Log and the managers' Team Approvals so both
// screens offer exactly the same choice in the same words.
//   recount           → the lines go back to the destination to be counted again
//                       (blind, like the first count). No stock moves; no PIN.
//   return_to_source  → a return transfer is created, in transit back to the source,
//                       which receives it through the normal flow. Goods move, so the
//                       approver's PIN is required, exactly as for approve.
export const HOLD_ACTION = "transfer_receive_hold";

export function holdRejectReady(mode, pin) {
  if (mode === "recount") return true;
  if (mode === "return_to_source") return String(pin || "").length >= 4;
  return false;
}

export default function HoldRejectFields({ en, mode, setMode, pin, setPin }) {
  const opts = [
    { val: "recount", en: "Send back for a recount", fr: "Faire recompter",
      hintEn: "The lines go back to the shop to be counted again. Nothing moves until then.",
      hintFr: "Les lignes retournent à la boutique pour être recomptées. Rien ne bouge d'ici là." },
    { val: "return_to_source", en: "Return to the source", fr: "Renvoyer à la source",
      hintEn: "A return transfer is created back to the source, which must receive it.",
      hintFr: "Un transfert de retour est créé vers la source, qui doit le réceptionner." },
  ];
  return (
    <div className="form-group">
      <label className="label">{en ? "What should happen to the held goods?" : "Que faire des marchandises en attente ?"}</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {opts.map((o) => (
          <label key={o.val} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8,
            border: `1px solid ${mode === o.val ? "var(--brand)" : "var(--border)"}`, cursor: "pointer" }}>
            <input type="radio" name="hold-reject-mode" checked={mode === o.val} onChange={() => setMode(o.val)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{en ? o.en : o.fr}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>{en ? o.hintEn : o.hintFr}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === "return_to_source" && (
        <div style={{ marginTop: 10 }}>
          <label className="label">{en ? "Your PIN" : "Votre code PIN"}</label>
          <input className="input" type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
        </div>
      )}
    </div>
  );
}
