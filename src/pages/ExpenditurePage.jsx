import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";
import { useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";

// MP-PAUL-FIX-5B (3 Jun): pa_expenditure_categories.name is stored
// French-only in the DB (single source of truth). The cashier-facing
// UI re-labels at render time so the English-language flow doesn't
// read like raw French. Unknown categories (custom ones added later
// by an org) fall through to the raw name. Mapping intentionally
// covers the launch-set seed categories — see admin migration that
// populates pa_expenditure_categories for new orgs.
const CATEGORY_LABEL_EN = {
  "Transport":        "Transport",
  "Marchandises":     "Goods",
  "Carburant":        "Fuel",
  "Loyer":            "Rent",
  "Salaires":         "Salaries",
  "Salaire":          "Salary",
  "Electricité":      "Electricity",
  "Electricite":      "Electricity",
  "Eau":              "Water",
  "Téléphone":        "Phone",
  "Telephone":        "Phone",
  "Internet":         "Internet",
  "Facture":          "Bill",
  "Factures":         "Bills",
  "Maintenance":      "Maintenance",
  "Entretien":        "Maintenance",
  "Réparations":      "Repairs",
  "Reparations":      "Repairs",
  "Fournitures":      "Supplies",
  "Bureau":           "Office",
  "Marketing":        "Marketing",
  "Publicité":        "Advertising",
  "Publicite":        "Advertising",
  "Impôts":           "Taxes",
  "Impots":           "Taxes",
  "Taxes":            "Taxes",
  "Assurance":        "Insurance",
  "Sécurité":         "Security",
  "Securite":         "Security",
  "Frais bancaires":  "Bank fees",
  "Banque":           "Bank",
  "Autre":            "Other",
  "Divers":           "Other",
};
function categoryLabel(name, lang) {
  if (!name) return "";
  if (lang !== "en") return name;
  return CATEGORY_LABEL_EN[name] || name;
}

export default function ExpenditurePage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();
  // MP-REQUIRE-OPEN-SHIFT Phase 3: the modal's location picker may
  // differ from the cashier's currently-selected location. The
  // hook reads (cashier × selectedLocation); the backend gate uses
  // (cashier × body.location_id), so a cashier expensing for a
  // location where they DON'T have a shift open will still 400
  // server-side and surface via the interceptor's localized toast.
  // Frontend disables submit only when there's no shift at the
  // currently selected location — the common case.
  const { hasShift: shiftIsOpen } = useActiveShift();

  const [showAdd, setShowAdd] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [form, setForm] = useState({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });

  const { data: expData, isLoading } = useOfflineCachedQuery({
    queryKey: ["expenditures", dateFilter],
    queryFn: () => api.get(`/expenditures?date=${dateFilter}&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: catData } = useOfflineCachedQuery({
    queryKey: ["exp-categories"],
    queryFn: () => api.get("/expenditures/categories").then(r => r.data)
  });

  const { data: locData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const addMutation = useMutation({
    mutationFn: () => api.post("/expenditures", { ...form, amount: +form.amount }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Expense recorded!" : "Depense enregistree!");
      setShowAdd(false);
      setForm({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });
      qc.invalidateQueries(["expenditures"]);
      qc.invalidateQueries(["daily-summary"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const expenses = expData?.data || [];
  const categories = catData?.data || [];
  const locations = locData?.data || [];
  const totalToday = expenses.reduce((s, e) => s + (+e.amount || 0), 0);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{lang === "en" ? "Expenses" : "Depenses"}</h1>
          <div className="page-sub" style={{ color: "#f87171" }}>
            {lang === "en" ? "Total today:" : "Total aujourd hui:"} {formatCFA(totalToday)}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}
          disabled={!shiftIsOpen}
          title={!shiftIsOpen ? noShiftHint(lang) : ""}>
          + {lang === "en" ? "New Expense" : "Nouvelle depense"}
        </button>
      </div>

      {/* Date filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        <label className="label" style={{ margin: 0 }}>{lang === "en" ? "Date:" : "Date:"}</label>
        <input className="input" type="date" value={dateFilter}
          onChange={e => setDateFilter(e.target.value)} style={{ width: 180 }} />
      </div>

      {/* Expenses list */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
      ) : expenses.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No expenses for this date" : "Aucune depense pour cette date"}</div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}
            disabled={!shiftIsOpen}
            title={!shiftIsOpen ? noShiftHint(lang) : ""}>
            + {lang === "en" ? "Add expense" : "Ajouter une depense"}
          </button>
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
          <table className="table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>{lang === "en" ? "Description" : "Description"}</th>
                <th>{lang === "en" ? "Category" : "Categorie"}</th>
                <th>{lang === "en" ? "Location" : "Emplacement"}</th>
                <th>{lang === "en" ? "Time" : "Heure"}</th>
                <th style={{ textAlign: "right" }}>{lang === "en" ? "Amount" : "Montant"}</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 500 }}>{e.description}</td>
                  <td>
                    {e.pa_expenditure_categories ? (
                      <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: "rgba(79,70,229,0.1)", color: "var(--brand-light)" }}>
                        {categoryLabel(e.pa_expenditure_categories.name, lang)}
                      </span>
                    ) : "-"}
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{e.pa_locations?.name || "-"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: "#f87171" }}>{formatCFA(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>{lang === "en" ? "Total" : "Total"}</span>
            <span style={{ color: "#f87171" }}>{formatCFA(totalToday)}</span>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Record Expense" : "Enregistrer une depense"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Description" : "Description"} *</label>
              <input className="input" value={form.description} onChange={e => setF("description", e.target.value)}
                placeholder={lang === "en" ? "e.g. Electricity bill, Transport..." : "Ex: Facture electricite, Transport..."} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Amount (FCFA)" : "Montant (FCFA)"} *</label>
              <input className="input" type="number" value={form.amount} onChange={e => setF("amount", e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Category" : "Categorie"}</label>
              <select className="input" value={form.category_id} onChange={e => setF("category_id", e.target.value)}>
                <option value="">{lang === "en" ? "Select category" : "Choisir categorie"}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{categoryLabel(c.name, lang)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Location" : "Emplacement"} *</label>
              <select className="input" value={form.location_id} onChange={e => setF("location_id", e.target.value)}>
                <option value="">{lang === "en" ? "Select location" : "Choisir emplacement"}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Date" : "Date"}</label>
              <input className="input" type="date" value={form.exp_date} onChange={e => setF("exp_date", e.target.value)} />
            </div>
            {!shiftIsOpen && (
              <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#fbbf24", fontWeight: 600, textAlign: "center" }}>
                {noShiftHint(lang)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!shiftIsOpen || !form.description || !form.amount || !form.location_id || addMutation.isPending}
                title={!shiftIsOpen ? noShiftHint(lang) : ""}
                onClick={() => addMutation.mutate()}>
                {addMutation.isPending ? "..." : (lang === "en" ? "Save expense" : "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
