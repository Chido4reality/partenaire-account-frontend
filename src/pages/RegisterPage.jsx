import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";
import { setLanguageLocalPending } from "../utils/setLanguage"; // MP-LANGUAGE-PERSIST

const CATS = [
  { value: "moto_parts",       en: "Motorcycle parts",           fr: "Pièces moto" },
  { value: "auto_parts",       en: "Auto / Vehicle parts",       fr: "Pièces auto / véhicules" },
  { value: "electronics",      en: "Electronics & Accessories",  fr: "Électronique & accessoires" },
  { value: "general",          en: "General trade",              fr: "Commerce général" },
  { value: "food",             en: "Food & Grocery",             fr: "Alimentation & épicerie" },
  { value: "hardware",         en: "Hardware & Tools",           fr: "Quincaillerie & outils" },
  { value: "fashion",          en: "Fashion & Clothing",         fr: "Mode & habillement" },
  { value: "hair_cosmetics",   en: "Hair & Cosmetics",           fr: "Coiffure & cosmétiques" },
  { value: "building",         en: "Building Materials",         fr: "Matériaux de construction" },
  { value: "pharmacy",         en: "Pharmacy & Health",          fr: "Pharmacie & santé" },
  { value: "furniture",        en: "Furniture & Home",           fr: "Meubles & maison" },
  { value: "agriculture",      en: "Agriculture & Farming",      fr: "Agriculture & élevage" },
  { value: "printing",         en: "Printing & Stationery",      fr: "Imprimerie & papeterie" },
  { value: "telecom",          en: "Telecom & Phone repair",     fr: "Télécom & réparation téléphones" },
  { value: "restaurant",       en: "Restaurant & Food service",  fr: "Restaurant & restauration" },
  { value: "transport",        en: "Transport & Logistics",      fr: "Transport & logistique" },
  { value: "other",            en: "Other",                      fr: "Autre" },
];

// MP-REFERRAL-LINK: a marketer shares /register?code=KARO234 rather than asking
// people to type a code. Mirrors the server's REASON_MSG so a rejection names
// its actual cause instead of a generic "not applied".
//
// The code is NOT validated before submit, deliberately: /api/promo/validate is
// behind authenticate (it reads req.user.org_id), and adding a public variant
// would hand anyone a code-probing oracle — promoRedemption.js guards that on
// purpose ("no endpoint ever lists pa_promo_codes to an org-user"). So validity
// is only knowable when the server resolves it at registration.
// Pure so it can be tested directly. A referral code arrives from a URL a
// stranger may have edited, so it is clamped to the DB's own alphabet
// (^[A-Za-z0-9]{3,20}$) before it is ever put in the DOM or sent onward.
export function referralCodeFromQuery(searchParams) {
  const raw = (searchParams && (searchParams.get("code") || searchParams.get("ref"))) || "";
  const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  return clean.length >= 3 ? clean : "";
}

const PROMO_REASON = {
  not_found:        { en: "We couldn't find that code. Check the link, or ask whoever shared it.",
                      fr: "Code introuvable. Vérifiez le lien ou demandez à la personne qui l'a partagé." },
  expired:          { en: "That code has expired.", fr: "Ce code a expiré." },
  inactive:         { en: "That code is no longer active.", fr: "Ce code n'est plus actif." },
  not_started:      { en: "That code isn't active yet.", fr: "Ce code n'est pas encore actif." },
  already_redeemed: { en: "Your shop has already used a promo code — only one per shop.",
                      fr: "Votre boutique a déjà utilisé un code promo — un seul par boutique." },
  bad_format:       { en: "That code contains invalid characters.",
                      fr: "Ce code contient des caractères invalides." },
};
function promoReasonText(reason, lang) {
  const m = PROMO_REASON[reason];
  if (m) return lang === "en" ? m.en : m.fr;
  return lang === "en" ? "That code could not be applied." : "Ce code n'a pas pu être appliqué.";
}

export default function RegisterPage() {
  // MP-NIGERIA: `country` drives currency (NGN/XAF), city default, and phone format.
  // Defaults to Cameroun so an unchanged CM signup is byte-identical to before.
  const [form, setForm] = useState({ org_name: "", full_name: "", phone: "", password: "", category: "moto_parts", country: "Cameroun", city: "", promo_code: "" });
  const [loading, setLoading] = useState(false);
  const [cities, setCities] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.get(`/cities?country=${encodeURIComponent(form.country)}`)
      .then(r => { if (!cancelled) setCities(r.data?.data || []); })
      .catch(() => { if (!cancelled) setCities([]); });
    return () => { cancelled = true; };
  }, [form.country]);
  // MP-REGISTER-DUP-PHONE-HANDLING: inline error under the phone
  // field for the 409 PHONE_ALREADY_REGISTERED response. Cleared
  // when the user edits the phone input.
  const [phoneError, setPhoneError] = useState("");
  // MP-REFERRAL-LINK state. `linked` means the code arrived by URL, so the field
  // is locked against accidental edits — with a Change affordance, because a bad
  // link must never be a trap the visitor cannot escape.
  const [searchParams] = useSearchParams();
  // Derived during render, NOT in a useEffect: an effect would leave the first
  // paint showing an empty, unlocked field, and would be invisible to any
  // server-rendered test. useSearchParams is available during render.
  const linkedCode = referralCodeFromQuery(searchParams);
  const [promoUnlocked, setPromoUnlocked] = useState(false);
  const promoLinked = !!linkedCode && !promoUnlocked;
  const { login } = useAuthStore();
  const { lang } = useLangStore();
  const navigate = useNavigate();
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (k === "phone" && phoneError) setPhoneError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPhoneError("");
    setLoading(true);
    try {
      // The linked code lives in linkedCode, not form.promo_code, so build the
      // payload explicitly — sending `form` alone would drop it silently and
      // the marketer would lose the attribution the link exists to create.
      const effectivePromo = promoLinked ? linkedCode : form.promo_code;
      const res = await api.post("/auth/register", { ...form, promo_code: effectivePromo });
      login(res.data.user, res.data.org, res.data.token);
      toast.success(lang === "en" ? "Account created!" : "Compte créé!");
      // MP-PROMO: confirm a valid signup code was captured; a bad code never
      // blocks signup, so just nudge them to add it at checkout instead.
      if (res.data?.promo?.applied) {
        toast.success(lang === "en" ? `🎟️ Promo code ${res.data.promo.code} applied` : `🎟️ Code promo ${res.data.promo.code} appliqué`);
      } else if (effectivePromo && effectivePromo.trim()) {
        // Never silent, and never blocking. A visitor who followed a link never
        // typed the code, so saying nothing would leave BOTH them and the
        // marketer believing attribution happened. Name the actual reason, and
        // point at the recovery that genuinely exists: the owner can still bind
        // a code afterwards via POST /api/promo/redeem from Settings.
        const why = promoReasonText(res.data?.promo?.reason, lang);
        toast.error(
          (lang === "en" ? `Code ${effectivePromo} was not applied. ` : `Le code ${effectivePromo} n'a pas été appliqué. `) +
          why + (lang === "en" ? " You can still add a code from Settings." : " Vous pouvez encore l'ajouter dans Paramètres."),
          { duration: 9000 }
        );
      }
      navigate("/");
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.error === "PHONE_ALREADY_REGISTERED") {
        const msg = (lang === "en" ? data.message_en : data.message_fr)
          || data.message
          || (lang === "en"
            ? "This phone number is already registered."
            : "Ce numéro de téléphone est déjà enregistré.");
        setPhoneError(msg);
        toast.error(msg);
      } else {
        toast.error(data?.message || "Error");
      }
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px", background: "linear-gradient(135deg, #152B52, #FBC503)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🧾</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
            {lang === "en" ? "Create your account" : "Créer votre compte"}
          </h1>
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Country" : "Pays"}</label>
              <select className="input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value, city: "" }))}>
                <option value="Cameroun">{lang === "en" ? "Cameroon" : "Cameroun"}</option>
                <option value="Nigeria">Nigeria</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "City" : "Ville"}</label>
              <select className="input" value={form.city} onChange={e => set("city", e.target.value)}>
                <option value="">{lang === "en" ? "Select city…" : "Choisir la ville…"}</option>
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {[
              { key: "org_name",  en: "Business name",  fr: "Nom de la boutique", type: "text",     ph: "Ex: Moto Parts Akwa" },
              { key: "full_name", en: "Your full name", fr: "Votre nom complet",  type: "text",     ph: "Jean Dupont" },
              { key: "phone",     en: "Phone number",   fr: "Téléphone",          type: "tel",      ph: "6XXXXXXXX" },
              { key: "password",  en: "Password",       fr: "Mot de passe",       type: "password", ph: lang === "en" ? "Min. 6 characters" : "Min. 6 caractères" },
            ].map(f => {
              const isPhone = f.key === "phone";
              const hasError = isPhone && !!phoneError;
              return (
                <div className="form-group" key={f.key}>
                  <label className="label">{lang === "en" ? f.en : f.fr}</label>
                  <input className="input" type={f.type} value={form[f.key]}
                    onChange={e => set(f.key, e.target.value)} required
                    placeholder={isPhone ? (form.country === "Nigeria" ? "08030000000" : "6XXXXXXXX") : f.ph}
                    style={hasError ? { borderColor: "#f87171" } : undefined}
                    aria-invalid={hasError || undefined} />
                  {isPhone && !hasError && (
                    <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                      {form.country === "Nigeria"
                        ? (lang === "en" ? "Nigerian number (e.g. +234 803 000 0000)" : "Numéro nigérian (ex: +234 803 000 0000)")
                        : (lang === "en" ? "Cameroon number (e.g. 6XX XX XX XX)" : "Numéro camerounais (ex: 6XX XX XX XX)")}
                    </div>
                  )}
                  {hasError && (
                    <div style={{ color: "#f87171", fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>
                      {phoneError}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="form-group">
              <label className="label">{lang === "en" ? "Business category" : "Secteur d'activité"}</label>
              <select className="input" value={form.category} onChange={e => set("category", e.target.value)}>
                {CATS.map(c => (
                  <option key={c.value} value={c.value}>
                    {lang === "en" ? c.en : c.fr}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="label">
                {lang === "en" ? "Promo code (optional)" : "Code promo (optionnel)"}
              </label>
              <input className="input" type="text" value={promoLinked ? linkedCode : form.promo_code}
                onChange={e => set("promo_code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                maxLength={20} placeholder={lang === "en" ? "e.g. TOLU20" : "ex : TOLU20"}
                readOnly={promoLinked} data-testid="promo-input"
                style={{ textTransform: "uppercase", ...(promoLinked ? { opacity: 0.75, cursor: "not-allowed" } : {}) }} />
              {promoLinked && (
                /* "will be applied", NOT "applied" — the code has not been resolved
                   yet, and claiming success before the server answers would be a
                   claim we cannot back. */
                <div data-testid="promo-banner"
                  style={{ marginTop: 6, padding: "6px 10px", borderRadius: 8, fontSize: 12,
                           background: "rgba(16,185,129,0.12)", color: "#059669",
                           display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>
                    {lang === "en"
                      ? `Referral code ${linkedCode} — will be applied when you create your account.`
                      : `Code de parrainage ${linkedCode} — sera appliqué à la création de votre compte.`}
                  </span>
                  <button type="button" data-testid="promo-change"
                    onClick={() => { set("promo_code", linkedCode); setPromoUnlocked(true); }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                             color: "inherit", textDecoration: "underline", fontSize: 12 }}>
                    {lang === "en" ? "Change" : "Modifier"}
                  </button>
                </div>
              )}

              <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                {lang === "en"
                  ? "From an influencer? Enter their code to get a discount on your subscription."
                  : "Reçu d'un influenceur ? Entrez son code pour une réduction sur votre abonnement."}
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? (lang === "en" ? "Creating..." : "Création...") : (lang === "en" ? "Create my account" : "Créer mon compte")}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
            <Link to="/login" style={{ color: "var(--brand-light)", textDecoration: "none" }}>
              {lang === "en" ? "Already have an account? Sign in" : "Déjà un compte? Se connecter"}
            </Link>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          {/* MP-LANGUAGE-PERSIST: pre-auth — records the choice as pending so it lands on
              pa_users.language once the account exists. */}
          <button onClick={() => setLanguageLocalPending(lang === "en" ? "fr" : "en")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Français" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
