// MP-DOZIE-SELLER-MIGRATION Phase 2 — "My Dozie Orders".
//
// An MP-linked seller manages their incoming Dozie orders from inside MP —
// accept / reject / status updates. One save path → PATCH
// /api/dozie/seller/orders/:id (status PATCH + buyer notification, ported from
// the Dozie portal). PAYMENTS/ESCROW stay on the Dozie backend — nothing here
// touches /campay; orders are at_shop. Standalone sellers never reach this page.
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";

const STATUS_META = {
  pending:   { en: "Pending",   fr: "En attente", bg: "rgba(245,158,11,0.15)",  fg: "#fbbf24" },
  confirmed: { en: "Confirmed", fr: "Confirmée",  bg: "rgba(59,130,246,0.15)",  fg: "#60a5fa" },
  ready:     { en: "Ready",     fr: "Prête",      bg: "rgba(168,85,247,0.15)",  fg: "#c084fc" },
  shipped:   { en: "Shipped",   fr: "Expédiée",   bg: "rgba(14,165,233,0.15)",  fg: "#38bdf8" },
  delivered: { en: "Delivered", fr: "Livrée",     bg: "rgba(16,185,129,0.15)",  fg: "#34d399" },
  rejected:  { en: "Rejected",  fr: "Refusée",    bg: "rgba(239,68,68,0.15)",   fg: "#f87171" },
};
// Actions available per current status (button label → status to set).
const NEXT_ACTIONS = {
  pending:   [{ action: "accept", en: "Accept", fr: "Accepter", primary: true }, { action: "reject", en: "Reject", fr: "Refuser", danger: true }],
  confirmed: [{ status: "ready", en: "Mark ready", fr: "Prête" }, { status: "shipped", en: "Mark shipped", fr: "Expédiée" }],
  ready:     [{ status: "delivered", en: "Mark delivered", fr: "Livrée", primary: true }],
  shipped:   [{ status: "delivered", en: "Mark delivered", fr: "Livrée", primary: true }],
};

export default function MyDozieOrdersPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  // Modal-open state lifted here so the orders auto-refresh can pause while an
  // in-progress action is open (payment-mode picker / counter modal).
  const [recordOrder, setRecordOrder] = useState(null);   // order awaiting payment-mode pick
  const [counterOrder, setCounterOrder] = useState(null); // order being countered

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["dozie-seller-me"],
    queryFn: () => api.get("/dozie/seller/me").then(r => r.data),
  });
  const linked = !!meData?.data?.linked;

  // MP SIDEBAR NOTIFICATION SIGNAL — opening the Orders section clears the
  // seller's unread order/payment ptn_notifications (shared read-state with the
  // Dozie app) and refreshes the sidebar badge.
  useEffect(() => {
    if (!linked) return;
    api.post("/dozie/seller/notif-read", { types: ["order", "payment"] })
      .then(() => qc.invalidateQueries({ queryKey: ["dozie-seller-notif-counts"] }))
      .catch(() => {});
  }, [linked]);

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["dozie-seller-orders", statusFilter, search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (statusFilter) q.set("status", statusFilter);
      if (search.trim()) q.set("search", search.trim());
      return api.get(`/dozie/seller/orders${q.toString() ? "?" + q.toString() : ""}`).then(r => r.data);
    },
    enabled: linked,
    // Auto-refresh new incoming orders every 30s (matches the attention-badge
    // cadence). Paused while a payment-mode picker or counter modal is open so a
    // background re-fetch can't disrupt an in-progress action.
    refetchInterval: (recordOrder || counterOrder) ? false : 30000,
    refetchIntervalInBackground: false,
  });
  const orders = ordersData?.data || [];

  // Dozie marketplace KPIs (server-computed, seller-scoped — independent of the
  // status/search filter on the orders list).
  const { data: reportsData } = useQuery({
    queryKey: ["dozie-seller-reports"],
    queryFn: () => api.get("/dozie/seller/reports").then(r => r.data),
    enabled: linked,
  });
  const rep = reportsData?.data || null;
  const ov = rep?.overview || {};

  const navigate = useNavigate();
  const [counterLines, setCounterLines] = useState([]);
  const [counterNote, setCounterNote] = useState("");

  const actMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/dozie/seller/orders/${id}`, body),
    onSuccess: () => { toast.success(en ? "Updated — buyer notified" : "Mis à jour — acheteur notifié"); qc.invalidateQueries(["dozie-seller-orders"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  const recordMut = useMutation({
    mutationFn: ({ id, payment_mode }) => api.post(`/dozie/seller/orders/${id}/record-sale`, { payment_mode }),
    onSuccess: () => {
      setRecordOrder(null);
      toast.success(en ? "Recorded — finalize it in Online Cart" : "Enregistré — finalisez dans le Panier en ligne");
      qc.invalidateQueries(["dozie-seller-orders"]);
      qc.invalidateQueries(["online-cart-pending-count"]);
      navigate("/online-cart");
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  const counterMut = useMutation({
    mutationFn: ({ id, items, note }) => api.post(`/dozie/seller/orders/${id}/counter`, { items, note }),
    onSuccess: () => { setCounterOrder(null); toast.success(en ? "Counter sent — buyer notified" : "Contre-offre envoyée — acheteur notifié"); qc.invalidateQueries(["dozie-seller-orders"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  function openCounter(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    setCounterLines(items.map(it => ({ product_id: it.product_id || null, name: it.name || "?", qty: Number(it.qty || it.quantity || 1), price: Number(it.price || 0) })));
    setCounterNote("");
    setCounterOrder(o);
  }
  const counterTotal = counterLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  const wrap = (children) => <div style={{ maxWidth: 880, margin: "0 auto", padding: 20 }}>{children}</div>;
  if (meLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);
  if (!linked) {
    return wrap(
      <div className="card" style={{ textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{en ? "Partenaire Dozie not activated" : "Partenaire Dozie non activé"}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
          {en ? "Activate your Dozie seller profile in Settings to receive marketplace orders here." : "Activez votre profil vendeur Dozie dans Paramètres pour recevoir les commandes ici."}
        </div>
        <Link to="/settings" className="btn btn-primary">{en ? "Go to Settings" : "Aller aux Paramètres"}</Link>
      </div>
    );
  }

  const itemSummary = (o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) return "—";
    const parts = items.slice(0, 3).map(it => `${it.qty || it.quantity || 1}× ${it.name || it.product_name || "?"}`);
    return parts.join(", ") + (items.length > 3 ? ` +${items.length - 3}` : "");
  };

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "My Dozie Orders" : "Mes commandes Dozie"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        {en ? "Incoming wholesale orders from Partenaire Dozie. Payment is handled at your shop (at-shop)." : "Commandes de gros reçues via Partenaire Dozie. Le paiement se fait à la boutique."}
      </div>

      {rep && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 14, background: "var(--bg-card)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            🛒 {en ? "Partenaire Dozie — marketplace" : "Partenaire Dozie — marché"}
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {[
              { label: en ? "Revenue" : "Revenu", value: fmt(ov.total_revenue || 0), accent: "var(--brand-light)" },
              { label: en ? "Orders" : "Commandes", value: ov.order_count ?? rep.orders_total ?? 0 },
              { label: en ? "Pending" : "En attente", value: ov.pending_orders ?? (rep.orders_by_status?.pending || 0), accent: "#fbbf24" },
              { label: en ? "Products" : "Produits", value: ov.product_count ?? "—" },
              { label: en ? "Revenue (30d)" : "Revenu (30j)", value: fmt(rep.revenue_30d || 0) },
            ].map((s, i) => (
              <div key={i} style={{ minWidth: 86 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.accent || "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>
          {rep.orders_by_status && Object.keys(rep.orders_by_status).length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              {Object.entries(rep.orders_by_status).sort((a, b) => b[1] - a[1]).map(([st, n]) => {
                const sm = STATUS_META[st];
                return (
                  <span key={st} className="badge" style={{ background: sm ? sm.bg : "rgba(148,163,184,0.18)", color: sm ? sm.fg : "#94a3b8", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>
                    {(sm ? (en ? sm.en : sm.fr) : st)}: {n}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder={en ? "Search order ref (QOF-…)" : "Rechercher réf (QOF-…)"}
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{en ? "All statuses" : "Tous statuts"}</option>
          {["pending", "confirmed", "ready", "shipped", "delivered", "rejected"].map(s =>
            <option key={s} value={s}>{(STATUS_META[s] && (en ? STATUS_META[s].en : STATUS_META[s].fr)) || s}</option>)}
        </select>
      </div>

      {ordersLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading orders…" : "Chargement…"}</div>}
      {!ordersLoading && !orders.length && <div style={{ color: "var(--text-muted)" }}>{en ? "No orders match." : "Aucune commande."}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {orders.map(o => {
          const sm = STATUS_META[o.status] || { bg: "rgba(148,163,184,0.18)", fg: "#94a3b8", en: o.status, fr: o.status };
          const actions = NEXT_ACTIONS[o.status] || [];
          return (
            <div key={o.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--bg-card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{o.order_ref || o.id.slice(0, 8)}</span>
                    <span className="badge" style={{ background: sm.bg, color: sm.fg, fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? sm.en : sm.fr}</span>
                    {o.counter_status === "pending" && <span className="badge" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? "✏️ Counter sent — awaiting buyer" : "✏️ Contre-offre envoyée"}</span>}
                    {o.counter_status === "accepted" && <span className="badge" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? "✅ Counter accepted" : "✅ Contre-offre acceptée"}</span>}
                    {o.counter_status === "rejected" && <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? "❌ Counter rejected" : "❌ Contre-offre refusée"}</span>}
                    {o.mp_sale?.recorded && <span className="badge" style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{o.mp_sale.sale_id ? (en ? "💰 Sale recorded" : "💰 Vente enregistrée") : (en ? "🧾 In Online Cart" : "🧾 Dans le panier")}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {o.buyer_name || (en ? "Buyer" : "Acheteur")}{o.buyer_phone ? ` · ${o.buyer_phone}` : ""} · {new Date(o.created_at).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{itemSummary(o)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "var(--brand-light)" }}>{fmt(o.total)}</div>
                </div>
              </div>
              {(() => {
                const canRecord = ["confirmed", "shipped", "delivered"].includes(o.status) && !o.mp_sale?.recorded;
                const finalizeOnly = o.mp_sale?.recorded && !o.mp_sale.sale_id;
                if (!(actions.length || o.status === "pending" || canRecord || finalizeOnly)) return null;
                return (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {actions.map((a, i) => (
                      <button key={i} className={"btn btn-sm" + (a.primary ? " btn-primary" : "")}
                        style={a.danger ? { color: "#f87171" } : {}}
                        disabled={actMutation.isPending}
                        onClick={() => actMutation.mutate({ id: o.id, body: a.action ? { action: a.action } : { status: a.status } })}>
                        {en ? a.en : a.fr}
                      </button>
                    ))}
                    {o.status === "pending" && (
                      <button className="btn btn-sm" onClick={() => openCounter(o)}>{en ? "Counter / adjust price" : "Contre-offre / prix"}</button>
                    )}
                    {canRecord && (
                      <button className="btn btn-sm btn-primary" onClick={() => setRecordOrder(o)}>{en ? "Record as MP sale" : "Enregistrer comme vente MP"}</button>
                    )}
                    {finalizeOnly && (
                      <button className="btn btn-sm" onClick={() => navigate("/online-cart")}>{en ? "Finalize in Online Cart →" : "Finaliser dans le Panier →"}</button>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Record-as-MP-sale — payment-mode picker */}
      {recordOrder && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={() => setRecordOrder(null)}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, maxWidth: 420, width: "100%" }} onMouseDown={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>{en ? "Record as MP sale" : "Enregistrer comme vente MP"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
              {en ? `Order ${recordOrder.order_ref} — ${fmt(recordOrder.total)}. How was/will it be paid?` : `Commande ${recordOrder.order_ref} — ${fmt(recordOrder.total)}. Mode de paiement ?`}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {[
                { pm: "paid_online_full", en: "Paid online in full", fr: "Payé en ligne intégralement" },
                { pm: "pay_at_shop", en: "Pay at shop (cash on pickup)", fr: "Paiement à la boutique" },
                { pm: "partial", en: "Partial / deposit", fr: "Partiel / acompte" },
                { pm: "credit", en: "Credit (customer ledger)", fr: "Crédit (ardoise client)" },
              ].map(opt => (
                <button key={opt.pm} className="btn" style={{ justifyContent: "flex-start" }} disabled={recordMut.isPending}
                  onClick={() => recordMut.mutate({ id: recordOrder.id, payment_mode: opt.pm })}>
                  {en ? opt.en : opt.fr}
                </button>
              ))}
            </div>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setRecordOrder(null)}>{en ? "Cancel" : "Annuler"}</button>
          </div>
        </div>
      )}

      {/* Counter-offer editor */}
      {counterOrder && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={() => setCounterOrder(null)}>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto" }} onMouseDown={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{en ? "Counter / adjust price" : "Contre-offre / ajuster le prix"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{en ? `Order ${counterOrder.order_ref} — the buyer reviews & accepts your new total.` : `Commande ${counterOrder.order_ref} — l'acheteur valide votre nouveau total.`}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {counterLines.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 600 }}>{l.name}</div>
                  <input className="input" type="number" style={{ width: 70 }} value={l.qty}
                    onChange={e => setCounterLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                  <span style={{ color: "var(--text-muted)" }}>×</span>
                  <input className="input" type="number" style={{ width: 100 }} value={l.price}
                    onChange={e => setCounterLines(ls => ls.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <input className="input" style={{ marginTop: 10 }} placeholder={en ? "Note (optional)" : "Note (optionnel)"} value={counterNote} onChange={e => setCounterNote(e.target.value)} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <span style={{ fontWeight: 800 }}>{en ? "New total" : "Nouveau total"}: {fmt(counterTotal)}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setCounterOrder(null)}>{en ? "Cancel" : "Annuler"}</button>
                <button className="btn btn-sm btn-primary" disabled={counterMut.isPending || !counterLines.length}
                  onClick={() => counterMut.mutate({ id: counterOrder.id, items: counterLines.map(l => ({ product_id: l.product_id || null, name: l.name, qty: Number(l.qty) || 0, price: Number(l.price) || 0 })), note: counterNote })}>
                  {counterMut.isPending ? "…" : (en ? "Send counter" : "Envoyer")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
