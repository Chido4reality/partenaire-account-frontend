// MP-DOZIE-SELLER-MIGRATION Phase 1 — "My Dozie Listings".
//
// An MP-linked seller manages their Dozie marketplace presence from inside MP
// (publish/unpublish, Dozie price, visibility) — no Dozie-portal login. One save
// path → /api/dozie/seller/listings, which writes ONLY the MP control row
// (pa_dozie_seller_listings). STEP 2: stock is the single source of truth in MP
// Inventory (pa_stock) and is shown read-only here — there is no separate Dozie
// stock to set. City is inherited from the shop city (MP-CITY-UNIFY) and shown
// read-only. Standalone sellers never reach this page.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";

export default function MyDozieListingsPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // { product_id, dozie_price, stock, isNew }

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["dozie-seller-me"],
    queryFn: () => api.get("/dozie/seller/me").then(r => r.data),
  });
  const linked = !!meData?.data?.linked;
  const sellerCity = meData?.data?.seller?.city || "";

  const { data: prodData } = useQuery({
    queryKey: ["products-for-dozie"],
    queryFn: () => api.get("/products?limit=500").then(r => r.data),
    enabled: linked,
  });
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["dozie-seller-listings"],
    queryFn: () => api.get("/dozie/seller/listings").then(r => r.data),
    enabled: linked,
  });

  const products = prodData?.data || [];
  const listingByProduct = {};
  (listData?.data || []).forEach(l => { listingByProduct[l.product_id] = l; });

  const saveMutation = useMutation({
    mutationFn: ({ product_id, body, isNew }) =>
      isNew ? api.post("/dozie/seller/listings", { product_id, ...body })
            : api.patch(`/dozie/seller/listings/${product_id}`, body),
    onSuccess: () => { toast.success(en ? "Saved" : "Enregistré"); qc.invalidateQueries(["dozie-seller-listings"]); setEditing(null); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  const visibilityMutation = useMutation({
    mutationFn: ({ product_id, is_visible }) => api.patch(`/dozie/seller/listings/${product_id}`, { is_visible }),
    onSuccess: () => { qc.invalidateQueries(["dozie-seller-listings"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });
  const unpublishMutation = useMutation({
    mutationFn: (product_id) => api.delete(`/dozie/seller/listings/${product_id}`),
    onSuccess: () => { toast.success(en ? "Removed from Dozie" : "Retiré de Dozie"); qc.invalidateQueries(["dozie-seller-listings"]); },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  const wrap = (children) => <div style={{ maxWidth: 880, margin: "0 auto", padding: 20 }}>{children}</div>;

  if (meLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);

  if (!linked) {
    return wrap(
      <div className="card" style={{ textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{en ? "Partenaire Dozie not activated" : "Partenaire Dozie non activé"}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18, lineHeight: 1.6 }}>
          {en ? "Activate your Dozie seller profile in Settings, then publish products to the wholesale marketplace from here."
              : "Activez votre profil vendeur Dozie dans Paramètres, puis publiez vos produits sur le marché de gros ici."}
        </div>
        <Link to="/settings" className="btn btn-primary">{en ? "Go to Settings" : "Aller aux Paramètres"}</Link>
      </div>
    );
  }

  function startEdit(product, listing) {
    setEditing({
      product_id: product.id,
      isNew: !listing,
      dozie_price: listing ? (listing.dozie_price ?? "") : (product.sell_price ?? ""),
      stock: listing && listing.live ? (listing.live.stock ?? 0) : 0,
    });
  }
  function saveEdit() {
    const price = Number(editing.dozie_price);
    if (!Number.isFinite(price) || price < 0) { toast.error(en ? "Enter a valid price" : "Prix invalide"); return; }
    // STEP 2: stock is not set here — it lives in pa_stock (MP Inventory).
    saveMutation.mutate({
      product_id: editing.product_id,
      isNew: editing.isNew,
      body: { dozie_price: price, is_visible: true },
    });
  }

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "My Dozie Listings" : "Mes annonces Dozie"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.55 }}>
        {en ? `Publish your products to the Partenaire Dozie wholesale marketplace. Buyers see these live. City: ${sellerCity || "—"} (from Shop Settings).`
            : `Publiez vos produits sur le marché de gros Partenaire Dozie. Les acheteurs les voient en direct. Ville : ${sellerCity || "—"} (depuis Paramètres boutique).`}
      </div>

      {listLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading listings…" : "Chargement…"}</div>}
      {!products.length && <div style={{ color: "var(--text-muted)" }}>{en ? "No products yet — add products in Inventory first." : "Aucun produit — ajoutez des produits dans Inventaire."}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {products.map(p => {
          const listing = listingByProduct[p.id];
          const live = listing && listing.live;
          const isPublished = !!(listing && listing.is_visible && live && live.published);
          const isEditing = editing && editing.product_id === p.id;
          return (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--bg-card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 180, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {en ? "Shop price" : "Prix boutique"}: {fmt(p.sell_price)}
                    {listing && <> · {en ? "Dozie" : "Dozie"}: {fmt(listing.dozie_price)} · {en ? "Stock" : "Stock"}: {live ? (live.stock ?? 0) : 0}</>}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {listing
                      ? <span className="badge" style={{ background: isPublished ? "rgba(16,185,129,0.15)" : "rgba(148,163,184,0.18)", color: isPublished ? "#34d399" : "#94a3b8", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>
                          {isPublished ? (en ? "● Live on Dozie" : "● En ligne") : (en ? "○ Hidden" : "○ Masqué")}
                        </span>
                      : <span className="badge" style={{ background: "rgba(148,163,184,0.12)", color: "var(--text-muted)", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? "Not published" : "Non publié"}</span>}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {listing && (
                    <button className="btn btn-sm" disabled={visibilityMutation.isPending}
                      onClick={() => visibilityMutation.mutate({ product_id: p.id, is_visible: !listing.is_visible })}>
                      {listing.is_visible ? (en ? "Hide" : "Masquer") : (en ? "Show" : "Afficher")}
                    </button>
                  )}
                  <button className="btn btn-sm btn-primary" onClick={() => startEdit(p, listing)}>
                    {listing ? (en ? "Edit" : "Modifier") : (en ? "Publish" : "Publier")}
                  </button>
                  {listing && (
                    <button className="btn btn-sm" style={{ color: "#f87171" }} disabled={unpublishMutation.isPending}
                      onClick={() => { if (confirm(en ? `Remove "${p.name}" from Dozie?` : `Retirer "${p.name}" de Dozie ?`)) unpublishMutation.mutate(p.id); }}>
                      {en ? "Remove" : "Retirer"}
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <div className="label">{en ? "Dozie price" : "Prix Dozie"}</div>
                    <input className="input" type="number" inputMode="numeric" style={{ width: 140 }}
                      value={editing.dozie_price} onChange={e => setEditing(s => ({ ...s, dozie_price: e.target.value }))} />
                  </div>
                  <div>
                    <div className="label">{en ? "Stock" : "Stock"}</div>
                    <div className="input" style={{ width: 110, display: "flex", alignItems: "center", opacity: 0.7, background: "var(--bg-muted, rgba(148,163,184,0.08))" }}>
                      {editing.stock ?? 0}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, maxWidth: 130 }}>
                      {en ? "From Inventory" : "Depuis l'Inventaire"}
                    </div>
                  </div>
                  <button className="btn btn-primary" disabled={saveMutation.isPending} onClick={saveEdit}>
                    {saveMutation.isPending ? "…" : (editing.isNew ? (en ? "Publish" : "Publier") : (en ? "Save" : "Enregistrer"))}
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}>{en ? "Cancel" : "Annuler"}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
