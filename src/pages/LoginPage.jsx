import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

export default function LoginPage() {
  // MP-AUTH-STATE-HYGIENE: surface the user-change tripwire reason.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("flash") === "session_changed") {
      toast("Session changed — please log in again.", { icon: "🔒" });
    }
  }, []);

  const [phone, setPhone]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuthStore();
  const { t, lang, setLang }    = useLangStore();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { phone, password });
      login(res.data.user, res.data.org, res.data.token);
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.message || t("common.error"));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 14px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🤝</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)" }}>Mon Partenaire</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>{lang === "en" ? "Manage your shop, grow your business" : "Gerez votre boutique, developpez votre business"}</p>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: 28 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{t("auth.login")}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="label">{t("auth.phone")}</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{t("auth.password")}</label>
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="" />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? t("auth.logging") : t("auth.loginBtn")}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "var(--text-secondary)" }}>
            {lang === "en" ? "No account yet? " : "Pas encore de compte? "}
            <Link to="/register" style={{ color: "var(--brand-light)", fontWeight: 500, textDecoration: "none" }}>{t("auth.register")}</Link>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={() => setLang(lang === "en" ? "fr" : "en")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Francais" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
