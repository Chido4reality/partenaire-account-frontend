import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore } from "../store";
import api, { formatCFA, formatDate } from "../utils/api";

export default function CreditsPage() {
  const { lang } = useLangStore();
  const { org }  = useAuthStore();
  const qc = useQueryClient();

  const [tab, setTab]           = useState("all");
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState(null);
  const [payForm, setPayForm]   = useState({ amount: "", payment_method: "cash", reference: "", notes: "" });
  const [showPay, setShowPay]   = useState(false);

  // ── Fetch all customers with debt (summary list) ──────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["credits"],
    queryFn: () => api.get("/reports/debts").then(r => r.data),
    refetchInterval: 30000
  });

  // ── Fetch open invoices for selected customer ─────────────────────────────
  // Uses /sales/customer-debt/:id which is now correctly ordered in the backend
  const { data: debtDetail, isLoading: debtLoading } = useQuery({
    queryKey: ["customer-debt", selected?.id],
    queryFn: () => api.get(`/sales/customer-debt/${selected.id}`).then(r => r.data),
    enabled: !!selected?.id,
    staleTime: 0
  });

  const openInvoices = debtDetail?.data || [];

  const payMutation = useMutation({
    mutationFn: ({ saleId }) => api.post(`/sales/${saleId}/payment`, {
      amount: +payForm.amount,
      payment_method: payForm.payment_method,
      reference: payForm.reference || null,
      notes: payForm.notes || null
    }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Payment recorded!" : "✓ Paiement enregistré!");
      setShowPay(false);
      setPayForm({ amount: "", payment_method: "cash", reference: "", notes: "" });
      qc.invalidateQueries(["credits"]);
      qc.invalidateQueries(["customer-debt", selected?.id]);
      qc.invalidateQueries(["daily-summary"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── WHATSAPP REMINDER ─────────────────────────────────────────────────────
  const sendWhatsAppReminder = (customer) => {
    if (!customer.phone) {
      toast.error(lang === "en" ? "No phone number for this customer" : "Pas de numéro pour ce client");
      return;
    }

    let phone = customer.phone.toString().replace(/\s+/g, "").replace(/^0/, "");
    if (!phone.startsWith("237")) phone = "237" + phone;

    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const totalDebt = customer.total_debt || 0;
    const orgName = org?.name || "notre boutique";

    let msg = lang === "en"
      ? `Bonjour ${customer.name},\n\nReminder from ${orgName}.\n\nYour outstanding balance as of ${today}:\n*${totalDebt.toLocaleString()} FCFA*\n`
      : `Bonjour ${customer.name},\n\nRappel de ${orgName}.\n\nVotre solde impayé au ${today}:\n*${totalDebt.toLocaleString()} FCFA*\n`;

    if (openInvoices.length > 0) {
      msg += lang === "en" ? "\nInvoice details:\n" : "\nDétails des factures:\n";
      openInvoices.slice(0, 3).forEach(s => {
        const date = new Date(s.sale_date || s.created_at).toLocaleDateString("fr-FR");
        msg += `• ${s.sale_number} (${date}): ${(+s.balance_due).toLocaleString()} FCFA\n`;
      });
      if (openInvoices.length > 3) msg += `• ...et ${openInvoices.length - 3} autre(s)\n`;
    }

    msg += lang === "en"
      ? `\nPlease contact us to arrange payment.\nThank you!\n\n— ${orgName}`
      : `\nMerci de nous contacter pour régler ce montant.\nMerci de votre confiance!\n\n— ${orgName}`;

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    toast.success(lang === "en" ? "WhatsApp opened!" : "WhatsApp ouvert!");
  };

  const customers = data?.data || [];
  const today = new Date().toISOString().split("T")[0];

  const filtered = customers.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) return false;
    if (tab === "overdue")   return c.earliest_due && c.earliest_due < today;
    if (tab === "due_today") return c.earliest_due && c.earliest_due === today;
    return true;
  });

  const overdue   = customers.filter(c => c.earliest_due && c.earliest_due < today).length;
  const dueToday  = customers.filter(c => c.earliest_due && c.earliest_due === today).length;
  const totalDebt = customers.reduce((s, c) => s + (+c.total_debt || 0), 0);

  const PAY_METHODS = [
    { value: "cash",         en: "Cash",         fr: "Espèces" },
    { value: "mobile_money", en: "Mobile Money", fr: "Mobile Money" },
    { value: "bank",         en: "Bank",         fr: "Virement" },
  ];

  const setP = (k, v) => setPayForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── LEFT PANEL ── */}
      <div style={{ flex: 1, padding: 24, overflowY: "auto", borderRight: selected ? "1px solid var(--border)" : "none" }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">{lang === "en" ? "Credit Management" : "Gestion des crédits"}</h1>
            <div className="page-sub" style={{ color: "#f87171" }}>
              {lang === "en" ? "Total outstanding:" : "Total dû:"} {formatCFA(totalDebt)}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: lang === "en" ? "Customers with debt" : "Clients avec crédit", value: customers.length, color: "var(--brand-light)" },
            { label: lang === "en" ? "Overdue" : "En retard", value: overdue, color: "#f87171" },
            { label: lang === "en" ? "Due today" : "Échéance aujourd'hui", value: dueToday, color: "#fbbf24" },
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
            { key: "all",       en: `All (${customers.length})`,  fr: `Tous (${customers.length})` },
            { key: "overdue",   en: `Overdue (${overdue})`,       fr: `En retard (${overdue})` },
            { key: "due_today", en: `Due today (${dueToday})`,    fr: `Aujourd'hui (${dueToday})` },
          ].map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              style={{ padding: "8px 16px", background: "none", border: "none", borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1 }}>
              {lang === "en" ? tb.en : tb.fr}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 16, maxWidth: 360 }}>
          <input className="input" placeholder={lang === "en" ? "Search customer..." : "Chercher client..."}
            value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 13 }}>🔍</span>
        </div>

        {/* Customer list */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>💳</div>
            <div style={{ fontWeight: 600 }}>{lang === "en" ? "No credit sales" : "Aucun crédit"}</div>
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
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(79,70,229,0.2)", color: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 10 }}>
                            {c.phone && <span>{c.phone}</span>}
                            <span>{c.open_invoices} {lang === "en" ? "invoice(s)" : "facture(s)"}</span>
                            {c.earliest_due && (
                              <span style={{ color: isOverdue ? "#f87171" : isDueToday ? "#fbbf24" : "var(--text-muted)" }}>
                                {lang === "en" ? "Due:" : "Éch:"} {formatDate(c.earliest_due)}
                                {isOverdue && " ⚠️"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <div style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>{formatCFA(c.total_debt)}</div>
                      {c.phone && (
                        <button
                          onClick={e => { e.stopPropagation(); setSelected(c); setTimeout(() => sendWhatsAppReminder(c), 300); }}
                          style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                          📱 {lang === "en" ? "Remind" : "Rappel"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL — Customer detail ── */}
      {selected && (
        <div style={{ width: 420, overflowY: "auto", padding: 24, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
              <div style={{ color: "#f87171", fontWeight: 600, fontSize: 14, marginTop: 2 }}>{formatCFA(selected.total_debt)}</div>
              {selected.phone && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>📞 {selected.phone}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {selected.phone && (
                <button onClick={() => sendWhatsAppReminder(selected)}
                  style={{ background: "#25D366", border: "none", color: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  📱 {lang === "en" ? "Send WhatsApp Reminder" : "Envoyer rappel WhatsApp"}
                </button>
              )}
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
          </div>

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
            {lang === "en" ? "Open invoices" : "Factures ouvertes"}
          </div>

          {debtLoading ? (
            <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
              Loading...
            </div>
          ) : openInvoices.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              {lang === "en" ? "No open invoices" : "Aucune facture ouverte"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {openInvoices.map(sale => (
                <div key={sale.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>{sale.sale_number}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(sale.sale_date)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCFA(sale.total_amount)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {lang === "en" ? "Paid:" : "Payé:"} {formatCFA(sale.paid_amount)}
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
                          {lang === "en" ? "Due:" : "Éch:"} {formatDate(sale.due_date)}
                          {sale.due_date < today && " ⚠️"}
                        </span>
                      )}
                    </div>
                    <button className="btn btn-success btn-sm"
                      onClick={() => { setPayForm(f => ({ ...f, amount: sale.balance_due })); setShowPay(sale); }}>
                      💰 {lang === "en" ? "Record payment" : "Paiement"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* WhatsApp preview */}
          {selected.phone && (
            <div style={{ marginTop: 20, padding: 14, background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.3)", borderRadius: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#25D366", marginBottom: 8 }}>📱 WhatsApp Reminder Preview</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                {`Bonjour ${selected.name},\n\nRappel de ${org?.name || "notre boutique"}.\nSolde impayé: *${(selected.total_debt || 0).toLocaleString()} FCFA*\n\nMerci de nous contacter.`}
              </div>
              <button onClick={() => sendWhatsAppReminder(selected)}
                style={{ marginTop: 10, width: "100%", padding: "10px", background: "#25D366", border: "none", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                📱 {lang === "en" ? "Open WhatsApp" : "Ouvrir WhatsApp"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── PAYMENT MODAL ── */}
      {showPay && (
        <div className="modal-overlay" onClick={() => setShowPay(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {lang === "en" ? "Record Payment" : "Enregistrer un paiement"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              {selected?.name} — {showPay.sale_number}
            </div>

            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--text-secondary)" }}>{lang === "en" ? "Invoice total" : "Total facture"}</span>
                <span style={{ fontWeight: 600 }}>{formatCFA(showPay.total_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "var(--text-secondary)" }}>{lang === "en" ? "Already paid" : "Déjà payé"}</span>
                <span style={{ color: "#34d399" }}>{formatCFA(showPay.paid_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 8, borderTop: "1px solid var(--border)", marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>{lang === "en" ? "Balance due" : "Reste à payer"}</span>
                <span style={{ color: "#f87171", fontWeight: 700 }}>{formatCFA(showPay.balance_due)}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Amount received (FCFA)" : "Montant reçu (FCFA)"} *</label>
              <input className="input" type="number" value={payForm.amount}
                onChange={e => setP("amount", e.target.value)}
                placeholder={String(showPay.balance_due)} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Payment method" : "Mode de paiement"}</label>
              <select className="input" value={payForm.payment_method} onChange={e => setP("payment_method", e.target.value)}>
                {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{lang === "en" ? m.en : m.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Reference" : "Référence"}</label>
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
                {payMutation.isPending ? "..." : `✓ ${lang === "en" ? "Confirm payment" : "Confirmer"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
