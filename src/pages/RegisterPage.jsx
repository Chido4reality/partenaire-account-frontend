import { useState } from "react";
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
  const [form, setForm] = useState({ org_name: "", full_name: "", phone: "", password: "", category: "moto_parts" });
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const navigate = useNavigate();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/register", form);
      login(res.data.user, res.data.org, res.data.token);
      toast.success(lang === "en" ? "Account created!" : "Compte créé!");
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🧾</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
            {lang === "en" ? "Create your account" : "Créer votre compte"}
          </h1>
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <form onSubmit={handleSubmit}>
            {[
              { key: "org_name",  en: "Business name",  fr: "Nom de la boutique", type: "text",     ph: "Ex: Moto Parts Akwa" },
              { key: "full_name", en: "Your full name", fr: "Votre nom complet",  type: "text",     ph: "Jean Dupont" },
              { key: "phone",     en: "Phone number",   fr: "Téléphone",          type: "tel",      ph: "6XXXXXXXX" },
              { key: "password",  en: "Password",       fr: "Mot de passe",       type: "password", ph: lang === "en" ? "Min. 6 characters" : "Min. 6 caractères" },
            ].map(f => (
              <div className="form-group" key={f.key}>
                <label className="label">{lang === "en" ? f.en : f.fr}</label>
                <input className="input" type={f.type} value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)} required placeholder={f.ph} />
              </div>
            ))}

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
