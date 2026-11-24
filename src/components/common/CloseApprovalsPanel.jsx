// SHIFT CLOSE × OPEN MONEY APPROVALS (Peter 2026-11-24, prod VNT-20261113-0001).
// The server refuses a close (409 approvals_pending) while a money request of this branch is not finished:
// PENDING (waiting for the boss) or APPROVED (waiting for the cashier to complete it). The shift used to close
// silently and the sale completed the next morning lost its shift. Each request is resolved HERE, never skipped:
//   pending  → ✓ Approve (owner / manager, their password) · ✕ Refuse (owner / manager) · ↪ Carry over
//   approved → ✓ Complete now (the person who asked) · ✕ Cancel (them, or owner / manager) · ↪ Carry over
// Carry over = the request stays open and joins the next shift opened at this branch. The close is sent again
// with carry_over_approval_ids naming every carried one (the server checks the list is complete).
// Buttons the user may not use are not shown; a line says who can act instead.
import { useState } from "react";
import api from "../../utils/api";
import ApproverPasswordInput, { approverPasswordReady, approverPasswordLabel } from "./ApproverPasswordInput";

const KIND = {
  bundled_sale: ["Sale needing approval", "Vente à approuver"], credit_sale: ["Credit sale", "Vente à crédit"],
  below_cost_sale: ["Sale below cost", "Vente sous le coût"], discount: ["Discount", "Remise"], oversell: ["Sale beyond stock", "Vente au-delà du stock"],
  refund: ["Refund", "Remboursement"], void: ["Void", "Annulation"], expense: ["Expense", "Dépense"],
};
export const kindLabel = (t, en) => (KIND[t] ? KIND[t][en ? 0 : 1] : t);

// what this user may do with one request (pure — checked by scripts/close-approvals-check.mjs)
export function rowActions(a, user) {
  const boss = !!user && (user.role === "owner" || user.role === "manager");
  const mine = !!user && a.requested_by && a.requested_by === user.id;
  if (a.status === "pending") return { approve: boss, refuse: boss, complete: false, cancel: false, carry: true };
  if (a.status === "approved") return { approve: false, refuse: false, complete: !!mine, cancel: !!mine || boss, carry: true };
  return { approve: false, refuse: false, complete: false, cancel: false, carry: true };
}

// the close button: blocked while any listed request is neither resolved nor carried
export const allCarried = (list, carry) => list.every((a) => carry.includes(a.id));

const btn = { minHeight: 40, padding: "8px 12px", fontSize: 13, flex: "1 1 auto" };

export default function CloseApprovalsPanel({ lang, user, list, carry, setCarry, onResolved, fmtD }) {
  const en = lang !== "fr";
  const [busy, setBusy] = useState(null);       // id being acted on
  const [pwFor, setPwFor] = useState(null);     // id asking for the approval password
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);         // { id, text }

  const act = async (a, kind) => {
    setBusy(a.id); setErr(null);
    try {
      if (kind === "approve") await api.post(`/staff/approvals/${a.id}/approve`, { pin: pw });
      else if (kind === "refuse") await api.post(`/staff/approvals/${a.id}/reject`, { note: en ? "Refused at shift close" : "Refusée à la fermeture du poste" });
      else if (kind === "complete") await api.post(`/staff/approvals/${a.id}/finalize`);
      else if (kind === "cancel") await api.post(`/staff/approvals/${a.id}/cancel`);
      setPwFor(null); setPw("");
      // an APPROVED request stays open (now waiting for completion): keep it listed with its new status
      onResolved(a.id, kind === "approve" ? { ...a, status: "approved" } : null);
    } catch (e) {
      const d = (e && e.response && e.response.data) || {};
      setErr({ id: a.id, text: (en ? (d.message_en || d.message) : (d.message_fr || d.message)) || (en ? "That did not work. Try again." : "Cela n'a pas marché. Réessayez.") });
    } finally { setBusy(null); }
  };
  const toggleCarry = (id) => setCarry(carry.includes(id) ? carry.filter((x) => x !== id) : [...carry, id]);

  return (
    <div role="region" aria-label={en ? "Requests not finished" : "Demandes non terminées"} className="close-approvals"
      style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.55)", borderRadius: 10, padding: "11px 13px", marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#fbbf24", marginBottom: 4 }}>
        ⏳ {en ? `${list.length} request(s) not finished` : `${list.length} demande(s) non terminée(s)`}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>
        {en ? "Approve, refuse or carry each one over to the next shift. A carried request stays open; the money it brings goes to the next shift opened here."
          : "Approuvez, refusez ou reportez chacune au prochain poste. Une demande reportée reste ouverte ; l'argent qu'elle apporte va au prochain poste ouvert ici."}
      </div>
      {list.map((a) => {
        const can = rowActions(a, user);
        const carried = carry.includes(a.id);
        const b = busy === a.id;
        return (
          <div key={a.id} className="close-approval-row" style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {kindLabel(a.action_type, en)}{a.amount != null && fmtD ? ` · ${fmtD(a.amount)}` : ""}
              <span style={{ fontWeight: 500, color: "var(--text-muted)" }}>
                {" · "}{a.status === "pending" ? (en ? "waiting for the boss" : "attend le patron") : (en ? "approved — not completed yet" : "approuvée — pas encore terminée")}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              {a.requested_by_name ? `${en ? "Asked by" : "Demandée par"} ${a.requested_by_name}` : ""}{a.target_ref ? ` · ${a.target_ref}` : ""}
            </div>
            {pwFor === a.id ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <label className="label" style={{ width: "100%", margin: 0 }}>{approverPasswordLabel(en)}</label>
                <ApproverPasswordInput value={pw} onChange={setPw} autoFocus onEnter={() => approverPasswordReady(pw) && act(a, "approve")}
                  style={{ flex: "2 1 140px", minHeight: 40 }} />
                <button type="button" className="btn btn-primary" style={btn} disabled={b || !approverPasswordReady(pw)} onClick={() => act(a, "approve")}>
                  {b ? "..." : (en ? "✓ Approve" : "✓ Approuver")}
                </button>
                <button type="button" className="btn btn-secondary" style={btn} disabled={b} onClick={() => { setPwFor(null); setPw(""); }}>
                  {en ? "Back" : "Retour"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {can.approve && <button type="button" className="btn btn-secondary" style={btn} disabled={b || carried} onClick={() => { setPwFor(a.id); setPw(""); }}>{en ? "✓ Approve" : "✓ Approuver"}</button>}
                {can.complete && <button type="button" className="btn btn-secondary" style={btn} disabled={b || carried} onClick={() => act(a, "complete")}>{b ? "..." : (en ? "✓ Complete now" : "✓ Terminer maintenant")}</button>}
                {can.refuse && <button type="button" className="btn btn-secondary" style={btn} disabled={b || carried} onClick={() => act(a, "refuse")}>{b ? "..." : (en ? "✕ Refuse" : "✕ Refuser")}</button>}
                {can.cancel && <button type="button" className="btn btn-secondary" style={btn} disabled={b || carried} onClick={() => act(a, "cancel")}>{b ? "..." : (en ? "✕ Cancel request" : "✕ Annuler la demande")}</button>}
                <button type="button" aria-pressed={carried} className={carried ? "btn btn-primary" : "btn btn-secondary"} style={btn} disabled={b} onClick={() => toggleCarry(a.id)}>
                  {carried ? (en ? "↪ Carried over ✓" : "↪ Reportée ✓") : (en ? "↪ Carry over" : "↪ Reporter")}
                </button>
              </div>
            )}
            {!can.approve && !can.complete && a.status === "pending" && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                {en ? "Only the owner or a manager can approve or refuse it — or carry it over." : "Seul le patron ou un gérant peut l'approuver ou la refuser — ou reportez-la."}
              </div>
            )}
            {a.status === "approved" && !can.complete && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                {en ? `${a.requested_by_name || "The person who asked"} completes it from My Requests — or carry it over.`
                  : `${a.requested_by_name || "La personne qui l'a demandée"} la termine depuis Mes demandes — ou reportez-la.`}
              </div>
            )}
            {err && err.id === a.id && <div role="alert" style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{err.text}</div>}
          </div>
        );
      })}
    </div>
  );
}
