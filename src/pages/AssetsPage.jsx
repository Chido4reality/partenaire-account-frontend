// Pro Plus Feature 3 — Asset ledger (owner-only). A standalone MANUAL
// cash/asset-location ledger. NEVER touches POS sales/till. Holdings with
// DERIVED running balances; append-only In/Out/Transfer movements with a
// confirm-before-commit step (append-only → the warning matters). No FX.
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";

const CATS = [
  { value: "cash",         en: "Cash",          fr: "Espèces" },
  { value: "bank",         en: "Bank",          fr: "Banque" },
  { value: "mobile_money", en: "Mobile money",  fr: "Mobile money" },
  { value: "other",        en: "Other",         fr: "Autre" },
];
const catLabel = (v, en) => { const c = CATS.find(x => x.value === v); return c ? (en ? c.en : c.fr) : v; };
const fmt = (n, cur) => `${new Intl.NumberFormat("fr-CM").format(Math.round((Number(n) || 0)))} ${cur || ""}`.trim();

// Off-shop expense categories — MIRRORS the POS shop-expense set so the form
// feels familiar. Stored as a stable value key; re-labelled EN/FR at render.
const EXPENSE_CATS = [
  { value: "rent",        en: "Rent",        fr: "Loyer" },
  { value: "salaries",    en: "Salaries",    fr: "Salaires" },
  { value: "transport",   en: "Transport",   fr: "Transport" },
  { value: "fuel",        en: "Fuel",        fr: "Carburant" },
  { value: "electricity", en: "Electricity", fr: "Électricité" },
  { value: "water",       en: "Water",       fr: "Eau" },
  { value: "phone",       en: "Phone",       fr: "Téléphone" },
  { value: "internet",    en: "Internet",    fr: "Internet" },
  { value: "maintenance", en: "Maintenance", fr: "Maintenance" },
  { value: "repairs",     en: "Repairs",     fr: "Réparations" },
  { value: "supplies",    en: "Supplies",    fr: "Fournitures" },
  { value: "marketing",   en: "Marketing",   fr: "Marketing" },
  { value: "taxes",       en: "Taxes",       fr: "Impôts" },
  { value: "insurance",   en: "Insurance",   fr: "Assurance" },
  { value: "bank_fees",   en: "Bank fees",   fr: "Frais bancaires" },
  { value: "goods",       en: "Goods",       fr: "Marchandises" },
  { value: "other",       en: "Other",       fr: "Autre" },
];
const expenseCatLabel = (v, en) => { const c = EXPENSE_CATS.find(x => x.value === v); return c ? (en ? c.en : c.fr) : v; };
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };

export default function AssetsPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const qc = useQueryClient();

  const { data: planResp } = useQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const entitled = hasFeature(planResp?.data?.effective_plan || "trial", "asset_ledger");

  const [selectedId, setSelectedId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [holdingModal, setHoldingModal] = useState(null); // { mode:'add'|'edit', holding? }
  const [hForm, setHForm] = useState({ name: "", category: "cash", currency_label: "XAF" });
  const [moveModal, setMoveModal] = useState(null); // { type:'in'|'out'|'transfer' }
  const [mForm, setMForm] = useState({ amount: "", movement_date: new Date().toISOString().slice(0, 10), description: "", from_holding_id: "", to_holding_id: "" });
  const [confirming, setConfirming] = useState(false);

  // Phase 2 — Expenses tab.
  const [tab, setTab] = useState("holdings"); // 'holdings' | 'expenses'
  const [expFrom, setExpFrom] = useState(firstOfMonth());
  const [expTo, setExpTo] = useState(new Date().toISOString().slice(0, 10));
  const [expModal, setExpModal] = useState(false);
  const [eForm, setEForm] = useState({ amount: "", expense_date: new Date().toISOString().slice(0, 10), category: "other", description: "", funding: "external" });
  const [confirmingExp, setConfirmingExp] = useState(false);

  const { data: holdingsResp, isLoading } = useQuery({
    queryKey: ["asset-holdings", showArchived],
    queryFn: () => api.get("/assets/holdings?include_archived=" + (showArchived ? "true" : "false")).then(r => r.data),
    enabled: entitled,
  });
  const holdings = holdingsResp?.data || [];
  const byId = (id) => holdings.find(h => h.id === id);

  const { data: detailResp, isLoading: detailLoading } = useQuery({
    queryKey: ["asset-movements", selectedId],
    queryFn: () => api.get(`/assets/holdings/${selectedId}/movements`).then(r => r.data),
    enabled: entitled && !!selectedId,
  });
  const detail = detailResp?.data;

  const createHolding = useMutation({
    mutationFn: () => api.post("/assets/holdings", hForm),
    onSuccess: () => { toast.success(en ? "Holding created" : "Compte créé"); setHoldingModal(null); qc.invalidateQueries({ queryKey: ["asset-holdings"] }); },
    onError: (e) => toast.error(e?.response?.data?.message || "Error"),
  });
  const patchHolding = useMutation({
    mutationFn: (body) => api.patch("/assets/holdings/" + (holdingModal?.holding?.id || selectedId), body),
    onSuccess: () => { toast.success(en ? "Saved" : "Enregistré"); setHoldingModal(null); qc.invalidateQueries({ queryKey: ["asset-holdings"] }); qc.invalidateQueries({ queryKey: ["asset-movements"] }); },
    onError: (e) => toast.error(e?.response?.data?.message || "Error"),
  });
  const createMovement = useMutation({
    mutationFn: () => api.post("/assets/movements", {
      type: moveModal.type, amount: Number(mForm.amount), movement_date: mForm.movement_date,
      description: mForm.description || null,
      from_holding_id: (moveModal.type === "out" || moveModal.type === "transfer") ? mForm.from_holding_id : null,
      to_holding_id: (moveModal.type === "in" || moveModal.type === "transfer") ? mForm.to_holding_id : null,
    }),
    onSuccess: () => {
      toast.success(en ? "Recorded" : "Enregistré");
      setMoveModal(null); setConfirming(false);
      setMForm({ amount: "", movement_date: new Date().toISOString().slice(0, 10), description: "", from_holding_id: "", to_holding_id: "" });
      qc.invalidateQueries({ queryKey: ["asset-holdings"] }); qc.invalidateQueries({ queryKey: ["asset-movements"] });
    },
    onError: (e) => { toast.error(e?.response?.data?.message || "Error"); setConfirming(false); },
  });

  // ── Phase 2 — Expenses ──
  const { data: expResp, isLoading: expLoading } = useQuery({
    queryKey: ["asset-expenses", expFrom, expTo],
    queryFn: () => api.get(`/assets/expenses?from=${expFrom}&to=${expTo}`).then(r => r.data),
    enabled: entitled && tab === "expenses",
  });
  const expenses = expResp?.data?.expenses || [];
  const expTotal = expResp?.data?.total || 0;

  const createExpense = useMutation({
    mutationFn: () => api.post("/assets/expenses", {
      amount: Number(eForm.amount),
      expense_date: eForm.expense_date,
      category: eForm.category,
      description: eForm.description || null,
      funding_holding_id: eForm.funding === "external" ? null : eForm.funding,
    }),
    onSuccess: () => {
      toast.success(en ? "Expense recorded" : "Dépense enregistrée");
      setExpModal(false); setConfirmingExp(false);
      setEForm({ amount: "", expense_date: new Date().toISOString().slice(0, 10), category: "other", description: "", funding: "external" });
      qc.invalidateQueries({ queryKey: ["asset-expenses"] });
      qc.invalidateQueries({ queryKey: ["asset-holdings"] });
      qc.invalidateQueries({ queryKey: ["asset-movements"] });
    },
    onError: (e) => { toast.error(e?.response?.data?.message || "Error"); setConfirmingExp(false); },
  });

  const reverseExpense = useMutation({
    mutationFn: (id) => api.post(`/assets/expenses/${id}/reverse`),
    onSuccess: () => {
      toast.success(en ? "Expense reversed" : "Dépense annulée");
      qc.invalidateQueries({ queryKey: ["asset-expenses"] });
      qc.invalidateQueries({ queryKey: ["asset-holdings"] });
      qc.invalidateQueries({ queryKey: ["asset-movements"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Error"),
  });

  const wrap = (c) => <div style={{ maxWidth: 640, margin: "0 auto", padding: 20 }}>{c}</div>;

  if (!entitled) return wrap(
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>💼</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{en ? "Assets — Pro Plus" : "Avoirs — Pro Plus"}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
        {en ? "Track where your money sits (cash box, MoMo, bank…) with a simple manual ledger. Available on Pro Plus." : "Suivez où se trouve votre argent (caisse, MoMo, banque…) avec un registre manuel simple. Disponible avec Pro Plus."}
      </div>
      <Link to="/request-activation?plan=pro_plus" className="btn btn-primary" style={{ textDecoration: "none" }}>
        🔒 {en ? "Upgrade to Pro Plus" : "Passer à Pro Plus"}
      </Link>
    </div>
  );

  const openMove = (type) => {
    const base = { amount: "", movement_date: new Date().toISOString().slice(0, 10), description: "", from_holding_id: "", to_holding_id: "" };
    if (selectedId) { if (type === "in") base.to_holding_id = selectedId; else base.from_holding_id = selectedId; }
    setMForm(base); setConfirming(false); setMoveModal({ type });
  };

  // Projected balance + negative flag for the confirm step.
  const projection = useMemo(() => {
    if (!moveModal) return null;
    const amt = Number(mForm.amount) || 0;
    const from = byId(mForm.from_holding_id), to = byId(mForm.to_holding_id);
    if (moveModal.type === "in") return to ? { to, newTo: (to.balance || 0) + amt } : null;
    if (moveModal.type === "out") return from ? { from, newFrom: (from.balance || 0) - amt } : null;
    return (from && to) ? { from, to, newFrom: (from.balance || 0) - amt, newTo: (to.balance || 0) + amt } : null;
  }, [moveModal, mForm, holdings]); // eslint-disable-line

  // ── DETAIL (one holding's append-only history) ──
  if (selectedId && detail) {
    const h = detail.holding;
    return wrap(
      <div>
        <button onClick={() => setSelectedId(null)} className="btn btn-secondary btn-sm" style={{ marginBottom: 12 }}>← {en ? "All holdings" : "Tous les comptes"}</button>
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{h.name} {h.is_archived && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({en ? "archived" : "archivé"})</span>}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{catLabel(h.category, en)} · {h.currency_label}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Balance" : "Solde"}</div>
              <div style={{ fontWeight: 800, fontSize: 20, color: (h.balance || 0) < 0 ? "#f87171" : "var(--brand-light)" }}>{fmt(h.balance, h.currency_label)}</div>
            </div>
          </div>
          {!h.is_archived && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={() => openMove("in")}>＋ {en ? "In" : "Entrée"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => openMove("out")}>− {en ? "Out" : "Sortie"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => openMove("transfer")}>⇄ {en ? "Transfer" : "Transfert"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setHForm({ name: h.name, category: h.category, currency_label: h.currency_label }); setHoldingModal({ mode: "edit", holding: h }); }}>✎ {en ? "Rename" : "Renommer"}</button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
          {en ? "History (append-only)" : "Historique (ajout uniquement)"}
        </div>
        {(detail.movements || []).length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>{en ? "No movements yet." : "Aucun mouvement."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {detail.movements.map(m => {
              const pos = (m.effect || 0) >= 0;
              const other = m.type === "transfer" ? (m.from_holding_id === h.id ? `→ ${m.to_holding_name}` : `← ${m.from_holding_name}`) : null;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "8px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{m.type === "in" ? (en ? "In" : "Entrée") : m.type === "out" ? (en ? "Out" : "Sortie") : (en ? "Transfer" : "Transfert")} {other && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{other}</span>}</div>
                    <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.movement_date}{m.description ? " · " + m.description : ""}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: pos ? "#34d399" : "#f87171", whiteSpace: "nowrap" }}>{pos ? "+" : "−"}{fmt(Math.abs(m.effect), h.currency_label)}</div>
                </div>
              );
            })}
          </div>
        )}
        {moveModal && <MovementModal />}
        {holdingModal && <HoldingModal />}
      </div>
    );
  }

  if (selectedId && detailLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);

  // ── LIST ──
  function HoldingModal() {
    const isEdit = holdingModal.mode === "edit";
    return (
      <div className="modal-overlay" onClick={() => setHoldingModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>{isEdit ? (en ? "Edit holding" : "Modifier le compte") : (en ? "New holding" : "Nouveau compte")}</div>
          <div className="form-group"><label className="label">{en ? "Name" : "Nom"} *</label>
            <input className="input" value={hForm.name} onChange={e => setHForm(f => ({ ...f, name: e.target.value }))} placeholder={en ? "e.g. Cash box" : "ex. Caisse"} />
          </div>
          <div className="form-group"><label className="label">{en ? "Category" : "Catégorie"}</label>
            <select className="input" value={hForm.category} onChange={e => setHForm(f => ({ ...f, category: e.target.value }))}>
              {CATS.map(c => <option key={c.value} value={c.value}>{en ? c.en : c.fr}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="label">{en ? "Currency label (display only)" : "Devise (affichage)"}</label>
            <input className="input" value={hForm.currency_label} onChange={e => setHForm(f => ({ ...f, currency_label: e.target.value.toUpperCase() }))} placeholder="XAF" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setHoldingModal(null)}>{en ? "Cancel" : "Annuler"}</button>
            {isEdit && (
              <button className="btn btn-secondary" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
                onClick={() => { if (confirm(en ? "Archive this holding? Its history is kept; it just gets hidden." : "Archiver ce compte ? L'historique est conservé ; il est juste masqué.")) patchHolding.mutate({ is_archived: !holdingModal.holding.is_archived }); }}>
                {holdingModal.holding.is_archived ? (en ? "Unarchive" : "Désarchiver") : (en ? "Archive" : "Archiver")}
              </button>
            )}
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={!hForm.name.trim() || createHolding.isPending || patchHolding.isPending}
              onClick={() => isEdit ? patchHolding.mutate({ name: hForm.name, category: hForm.category, currency_label: hForm.currency_label }) : createHolding.mutate()}>
              {en ? "Save" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function MovementModal() {
    const t = moveModal.type;
    const fromOpts = holdings.filter(h => !h.is_archived);
    const fromSel = byId(mForm.from_holding_id);
    // Transfer: destination restricted to SAME currency label (no FX).
    const toOpts = holdings.filter(h => !h.is_archived && (t !== "transfer" || (fromSel && h.currency_label === fromSel.currency_label && h.id !== fromSel.id)));
    const amt = Number(mForm.amount) || 0;
    const canContinue = amt > 0 &&
      (t === "in" ? !!mForm.to_holding_id :
       t === "out" ? (!!mForm.from_holding_id && mForm.description.trim()) :
       (!!mForm.from_holding_id && !!mForm.to_holding_id && mForm.from_holding_id !== mForm.to_holding_id));
    const cur = (fromSel?.currency_label) || byId(mForm.to_holding_id)?.currency_label || "";
    const goesNeg = (t === "out" && projection && projection.newFrom < 0) || (t === "transfer" && projection && projection.newFrom < 0);

    return (
      <div className="modal-overlay" onClick={() => setMoveModal(null)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>
            {t === "in" ? (en ? "Money in" : "Entrée d'argent") : t === "out" ? (en ? "Money out" : "Sortie d'argent") : (en ? "Transfer" : "Transfert")}
          </div>
          {!confirming ? (
            <>
              {(t === "out" || t === "transfer") && (
                <div className="form-group"><label className="label">{en ? "From" : "De"} *</label>
                  <select className="input" value={mForm.from_holding_id} onChange={e => setMForm(f => ({ ...f, from_holding_id: e.target.value, to_holding_id: t === "transfer" ? "" : f.to_holding_id }))}>
                    <option value="">{en ? "— Select —" : "— Choisir —"}</option>
                    {fromOpts.map(h => <option key={h.id} value={h.id}>{h.name} ({h.currency_label})</option>)}
                  </select>
                </div>
              )}
              {(t === "in" || t === "transfer") && (
                <div className="form-group"><label className="label">{en ? "To" : "Vers"} *</label>
                  <select className="input" value={mForm.to_holding_id} onChange={e => setMForm(f => ({ ...f, to_holding_id: e.target.value }))} disabled={t === "transfer" && !mForm.from_holding_id}>
                    <option value="">{en ? "— Select —" : "— Choisir —"}</option>
                    {toOpts.map(h => <option key={h.id} value={h.id}>{h.name} ({h.currency_label})</option>)}
                  </select>
                  {t === "transfer" && fromSel && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{en ? `Same currency only (${fromSel.currency_label}) — no conversion.` : `Même devise uniquement (${fromSel.currency_label}) — pas de conversion.`}</div>}
                </div>
              )}
              <div className="form-group"><label className="label">{en ? "Amount" : "Montant"} *</label>
                <input className="input" type="number" min="0" value={mForm.amount} onChange={e => setMForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </div>
              <div className="form-group"><label className="label">{en ? "Date" : "Date"}</label>
                <input className="input" type="date" value={mForm.movement_date} onChange={e => setMForm(f => ({ ...f, movement_date: e.target.value }))} />
              </div>
              <div className="form-group"><label className="label">{en ? "Description" : "Description"}{t === "out" ? " *" : ""}</label>
                <input className="input" value={mForm.description} onChange={e => setMForm(f => ({ ...f, description: e.target.value }))} placeholder={t === "out" ? (en ? "Required — what was it for?" : "Requis — pour quoi ?") : (en ? "Optional" : "Optionnel")} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setMoveModal(null)}>{en ? "Cancel" : "Annuler"}</button>
                <button className="btn btn-primary" style={{ flex: 2 }} disabled={!canContinue} onClick={() => setConfirming(true)}>{en ? "Continue →" : "Continuer →"}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14, fontSize: 14, lineHeight: 1.6 }}>
                {t === "in" && (en ? `In ${fmt(amt, cur)} to ${byId(mForm.to_holding_id)?.name}.` : `Entrée de ${fmt(amt, cur)} vers ${byId(mForm.to_holding_id)?.name}.`)}
                {t === "out" && (en ? `Out ${fmt(amt, cur)} from ${byId(mForm.from_holding_id)?.name}.` : `Sortie de ${fmt(amt, cur)} de ${byId(mForm.from_holding_id)?.name}.`)}
                {t === "transfer" && (en ? `Transfer ${fmt(amt, cur)} from ${byId(mForm.from_holding_id)?.name} to ${byId(mForm.to_holding_id)?.name}.` : `Transfert de ${fmt(amt, cur)} de ${byId(mForm.from_holding_id)?.name} vers ${byId(mForm.to_holding_id)?.name}.`)}
                <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>
                  ⚠ {en ? "This can't be edited later — only corrected with another entry." : "Ceci ne pourra pas être modifié — seulement corrigé par une autre écriture."}
                </div>
                {goesNeg && (
                  <div style={{ marginTop: 8, color: "#f87171", fontSize: 12, fontWeight: 600 }}>
                    ⚠ {en ? `This will push ${projection.from.name} to ${fmt(projection.newFrom, cur)} (negative).` : `${projection.from.name} passera à ${fmt(projection.newFrom, cur)} (négatif).`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirming(false)}>← {en ? "Back" : "Retour"}</button>
                <button className="btn btn-primary" style={{ flex: 2 }} disabled={createMovement.isPending} onClick={() => createMovement.mutate()}>
                  {createMovement.isPending ? "…" : (en ? "Confirm & save" : "Confirmer")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function ExpenseModal() {
    const fundHolding = eForm.funding === "external" ? null : byId(eForm.funding);
    const amt = Number(eForm.amount) || 0;
    const cur = fundHolding ? fundHolding.currency_label : "";
    const newBal = fundHolding ? (fundHolding.balance || 0) - amt : null;
    const goesNeg = fundHolding && newBal < 0;
    const canContinue = amt > 0 && !!eForm.category;
    const activeHoldings = holdings.filter(h => !h.is_archived);
    return (
      <div className="modal-overlay" onClick={() => setExpModal(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>{en ? "Record expense" : "Enregistrer une dépense"}</div>
          {!confirmingExp ? (
            <>
              <div className="form-group"><label className="label">{en ? "Amount" : "Montant"} *</label>
                <input className="input" type="number" min="0" value={eForm.amount} onChange={e => setEForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </div>
              <div className="form-group"><label className="label">{en ? "Date" : "Date"}</label>
                <input className="input" type="date" value={eForm.expense_date} onChange={e => setEForm(f => ({ ...f, expense_date: e.target.value }))} />
              </div>
              <div className="form-group"><label className="label">{en ? "Category" : "Catégorie"}</label>
                <select className="input" value={eForm.category} onChange={e => setEForm(f => ({ ...f, category: e.target.value }))}>
                  {EXPENSE_CATS.map(c => <option key={c.value} value={c.value}>{en ? c.en : c.fr}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">{en ? "Description" : "Description"}</label>
                <input className="input" value={eForm.description} onChange={e => setEForm(f => ({ ...f, description: e.target.value }))} placeholder={en ? "Optional — what was it for?" : "Optionnel — pour quoi ?"} />
              </div>
              <div className="form-group"><label className="label">{en ? "Funding source" : "Source de financement"} *</label>
                <select className="input" value={eForm.funding} onChange={e => setEForm(f => ({ ...f, funding: e.target.value }))}>
                  <option value="external">{en ? "Other / External (untracked)" : "Autre / Externe (non suivi)"}</option>
                  {activeHoldings.map(h => <option key={h.id} value={h.id}>{h.name} ({h.currency_label})</option>)}
                </select>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {fundHolding ? (en ? `Deducts from ${fundHolding.name} (balance ${fmt(fundHolding.balance, cur)}).` : `Déduit de ${fundHolding.name} (solde ${fmt(fundHolding.balance, cur)}).`)
                              : (en ? "Logged only — no holding is affected." : "Enregistré seulement — aucun compte affecté.")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setExpModal(false)}>{en ? "Cancel" : "Annuler"}</button>
                <button className="btn btn-primary" style={{ flex: 2 }} disabled={!canContinue} onClick={() => setConfirmingExp(true)}>{en ? "Continue →" : "Continuer →"}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14, fontSize: 14, lineHeight: 1.6 }}>
                {fundHolding
                  ? (en ? `Expense ${fmt(amt, cur)} (${expenseCatLabel(eForm.category, en)}) from ${fundHolding.name}.` : `Dépense ${fmt(amt, cur)} (${expenseCatLabel(eForm.category, en)}) de ${fundHolding.name}.`)
                  : (en ? `Expense ${fmt(amt, "")} (${expenseCatLabel(eForm.category, en)}) — Other / External.` : `Dépense ${fmt(amt, "")} (${expenseCatLabel(eForm.category, en)}) — Autre / Externe.`)}
                {fundHolding && (
                  <div style={{ marginTop: 6 }}>{fundHolding.name}: {fmt(fundHolding.balance, cur)} → {fmt(newBal, cur)}</div>
                )}
                <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>
                  ⚠ {en ? "This can't be edited later — only corrected with a reversal." : "Ceci ne pourra pas être modifié — seulement annulé par une écriture inverse."}
                </div>
                {goesNeg && (
                  <div style={{ marginTop: 8, color: "#f87171", fontSize: 12, fontWeight: 600 }}>
                    ⚠ {en ? `This will push ${fundHolding.name} to ${fmt(newBal, cur)} (negative).` : `${fundHolding.name} passera à ${fmt(newBal, cur)} (négatif).`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmingExp(false)}>← {en ? "Back" : "Retour"}</button>
                <button className="btn btn-primary" style={{ flex: 2 }} disabled={createExpense.isPending} onClick={() => createExpense.mutate()}>
                  {createExpense.isPending ? "…" : (en ? "Confirm & save" : "Confirmer")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const TabBar = (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
      {[["holdings", en ? "Holdings" : "Comptes"], ["expenses", en ? "Expenses" : "Dépenses"]].map(([k, label]) => (
        <button key={k} onClick={() => { setTab(k); if (k === "expenses") setSelectedId(null); }}
          style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--brand)" : "2px solid transparent", color: tab === k ? "var(--brand-light)" : "var(--text-muted)", fontWeight: tab === k ? 700 : 500, fontSize: 14, padding: "8px 4px", cursor: "pointer" }}>
          {label}
        </button>
      ))}
    </div>
  );

  if (tab === "expenses") return wrap(
    <div>
      {TabBar}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>🧾 {en ? "Expenses" : "Dépenses"}</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEForm({ amount: "", expense_date: new Date().toISOString().slice(0, 10), category: "other", description: "", funding: "external" }); setConfirmingExp(false); setExpModal(true); }}>＋ {en ? "Add expense" : "Ajouter"}</button>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        {en ? "Off-shop expenses paid from your holdings or external funds. Separate from POS shop expenses." : "Dépenses hors-boutique payées depuis vos comptes ou des fonds externes. Distinct des dépenses de la boutique."}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input className="input" type="date" value={expFrom} onChange={e => setExpFrom(e.target.value)} style={{ width: 150 }} />
        <span style={{ color: "var(--text-muted)" }}>→</span>
        <input className="input" type="date" value={expTo} onChange={e => setExpTo(e.target.value)} style={{ width: 150 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>{en ? "Period total" : "Total période"}</span>
        <span style={{ fontWeight: 800, fontSize: 18, color: "#f87171" }}>{fmt(expTotal)}</span>
      </div>
      {expLoading ? (
        <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : expenses.length === 0 ? (
        <div className="empty-state"><div style={{ fontWeight: 600 }}>{en ? "No expenses in this period." : "Aucune dépense sur cette période."}</div></div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
            {en ? "History (append-only)" : "Historique (ajout uniquement)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {expenses.map(e => {
              const reversal = e.is_reversal;
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "8px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, opacity: reversal ? 0.75 : 1 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>
                      {expenseCatLabel(e.category, en)}
                      {e.funding_holding_name
                        ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {e.funding_holding_name}</span>
                        : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {en ? "External" : "Externe"}</span>}
                    </div>
                    <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.expense_date}{e.description ? " · " + e.description : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 700, color: reversal ? "#34d399" : "#f87171", whiteSpace: "nowrap" }}>{reversal ? "+" : "−"}{fmt(Math.abs(e.amount), e.currency_label)}</div>
                    {!reversal && (
                      <button onClick={() => { if (confirm(en ? "Reverse this expense? A compensating entry will be posted (the original is kept)." : "Annuler cette dépense ? Une écriture inverse sera créée (l'originale est conservée).")) reverseExpense.mutate(e.id); }}
                        title={en ? "Reverse" : "Annuler"} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }}>↩</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {expModal && <ExpenseModal />}
    </div>
  );

  return wrap(
    <div>
      {TabBar}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>💼 {en ? "Assets" : "Avoirs"}</div>
        <button className="btn btn-primary btn-sm" onClick={() => { setHForm({ name: "", category: "cash", currency_label: "XAF" }); setHoldingModal({ mode: "add" }); }}>＋ {en ? "Add holding" : "Ajouter"}</button>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        {en ? "A manual ledger of where your money sits. Separate from POS sales." : "Un registre manuel de l'emplacement de votre argent. Indépendant des ventes."}
      </div>
      {isLoading ? (
        <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : holdings.length === 0 ? (
        <div className="empty-state"><div style={{ fontWeight: 600 }}>{en ? "No holdings yet — add your first (Cash box, MoMo…)" : "Aucun compte — ajoutez le premier (Caisse, MoMo…)"}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {holdings.map(h => (
            <div key={h.id} onClick={() => setSelectedId(h.id)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, opacity: h.is_archived ? 0.55 : 1 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{h.name} {h.is_archived && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>({en ? "archived" : "archivé"})</span>}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{catLabel(h.category, en)} · {h.currency_label}</div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: (h.balance || 0) < 0 ? "#f87171" : "var(--brand-light)" }}>{fmt(h.balance, h.currency_label)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button onClick={() => setShowArchived(s => !s)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
          {showArchived ? (en ? "Hide archived" : "Masquer les archivés") : (en ? "Show archived" : "Afficher les archivés")}
        </button>
      </div>
      {holdingModal && <HoldingModal />}
      {moveModal && <MovementModal />}
    </div>
  );
}
