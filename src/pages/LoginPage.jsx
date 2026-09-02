import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";
import { setLanguageLocalPending } from "../utils/setLanguage"; // MP-LANGUAGE-PERSIST

export default function LoginPage() {
  const { t, lang }             = useLangStore();

  // MP-AUTH-STATE-HYGIENE: surface the user-change tripwire reason.
  // MP-DEACTIVATION-ENFORCEMENT (Amendment 4b): if the auth middleware bounced an
  // already-logged-in user because their account was disabled, api.js dropped a
  // one-shot flash — explain WHY here instead of a silent redirect.
  useEffect(() => {
    const flash = new URLSearchParams(window.location.search).get("flash");
    if (flash === "session_changed") {
      toast("Session changed — please log in again.", { icon: "🔒" });
    }
    // Fix A: the disabled reason arrives reload-proof in the URL (?flash=account_disabled)
    // for a forced logout; the sessionStorage flag is the fallback (e.g. no-reload paths).
    // Either source → the bilingual message. Clear the fallback so it can't double-fire.
    let disabled = flash === "account_disabled";
    try {
      if (sessionStorage.getItem("mp-flash-disabled")) {
        sessionStorage.removeItem("mp-flash-disabled");
        disabled = true;
      }
    } catch { /* private mode */ }
    if (disabled) toast.error(t("auth.accountDisabled"), { icon: "🚫", duration: 6000 });
  }, [t]);

  const [phone, setPhone]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const { login }               = useAuthStore();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { phone, password });
      login(res.data.user, res.data.org, res.data.token);
      navigate("/");
    } catch (err) {
      // No response / axios timeout (ECONNABORTED) / transport error
      // (ERR_NETWORK) = connectivity problem, not bad credentials. Say so
      // clearly and fast (6s timeout) instead of a generic error after a hang.
      const networkish = !err.response || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK";
      // Disabled account (correct PIN, account turned off) gets its own bilingual line.
      const disabled = err.response?.data?.error === "account_disabled";
      toast.error(networkish
        ? (lang === "fr" ? "Pas de connexion — vérifiez votre réseau" : "No connection — check your network")
        : disabled
          ? t("auth.accountDisabled")
          : (err.response?.data?.message || t("common.error")));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", padding: 16 }}>
      <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,197,3,0.12) 0%, transparent 70%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 14px", background: "linear-gradient(135deg, #152B52, #FBC503)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🤝</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)" }}>Stenamo Book</h1>
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
          {/* MP-LANGUAGE-PERSIST: no session yet, so this can't PATCH — it records the
              choice as pending and syncLanguageOnLogin flushes it the moment the user
              signs in. "I picked English on the login screen" now survives into the
              account instead of being a display-only change. */}
          <button onClick={() => setLanguageLocalPending(lang === "en" ? "fr" : "en")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            🌐 {lang === "en" ? "Francais" : "English"}
          </button>
        </div>
      </div>
    </div>
  );
}
