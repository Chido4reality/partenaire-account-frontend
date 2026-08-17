import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { isPendingApproval, keepWorkingToast } from "../utils/approval";
import { useLangStore, useAuthStore } from "../store";
import api, { formatDate } from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";
import { useTicketSummary } from "../utils/useTicketSummary"; // MP-EXPENSE-TICKETS
// MP-MY-PERMISSIONS-ONE-SHAPE: shared hook — never re-implement the ["my-permissions"]
// query locally, a mismatched queryFn shape reads as DENIED.
import { useMyPermissions } from "../utils/useMyPermissions";

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
  // MP-CORRECTIONS: who may reach the edit/delete controls. Owner always; staff only when
  // the boss granted expense_edit_policy='approve', in which case their action raises a
  // REQUEST rather than changing anything. The server re-checks either way.
  const { user: authUser } = useAuthStore();
  const { perms: myExpPerms } = useMyPermissions({ enabled: authUser?.role !== "owner", staleTime: 300000 });
  const canCorrectExpense = authUser?.role === "owner" || myExpPerms?.expense_edit_policy === "approve";
  const [editExp, setEditExp]     = useState(null);  // the row being corrected
  const [deleteExp, setDeleteExp] = useState(null);  // the row being removed
  // MP-REQUIRE-OPEN-SHIFT Phase 3: the modal's location picker may
  // differ from the cashier's currently-selected location. The
  // hook reads (cashier × selectedLocation); the backend gate uses
  // (cashier × body.location_id), so a cashier expensing for a
  // location where they DON'T have a shift open will still 400
  // server-side and surface via the interceptor's localized toast.
  // Frontend disables submit only when there's no shift at the
  // currently selected location — the common case.
  const { hasShift: shiftIsOpen, locId: expLocId } = useActiveShift();
  // ── MP-EXPENSE-TICKETS: THE SHIFT GATE IS NOW MODE-DEPENDENT ───────────────
  // In CASHIER mode raising an expense moves no money — it sends a payout to the
  // till — so it must NOT need an open shift. Requiring one is what blocked Ada:
  // she is a cashier at a cashier-mode shop with no shift of her own, and the
  // whole point of the ticket is that she can raise it at 07:00 before the till
  // opens. The server stopped requiring a shift here; this button did not, so
  // the client was enforcing a rule the backend had already dropped.
  // In DIRECT mode nothing changes: the expense IS the drawer event.
  const { summary: expSummary } = useTicketSummary(expLocId, { onError: () => {} });
  const expTicketMode = expSummary?.mode === "cashier";
  const needsShift = !expTicketMode;
  const shiftBlocked = needsShift && !shiftIsOpen;
  const fmt = useCurrency();

  const [showAdd, setShowAdd] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [form, setForm] = useState({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });

  const { data: expData, isLoading } = useOfflineCachedQuery({
    queryKey: ["expenditures", dateFilter],
    queryFn: () => api.get(`/expenditures?date=${dateFilter}&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });

  // ── MP-EXPENSE-TICKETS: WHAT I RAISED, AND WHERE IT WENT ──────────────────
  // Raising something and never learning its fate is the same defect as a queue
  // shrinking silently, and worse here because it is money: Ada tells the driver
  // "it's coming" and then has no way to find out whether it came. The main list
  // shows only PAID expenses, correctly — this screen is money that has left the
  // drawer — so without this her payout is invisible the moment she raises it.
  //
  // READ-ONLY, deliberately. She raised it, she can see it, she cannot act on
  // it. That is the separation working, not being undermined — paying it out is
  // the cashier's job and needs can_pay_expenses.
  //
  // No date filter: a payout raised on Tuesday and still unpaid on Thursday is
  // exactly the one she needs to see, and filtering it by today would hide the
  // ones that have been waiting longest.
  //
  // The server scopes non-owner/manager to their OWN rows, so for Ada this list
  // IS hers. For a boss it is the shop's, which is the right reading of the same
  // heading from where he sits.
  const { data: pendingData } = useOfflineCachedQuery({
    queryKey: ["expenditures", "pending_payout"],
    queryFn: () => api.get(`/expenditures?status=pending_payout&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });
  const pendingPayouts = pendingData?.data || [];
  const pendingTotal = pendingPayouts.reduce((t, e) => t + (Number(e.amount) || 0), 0);

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
    onSuccess: (res) => {
      // Phase 5b: expense HELD for owner approval → nothing recorded.
      if (isPendingApproval(res)) {
        toast(keepWorkingToast(lang === "en"), { icon: "⏳", duration: 4000 });
        setShowAdd(false);
        setForm({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });
        return;
      }
      // ── MP-EXPENSE-TICKETS: SAY WHERE IT WENT ────────────────────────────
      // In cashier mode this did NOT record an expense — it sent a payout to the
      // till. The row then vanishes from this screen, correctly, because this
      // screen lists money that has actually left the drawer. Peter typed 1 000
      // into a form, got "Expense recorded!", and watched it disappear; he read
      // that as a bug and he was right to. The old wording was a lie in the new
      // mode and the silence afterwards was worse than the wording.
      //
      // Deliberately says WHERE it is, not just what happened: "waiting at the
      // till" is actionable — someone can go and look — where "sent" is not.
      const sentToTill = res?.data?.data?.status === "pending_payout";
      if (sentToTill) {
        toast.success(
          lang === "en"
            ? "Sent to the till — waiting for the cashier to pay it out."
            : "Envoyé à la caisse — en attente du paiement par le caissier.",
          { icon: "💸", duration: 5000 });
      } else {
        toast.success(lang === "en" ? "Expense recorded!" : "Depense enregistree!");
      }
      setShowAdd(false);
      setForm({ location_id: "", category_id: "", amount: "", description: "", exp_date: new Date().toISOString().split("T")[0] });
      qc.invalidateQueries(["expenditures"]);
      qc.invalidateQueries(["daily-summary"]);
      // MP-DRAWER-FRESHNESS: recording an expense takes cash OUT of the drawer, so the
      // drawer card has to re-read too — it never did.
      qc.invalidateQueries({ queryKey: ["current-shift"] });
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
            {lang === "en" ? "Total today:" : "Total aujourd hui:"} {fmt(totalToday)}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}
          disabled={shiftBlocked}
          title={shiftBlocked ? noShiftHint(lang) : ""}>
          + {lang === "en" ? "New Expense" : "Nouvelle depense"}
        </button>
      </div>

      {/* ── WAITING AT THE TILL — read-only ────────────────────────────────
          Only when there is something waiting: an empty panel on every expense
          screen in a direct-mode shop would be noise, and this must not become
          furniture. Neutral card, not amber — nothing has gone wrong, the money
          is simply with the cashier. */}
      {pendingPayouts.length > 0 && (
        <div style={{
          border: "1px solid var(--border)", background: "var(--bg-card)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              💸 {lang === "en" ? `Waiting at the till (${pendingPayouts.length})` : `En attente à la caisse (${pendingPayouts.length})`}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(pendingTotal)}</div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.45 }}>
            {lang === "en"
              ? "Sent to the cashier. No money has left the drawer yet, so these are not counted in today's total."
              : "Envoyé au caissier. Aucun argent n'est encore sorti de la caisse : ces montants ne sont pas comptés dans le total du jour."}
          </div>
          {pendingPayouts.map(e => (
            <div key={e.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 10, padding: "5px 0", borderTop: "1px solid var(--border)", fontSize: 13.5,
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {e.description}
                {e.pa_expenditure_categories?.name ? (
                  <span style={{ color: "var(--text-secondary)" }}> · {e.pa_expenditure_categories.name}</span>
                ) : null}
              </span>
              <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(e.amount)}</span>
            </div>
          ))}
        </div>
      )}

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
            disabled={shiftBlocked}
            title={shiftBlocked ? noShiftHint(lang) : ""}>
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
                {/* MP-CORRECTIONS */}
                {canCorrectExpense && <th style={{ textAlign: "right" }}>{lang === "en" ? "Fix" : "Corriger"}</th>}
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 500 }}>{e.description}</td>
                  <td>
                    {e.pa_expenditure_categories ? (
                      <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 10, background: "rgba(251,197,3,0.1)", color: "var(--brand-light)" }}>
                        {categoryLabel(e.pa_expenditure_categories.name, lang)}
                      </span>
                    ) : "-"}
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{e.pa_locations?.name || "-"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: "#f87171" }}>{fmt(e.amount)}</td>
                  {/* MP-CORRECTIONS: an owner's tap applies; a granted staffer's tap
                      raises a request for the boss. The server decides which — and
                      refuses outright if this expense belongs to a CLOSED shift, since
                      that shift's reconciliation is already frozen. */}
                  {canCorrectExpense && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => setEditExp(e)} title={lang === "en" ? "Correct" : "Corriger"}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>✏️</button>
                      <button onClick={() => setDeleteExp(e)} title={lang === "en" ? "Delete" : "Supprimer"}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>🗑️</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>{lang === "en" ? "Total" : "Total"}</span>
            <span style={{ color: "#f87171" }}>{fmt(totalToday)}</span>
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
              <label className="label">{lang === "en" ? `Amount (${fmt.symbol})` : `Montant (${fmt.symbol})`} *</label>
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
            {/* ── MP-EXPENSE-TICKETS: SAY WHY, NOT JUST NO ──────────────────────
                This only fires in DIRECT mode now, where an expense IS the drawer
                event and so genuinely needs an open till. But the people most likely
                to hit it are the ones who never open a till — a storekeeper paying a
                delivery driver — and to them a greyed-out button with a generic
                "no shift" hint reads as the feature being broken. State the actual
                reason and the actual way forward. */}
            {shiftBlocked && (
              <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>
                  {lang === "en" ? "A till must be open to record this." : "Une caisse doit être ouverte pour enregistrer ceci."}
                </div>
                {lang === "en"
                  ? "At this shop an expense is paid straight from the drawer, so it has to land in an open till. Ask whoever is on the till to open it, or record it there."
                  : "Dans cette boutique, une dépense est payée directement depuis la caisse : elle doit donc être enregistrée dans une caisse ouverte. Demandez à la personne en caisse de l'ouvrir, ou enregistrez-la là-bas."}
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

      {/* MP-CORRECTIONS */}
      {editExp && (
        <CorrectExpenseModal
          exp={editExp} lang={lang} fmt={fmt} categories={categories}
          onClose={() => setEditExp(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["expenditures"] });
            // MP-DRAWER-FRESHNESS: an expense IS drawer cash — pa_drawer_ledger computes
            // expected_drawer as float + sales − refunds − cash_expenses. Without this the
            // drawer card kept a stale figure until its next poll, which is the actual
            // cause of the "drawer lags after an expense change" report.
            qc.invalidateQueries({ queryKey: ["current-shift"] });
            qc.invalidateQueries({ queryKey: ["daily-summary"] });
          }} />
      )}
      {deleteExp && (
        <DeleteExpenseModal
          exp={deleteExp} lang={lang} fmt={fmt}
          onClose={() => setDeleteExp(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["expenditures"] });
            // MP-DRAWER-FRESHNESS: an expense IS drawer cash — pa_drawer_ledger computes
            // expected_drawer as float + sales − refunds − cash_expenses. Without this the
            // drawer card kept a stale figure until its next poll, which is the actual
            // cause of the "drawer lags after an expense change" report.
            qc.invalidateQueries({ queryKey: ["current-shift"] });
            qc.invalidateQueries({ queryKey: ["daily-summary"] });
          }} />
      )}
    </div>
  );
}

// ── MP-CORRECTIONS ─────────────────────────────────────────────────────────────
// Correct a wrongly-entered expense. Same rule as the opening float: the server refuses
// this outright when the expense belongs to a CLOSED shift, because its amount feeds
// pa_drawer_ledger.cash_expenses and that shift's expected_cash/difference snapshot is
// already frozen. An expense with no shift touches only day totals and stays editable.
//
// shift_id and location_id are deliberately absent from this form — moving an expense
// between shifts or branches changes two reconciliations at once and is not a "typo fix".
function CorrectExpenseModal({ exp, lang, fmt, categories, onClose, onDone }) {
  const en = lang === "en";
  const [amount, setAmount]           = useState(String(Number(exp.amount) || 0));
  const [description, setDescription] = useState(exp.description || "");
  const [categoryId, setCategoryId]   = useState(exp.category_id || "");
  const [expDate, setExpDate]         = useState(exp.exp_date || "");
  const [reason, setReason]           = useState("");
  const [busy, setBusy]               = useState(false);

  const prevAmt = Number(exp.amount) || 0;
  const nextAmt = Number(amount);
  const changed =
    (Number.isFinite(nextAmt) && nextAmt !== prevAmt) ||
    description.trim() !== (exp.description || "") ||
    (categoryId || "") !== (exp.category_id || "") ||
    (expDate || "") !== (exp.exp_date || "");
  const valid = changed && Number.isFinite(nextAmt) && nextAmt > 0 && description.trim();

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // Send ONLY what actually changed — a full-object PATCH would re-write untouched
      // fields and log them as corrections that never happened.
      const patch = { reason: reason.trim() || null };
      if (nextAmt !== prevAmt) patch.amount = nextAmt;
      if (description.trim() !== (exp.description || "")) patch.description = description.trim();
      if ((categoryId || "") !== (exp.category_id || "")) patch.category_id = categoryId || null;
      if ((expDate || "") !== (exp.exp_date || "")) patch.exp_date = expDate;

      const res = await api.patch(`/expenditures/${exp.id}`, patch);
      toast.success(res.status === 202
        ? (en ? "Request sent to the boss for approval." : "Demande envoyée au patron pour approbation.")
        : (en ? "Expense corrected." : "Dépense corrigée."));
      onDone && onDone();
      onClose();
    } catch (e) {
      const d = e?.response?.data;
      toast.error((en ? d?.message_en : d?.message_fr) || d?.message ||
                  (en ? "Correction failed." : "Échec de la correction."));
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: "var(--bg-elevated)",
        border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 400 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
          {en ? "Correct expense" : "Corriger la dépense"}
        </div>

        <label className="label">{en ? "Description" : "Description"}</label>
        <input className="input" style={{ width: "100%", marginBottom: 10 }}
          value={description} onChange={(ev) => setDescription(ev.target.value)} />

        <label className="label">{en ? `Amount (${fmt.symbol})` : `Montant (${fmt.symbol})`}</label>
        <input className="input" type="number" inputMode="decimal" style={{ width: "100%", marginBottom: 10 }}
          value={amount} onChange={(ev) => setAmount(ev.target.value)} />

        <label className="label">{en ? "Category" : "Catégorie"}</label>
        <select className="input" style={{ width: "100%", marginBottom: 10 }}
          value={categoryId || ""} onChange={(ev) => setCategoryId(ev.target.value)}>
          <option value="">{en ? "No category" : "Sans catégorie"}</option>
          {(categories || []).map(c => <option key={c.id} value={c.id}>{categoryLabel(c.name, lang)}</option>)}
        </select>

        <label className="label">{en ? "Date" : "Date"}</label>
        <input className="input" type="date" style={{ width: "100%", marginBottom: 10 }}
          value={expDate || ""} onChange={(ev) => setExpDate(ev.target.value)} />

        <input className="input" style={{ width: "100%", marginBottom: 12 }}
          value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={300}
          placeholder={en ? "Reason (optional)" : "Motif (optionnel)"} />

        {Number.isFinite(nextAmt) && nextAmt !== prevAmt && (
          <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 10px", borderRadius: 8,
            background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}>
            {fmt(prevAmt)} → {fmt(nextAmt)}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {en ? "Cancel" : "Annuler"}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            {busy ? "…" : (en ? "Save" : "Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteExpenseModal({ exp, lang, fmt, onClose, onDone }) {
  const en = lang === "en";
  const [reason, setReason] = useState("");
  const [busy, setBusy]     = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // axios DELETE needs the body under `data`.
      const res = await api.delete(`/expenditures/${exp.id}`, { data: { reason: reason.trim() || null } });
      toast.success(res.status === 202
        ? (en ? "Request sent to the boss for approval." : "Demande envoyée au patron pour approbation.")
        : (en ? "Expense deleted." : "Dépense supprimée."));
      onDone && onDone();
      onClose();
    } catch (e) {
      const d = e?.response?.data;
      toast.error((en ? d?.message_en : d?.message_fr) || d?.message ||
                  (en ? "Delete failed." : "Échec de la suppression."));
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: "var(--bg-elevated)",
        border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: "100%", maxWidth: 380 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
          {en ? "Delete this expense?" : "Supprimer cette dépense ?"}
        </div>
        <div style={{ fontSize: 13.5, marginBottom: 12, padding: "10px 12px", borderRadius: 8,
          background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.35)" }}>
          <div style={{ fontWeight: 600 }}>{exp.description || "—"}</div>
          <div style={{ color: "#f87171", fontWeight: 700, marginTop: 2 }}>{fmt(exp.amount)}</div>
        </div>
        <input className="input" style={{ width: "100%", marginBottom: 12 }}
          value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={300}
          placeholder={en ? "Reason (optional)" : "Motif (optionnel)"} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {en ? "Cancel" : "Annuler"}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}
            style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }}>
            {busy ? "…" : (en ? "Delete" : "Supprimer")}
          </button>
        </div>
      </div>
    </div>
  );
}
