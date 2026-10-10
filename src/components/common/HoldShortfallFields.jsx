// TRANSFER VARIANCE OUTCOMES — on a held receipt, the approver says what happened
// to the units that did not arrive, ONE ANSWER PER SHORT LINE (Peter, 2026-10-11),
// in the same step as the approval. Shared by the owner's Accountant Log and the
// managers' Team Approvals. The picker itself is ShortfallLinesPicker.
//
// NO default. Approve stays disabled until every short line has an answer, and the
// lines still waiting are named. "Decide later" is an answer, not a fallback: it
// leaves that line open on the transfer, exactly as approving did before. A manager
// without can_cancel_transfers may only answer "Decide later" — it is then chosen
// for him (nothing to choose between). The server re-checks who may pick what.
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { useAuthStore } from "../../store";
import { useMyPermissions } from "../../utils/useMyPermissions";
import { allowedOutcomes } from "../../utils/transferVarianceOutcomes";
import { HOLD_ACTION } from "./HoldRejectFields";
import ShortfallLinesPicker, { shortfallMissing, shortfallLinesBody, shortfallAllLater } from "./ShortfallLinesPicker";

/** The pending-approvals LIST carries no payload, so the held lines come from the
 *  approval's own detail — the same endpoint ApprovalDetailView reads.
 *  Returns { isHold, lines, payload, loading, failed }. */
export function useHoldShortfall(approval) {
  const isHold = !!approval && approval.action_type === HOLD_ACTION;
  const q = useQuery({
    queryKey: ["approval-detail", approval && approval.id],
    queryFn: () => api.get(`/staff/approvals/${approval.id}`).then((r) => r.data?.data || null),
    enabled: isHold, staleTime: 30000,
  });
  const payload = q.data?.payload || null;
  const byPid = new Map();
  for (const it of (payload && Array.isArray(payload.items) ? payload.items : [])) {
    const miss = Math.max(0, Number(it && it.missing) || 0);
    if (miss <= 0) continue;
    const prev = byPid.get(String(it.product_id));
    byPid.set(String(it.product_id), {
      product_id: String(it.product_id), name: it.name || "—",
      missing: (prev ? prev.missing : 0) + miss,
      detail: null,
    });
  }
  const lines = [...byPid.values()];
  return { isHold, lines, payload, loading: isHold && q.isLoading, failed: isHold && q.isError };
}

/** Is the approve button allowed? A held receipt with short lines needs an answer
 *  on each. While the detail is loading, wait; if it cannot load, approving works as
 *  before (every short line stays open on the transfer). */
export function holdShortfallReady(hold, answers) {
  if (!hold || !hold.isHold || hold.failed) return true;
  if (hold.loading) return false;
  if (!hold.lines.length) return true;
  return shortfallMissing(hold.lines, answers || {}).length === 0;
}

/** The body fragment for POST /staff/approvals/:id/approve. All "later" = a plain
 *  approval (nothing to send). */
export function holdShortfallBody(hold, answers) {
  if (!hold || !hold.isHold || !hold.lines.length) return {};
  if (shortfallMissing(hold.lines, answers || {}).length) return {};
  if (shortfallAllLater(hold.lines, answers)) return {};
  return { shortfall: { lines: shortfallLinesBody(hold.lines, answers) } };
}

/** Why Approve is disabled, in words — so a dim button is never a mystery (Nora,
 *  2026-10-11: Approve stayed dim with nothing to tell her why). A browser's saved-
 *  password PREVIEW shows dots in the PIN box while its value is still empty, so the
 *  PIN case is named too. null when Approve is live. */
export function approveBlockedReason({ en, pin, hold, answers }) {
  if (hold && hold.isHold && hold.loading) return en ? "Loading the held lines…" : "Chargement des lignes en attente…";
  if (hold && hold.isHold && !holdShortfallReady(hold, answers))
    return en ? "Choose an option for every line above." : "Choisissez une option pour chaque ligne ci-dessus.";
  if (!/^\d{4,6}$/.test(String(pin || ""))) return en ? "Enter your PIN (4–6 digits)." : "Saisissez votre PIN (4 à 6 chiffres).";
  return null;
}

export default function HoldShortfallFields({ en, hold, answers, setAnswers }) {
  const role = useAuthStore((s) => s.user?.role);
  const { perms } = useMyPermissions({ enabled: role === "manager" });
  if (!hold || !hold.isHold || !hold.lines.length) return null;
  const options = allowedOutcomes({ isOwner: role === "owner",
    canCancelTransfers: role === "manager" && !!perms?.can_cancel_transfers });
  return (
    <div style={{ marginTop: 12 }}>
      <ShortfallLinesPicker en={en} lines={hold.lines} options={options} answers={answers || {}}
        setAnswers={setAnswers} allowLater sourceName={(hold.payload || {}).from_name}
        destName={(hold.payload || {}).to_name} context="approval" />
    </div>
  );
}
