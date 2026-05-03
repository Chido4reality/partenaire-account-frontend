import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

const TYPES = [
  { value: "retail",    en: "Retail",     fr: "Detail" },
  { value: "wholesale", en: "Wholesale",  fr: "Grossiste" },
  { value: "vip",       en: "VIP",        fr: "VIP" },
  { value: "garage",    en: "Garage",     fr: "Garage" },
];

export default function CustomersPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [debtOnly, setDebtOnly]     = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [selected, setSelected]     = useState(null);
  const [form, setForm]             = useState({ name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, typeFilter, debtOnly],
    queryFn: () => api.get(`/customers?search=${search}&type=${typeFilter}&has_debt=${debtOnly}&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: detail } = useQuery({
    queryKey: ["customer-detail", selected?.id],
    queryFn: () => api.get(`/customers/${selected.id}`).then(r => r.data),
    enabled: !!selected?.id
  });

  const addMutation = useMutation({
    mutationFn: () => api.post("/customers", { ...form, credit_limit: +form.credit_limit || 0 }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Customer added!" : "Client ajoute!");
      setShowAdd(false);
      setForm({ name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "" });
      qc.invalidateQueries(["customers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/customers/${selected.id}`, form),
    onSuccess: () => {
      toast.success(lang === "en" ? "Customer updated!" : "Client mis a jour!");
      qc.invalidateQueries(["customers"]);
      qc.invalidateQueries(["customer-detail", selected.id]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const customers = data?.data || [];

  const typeColor = (type) => {
    if (type === "vip")       return { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" };
    if (type === "wholesale") return { bg: "rgba(79,70,229,0.15)",   color: "#818cf8" };
    if (type === "garage")    return { bg: "rgba(16,185,129,0.15)",  color: "#34d399" };
    return { bg: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" };
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: customer list */}
      <div style={{ flex: 1, padding: 24, overflowY: "auto", borderRight: selected ? "1px solid var(--border)" : "none" }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">{lang === "en" ? "Customers" : "Clients"}</h1>
            <div className="page-sub">{customers.length} {lang === "en" ? "customers" : "clients"}</div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + {lang === "en" ? "New Customer" : "Nouveau client"}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input className="input" placeholder={lang === "en" ? "Search by name or phone..." : "Chercher par nom ou telephone..."}
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }} />
          <select className="input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 140 }}>
            <option value="">{lang === "en" ? "All types" : "Tous types"}</option>
            {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
          </select>
          <button className={`btn ${debtOnly ? "btn-danger" : "btn-secondary"}`} onClick={() => setDebtOnly(d => !d)}>
            {lang === "en" ? "With debt only" : "Avec credit"}
          </button>
        </div>

        {/* Customer list */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            {lang === "en" ? "Loading..." : "Chargement..."}
          </div>
        ) : customers.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No customers yet" : "Aucun client"}</div>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
              + {lang === "en" ? "Add first customer" : "Ajouter le premier client"}
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {customers.map(c => {
              const tc = typeColor(c.customer_type);
              const isSelected = selected?.id === c.id;
              return (
                <div key={c.id} onClick={() => setSelected(c)}
                  style={{ background: isSelected ? "rgba(79,70,229,0.1)" : "var(--bg-card)", border: `1px solid ${isSelected ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: tc.bg, color: tc.color }}>
                          {TYPES.find(t => t.value === c.customer_type)?.[lang === "en" ? "en" : "fr"]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {c.phone && <span>{c.phone}</span>}
                        {c.last_purchase && <span style={{ marginLeft: 12 }}>{lang === "en" ? "Last:" : "Dernier:"} {formatDate(c.last_purchase)}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {c.total_debt > 0 ? (
                        <div>
                          <div style={{ color: "#f87171", fontWeight: 700, fontSize: 14 }}>{formatCFA(c.total_debt)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.open_invoices} {lang === "en" ? "invoice(s)" : "facture(s)"}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#34d399" }}>
                          {lang === "en" ? "No debt" : "Sans credit"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: customer detail */}
      {selected && (
        <div style={{ width: 400, overflowY: "auto", padding: 24, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>x</button>
          </div>

          {/* Edit form */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{lang === "en" ? "Edit details" : "Modifier"}</div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Name" : "Nom"}</label>
              <input className="input" value={form.name || selected.name}
                onChange={e => setF("name", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={form.phone !== undefined ? form.phone : (selected.phone || "")}
                onChange={e => setF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Type" : "Type"}</label>
              <select className="input" value={form.customer_type || selected.customer_type}
                onChange={e => setF("customer_type", e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={form.address !== undefined ? form.address : (selected.address || "")}
                onChange={e => setF("address", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Credit limit (FCFA)" : "Limite credit (FCFA)"}</label>
              <input className="input" type="number" value={form.credit_limit !== undefined ? form.credit_limit : (selected.credit_limit || "")}
                onChange={e => setF("credit_limit", e.target.value)} placeholder="0" />
            </div>
            <button className="btn btn-primary btn-block" disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? "..." : (lang === "en" ? "Save changes" : "Enregistrer")}
            </button>
          </div>

          {/* Purchase history */}
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
            {lang === "en" ? "Purchase history" : "Historique des achats"}
          </div>
          {detail?.data?.sales?.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              {lang === "en" ? "No purchases yet" : "Aucun achat"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {detail?.data?.sales?.map(s => (
                <div key={s.sale_number} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>{s.sale_number}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(s.sale_date)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{formatCFA(s.total_amount)}</div>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8,
                      background: s.payment_status === "paid" ? "rgba(16,185,129,0.15)" : s.payment_status === "partial" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                      color: s.payment_status === "paid" ? "#34d399" : s.payment_status === "partial" ? "#fbbf24" : "#f87171"
                    }}>
                      {s.payment_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Payment history */}
          {detail?.data?.payments?.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, marginTop: 16 }}>
                {lang === "en" ? "Payment history" : "Historique des paiements"}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {detail.data.payments.map((p, i) => (
                  <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(p.payment_date)} - {p.payment_method}</div>
                    <div style={{ fontWeight: 600, color: "#34d399", fontSize: 13 }}>+{formatCFA(p.amount)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Add New Customer" : "Ajouter un client"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={form.name} onChange={e => setF("name", e.target.value)} placeholder="Jean Dupont" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Customer type" : "Type de client"}</label>
              <select className="input" value={form.customer_type} onChange={e => setF("customer_type", e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={form.address} onChange={e => setF("address", e.target.value)} placeholder="Douala" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Credit limit (FCFA)" : "Limite credit (FCFA)"}</label>
              <input className="input" type="number" value={form.credit_limit} onChange={e => setF("credit_limit", e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes" : "Notes"}</label>
              <input className="input" value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder={lang === "en" ? "Optional notes..." : "Notes optionnelles..."} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!form.name || addMutation.isPending}
                onClick={() => addMutation.mutate()}>
                {addMutation.isPending ? "..." : (lang === "en" ? "Add Customer" : "Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
