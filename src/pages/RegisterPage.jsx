import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

const CATS = [
  { value: "moto_parts",  en: "Motorcycle parts",  fr: "Pieces moto" },
  { value: "electronics", en: "Electronics",        fr: "Electronique" },
  { value: "general",     en: "General trade",      fr: "Commerce general" },
  { value: "food",        en: "Food & grocery",     fr: "Alimentation" },
  { value: "hardware",    en: "Hardware & tools",   fr: "Quincaillerie" },
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
      toast.success(lang === "en" ? "Account created!" : "Compte cree!");
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.message || "Error");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: "0 auto 12px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>ðŸª</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{lang === "en" ? "Create your account" : "Creer votre compte"}</h1>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <form onSubmit={handleSubmit}>
            {[
              { key: "org_name",  en: "Business name",  fr: "Nom de la boutique", type: "text",     ph: "Ex: Moto Parts Akwa" },
              { key: "full_name", en: "Your full name", fr: "Votre nom complet",  type: "text",     ph: "Jean Dupont" },
              { key: "phone",     en: "Phone number",   fr: "Telephone",          type: "tel",      ph: "6XXXXXXXX" },
              { key: "password",  en: "Password",       fr: "Mot de passe",       type: "password", ph: "Min. 6 characters" },
            ].map(f => (
              <div className="form-group" key={f.key}>
                <label className="label">{lang === "en" ? f.en : f.fr}</label>
                <input className="input" type={f.type} value={form[f.key]} onChange={e => set(f.key, e.target.value)} required placeholder={f.ph} />
              </div>
            ))}
            <div className="form-group">
              <label className="label">{lang === "en" ? "Business category" : "Secteur d activite"}</label>
              <select className="input" value={form.category} onChange={e => set("category", e.target.value)}>
                {CATS.map(c => <option key={c.value} value={c.value}>{lang === "en" ? c.en : c.fr}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
              {loading ? "Creating..." : (lang === "en" ? "Create my account" : "Creer mon compte")}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
            <Link to="/login" style={{ color: "var(--brand-light)", textDecoration: "none" }}>
              {lang === "en" ? "Already have an account? Sign in" : "Deja un compte? Se connecter"}
            </Link>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            ðŸŒ {lang === "en" ? "Francais" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
