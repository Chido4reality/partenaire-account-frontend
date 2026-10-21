// SYNC-AFTER-LOGOUT (Peter, 2026-10-21) — what the owner can do with a queued SALE its author cannot send.
// Shown on the Pending sync page and in the sync-queue modal, from row.queue_action (pendingSync.rowAction):
//   waiting_author  — a note: the sale goes out at the author's next sign-in;
//   on_behalf       — the author's account is disabled, or the sale waited > 24 h: the owner / a
//                     staff-managing manager can "Envoyer au nom de <author>" (booked to the author);
//   author_unknown  — queued before the app recorded authors: never sent by itself; the owner / a
//                     staff-managing manager sends it as themself, or discards it (the server is asked
//                     first; a sale it already has is kept).
// The buttons are a convenience — the server refuses (403, audited) anyone else.
import { useState } from "react";
import toast from "react-hot-toast";
import { useAuthStore } from "../../store";
import { useMyPermissions } from "../../utils/useMyPermissions";
import { sendOnBehalf, sendAuthorUnknown, discardAuthorUnknown } from "../../utils/pendingSync";

// Same rule as Settings' canManageStaff and the server's staffMgmtAuthority.
export function useCanActForOthers() {
  const user = useAuthStore((s) => s.user);
  const isManager = user?.role === "manager";
  const { perms } = useMyPermissions({ enabled: isManager });
  return user?.role === "owner" || (isManager && !!perms?.can_manage_staff);
}

const btn = (primary, busy) => ({
  flex: 1, padding: "8px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: busy ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid rgba(248,113,113,0.4)",
  background: primary ? "var(--brand)" : "transparent", color: primary ? "#152B52" : "#f87171",
});

export default function QueueOwnerActions({ row, lang, onDone }) {
  const en = lang === "en";
  const canAct = useCanActForOthers();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const a = row && row.queue_action;
  if (!a) return null;
  const who = a.author_name || (en ? "the author" : "l'auteur");
  const note = (text, color = "#fbbf24") => (
    <div data-queue-note={a.kind} style={{ fontSize: 12, color, marginTop: 6, lineHeight: 1.4 }}>{text}</div>
  );
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); onDone && onDone(); } };

  if (a.kind === "waiting_author") {
    return note(en ? `⏳ Waiting for ${who}: it is sent at their next sign-in.`
                   : `⏳ En attente de ${who} : elle sera envoyée à sa prochaine connexion.`, "var(--text-secondary)");
  }

  if (a.kind === "on_behalf") {
    const why = a.reason === "account_disabled"
      ? (en ? `${who}'s account is disabled.` : `Le compte de ${who} est désactivé.`)
      : (en ? `Waiting for ${who} for more than 24 h.` : `En attente de ${who} depuis plus de 24 h.`);
    if (!canAct) return note(`⏳ ${why} ${en ? "The owner can send it on their behalf." : "Le propriétaire peut l'envoyer en son nom."}`);
    return (
      <div style={{ marginTop: 6 }}>
        {note(`⏳ ${why} ${en ? "It will be recorded as their sale." : "Elle sera enregistrée comme sa vente."}`)}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button data-queue-btn="on_behalf" style={btn(true, busy)} disabled={busy}
            onClick={(e) => { e.stopPropagation(); run(async () => {
              const ok = await sendOnBehalf(row.id);
              toast[ok ? "success" : "error"](ok ? (en ? `Sending on behalf of ${who}…` : `Envoi au nom de ${who}…`)
                                                 : (en ? "Not possible for this sale" : "Impossible pour cette vente"));
            }); }}>
            ➜ {en ? `Send on behalf of ${who}` : `Envoyer au nom de ${who}`}
          </button>
        </div>
      </div>
    );
  }

  // author_unknown
  const label = (
    <span data-queue-note="author_unknown" style={{ display: "inline-block", fontSize: 10, fontWeight: 800, color: "#fbbf24", border: "1px solid #fbbf24", borderRadius: 8, padding: "1px 7px", marginTop: 6 }}>
      {en ? "AUTHOR UNKNOWN" : "AUTEUR INCONNU"}
    </span>
  );
  const why = en ? "Queued before the app recorded who rang each sale — it is never sent by itself."
                 : "Mise en file avant que l'app n'enregistre l'auteur de chaque vente — elle ne part jamais seule.";
  if (!canAct) return (<div>{label}{note(`${why} ${en ? "The owner decides." : "Le propriétaire décide."}`, "var(--text-secondary)")}</div>);
  return (
    <div style={{ marginTop: 2 }}>
      {label}
      {note(`${why} ${en ? "Send it (recorded as yours) or discard it." : "Envoyez-la (enregistrée à votre nom) ou supprimez-la."}`, "var(--text-secondary)")}
      {!confirming ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button data-queue-btn="author_unknown_send" style={btn(true, busy)} disabled={busy}
            onClick={(e) => { e.stopPropagation(); run(async () => {
              const ok = await sendAuthorUnknown(row.id);
              toast[ok ? "success" : "error"](ok ? (en ? "Sending (recorded as yours)…" : "Envoi (à votre nom)…") : (en ? "Not possible for this sale" : "Impossible pour cette vente"));
            }); }}>
            ➜ {en ? "Send (as me)" : "Envoyer (à mon nom)"}
          </button>
          <button data-queue-btn="author_unknown_discard" style={btn(false, busy)} disabled={busy}
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}>
            🗑 {en ? "Discard" : "Supprimer"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            {en ? "Discard this sale for good? The server is checked first: if it already has it, it is kept."
                : "Supprimer définitivement cette vente ? Le serveur est vérifié d'abord : s'il l'a déjà, elle est conservée."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button data-queue-btn="author_unknown_discard_confirm" style={btn(false, busy)} disabled={busy}
              onClick={(e) => { e.stopPropagation(); run(async () => {
                const r = await discardAuthorUnknown(row.id);
                setConfirming(false);
                if (r.discarded) toast.success(en ? "Discarded (recorded in the log)" : "Supprimée (inscrite au journal)");
                else if (r.kept) toast.success(en ? `Already on the server${r.sale_number ? ` (${r.sale_number})` : ""} — kept` : `Déjà enregistrée sur le serveur${r.sale_number ? ` (${r.sale_number})` : ""} — conservée`);
                else toast.error(en ? "Could not check with the server — nothing was deleted" : "Vérification impossible — rien n'a été supprimé");
              }); }}>
              {en ? "Yes, discard" : "Oui, supprimer"}
            </button>
            <button style={btn(true, busy)} disabled={busy} onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>
              {en ? "Cancel" : "Annuler"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
