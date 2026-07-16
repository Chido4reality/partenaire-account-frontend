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
import { PLAY_STORE_URL } from "../utils/receiptExtras"; // reuse the SAME app-download link the receipt footer uses
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
  // Org promo-footer toggle (default ON) — appends one branding line to the WhatsApp order.
  const { data: settingsData } = useQuery({ queryKey: ["org-settings"], queryFn: () => api.get("/settings").then(r => r.data), staleTime: 60000 });
  const promoFooterEnabled = settingsData?.data?.promo_footer_enabled !== false;
  const [tab, setTab] = useState("tobuy");         // tobuy | ordered | ignored
  const [lines, setLines] = useState({});          // product_id -> { checked, qty }
  const [manual, setManual] = useState([]);        // [{ product_id, name, unit, qty, checked }]
  const [showAdd, setShowAdd] = useState(false);
  const [sendFor, setSendFor] = useState(null);    // { items, supplier } → SendModal
  const [receiveFor, setReceiveFor] = useState(null); // order → ReceiveModal (count-confirmed receive)
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
            onReceive={(o) => setReceiveFor(o)}
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
        <SendModal en={en} orgName={org?.name || ""} promoFooter={promoFooterEnabled} items={sendFor.items} supplier={sendFor.supplier}
          onClose={() => setSendFor(null)}
          onSent={() => { setSendFor(null); setLines({}); setManual([]); invalidate(); setTab("ordered"); }} />
      )}
      {receiveFor && (
        <ReceiveModal en={en} order={receiveFor}
          onClose={() => setReceiveFor(null)}
          onDone={() => { setReceiveFor(null); invalidate(); }} />
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
function OrderedList({ orders, en, onEdit, onReceive }) {
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
        const partial  = o.status === "partially_received";
        const barColor = received ? "#34d399" : partial ? "#60a5fa" : "#fbbf24";
        const badgeBg  = received ? "rgba(52,211,153,0.15)" : partial ? "rgba(96,165,250,0.15)" : "rgba(251,191,36,0.15)";
        const badgeTxt = received ? (en ? "Received" : "Reçu") : partial ? (en ? "Partial" : "Partiel") : (en ? "Open" : "Ouvert");
        return (
          <div key={o.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: `3px solid ${barColor}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{o.supplier_name || (en ? "Supplier" : "Fournisseur")}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: badgeBg, color: barColor }}>
                    {badgeTxt}
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
                  <button className="btn btn-success btn-sm" onClick={() => onReceive(o)} style={{ whiteSpace: "nowrap" }}>
                    📥 {partial ? (en ? "Finish receiving" : "Terminer la réception") : (en ? "Receive" : "Réceptionner")}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => onEdit(o)} style={{ whiteSpace: "nowrap" }}>
                  ✏️ {en ? "Edit & re-send" : "Modifier & renvoyer"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {items.map(it => {
                const rq = it.received_quantity;
                const done = rq !== null && rq !== undefined;
                const short = done && Number(rq) < Number(it.quantity);
                return (
                  <span key={it.id} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {it.product_name} × {Number(it.quantity)}
                    {done && <span style={{ marginLeft: 6, fontWeight: 700, color: short ? "#fbbf24" : "#34d399" }}>
                      {short ? `⚠ ${en ? "got" : "reçu"} ${Number(rq)}` : `✓ ${Number(rq)}`}
                    </span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MP-RESTOCK-COUNT-RECEIVE — count-confirmed receive-into-inventory modal ─────
// Step 1: Refill (count in) OR Just-mark-received (no stock). Step 2: pick ONE
// destination + count each line. Step 3/4: per short line, a required disposition —
// move the shortfall to a 2nd location OR mark it not-delivered. ANTI-PHANTOM: stock
// only ever += the COUNTED number, and submit is blocked until every short line has an
// explicit disposition (no silent completion). Online-only (writes stock).
function ReceiveModal({ en, order, onClose, onDone }) {
  const items = order.pa_restock_order_items || [];
  const [step, setStep] = useState("choice");   // choice | refill
  const [dest, setDest] = useState("");
  const [rows, setRows] = useState(() => {
    const m = {};
    for (const it of items) {
      const done = it.received_quantity !== null && it.received_quantity !== undefined;
      m[it.id] = { counted: String(done ? it.received_quantity : (Number(it.quantity) || 0)), vAction: "", vLoc: "", vQty: "", slot: "" };
    }
    return m;
  });
  const setRow = (id, patch) => setRows(p => ({ ...p, [id]: { ...p[id], ...patch } }));

  // MP-LOCATIONS-CACHE-FIX: queryKey ["locations"] is shared app-wide — must
  // match the queryFn shape every other consumer uses (see StockCheckPage.jsx),
  // or a stale cached envelope from another page leaves this list empty.
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data) });
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  const pending   = items.filter(it => it.received_quantity === null || it.received_quantity === undefined);
  const doneItems = items.filter(it => it.received_quantity !== null && it.received_quantity !== undefined);

  const mut = useMutation({
    mutationFn: (body) => api.post(`/restock/orders/${order.id}/receive`, body).then(r => r.data),
    onSuccess: (res) => {
      const st = res?.data?.status;
      toast.success(st === "received"
        ? (en ? "Received into inventory" : "Reçu en stock")
        : (en ? "Saved — order partially received" : "Enregistré — commande partiellement reçue"));
      onDone();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed — check your connection" : "Échec — vérifiez votre connexion")),
  });

  const submitRefill = () => {
    const lines = pending.map(it => {
      const r = rows[it.id] || {};
      const ordered = Number(it.quantity) || 0;
      const counted = Math.max(0, Number(r.counted) || 0);
      const short = counted < ordered;
      const variance = (short && r.vAction === "move")
        ? { action: "move", location_id: r.vLoc, quantity: Math.min(ordered - counted, Number(r.vQty) || (ordered - counted)) }
        : { action: "ignore" };
      return { item_id: it.id, product_id: it.product_id, counted, variance, slot_code: (r.slot || "").trim() || null };
    });
    mut.mutate({ mode: "refill", location_id: dest, lines });
  };

  // No silent completion: every short line needs an explicit disposition before submit.
  const canSubmit = !!dest && pending.length > 0 && !mut.isPending && pending.every(it => {
    const r = rows[it.id] || {};
    const ordered = Number(it.quantity) || 0;
    const counted = Math.max(0, Number(r.counted) || 0);
    if (counted >= ordered) return true;
    if (r.vAction === "ignore") return true;
    if (r.vAction === "move") return !!r.vLoc;
    return false;
  });

  return (
    <div className="modal-overlay" onClick={() => !mut.isPending && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
        {step === "choice" && (<>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>{en ? "Add these goods to your inventory?" : "Ajouter ces marchandises à votre stock ?"}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>
            {en ? "Refill counts each line into a location and increases stock. Or just mark the order received without touching stock."
                : "Réapprovisionner compte chaque ligne dans un emplacement et augmente le stock. Ou marquez simplement la commande reçue sans toucher au stock."}
          </div>
          <button className="btn btn-primary btn-block" style={{ marginBottom: 10 }} onClick={() => setStep("refill")}>
            📦 {en ? "Refill inventory (count in)" : "Réapprovisionner (compter)"}
          </button>
          <button className="btn btn-secondary btn-block" disabled={mut.isPending} onClick={() => mut.mutate({ mode: "status_only" })}>
            {en ? "Just mark received (no stock)" : "Marquer reçu seulement (sans stock)"}
          </button>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 10, opacity: 0.7 }} disabled={mut.isPending} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
        </>)}

        {step === "refill" && (<>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{en ? "Count in the delivery" : "Compter la livraison"}</div>
          <div className="form-group">
            <label className="label">{en ? "Delivery location" : "Emplacement de livraison"}</label>
            <select className="input" value={dest} onChange={e => setDest(e.target.value)}>
              <option value="">{en ? "Choose a location…" : "Choisir un emplacement…"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {doneItems.length > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "6px 0" }}>
              {en ? "Already received: " : "Déjà reçu : "}{doneItems.map(it => `${it.product_name} (${Number(it.received_quantity)})`).join(", ")}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            {pending.map(it => {
              const r = rows[it.id] || {};
              const ordered = Number(it.quantity) || 0;
              const counted = Math.max(0, Number(r.counted) || 0);
              const short = counted < ordered;
              const shortfall = Math.max(0, ordered - counted);
              return (
                <div key={it.id} style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.product_name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Ordered" : "Commandé"}: {ordered}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Counted" : "Compté"}</span>
                      <input className="input" type="number" min="0" value={r.counted} style={{ width: 84, textAlign: "center" }}
                        onFocus={e => e.target.select()} onChange={e => setRow(it.id, { counted: e.target.value })} />
                    </div>
                  </div>
                  {counted > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📍 {en ? "Slot/Zone (opt.)" : "Emplacement (opt.)"}</span>
                      <input className="input" value={r.slot} style={{ flex: 1 }} placeholder="A-01, Shelf 2..."
                        onChange={e => setRow(it.id, { slot: e.target.value })} />
                    </div>
                  )}
                  {short && (
                    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)" }}>
                      <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 6 }}>
                        {en ? `Counted ${counted} of ${ordered}. The missing ${shortfall}:` : `Compté ${counted} sur ${ordered}. Les ${shortfall} manquants :`}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-sm" style={{ border: `1.5px solid ${r.vAction === "move" ? "var(--brand)" : "var(--border)"}`, background: r.vAction === "move" ? "rgba(251,197,3,0.12)" : "transparent" }}
                          onClick={() => setRow(it.id, { vAction: "move", vQty: String(shortfall) })}>
                          {en ? "Went to another location" : "Allé ailleurs"}
                        </button>
                        <button className="btn btn-sm" style={{ border: `1.5px solid ${r.vAction === "ignore" ? "#f87171" : "var(--border)"}`, background: r.vAction === "ignore" ? "rgba(248,113,113,0.12)" : "transparent" }}
                          onClick={() => setRow(it.id, { vAction: "ignore" })}>
                          {en ? "Not delivered" : "Non livré"}
                        </button>
                      </div>
                      {r.vAction === "move" && (
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <select className="input" value={r.vLoc} onChange={e => setRow(it.id, { vLoc: e.target.value })} style={{ flex: 1 }}>
                            <option value="">{en ? "Which location?" : "Quel emplacement ?"}</option>
                            {locList.filter(l => l.id !== dest).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                          <input className="input" type="number" min="1" max={shortfall} value={r.vQty} style={{ width: 84, textAlign: "center" }}
                            onChange={e => setRow(it.id, { vQty: e.target.value })} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "12px 0 8px" }}>
            {en ? "Stock increases only by what you count. The order closes as received once every line is confirmed."
                : "Le stock n'augmente que de ce que vous comptez. La commande se ferme comme reçue une fois chaque ligne confirmée."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={mut.isPending} onClick={() => setStep("choice")}>{en ? "Back" : "Retour"}</button>
            <button className="btn btn-primary" style={{ flex: 2 }} disabled={!canSubmit} onClick={submitRefill}>
              {mut.isPending ? "…" : (en ? "Confirm & add to stock" : "Confirmer & ajouter au stock")}
            </button>
          </div>
        </>)}
      </div>
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
function SendModal({ en, orgName, promoFooter, items, supplier, onClose, onSent }) {
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
    // MP-RESTOCK-PROMO-FOOTER: ONE branding line at the very bottom (after a blank line,
    // so it never clutters the order). Only when the org's promo_footer_enabled is on.
    // Reuses the SAME app-download URL as the receipt download-QR footer.
    const promo = promoFooter
      ? "\n\n" + (en
          ? `Sent with Mon Partenaire Dozie 📲 — the app I use to run my shop. Get it: ${PLAY_STORE_URL}`
          : `Envoyé via Mon Partenaire Dozie 📲 — l'appli que j'utilise pour gérer ma boutique. Téléchargez : ${PLAY_STORE_URL}`)
      : "";
    return `${header}\n${body}${note.trim() ? `\n\n${note.trim()}` : ""}${promo}`;
  }, [validRows, orgName, note, en, promoFooter]);

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
