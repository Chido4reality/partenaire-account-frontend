// TRANSFER VARIANCE OUTCOMES (Peter, 2026-10-10) — on a held receipt, the approver
// can say what happened to the units that did not arrive, in the same step as the
// approval. Shared by the owner's Accountant Log and the managers' Team Approvals.
//
// NO default. Approve stays disabled until one answer is picked — and "decide later"
// is an answer, not a fallback: it leaves the shortfall open on the transfer, exactly
// as approving did before this. The server re-checks who may pick what.
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { useAuthStore } from "../../store";
import { useMyPermissions } from "../../utils/useMyPermissions";
import { allowedOutcomes, outcomeNoteRequired } from "../../utils/transferVarianceOutcomes";
import { HOLD_ACTION } from "./HoldRejectFields";
import OptionCard from "./OptionCard";

export const SHORTFALL_LATER = "later";

/** The pending-approvals LIST carries no payload, so the held lines (and how many
 *  units are missing) come from the approval's own detail — the same endpoint
 *  ApprovalDetailView reads. Returns { missing, payload, loading, failed }. */
export function useHoldShortfall(approval) {
  const isHold = !!approval && approval.action_type === HOLD_ACTION;
  const q = useQuery({
    queryKey: ["approval-detail", approval && approval.id],
    queryFn: () => api.get(`/staff/approvals/${approval.id}`).then((r) => r.data?.data || null),
    enabled: isHold, staleTime: 30000,
  });
  const payload = q.data?.payload || null;
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const missing = items.reduce((s, it) => s + Math.max(0, Number(it && it.missing) || 0), 0);
  return { isHold, missing, payload, loading: isHold && q.isLoading, failed: isHold && q.isError };
}

/** Is the approve button allowed? A held receipt with a shortfall needs an answer.
 *  While the detail is loading, wait; if it cannot load, approving works as before
 *  (the shortfall stays open on the transfer). */
export function holdShortfallReady(hold, choice, note) {
  if (!hold || !hold.isHold || hold.failed) return true;
  if (hold.loading) return false;
  if (hold.missing <= 0) return true;
  if (!choice) return false;
  if (outcomeNoteRequired(choice) && !String(note || "").trim()) return false;
  return true;
}

/** The body fragment to send with POST /staff/approvals/:id/approve. */
export function holdShortfallBody(hold, choice, note) {
  if (!hold || !hold.isHold || hold.missing <= 0 || !choice || choice === SHORTFALL_LATER) return {};
  return { shortfall: { reason: choice, note: String(note || "").trim() || null } };
}

export default function HoldShortfallFields({ en, hold, choice, setChoice, note, setNote }) {
  const role = useAuthStore((s) => s.user?.role);
  const { perms } = useMyPermissions({ enabled: role === "manager" });
  if (!hold || !hold.isHold || hold.missing <= 0) return null;
  const missing = hold.missing;
  const p = hold.payload || {};
  const options = allowedOutcomes({ isOwner: role === "owner",
    canCancelTransfers: role === "manager" && !!perms?.can_cancel_transfers });
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
        {en ? `${missing} unit(s) did not arrive. What happened to them?` : `${missing} unité(s) ne sont pas arrivées. Que leur est-il arrivé ?`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((o) => (
          <OptionCard key={o.key} testId={`hold-shortfall-${o.key}`} selected={choice === o.key} onClick={() => setChoice(o.key)}
            title={en ? o.en : o.fr}
            hint={o.key === "return_to_source" && p.from_name
              ? (en ? `The source packed short. Put back into ${p.from_name}'s stock now.` : `La source a envoyé moins. Remises maintenant dans le stock de ${p.from_name}.`)
              : (en ? o.hintEn : o.hintFr)} />
        ))}
        <OptionCard testId="hold-shortfall-later" selected={choice === SHORTFALL_LATER} onClick={() => setChoice(SHORTFALL_LATER)}
          title={en ? "Decide later" : "Décider plus tard"}
          hint={options.length
            ? (en ? "Approve the receipt only. The shortfall stays open on the transfer." : "Approuver la réception seulement. Le manque reste ouvert sur le transfert.")
            : (en ? "Approve the receipt only. The owner decides what happened to the shortfall, on the transfer." : "Approuver la réception seulement. Le patron décide du manque, sur le transfert.")} />
      </div>
      {choice && choice !== SHORTFALL_LATER && (
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }}
          placeholder={outcomeNoteRequired(choice) ? (en ? "Note (required)" : "Note (obligatoire)") : (en ? "Note (optional)" : "Note (facultative)")} />
      )}
    </div>
  );
}
