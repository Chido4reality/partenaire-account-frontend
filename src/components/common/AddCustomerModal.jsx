// The "Add New Customer" modal — moved here UNCHANGED from CustomersPage (Peter 2026-11-18) so the sale
// screen's payment panel can offer "+ New customer" with the very same flow: same fields, same
// client-side same-phone pre-check, same POST /customers, same 409 CUSTOMER_PHONE_EXISTS handling, same
// cache refresh. The markup is byte-for-byte what CustomersPage rendered (scripts/customer-pick-check.mjs).
//
// Props: knownCustomers — the list the same-phone pre-check runs against (CustomersPage: its list;
//        the sale screen: the ["pos-customers"] list); onClose; onCreated(customer) after a create;
//        onExisting(match) for the duplicate offer; existingVerb "open" (CustomersPage) | "use" (sale).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { useLangStore } from "../../store";
import { usePlaceholders } from "../../utils/placeholders";
import { useCurrency } from "../../utils/useCurrency";

export const CUSTOMER_TYPES = [
  { value: "retail",    en: "Retail",     fr: "Detail" },
  { value: "wholesale", en: "Wholesale",  fr: "Grossiste" },
  { value: "vip",       en: "VIP",        fr: "VIP" },
  { value: "garage",    en: "Garage",     fr: "Garage" },
];
const EMPTY = { name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "", total_debt: "" };

export default function AddCustomerModal({ knownCustomers = [], onClose, onCreated, onExisting, existingVerb = "open" }) {
  const { lang } = useLangStore();
  const PH = usePlaceholders();
  const fmt = useCurrency();
  const qc = useQueryClient();
  const TYPES = CUSTOMER_TYPES;
  const [form, setForm] = useState(EMPTY);
  const [dupeMatch, setDupeMatch] = useState(null);
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // MP-CUSTOMER-DEDUP: digits-only phone normalizer (matches the backend).
  const normPhone = (p) => String(p || "").replace(/\D/g, "");
  // Submit handler with a client-side pre-check against the loaded list (instant
  // feedback); the backend 409 below is the authoritative guard (normalized,
  // covers list-miss / double-submit / race).
  const handleAddCustomer = () => {
    setDupeMatch(null);
    const inc = normPhone(form.phone);
    if (inc) {
      const local = (knownCustomers || []).find(c => normPhone(c.phone) === inc);
      if (local) { setDupeMatch({ id: local.id, name: local.name, phone: local.phone }); return; }
    }
    addMutation.mutate();
  };

  const addMutation = useMutation({
    mutationFn: () => api.post("/customers", { ...form, credit_limit: +form.credit_limit || 0, total_debt: +form.total_debt || 0 }),
    onSuccess: (res) => {
      toast.success(lang === "en" ? "Customer added!" : "Client ajoute!");
      setForm(EMPTY);
      qc.invalidateQueries(["customers"]);
      qc.invalidateQueries(["customer-summary"]);
      // MP-POS-CUSTOMER-FINDABLE: the POS sale-flow quick-pick reads a SEPARATE
      // cache key (["pos-customers"], 60s staleTime). The edit/collect paths
      // already refresh it; the ADD path did not, so a just-added customer was
      // absent from the sale search until the cache lapsed. Mirror the edit path.
      qc.invalidateQueries(["pos-customers"]);
      if (onCreated) onCreated(res?.data?.data || null);
    },
    onError: (err) => {
      // MP-CUSTOMER-DEDUP: backend rejected a same-phone duplicate — surface
      // the existing customer in the modal with an "open" offer.
      if (err.response?.status === 409 && err.response?.data?.code === "CUSTOMER_PHONE_EXISTS") {
        setDupeMatch(err.response.data.existing || null);
        return;
      }
      toast.error(err.response?.data?.message || "Error");
    }
  });

  const existingLabel = (m) => existingVerb === "use"
    ? (lang === "en" ? `Use ${m.name}` : `Choisir ${m.name}`)
    : (lang === "en" ? `Open ${m.name}` : `Ouvrir ${m.name}`);

  return (
        <div className="modal-overlay" onClick={() => onClose()}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Add New Customer" : "Ajouter un client"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={form.name} onChange={e => setF("name", e.target.value)} placeholder={PH.personName} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder={PH.phone} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Customer type" : "Type de client"}</label>
              <select className="input" value={form.customer_type} onChange={e => setF("customer_type", e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={form.address} onChange={e => setF("address", e.target.value)} placeholder={PH.city} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? `Credit limit (${fmt.symbol})` : `Limite credit (${fmt.symbol})`}</label>
              <input className="input" type="number" value={form.credit_limit} onChange={e => setF("credit_limit", e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? `Initial debt (${fmt.symbol})` : `Dette initiale (${fmt.symbol})`}</label>
              <input className="input" type="number" min="0" value={form.total_debt} onChange={e => setF("total_debt", e.target.value)} placeholder="0" />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en"
                  ? "If this customer already owes you money from before, enter the amount here. Leave 0 for new customers with no existing balance."
                  : "Si ce client vous doit déjà de l'argent, saisissez le montant ici. Laissez 0 pour un nouveau client sans solde."}
              </div>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes" : "Notes"}</label>
              <input className="input" value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder={lang === "en" ? "Optional notes..." : "Notes optionnelles..."} />
            </div>
            {dupeMatch && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, marginBottom: 8 }}>
                  ⚠️ {lang === "en"
                    ? `A customer with this phone already exists: ${dupeMatch.name}`
                    : `Un client avec ce numéro existe déjà : ${dupeMatch.name}`}
                </div>
                <button className="btn btn-primary btn-block" onClick={() => { const m = dupeMatch; setDupeMatch(null); onExisting(m); }}>
                  {existingLabel(dupeMatch)}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => onClose()}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!form.name || addMutation.isPending}
                onClick={handleAddCustomer}>
                {addMutation.isPending ? "..." : (lang === "en" ? "Add Customer" : "Ajouter")}
              </button>
            </div>
          </div>
        </div>
  );
}
