// Accountant Log Phase 5b — shared detection of the "held for owner approval"
// response. A gated staffer action returns HTTP 202 with
//   { success:true, pending_approval:true, approval_id, status:'pending',
//     message, message_en, message_fr }
// and DOES NOT execute. Screens must show a held confirmation ("Waiting for
// owner approval") — NOT a success / "recorded" screen with an amount.
//
// Accepts either an axios response (res) or its body (res.data).
export function isPendingApproval(x) {
  if (!x) return false;
  if (x.pending_approval === true) return true;            // body
  if (x.data && x.data.pending_approval === true) return true; // axios response
  return false;
}

export function pendingApprovalMessage(x, en) {
  const d = x && x.pending_approval !== undefined ? x : (x && x.data) || {};
  if (en) return d.message_en || "Sent to the owner for approval.";
  return d.message_fr || d.message || "Envoyé au propriétaire pour approbation.";
}
