import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import api from "../utils/api";

const ROLES = [
  { value: "cashier",   en: "Cashier",        fr: "Caissier",      color: "#94a3b8" },
  { value: "manager",   en: "Manager",         fr: "Gestionnaire",  color: "#818cf8" },
  { value: "warehouse", en: "Warehouse",       fr: "Magasinier",    color: "#34d399" },
  { value: "owner",     en: "Owner",           fr: "Propriétaire",  color: "#fbbf24" },
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

  const [tab, setTab]           = useState("locations");
  const [showAddLoc, setShowAddLoc]   = useState(false);
  const [editLoc, setEditLoc]         = useState(null);
  const [locForm, setLocForm]         = useState({ name: "", type: "shop", address: "", phone: "" });
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [editStaff, setEditStaff]     = useState(null);
  const [staffForm, setStaffForm]     = useState({ full_name: "", phone: "", password: "", role: "cashier" });

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get("/auth/staff").then(r => r.data),
    enabled: tab === "staff"
  });

  // ── LOCATION MUTATIONS ─────────────────────────────────────
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

  // ── STAFF MUTATIONS ────────────────────────────────────────
  const addStaffMutation = useMutation({
    mutationFn: () => api.post("/auth/users", staffForm),
    onSuccess: (res) => {
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
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff deactivated!" : "Personnel désactivé!");
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const reactivateStaffMutation = useMutation({
    mutationFn: (id) => api.patch("/auth/users/" + id, { is_active: true }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff reactivated!" : "Personnel réactivé!");
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const locations = locData?.data || [];
  const staff = staffData?.data || [];
  const activeStaff = staff.filter(s => s.is_active);
  const inactiveStaff = staff.filter(s => !s.is_active);

  const openEdit = (loc) => {
    setEditLoc(loc);
    setLocForm({ name: loc.name, type: loc.type, address: loc.address || "", phone: loc.phone || "" });
  };

  const openEditStaff = (s) => {
    setEditStaff(s);
    setStaffForm({ full_name: s.full_name, phone: s.phone, password: "", role: s.role });
  };

  const setLF = (k, v) => setLocForm(f => ({ ...f, [k]: v }));
  const setSF = (k, v) => setStaffForm(f => ({ ...f, [k]: v }));

  const TABS = [
    { key: "locations", en: "Warehouses & Shops", fr: "Magasins & Boutiques" },
    { key: "staff",     en: "Staff",              fr: "Personnel" },
    { key: "account",   en: "Account",            fr: "Compte" },
  ];

  const isOwner = user?.role === "owner";

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Settings" : "Paramètres"}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {/* ══ LOCATIONS TAB ══════════════════════════════════════ */}
      {tab === "locations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{lang === "en" ? "Your Warehouses & Shops" : "Vos Magasins & Boutiques"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{lang === "en" ? "Manage your selling locations and warehouses" : "Gérez vos emplacements"}</div>
            </div>
            <button className="btn btn-primary" onClick={() => { setShowAddLoc(true); setEditLoc(null); setLocForm({ name: "", type: "shop", address: "", phone: "" }); }}>
              + {lang === "en" ? "Add location" : "Ajouter"}
            </button>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {locations.map(loc => (
              <div key={loc.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, background: loc.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>
                    {loc.type === "warehouse" ? "W" : "S"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{loc.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 11, background: loc.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>
                        {loc.type === "warehouse" ? (lang === "en" ? "Warehouse" : "Magasin") : (lang === "en" ? "Shop" : "Boutique")}
                      </span>
                      {loc.address && <span>{loc.address}</span>}
                      {loc.phone && <span>{loc.phone}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {selectedLocation?.id === loc.id ? (
                    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "#34d399" }}>{lang === "en" ? "Active" : "Actif"}</span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => setLocation(loc)}>{lang === "en" ? "Set active" : "Activer"}</button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(loc)}>{lang === "en" ? "Edit" : "Modifier"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ STAFF TAB ══════════════════════════════════════════ */}
      {tab === "staff" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{lang === "en" ? "Staff Members" : "Membres du personnel"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en" ? `${activeStaff.length} active member${activeStaff.length !== 1 ? "s" : ""}` : `${activeStaff.length} membre${activeStaff.length !== 1 ? "s" : ""} actif${activeStaff.length !== 1 ? "s" : ""}`}
              </div>
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => { setShowAddStaff(true); setEditStaff(null); setStaffForm({ full_name: "", phone: "", password: "", role: "cashier" }); }}>
                + {lang === "en" ? "Add staff" : "Ajouter personnel"}
              </button>
            )}
          </div>

          {staffLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {staff.map(s => {
                const rc = roleStyle(s.role);
                const isMe = s.id === user?.id;
                const lastLogin = s.last_login ? new Date(s.last_login).toLocaleDateString("fr-FR") : null;
                return (
                  <div key={s.id} style={{ background: "var(--bg-card)", border: `1px solid ${!s.is_active ? "rgba(239,68,68,0.2)" : "var(--border)"}`, borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: s.is_active ? 1 : 0.6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: rc.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: rc.color, flexShrink: 0 }}>
                        {s.full_name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                          {s.full_name}
                          {isMe && <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>(you)</span>}
                          {!s.is_active && <span style={{ fontSize: 10, color: "#f87171", fontWeight: 600 }}>INACTIVE</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 10 }}>
                          <span>{s.phone}</span>
                          {lastLogin && <span>{lang === "en" ? "Last login:" : "Dernière connexion:"} {lastLogin}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: rc.bg, color: rc.color, fontWeight: 600 }}>
                        {lang === "en" ? ROLES.find(r => r.value === s.role)?.en : ROLES.find(r => r.value === s.role)?.fr}
                      </span>
                      {isOwner && !isMe && s.role !== "owner" && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditStaff(s)}>
                            ✏️ {lang === "en" ? "Edit" : "Modifier"}
                          </button>
                          {s.is_active ? (
                            <button className="btn btn-sm" onClick={() => { if (window.confirm(`Deactivate ${s.full_name}?`)) deactivateStaffMutation.mutate(s.id); }}
                              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                              🚫 {lang === "en" ? "Deactivate" : "Désactiver"}
                            </button>
                          ) : (
                            <button className="btn btn-sm" onClick={() => reactivateStaffMutation.mutate(s.id)}
                              style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                              ✅ {lang === "en" ? "Reactivate" : "Réactiver"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info box */}
          <div style={{ marginTop: 20, padding: 16, background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 12, fontSize: 13, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{lang === "en" ? "Staff roles:" : "Rôles du personnel:"}</strong><br /><br />
            <div style={{ display: "grid", gap: 6 }}>
              {ROLES.filter(r => r.value !== "owner").map(r => (
                <div key={r.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: r.color + "20", color: r.color, fontWeight: 600, minWidth: 70, textAlign: "center" }}>{lang === "en" ? r.en : r.fr}</span>
                  <span style={{ fontSize: 12 }}>
                    {r.value === "cashier" && (lang === "en" ? "POS sales only" : "Ventes POS uniquement")}
                    {r.value === "manager" && (lang === "en" ? "Sales + inventory + staff" : "Ventes + inventaire + personnel")}
                    {r.value === "warehouse" && (lang === "en" ? "Stock management only" : "Gestion du stock uniquement")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ ACCOUNT TAB ════════════════════════════════════════ */}
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

      {/* ══ LOCATION MODAL ═════════════════════════════════════ */}
      {(showAddLoc || editLoc) && (
        <div className="modal-overlay" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {editLoc ? (lang === "en" ? "Edit Location" : "Modifier l'emplacement") : (lang === "en" ? "Add New Location" : "Ajouter un emplacement")}
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Name" : "Nom"} *</label><input className="input" value={locForm.name} onChange={e => setLF("name", e.target.value)} placeholder="Ex: Boutique Akwa, Magasin Bonanjo..." /></div>
            <div className="form-group"><label className="label">Type</label>
              <select className="input" value={locForm.type} onChange={e => setLF("type", e.target.value)}>
                <option value="warehouse">{lang === "en" ? "Warehouse (stock storage)" : "Magasin (stockage)"}</option>
                <option value="shop">{lang === "en" ? "Shop (selling point)" : "Boutique (point de vente)"}</option>
              </select>
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Address" : "Adresse"}</label><input className="input" value={locForm.address} onChange={e => setLF("address", e.target.value)} placeholder="Ex: Rue Joss, Douala" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label><input className="input" value={locForm.phone} onChange={e => setLF("phone", e.target.value)} placeholder="6XXXXXXXX" /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!locForm.name || addLocMutation.isPending || updateLocMutation.isPending} onClick={() => editLoc ? updateLocMutation.mutate() : addLocMutation.mutate()}>
                {(addLocMutation.isPending || updateLocMutation.isPending) ? "..." : (lang === "en" ? "Save" : "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD/EDIT STAFF MODAL ════════════════════════════════ */}
      {(showAddStaff || editStaff) && (
        <div className="modal-overlay" onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {editStaff ? (lang === "en" ? "Edit Staff Member" : "Modifier le personnel") : (lang === "en" ? "Add Staff Member" : "Ajouter un membre")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              {lang === "en" ? "Staff log in with their phone number and password" : "Le personnel se connecte avec son téléphone et mot de passe"}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={staffForm.full_name} onChange={e => setSF("full_name", e.target.value)} placeholder="Jean Dupont" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone number" : "Téléphone"} *</label>
              <input className="input" value={staffForm.phone} onChange={e => setSF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">
                {editStaff ? (lang === "en" ? "New password (leave blank to keep)" : "Nouveau mot de passe (vide = inchangé)") : (lang === "en" ? "Password" : "Mot de passe")} {!editStaff && "*"}
              </label>
              <input className="input" type="password" value={staffForm.password} onChange={e => setSF("password", e.target.value)} placeholder={editStaff ? (lang === "en" ? "Leave blank to keep current" : "Laisser vide pour garder") : "Min 6 caractères"} />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
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
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
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
