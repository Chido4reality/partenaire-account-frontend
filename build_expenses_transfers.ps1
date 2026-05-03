# Build Expenses page
Set-Content -Path "src\pages\ExpenditurePage.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function ExpenditurePage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [form, setForm] = useState({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });

  const { data: expData, isLoading } = useQuery({
    queryKey: ["expenditures", dateFilter],
    queryFn: () => api.get(`/expenditures?date=${dateFilter}&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: catData } = useQuery({
    queryKey: ["exp-categories"],
    queryFn: () => api.get("/expenditures/categories").then(r => r.data)
  });

  const { data: locData } = useQuery({
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
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
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
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
            + {lang === "en" ? "Add expense" : "Ajouter une depense"}
          </button>
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          <table className="table">
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
                        {e.pa_expenditure_categories.name}
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
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!form.description || !form.amount || !form.location_id || addMutation.isPending}
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
'@

# Build Transfers page
Set-Content -Path "src\pages\TransfersPage.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function TransfersPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState({ from_location: "", to_location: "", notes: "", items: [{ product_id: "", quantity: "" }] });

  const { data: transferData, isLoading } = useQuery({
    queryKey: ["transfers", statusFilter],
    queryFn: () => api.get(`/transfers?${statusFilter ? "status=" + statusFilter : ""}&limit=30`).then(r => r.data),
    refetchInterval: 30000
  });

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: prodData } = useQuery({
    queryKey: ["products-all"],
    queryFn: () => api.get("/products?limit=200").then(r => r.data)
  });

  const addMutation = useMutation({
    mutationFn: () => api.post("/transfers", {
      from_location: form.from_location || null,
      to_location: form.to_location || null,
      notes: form.notes || null,
      items: form.items.filter(i => i.product_id && i.quantity).map(i => ({ product_id: i.product_id, quantity: +i.quantity }))
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer created!" : "Transfert cree!");
      setShowAdd(false);
      setForm({ from_location: "", to_location: "", notes: "", items: [{ product_id: "", quantity: "" }] });
      qc.invalidateQueries(["transfers"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const completeMutation = useMutation({
    mutationFn: (id) => api.patch(`/transfers/${id}/complete`),
    onSuccess: () => {
      toast.success(lang === "en" ? "Transfer completed!" : "Transfert termine!");
      qc.invalidateQueries(["transfers"]);
      qc.invalidateQueries(["stock"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const transfers = transferData?.data || [];
  const locations = locData?.data || [];
  const products  = prodData?.data || [];

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: "", quantity: "" }] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const statusColor = (s) => {
    if (s === "completed") return { bg: "rgba(16,185,129,0.15)", color: "#34d399" };
    if (s === "in_transit") return { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" };
    if (s === "cancelled") return { bg: "rgba(239,68,68,0.15)", color: "#f87171" };
    return { bg: "rgba(79,70,229,0.15)", color: "var(--brand-light)" };
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Stock Transfers" : "Transferts de stock"}</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + {lang === "en" ? "New Transfer" : "Nouveau transfert"}
        </button>
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[
          { value: "", en: "All", fr: "Tous" },
          { value: "pending", en: "Pending", fr: "En attente" },
          { value: "completed", en: "Completed", fr: "Termines" },
        ].map(f => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)} className={`btn ${statusFilter === f.value ? "btn-primary" : "btn-secondary"} btn-sm`}>
            {lang === "en" ? f.en : f.fr}
          </button>
        ))}
      </div>

      {/* Transfers list */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
      ) : transfers.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No transfers yet" : "Aucun transfert"}</div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
            + {lang === "en" ? "Create first transfer" : "Creer le premier transfert"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {transfers.map(tr => {
            const sc = statusColor(tr.status);
            return (
              <div key={tr.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-secondary)" }}>{tr.transfer_number}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: sc.bg, color: sc.color }}>
                        {tr.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      <strong>{tr.from_location ? locations.find(l => l.id === tr.from_location)?.name || "External" : "External"}</strong>
                      {" -> "}
                      <strong>{tr.to_location ? locations.find(l => l.id === tr.to_location)?.name || "External" : "Customer"}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      {formatDate(tr.transfer_date)}
                      {tr.notes && " - " + tr.notes}
                    </div>
                  </div>
                  {tr.status === "pending" && (
                    <button className="btn btn-success btn-sm" disabled={completeMutation.isPending}
                      onClick={() => completeMutation.mutate(tr.id)}>
                      {lang === "en" ? "Mark completed" : "Marquer termine"}
                    </button>
                  )}
                </div>

                {tr.pa_transfer_items?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    {tr.pa_transfer_items.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span>{item.pa_products?.name || "Unknown product"}</span>
                        <span style={{ color: "var(--brand-light)", fontWeight: 600 }}>{item.quantity} {item.pa_products?.unit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Transfer Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "New Stock Transfer" : "Nouveau transfert de stock"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? "From" : "De"}</label>
                <select className="input" value={form.from_location} onChange={e => setF("from_location", e.target.value)}>
                  <option value="">{lang === "en" ? "Select source" : "Choisir source"}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "To" : "Vers"}</label>
                <select className="input" value={form.to_location} onChange={e => setF("to_location", e.target.value)}>
                  <option value="">{lang === "en" ? "Select destination" : "Choisir destination"}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {lang === "en" ? "Items to transfer" : "Articles a transferer"}
            </div>

            {form.items.map((item, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <select className="input" value={item.product_id} onChange={e => setItem(idx, "product_id", e.target.value)}>
                  <option value="">{lang === "en" ? "Select product" : "Choisir produit"}</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="input" type="number" value={item.quantity}
                  onChange={e => setItem(idx, "quantity", e.target.value)}
                  placeholder={lang === "en" ? "Qty" : "Qte"} style={{ width: 80 }} />
                {form.items.length > 1 && (
                  <button onClick={() => removeItem(idx)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>x</button>
                )}
              </div>
            ))}

            <button className="btn btn-secondary btn-sm" onClick={addItem} style={{ marginBottom: 16 }}>
              + {lang === "en" ? "Add item" : "Ajouter article"}
            </button>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
              <input className="input" value={form.notes} onChange={e => setF("notes", e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={addMutation.isPending || (!form.from_location && !form.to_location)}
                onClick={() => addMutation.mutate()}>
                {addMutation.isPending ? "..." : (lang === "en" ? "Create Transfer" : "Creer le transfert")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'@

# Update App.jsx
$app = Get-Content "src\App.jsx" -Raw
$app = $app -replace 'import \{ TransfersPage, ExpenditurePage, ReportsPage \} from "\./pages/Placeholders";', 'import { ReportsPage } from "./pages/Placeholders";
import TransfersPage from "./pages/TransfersPage";
import ExpenditurePage from "./pages/ExpenditurePage";'
Set-Content "src\App.jsx" -Value $app -Encoding UTF8

Write-Host "Expenses and Transfers done!" -ForegroundColor Green
Write-Host "Run: npm run dev" -ForegroundColor Cyan
