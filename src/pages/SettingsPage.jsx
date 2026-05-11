import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import api from "../utils/api";

const ROLES = [
  { value: "cashier",   en: "Cashier",    fr: "Caissier",     color: "#94a3b8" },
  { value: "manager",   en: "Manager",    fr: "Gestionnaire", color: "#818cf8" },
  { value: "warehouse", en: "Warehouse",  fr: "Magasinier",   color: "#34d399" },
  { value: "owner",     en: "Owner",      fr: "Propriétaire", color: "#fbbf24" },
];

const roleStyle = (role) => {
  const r = ROLES.find(x => x.value === role);
  return { color: r?.color || "#94a3b8", bg: (r?.color || "#94a3b8") + "20" };
};

export default function SettingsPage() {
  const { user, org } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";

  const [tab, setTab] = useState("locations");

  // Location state
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [editLoc, setEditLoc]       = useState(null);
  const [locForm, setLocForm]       = useState({ name: "", type: "shop", address: "", phone: "" });

  // Staff state
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [editStaff, setEditStaff]       = useState(null);
  const [staffForm, setStaffForm]       = useState({ full_name: "", phone: "", password: "", role: "cashier" });

  // Shop settings state
  const [shopForm, setShopForm] = useState({
    name: "", phone: "", address: "", city: "", country: "Cameroun",
    whatsapp_number: "", receipt_footer: "", daily_summary_time: "17:30",
    daily_summary_enabled: true, low_stock_alerts_enabled: true
  });
  const [pinForm, setPinForm]     = useState({ current_pin: "", new_pin: "", confirm_pin: "" });
  const [showPinSection, setShowPinSection] = useState(false);
  const [pinError, setPinError]   = useState("");
  const [shopLoaded, setShopLoaded] = useState(false);

  // Dozie state
  const [dozieForm, setDozieForm] = useState({ dozie_pin: "", city: "Douala", shop_description: "" });

  // ── QUERIES ────────────────────────────────────────────────────────────────
  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get("/auth/staff").then(r => r.data),
    enabled: tab === "staff"
  });

  useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
    enabled: tab === "shop" && !shopLoaded,
    onSuccess: (data) => {
      if (data?.data && !shopLoaded) {
        const d = data.data;
        setShopForm({
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
        setShopLoaded(true);
      }
    }
  });

  // ── LOCATION MUTATIONS ─────────────────────────────────────────────────────
  const addLocMutation = useMutation({
    mutationFn: () => api.post("/locations", locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Location added!" : "Emplacement ajouté!");
      setShowAddLoc(false);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateLocMutation = useMutation({
    mutationFn: () => api.patch("/locations/" + editLoc.id, locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Updated!" : "Mis à jour!");
      setEditLoc(null);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── STAFF MUTATIONS ────────────────────────────────────────────────────────
  const addStaffMutation = useMutation({
    mutationFn: () => api.post("/auth/users", staffForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff member added!" : "Personnel ajouté!");
      setShowAddStaff(false);
      setStaffForm({ full_name: "", phone: "", password: "", role: "cashier" });
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateStaffMutation = useMutation({
    mutationFn: () => api.patch("/auth/users/" + editStaff.id, staffForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff updated!" : "Personnel mis à jour!");
      setEditStaff(null);
      setStaffForm({ full_name: "", phone: "", password: "", role: "cashier" });
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const deactivateStaffMutation = useMutation({
    mutationFn: (id) => api.delete("/auth/users/" + id),
    onSuccess: () => { toast.success(lang === "en" ? "Staff deactivated!" : "Personnel désactivé!"); qc.invalidateQueries(["staff"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const reactivateStaffMutation = useMutation({
    mutationFn: (id) => api.patch("/auth/users/" + id, { is_active: true }),
    onSuccess: () => { toast.success(lang === "en" ? "Staff reactivated!" : "Personnel réactivé!"); qc.invalidateQueries(["staff"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── SHOP SETTINGS MUTATIONS ────────────────────────────────────────────────
  const saveShopMutation = useMutation({
    mutationFn: () => api.patch("/settings", shopForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Settings saved!" : "✓ Paramètres sauvegardés!", { duration: 3000 });
      qc.invalidateQueries(["org-settings"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const pinMutation = useMutation({
    mutationFn: () => api.post("/settings/set-pin", { current_pin: pinForm.current_pin || null, new_pin: pinForm.new_pin }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ PIN updated!" : "✓ PIN mis à jour!");
      setPinForm({ current_pin: "", new_pin: "", confirm_pin: "" });
      setShowPinSection(false); setPinError("");
    },
    onError: (err) => setPinError(err.response?.data?.message || "Error")
  });

  const handlePinSave = () => {
    if (pinForm.new_pin.length !== 4) { setPinError(lang === "en" ? "PIN must be exactly 4 digits" : "PIN doit être exactement 4 chiffres"); return; }
    if (pinForm.new_pin !== pinForm.confirm_pin) { setPinError(lang === "en" ? "PINs don't match" : "Les PIN ne correspondent pas"); return; }
    setPinError(""); pinMutation.mutate();
  };

  // ── DOZIE QUERIES & MUTATIONS ─────────────────────────────────────────────
  const { data: dozieStatusData, isLoading: dozieLoading } = useQuery({
    queryKey: ["dozie-status"],
    queryFn: () => api.get("/dozie/status").then(r => r.data),
    enabled: tab === "dozie" && isOwner
  });
  const dozieStatus = dozieStatusData?.data;

  const activateDozieMutation = useMutation({
    mutationFn: () => api.post("/dozie/activate", dozieForm),
    onSuccess: (res) => {
      toast.success(lang === "en" ? "✓ Linked to Partenaire Dozie!" : "✓ Lié à Partenaire Dozie!");
      qc.invalidateQueries(["dozie-status"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const locations = locData?.data || [];
  const staff = staffData?.data || [];
  const activeStaff = staff.filter(s => s.is_active);
  const inactiveStaff = staff.filter(s => !s.is_active);

  const openEdit = (loc) => { setEditLoc(loc); setLocForm({ name: loc.name, type: loc.type, address: loc.address || "", phone: loc.phone || "" }); };
  const openEditStaff = (s) => { setEditStaff(s); setStaffForm({ full_name: s.full_name, phone: s.phone, password: "", role: s.role }); };
  const setLF = (k, v) => setLocForm(f => ({ ...f, [k]: v }));
  const setSF = (k, v) => setStaffForm(f => ({ ...f, [k]: v }));
  const setFF = (k, v) => setShopForm(f => ({ ...f, [k]: v }));

  const TABS = [
    { key: "locations", en: "Warehouses & Shops", fr: "Magasins & Boutiques" },
    { key: "staff",     en: "Staff",              fr: "Personnel" },
    { key: "shop",      en: "Shop Settings",      fr: "Paramètres boutique", ownerOnly: true },
    { key: "account",   en: "Account",            fr: "Compte" },
    { key: "dozie",     en: "Partenaire Dozie",   fr: "Partenaire Dozie",    ownerOnly: true },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Settings" : "Paramètres"}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {TABS.filter(tb => !tb.ownerOnly || isOwner).map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {/* ══ LOCATIONS TAB ══════════════════════════════════════════════════════ */}
      {tab === "locations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{lang === "en" ? "Your Warehouses & Shops" : "Vos Magasins & Boutiques"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{lang === "en" ? "Manage your selling locations and warehouses" : "Gérez vos emplacements de vente et entrepôts"}</div>
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => setShowAddLoc(true)}>+ {lang === "en" ? "Add location" : "Ajouter emplacement"}</button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {locations.map(loc => {
              const isActive = selectedLocation?.id === loc.id;
              return (
                <div key={loc.id} style={{ background: "var(--bg-card)", border: `1px solid ${isActive ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: loc.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {loc.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{loc.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                      <span style={{ background: loc.type === "warehouse" ? "rgba(79,70,229,0.12)" : "rgba(16,185,129,0.12)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399", padding: "1px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{loc.type}</span>
                      {loc.address && <span>{loc.address}</span>}
                      {loc.phone && <span>{loc.phone}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {isActive ? (
                      <span style={{ fontSize: 11, background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>✓ {lang === "en" ? "Active" : "Actif"}</span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => setLocation(loc)}>
                        {lang === "en" ? "Set active" : "Activer"}
                      </button>
                    )}
                    {isOwner && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(loc)}>
                        {lang === "en" ? "Edit" : "Modifier"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ STAFF TAB ══════════════════════════════════════════════════════════ */}
      {tab === "staff" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{lang === "en" ? "Staff Members" : "Membres du personnel"}</div>
            {(isOwner || user?.role === "manager") && (
              <button className="btn btn-primary" onClick={() => setShowAddStaff(true)}>+ {lang === "en" ? "Add staff" : "Ajouter"}</button>
            )}
          </div>

          {staffLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeStaff.map(s => {
                const rs = roleStyle(s.role);
                return (
                  <div key={s.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: rs.bg, color: rs.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                      {s.full_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.full_name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.phone}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 12, background: rs.bg, color: rs.color, fontWeight: 600 }}>
                        {ROLES.find(r => r.value === s.role)?.[lang === "en" ? "en" : "fr"] || s.role}
                      </span>
                      {(isOwner || user?.role === "manager") && s.id !== user?.id && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditStaff(s)}>
                            {lang === "en" ? "Edit" : "Modifier"}
                          </button>
                          <button onClick={() => deactivateStaffMutation.mutate(s.id)}
                            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                            {lang === "en" ? "Deactivate" : "Désactiver"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {inactiveStaff.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {lang === "en" ? "Inactive" : "Inactifs"}
                  </div>
                  {inactiveStaff.map(s => {
                    const rs = roleStyle(s.role);
                    return (
                      <div key={s.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, opacity: 0.6, marginBottom: 8 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: rs.bg, color: rs.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                          {s.full_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{s.full_name}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.phone}</div>
                        </div>
                        {isOwner && (
                          <button onClick={() => reactivateStaffMutation.mutate(s.id)}
                            style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                            ✅ {lang === "en" ? "Reactivate" : "Réactiver"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {staff.length === 0 && (
                <div className="empty-state">
                  <div style={{ fontWeight: 600 }}>{lang === "en" ? "No staff members yet" : "Aucun personnel"}</div>
                </div>
              )}
            </div>
          )}

          {/* Role info box */}
          <div style={{ marginTop: 20, padding: 16, background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 12, fontSize: 13, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{lang === "en" ? "Staff roles:" : "Rôles du personnel:"}</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {ROLES.filter(r => r.value !== "owner").map(r => (
                <div key={r.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: r.color + "20", color: r.color, fontWeight: 600, minWidth: 80, textAlign: "center" }}>{lang === "en" ? r.en : r.fr}</span>
                  <span style={{ fontSize: 12 }}>
                    {r.value === "cashier" && (lang === "en" ? "POS sales only, no inventory access" : "Ventes POS uniquement, pas d'accès inventaire")}
                    {r.value === "manager" && (lang === "en" ? "Sales + inventory + staff management" : "Ventes + inventaire + gestion personnel")}
                    {r.value === "warehouse" && (lang === "en" ? "Stock management only, no prices visible" : "Gestion du stock uniquement, prix masqués")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ SHOP SETTINGS TAB (owner only) ════════════════════════════════════ */}
      {tab === "shop" && isOwner && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Shop Info */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>🏪 {lang === "en" ? "Shop Information" : "Informations boutique"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Shop name" : "Nom de la boutique"} *</label>
                <input className="input" value={shopForm.name} onChange={e => setFF("name", e.target.value)} placeholder="Ex: Dozie Store" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label>
                <input className="input" value={shopForm.phone} onChange={e => setFF("phone", e.target.value)} placeholder="6XXXXXXXX" />
              </div>
              <div className="form-group">
                <label className="label">WhatsApp {lang === "en" ? "(boss alerts)" : "(alertes patron)"}</label>
                <input className="input" value={shopForm.whatsapp_number} onChange={e => setFF("whatsapp_number", e.target.value)} placeholder="237XXXXXXXXX" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
                <input className="input" value={shopForm.address} onChange={e => setFF("address", e.target.value)} placeholder="Ex: Nouvelle route, Bonaberri" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "City" : "Ville"}</label>
                <input className="input" value={shopForm.city} onChange={e => setFF("city", e.target.value)} placeholder="Douala" />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Receipt footer" : "Message bas de reçu"}</label>
                <input className="input" value={shopForm.receipt_footer} onChange={e => setFF("receipt_footer", e.target.value)} placeholder={lang === "en" ? "Thank you for your business!" : "Merci pour votre confiance!"} />
              </div>
            </div>
          </div>

          {/* WhatsApp Alerts */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>📱 {lang === "en" ? "WhatsApp Alerts" : "Alertes WhatsApp"}</div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Daily boss summary" : "Résumé quotidien patron"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Sent automatically every day" : "Envoyé automatiquement chaque jour"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={shopForm.daily_summary_enabled} onChange={e => setFF("daily_summary_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.daily_summary_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.daily_summary_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>

            {shopForm.daily_summary_enabled && (
              <div className="form-group" style={{ maxWidth: 200, marginBottom: 12 }}>
                <label className="label">{lang === "en" ? "Send time" : "Heure d'envoi"}</label>
                <input className="input" type="time" value={shopForm.daily_summary_time} onChange={e => setFF("daily_summary_time", e.target.value)} />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Low stock alerts" : "Alertes stock bas"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Toggle per product in Inventory" : "Activez par produit dans Inventaire"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={shopForm.low_stock_alerts_enabled} onChange={e => setFF("low_stock_alerts_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.low_stock_alerts_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.low_stock_alerts_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>
          </div>

          {/* Owner PIN */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showPinSection ? 20 : 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>🔐 {lang === "en" ? "Owner PIN" : "PIN propriétaire"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {lang === "en" ? "Override prices and approve voids/returns" : "Forcer les prix et approuver les annulations"}
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
                    <label className="label">{lang === "en" ? "Current PIN" : "PIN actuel"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.current_pin} onChange={e => setPinForm(f => ({ ...f, current_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "New PIN" : "Nouveau PIN"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.new_pin} onChange={e => setPinForm(f => ({ ...f, new_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "Confirm PIN" : "Confirmer"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.confirm_pin} onChange={e => setPinForm(f => ({ ...f, confirm_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                </div>
                {pinError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{pinError}</div>}
                <button onClick={handlePinSave} disabled={pinMutation.isPending} className="btn btn-primary" style={{ minWidth: 160 }}>
                  {pinMutation.isPending ? "..." : (lang === "en" ? "Save PIN" : "Sauvegarder PIN")}
                </button>
              </div>
            )}
          </div>

          {/* Save button */}
          <button onClick={() => saveShopMutation.mutate()} disabled={saveShopMutation.isPending}
            className="btn btn-primary" style={{ height: 48, fontSize: 15, fontWeight: 700 }}>
            {saveShopMutation.isPending ? "..." : (lang === "en" ? "✓ Save Settings" : "✓ Sauvegarder")}
          </button>
        </div>
      )}

      {/* ══ ACCOUNT TAB ════════════════════════════════════════════════════════ */}
      {tab === "account" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>{lang === "en" ? "Account Information" : "Informations du compte"}</div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: lang === "en" ? "Business name" : "Nom de la boutique", value: org?.name },
              { label: lang === "en" ? "Your name" : "Votre nom", value: user?.full_name },
              { label: lang === "en" ? "Phone" : "Téléphone", value: user?.phone },
              { label: "Role", value: ROLES.find(r => r.value === user?.role)?.[lang === "en" ? "en" : "fr"] || user?.role },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{item.label}</span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={() => setLang(lang === "en" ? "fr" : "en")}>
              🌐 {lang === "en" ? "Switch to Français" : "Switch to English"}
            </button>
          </div>
        </div>
      )}

      {/* ══ PARTENAIRE DOZIE TAB ══════════════════════════════════════════════ */}
      {tab === "dozie" && (
        <div>
          <div style={{ background: "linear-gradient(135deg, rgba(201,168,76,0.12), rgba(26,43,74,0.3))", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 32 }}>✦</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Partenaire Dozie</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {lang === "en" ? "Wholesale & B2B marketplace" : "Marché de gros & B2B"}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {lang === "en"
                ? "Connect your Mon Partenaire account to Partenaire Dozie. Your products will be listed for wholesale buyers, and you can log in to Dozie using your phone number."
                : "Connectez votre compte Mon Partenaire à Partenaire Dozie. Vos produits seront listés pour les acheteurs en gros, et vous pourrez vous connecter à Dozie avec votre numéro de téléphone."}
            </div>
          </div>

          {dozieLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          ) : dozieStatus?.activated ? (
            <div style={{ background: "var(--bg-card)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 16, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 28 }}>✅</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{lang === "en" ? "Connected to Partenaire Dozie" : "Connecté à Partenaire Dozie"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {lang === "en" ? "Your shop is live on the marketplace" : "Votre boutique est en ligne sur le marché"}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{lang === "en" ? "Dozie Seller ID" : "ID Vendeur Dozie"}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{dozieStatus.identity?.ptn_user_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{lang === "en" ? "Linked at" : "Lié le"}</span>
                  <span style={{ fontSize: 13 }}>{dozieStatus.identity?.linked_at ? new Date(dozieStatus.identity.linked_at).toLocaleDateString() : "—"}</span>
                </div>
              </div>
              <div style={{ marginTop: 16, background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 10, padding: 12, fontSize: 12, color: "var(--brand-light)" }}>
                💡 {lang === "en"
                  ? "Log in to Partenaire Dozie using your registered phone number and the Dozie PIN you set during activation."
                  : "Connectez-vous à Partenaire Dozie avec votre numéro de téléphone et le code PIN Dozie défini lors de l'activation."}
              </div>
            </div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{lang === "en" ? "Activate Partenaire Dozie" : "Activer Partenaire Dozie"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
                {lang === "en" ? "This will create your seller profile and list your products on the wholesale marketplace." : "Cela créera votre profil vendeur et listera vos produits sur le marché de gros."}
              </div>

              <div className="form-group">
                <label className="label">{lang === "en" ? "City" : "Ville"}</label>
                <select className="input" value={dozieForm.city} onChange={e => setDozieForm(f => ({ ...f, city: e.target.value }))}>
                  {["Douala","Yaoundé","Bafoussam","Garoua","Maroua","Bertoua","Ebolowa"].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="label">{lang === "en" ? "Shop description (optional)" : "Description boutique (optionnel)"}</label>
                <textarea className="input" rows={3} value={dozieForm.shop_description}
                  onChange={e => setDozieForm(f => ({ ...f, shop_description: e.target.value }))}
                  placeholder={lang === "en" ? "Tell buyers what you sell..." : "Dites aux acheteurs ce que vous vendez..."} />
              </div>

              <div className="form-group">
                <label className="label">{lang === "en" ? "Choose a Dozie PIN (4 digits)" : "Choisir un code PIN Dozie (4 chiffres)"}</label>
                <input className="input" type="password" inputMode="numeric" maxLength={4}
                  value={dozieForm.dozie_pin} onChange={e => setDozieForm(f => ({ ...f, dozie_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  placeholder="e.g. 1234" />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en" ? "You will use this PIN to log in to Partenaire Dozie" : "Vous utiliserez ce PIN pour vous connecter à Partenaire Dozie"}
                </div>
              </div>

              <button className="btn btn-primary" style={{ width: "100%", height: 46, marginTop: 8 }}
                disabled={dozieForm.dozie_pin.length !== 4 || activateDozieMutation.isPending}
                onClick={() => activateDozieMutation.mutate()}>
                {activateDozieMutation.isPending ? "..." : (lang === "en" ? "✦ Activate Partenaire Dozie" : "✦ Activer Partenaire Dozie")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ LOCATION MODAL ═════════════════════════════════════════════════════ */}
      {(showAddLoc || editLoc) && (
        <div className="modal-overlay" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {editLoc ? (lang === "en" ? "Edit Location" : "Modifier l'emplacement") : (lang === "en" ? "Add New Location" : "Ajouter un emplacement")}
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Name" : "Nom"} *</label>
              <input className="input" value={locForm.name} onChange={e => setLF("name", e.target.value)} placeholder="Ex: Boutique Akwa..." />
            </div>
            <div className="form-group"><label className="label">Type</label>
              <select className="input" value={locForm.type} onChange={e => setLF("type", e.target.value)}>
                <option value="warehouse">{lang === "en" ? "Warehouse (stock storage)" : "Magasin (stockage)"}</option>
                <option value="shop">{lang === "en" ? "Shop (selling point)" : "Boutique (point de vente)"}</option>
              </select>
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={locForm.address} onChange={e => setLF("address", e.target.value)} placeholder="Ex: Rue Joss, Douala" />
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label>
              <input className="input" value={locForm.phone} onChange={e => setLF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!locForm.name || addLocMutation.isPending || updateLocMutation.isPending}
                onClick={() => editLoc ? updateLocMutation.mutate() : addLocMutation.mutate()}>
                {(addLocMutation.isPending || updateLocMutation.isPending) ? "..." : (lang === "en" ? "Save" : "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ STAFF MODAL ════════════════════════════════════════════════════════ */}
      {(showAddStaff || editStaff) && (
        <div className="modal-overlay" onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {editStaff ? (lang === "en" ? "Edit Staff Member" : "Modifier le personnel") : (lang === "en" ? "Add Staff Member" : "Ajouter un membre")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              {lang === "en" ? "Staff log in with their phone number and password" : "Le personnel se connecte avec son téléphone et mot de passe"}
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={staffForm.full_name} onChange={e => setSF("full_name", e.target.value)} placeholder="Jean Dupont" />
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone number" : "Téléphone"} *</label>
              <input className="input" value={staffForm.phone} onChange={e => setSF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{editStaff ? (lang === "en" ? "New password (blank = keep)" : "Nouveau mot de passe (vide = garder)") : (lang === "en" ? "Password *" : "Mot de passe *")}</label>
              <input className="input" type="password" value={staffForm.password} onChange={e => setSF("password", e.target.value)} placeholder={editStaff ? (lang === "en" ? "Leave blank to keep" : "Laisser vide pour garder") : "Min 6 caractères"} />
            </div>
            <div className="form-group"><label className="label">Role</label>
              <select className="input" value={staffForm.role} onChange={e => setSF("role", e.target.value)}>
                {ROLES.filter(r => r.value !== "owner").map(r => (
                  <option key={r.value} value={r.value}>{lang === "en" ? r.en : r.fr}</option>
                ))}
              </select>
            </div>
            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--text-muted)" }}>
              {staffForm.role === "cashier" && (lang === "en" ? "✓ Can: make sales, view own sales" : "✓ Peut: faire des ventes, voir ses propres ventes")}
              {staffForm.role === "manager" && (lang === "en" ? "✓ Can: all sales + inventory + add staff" : "✓ Peut: ventes + inventaire + ajouter personnel")}
              {staffForm.role === "warehouse" && (lang === "en" ? "✓ Can: receive goods, adjust stock" : "✓ Peut: réceptionner, ajuster le stock")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!staffForm.full_name || !staffForm.phone || (!editStaff && !staffForm.password) || addStaffMutation.isPending || updateStaffMutation.isPending}
                onClick={() => editStaff ? updateStaffMutation.mutate() : addStaffMutation.mutate()}>
                {(addStaffMutation.isPending || updateStaffMutation.isPending) ? "..." : (editStaff ? (lang === "en" ? "Save changes" : "Enregistrer") : (lang === "en" ? "Add staff member" : "Ajouter"))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
