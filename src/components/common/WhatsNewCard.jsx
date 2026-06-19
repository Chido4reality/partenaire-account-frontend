import { useEffect, useState } from "react";
import { useLangStore } from "../../store";

// MP-WHATS-NEW-2.0 — dismissible "What's New" card shown ONCE on first open
// after updating to 2.0. Additive only; styled to match the existing dark
// theme (dark card surface + the existing gold accent #FBC503). No theme,
// layout, or color changes elsewhere.

// Version-keyed show-once flag (reuses the app's existing localStorage
// persistence, same pattern as mp-bcast-dismissed). Bump both when a future
// "What's New" ships (e.g. 3.0 → WHATSNEW_SEEN_KEY = "whatsnew_3_0_seen").
const APP_VERSION = "2.0";
const WHATSNEW_SEEN_KEY = "whatsnew_2_0_seen";

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  2.0 HIGHLIGHTS (approved). FR (default) + EN — keep in sync.            ║
// ║  `bullets` is a simple array; the final bullet folds in the closing     ║
// ║  "for everyone / thank you" line (the card has no separate footer slot).║
// ╚════════════════════════════════════════════════════════════════════════╝
const WHATS_NEW_COPY = {
  fr: {
    title: "Bienvenue dans la version 2.0 — nouveautés :",
    bullets: [
      "🤖 Assistant IA — posez vos questions sur votre activité en langage simple (ventes, dépenses, meilleurs produits, qui vous doit de l'argent…) et obtenez une réponse immédiate.",
      "👥 Gestion du personnel — fiches employés, activité par caissier, et pointage des présences.",
      "📍 Caissier par boutique — affectez chaque caissier à un point de vente précis.",
      "💰 Patrimoine & Dépenses — suivez votre argent et vos dépenses hors-boutique, séparément de la caisse.",
      "Et pour tous : une interface rafraîchie et de nombreuses améliorations. Merci de votre fidélité ! 🎉",
    ],
  },
  en: {
    title: "Welcome to version 2.0 — what's new:",
    bullets: [
      "🤖 AI Assistant — ask about your business in plain language (sales, expenses, best products, who owes you money…) and get an instant answer.",
      "👥 Staff Management — employee records, per-cashier activity, and attendance clock-in/out.",
      "📍 Cashier by location — assign each cashier to a specific shop.",
      "💰 Assets & Expenses — track your money and your off-shop expenses, separate from the till.",
      "And for everyone: a refreshed look and lots of improvements. Thank you! 🎉",
    ],
  },
};

export default function WhatsNewCard() {
  const { lang } = useLangStore();

  // Show only when running 2.0 AND the version-keyed flag isn't set yet.
  const [open, setOpen] = useState(() => {
    try { return APP_VERSION === "2.0" && !localStorage.getItem(WHATSNEW_SEEN_KEY); }
    catch { return false; }
  });

  // The header "2.0" badge can re-open this card on demand (in-page nicety).
  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener("mp-open-whatsnew", reopen);
    return () => window.removeEventListener("mp-open-whatsnew", reopen);
  }, []);

  if (!open) return null;

  const copy = WHATS_NEW_COPY[lang === "en" ? "en" : "fr"];
  const dismiss = () => {
    try { localStorage.setItem(WHATSNEW_SEEN_KEY, "1"); } catch { /* persistence best-effort */ }
    setOpen(false);
  };

  return (
    <div style={{
      marginBottom: 16, position: "relative",
      background: "var(--bg-card)",
      border: "1px solid rgba(251,197,3,0.35)",   // subtle gold accent, matches PRO/action gold
      borderRadius: 12, padding: "14px 16px 14px 16px",
    }}>
      <button onClick={dismiss} aria-label={lang === "en" ? "Dismiss" : "Fermer"}
        style={{
          position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          color: "var(--text-secondary)", cursor: "pointer", fontSize: 15, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>×</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingRight: 28 }}>
        <span style={{ fontSize: 18 }}>🎉</span>
        <span style={{
          display: "inline-block", background: "#FBC503", color: "#152B52",
          fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.3,
        }}>2.0</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{copy.title}</span>
      </div>

      <ul style={{ margin: 0, paddingLeft: 22, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
        {copy.bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}
