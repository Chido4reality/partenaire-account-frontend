// MP-ONBOARDING-FIRST-RUN — a short, first-run walkthrough of the core POS
// surfaces, shown ONCE per user per device (see utils/onboarding.js). Bilingual
// (English primary, French secondary) via the app's lang, same inline pattern
// the rest of the app uses. Skip is available on every step; Finish closes on the
// last step. BOTH mark the guide seen and dismiss via plain React state — no
// window.print()/window.close()-style dead-ends, so it reliably closes inside the
// Android WebView.
import { useState } from "react";
import { markOnboardingSeen } from "../../utils/onboarding";

// Steps: emoji + one-line title + one-line description. EN primary / FR second.
const STEPS = [
  { icon: "🛒", en: { t: "New Sale (POS)",     d: "Ring up a sale, scan or search products, and take payment." },
                fr: { t: "Nouvelle vente (Caisse)", d: "Enregistrez une vente, scannez ou cherchez des articles, encaissez." } },
  { icon: "🧾", en: { t: "Sales & receipts",   d: "Find past receipts — scan a receipt barcode to refund or reprint." },
                fr: { t: "Ventes & reçus",      d: "Retrouvez les reçus — scannez le code-barres d'un reçu pour rembourser ou réimprimer." } },
  { icon: "👥", en: { t: "Customers & debt",   d: "Track who owes you money and record their repayments." },
                fr: { t: "Clients & dettes",    d: "Suivez qui vous doit de l'argent et enregistrez les remboursements." } },
  { icon: "📊", en: { t: "Reports",            d: "See the day's money, the per-person scoreboard, and your profit." },
                fr: { t: "Rapports",            d: "Voyez l'argent du jour, le tableau par personne et votre bénéfice." } },
  { icon: "⚙️", en: { t: "Settings",           d: "Your shop details, receipt options, and staff — set up once." },
                fr: { t: "Paramètres",          d: "Infos boutique, options de reçu et personnel — à configurer une fois." } },
];

export default function OnboardingGuide({ userId, lang = "en", onClose }) {
  const en = lang === "en";
  const [i, setI] = useState(0);
  const [closing, setClosing] = useState(false);
  const step = STEPS[i];
  const isLast = i === STEPS.length - 1;

  // Skip AND Finish both record "seen" for this user, then dismiss. Guarded so a
  // double-tap can't double-fire; onClose is plain React state (always closes).
  const done = async () => {
    if (closing) return;
    setClosing(true);
    try { await markOnboardingSeen(userId); } catch { /* best-effort — still close */ }
    onClose();
  };

  const cnt = STEPS.length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 18, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header: quick intro + Skip (present on EVERY step) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 6px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 0.3 }}>
            {en ? "Quick guide" : "Guide rapide"} · {i + 1}/{cnt}
          </div>
          <button onClick={done} disabled={closing}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 4 }}>
            {en ? "Skip" : "Passer"}
          </button>
        </div>

        {/* Step body */}
        <div style={{ padding: "10px 22px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 46, lineHeight: 1, marginBottom: 12 }}>{step.icon}</div>
          <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>{en ? step.en.t : step.fr.t}</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 44 }}>
            {en ? step.en.d : step.fr.d}
          </div>
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: "8px 0 4px" }}>
          {STEPS.map((_, idx) => (
            <span key={idx} style={{ width: idx === i ? 18 : 7, height: 7, borderRadius: 4, background: idx === i ? "var(--brand)" : "var(--border)", transition: "0.2s" }} />
          ))}
        </div>

        {/* Footer nav */}
        <div style={{ display: "flex", gap: 8, padding: "12px 18px 18px" }}>
          {i > 0 && (
            <button onClick={() => setI(i - 1)} disabled={closing}
              style={{ flex: 1, padding: "11px", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {en ? "Back" : "Retour"}
            </button>
          )}
          {isLast ? (
            <button onClick={done} disabled={closing}
              style={{ flex: 2, padding: "11px", background: "var(--brand)", border: "none", color: "#152B52", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              {closing ? "…" : (en ? "Get started" : "Commencer")}
            </button>
          ) : (
            <button onClick={() => setI(i + 1)} disabled={closing}
              style={{ flex: 2, padding: "11px", background: "var(--brand)", border: "none", color: "#152B52", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              {en ? "Next" : "Suivant"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
