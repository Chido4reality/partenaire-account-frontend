// MP-HELP v1 — bundled, offline, static help. Flat topic list → detail card, in
// the user's chosen language (useLangStore, no separate toggle). Contact card
// routes WhatsApp by the org's country; email + call always available. No AI, no
// backend for the content (org country rides the cached ["org-settings"] query).
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useLangStore } from "../store";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import { openWhatsApp } from "../utils/whatsapp";
import api from "../utils/api";
import { HELP_TOPICS } from "../data/helpTopics";

// Support routing (Peter-provided). Default to Cameroon when country is unknown.
const SUPPORT = {
  cm: { wa: "237621840952", tel: "+237621840952" },
  ng: { wa: "2348147236608", tel: "+2348147236608" },
  email: "support@partenairedozie.com",
};
function supportForCountry(country) {
  const c = String(country || "").trim().toLowerCase();
  if (c.includes("niger")) return SUPPORT.ng;   // Nigeria
  return SUPPORT.cm;                             // Cameroun / Cameroon / unknown → CM
}

// ── markdown-lite: '### ' heading, '- '/'• ' bullet, '1.' numbered, '> ' quote,
// '**bold**' inline. Content is trusted (bundled) and rendered as TEXT nodes only
// (no HTML injection). ─────────────────────────────────────────────────────────
function inline(str) {
  return String(str).split("**").map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
  );
}
function HelpBody({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div style={{ lineHeight: 1.55, fontSize: 14.5, color: "var(--text)" }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        if (line.startsWith("### ") || line.startsWith("#### ")) {
          return <div key={i} style={{ fontWeight: 800, fontSize: 14.5, margin: "14px 0 4px", color: "var(--brand-light)" }}>{line.replace(/^#+\s/, "")}</div>;
        }
        if (line.startsWith("> ")) {
          return <div key={i} style={{ borderLeft: "3px solid var(--brand)", padding: "4px 10px", margin: "6px 0", background: "var(--bg-elevated)", borderRadius: 6, fontStyle: "italic" }}>{inline(line.slice(2))}</div>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0 2px 6px" }}><span style={{ color: "var(--brand-light)" }}>•</span><span>{inline(line.slice(2))}</span></div>;
        }
        const num = line.match(/^(\d+)\.\s(.*)$/);
        if (num) {
          return <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0 2px 6px" }}><span style={{ color: "var(--text-muted)", fontWeight: 700, minWidth: 16 }}>{num[1]}.</span><span>{inline(num[2])}</span></div>;
        }
        return <p key={i} style={{ margin: "4px 0" }}>{inline(line)}</p>;
      })}
    </div>
  );
}

export default function HelpPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const [openId, setOpenId] = useState(null);

  // MP-HELP per-screen "?": /help#<anchor> opens that topic directly. Anchor is a
  // topic id (e.g. #transfer) or, as a fallback, a NAV section (opens the first
  // topic in it). Re-runs when the hash changes so re-clicking the same "?" works.
  const location = useLocation();
  useEffect(() => {
    const anchor = (location.hash || "").replace(/^#/, "").trim();
    if (!anchor) return;
    const match = HELP_TOPICS.find(t => t.id === anchor) || HELP_TOPICS.find(t => t.section === anchor);
    if (match) { setOpenId(match.id); window.scrollTo(0, 0); }
  }, [location.hash, location.key]);

  const { data: orgResp } = useOfflineCachedQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
    staleTime: 300000,
  });
  const support = supportForCountry(orgResp?.data?.country);
  const waMsg = en ? "Hello, I need help with Mon Partenaire." : "Bonjour, j'ai besoin d'aide avec Mon Partenaire.";

  const topic = openId ? HELP_TOPICS.find(t => t.id === openId) : null;

  const ContactCard = () => (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, marginTop: 18 }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>{en ? "Still stuck? Contact us" : "Toujours bloqué ? Contactez-nous"}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
        {en ? "We reply on WhatsApp, email or phone." : "Nous répondons sur WhatsApp, par email ou par téléphone."}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button onClick={(e) => openWhatsApp(e, support.wa, waMsg)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "#25D366", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          💬 WhatsApp
        </button>
        <a href={`mailto:${SUPPORT.email}?subject=${encodeURIComponent(en ? "Help — Mon Partenaire" : "Aide — Mon Partenaire")}`}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
          ✉️ {en ? "Email" : "Email"}
        </a>
        <a href={`tel:${support.tel}`}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
          📞 {en ? "Call" : "Appeler"}
        </a>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 4px" }}>
      <div className="page-header">
        <h1 className="page-title">{en ? "Help" : "Aide"} <span style={{ fontWeight: 400 }}>❓</span></h1>
      </div>

      {!topic ? (
        <>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "4px 0 14px" }}>
            {en ? "Pick a topic for step-by-step help." : "Choisissez un sujet pour une aide pas à pas."}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {HELP_TOPICS.map(t => (
              <button key={t.id} onClick={() => { setOpenId(t.id); window.scrollTo(0, 0); }}
                style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", cursor: "pointer", fontSize: 15 }}>
                <span style={{ fontSize: 20, width: 26, textAlign: "center" }}>{t.icon}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{t.title[en ? "en" : "fr"]}</span>
                <span style={{ color: "var(--text-muted)" }}>›</span>
              </button>
            ))}
          </div>
          <ContactCard />
        </>
      ) : (
        <>
          <button onClick={() => setOpenId(null)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", cursor: "pointer", marginBottom: 12 }}>
            ← {en ? "All topics" : "Tous les sujets"}
          </button>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 18px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 26 }}>{topic.icon}</span>
              <h2 style={{ margin: 0, fontSize: 19 }}>{topic.title[en ? "en" : "fr"]}</h2>
            </div>
            <HelpBody text={topic.body[en ? "en" : "fr"]} />
          </div>
          <ContactCard />
        </>
      )}
    </div>
  );
}
