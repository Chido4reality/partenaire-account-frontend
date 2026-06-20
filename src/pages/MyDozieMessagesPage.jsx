// MP-DOZIE-SELLER-MIGRATION Phase 3 — "Dozie Messages".
//
// An MP-linked seller chats with Dozie buyers from inside MP. Buyers keep using
// the Dozie app — the SAME ptn_messages rows. Conversations + open thread poll on
// a 12s interval (the established fallback) so new buyer messages arrive without a
// manual refresh; opening a thread clears its unread (and the nav badge). Block/
// unblock a buyer (bidirectional). Standalone sellers never reach this page.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api from "../utils/api";

export default function MyDozieMessagesPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();
  const [openBuyer, setOpenBuyer] = useState(null); // { buyer_id, buyer_name, blocked }
  const [draft, setDraft] = useState("");

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["dozie-seller-me"],
    queryFn: () => api.get("/dozie/seller/me").then(r => r.data),
  });
  const linked = !!meData?.data?.linked;

  const { data: convData, isLoading: convLoading } = useQuery({
    queryKey: ["dozie-seller-conversations"],
    queryFn: () => api.get("/dozie/seller/conversations").then(r => r.data),
    enabled: linked,
    refetchInterval: 12000,
  });
  const conversations = convData?.data || [];

  const { data: msgData } = useQuery({
    queryKey: ["dozie-seller-thread", openBuyer?.buyer_id],
    queryFn: () => api.get(`/dozie/seller/conversations/${openBuyer.buyer_id}/messages`).then(r => r.data),
    enabled: !!openBuyer?.buyer_id,
    refetchInterval: 12000,
    onSuccess: () => { qc.invalidateQueries(["dozie-seller-conversations"]); qc.invalidateQueries(["dozie-seller-attention"]); },
  });
  const messages = msgData?.data || [];

  const sendMut = useMutation({
    mutationFn: (content) => api.post(`/dozie/seller/conversations/${openBuyer.buyer_id}/messages`, { content }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries(["dozie-seller-thread", openBuyer?.buyer_id]); qc.invalidateQueries(["dozie-seller-conversations"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  const blockMut = useMutation({
    mutationFn: ({ buyer_id, block }) => block ? api.post("/dozie/seller/blocks", { buyer_id }) : api.delete(`/dozie/seller/blocks/${buyer_id}`),
    onSuccess: (_d, v) => { toast.success(v.block ? (en ? "Buyer blocked" : "Acheteur bloqué") : (en ? "Buyer unblocked" : "Débloqué")); qc.invalidateQueries(["dozie-seller-conversations"]); if (v.block) setOpenBuyer(null); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  const wrap = (children) => <div style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>{children}</div>;
  if (meLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);
  if (!linked) {
    return wrap(
      <div className="card" style={{ textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{en ? "Partenaire Dozie not activated" : "Partenaire Dozie non activé"}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
          {en ? "Activate your Dozie seller profile in Settings to chat with buyers here." : "Activez votre profil vendeur Dozie dans Paramètres pour discuter avec les acheteurs ici."}
        </div>
        <Link to="/settings" className="btn btn-primary">{en ? "Go to Settings" : "Aller aux Paramètres"}</Link>
      </div>
    );
  }

  // ── Thread view ──
  if (openBuyer) {
    return wrap(
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => setOpenBuyer(null)}>← {en ? "Back" : "Retour"}</button>
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{openBuyer.buyer_name || (en ? "Buyer" : "Acheteur")}</div>
          {openBuyer.blocked
            ? <button className="btn btn-sm" onClick={() => blockMut.mutate({ buyer_id: openBuyer.buyer_id, block: false })}>{en ? "Unblock" : "Débloquer"}</button>
            : <button className="btn btn-sm" style={{ color: "#f87171" }} onClick={() => { if (confirm(en ? "Block this buyer?" : "Bloquer cet acheteur ?")) blockMut.mutate({ buyer_id: openBuyer.buyer_id, block: true }); }}>{en ? "Block" : "Bloquer"}</button>}
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, minHeight: 260, maxHeight: "55vh", overflowY: "auto", background: "var(--bg-card)", display: "flex", flexDirection: "column", gap: 8 }}>
          {!messages.length && <div style={{ color: "var(--text-muted)", textAlign: "center", margin: "auto" }}>{en ? "No messages yet" : "Aucun message"}</div>}
          {messages.map(m => {
            const mine = m.sender_role === "seller";
            return (
              <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                <div style={{ background: mine ? "var(--brand)" : "var(--bg-elevated)", color: mine ? "#0f172a" : "var(--text-primary)", padding: "8px 12px", borderRadius: 12, fontSize: 13, wordBreak: "break-word" }}>
                  {m.type === "image" ? <img src={m.content} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} /> : m.content}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, textAlign: mine ? "right" : "left" }}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            );
          })}
        </div>
        {!openBuyer.blocked && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input className="input" style={{ flex: 1 }} placeholder={en ? "Type a message…" : "Écrire un message…"}
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && draft.trim()) sendMut.mutate(draft.trim()); }} />
            <button className="btn btn-primary" disabled={!draft.trim() || sendMut.isPending} onClick={() => sendMut.mutate(draft.trim())}>
              {sendMut.isPending ? "…" : (en ? "Send" : "Envoyer")}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Conversation list ──
  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "Dozie Messages" : "Messages Dozie"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        {en ? "Chat with your Partenaire Dozie buyers. They see your replies in the Dozie app." : "Discutez avec vos acheteurs Partenaire Dozie. Ils voient vos réponses dans l’app Dozie."}
      </div>
      {convLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
      {!convLoading && !conversations.length && <div style={{ color: "var(--text-muted)" }}>{en ? "No conversations yet." : "Aucune conversation."}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {conversations.map(c => (
          <div key={c.buyer_id} onClick={() => setOpenBuyer({ buyer_id: c.buyer_id, buyer_name: c.buyer_name, blocked: c.blocked })}
            style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--bg-card)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, opacity: c.blocked ? 0.55 : 1 }}>
            <div style={{ width: 38, height: 38, borderRadius: 19, background: "rgba(251,197,3,0.2)", color: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>
              {(c.buyer_name || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.buyer_name || (en ? "Buyer" : "Acheteur")}</span>
                {c.blocked && <span style={{ fontSize: 10, color: "#f87171" }}>{en ? "blocked" : "bloqué"}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.last_type === "image" ? (en ? "📷 Photo" : "📷 Photo") : (c.last_content || "")}
              </div>
            </div>
            {c.unread_for_seller > 0 && !c.blocked && (
              <span style={{ background: "#ef4444", color: "#fff", borderRadius: 10, padding: "0 7px", fontSize: 11, fontWeight: 700 }}>{c.unread_for_seller}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
