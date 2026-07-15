// MP-FILTERS (Peter, 2026-07-15) — "what / who / when" clarity screen.
// 4 scope tabs (Sales/Staff/Inventory/Customers), a universal WHEN/WHERE/WHO
// bar, scope-specific filters, a results list, and a summary band at the top
// of every result set — the summary band is the point: "Kusi, last 7 days,
// Bepanda → 42 sales, 380,000, 12% margin" is the answer a boss actually wants.
//
// 🔴 SECURITY: a cashier only ever sees their own activity — enforced
// SERVER-SIDE (backend/src/lib/filterScope.js), not by anything in this file.
// The WHO picker here just reflects what the server already restricted (a
// cashier's picker comes back with only themself, so the control hides
// itself) — it is NOT the enforcement.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";
import { toIso, daysAgo } from "../components/common/DateRangeFilter";
import toast from "react-hot-toast";

const TABS = [
  { key: "sales",      en: "Sales",      fr: "Ventes" },
  { key: "staff",      en: "Staff",      fr: "Personnel" },
  { key: "inventory",  en: "Inventory",  fr: "Inventaire" },
  { key: "customers",  en: "Customers",  fr: "Clients" },
];

function startOfMonth() {
  const d = new Date(); d.setDate(1);
  return toIso(d);
}

const card = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 };
const chip = (active) => ({
  padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
  border: `1px solid ${active ? "var(--brand-light)" : "var(--border)"}`,
  background: active ? "var(--brand-light)" : "var(--bg-elevated)",
  color: active ? "#0b1220" : "var(--text-primary)", cursor: "pointer",
});
const selStyle = { padding: "6px 10px", borderRadius: 8, fontSize: 12.5, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" };

export default function FiltersPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const { user } = useAuthStore();
  const fmt = useCurrency();

  const [tab, setTab] = useState("sales");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(toIso(new Date()));
  const [locationId, setLocationId] = useState("");
  const [userId, setUserId] = useState("");

  // Scope-specific filters.
  const [paymentMethod, setPaymentMethod] = useState("");
  const [status, setStatus] = useState("");
  const [damagedOnly, setDamagedOnly] = useState(false);
  const [belowCostOnly, setBelowCostOnly] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [needApprovalOnly, setNeedApprovalOnly] = useState(false);
  const [soldDateNoteOnly, setSoldDateNoteOnly] = useState(false);
  const [action, setAction] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [movementType, setMovementType] = useState("");
  const [debtStatus, setDebtStatus] = useState("");

  const locs = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
  });
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  const staffPicker = useQuery({
    queryKey: ["filters-staff-picker", tab],
    queryFn: () => api.get(`/filters/staff-picker?scope=${tab}`).then(r => r.data?.data || []),
  });
  const pickerList = staffPicker.data || [];
  // Server restricted us to just ourselves — hide the WHO control instead of
  // showing a picker with one option nobody can change.
  const whoRestricted = pickerList.length <= 1 && pickerList.some(p => p.id === user?.id) && user?.role !== "owner" && user?.role !== "manager" && user?.role !== "accountant";

  const planResp = useQuery({
    queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000,
  });
  const canExport = hasFeature(planResp.data?.data?.effective_plan || "trial", "filters_export");

  const qs = () => {
    const p = new URLSearchParams({ from, to });
    if (locationId) p.set("location_id", locationId);
    if (userId) p.set("user_id", userId);
    if (tab === "sales") {
      if (paymentMethod) p.set("payment_method", paymentMethod);
      if (status) p.set("status", status);
      if (damagedOnly) p.set("damaged_only", "true");
      if (belowCostOnly) p.set("below_cost_only", "true");
      if (discountedOnly) p.set("discounted_only", "true");
      if (needApprovalOnly) p.set("needed_approval_only", "true");
      if (soldDateNoteOnly) p.set("has_sold_date_note", "true");
    } else if (tab === "staff") {
      if (action) p.set("action", action);
      if (riskOnly) p.set("risk_only", "true");
    } else if (tab === "inventory") {
      if (movementType) p.set("movement_type", movementType);
    } else if (tab === "customers") {
      if (debtStatus) p.set("debt_status", debtStatus);
    }
    return p.toString();
  };

  const result = useQuery({
    queryKey: ["filters", tab, from, to, locationId, userId, paymentMethod, status, damagedOnly, belowCostOnly, discountedOnly, needApprovalOnly, soldDateNoteOnly, action, riskOnly, movementType, debtStatus],
    queryFn: () => api.get(`/filters/${tab}?${qs()}`).then(r => r.data),
  });
  const rows = result.data?.data || [];
  const summary = result.data?.summary || {};

  const doExport = async () => {
    try {
      const res = await api.get(`/filters/export?scope=${tab}&${qs()}`, { responseType: "blob" });
      if (res.data?.type === "application/json") {
        const text = await res.data.text();
        const parsed = JSON.parse(text);
        if (parsed.empty) { toast(en ? "Nothing to export for this filter." : "Rien à exporter pour ce filtre."); return; }
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `mp-${tab}-${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(en ? "Export failed" : "Échec de l'export");
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>🔎 {en ? "Filters" : "Filtres"}</h1>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
        {en ? "What was sold/done, who did it, and when." : "Ce qui a été vendu/fait, par qui, et quand."}
      </p>

      {/* SCOPE TABS */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "8px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer",
              border: `1px solid ${tab === t.key ? "var(--brand-light)" : "var(--border)"}`,
              background: tab === t.key ? "var(--brand-light)" : "var(--bg-card)",
              color: tab === t.key ? "#0b1220" : "var(--text-primary)" }}>
            {en ? t.en : t.fr}
          </button>
        ))}
      </div>

      {/* UNIVERSAL BAR: WHEN / WHERE / WHO */}
      <div style={{ ...card, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => { setFrom(toIso(new Date())); setTo(toIso(new Date())); }} style={chip(from === toIso(new Date()) && to === toIso(new Date()))}>{en ? "Today" : "Aujourd'hui"}</button>
          <button onClick={() => { const y = daysAgo(1); setFrom(y); setTo(y); }} style={chip(from === daysAgo(1) && to === daysAgo(1))}>{en ? "Yesterday" : "Hier"}</button>
          <button onClick={() => { setFrom(daysAgo(6)); setTo(toIso(new Date())); }} style={chip(from === daysAgo(6) && to === toIso(new Date()))}>{en ? "7 days" : "7 jours"}</button>
          <button onClick={() => { setFrom(daysAgo(29)); setTo(toIso(new Date())); }} style={chip(from === daysAgo(29) && to === toIso(new Date()))}>{en ? "30 days" : "30 jours"}</button>
          <button onClick={() => { setFrom(startOfMonth()); setTo(toIso(new Date())); }} style={chip(from === startOfMonth())}>{en ? "This month" : "Ce mois"}</button>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
          <span style={{ color: "var(--text-muted)" }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        <select value={locationId} onChange={e => setLocationId(e.target.value)} style={selStyle}>
          <option value="">{en ? "All locations" : "Tous les emplacements"}</option>
          {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {!whoRestricted && (
          <select value={userId} onChange={e => setUserId(e.target.value)} style={selStyle}>
            <option value="">{en ? "All staff" : "Tout le personnel"}</option>
            {pickerList.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
        {whoRestricted && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" }}>
            {en ? "Showing only your own activity" : "Affiche uniquement votre activité"}
          </span>
        )}
        {canExport && (
          <button onClick={doExport} style={{ marginLeft: "auto", ...selStyle, cursor: "pointer", fontWeight: 700 }}>
            ⬇ {en ? "Export CSV" : "Exporter CSV"}
          </button>
        )}
      </div>

      {/* SCOPE-SPECIFIC FILTERS */}
      <div style={{ ...card, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {tab === "sales" && (<>
          <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={selStyle}>
            <option value="">{en ? "Any payment method" : "Tout mode de paiement"}</option>
            <option value="cash">{en ? "Cash" : "Espèces"}</option>
            <option value="mobile_money">{en ? "Mobile Money" : "Mobile Money"}</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
            <option value="">{en ? "Any status" : "Tout statut"}</option>
            <option value="paid">{en ? "Paid" : "Payé"}</option>
            <option value="partial">{en ? "Partial" : "Partiel"}</option>
            <option value="credit">{en ? "Credit" : "Crédit"}</option>
            <option value="voided">{en ? "Voided" : "Annulé"}</option>
          </select>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={damagedOnly} onChange={e => setDamagedOnly(e.target.checked)} /> {en ? "Damaged only" : "Endommagé seulement"}
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={belowCostOnly} onChange={e => setBelowCostOnly(e.target.checked)} /> {en ? "Below-cost only" : "Sous le coût seulement"}
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={discountedOnly} onChange={e => setDiscountedOnly(e.target.checked)} /> {en ? "Discounted only" : "Remisé seulement"}
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={needApprovalOnly} onChange={e => setNeedApprovalOnly(e.target.checked)} /> {en ? "Needed approval only" : "A nécessité approbation"}
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={soldDateNoteOnly} onChange={e => setSoldDateNoteOnly(e.target.checked)} /> {en ? "Has sold-date note" : "A une note de date de vente"}
          </label>
        </>)}
        {tab === "staff" && (<>
          <input value={action} onChange={e => setAction(e.target.value)} placeholder={en ? "action (e.g. sale_voided)" : "action (ex. sale_voided)"} style={selStyle} />
          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={riskOnly} onChange={e => setRiskOnly(e.target.checked)} /> {en ? "Things to check only" : "À vérifier seulement"}
          </label>
        </>)}
        {tab === "inventory" && (
          <select value={movementType} onChange={e => setMovementType(e.target.value)} style={selStyle}>
            <option value="">{en ? "Any movement" : "Tout mouvement"}</option>
            <option value="receive">{en ? "Received (goods in)" : "Reçu (entrée)"}</option>
            <option value="transfer">{en ? "Transferred" : "Transféré"}</option>
            <option value="adjust">{en ? "Adjusted by hand" : "Ajusté à la main"}</option>
            <option value="count">{en ? "Counted" : "Compté"}</option>
            <option value="damage_writeoff">{en ? "Marked damaged" : "Marqué endommagé"}</option>
            <option value="damage_scrap">{en ? "Scrapped" : "Mis au rebut"}</option>
            <option value="sale">{en ? "Sold" : "Vendu"}</option>
          </select>
        )}
        {tab === "customers" && (
          <select value={debtStatus} onChange={e => setDebtStatus(e.target.value)} style={selStyle}>
            <option value="">{en ? "Any debt status" : "Tout statut de dette"}</option>
            <option value="owing">{en ? "Owing" : "Doit"}</option>
            <option value="clear">{en ? "Clear" : "À jour"}</option>
          </select>
        )}
      </div>

      {/* SUMMARY BAND */}
      <div style={{ ...card, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 20 }}>
        {tab === "sales" && (<>
          <Stat label={en ? "Sales" : "Ventes"} value={summary.count ?? 0} />
          <Stat label={en ? "Total" : "Total"} value={fmt(summary.total || 0)} />
          <Stat label={en ? "Margin" : "Marge"} value={`${summary.margin_pct ?? 0}%`} />
        </>)}
        {tab === "staff" && (<>
          <Stat label={en ? "Actions" : "Actions"} value={summary.count ?? summary.total_actions ?? 0} />
          <Stat label={en ? "High-risk" : "Haut risque"} value={summary.high_count ?? 0} />
          <Stat label={en ? "Medium-risk" : "Risque moyen"} value={summary.medium_count ?? 0} />
        </>)}
        {tab === "inventory" && (<>
          <Stat label={en ? "Goods in" : "Entrées"} value={summary.goods_in_count ?? 0} />
          <Stat label={en ? "Goods-in value" : "Valeur entrées"} value={fmt(summary.goods_in_value || 0)} />
          <Stat label={en ? "Goods out" : "Sorties"} value={summary.goods_out_count ?? 0} />
          <Stat label={en ? "Hand-adjusted" : "Ajusté à la main"} value={summary.hand_adjust_count ?? 0} />
          <Stat label={en ? "Damaged/scrapped" : "Endommagé/rebut"} value={summary.damaged_count ?? 0} />
        </>)}
        {tab === "customers" && (<>
          <Stat label={en ? "Customers" : "Clients"} value={summary.count ?? 0} />
          <Stat label={en ? "Total owed" : "Total dû"} value={fmt(summary.total_debt || 0)} />
        </>)}
      </div>

      {/* RESULTS */}
      <div style={card}>
        {result.isLoading ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
        ) : result.isError ? (
          <div style={{ textAlign: "center", padding: 20, color: "#f87171" }}>{en ? "Could not load — try again." : "Échec du chargement — réessayez."}</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>{en ? "No results for this filter." : "Aucun résultat pour ce filtre."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tab === "sales" && rows.map(r => (
              <ResultRow key={r.id}
                title={r.sale_number}
                subtitle={[r.customer_name, r.location_name].filter(Boolean).join(" · ")}
                right={fmt(r.total_amount)}
                tags={[r.is_voided && (en ? "voided" : "annulé"), r.has_damaged && (en ? "damaged" : "endommagé"), r.has_below_cost && (en ? "below-cost" : "sous coût"), r.discount_amount > 0 && (en ? "discounted" : "remisé"), r.sold_date_note && (en ? "sold-date note" : "note date")].filter(Boolean)}
                date={r.sale_date} en={en} />
            ))}
            {tab === "staff" && rows.map(r => (
              <ResultRow key={r.id}
                title={r.actor_name || "—"}
                subtitle={r.action}
                right={r.amount != null ? fmt(r.amount) : ""}
                tags={[r.risk_level !== "normal" && r.risk_level]}
                date={r.created_at} en={en} />
            ))}
            {tab === "inventory" && rows.map(r => (
              <ResultRow key={r.id}
                title={r.product_name || "—"}
                subtitle={`${r.movement_type} · ${r.performed_by_name || "—"}`}
                right={r.cost_value > 0 ? fmt(r.cost_value) : String(r.quantity)}
                tags={[r.is_oversell && (en ? "oversell" : "rupture")].filter(Boolean)}
                date={r.created_at} en={en} />
            ))}
            {tab === "customers" && rows.map(r => (
              <ResultRow key={r.id}
                title={r.name}
                subtitle={r.phone || ""}
                right={fmt(r.total_debt)}
                tags={[Number(r.total_debt) > 0 && (en ? "owing" : "doit")].filter(Boolean)}
                en={en} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand-light)" }}>{value}</div>
    </div>
  );
}

function ResultRow({ title, subtitle, right, tags = [], date, en }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 6px", borderBottom: "1px solid var(--border)", gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{subtitle}{date ? ` · ${String(date).slice(0, 10)}` : ""}</div>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
            {tags.map((t, i) => (
              <span key={i} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(251,197,3,0.12)", color: "var(--brand-light)", fontWeight: 700 }}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{right}</div>
    </div>
  );
}
