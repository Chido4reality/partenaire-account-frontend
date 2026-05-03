import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import api from "../utils/api";

const ROLES = [
  { value: "cashier",   en: "Cashier",           fr: "Caissier" },
  { value: "manager",   en: "Manager",            fr: "Gestionnaire" },
  { value: "warehouse", en: "Warehouse staff",    fr: "Magasinier" },
];

export default function SettingsPage() {
  const { user, org } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [tab, setTab] = useState("locations");
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [editLoc, setEditLoc] = useState(null);
  const [locForm, setLocForm] = useState({ name: "", type: "shop", address: "", phone: "" });
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffForm, setStaffForm] = useState({ full_name: "", phone: "", password: "", role: "cashier" });

  const { data: locData } = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data) });
  const { data: staffData } = useQuery({ queryKey: ["staff"], queryFn: () => api.get("/auth/staff").then(r => r.data), enabled: tab === "staff" });

  const addLocMutation = useMutation({
    mutationFn: () => api.post("/locations", locForm),
    onSuccess: () => { toast.success(lang === "en" ? "Location added!" : "Emplacement ajoute!"); setShowAddLoc(false); setLocForm({ name: "", type: "shop", address: "", phone: "" }); qc.invalidateQueries(["locations"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateLocMutation = useMutation({
    mutationFn: () => api.patch("/locations/" + editLoc.id, locForm),
    onSuccess: () => { toast.success(lang === "en" ? "Updated!" : "Mis a jour!"); setEditLoc(null); setLocForm({ name: "", type: "shop", address: "", phone: "" }); qc.invalidateQueries(["locations"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const addStaffMutation = useMutation({
    mutationFn: () => api.post("/auth/users", staffForm),
    onSuccess: () => { toast.success(lang === "en" ? "Staff member added!" : "Personnel ajoute!"); setShowAddStaff(false); setStaffForm({ full_name: "", phone: "", password: "", role: "cashier" }); qc.invalidateQueries(["staff"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const locations = locData?.data || [];
  const staff = staffData?.data || [];

  const openEdit = (loc) => { setEditLoc(loc); setLocForm({ name: loc.name, type: loc.type, address: loc.address || "", phone: loc.phone || "" }); };
  const setLF = (k, v) => setLocForm(f => ({ ...f, [k]: v }));
  const setSF = (k, v) => setStaffForm(f => ({ ...f, [k]: v }));

  const TABS = [
    { key: "locations", en: "Warehouses & Shops", fr: "Magasins & Boutiques" },
    { key: "staff",     en: "Staff",              fr: "Personnel" },
    { key: "account",   en: "Account",            fr: "Compte" },
  ];

  const roleColor = (role) => {
    if (role === "owner")   return { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" };
    if (role === "manager") return { bg: "rgba(79,70,229,0.15)",   color: "var(--brand-light)" };
    if (role === "warehouse") return { bg: "rgba(16,185,129,0.15)", color: "#34d399" };
    return { bg: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" };
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Settings" : "Parametres"}</h1>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {tab === "locations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{lang === "en" ? "Your Warehouses & Shops" : "Vos Magasins & Boutiques"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{lang === "en" ? "Rename or add new locations" : "Renommez ou ajoutez des emplacements"}</div>
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
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      <span style={{ padding: "1px 8px", borderRadius: 10, fontSize: 11, background: loc.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399" }}>
                        {loc.type === "warehouse" ? (lang === "en" ? "Warehouse" : "Magasin") : (lang === "en" ? "Shop" : "Boutique")}
                      </span>
                      {loc.address && <span style={{ marginLeft: 8 }}>{loc.address}</span>}
                      {loc.phone && <span style={{ marginLeft: 8 }}>{loc.phone}</span>}
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

      {tab === "staff" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{lang === "en" ? "Staff Members" : "Membres du personnel"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en" ? "Each staff member logs in with their own phone number and password" : "Chaque membre se connecte avec son propre telephone et mot de passe"}
              </div>
            </div>
            {user?.role === "owner" && (
              <button className="btn btn-primary" onClick={() => setShowAddStaff(true)}>
                + {lang === "en" ? "Add staff" : "Ajouter personnel"}
              </button>
            )}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {staff.map ? staff.map(s => {
              const rc = roleColor(s.role);
              return (
                <div key={s.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(79,70,229,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: "var(--brand-light)" }}>
                      {s.full_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.full_name} {s.id === user?.id && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(you)</span>}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.phone}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: rc.bg, color: rc.color }}>{s.role}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.is_active ? (lang === "en" ? "Active" : "Actif") : (lang === "en" ? "Inactive" : "Inactif")}</span>
                  </div>
                </div>
              );
            }) : (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
                {lang === "en" ? "Loading staff..." : "Chargement..."}
              </div>
            )}
          </div>

          <div style={{ marginTop: 20, padding: 16, background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.2)", borderRadius: 12, fontSize: 13, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{lang === "en" ? "How it works:" : "Comment ca marche:"}</strong><br />
            {lang === "en"
              ? "Each staff member downloads the app and logs in with their phone number and password. They can work simultaneously from different locations. All their sales are tracked and attributed to them."
              : "Chaque membre telecharge l application et se connecte avec son telephone et mot de passe. Ils peuvent travailler simultanement depuis differents emplacements."}
          </div>
        </div>
      )}

      {tab === "account" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>{lang === "en" ? "Account Information" : "Informations du compte"}</div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: lang === "en" ? "Business name" : "Nom de la boutique", value: org?.name },
              { label: lang === "en" ? "Your name" : "Votre nom", value: user?.full_name },
              { label: lang === "en" ? "Phone" : "Telephone", value: user?.phone },
              { label: lang === "en" ? "Role" : "Role", value: user?.role },
              { label: lang === "en" ? "Language" : "Langue", value: lang === "en" ? "English" : "Francais" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{item.label}</span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={() => setLang(lang === "en" ? "fr" : "en")}>
              {lang === "en" ? "Switch to Francais" : "Switch to English"}
            </button>
          </div>
        </div>
      )}

      {(showAddLoc || editLoc) && (
        <div className="modal-overlay" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{editLoc ? (lang === "en" ? "Edit Location" : "Modifier") : (lang === "en" ? "Add New Location" : "Ajouter un emplacement")}</div>
            <div className="form-group"><label className="label">{lang === "en" ? "Name" : "Nom"} *</label><input className="input" value={locForm.name} onChange={e => setLF("name", e.target.value)} placeholder={lang === "en" ? "e.g. Main Warehouse, Akwa Shop..." : "Ex: Magasin Akwa, Boutique Bonanjo..."} /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Type" : "Type"}</label><select className="input" value={locForm.type} onChange={e => setLF("type", e.target.value)}><option value="warehouse">{lang === "en" ? "Warehouse (stock storage)" : "Magasin (stockage)"}</option><option value="shop">{lang === "en" ? "Shop (selling point)" : "Boutique (point de vente)"}</option></select></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Address" : "Adresse"}</label><input className="input" value={locForm.address} onChange={e => setLF("address", e.target.value)} placeholder="Ex: Rue Joss, Douala" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone" : "Telephone"}</label><input className="input" value={locForm.phone} onChange={e => setLF("phone", e.target.value)} placeholder="6XXXXXXXX" /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!locForm.name || addLocMutation.isPending || updateLocMutation.isPending} onClick={() => editLoc ? updateLocMutation.mutate() : addLocMutation.mutate()}>{(addLocMutation.isPending || updateLocMutation.isPending) ? "..." : (lang === "en" ? "Save" : "Enregistrer")}</button>
            </div>
          </div>
        </div>
      )}

      {showAddStaff && (
        <div className="modal-overlay" onClick={() => setShowAddStaff(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{lang === "en" ? "Add Staff Member" : "Ajouter un membre"}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>{lang === "en" ? "They will log in with their phone number and password" : "Ils se connecteront avec leur telephone et mot de passe"}</div>
            <div className="form-group"><label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label><input className="input" value={staffForm.full_name} onChange={e => setSF("full_name", e.target.value)} placeholder="Jean Dupont" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone number" : "Telephone"} *</label><input className="input" value={staffForm.phone} onChange={e => setSF("phone", e.target.value)} placeholder="6XXXXXXXX" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Password" : "Mot de passe"} *</label><input className="input" type="password" value={staffForm.password} onChange={e => setSF("password", e.target.value)} placeholder="Min 6 characters" /></div>
            <div className="form-group"><label className="label">{lang === "en" ? "Role" : "Role"}</label><select className="input" value={staffForm.role} onChange={e => setSF("role", e.target.value)}>{ROLES.map(r => <option key={r.value} value={r.value}>{lang === "en" ? r.en : r.fr}</option>)}</select></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddStaff(false)}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!staffForm.full_name || !staffForm.phone || !staffForm.password || addStaffMutation.isPending} onClick={() => addStaffMutation.mutate()}>{addStaffMutation.isPending ? "..." : (lang === "en" ? "Add staff member" : "Ajouter")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
