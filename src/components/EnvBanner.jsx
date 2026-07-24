import { useEffect, useState } from "react";
import api from "../utils/api";

// MP-STAGING-SAFETY: a loud, always-visible bar shown whenever the app is talking to a
// NON-PRODUCTION backend. It is driven by the backend's own /api/health `env` field — NOT
// a client build flag — so a tester can never again mistake prod for staging (a forgotten
// flag can lie; the live server can't). On a real prod backend `env==='production'` and the
// bar renders nothing. Bilingual FR/EN. Sits above the router so it shows on /login too.
export default function EnvBanner() {
  const [env, setEnv] = useState(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api.get("/health", { timeout: 4000 })
        .then((r) => { if (alive) setEnv(r.data?.env || null); })
        .catch(() => { /* offline / unreachable → leave last known */ });
    check();
    const id = setInterval(check, 30000); // re-confirm periodically in case the target changes
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!env || env === "production") return null;

  return (
    <div
      role="status"
      style={{
        position: "sticky", top: 0, zIndex: 100000,
        background: "#b91c1c", color: "#fff", textAlign: "center",
        fontWeight: 800, fontSize: 12.5, letterSpacing: 0.4,
        padding: "6px 10px", lineHeight: 1.3,
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
      }}
    >
      ⚠ {env.toUpperCase()} — DONNÉES DE TEST · TEST DATA (pas la production / not production)
    </div>
  );
}
