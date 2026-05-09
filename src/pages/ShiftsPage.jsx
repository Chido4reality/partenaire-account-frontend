import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api, { formatCFA } from "../utils/api";

export default function ShiftsPage() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const isManager = user?.role === "manager";

  const [openingFloat, setOpeningFloat] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);

  // Get my open shift
  const { data: myShiftData, isLoading: shiftLoading } = useQuery({
    queryKey: ["my-shift"],
    queryFn: () => api.get("/shifts/my-shift").then(r => r.data),
    refetchInterval: 60000
  });

  // Get all shifts (manager/owner)
  const { data: allShiftsData } = useQuery({
    queryKey: ["all-shifts"],
    queryFn: () => api.get("/shifts").then(r => r.data),
    enabled: isOwner || isManager
  });

  const myShift = myShiftData?.data;
  const allShifts = allShiftsData?.data || [];

  const openMutation = useMutation({
    mutationFn: () => api.post("/shifts/open", {
      location_id: selectedLocation?.id || null,
      opening_float: +openingFloat || 0
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Shift opened!" : "✓ Caisse ouverte!");
      setOpeningFloat("");
      qc.invalidateQueries(["my-shift"]);
      qc.invalidateQueries(["all-shifts"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const closeMutation = useMutation({
    mutationFn: () => api.post(`/shifts/close/${myShift.id}`, {
      actual_cash: +actualCash,
      notes: closeNotes
    }),
    onSuccess: (data) => {
      const result = data?.data;
      const diff = result?.difference || 0;
      const waMsg = result?.wa_message;

      toast.success(lang === "en" ? "✓ Shift closed!" : "✓ Caisse fermée!", { duration: 3000 });
      setShowCloseModal(false);
      setActualCash("");
      setCloseNotes("");
      qc.invalidateQueries(["my-shift"]);
      qc.invalidateQueries(["all-shifts"]);

      // Offer to send WhatsApp to boss
      if (waMsg) {
        setTimeout(() => {
          if (window.confirm(lang === "en" ? "Send summary to boss via WhatsApp?" : "Envoyer le résumé au patron par WhatsApp?")) {
            window.open(`https://wa.me/?text=${encodeURIComponent(waMsg)}`, "_blank");
          }
        }, 500);
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const getDiffColor = (diff) => {
    if (diff === 0) return "#34d399";
    if (diff > 0) return "#34d399";
    return "#f87171";
  };

  const getDiffLabel = (diff) => {
    if (diff === 0) return lang === "en" ? "✓ Balanced" : "✓ Équilibrée";
    if (diff > 0) return `+${diff.toLocaleString()} F ${lang === "en" ? "(surplus)" : "(excédent)"}`;
    return `${diff.toLocaleString()} F ${lang === "en" ? "(shortage)" : "(manque)"}`; 
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">💰 {lang === "en" ? "Cash Register" : "Gestion de caisse"}</h1>
      </div>

      {shiftLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
      ) : myShift ? (
        /* ── SHIFT IS OPEN ── */
        <div>
          <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 16, padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, color: "#34d399", marginBottom: 4 }}>
                  🟢 {lang === "en" ? "Shift Open" : "Caisse ouverte"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {lang === "en" ? "Opened at" : "Ouverte à"} {new Date(myShift.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en" ? "Opening float:" : "Fond de caisse:"} <strong>{formatCFA(myShift.opening_float)}</strong>
                </div>
              </div>
              <button onClick={() => setShowCloseModal(true)}
                className="btn btn-primary" style={{ background: "#ef4444", borderColor: "#ef4444" }}>
                🔒 {lang === "en" ? "Close Shift" : "Fermer la caisse"}
              </button>
            </div>
          </div>

          <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            {lang === "en" ? "At end of day, count your cash and close the shift to send a summary to the boss." : "En fin de journée, comptez votre caisse et fermez pour envoyer un résumé au patron."}
          </div>
        </div>
      ) : (
        /* ── NO SHIFT OPEN ── */
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 400 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
            🔓 {lang === "en" ? "Open Your Shift" : "Ouvrir votre caisse"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            {lang === "en" ? "Start your work day by opening your cash register." : "Commencez votre journée en ouvrant votre caisse."}
          </div>

          <div className="form-group">
            <label className="label">{lang === "en" ? "Opening float (FCFA)" : "Fond de caisse (FCFA)"}</label>
            <input className="input" type="number" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)}
              placeholder={lang === "en" ? "Cash in drawer at start" : "Espèces dans la caisse au départ"} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              {lang === "en" ? "Leave 0 if starting empty" : "Laisser 0 si caisse vide"}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            📍 {selectedLocation?.name || (lang === "en" ? "No location selected" : "Aucun emplacement sélectionné")}
          </div>

          <button onClick={() => openMutation.mutate()} disabled={openMutation.isPending}
            className="btn btn-primary" style={{ width: "100%", height: 44 }}>
            {openMutation.isPending ? "..." : (lang === "en" ? "✓ Open Shift" : "✓ Ouvrir la caisse")}
          </button>
        </div>
      )}

      {/* ── ALL SHIFTS (manager/owner) ── */}
      {(isOwner || isManager) && allShifts.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
            📋 {lang === "en" ? "Recent Shifts" : "Caisses récentes"}
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "en" ? "Cashier" : "Caissier"}</th>
                  <th>{lang === "en" ? "Date" : "Date"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Float" : "Fond"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Expected" : "Attendu"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Counted" : "Compté"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "en" ? "Difference" : "Différence"}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allShifts.map(shift => (
                  <tr key={shift.id}>
                    <td style={{ fontWeight: 500 }}>{shift.cashier_name}</td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{shift.shift_date}</td>
                    <td style={{ textAlign: "right" }}>{formatCFA(shift.opening_float)}</td>
                    <td style={{ textAlign: "right" }}>{shift.expected_cash ? formatCFA(shift.expected_cash) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{shift.actual_cash != null ? formatCFA(shift.actual_cash) : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: shift.difference != null ? getDiffColor(shift.difference) : "var(--text-muted)" }}>
                      {shift.difference != null ? getDiffLabel(shift.difference) : "—"}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: shift.status === "open" ? "rgba(16,185,129,0.15)" : "rgba(100,100,100,0.15)", color: shift.status === "open" ? "#34d399" : "var(--text-muted)", fontWeight: 600 }}>
                        {shift.status === "open" ? (lang === "en" ? "Open" : "Ouvert") : (lang === "en" ? "Closed" : "Fermé")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CLOSE SHIFT MODAL ── */}
      {showCloseModal && myShift && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 400, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
              🔒 {lang === "en" ? "Close Shift" : "Fermer la caisse"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
              {lang === "en" ? "Count your cash and enter the total below." : "Comptez votre caisse et entrez le total ci-dessous."}
            </div>

            <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--text-muted)" }}>{lang === "en" ? "Opening float:" : "Fond de caisse:"}</span>
                <strong>{formatCFA(myShift.opening_float)}</strong>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {lang === "en" ? "System will calculate expected cash from your sales." : "Le système calculera l'attendu à partir de vos ventes."}
              </div>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Actual cash counted (FCFA) *" : "Espèces comptées (FCFA) *"}</label>
              <input className="input" type="number" value={actualCash} onChange={e => setActualCash(e.target.value)}
                placeholder={lang === "en" ? "Count all cash in drawer" : "Compter tout l'argent dans la caisse"}
                autoFocus style={{ fontSize: 18, fontWeight: 700, textAlign: "center" }} />
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
              <input className="input" value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder={lang === "en" ? "Any comments about the shift" : "Commentaires sur la caisse"} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowCloseModal(false)}
                style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button onClick={() => closeMutation.mutate()} disabled={!actualCash || closeMutation.isPending}
                style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: "#ef4444", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                {closeMutation.isPending ? "..." : (lang === "en" ? "✓ Close & Send to Boss" : "✓ Fermer & Envoyer au patron")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
