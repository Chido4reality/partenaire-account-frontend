import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

const CATS = [
  { value: "moto_parts",       en: "Motorcycle & Vehicle parts", fr: "Pièces moto & véhicules" },
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

export default function RegisterPage() {
  // MP-NIGERIA: `country` drives currency (NGN/XAF), city default, and phone format.
  // Defaults to Cameroun so an unchanged CM signup is byte-identical to before.
  const [form, setForm] = useState({ org_name: "", full_name: "", phone: "", password: "", category: "moto_parts", country: "Cameroun", city: "" });
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
  const { login } = useAuthStore();
  const { lang, setLang } = useLangStore();
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
      const res = await api.post("/auth/register", form);
      login(res.data.user, res.data.org, res.data.token);
      toast.success(lang === "en" ? "Account created!" : "Compte créé!");
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
          <button onClick={() => setLang(lang === "en" ? "fr" : "en")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Français" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
