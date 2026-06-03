// MP-DOZIE-INVENTORY-PUBLISH-UI
//
// Per-product Dozie publish / edit / unlist modal. Opened from the
// Inventory list's 🛒 action button. Three states drive the layout:
//
//   no listing  → "Not listed on Dozie marketplace" + [Publish] CTA
//   listed live → fields editable (dozie_price, max_qty, is_visible,
//                 city) + Save / Unpublish actions
//   listed paused → same form, status badge ⏸ Paused, Save / Resume
//                 / Unpublish actions
//
// Backend pa_dozie_seller_listings is UNIQUE on (org_id, product_id)
// so the POST endpoint upserts — re-publishing a previously unlisted
// product never collides.
//
// Stock check: pa_stock summed across all locations < 1 surfaces
// an "Out of stock" warning so the owner doesn't publish something
// the marketplace can't fulfil. Soft warning, not a block.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api, { formatCFA } from "../../utils/api";

export default function DoziePublishModal({ productId, productName, defaultPrice, defaultCity, totalStock, onClose, lang = "fr" }) {
  const en = lang === "en";
  const qc = useQueryClient();

  // Load the existing listing for this product (if any). The /
  // endpoint returns ALL listings for the org; we filter client-side
  // for the single row. Cheap — the org's full listings set already
  // lives in react-query cache.
  const listingsQuery = useQuery({
    queryKey: ["dozie-listings"],
    queryFn:  () => api.get("/dozie-listings").then(r => r.data?.data || []),
    staleTime: 30000,
  });
  const existing = (listingsQuery.data || []).find(l => l.product_id === productId) || null;

  // Form state. Initialised from existing when present, else from
  // the product's sell_price + the owner's org city as sensible
  // first-publish defaults.
  const [doziePrice, setDoziePrice] = useState("");
  const [maxQty, setMaxQty]         = useState("");
  const [isVisible, setIsVisible]   = useState(true);
  const [city, setCity]             = useState("");

  useEffect(() => {
    if (existing) {
      setDoziePrice(existing.dozie_price != null ? String(existing.dozie_price) : String(defaultPrice ?? ""));
      setMaxQty(existing.max_qty != null ? String(existing.max_qty) : "");
      setIsVisible(existing.is_visible !== false);
      setCity(existing.city || defaultCity || "");
    } else {
      setDoziePrice(String(defaultPrice ?? ""));
      setMaxQty("");
      setIsVisible(true);
      setCity(defaultCity || "");
    }
  }, [existing?.id, defaultPrice, defaultCity, productId]);

  // ── Mutations ────────────────────────────────────────────────
  const upsertMutation = useMutation({
    mutationFn: (body) => existing
      ? api.put(`/dozie-listings/${productId}`, body).then(r => r.data?.data)
      : api.post("/dozie-listings", { product_id: productId, ...body }).then(r => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dozie-listings"] });
      toast.success(en ? "✓ Dozie listing saved" : "✓ Annonce Dozie enregistrée");
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || (en ? "Save failed" : "Échec de l'enregistrement"));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/dozie-listings/${productId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dozie-listings"] });
      toast.success(en ? "✓ Unpublished from Dozie" : "✓ Retiré de Dozie");
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || (en ? "Unpublish failed" : "Échec du retrait"));
    },
  });

  const handleSave = () => {
    const priceNum = Number(doziePrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error(en ? "Dozie price must be greater than 0" : "Le prix Dozie doit être > 0");
      return;
    }
    const body = {
      dozie_price: priceNum,
      max_qty:     maxQty === "" ? null : Number(maxQty),
      is_visible:  !!isVisible,
      city:        city.trim() || null,
    };
    upsertMutation.mutate(body);
  };

  const handleUnpublish = () => {
    if (!confirm(en
      ? `Unpublish "${productName}" from Dozie marketplace?`
      : `Retirer "${productName}" du marché Dozie ?`)) return;
    deleteMutation.mutate();
  };

  const outOfStock = (totalStock || 0) < 1;
  const status = !existing ? "none"
              : !existing.is_visible ? "paused"
              : outOfStock ? "out_of_stock"
              : "live";
  const STATUS_PILL = {
    live:         { label: en ? "🟢 Live"          : "🟢 En ligne",       color: "#34d399", bg: "rgba(52,211,153,0.12)" },
    paused:       { label: en ? "⏸ Paused"         : "⏸ En pause",        color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
    out_of_stock: { label: en ? "⚠ Out of stock"   : "⚠ Stock épuisé",    color: "#f87171", bg: "rgba(248,113,113,0.12)" },
    none:         { label: en ? "Not listed"       : "Non listé",          color: "var(--text-muted)", bg: "transparent" },
  }[status];

  const busy = upsertMutation.isPending || deleteMutation.isPending;

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>🛒 {en ? "Dozie Marketplace" : "Marché Dozie"}</div>
          <button onClick={onClose} aria-label="close"
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>{productName}</div>

        <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      color: STATUS_PILL.color, background: STATUS_PILL.bg, marginBottom: 14 }}>
          {STATUS_PILL.label}
        </div>

        {!existing ? (
          <div style={{ background: "var(--bg-card)", border: "1px dashed var(--border)", borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 13, color: "var(--text-muted)" }}>
            {en
              ? "Not listed on Dozie marketplace. Set a price and click Publish to expose this product to buyers."
              : "Non listé sur le marché Dozie. Définissez un prix et cliquez sur Publier pour exposer ce produit aux acheteurs."}
          </div>
        ) : outOfStock && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 12, color: "#f87171" }}>
            ⚠ {en
              ? "0 in stock across all locations. Buyers will see this listing as unavailable."
              : "0 en stock sur tous les sites. Les acheteurs verront cette annonce comme indisponible."}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>{en ? "Dozie price (FCFA)" : "Prix Dozie (FCFA)"} *</label>
            <input type="number" inputMode="numeric" min={0} value={doziePrice}
              onChange={e => setDoziePrice(e.target.value)} style={inputStyle}
              placeholder={String(defaultPrice ?? "")} />
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
              {en ? `Walk-in price: ${formatCFA(defaultPrice)}` : `Prix détail: ${formatCFA(defaultPrice)}`}
            </div>
          </div>
          <div>
            <label style={labelStyle}>{en ? "Max qty (optional)" : "Qté max (facultatif)"}</label>
            <input type="number" inputMode="numeric" min={0} value={maxQty}
              onChange={e => setMaxQty(e.target.value)} style={inputStyle}
              placeholder={en ? "unlimited" : "illimité"} />
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
              {en ? "Caps exposed stock; blank = use real stock" : "Limite le stock exposé; vide = stock réel"}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{en ? "City override (optional)" : "Ville (facultatif)"}</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)} style={inputStyle}
            placeholder={defaultCity || (en ? "uses org city" : "ville de l'org par défaut")} />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-card)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 18, cursor: "pointer" }}>
          <input type="checkbox" checked={isVisible} onChange={e => setIsVisible(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "var(--brand)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{en ? "Visible to buyers" : "Visible aux acheteurs"}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {en
                ? "Uncheck to pause without unpublishing."
                : "Décocher pour mettre en pause sans dépublier."}
            </div>
          </div>
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: busy ? "not-allowed" : "pointer", fontWeight: 600 }}>
            {en ? "Cancel" : "Annuler"}
          </button>
          {existing && (
            <button onClick={handleUnpublish} disabled={busy}
              style={{ flex: 1, padding: "10px", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 10, background: "transparent", color: "#f87171", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13 }}>
              {en ? "Unpublish" : "Retirer"}
            </button>
          )}
          <button onClick={handleSave} disabled={busy}
            style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: "var(--brand)", color: "#152B52", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: busy ? 0.6 : 1 }}>
            {busy ? "..." : existing ? (en ? "✓ Save" : "✓ Enregistrer") : (en ? "🚀 Publish" : "🚀 Publier")}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13 };
