// Pro Plus Feature 1 — AI Assistant chat UI (frontend).
//
// Consumes the already-built backend:
//   GET  /api/ai/assistant/menu  → the fixed 22-question menu (some take a period)
//   POST /api/ai/assistant       → { message, intent?, period?, lang } → phrased reply
// Owner + Pro Plus gated server-side; 2 messages/day/org (3rd → 429). History is
// EPHEMERAL — kept only in component state, never localStorage/server, so it
// clears on reload/close.
//
// The 22 questions are the PRIMARY path (tappable). Off-menu free text only gets
// "can't answer yet", so the menu is front-and-center. For period-bearing
// questions a small period picker appears as a second tap.

import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLangStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";

const PERIODS = [
  { id: "today",      en: "Today",      fr: "Aujourd'hui" },
  { id: "this_week",  en: "This week",  fr: "Cette semaine" },
  { id: "this_month", en: "This month", fr: "Ce mois" },
  { id: "all",        en: "All time",   fr: "Depuis le début" },
];

export default function AssistantPage() {
  const { lang } = useLangStore();
  const en = lang === "en";

  // Entitlement is read from the app-wide my-plan cache (dedup). We gate the
  // /menu call on it so a non-entitled owner never fires a 403 (which would pop
  // the global paywall) — we render an in-page upsell instead.
  const { data: planResp } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    staleTime: 60000,
  });
  const effectivePlan = planResp?.data?.effective_plan || "trial";
  const entitled = hasFeature(effectivePlan, "ai_assistant");

  // ── Ephemeral conversation (state only — no persistence) ──────────────────
  const [messages, setMessages] = useState([]); // { role:'user'|'assistant', text, period? }
  const [pendingItem, setPendingItem] = useState(null); // period item awaiting a period pick
  const [freeText, setFreeText] = useState("");
  const [remaining, setRemaining] = useState(null); // known after first reply / 429
  const [quotaReached, setQuotaReached] = useState(false);
  const scrollRef = useRef(null);

  const { data: menuResp, isLoading: menuLoading, error: menuError } = useQuery({
    queryKey: ["ai-assistant-menu"],
    queryFn: () => api.get("/ai/assistant/menu").then(r => r.data),
    enabled: entitled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const menu = menuResp?.data?.menu || [];
  const dailyLimit = menuResp?.data?.daily_limit ?? 2;
  const llmEnabled = menuResp?.data?.llm_enabled;

  const labelOf = (item) => (en ? item.label_en : item.label_fr);
  const periodLabel = (pid) => { const p = PERIODS.find(x => x.id === pid); return p ? (en ? p.en : p.fr) : pid; };

  const ask = useMutation({
    mutationFn: ({ item, period, text }) =>
      api.post("/ai/assistant", item
        ? { message: labelOf(item), intent: item.id, period: item.period ? period : undefined, lang }
        : { message: text, lang }
      ).then(r => r.data),
    onSuccess: (res) => {
      const d = res?.data || {};
      setMessages(m => [...m, { role: "assistant", text: d.answer || (en ? "(no reply)" : "(pas de réponse)") }]);
      if (d.usage && typeof d.usage.remaining === "number") setRemaining(d.usage.remaining);
    },
    onError: (err) => {
      const status = err?.response?.status;
      if (status === 429) {
        const msg = err.response?.data?.message
          || (en ? "You've used today's questions. Come back tomorrow." : "Vous avez utilisé vos questions du jour. Revenez demain.");
        setMessages(m => [...m, { role: "assistant", text: msg, limit: true }]);
        setRemaining(0);
        setQuotaReached(true);
        return;
      }
      const msg = err?.response?.data?.message
        || (en ? "Something went wrong. Please try again." : "Une erreur est survenue. Réessayez.");
      setMessages(m => [...m, { role: "assistant", text: msg }]);
    },
  });

  // Auto-scroll to the latest message / thinking indicator.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, ask.isPending, pendingItem]);

  const send = ({ item, period, text }) => {
    if (quotaReached || ask.isPending) return;
    const userText = item
      ? `${labelOf(item)}${item.period && period ? ` · ${periodLabel(period)}` : ""}`
      : text;
    setMessages(m => [...m, { role: "user", text: userText }]);
    setPendingItem(null);
    ask.mutate({ item, period, text });
  };

  const onPickQuestion = (item) => {
    if (quotaReached || ask.isPending) return;
    if (item.period) setPendingItem(item);        // reveal period picker
    else send({ item });                          // ask immediately
  };

  const submitFreeText = (e) => {
    e?.preventDefault();
    const t = freeText.trim();
    if (!t) return;
    setFreeText("");
    send({ text: t });
  };

  // ── Upsell (non-entitled owner reaching this screen directly) ─────────────
  if (!entitled) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>✨</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>
            {en ? "AI Assistant — Pro Plus" : "Assistant IA — Pro Plus"}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, marginBottom: 22 }}>
            {en
              ? "Ask about your shop's numbers in plain language — sales, expenses, best sellers, who owes you, low stock and more. Available on the Pro Plus plan."
              : "Posez des questions sur les chiffres de votre boutique en langage simple — ventes, dépenses, meilleurs produits, qui vous doit, stock faible et plus. Disponible avec le forfait Pro Plus."}
          </div>
          <Link to="/request-activation?plan=pro_plus" className="btn btn-primary" style={{ textDecoration: "none", display: "inline-block", height: 46, lineHeight: "46px", padding: "0 22px" }}>
            🔒 {en ? "Upgrade to Pro Plus" : "Passer à Pro Plus"}
          </Link>
        </div>
      </div>
    );
  }

  const quotaPill = remaining != null
    ? (en ? `${remaining} left today` : `${remaining} restante(s) aujourd'hui`)
    : (en ? `Up to ${dailyLimit} questions/day` : `Jusqu'à ${dailyLimit} questions/jour`);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720, margin: "0 auto", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 22 }}>✨</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{en ? "AI Assistant" : "Assistant IA"}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {en ? "Ask about your shop — pick a question below" : "Posez une question sur votre boutique — choisissez ci-dessous"}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: quotaReached ? "rgba(239,68,68,0.12)" : "rgba(251,197,3,0.12)", color: quotaReached ? "#f87171" : "var(--brand-light)", whiteSpace: "nowrap" }}>
          {quotaPill}
        </span>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, marginTop: 20, lineHeight: 1.6 }}>
            👋 {en
              ? "Tap one of the questions below to get started. Your conversation isn't saved — it clears when you leave."
              : "Touchez une des questions ci-dessous pour commencer. Votre conversation n'est pas enregistrée — elle disparaît quand vous quittez."}
            {llmEnabled === false && (
              <div style={{ marginTop: 10, fontSize: 11, opacity: 0.8 }}>
                {en ? "(Preview mode — full AI replies coming soon)" : "(Mode aperçu — réponses IA complètes bientôt)"}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "82%", padding: "10px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
              background: m.role === "user" ? "var(--brand)" : (m.limit ? "rgba(239,68,68,0.10)" : "var(--bg-card)"),
              color: m.role === "user" ? "#152B52" : (m.limit ? "#f87171" : "var(--text-primary)"),
              border: m.role === "user" ? "none" : `1px solid ${m.limit ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
              fontWeight: m.role === "user" ? 600 : 400,
              borderBottomRightRadius: m.role === "user" ? 4 : 14,
              borderBottomLeftRadius: m.role === "user" ? 14 : 4,
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "10px 14px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
              <span className="ai-thinking">{en ? "Thinking" : "Réflexion"}…</span>
            </div>
          </div>
        )}
      </div>

      {/* Composer: period picker (when a period question is pending) OR the menu */}
      <div style={{ borderTop: "1px solid var(--border)", padding: 12, background: "var(--bg-elevated)" }}>
        {quotaReached ? (
          <div style={{ textAlign: "center", color: "#f87171", fontSize: 13, padding: "10px 4px", fontWeight: 600 }}>
            ⏳ {en
              ? `You've used today's ${dailyLimit} questions. Come back tomorrow.`
              : `Vous avez utilisé vos ${dailyLimit} questions du jour. Revenez demain.`}
          </div>
        ) : pendingItem ? (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              <strong style={{ color: "var(--text-primary)" }}>{labelOf(pendingItem)}</strong> — {en ? "choose a period:" : "choisissez une période :"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PERIODS.map(p => (
                <button key={p.id} onClick={() => send({ item: pendingItem, period: p.id })}
                  className="btn btn-primary btn-sm" style={{ borderRadius: 20 }}>
                  {en ? p.en : p.fr}
                </button>
              ))}
              <button onClick={() => setPendingItem(null)} className="btn btn-secondary btn-sm" style={{ borderRadius: 20 }}>
                {en ? "Cancel" : "Annuler"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              {en ? "Questions" : "Questions"}
            </div>
            {menuLoading && <div style={{ color: "var(--text-muted)", fontSize: 13, padding: 8 }}>{en ? "Loading…" : "Chargement…"}</div>}
            {menuError && <div style={{ color: "#f87171", fontSize: 13, padding: 8 }}>{en ? "Could not load questions." : "Impossible de charger les questions."}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 168, overflowY: "auto" }}>
              {menu.map(item => (
                <button key={item.id} onClick={() => onPickQuestion(item)} disabled={ask.isPending}
                  style={{
                    border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)",
                    borderRadius: 18, padding: "7px 12px", fontSize: 12.5, cursor: ask.isPending ? "not-allowed" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                  {labelOf(item)}{item.period ? <span style={{ opacity: 0.5, fontSize: 11 }}>⏱</span> : null}
                </button>
              ))}
            </div>
            {/* Optional free text — menu is the primary path. */}
            <form onSubmit={submitFreeText} style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input className="input" value={freeText} onChange={e => setFreeText(e.target.value)}
                placeholder={en ? "Or type a question…" : "Ou tapez une question…"}
                style={{ flex: 1 }} disabled={ask.isPending} />
              <button type="submit" className="btn btn-secondary" disabled={!freeText.trim() || ask.isPending}>
                {en ? "Send" : "Envoyer"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
