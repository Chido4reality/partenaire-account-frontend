// MP-DOZIE-SELLER-MIGRATION Phase 2 — "My Dozie Orders".
//
// An MP-linked seller manages their incoming Dozie orders from inside MP —
// accept / reject / status updates. One save path → PATCH
// /api/dozie/seller/orders/:id (status PATCH + buyer notification, ported from
// the Dozie portal). PAYMENTS/ESCROW stay on the Dozie backend — nothing here
// touches /campay; orders are at_shop. Standalone sellers never reach this page.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["dozie-seller-me"],
    queryFn: () => api.get("/dozie/seller/me").then(r => r.data),
  });
  const linked = !!meData?.data?.linked;

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["dozie-seller-orders", statusFilter, search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (statusFilter) q.set("status", statusFilter);
      if (search.trim()) q.set("search", search.trim());
      return api.get(`/dozie/seller/orders${q.toString() ? "?" + q.toString() : ""}`).then(r => r.data);
    },
    enabled: linked,
  });
  const orders = ordersData?.data || [];

  const actMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/dozie/seller/orders/${id}`, body),
    onSuccess: () => { toast.success(en ? "Updated — buyer notified" : "Mis à jour — acheteur notifié"); qc.invalidateQueries(["dozie-seller-orders"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

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
              {actions.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {actions.map((a, i) => (
                    <button key={i} className={"btn btn-sm" + (a.primary ? " btn-primary" : "")}
                      style={a.danger ? { color: "#f87171" } : {}}
                      disabled={actMutation.isPending}
                      onClick={() => actMutation.mutate({ id: o.id, body: a.action ? { action: a.action } : { status: a.status } })}>
                      {en ? a.en : a.fr}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
