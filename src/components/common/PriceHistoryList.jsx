// PRICE HISTORY (owner) — every change to cost / min / wholesale / sell on one product: when, who,
// from which screen, old → new. Server: GET /products/:id/price-history (product_price_changed rows,
// plus Receive Goods price changes skipped on an offline replay). Collapsed until opened, so the
// Edit Product modal makes no extra request unless the owner asks.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { useCurrency } from "../../utils/useCurrency";

const FIELD = {
  cost_price:      { en: "Cost",      fr: "Achat" },
  min_price:       { en: "Min",       fr: "Minimum" },
  wholesale_price: { en: "Wholesale", fr: "Gros" },
  sell_price:      { en: "Sell",      fr: "Vente" },
};
const SOURCE = {
  "product-create":       { en: "Add product",     fr: "Ajout produit" },
  "product-edit":         { en: "Edit product",    fr: "Modification produit" },
  "rapid-entry":          { en: "Rapid entry",     fr: "Saisie rapide" },
  "import":               { en: "Import",          fr: "Import" },
  "receive-goods":        { en: "Receive goods",   fr: "Réception" },
  "goods-buffer-release": { en: "Goods buffer",    fr: "Zone tampon" },
  "kit-part":             { en: "Kit part",        fr: "Pièce de kit" },
};

export default function PriceHistoryList({ productId, lang }) {
  const en = lang === "en";
  const fmt = useCurrency();
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["product-price-history", productId],
    queryFn: () => api.get(`/products/${productId}/price-history`).then(r => r.data?.data || []),
    enabled: open && !!productId,
  });
  const money = (v) => (v == null || !(+v > 0) ? (en ? "not set" : "non défini") : fmt(v));

  return (
    <div data-price-history style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", fontWeight: 700, fontSize: 13 }}>
        🕘 {en ? "Price history" : "Historique des prix"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          {isLoading && <div style={{ color: "var(--text-muted)" }}>…</div>}
          {isError && <div style={{ color: "#f87171" }}>{en ? "Could not load the history." : "Impossible de charger l'historique."}</div>}
          {!isLoading && !isError && (data || []).length === 0 && (
            <div style={{ color: "var(--text-muted)" }}>{en ? "No price change recorded yet." : "Aucun changement de prix enregistré."}</div>
          )}
          {(data || []).map(row => (
            <div key={row.id} style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
              <div style={{ color: "var(--text-muted)" }}>
                {new Date(row.at).toLocaleString(en ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" })}
                {" · "}{row.user_name || "—"}
                {" · "}{(SOURCE[row.source] || { en: row.source || "—", fr: row.source || "—" })[en ? "en" : "fr"]}
              </div>
              {row.skipped ? (
                <div style={{ color: "#f87171" }}>
                  ⚠️ {en ? "Not saved (offline receive):" : "Non enregistré (réception hors ligne) :"}{" "}
                  {Object.entries(row.attempted || {}).map(([k, v]) => `${(FIELD[k] || { en: k, fr: k })[en ? "en" : "fr"]} ${money(v)}`).join(", ")}
                  {" — "}{en ? row.message_en : row.message_fr}
                </div>
              ) : (
                <div>
                  {Object.entries(row.changes || {}).map(([k, c]) => (
                    <span key={k} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                      {(FIELD[k] || { en: k, fr: k })[en ? "en" : "fr"]}: {money(c.old)} → <strong>{money(c.new)}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
