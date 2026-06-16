// Staff Maintenance Phase 3 — shared-device PIN attendance (clock-in/out).
//
// Runs on the SHARED shop device (one persistent session). A staff member taps
// their name, enters their PIN, and punches in/out — NO personal phone, NO GPS,
// just times. A single punch TOGGLES: open → clock-out, otherwise clock-in.
// Pro Plus only (staff_maintenance); any role can clock themselves.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";

function hhmm(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

export default function AttendancePage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const { selectedLocation } = useSettingsStore();

  const [picked, setPicked] = useState(null); // staffer being punched
  const [pin, setPin] = useState("");
  const [result, setResult] = useState(null); // { action, name, ... }

  const { data: planResp } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
    staleTime: 60000,
  });
  const entitled = hasFeature(planResp?.data?.effective_plan || "trial", "staff_maintenance");

  const { data: staffResp, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get("/auth/staff").then(r => r.data),
    enabled: entitled,
  });
  const staff = (staffResp?.data || []).filter(s => s.is_active);

  const punch = useMutation({
    mutationFn: () => api.post("/staff/attendance/punch", {
      user_id: picked.id, pin, location_id: selectedLocation?.id || null,
    }).then(r => r.data),
    onSuccess: (res) => {
      setResult(res.data);
      setPicked(null); setPin("");
    },
    onError: (e) => {
      if (e?.response?.status === 401) toast.error(en ? "Incorrect PIN" : "Code incorrect");
      else toast.error(e?.response?.data?.message || (en ? "Could not record" : "Échec de l'enregistrement"));
    },
  });

  const wrap = (c) => <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>{c}</div>;

  if (!entitled) return wrap(
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>🕒</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{en ? "Attendance — Pro Plus" : "Pointage — Pro Plus"}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
        {en ? "Staff clock-in/out is available on the Pro Plus plan." : "Le pointage du personnel est disponible avec le forfait Pro Plus."}
      </div>
      <Link to="/request-activation?plan=pro_plus" className="btn btn-primary" style={{ textDecoration: "none" }}>
        🔒 {en ? "Upgrade to Pro Plus" : "Passer à Pro Plus"}
      </Link>
    </div>
  );

  // Result confirmation panel.
  if (result) return wrap(
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 10 }}>{result.action === "clock_in" ? "✅" : "👋"}</div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>{result.name}</div>
      <div style={{ fontSize: 16, color: result.action === "clock_in" ? "#34d399" : "var(--brand-light)", fontWeight: 700, marginBottom: 6 }}>
        {result.action === "clock_in"
          ? (en ? `Clocked in at ${hhmm(result.clock_in_at)}` : `Pointé à l'entrée à ${hhmm(result.clock_in_at)}`)
          : (en ? `Clocked out at ${hhmm(result.clock_out_at)} · ${result.hours} h` : `Pointé à la sortie à ${hhmm(result.clock_out_at)} · ${result.hours} h`)}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%", height: 46 }} onClick={() => setResult(null)}>
        {en ? "Done" : "Terminé"}
      </button>
    </div>
  );

  // PIN entry for the picked staffer.
  if (picked) return wrap(
    <div className="card">
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 10px", overflow: "hidden", background: "var(--bg-elevated)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, color: "var(--text-muted)" }}>
          {picked.photo_url ? <img src={picked.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (picked.full_name || "?").charAt(0).toUpperCase()}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{picked.full_name}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{en ? "Enter your PIN to clock in / out" : "Entrez votre code pour pointer"}</div>
      </div>
      <input className="input" type="password" inputMode="numeric" autoFocus value={pin}
        onChange={e => setPin(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && pin) punch.mutate(); }}
        placeholder={en ? "PIN" : "Code"} style={{ textAlign: "center", fontSize: 22, letterSpacing: 4, marginBottom: 14 }} />
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setPicked(null); setPin(""); }}>← {en ? "Back" : "Retour"}</button>
        <button className="btn btn-primary" style={{ flex: 2 }} disabled={!pin || punch.isPending} onClick={() => punch.mutate()}>
          {punch.isPending ? "…" : (en ? "Clock in / out" : "Pointer")}
        </button>
      </div>
    </div>
  );

  // Staff picker.
  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>🕒 {en ? "Attendance" : "Pointage"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 18 }}>
        {en ? "Tap your name, then enter your PIN to clock in or out." : "Touchez votre nom, puis entrez votre code pour pointer."}
      </div>
      {isLoading ? (
        <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : staff.length === 0 ? (
        <div className="empty-state"><div style={{ fontWeight: 600 }}>{en ? "No staff members" : "Aucun personnel"}</div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {staff.map(s => (
            <button key={s.id} onClick={() => { setPicked(s); setPin(""); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 10px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-card)", cursor: "pointer" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, overflow: "hidden", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: "var(--text-muted)" }}>
                {s.photo_url ? <img src={s.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (s.full_name || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{s.full_name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
