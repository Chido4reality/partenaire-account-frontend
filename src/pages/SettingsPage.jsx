import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api from "../utils/api";

export default function SettingsPage() {
  const { lang } = useLangStore();
  const { user, org } = useAuthStore();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";

  const [form, setForm] = useState({
    name: "", phone: "", address: "", city: "", country: "Cameroun",
    whatsapp_number: "", receipt_footer: "", daily_summary_time: "17:30",
    daily_summary_enabled: true, low_stock_alerts_enabled: true
  });
  const [pinForm, setPinForm] = useState({ current_pin: "", new_pin: "", confirm_pin: "" });
  const [showPinSection, setShowPinSection] = useState(false);
  const [pinError, setPinError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });

  useEffect(() => {
    if (data?.data) {
      const d = data.data;
      setForm({
        name: d.name || "",
        phone: d.phone || "",
        address: d.address || "",
        city: d.city || "",
        country: d.country || "Cameroun",
        whatsapp_number: d.whatsapp_number || "",
        receipt_footer: d.receipt_footer || "",
        daily_summary_time: d.daily_summary_time || "17:30",
        daily_summary_enabled: d.daily_summary_enabled ?? true,
        low_stock_alerts_enabled: d.low_stock_alerts_enabled ?? true,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/settings", form),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Settings saved!" : "✓ Paramètres sauvegardés!");
      qc.invalidateQueries(["org-settings"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const pinMutation = useMutation({
    mutationFn: () => api.post("/settings/set-pin", { current_pin: pinForm.current_pin || null, new_pin: pinForm.new_pin }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ PIN updated!" : "✓ PIN mis à jour!");
      setPinForm({ current_pin: "", new_pin: "", confirm_pin: "" });
      setShowPinSection(false);
      setPinError("");
    },
    onError: (err) => setPinError(err.response?.data?.message || "Error")
  });

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handlePinSave = () => {
    if (pinForm.new_pin.length !== 4) { setPinError(lang === "en" ? "PIN must be exactly 4 digits" : "PIN doit être exactement 4 chiffres"); return; }
    if (pinForm.new_pin !== pinForm.confirm_pin) { setPinError(lang === "en" ? "PINs don't match" : "Les PIN ne correspondent pas"); return; }
    setPinError("");
    pinMutation.mutate();
  };

  if (!isOwner) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{lang === "en" ? "Owner access only" : "Accès propriétaire uniquement"}</div>
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">⚙️ {lang === "en" ? "Shop Settings" : "Paramètres boutique"}</h1>
          <div className="page-sub">{lang === "en" ? "Configure your shop information and preferences" : "Configurez les informations et préférences de votre boutique"}</div>
        </div>
      </div>

      {isLoading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── SHOP INFO ── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>🏪 {lang === "en" ? "Shop Information" : "Informations boutique"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Shop name" : "Nom de la boutique"} *</label>
                <input className="input" value={form.name} onChange={e => setF("name", e.target.value)} placeholder="Ex: Dozie Store" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label>
                <input className="input" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="6XXXXXXXX" />
              </div>
              <div className="form-group">
                <label className="label">WhatsApp {lang === "en" ? "(for boss alerts)" : "(pour alertes patron)"}</label>
                <input className="input" value={form.whatsapp_number} onChange={e => setF("whatsapp_number", e.target.value)} placeholder="237XXXXXXXXX" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
                <input className="input" value={form.address} onChange={e => setF("address", e.target.value)} placeholder="Ex: Bonaberri, Douala" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "City" : "Ville"}</label>
                <input className="input" value={form.city} onChange={e => setF("city", e.target.value)} placeholder="Douala" />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Receipt footer message" : "Message bas de reçu"}</label>
                <input className="input" value={form.receipt_footer} onChange={e => setF("receipt_footer", e.target.value)} placeholder={lang === "en" ? "Ex: Thank you for your business!" : "Ex: Merci pour votre confiance!"} />
              </div>
            </div>
          </div>

          {/* ── WHATSAPP ALERTS ── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>📱 {lang === "en" ? "WhatsApp Alerts" : "Alertes WhatsApp"}</div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Daily boss summary" : "Résumé quotidien patron"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Sent automatically every day" : "Envoyé automatiquement chaque jour"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={form.daily_summary_enabled} onChange={e => setF("daily_summary_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: form.daily_summary_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: form.daily_summary_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>

            {form.daily_summary_enabled && (
              <div className="form-group" style={{ maxWidth: 200 }}>
                <label className="label">{lang === "en" ? "Send time" : "Heure d'envoi"}</label>
                <input className="input" type="time" value={form.daily_summary_time} onChange={e => setF("daily_summary_time", e.target.value)} />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginTop: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Low stock alerts (per product)" : "Alertes stock bas (par produit)"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Toggle per product in Inventory" : "Activez par produit dans Inventaire"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={form.low_stock_alerts_enabled} onChange={e => setF("low_stock_alerts_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: form.low_stock_alerts_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: form.low_stock_alerts_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>
          </div>

          {/* ── OWNER PIN ── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showPinSection ? 20 : 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>🔐 {lang === "en" ? "Owner PIN" : "PIN propriétaire"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {lang === "en" ? "Used to override prices and approve voids/returns" : "Utilisé pour forcer les prix et approuver les annulations"}
                </div>
              </div>
              <button onClick={() => setShowPinSection(!showPinSection)}
                style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                {showPinSection ? (lang === "en" ? "Cancel" : "Annuler") : (lang === "en" ? "Set PIN" : "Définir PIN")}
              </button>
            </div>

            {showPinSection && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "Current PIN (if set)" : "PIN actuel (si défini)"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.current_pin} onChange={e => setPinForm(f => ({ ...f, current_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "New PIN (4 digits)" : "Nouveau PIN (4 chiffres)"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.new_pin} onChange={e => setPinForm(f => ({ ...f, new_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "Confirm PIN" : "Confirmer PIN"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.confirm_pin} onChange={e => setPinForm(f => ({ ...f, confirm_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                </div>
                {pinError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{pinError}</div>}
                <button onClick={handlePinSave} disabled={pinMutation.isPending}
                  className="btn btn-primary" style={{ minWidth: 160 }}>
                  {pinMutation.isPending ? "..." : (lang === "en" ? "Save PIN" : "Sauvegarder PIN")}
                </button>
              </div>
            )}
          </div>

          {/* ── SAVE BUTTON ── */}
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="btn btn-primary" style={{ height: 48, fontSize: 15, fontWeight: 700 }}>
            {saveMutation.isPending ? "..." : (lang === "en" ? "✓ Save Settings" : "✓ Sauvegarder")}
          </button>
        </div>
      )}
    </div>
  );
}
