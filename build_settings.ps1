Set-Content -Path "src\pages\SettingsPage.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import api from "../utils/api";

export default function SettingsPage() {
  const { user, org } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();

  const [tab, setTab] = useState("locations");
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [editLoc, setEditLoc] = useState(null);
  const [locForm, setLocForm] = useState({ name: "", type: "shop", address: "", phone: "" });

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const addLocMutation = useMutation({
    mutationFn: () => api.post("/locations", locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Location added!" : "Emplacement ajoute!");
      setShowAddLoc(false);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateLocMutation = useMutation({
    mutationFn: () => api.patch(`/locations/${editLoc.id}`, locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Location updated!" : "Emplacement mis a jour!");
      setEditLoc(null);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const locations = locData?.data || [];

  const openEdit = (loc) => {
    setEditLoc(loc);
    setLocForm({ name: loc.name, type: loc.type, address: loc.address || "", phone: loc.phone || "" });
  };

  const TABS = [
    { key: "locations", en: "Warehouses & Shops", fr: "Magasins & Boutiques" },
    { key: "account",   en: "Account",            fr: "Compte" },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Settings" : "Parametres"}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            padding: "10px 20px", background: "none", border: "none",
            borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent",
            color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)",
            cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1
          }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {/* Locations tab */}
      {tab === "locations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{lang === "en" ? "Your Warehouses & Shops" : "Vos Magasins & Boutiques"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en" ? "Rename existing locations or add new ones" : "Renommez les emplacements existants ou ajoutez-en de nouveaux"}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => { setShowAddLoc(true); setEditLoc(null); setLocForm({ name: "", type: "shop", address: "", phone: "" }); }}>
              + {lang === "en" ? "Add location" : "Ajouter"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {locations.map(loc => (
              <div key={loc.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                    background: loc.type === "warehouse" ? "rgba(79,70,229,0.15)" : "rgba(16,185,129,0.15)"
                  }}>
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
                    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
                      {lang === "en" ? "Active" : "Actif"}
                    </span>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => setLocation(loc)}>
                      {lang === "en" ? "Set active" : "Activer"}
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(loc)}>
                    {lang === "en" ? "Edit" : "Modifier"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {locations.length === 0 && (
            <div className="empty-state">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No locations yet" : "Aucun emplacement"}</div>
            </div>
          )}
        </div>
      )}

      {/* Account tab */}
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
          <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setLang(lang === "en" ? "fr" : "en")}>
              {lang === "en" ? "Switch to Francais" : "Switch to English"}
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Location Modal */}
      {(showAddLoc || editLoc) && (
        <div className="modal-overlay" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {editLoc
                ? (lang === "en" ? "Edit Location" : "Modifier l emplacement")
                : (lang === "en" ? "Add New Location" : "Ajouter un emplacement")}
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Name" : "Nom"} *</label>
              <input className="input" value={locForm.name}
                onChange={e => setLocForm(f => ({ ...f, name: e.target.value }))}
                placeholder={lang === "en" ? "e.g. Main Warehouse, Akwa Shop..." : "Ex: Magasin Akwa, Boutique Bonanjo..."} />
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Type" : "Type"}</label>
              <select className="input" value={locForm.type} onChange={e => setLocForm(f => ({ ...f, type: e.target.value }))}>
                <option value="warehouse">{lang === "en" ? "Warehouse (stock storage)" : "Magasin (stockage)"}</option>
                <option value="shop">{lang === "en" ? "Shop (selling point)" : "Boutique (point de vente)"}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={locForm.address}
                onChange={e => setLocForm(f => ({ ...f, address: e.target.value }))}
                placeholder={lang === "en" ? "e.g. Rue Joss, Douala" : "Ex: Rue Joss, Douala"} />
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={locForm.phone}
                onChange={e => setLocForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="6XXXXXXXX" />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}
                onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!locForm.name || addLocMutation.isPending || updateLocMutation.isPending}
                onClick={() => editLoc ? updateLocMutation.mutate() : addLocMutation.mutate()}>
                {(addLocMutation.isPending || updateLocMutation.isPending) ? "..." : (lang === "en" ? "Save" : "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'@
Write-Host "Settings page created!" -ForegroundColor Green
