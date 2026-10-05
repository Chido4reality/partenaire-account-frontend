// SUPPORT MESSAGING (Phase A, 2026-10-05) — the owner's conversation with Équipe Stenamo.
//
// Owner-only (App.jsx ROUTE_ACCESS + the server's 403). The server derives the org from the
// session; this page sends NO ids — only { body, local_id }. Visible in Lite mode too: Lite
// hides the bell, so this screen (nav item + badge + dashboard strip) is how a Lite owner
// sees a message at all.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";

const T = {
  title:   { fr: "Messages — Équipe Stenamo", en: "Messages — Stenamo team" },
  intro:   { fr: "Une question, un problème, une idée ? Écrivez-nous ici : l'équipe Stenamo vous répond dans cette conversation.",
             en: "A question, a problem, an idea? Write to us here — the Stenamo team answers in this conversation." },
  empty:   { fr: "Aucun message pour l'instant.", en: "No messages yet." },
  you:     { fr: "Vous", en: "You" },
  ph:      { fr: "Votre message…", en: "Your message…" },
  send:    { fr: "Envoyer", en: "Send" },
  sending: { fr: "Envoi…", en: "Sending…" },
  failed:  { fr: "Le message n'est pas parti — vérifiez la connexion et réessayez. Votre texte est conservé.",
             en: "The message wasn't sent — check the connection and try again. Your text is kept." },
  loadErr: { fr: "Impossible de charger les messages — vérifiez la connexion.", en: "Couldn't load the messages — check the connection." },
};
const tr = (k, lang) => T[k][lang === "en" ? "en" : "fr"];
const newLocalId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Props-only bubble list at module scope — the render check mounts it under renderToString.
export function MessageThread({ messages, lang }) {
  if (!messages || !messages.length) return <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 4px" }}>{tr("empty", lang)}</div>;
  return (
    <div data-message-thread style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {messages.map((m) => {
        const mine = m.from === "owner";
        return (
          <div key={m.id} data-from={m.from} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", margin: mine ? "0 6px 3px 0" : "0 0 3px 6px", textAlign: mine ? "right" : "left" }}>
              {mine ? tr("you", lang) : (m.sender_name || "Équipe Stenamo")} · {new Date(m.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.5, padding: "10px 12px", borderRadius: 14,
              background: mine ? "rgba(251,197,3,0.16)" : "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              {m.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MessagesPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const localId = useRef(newLocalId());   // one id per message being written → a retry can't double-send
  const bottom = useRef(null);

  const { data, isError } = useQuery({
    queryKey: ["support-messages"],
    queryFn: () => api.get("/messages").then((r) => r.data.data),
    refetchInterval: 30000,
  });
  const messages = data?.messages || [];

  // Opening the screen = reading it: clear the badge once there is something unread.
  useEffect(() => {
    if ((data?.unread || 0) > 0) {
      api.post("/messages/read").then(() => qc.invalidateQueries(["messages-unread"])).catch(() => {});
    }
  }, [data?.unread, qc]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setFailed(false);
    try {
      await api.post("/messages", { body, local_id: localId.current });
      setText("");
      localId.current = newLocalId();
      qc.invalidateQueries(["support-messages"]);
    } catch {
      setFailed(true);   // keep the text and the SAME local_id: resending can't create a duplicate
    } finally { setSending(false); }
  };

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>💬 {tr("title", lang)}</h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.55 }}>{tr("intro", lang)}</p>
      {isError && !data ? (
        <div style={{ color: "#fbbf24", fontSize: 13 }}>{tr("loadErr", lang)}</div>
      ) : (
        <MessageThread messages={messages} lang={lang} />
      )}
      <div ref={bottom} />
      <div style={{ marginTop: 16, position: "sticky", bottom: 0, background: "var(--bg-base)", paddingTop: 8, paddingBottom: "calc(8px + var(--safe-area-bottom, 0px))" }}>
        {failed && <div role="alert" style={{ fontSize: 12.5, color: "#fca5a5", marginBottom: 8 }}>{tr("failed", lang)}</div>}
        <textarea className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={tr("ph", lang)} style={{ width: "100%", resize: "vertical" }} />
        <button className="btn btn-primary" style={{ marginTop: 8, minHeight: 44 }} disabled={sending || !text.trim()} onClick={send}>
          {sending ? tr("sending", lang) : tr("send", lang)}
        </button>
      </div>
    </div>
  );
}
