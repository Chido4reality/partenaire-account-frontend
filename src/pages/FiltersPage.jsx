// MP-FILTERS v2 (Peter, 2026-07-15) — REBUILT per Peter's own star-schema
// model. v1's tabs behaved as independent pages; Peter wants Power BI /
// Shopify Analytics behaviour: every selection NARROWS the others, the user
// never leaves the page, each click just adds another AND clause.
//
// MODEL: DIMENSIONS (chips, each adds a clause) = Date · Location · Staff ·
// Customer · Product · Transaction (5th — drills into ONE receipt). FACTS
// (chips, set the grain) = Sales · Inventory · Payment. A fact chip with no
// dimension = every row of that fact. A dimension chip with NO fact = the
// ROLLUP DASHBOARD for that entity ("everything about Kusi in one place").
// ONE backend query engine (GET /filters/query) — this file just renders
// whatever chip state it currently holds; it never special-cases a
// combination itself.
//
// 🔴 SECURITY: a cashier only ever sees their own activity — enforced
// SERVER-SIDE (backend/src/lib/filterScope.js) no matter which chips are
// set. The Staff picker here just reflects what the server already
// restricted (a cashier's picker comes back with only themself) — it is NOT
// the enforcement.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { hasFeature } from "../utils/planCapabilities";
import api from "../utils/api";
import { toIso, daysAgo } from "../components/common/DateRangeFilter";
import toast from "react-hot-toast";

const FACTS = [
  { key: "sales",     en: "Sales",     fr: "Ventes",      icon: "🧾" },
  { key: "inventory", en: "Inventory", fr: "Inventaire",  icon: "📦" },
  { key: "payment",   en: "Payment",   fr: "Paiement",    icon: "💵" },
];

function startOfMonth() { const d = new Date(); d.setDate(1); return toIso(d); }
const fmtNote = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return (y && m && d) ? `${d}/${m}/${y}` : String(iso); };

const card = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 };
const chipStyle = (active) => ({
  padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
  border: `1px solid ${active ? "var(--brand-light)" : "var(--border)"}`,
  background: active ? "var(--brand-light)" : "var(--bg-elevated)",
  color: active ? "#0b1220" : "var(--text-primary)",
});
const dimChipStyle = { padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1px solid var(--brand-light)", background: "rgba(251,197,3,0.12)", color: "var(--brand-light)", display: "inline-flex", alignItems: "center", gap: 6 };
const selStyle = { padding: "6px 10px", borderRadius: 8, fontSize: 12.5, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" };
const addChipBtn = { padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1px dashed var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" };

export default function FiltersPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const { user } = useAuthStore();
  const fmt = useCurrency();

  const [facts, setFacts] = useState(() => new Set(["sales"]));
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(toIso(new Date()));

  const [locationId, setLocationId] = useState(""); const [locationLabel, setLocationLabel] = useState("");
  const [staffId, setStaffId] = useState(""); const [staffLabel, setStaffLabel] = useState("");
  const [customerId, setCustomerId] = useState(""); const [customerLabel, setCustomerLabel] = useState("");
  const [productId, setProductId] = useState(""); const [productLabel, setProductLabel] = useState("");
  const [transactionId, setTransactionId] = useState("");

  const [openPicker, setOpenPicker] = useState(null); // 'location'|'staff'|'customer'|'product'|'transaction'|'date'
  const [pickerSearch, setPickerSearch] = useState("");
  const [txInput, setTxInput] = useState("");

  // Sales-only refinements.
  const [paymentMethod, setPaymentMethod] = useState("");
  const [status, setStatus] = useState("");
  const [damagedOnly, setDamagedOnly] = useState(false);
  const [belowCostOnly, setBelowCostOnly] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [needApprovalOnly, setNeedApprovalOnly] = useState(false);
  const [soldDateNoteOnly, setSoldDateNoteOnly] = useState(false);
  // Inventory-only refinement.
  const [movementType, setMovementType] = useState("");
  // Group + rank.
  const [groupBy, setGroupBy] = useState("");
  const [rankBy, setRankBy] = useState("total");

  const toggleFact = (f) => setFacts(prev => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const factsArr = [...facts];

  // ── pickers: location (from cached list), staff (server-scoped), customer/product (search) ──
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data) });
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  const staffPicker = useQuery({
    queryKey: ["filters-staff-picker", factsArr.join(",") || "sales"],
    queryFn: () => api.get(`/filters/staff-picker?scope=${factsArr[0] || "sales"}`).then(r => r.data?.data || []),
  });
  const pickerList = staffPicker.data || [];
  const whoRestricted = pickerList.length <= 1 && pickerList.some(p => p.id === user?.id) && !["owner", "manager", "accountant"].includes(user?.role);

  const custSearch = useQuery({
    queryKey: ["filters-cust-search", pickerSearch],
    queryFn: () => api.get(`/customers?search=${encodeURIComponent(pickerSearch)}`).then(r => r.data?.data || r.data || []),
    enabled: openPicker === "customer" && pickerSearch.trim().length >= 1,
  });
  const prodSearch = useQuery({
    queryKey: ["filters-prod-search", pickerSearch],
    queryFn: () => api.get(`/products?search=${encodeURIComponent(pickerSearch)}`).then(r => r.data?.data || r.data || []),
    enabled: openPicker === "product" && pickerSearch.trim().length >= 1,
  });

  const planResp = useQuery({ queryKey: ["my-plan"], queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data), staleTime: 60000 });
  const canExport = hasFeature(planResp.data?.data?.effective_plan || "trial", "filters_export");

  const baseParams = () => {
    const p = new URLSearchParams({ from, to });
    if (locationId) p.set("location_id", locationId);
    if (staffId) p.set("staff_id", staffId);
    if (customerId) p.set("customer_id", customerId);
    if (productId) p.set("product_id", productId);
    return p;
  };
  const qs = () => {
    const p = baseParams();
    if (factsArr.length) p.set("facts", factsArr.join(","));
    if (factsArr.includes("sales")) {
      if (paymentMethod) p.set("payment_method", paymentMethod);
      if (status) p.set("status", status);
      if (damagedOnly) p.set("damaged_only", "true");
      if (belowCostOnly) p.set("below_cost_only", "true");
      if (discountedOnly) p.set("discounted_only", "true");
      if (needApprovalOnly) p.set("needed_approval_only", "true");
      if (soldDateNoteOnly) p.set("has_sold_date_note", "true");
    }
    if (factsArr.includes("inventory") && movementType) p.set("movement_type", movementType);
    if (factsArr.length === 1 && groupBy) { p.set("group_by", groupBy); p.set("rank_by", rankBy); }
    return p.toString();
  };

  const txQuery = useQuery({
    queryKey: ["filters-transaction", transactionId],
    queryFn: () => api.get(`/filters/transaction/${transactionId}`).then(r => r.data),
    enabled: !!transactionId,
  });

  const mainQuery = useQuery({
    queryKey: ["filters-query", qs(), transactionId],
    queryFn: () => api.get(`/filters/query?${qs()}`).then(r => r.data),
    enabled: !transactionId,
  });

  const hasAnyDim = !!(locationId || staffId || customerId || productId);
  const mode = mainQuery.data?.mode;

  const doExport = async () => {
    if (factsArr.length !== 1) { toast(en ? "Select exactly one fact to export." : "Sélectionnez un seul fait à exporter."); return; }
    try {
      const p = baseParams();
      p.set("fact", factsArr[0]);
      const res = await api.get(`/filters/export?${p.toString()}`, { responseType: "blob" });
      if (res.data?.type === "application/json") {
        const parsed = JSON.parse(await res.data.text());
        if (parsed.empty) { toast(en ? "Nothing to export for this filter." : "Rien à exporter pour ce filtre."); return; }
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `mp-${factsArr[0]}-${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(en ? "Export failed" : "Échec de l'export"); }
  };

  const clearDim = (which) => {
    if (which === "location") { setLocationId(""); setLocationLabel(""); }
    if (which === "staff") { setStaffId(""); setStaffLabel(""); }
    if (which === "customer") { setCustomerId(""); setCustomerLabel(""); }
    if (which === "product") { setProductId(""); setProductLabel(""); }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>🔎 {en ? "Filters" : "Filtres"}</h1>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
        {en ? "Pick a fact to list its rows, or a person/place/thing with no fact for its rollup — every chip narrows the rest." : "Choisissez un fait pour lister ses lignes, ou une personne/lieu/produit sans fait pour son bilan — chaque puce affine le reste."}
      </p>

      {transactionId ? (
        <TransactionView txQuery={txQuery} en={en} fmt={fmt} onClose={() => setTransactionId("")} />
      ) : (
        <>
          {/* FACT CHIPS */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {FACTS.map(f => (
              <button key={f.key} onClick={() => toggleFact(f.key)} style={chipStyle(facts.has(f.key))}>
                {facts.has(f.key) ? "✓" : f.icon} {en ? f.en : f.fr}
              </button>
            ))}
          </div>

          {/* DIMENSION CHIPS */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
            {/* DATE — always active, shown as an editable chip */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setOpenPicker(openPicker === "date" ? null : "date")} style={dimChipStyle}>
                📅 {from === to ? from : `${from} → ${to}`}
              </button>
              {openPicker === "date" && (
                <PickerPopover onClose={() => setOpenPicker(null)}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button style={selStyle} onClick={() => { setFrom(toIso(new Date())); setTo(toIso(new Date())); setOpenPicker(null); }}>{en ? "Today" : "Aujourd'hui"}</button>
                    <button style={selStyle} onClick={() => { const y = daysAgo(1); setFrom(y); setTo(y); setOpenPicker(null); }}>{en ? "Yesterday" : "Hier"}</button>
                    <button style={selStyle} onClick={() => { setFrom(daysAgo(6)); setTo(toIso(new Date())); setOpenPicker(null); }}>{en ? "7 days" : "7 jours"}</button>
                    <button style={selStyle} onClick={() => { setFrom(daysAgo(29)); setTo(toIso(new Date())); setOpenPicker(null); }}>{en ? "30 days" : "30 jours"}</button>
                    <button style={selStyle} onClick={() => { setFrom(startOfMonth()); setTo(toIso(new Date())); setOpenPicker(null); }}>{en ? "This month" : "Ce mois"}</button>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
                    <span>→</span>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
                  </div>
                </PickerPopover>
              )}
            </div>

            {/* LOCATION */}
            {locationId ? (
              <RemovableChip label={`${en ? "Location" : "Emplacement"}: ${locationLabel}`} onRemove={() => clearDim("location")} />
            ) : (
              <div style={{ position: "relative" }}>
                <button onClick={() => setOpenPicker(openPicker === "location" ? null : "location")} style={addChipBtn}>+ {en ? "Location" : "Emplacement"}</button>
                {openPicker === "location" && (
                  <PickerPopover onClose={() => setOpenPicker(null)}>
                    {locList.map(l => (
                      <PickerRow key={l.id} label={l.name} onClick={() => { setLocationId(l.id); setLocationLabel(l.name); setOpenPicker(null); }} />
                    ))}
                    {!locList.length && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{en ? "No locations" : "Aucun emplacement"}</div>}
                  </PickerPopover>
                )}
              </div>
            )}

            {/* STAFF */}
            {!whoRestricted && (staffId ? (
              <RemovableChip label={`${en ? "Staff" : "Personnel"}: ${staffLabel}`} onRemove={() => clearDim("staff")} />
            ) : (
              <div style={{ position: "relative" }}>
                <button onClick={() => setOpenPicker(openPicker === "staff" ? null : "staff")} style={addChipBtn}>+ {en ? "Staff" : "Personnel"}</button>
                {openPicker === "staff" && (
                  <PickerPopover onClose={() => setOpenPicker(null)}>
                    {pickerList.map(p => (
                      <PickerRow key={p.id} label={p.full_name} sub={p.role} onClick={() => { setStaffId(p.id); setStaffLabel(p.full_name); setOpenPicker(null); }} />
                    ))}
                  </PickerPopover>
                )}
              </div>
            ))}
            {whoRestricted && <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>{en ? "· only your own activity" : "· votre activité uniquement"}</span>}

            {/* CUSTOMER */}
            {customerId ? (
              <RemovableChip label={`${en ? "Customer" : "Client"}: ${customerLabel}`} onRemove={() => clearDim("customer")} />
            ) : (
              <div style={{ position: "relative" }}>
                <button onClick={() => { setOpenPicker(openPicker === "customer" ? null : "customer"); setPickerSearch(""); }} style={addChipBtn}>+ {en ? "Customer" : "Client"}</button>
                {openPicker === "customer" && (
                  <PickerPopover onClose={() => setOpenPicker(null)}>
                    <input autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder={en ? "Search customers…" : "Rechercher un client…"} style={{ ...selStyle, width: "100%", marginBottom: 6 }} />
                    {(custSearch.data || []).slice(0, 20).map(c => (
                      <PickerRow key={c.id} label={c.name} sub={c.phone} onClick={() => { setCustomerId(c.id); setCustomerLabel(c.name); setOpenPicker(null); }} />
                    ))}
                  </PickerPopover>
                )}
              </div>
            )}

            {/* PRODUCT */}
            {productId ? (
              <RemovableChip label={`${en ? "Product" : "Produit"}: ${productLabel}`} onRemove={() => clearDim("product")} />
            ) : (
              <div style={{ position: "relative" }}>
                <button onClick={() => { setOpenPicker(openPicker === "product" ? null : "product"); setPickerSearch(""); }} style={addChipBtn}>+ {en ? "Product" : "Produit"}</button>
                {openPicker === "product" && (
                  <PickerPopover onClose={() => setOpenPicker(null)}>
                    <input autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder={en ? "Search products…" : "Rechercher un produit…"} style={{ ...selStyle, width: "100%", marginBottom: 6 }} />
                    {(prodSearch.data || []).slice(0, 20).map(p => (
                      <PickerRow key={p.id} label={p.name} onClick={() => { setProductId(p.id); setProductLabel(p.name); setOpenPicker(null); }} />
                    ))}
                  </PickerPopover>
                )}
              </div>
            )}

            {/* TRANSACTION (5th dimension) */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setOpenPicker(openPicker === "transaction" ? null : "transaction")} style={addChipBtn}>+ {en ? "Open a receipt" : "Ouvrir un reçu"}</button>
              {openPicker === "transaction" && (
                <PickerPopover onClose={() => setOpenPicker(null)}>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>{en ? "Click a sale row below, or paste a transaction id:" : "Cliquez une vente ci-dessous, ou collez un id de transaction :"}</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={txInput} onChange={e => setTxInput(e.target.value)} placeholder="uuid" style={{ ...selStyle, flex: 1 }} />
                    <button style={selStyle} onClick={() => { if (txInput.trim()) { setTransactionId(txInput.trim()); setOpenPicker(null); } }}>{en ? "Open" : "Ouvrir"}</button>
                  </div>
                </PickerPopover>
              )}
            </div>

            {canExport && factsArr.length === 1 && (
              <button onClick={doExport} style={{ marginLeft: "auto", ...selStyle, cursor: "pointer", fontWeight: 700 }}>⬇ {en ? "Export CSV" : "Exporter CSV"}</button>
            )}
          </div>

          {/* SALES / INVENTORY REFINEMENTS */}
          {(factsArr.includes("sales") || factsArr.includes("inventory")) && (
            <div style={{ ...card, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {factsArr.includes("sales") && (<>
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
                <Toggle label={en ? "Damaged only" : "Endommagé seulement"} checked={damagedOnly} onChange={setDamagedOnly} />
                <Toggle label={en ? "Below-cost only" : "Sous le coût seulement"} checked={belowCostOnly} onChange={setBelowCostOnly} />
                <Toggle label={en ? "Discounted only" : "Remisé seulement"} checked={discountedOnly} onChange={setDiscountedOnly} />
                <Toggle label={en ? "Needed approval only" : "A nécessité approbation"} checked={needApprovalOnly} onChange={setNeedApprovalOnly} />
                <Toggle label={en ? "Has sold-date note" : "A une note de date de vente"} checked={soldDateNoteOnly} onChange={setSoldDateNoteOnly} />
              </>)}
              {factsArr.includes("inventory") && (
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
            </div>
          )}

          {/* GROUP + RANK (single-fact only) */}
          {factsArr.length === 1 && (
            <div style={{ ...card, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{en ? "Group by:" : "Grouper par :"}</span>
              <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selStyle}>
                <option value="">{en ? "No grouping" : "Aucun groupement"}</option>
                <option value="staff">{en ? "Staff" : "Personnel"}</option>
                <option value="location">{en ? "Location" : "Emplacement"}</option>
                <option value="customer">{en ? "Customer" : "Client"}</option>
                <option value="product">{en ? "Product" : "Produit"}</option>
                <option value="date">{en ? "Date" : "Date"}</option>
              </select>
              {groupBy && (
                <select value={rankBy} onChange={e => setRankBy(e.target.value)} style={selStyle}>
                  <option value="total">{en ? "Rank by total" : "Classer par total"}</option>
                  <option value="count">{en ? "Rank by count" : "Classer par nombre"}</option>
                </select>
              )}
            </div>
          )}

          {/* RESULTS */}
          {mainQuery.isLoading ? (
            <div style={{ ...card, textAlign: "center", padding: 30, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
          ) : mainQuery.isError ? (
            // MP-FILTER-PERMISSION: filter_policy='block' 403s with code
            // filter_blocked — a clear "ask the boss" message, not a generic
            // "try again" that reads like a network hiccup.
            <div style={{ ...card, textAlign: "center", padding: 30, color: "#f87171" }}>
              {mainQuery.error?.response?.data?.code === "filter_blocked"
                ? (en ? "You are not allowed to use Filters. Ask the boss." : "Vous n'êtes pas autorisé à utiliser les Filtres. Demandez au patron.")
                : (en ? "Could not load — try again." : "Échec du chargement — réessayez.")}
            </div>
          ) : mode === "empty" ? (
            <div style={{ ...card, textAlign: "center", padding: 30, color: "var(--text-muted)" }}>{mainQuery.data.message}</div>
          ) : mode === "rollup" ? (
            <RollupCard rollup={mainQuery.data.rollup} dims={mainQuery.data.dims} labels={{ locationLabel, staffLabel, customerLabel, productLabel }} en={en} fmt={fmt} />
          ) : mode === "facts" ? (
            <FactResults data={mainQuery.data} en={en} fmt={fmt} onOpenTransaction={setTransactionId} hasAnyDim={hasAnyDim} />
          ) : null}
        </>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function RemovableChip({ label, onRemove }) {
  return (
    <span style={dimChipStyle}>
      ✓ {label}
      <button onClick={onRemove} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 800, padding: 0, marginLeft: 2 }}>✕</button>
    </span>
  );
}

function PickerPopover({ children, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41, minWidth: 220, maxWidth: 300, maxHeight: 280, overflowY: "auto", ...card, boxShadow: "0 12px 28px rgba(0,0,0,0.4)" }}>
        {children}
      </div>
    </>
  );
}

function PickerRow({ label, sub, onClick }) {
  return (
    <div onClick={onClick} style={{ padding: "6px 4px", cursor: "pointer", borderRadius: 6, fontSize: 12.5 }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-elevated)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{sub}</div>}
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

// "Everything about <entity> in one place" — the dashboard shown when a
// dimension chip is set with NO fact chip active.
function RollupCard({ rollup, labels, en, fmt }) {
  const who = labels.staffLabel || labels.customerLabel || labels.productLabel || labels.locationLabel || (en ? "This selection" : "Cette sélection");
  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>📋 {who} — {en ? "everything in one place" : "tout en un coup d'œil"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <Stat label={en ? "Sales" : "Ventes"} value={rollup.sales_count} />
        <Stat label={en ? "Revenue" : "Chiffre d'affaires"} value={fmt(rollup.revenue)} />
        <Stat label={en ? "Inventory added" : "Inventaire ajouté"} value={rollup.inventory_added} />
        <Stat label={en ? "Inventory removed" : "Inventaire retiré"} value={rollup.inventory_removed} />
        <Stat label={en ? "Customers served" : "Clients servis"} value={rollup.customers_served} />
        <Stat label={en ? "Returns" : "Retours"} value={`${rollup.returns_count} (${fmt(rollup.returns_value)})`} />
        <Stat label={en ? "Cash received" : "Espèces reçues"} value={fmt(rollup.cash_received)} />
        <Stat label={en ? "Credit given" : "Crédit accordé"} value={fmt(rollup.credit_given)} />
        {rollup.damaged_count > 0 && <Stat label={en ? "Damaged lines" : "Lignes endommagées"} value={rollup.damaged_count} />}
      </div>
    </div>
  );
}

function FactResults({ data, en, fmt, onOpenTransaction, hasAnyDim }) {
  const { facts, results, summary, group } = data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {group && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🏆 {en ? "Ranked" : "Classement"}</div>
          {group.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{en ? "No data" : "Aucune donnée"}</div>
          ) : group.map((g, i) => (
            <div key={g.key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13 }}><strong>#{i + 1}</strong> {g.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(g.total)} · {g.count} {en ? "rows" : "lignes"}</span>
            </div>
          ))}
        </div>
      )}
      {facts.map(f => (
        <div key={f} style={card}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <Stat label={`${en ? "Rows" : "Lignes"} (${f})`} value={summary[f]?.count ?? 0} />
            <Stat label={en ? "Total value" : "Valeur totale"} value={fmt(summary[f]?.total || 0)} />
          </div>
          {(results[f] || []).length === 0 ? (
            <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 12.5 }}>{en ? "No rows for this filter." : "Aucune ligne pour ce filtre."}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 500, overflowY: "auto" }}>
              {(results[f] || []).slice(0, 300).map((r, i) => (
                <FactRow key={r.transaction_id ? `${r.transaction_id}-${i}` : i} row={r} fact={f} en={en} fmt={fmt} onOpenTransaction={onOpenTransaction} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FactRow({ row, fact, en, fmt, onOpenTransaction }) {
  const clickable = fact === "sales" && row.transaction_id;
  const tags = [];
  if (fact === "sales") {
    if (row.status === "voided") tags.push(en ? "voided" : "annulé");
    if (row.is_damaged) tags.push(en ? "damaged" : "endommagé");
    if (row.is_below_cost) tags.push(en ? "below-cost" : "sous coût");
    if (row.discount > 0) tags.push(en ? "discounted" : "remisé");
    if (row.sold_date_note) tags.push(`📝 ${en ? "sold-date" : "date de vente"}: ${fmtNote(row.sold_date_note)}${row.sold_date_note_by_name ? ` (${row.sold_date_note_by_name})` : ""}`);
  }
  if (fact === "inventory" && row.is_oversell) tags.push(en ? "oversell" : "rupture");

  const title = fact === "sales" ? (row.sale_number || row.product_name) : fact === "inventory" ? row.product_name : (row.sale_number || (en ? "Payment" : "Paiement"));
  const subtitle = [
    fact === "sales" && row.product_name,
    row.staff_name,
    row.customer_name,
    row.location_name,
    fact === "inventory" && row.status,
    fact === "payment" && row.payment_type,
  ].filter(Boolean).join(" · ");

  return (
    <div onClick={clickable ? () => onOpenTransaction(row.transaction_id) : undefined}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 6px", borderBottom: "1px solid var(--border)", gap: 8, cursor: clickable ? "pointer" : "default" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}{clickable && " ›"}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{subtitle}{row.date ? ` · ${String(row.date).slice(0, 10)}` : ""}</div>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
            {tags.map((t, i) => <span key={i} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(251,197,3,0.12)", color: "var(--brand-light)", fontWeight: 700 }}>{t}</span>)}
          </div>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{fmt(row.amount)}</div>
    </div>
  );
}

// 5th DIMENSION — receipt as source of truth: receipt # → date → staff →
// customer → items → payments → discount → profit → inventory deduction.
function TransactionView({ txQuery, en, fmt, onClose }) {
  const d = txQuery.data?.data;
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 {en ? "Transaction" : "Transaction"}</div>
        <button onClick={onClose} style={{ ...selStyle, cursor: "pointer" }}>✕ {en ? "Close" : "Fermer"}</button>
      </div>
      {txQuery.isLoading ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : txQuery.isError ? (
        <div style={{ textAlign: "center", padding: 20, color: "#f87171" }}>{txQuery.error?.response?.data?.message || (en ? "Could not load this transaction." : "Impossible de charger cette transaction.")}</div>
      ) : !d ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <Row label={en ? "Receipt #" : "Reçu n°"} value={d.sale_number} />
          <Row label={en ? "Date" : "Date"} value={`${d.date} (${new Date(d.created_at).toLocaleString()})`} />
          <Row label={en ? "Staff" : "Personnel"} value={d.staff_name || "—"} />
          <Row label={en ? "Customer" : "Client"} value={d.customer_name || (en ? "Walk-in" : "Comptant")} />
          <Row label={en ? "Location" : "Emplacement"} value={d.location_name || "—"} />
          <Row label={en ? "Status" : "Statut"} value={d.status} />

          {d.sold_date_note && (
            <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", color: "#fbbf24", fontSize: 12.5 }}>
              {en ? `NOTE — Sold Date: ${fmtNote(d.sold_date_note)}${d.sold_date_note_by_name ? ` (recorded by ${d.sold_date_note_by_name})` : ""}`
                  : `NOTE — Date de vente : ${fmtNote(d.sold_date_note)}${d.sold_date_note_by_name ? ` (saisi par ${d.sold_date_note_by_name})` : ""}`}
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{en ? "Items" : "Articles"}</div>
            {d.items.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>{it.name}{it.is_damaged ? " (DAMAGED)" : ""} × {it.quantity}</span>
                <span>{fmt(it.quantity * it.unit_price - (it.discount_amount || 0))}</span>
              </div>
            ))}
          </div>

          {d.payments.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{en ? "Payments" : "Paiements"}</div>
              {d.payments.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span>{p.payment_method} · {p.payment_date}</span>
                  <span>{fmt(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexWrap: "wrap", gap: 20 }}>
            <Row label={en ? "Discount" : "Remise"} value={fmt(d.discount_amount)} />
            <Row label={en ? "Revenue" : "Revenu"} value={fmt(d.revenue)} />
            <Row label={en ? "Cost" : "Coût"} value={fmt(d.cost)} />
            <Row label={en ? "Profit" : "Profit"} value={fmt(d.profit)} />
          </div>

          {d.inventory_deduction.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{en ? "Inventory deduction" : "Déduction d'inventaire"}</div>
              {d.inventory_deduction.map((m, i) => {
                const name = d.items.find(it => it.product_id === m.product_id)?.name || m.product_id;
                return <div key={i} style={{ fontSize: 12, color: "var(--text-muted)" }}>{name} · {m.quantity}</div>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div>
      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{label}: </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
