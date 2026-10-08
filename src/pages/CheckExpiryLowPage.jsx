// CHECK EXPIRY / LOW (Peter, 2026-10-04) — "Check Expiry/Low" / "Vérif. Expiration/Stock bas".
// One screen for what needs attention on the shelf, replacing the Expiring stock page:
//   Tab 1 FILTER   — chips (date / location / category / product / type) + group-by,
//                    with row actions (write off expired, restock low).
//   Tab 2 EXPIRING — every dated lot, expired first (red), then soonest expiry.
//   Tab 3 LOW      — per-location low stock (alert on); sold here in 30 days first, then the rest.
// Expiry quantities are an ESTIMATE (pa_expiry_estimate: oldest stock sold first).
// Data: GET /expiry/check (Pro and above — track_expiry). Low-stock rule lives in
// routes/expiry.js isLowRow; this screen never re-derives it.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import useExpiryFeature from "../hooks/useExpiryFeature";
import PaywallModal from "../components/common/PaywallModal";

// Same chip vocabulary as the Filters screen.
const card = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 };
const chipStyle = (active) => ({
  padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
  border: `1px solid ${active ? "var(--brand-light)" : "var(--border)"}`,
  background: active ? "var(--brand-light)" : "var(--bg-elevated)",
  color: active ? "#0b1220" : "var(--text-primary)",
});
const dimChipStyle = { padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1px solid var(--brand-light)", background: "rgba(251,197,3,0.12)", color: "var(--brand-light)", display: "inline-flex", alignItems: "center", gap: 6 };
const selStyle = { padding: "6px 10px", borderRadius: 8, fontSize: 12.5, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" };
const addChipBtn = { padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1px dashed var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" };

const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const endOfWeek = () => { const d = new Date(`${todayIso()}T00:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; return addDays(todayIso(), 6 - dow); }; // Monday-start week
const endOfMonth = () => { const d = new Date(`${todayIso()}T00:00:00Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const daysLabel = (n, en) => {
  if (n === null || n === undefined) return "";
  if (n < 0) return en ? `${-n} d ago` : `il y a ${-n} j`;
  if (n === 0) return en ? "today" : "aujourd'hui";
  return en ? `in ${n} d` : `dans ${n} j`;
};
const name = (r, en) => (en && r.product_name_en) || r.product_name || "—";

export default function CheckExpiryLowPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const { user } = useAuthStore();
  const fmt = useCurrency();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canExpiry, plan, userIdNumber } = useExpiryFeature();
  const canWriteOff = ["owner", "manager"].includes(user?.role);
  const canRestock = ["owner", "manager"].includes(user?.role);
  const [tab, setTab] = useState("filter");
  const [writeOff, setWriteOff] = useState(null);
  const [paywall, setPaywall] = useState(false);

  const q = useQuery({
    queryKey: ["expiry-check"],
    queryFn: () => api.get("/expiry/check").then(r => r.data),
    enabled: canExpiry,
  });
  const expiring = q.data?.expiring || [];
  const low = q.data?.low || [];
  const categories = q.data?.categories || [];
  // Every location the user can see, not only those with rows — choosing one with
  // nothing to show must answer "nothing", not be missing from the list.
  // MP-LOCATIONS-CACHE-FIX: shared ["locations"] key, same queryFn shape as every consumer.
  const locsQ = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data), enabled: canExpiry });
  const allLocations = Array.isArray(locsQ.data?.data) ? locsQ.data.data : [];
  // VALUE is the SERVER's decision (2026-10-08): owner, or a manager granted
  // can_view_compare. It used to be inferred here from the role (canWriteOff), which
  // showed an empty Value column to a manager the server gave no figures to.
  const seesValue = q.data?.sees_value === true;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["expiry-check"] });
    qc.invalidateQueries({ queryKey: ["expiry-low-badge"] });
    qc.invalidateQueries({ queryKey: ["expiry-pos-warnings"] });
  };
  const openWriteOff = (r) => setWriteOff(r);
  const openRestock = (r) => navigate(`/restock?product=${encodeURIComponent(r.product_id)}`);

  if (!canExpiry) {
    return (
      <div style={{ padding: 16, maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>⏳ {en ? "Check Expiry/Low" : "Vérif. Expiration/Stock bas"}</h2>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{en ? "This screen is part of the Pro plan" : "Cet écran fait partie du forfait Pro"}</div>
          <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 12 }}>
            {en ? "See expired, expiring and low stock in one place, write off expired lots with their loss value, and restock what is running low."
                : "Voyez le stock périmé, bientôt périmé et bas en un seul endroit, sortez les lots périmés avec leur perte, et réapprovisionnez ce qui manque."}
          </div>
          {user?.role === "owner" && <button className="btn btn-primary" onClick={() => setPaywall(true)}>{en ? "See plans" : "Voir les forfaits"}</button>}
        </div>
        {paywall && <PaywallModal feature="track_expiry" currentPlan={plan} mpId={userIdNumber} onClose={() => setPaywall(false)} />}
      </div>
    );
  }

  const TABS = [
    { key: "filter", en: "Filter", fr: "Filtrer" },
    { key: "expiring", en: `Expiring (${expiring.length})`, fr: `Expiration (${expiring.length})` },
    { key: "low", en: `Low stock (${low.length})`, fr: `Stock bas (${low.length})` },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <h2 style={{ margin: "0 0 10px" }}>⏳ {en ? "Check Expiry/Low" : "Vérif. Expiration/Stock bas"}</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(t => <button key={t.key} style={chipStyle(tab === t.key)} onClick={() => setTab(t.key)}>{en ? t.en : t.fr}</button>)}
      </div>
      <div style={{ fontSize: 12, padding: "7px 11px", borderRadius: 8, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", marginBottom: 12 }}>
        <strong>{en ? "Expiry quantities are an ESTIMATE" : "Les quantités à expiration sont une ESTIMATION"}</strong>{" — "}
        {en ? "oldest stock assumed sold first. Low stock is exact: quantity at or below the location's minimum, alert switched on. The menu count includes only low items sold there in the last 30 days."
            : "le stock le plus ancien est supposé vendu en premier. Le stock bas est exact : quantité au plus égale au minimum de l'emplacement, alerte activée. Le compteur du menu ne compte que les articles bas vendus à cet emplacement ces 30 derniers jours."}
      </div>

      {q.isLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
      {q.isError && <div style={{ color: "#f87171" }}>{en ? "Could not load — check your connection." : "Chargement impossible — vérifiez votre connexion."}</div>}

      {!q.isLoading && !q.isError && tab === "filter" && (
        <FilterTab en={en} fmt={fmt} expiring={expiring} low={low} categories={categories} allLocations={allLocations} seesValue={seesValue}
          canWriteOff={canWriteOff} canRestock={canRestock} onWriteOff={openWriteOff} onRestock={openRestock} />
      )}
      {!q.isLoading && !q.isError && tab === "expiring" && (
        <ExpiringTab en={en} fmt={fmt} rows={expiring} canWriteOff={canWriteOff} onWriteOff={openWriteOff} />
      )}
      {!q.isLoading && !q.isError && tab === "low" && (
        <LowTab en={en} rows={low} canRestock={canRestock} onRestock={openRestock} />
      )}

      {writeOff && <WriteOffModal en={en} fmt={fmt} row={writeOff} onClose={() => setWriteOff(null)} onDone={() => { setWriteOff(null); refresh(); }} />}
    </div>
  );
}

// ── TAB 1: FILTER ─────────────────────────────────────────────────────────────
function FilterTab({ en, fmt, expiring, low, categories, allLocations, seesValue, canWriteOff, canRestock, onWriteOff, onRestock }) {
  const [range, setRange] = useState(null);           // { from, to, label } on the EXPIRY date
  const [locationId, setLocationId] = useState(null);
  const [categoryId, setCategoryId] = useState(null);
  const [productId, setProductId] = useState(null);
  const [type, setType] = useState("both");           // expiring | low | both
  const [soldOnly, setSoldOnly] = useState(false);    // low rows: only those sold here in 30 days
  const [groupBy, setGroupBy] = useState("type");     // date | location | category | type
  const [open, setOpen] = useState(null);
  const [pq, setPq] = useState("");

  const locations = useMemo(() => {
    const m = new Map((allLocations || []).map(l => [l.id, l.name]));
    for (const r of [...expiring, ...low]) if (r.location_id && !m.has(r.location_id)) m.set(r.location_id, r.location_name);
    return [...m];
  }, [allLocations, expiring, low]);
  const products = useMemo(() => {
    const m = new Map(); for (const r of [...expiring, ...low]) m.set(r.product_id, name(r, en)); return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [expiring, low, en]);
  const catName = (id) => { const c = categories.find(x => x.id === id); return c ? ((en && c.name_en) || c.name) : (en ? "No category" : "Sans catégorie"); };

  const t = todayIso();
  const QUICK = [
    { key: "expired", en: "Expired", fr: "Périmé", r: { from: null, to: addDays(t, -1) } },
    { key: "today", en: "Today", fr: "Aujourd'hui", r: { from: t, to: t } },
    { key: "week", en: "This week", fr: "Cette semaine", r: { from: t, to: endOfWeek() } },
    { key: "month", en: "This month", fr: "Ce mois", r: { from: t, to: endOfMonth() } },
  ];
  const inRange = (d) => !range || ((!range.from || d >= range.from) && (!range.to || d <= range.to));
  const dimOk = (r) => (!locationId || r.location_id === locationId) && (!categoryId || (r.category_id || null) === categoryId) && (!productId || r.product_id === productId);

  // Expiring: date-filter each LOT, then one row per product+location ("once per type").
  const expRows = useMemo(() => {
    if (type === "low") return [];
    const m = new Map();
    for (const r of expiring) {
      if (!dimOk(r) || !inRange(r.expiry_date)) continue;
      const k = `${r.product_id}:${r.location_id}`;
      const g = m.get(k) || { ...r, type: "expiring", est_qty: 0, est_value: r.est_value === null ? null : 0, lots: [], expired_qty: 0, expired_date: null };
      g.est_qty += r.est_qty; if (g.est_value !== null) g.est_value += r.est_value || 0;
      g.lots.push(r);
      if (r.expiry_date < g.expiry_date) { g.expiry_date = r.expiry_date; g.days_left = r.days_left; g.bucket = r.bucket; }
      if (r.bucket === "expired") { g.expired_qty += r.est_qty; if (!g.expired_date || r.expiry_date > g.expired_date) g.expired_date = r.expiry_date; }
      m.set(k, g);
    }
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiring, type, range, locationId, categoryId, productId]);
  // Low rows: the SAME rows as Tab 3, in the same order (sold recently first), plus the
  // "Sold recently" chip to keep only the ones the badge counts.
  const lowRows = useMemo(() => (type === "expiring" ? [] : sortLow(low.filter(r => dimOk(r) && (!soldOnly || r.sold_recently === true)), en).map(r => ({ ...r, type: "low" }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [low, type, locationId, categoryId, productId, soldOnly, en]);
  const rows = [...expRows, ...lowRows];

  const groupKey = (r) => groupBy === "date" ? (r.type === "expiring" ? r.expiry_date : "~low")
    : groupBy === "location" ? (r.location_name || "—")
    : groupBy === "category" ? catName(r.category_id)
    : r.type;
  const groupLabel = (k) => groupBy === "date" ? (k === "~low" ? (en ? "Low stock (no date)" : "Stock bas (sans date)") : fmtDate(k))
    : groupBy === "type" ? (k === "expiring" ? (en ? "Expiring" : "Expiration") : (en ? "Low stock" : "Stock bas")) : k;
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) { const k = groupKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    // Dated groups oldest → newest; the undated "low stock" group always last.
    return [...m].sort((a, b) => (a[0] === "~low") - (b[0] === "~low") || String(a[0]).localeCompare(String(b[0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, en]);

  const prodHits = products.filter(([, n]) => !pq || n.toLowerCase().includes(pq.toLowerCase())).slice(0, 30);

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {/* DATE (expiry date) */}
        <div style={{ position: "relative" }}>
          {range ? (
            <span style={dimChipStyle}>📅 {range.label || `${range.from ? fmtDate(range.from) : "…"} → ${range.to ? fmtDate(range.to) : "…"}`}
              <button onClick={() => setRange(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 800, padding: 0, marginLeft: 2 }}>✕</button></span>
          ) : (
            <button style={addChipBtn} onClick={() => setOpen(open === "date" ? null : "date")}>+ {en ? "Expiry date" : "Date d'expiration"}</button>
          )}
          {open === "date" && (
            <Popover onClose={() => setOpen(null)}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {QUICK.map(x => <button key={x.key} style={selStyle} onClick={() => { setRange({ ...x.r, label: en ? x.en : x.fr }); setOpen(null); }}>{en ? x.en : x.fr}</button>)}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                <input type="date" style={selStyle} value={range?.from || ""} onChange={e => setRange(r => ({ from: e.target.value || null, to: r?.to || e.target.value || null }))} />
                <span>→</span>
                <input type="date" style={selStyle} value={range?.to || ""} onChange={e => setRange(r => ({ from: r?.from || null, to: e.target.value || null }))} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{en ? "Same date twice = a single day. Applies to expiring rows." : "Même date deux fois = un seul jour. S'applique aux lignes à expiration."}</div>
            </Popover>
          )}
        </div>
        <DimChip en={en} label={en ? "Location" : "Emplacement"} value={locationId && locations.find(([id]) => id === locationId)?.[1]} open={open === "loc"}
          onOpen={() => setOpen(open === "loc" ? null : "loc")} onClear={() => setLocationId(null)} onClose={() => setOpen(null)}>
          {locations.map(([id, n]) => <PickRow key={id} label={n} onClick={() => { setLocationId(id); setOpen(null); }} />)}
        </DimChip>
        <DimChip en={en} label={en ? "Category" : "Catégorie"} value={categoryId !== null && categoryId !== undefined ? catName(categoryId) : null} open={open === "cat"}
          onOpen={() => setOpen(open === "cat" ? null : "cat")} onClear={() => setCategoryId(null)} onClose={() => setOpen(null)}>
          {categories.map(c => <PickRow key={c.id} label={(en && c.name_en) || c.name} onClick={() => { setCategoryId(c.id); setOpen(null); }} />)}
          {!categories.length && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{en ? "No categories" : "Aucune catégorie"}</div>}
        </DimChip>
        <DimChip en={en} label={en ? "Product" : "Produit"} value={productId && products.find(([id]) => id === productId)?.[1]} open={open === "prod"}
          onOpen={() => { setOpen(open === "prod" ? null : "prod"); setPq(""); }} onClear={() => setProductId(null)} onClose={() => setOpen(null)}>
          <input className="input" autoFocus value={pq} onChange={e => setPq(e.target.value)} placeholder={en ? "Search…" : "Chercher…"} style={{ marginBottom: 6 }} />
          {prodHits.map(([id, n]) => <PickRow key={id} label={n} onClick={() => { setProductId(id); setOpen(null); }} />)}
        </DimChip>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>{en ? "Type" : "Type"}:</span>
        {[["expiring", "Expiring", "Expiration"], ["low", "Low stock", "Stock bas"], ["both", "Both", "Les deux"]].map(([k, e, f]) =>
          <button key={k} style={chipStyle(type === k)} onClick={() => setType(k)}>{en ? e : f}</button>)}
        {type !== "expiring" && (
          <button style={chipStyle(soldOnly)} onClick={() => setSoldOnly(s => !s)} aria-pressed={soldOnly}>
            {soldOnly ? "✓ " : ""}{en ? "Sold recently" : "Vendu récemment"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>{en ? "Group by" : "Grouper par"}:</span>
        {[["date", "Date", "Date"], ["location", "Location", "Emplacement"], ["category", "Category", "Catégorie"], ["type", "Type", "Type"]].map(([k, e, f]) =>
          <button key={k} style={chipStyle(groupBy === k)} onClick={() => setGroupBy(k)}>{en ? e : f}</button>)}
      </div>

      {!rows.length && <div style={{ color: "var(--text-muted)", padding: 12 }}>{en ? "Nothing matches these filters." : "Rien ne correspond à ces filtres."}</div>}
      {groups.map(([k, list]) => (
        <div key={k} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", margin: "4px 2px 6px" }}>
            {groupLabel(k)} · {list.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map(r => r.type === "expiring"
              ? <ExpRowCard key={`e:${r.product_id}:${r.location_id}`} r={r} en={en} fmt={fmt} seesValue={seesValue} grouped
                  action={canWriteOff && r.expired_qty > 0 ? () => onWriteOff({ ...r, est_qty: r.expired_qty, expiry_date: r.expired_date }) : null} />
              : <LowRowCard key={`l:${r.product_id}:${r.location_id}`} r={r} en={en} soldTag action={canRestock ? () => onRestock(r) : null} />)}
          </div>
        </div>
      ))}
    </>
  );
}

// ── TAB 2: EXPIRING ───────────────────────────────────────────────────────────
function ExpiringTab({ en, fmt, rows, canWriteOff, onWriteOff }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const ae = a.bucket === "expired" ? 0 : 1, be = b.bucket === "expired" ? 0 : 1;
    return ae - be || String(a.expiry_date).localeCompare(String(b.expiry_date)) || name(a, en).localeCompare(name(b, en));
  }), [rows, en]);
  if (!sorted.length) return <div style={{ color: "var(--text-muted)", padding: 12 }}>{en ? "No dated stock." : "Aucun stock daté."}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sorted.map(r => <ExpRowCard key={`${r.product_id}:${r.location_id}:${r.expiry_date}`} r={r} en={en} fmt={fmt} seesValue={r.est_value !== null}
        action={canWriteOff && r.bucket === "expired" ? () => onWriteOff(r) : null} />)}
    </div>
  );
}

// ── TAB 3: LOW STOCK ──────────────────────────────────────────────────────────
// Peter, 2026-10-04: every low row is listed, but those that SOLD at that location in
// the last 30 days come first (they are the ones the badge counts); within each group
// the shortfall order is unchanged. One sort, shared with Tab 1.
const lowRatio = (r) => (r.min_quantity > 0 ? r.quantity / r.min_quantity : (r.quantity <= 0 ? 0 : 1));
const sortLow = (rows, en) => [...rows].sort((a, b) =>
  (b.sold_recently === true) - (a.sold_recently === true)
  || lowRatio(a) - lowRatio(b) || b.shortage - a.shortage || name(a, en).localeCompare(name(b, en)));
const soldTagStyle = { fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
  background: "rgba(16,185,129,0.14)", color: "#10b981", border: "1px solid rgba(16,185,129,0.4)" };
const SoldTag = ({ en }) => <span style={soldTagStyle}>{en ? "Sold recently" : "Vendu récemment"}</span>;

function LowTab({ en, rows, canRestock, onRestock }) {
  const sorted = useMemo(() => sortLow(rows, en), [rows, en]);
  if (!sorted.length) return <div style={{ color: "var(--text-muted)", padding: 12 }}>{en ? "Nothing is low." : "Rien n'est bas."}</div>;
  const sold = sorted.filter(r => r.sold_recently === true);
  const rest = sorted.filter(r => r.sold_recently !== true);
  const head = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, color: "var(--text-muted)", margin: "4px 2px 6px" };
  const list = (rs) => rs.map(r => <LowRowCard key={`${r.product_id}:${r.location_id}`} r={r} en={en} action={canRestock ? () => onRestock(r) : null} />);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sold.length > 0 && <div style={head}><SoldTag en={en} /> <span>{en ? "sold here in the last 30 days" : "vendu ici ces 30 derniers jours"} · {sold.length}</span></div>}
      {list(sold)}
      {rest.length > 0 && <div style={{ ...head, marginTop: sold.length ? 12 : 4 }}>{en ? "Not sold here in the last 30 days" : "Pas vendu ici ces 30 derniers jours"} · {rest.length}</div>}
      {list(rest)}
    </div>
  );
}

// ── Row cards (wrap on a phone/tablet — no horizontal scroll) ─────────────────
function Cell({ label, children, color }) {
  return (
    <div style={{ minWidth: 72 }}>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13.5, color }}>{children}</div>
    </div>
  );
}
function ExpRowCard({ r, en, fmt, seesValue, action, grouped }) {
  const expired = r.bucket === "expired";
  const lots = grouped ? [...new Set((r.lots || []).map(l => l.batch_nos).filter(Boolean))].join(", ") : r.batch_nos;
  return (
    <div style={{ ...card, borderLeft: `4px solid ${expired ? "#f87171" : r.bucket === "d30" ? "#fb923c" : "var(--border)"}`, display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>⏳ {name(r, en)}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.location_name}</div>
      </div>
      <Cell label={en ? "Est. qty" : "Qté est."}>≈ {Number(r.est_qty).toLocaleString()} {r.unit || ""}</Cell>
      <Cell label={grouped ? (en ? "Earliest expiry" : "1re expiration") : (en ? "Expiry" : "Expiration")} color={expired ? "#f87171" : undefined}>{fmtDate(r.expiry_date)}</Cell>
      <Cell label={en ? "Days left" : "Jours restants"} color={expired ? "#f87171" : undefined}>{expired ? (en ? "Expired" : "Périmé") + " · " : ""}{daysLabel(r.days_left, en)}</Cell>
      {seesValue && r.est_value !== null && <Cell label={en ? "Value" : "Valeur"}>≈ {fmt(r.est_value)}</Cell>}
      <Cell label={en ? "Lot no." : "N° de lot"}>{lots || "—"}</Cell>
      <span style={{ fontSize: 10.5, color: "var(--amber, #b7791f)", fontWeight: 700 }}>{en ? "estimate" : "estimation"}</span>
      {action && <button className="btn btn-sm btn-secondary" onClick={action}>🗑️ {en ? "Write off" : "Sortir"}</button>}
    </div>
  );
}
function LowRowCard({ r, en, action, soldTag }) {
  return (
    <div style={{ ...card, borderLeft: "4px solid #fbbf24", display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>📉 {name(r, en)}{soldTag && r.sold_recently === true && <> <SoldTag en={en} /></>}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.location_name}</div>
      </div>
      <Cell label={en ? "Quantity" : "Quantité"} color={r.quantity <= 0 ? "#f87171" : "#fbbf24"}>{Number(r.quantity).toLocaleString()} {r.unit || ""}</Cell>
      <Cell label={en ? "Minimum" : "Minimum"}>{Number(r.min_quantity).toLocaleString()}</Cell>
      {action && <button className="btn btn-sm btn-secondary" onClick={action}>🛒 {en ? "Restock" : "Réapprovisionner"}</button>}
    </div>
  );
}

function Popover({ children, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41, minWidth: 220, maxWidth: "min(320px, 90vw)", maxHeight: 300, overflowY: "auto", ...card, boxShadow: "0 12px 28px rgba(0,0,0,0.4)" }}>
        {children}
      </div>
    </>
  );
}
function PickRow({ label, onClick }) {
  return <div onClick={onClick} style={{ padding: "7px 4px", cursor: "pointer", borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{label}</div>;
}
function DimChip({ en, label, value, open, onOpen, onClear, onClose, children }) {
  if (value) return (
    <span style={dimChipStyle}>✓ {label}: {value}
      <button onClick={onClear} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 800, padding: 0, marginLeft: 2 }} aria-label={en ? "Remove" : "Retirer"}>✕</button></span>
  );
  return (
    <div style={{ position: "relative" }}>
      <button style={addChipBtn} onClick={onOpen}>+ {label}</button>
      {open && <Popover onClose={onClose}>{children}</Popover>}
    </div>
  );
}

// ── Write-off (unchanged behaviour from the Expiring stock page) ─────────────
function WriteOffModal({ en, fmt, row, onClose, onDone }) {
  const [qty, setQty] = useState(String(row.est_qty));
  const [note, setNote] = useState("");
  // One id per opened modal: a double tap or a retried request is written off ONCE.
  const [localId] = useState(() => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `exp-${Date.now()}-${Math.random()}`));
  const mut = useMutation({
    mutationFn: () => api.post("/stock-checks/damaged/writeoff", {
      product_id: row.product_id, location_id: row.location_id, quantity: Number(qty),
      reason: "expired", expiry_date: row.expiry_date, note: note.trim() || null, local_id: localId,
    }).then(r => r.data),
    onSuccess: (res) => {
      const loss = res?.data?.loss_value;
      toast.success(en ? `Written off as expired${loss != null ? ` — loss ${fmt(loss)}` : ""}` : `Sorti comme périmé${loss != null ? ` — perte ${fmt(loss)}` : ""}`);
      onDone();
    },
    onError: (e) => toast.error(e?.response?.data?.[en ? "message_en" : "message_fr"] || e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });
  const n = Number(qty);
  const ok = Number.isFinite(n) && n > 0;
  return (
    <div className="modal-overlay" onClick={() => !mut.isPending && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{en ? "Write off as expired" : "Sortir comme périmé"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {row.product_name} · {row.location_name} · {en ? "expired" : "périmé le"} {fmtDate(row.expiry_date)}
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          {en ? "These units leave sellable stock and go to the damaged goods pile as “expired”. The loss is recorded at today's cost price."
              : "Ces unités sortent du stock vendable et vont dans les marchandises endommagées comme « périmé ». La perte est enregistrée au prix d'achat du jour."}
        </div>
        <div className="form-group">
          <label className="label">{en ? "Quantity to write off" : "Quantité à sortir"} ({en ? "estimate" : "estimation"}: {Number(row.est_qty).toLocaleString()})</label>
          <input className="input" type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        {row.unit_cost !== null && row.unit_cost !== undefined && ok && (
          <div style={{ fontSize: 12.5, marginBottom: 10 }}>{en ? "Loss" : "Perte"}: <strong>≈ {fmt(n * row.unit_cost)}</strong></div>
        )}
        <div className="form-group">
          <label className="label">{en ? "Note (optional)" : "Note (facultatif)"}</label>
          <input className="input" value={note} maxLength={300} onChange={e => setNote(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={mut.isPending} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={!ok || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : (en ? "Write off" : "Sortir du stock")}
          </button>
        </div>
      </div>
    </div>
  );
}
