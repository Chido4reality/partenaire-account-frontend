import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";
import { setLanguageLocalPending } from "../utils/setLanguage"; // MP-LANGUAGE-PERSIST

// LOGIN DIAGNOSTICS (2026-10-05). Paul, on Orange: "the button dims for a few seconds, then
// returns — no message, over and over". A failed sign-in must say WHY, on the screen itself
// (a toast is easy to miss and can sit under the status bar), with a short technical code a
// screenshot can carry back to us. Pure, so the render check can drive every branch.
export function loginFailure(err, lang) {
  const fr = lang !== "en";
  const res = err && err.response;
  const d = (res && res.data) || {};
  if (!res || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK") {
    const code = err && err.code === "ECONNABORTED" ? "timeout" : ((err && err.code) || "no_response");
    return { code, message: fr
      ? "Impossible de joindre le serveur — vérifiez vos données mobiles, ou passez en Wi-Fi, puis réessayez."
      : "Can't reach the server — check your mobile data, or switch to Wi-Fi, then try again." };
  }
  const code = `HTTP ${res.status}${d.error || d.code ? " · " + (d.error || d.code) : ""}`;
  if (d.error === "account_disabled") return { code, message: fr ? d.message_fr || d.message : d.message_en || d.message };
  if (res.status === 429) return { code, message: fr
    ? "Trop d'essais depuis ce réseau — patientez 15 minutes, ou passez en Wi-Fi."
    : "Too many attempts from this network — wait 15 minutes, or switch to Wi-Fi." };
  const server = fr ? (d.message_fr || d.message) : (d.message_en || d.message);
  if (res.status === 401) return { code, message: server || (fr ? "Identifiants incorrects." : "Wrong phone number or password.") };
  return { code, message: server || (fr ? "Le serveur a refusé la connexion — réessayez." : "The server refused the sign-in — try again.") };
}

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
    // LOGIN DIAGNOSTICS: the server refused a stored session — say so instead of a silent bounce.
    if (flash === "session_expired") {
      setFailure({ code: "session_expired", message: lang === "en" ? "Your session expired — please sign in again." : "Votre session a expiré — reconnectez-vous." });
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
  const [failure, setFailure]   = useState(null);   // { message, code } — shown under the button
  const [attempt, setAttempt]   = useState(null);   // { attempt, of } while api.js retries

  useEffect(() => {
    const onRetry = (e) => setAttempt(e.detail || null);
    window.addEventListener("mp-auth-retry", onRetry);
    return () => window.removeEventListener("mp-auth-retry", onRetry);
  }, []);
  const { login }               = useAuthStore();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFailure(null);
    setAttempt(null);
    try {
      const res = await api.post("/auth/login", { phone, password });
      login(res.data.user, res.data.org, res.data.token);
      navigate("/");
    } catch (err) {
      // No response / axios timeout (ECONNABORTED) / transport error
      // (ERR_NETWORK) = connectivity problem, not bad credentials. Say so
      // clearly and fast (6s timeout) instead of a generic error after a hang.
      const f = loginFailure(err, lang);
      setFailure(f);
      toast.error(f.message);
    } finally { setLoading(false); setAttempt(null); }
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
              {loading
                ? `${t("auth.logging")}${attempt ? ` (${lang === "en" ? "attempt" : "essai"} ${attempt.attempt}/${attempt.of})` : ""}`
                : t("auth.loginBtn")}
            </button>
            <LoginFailure failure={failure} />
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

// Module scope + props-only, so the render check can mount it (useEffect never runs there).
export function LoginFailure({ failure }) {
  if (!failure) return null;
  return (
    <div data-login-error role="alert" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
      color: "#fca5a5", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)" }}>
      {failure.message}
      {failure.code && <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, fontFamily: "monospace" }}>{failure.code}</div>}
    </div>
  );
}
