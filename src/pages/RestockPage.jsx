// MP-RESTOCK — order more stock from a supplier (boss tool, owner+manager, Pro/Pro
// Plus). Writes NO stock — goods are received later via the normal receive flow.
//   To Buy    — live low-stock list (+ manual adds) → check lines → send via WhatsApp
//   Ordered   — past sent orders (date-filtered) → edit + re-send (new dated order)
//   Unstocked — ignored products (hidden from To Buy) → re-add
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import toast from "react-hot-toast";
import { unitLabel } from "../utils/units";
import { openWhatsApp } from "../utils/whatsapp";
import DateRangeFilter, { inRange, wideRange } from "../components/common/DateRangeFilter";

function toArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.data)) return x.data;
  if (Array.isArray(x?.data?.data)) return x.data.data;
  return [];
}
function fmtDate(iso, en) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const RECENT_KEY = "mp_restock_recent_suppliers";
function loadRecentSuppliers() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.slice(0, 5) : []; } catch { return []; }
}
function rememberSupplier(name, phone) {
  if (!phone) return;
  try {
    const list = loadRecentSuppliers().filter(s => s.phone !== phone);
    list.unshift({ name: name || "", phone });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch { /* ignore */ }
}

export default function RestockPage() {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const qc = useQueryClient();
  const org = useAuthStore(s => s.org);
  const [tab, setTab] = useState("tobuy");         // tobuy | ordered | ignored
  const [lines, setLines] = useState({});          // product_id -> { checked, qty }
  const [manual, setManual] = useState([]);        // [{ product_id, name, unit, qty, checked }]
  const [showAdd, setShowAdd] = useState(false);
  const [sendFor, setSendFor] = useState(null);    // { items, supplier } → SendModal
  const [range, setRange] = useState(wideRange());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["restock-tobuy"] });
    qc.invalidateQueries({ queryKey: ["restock-orders"] });
    qc.invalidateQueries({ queryKey: ["restock-ignores"] });
  };

  const toBuy = useQuery({ queryKey: ["restock-tobuy"], queryFn: () => api.get("/restock/to-buy").then(r => toArray(r)), refetchInterval: 30000 });
  const orders = useQuery({ queryKey: ["restock-orders"], queryFn: () => api.get("/restock/orders").then(r => toArray(r)), enabled: tab === "ordered" });
  const ignores = useQuery({ queryKey: ["restock-ignores"], queryFn: () => api.get("/restock/ignores").then(r => toArray(r)), enabled: tab === "ignored" });

  const ignoreMut = useMutation({
    mutationFn: (p) => api.post("/restock/ignores", { product_id: p.product_id, product_name: p.name }).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Removed from restock" : "Retiré du réapprovisionnement"); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });
  const readdMut = useMutation({
    mutationFn: (id) => api.delete(`/restock/ignores/${id}`).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Re-added to restock" : "Réajouté"); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });
  // Mark an open order received → its products stop hiding from To Buy.
  const receiveMut = useMutation({
    mutationFn: (id) => api.post(`/restock/orders/${id}/receive`).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Marked received" : "Marqué reçu"); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  const buyRows = Array.isArray(toBuy.data) ? toBuy.data : [];
  // Per-line UI state (default: checked, qty = suggested). Derived so new server rows adopt defaults.
  const lineState = (pid, suggested) => lines[pid] || { checked: true, qty: suggested };
  const setLine = (pid, patch) => setLines(prev => ({ ...prev, [pid]: { ...(prev[pid] || {}), ...patch } }));

  // Collect the CHECKED lines (low-stock + manual) into the send payload.
  const checkedItems = useMemo(() => {
    const out = [];
    for (const r of buyRows) {
      const st = lines[r.product_id] || { checked: true, qty: r.suggested_qty };
      if (st.checked && Number(st.qty) > 0) out.push({ product_id: r.product_id, name: en ? (r.name_en || r.name) : r.name, quantity: Number(st.qty) });
    }
    for (const m of manual) {
      if (m.checked && Number(m.qty) > 0) out.push({ product_id: m.product_id, name: m.name, quantity: Number(m.qty) });
    }
    return out;
  }, [buyRows, lines, manual, en]);

  const addManual = (p) => {
    if (manual.some(m => m.product_id === p.id) || buyRows.some(r => r.product_id === p.id)) {
      toast(en ? "Already in the list" : "Déjà dans la liste"); setShowAdd(false); return;
    }
    setManual(prev => [...prev, { product_id: p.id, name: en ? (p.name_en || p.name) : p.name, unit: p.unit, qty: 1, checked: true }]);
    setShowAdd(false);
  };

  const tabBtn = (t, label) => (
    <button key={t} onClick={() => setTab(t)}
      style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 700, fontSize: 13,
        background: tab === t ? "var(--brand-light)" : "transparent", color: tab === t ? "#1a1a2e" : "var(--text-secondary)" }}>
      {label}
    </button>
  );

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 22 }}>🛒 {en ? "Restock" : "Réapprovisionner"}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, maxWidth: 640 }}>
          {en ? "Build a supplier order from your low-stock products and send it on WhatsApp. This does NOT change stock — receive the goods later as usual."
              : "Composez une commande fournisseur à partir de vos produits en stock bas et envoyez-la sur WhatsApp. Cela ne modifie PAS le stock — recevez les articles plus tard comme d'habitude."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
        {tabBtn("tobuy", en ? "To Buy" : "À acheter")}
        {tabBtn("ordered", en ? "Ordered" : "Commandés")}
        {tabBtn("ignored", en ? "Unstocked" : "Non suivis")}
      </div>

      {/* ───────── TO BUY ───────── */}
      {tab === "tobuy" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(true)}>➕ {en ? "Add a product" : "Ajouter un produit"}</button>
            <button className="btn btn-primary" style={{ fontWeight: 700 }} disabled={!checkedItems.length}
              onClick={() => setSendFor({ items: checkedItems, supplier: null })}>
              📤 {en ? "Send to supplier" : "Envoyer au fournisseur"} {checkedItems.length ? `(${checkedItems.length})` : ""}
            </button>
          </div>

          {toBuy.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
          {!toBuy.isLoading && buyRows.length === 0 && manual.length === 0 && (
            <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
              {en ? "Nothing low on stock right now. 🎉" : "Rien en stock bas pour le moment. 🎉"}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buyRows.map(r => {
              const st = lineState(r.product_id, r.suggested_qty);
              return (
                <ToBuyRow key={r.product_id} en={en}
                  name={en ? (r.name_en || r.name) : r.name} unit={r.unit}
                  current={r.current_qty} level={r.stock_level}
                  checked={st.checked} qty={st.qty}
                  onCheck={v => setLine(r.product_id, { checked: v, qty: st.qty })}
                  onQty={v => setLine(r.product_id, { checked: st.checked, qty: v })}
                  onUnstock={() => ignoreMut.mutate({ product_id: r.product_id, name: en ? (r.name_en || r.name) : r.name })} />
              );
            })}
            {manual.map((m, i) => (
              <ToBuyRow key={"m-" + m.product_id} en={en} name={m.name} unit={m.unit} manual
                checked={m.checked} qty={m.qty}
                onCheck={v => setManual(p => p.map((x, j) => j === i ? { ...x, checked: v } : x))}
                onQty={v => setManual(p => p.map((x, j) => j === i ? { ...x, qty: v } : x))}
                onRemove={() => setManual(p => p.filter((_, j) => j !== i))} />
            ))}
          </div>
        </>
      )}

      {/* ───────── ORDERED ───────── */}
      {tab === "ordered" && (
        <>
          <DateRangeFilter from={range.from} to={range.to} onChange={setRange} style={{ marginBottom: 12 }} />
          {orders.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
          <OrderedList orders={(orders.data || []).filter(o => inRange(o.sent_at, range.from, range.to))} en={en}
            receiving={receiveMut.isPending}
            onReceive={(id) => receiveMut.mutate(id)}
            onEdit={(o) => setSendFor({
              items: (o.pa_restock_order_items || []).map(it => ({ product_id: it.product_id, name: it.product_name, quantity: Number(it.quantity) })),
              supplier: { name: o.supplier_name || "", phone: o.supplier_phone || "" },
            })} />
        </>
      )}

      {/* ───────── UNSTOCKED / IGNORED ───────── */}
      {tab === "ignored" && (
        <>
          {ignores.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
          {!ignores.isLoading && (ignores.data || []).length === 0 && (
            <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
              {en ? "No unstocked products." : "Aucun produit non suivi."}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(ignores.data || []).map(g => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{en ? (g.pa_products?.name_en || g.pa_products?.name || g.product_name) : (g.pa_products?.name || g.product_name)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {g.ignored_by_name ? `${en ? "by" : "par"} ${g.ignored_by_name} · ` : ""}{fmtDate(g.created_at, en)}
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" disabled={readdMut.isPending} onClick={() => readdMut.mutate(g.id)}>
                  ↩ {en ? "Re-add to restock" : "Réajouter"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {showAdd && <AddProductModal en={en} onClose={() => setShowAdd(false)} onPick={addManual} />}
      {sendFor && (
        <SendModal en={en} orgName={org?.name || ""} items={sendFor.items} supplier={sendFor.supplier}
          onClose={() => setSendFor(null)}
          onSent={() => { setSendFor(null); setLines({}); setManual([]); invalidate(); setTab("ordered"); }} />
      )}
    </div>
  );
}

// One To Buy line — checkbox + name + current/level + editable qty-to-buy + unstock/remove.
function ToBuyRow({ en, name, unit, current, level, checked, qty, onCheck, onQty, onUnstock, onRemove, manual }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", flexWrap: "wrap" }}>
      <input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{name}{manual && <span style={{ fontSize: 10, color: "var(--brand-light)", marginLeft: 6 }}>{en ? "manual" : "manuel"}</span>}</div>
        {!manual && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
            {en ? "In stock" : "En stock"}: <b style={{ color: current <= level ? "#f87171" : "var(--text-primary)" }}>{current}</b> · {en ? "level" : "seuil"}: {level} {unitLabel(unit)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Buy" : "Acheter"}</span>
        <input type="number" min="0" value={qty} onChange={e => onQty(e.target.value === "" ? "" : Number(e.target.value))}
          onFocus={e => e.target.select()} style={{ width: 68, textAlign: "right", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }} />
        {onUnstock && (
          <button onClick={onUnstock} title={en ? "Unstock (hide from restock)" : "Ne plus suivre"}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "5px 8px", whiteSpace: "nowrap" }}>
            🚫 {en ? "Unstock" : "Ignorer"}
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: 16 }}>×</button>
        )}
      </div>
    </div>
  );
}

// Ordered list — one card per past order, most recent first, with its lines +
// Open/Received badge, Edit/re-send, and (open only) Mark-received.
function OrderedList({ orders, en, onEdit, onReceive, receiving }) {
  if (!orders.length) return (
    <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
      {en ? "No orders in this range." : "Aucune commande sur cette période."}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {orders.map(o => {
        const items = o.pa_restock_order_items || [];
        const received = o.status === "received";
        return (
          <div key={o.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: `3px solid ${received ? "#34d399" : "#fbbf24"}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{o.supplier_name || (en ? "Supplier" : "Fournisseur")}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    background: received ? "rgba(52,211,153,0.15)" : "rgba(251,191,36,0.15)", color: received ? "#34d399" : "#fbbf24" }}>
                    {received ? (en ? "Received" : "Reçu") : (en ? "Open" : "Ouvert")}
                  </span>
                  {o.supplier_phone && <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{o.supplier_phone}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                  {fmtDate(o.sent_at, en)} · {items.length} {en ? "item(s)" : "article(s)"}{o.sent_by_name ? ` · ${en ? "by" : "par"} ${o.sent_by_name}` : ""}
                  {received && o.received_at ? ` · ${en ? "received" : "reçu"} ${fmtDate(o.received_at, en)}${o.received_by_name ? ` (${o.received_by_name})` : ""}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignSelf: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {!received && (
                  <button className="btn btn-success btn-sm" disabled={receiving} onClick={() => onReceive(o.id)} style={{ whiteSpace: "nowrap" }}>
                    ✓ {en ? "Mark received" : "Marquer reçu"}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => onEdit(o)} style={{ whiteSpace: "nowrap" }}>
                  ✏️ {en ? "Edit & re-send" : "Modifier & renvoyer"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {items.map(it => (
                <span key={it.id} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  {it.product_name} × {Number(it.quantity)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Fuzzy add — reuse search_products_fuzzy (GET /products?search=), real products only.
function AddProductModal({ en, onClose, onPick }) {
  const [q, setQ] = useState("");
  const search = useQuery({
    queryKey: ["restock-product-search", q],
    queryFn: () => api.get(`/products?search=${encodeURIComponent(q)}`).then(r => toArray(r).filter(p => !p.is_multipart)),
    enabled: q.trim().length >= 1,
  });
  const results = Array.isArray(search.data) ? search.data : [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12 }}>{en ? "Add a product to buy" : "Ajouter un produit à acheter"}</div>
        <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder={en ? "Search product (name / SKU)…" : "Chercher (nom / SKU)…"} />
        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
          {search.isLoading && <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "Searching…" : "Recherche…"}</div>}
          {results.map(p => (
            <div key={p.id} onClick={() => onPick(p)} onMouseDown={e => e.preventDefault()}
              style={{ padding: "9px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{[p.sku, p.barcode].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          ))}
          {q.trim().length >= 1 && !search.isLoading && results.length === 0 &&
            <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "No match." : "Aucun résultat."}</div>}
        </div>
        <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={onClose}>{en ? "Close" : "Fermer"}</button>
      </div>
    </div>
  );
}

// Send modal — editable lines (qty / add / remove) + supplier phone (required) + name
// + recent picks; sends to WhatsApp AND records the order (re-send posts a NEW dated order).
function SendModal({ en, orgName, items, supplier, onClose, onSent }) {
  const [rows, setRows] = useState(() => items.map(i => ({ product_id: i.product_id || null, name: i.name, quantity: Number(i.quantity) || 1 })));
  const [name, setName] = useState(supplier?.name || "");
  const [phone, setPhone] = useState(supplier?.phone || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const recents = loadRecentSuppliers();
  const cleanPhone = String(phone).replace(/[^\d]/g, "");
  const validRows = rows.filter(r => Number(r.quantity) > 0);

  const setQty = (idx, v) => setRows(p => p.map((r, i) => i === idx ? { ...r, quantity: v === "" ? "" : Number(v) } : r));
  const removeRow = (idx) => setRows(p => p.filter((_, i) => i !== idx));
  const addRow = (p) => {
    setAddOpen(false);
    if (rows.some(r => r.product_id === p.id)) { toast(en ? "Already in the order" : "Déjà dans la commande"); return; }
    setRows(prev => [...prev, { product_id: p.id, name: en ? (p.name_en || p.name) : p.name, quantity: 1 }]);
  };

  const message = useMemo(() => {
    const header = `🧾 ${en ? "Order" : "Commande"}${orgName ? " — " + orgName : ""}`;
    const body = validRows.map(i => `• ${i.name} × ${Number(i.quantity)}`).join("\n");
    return `${header}\n${body}${note.trim() ? `\n\n${note.trim()}` : ""}`;
  }, [validRows, orgName, note, en]);

  const send = async () => {
    if (!validRows.length) { toast.error(en ? "Add at least one item" : "Ajoutez au moins un article"); return; }
    if (!cleanPhone || cleanPhone.length < 6) { toast.error(en ? "Enter the supplier's WhatsApp number" : "Entrez le numéro WhatsApp du fournisseur"); return; }
    setBusy(true);
    try {
      // Record the order first (so a WhatsApp-app switch doesn't lose it), then open WhatsApp.
      await api.post("/restock/orders", {
        supplier_name: name || null, supplier_phone: cleanPhone, note: note || null,
        items: validRows.map(i => ({ product_id: i.product_id || null, product_name: i.name, quantity: Number(i.quantity) })),
      });
      rememberSupplier(name, cleanPhone);
      openWhatsApp(null, cleanPhone, message);
      toast.success(en ? "Order recorded & opened in WhatsApp" : "Commande enregistrée & ouverte dans WhatsApp");
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed to send" : "Échec de l'envoi"));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Send order to supplier" : "Envoyer la commande"}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{validRows.length} {en ? "item(s)" : "article(s)"}</div>

        {/* Editable lines (qty / remove) + add */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto", marginBottom: 8 }}>
          {rows.map((r, i) => (
            <div key={(r.product_id || "x") + i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-elevated)", borderRadius: 8, padding: "6px 10px" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
              <input type="number" min="0" value={r.quantity} onChange={e => setQty(i, e.target.value)} onFocus={e => e.target.select()}
                style={{ width: 64, textAlign: "right", padding: "5px 7px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }} />
              <button onClick={() => removeRow(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 12 }} onClick={() => setAddOpen(true)}>➕ {en ? "Add a product" : "Ajouter un produit"}</button>

        {recents.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {recents.map(s => (
              <button key={s.phone} onClick={() => { setName(s.name || ""); setPhone(s.phone); }}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer" }}>
                {s.name ? s.name + " · " : ""}{s.phone}
              </button>
            ))}
          </div>
        )}

        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Supplier WhatsApp number" : "Numéro WhatsApp du fournisseur"}</label>
        <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
          placeholder={en ? "e.g. 237670000000" : "ex. 237670000000"} style={{ marginTop: 6, marginBottom: 10 }} />
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Supplier name (optional)" : "Nom du fournisseur (optionnel)"}</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} />
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Note (optional)" : "Note (optionnel)"}</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 6, marginBottom: 12 }} />

        <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: 10, fontSize: 12, color: "var(--text-secondary)", maxHeight: 140, overflowY: "auto", whiteSpace: "pre-wrap", marginBottom: 12 }}>{message}</div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2, fontWeight: 700 }} disabled={busy} onClick={send}>
            {busy ? "…" : `📤 ${en ? "Send on WhatsApp" : "Envoyer sur WhatsApp"}`}
          </button>
        </div>

        {addOpen && <AddProductModal en={en} onClose={() => setAddOpen(false)} onPick={addRow} />}
      </div>
    </div>
  );
}
