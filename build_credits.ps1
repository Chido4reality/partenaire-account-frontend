Set-Content -Path "src\pages\CreditsPage.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function CreditsPage() {
  const { lang } = useLangStore();
  const qc = useQueryClient();

  const [tab, setTab]           = useState("all");
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm]   = useState({ amount: "", payment_method: "cash", reference: "", notes: "" });
  const [showPay, setShowPay]   = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["credits"],
    queryFn: () => api.get("/reports/debts").then(r => r.data),
    refetchInterval: 30000
  });

  const { data: saleDetail } = useQuery({
    queryKey: ["sales-by-customer", selected?.id],
    queryFn: () => api.get(`/sales?customer_id=${selected.id}&status=partial,credit&limit=20`).then(r => r.data),
    enabled: !!selected?.id
  });

  const payMutation = useMutation({
    mutationFn: ({ saleId }) => api.post(`/sales/${saleId}/payment`, {
      amount: +payForm.amount,
      payment_method: payForm.payment_method,
      reference: payForm.reference || null,
      notes: payForm.notes || null
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Payment recorded!" : "Paiement enregistre!");
      setShowPay(false);
      setPayForm({ amount: "", payment_method: "cash", reference: "", notes: "" });
      qc.invalidateQueries(["credits"]);
      qc.invalidateQueries(["sales-by-customer", selected?.id]);
      qc.invalidateQueries(["daily-summary"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const customers = data?.data || [];
  const today = new Date().toISOString().split("T")[0];

  const filtered = customers.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) return false;
    if (tab === "overdue")  return c.earliest_due && c.earliest_due < today;
    if (tab === "due_today") return c.earliest_due && c.earliest_due === today;
    return true;
  });

  const overdue   = customers.filter(c => c.earliest_due && c.earliest_due < today).length;
  const dueToday  = customers.filter(c => c.earliest_due && c.earliest_due === today).length;
  const totalDebt = customers.reduce((s, c) => s + (+c.total_debt || 0), 0);

  const PAY_METHODS = [
    { value: "cash",         en: "Cash",         fr: "Especes" },
    { value: "mobile_money", en: "Mobile Money", fr: "Mobile Money" },
    { value: "bank",         en: "Bank",         fr: "Virement" },
  ];

  const setP = (k, v) => setPayForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left panel */}
      <div style={{ flex: 1, padding: 24, overflowY: "auto", borderRight: selected ? "1px solid var(--border)" : "none" }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">{lang === "en" ? "Credit Management" : "Gestion des credits"}</h1>
            <div className="page-sub" style={{ color: "#f87171" }}>
              {lang === "en" ? "Total outstanding:" : "Total du:"} {formatCFA(totalDebt)}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: lang === "en" ? "Total customers with debt" : "Clients avec credit", value: customers.length, color: "var(--brand-light)" },
            { label: lang === "en" ? "Overdue" : "En retard", value: overdue, color: "#f87171" },
            { label: lang === "en" ? "Due today" : "Echeance aujourd hui", value: dueToday, color: "#fbbf24" },
          ].map(card => (
            <div key={card.label} className="stat-card">
              <div className="stat-label">{card.label}</div>
              <div className="stat-value" style={{ color: card.color, fontSize: 28 }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
          {[
            { key: "all",       en: `All (${customers.length})`,    fr: `Tous (${customers.length})` },
            { key: "overdue",   en: `Overdue (${overdue})`,         fr: `En retard (${overdue})` },
            { key: "due_today", en: `Due today (${dueToday})`,      fr: `Aujourd hui (${dueToday})` },
          ].map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)} style={{
              padding: "8px 16px", background: "none", border: "none",
              borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent",
              color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1
            }}>
              {lang === "en" ? tb.en : tb.fr}
            </button>
          ))}
        </div>

        {/* Search */}
        <input className="input" placeholder={lang === "en" ? "Search customer..." : "Chercher client..."}
          value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, maxWidth: 360 }} />

        {/* Customer debt list */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
            <div style={{ fontWeight: 600 }}>{lang === "en" ? "No credit sales" : "Aucun credit"}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map(c => {
              const isOverdue  = c.earliest_due && c.earliest_due < today;
              const isDueToday = c.earliest_due && c.earliest_due === today;
              const isSelected = selected?.id === c.id;
              return (
                <div key={c.id} onClick={() => setSelected(c)}
                  style={{ background: isSelected ? "rgba(79,70,229,0.1)" : "var(--bg-card)", border: `1px solid ${isSelected ? "var(--brand)" : isOverdue ? "rgba(239,68,68,0.3)" : "var(--border)"}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 12 }}>
                        {c.phone && <span>{c.phone}</span>}
                        <span>{c.open_invoices} {lang === "en" ? "invoice(s)" : "facture(s)"}</span>
                        {c.earliest_due && (
                          <span style={{ color: isOverdue ? "#f87171" : isDueToday ? "#fbbf24" : "var(--text-muted)" }}>
                            {lang === "en" ? "Due:" : "Echeance:"} {formatDate(c.earliest_due)}
                            {isOverdue && ` (${lang === "en" ? "OVERDUE" : "EN RETARD"})`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>{formatCFA(c.total_debt)}</div>
                      {isOverdue && (
                        <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>OVERDUE</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      {selected && (
        <div style={{ width: 420, overflowY: "auto", padding: 24, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
              <div style={{ color: "#f87171", fontWeight: 600, fontSize: 14, marginTop: 2 }}>{formatCFA(selected.total_debt)}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>x</button>
          </div>

          {/* Open invoices */}
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
            {lang === "en" ? "Open invoices" : "Factures ouvertes"}
          </div>

          {saleDetail?.data?.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              {lang === "en" ? "No open invoices" : "Aucune facture ouverte"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {saleDetail?.data?.map(sale => (
                <div key={sale.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>{sale.sale_number}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(sale.sale_date)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCFA(sale.total_amount)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {lang === "en" ? "Paid:" : "Paye:"} {formatCFA(sale.paid_amount)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ color: "#f87171", fontWeight: 600 }}>
                        {lang === "en" ? "Balance:" : "Reste:"} {formatCFA(sale.balance_due)}
                      </span>
                      {sale.due_date && (
                        <span style={{ marginLeft: 10, color: sale.due_date < today ? "#f87171" : "var(--text-muted)", fontSize: 11 }}>
                          {lang === "en" ? "Due:" : "Ech:"} {formatDate(sale.due_date)}
                        </span>
                      )}
                    </div>
                    <button className="btn btn-success btn-sm"
                      onClick={() => { setPayForm(f => ({ ...f, amount: sale.balance_due })); setShowPay(sale); }}>
                      {lang === "en" ? "Record payment" : "Paiement"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payment Modal */}
      {showPay && (
        <div className="modal-overlay" onClick={() => setShowPay(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {lang === "en" ? "Record Payment" : "Enregistrer un paiement"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              {selected?.name} - {showPay.sale_number}
            </div>

            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-secondary)" }}>{lang === "en" ? "Invoice total" : "Total facture"}</span>
                <span style={{ fontWeight: 600 }}>{formatCFA(showPay.total_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6 }}>
                <span style={{ color: "var(--text-secondary)" }}>{lang === "en" ? "Already paid" : "Deja paye"}</span>
                <span style={{ color: "#34d399" }}>{formatCFA(showPay.paid_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste a payer"}</span>
                <span style={{ color: "#f87171", fontWeight: 700 }}>{formatCFA(showPay.balance_due)}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Amount received (FCFA)" : "Montant recu (FCFA)"} *</label>
              <input className="input" type="number" value={payForm.amount}
                onChange={e => setP("amount", e.target.value)}
                placeholder={formatCFA(showPay.balance_due)} />
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Payment method" : "Mode de paiement"}</label>
              <select className="input" value={payForm.payment_method} onChange={e => setP("payment_method", e.target.value)}>
                {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{lang === "en" ? m.en : m.fr}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Reference (Mobile Money)" : "Reference"}</label>
              <input className="input" value={payForm.reference} onChange={e => setP("reference", e.target.value)}
                placeholder={lang === "en" ? "Transaction ID..." : "ID transaction..."} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPay(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-success" style={{ flex: 2 }}
                disabled={!payForm.amount || payMutation.isPending}
                onClick={() => payMutation.mutate({ saleId: showPay.id })}>
                {payMutation.isPending ? "..." : (lang === "en" ? "Confirm payment" : "Confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function PAY_METHODS() {}
}
'@

# Update App.jsx
$app = Get-Content "src\App.jsx" -Raw
$app = $app -replace 'import \{ CreditsPage, TransfersPage, ExpenditurePage, ReportsPage \} from "\./pages/Placeholders";', 'import { TransfersPage, ExpenditurePage, ReportsPage } from "./pages/Placeholders";
import CreditsPage from "./pages/CreditsPage";'
Set-Content "src\App.jsx" -Value $app -Encoding UTF8

Write-Host "Credits module done!" -ForegroundColor Green
Write-Host "Run: npm run dev" -ForegroundColor Cyan
