// BAR LAYOUT (Peter 2026-11-18) — the left side of /bar: "Quick sell · Today's best sellers", an
// "All items" button, and a grid of large coloured product boxes (mockup docs/bar-mockup.png.png).
// Order: GET /bar/:id/quick-items (ids only), held still while the current cart / draft has items
// (utils/barLayout.js stableOrder). Product details (name, price, photo, category) come from the
// caller's product list. Each tap = 1 unit, through the caller's onTap (POS addToCart at Home, the
// table's draft on a table). No money logic here.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { stableOrder, gridProducts, productColor, productPhoto, productIconKind, categoryIcon } from "../../utils/barLayout";

const L = (lang, en, fr) => (lang === "en" ? en : fr);

// neutral line icons drawn here — never a brand picture
const ICONS = {
  bottle: <path d="M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3V2zm0 9h4" />,
  glass: <path d="M6 3h12l-1.5 16a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2L6 3zm.8 6h10.4" />,
  plate: <path d="M3 13h18a9 9 0 0 1-18 0zm9-5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13h20" />,
};
function ProductPicture({ p }) {
  const [broken, setBroken] = useState(false);
  const src = productPhoto(p);
  if (src && !broken) return <img className="bar-box-pic" src={src} alt="" decoding="async" onError={() => setBroken(true)} />;
  const emoji = categoryIcon(p);
  if (emoji) return <span className="bar-box-pic bar-box-emoji" aria-hidden="true">{emoji}</span>;
  return (
    <svg className="bar-box-pic bar-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[productIconKind(p)]}
    </svg>
  );
}

export default function QuickGrid({ lang, barId, products, busy, onTap, priceText, allOpen, onAll, max = 12 }) {
  const q = useQuery({
    queryKey: ["bar-quick-items", barId], enabled: !!barId, staleTime: 60000,
    queryFn: () => api.get(`/bar/${barId}/quick-items`).then((r) => r.data?.data?.ids || []),
  });
  const orderRef = useRef(null);
  // before the ranking answers, the product list's own order; then the ranking, held still while busy
  const fresh = q.data && q.data.length ? q.data : (products || []).map((p) => p.id);
  const order = stableOrder(orderRef.current, fresh, busy);
  orderRef.current = order;
  const items = gridProducts(order, products, max);

  return (
    <section className="bar-quick" aria-label={L(lang, "Quick sell", "Vente rapide")}>
      <div className="bar-quick-head">
        <div>
          <h2 className="bar-quick-title">{L(lang, "Quick sell", "Vente rapide")}</h2>
          <div className="bar-quick-sub">{L(lang, "Today's best sellers", "Meilleures ventes du jour")}</div>
        </div>
        <button type="button" className="bar-outline-btn" onClick={onAll} aria-pressed={!!allOpen}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" />
            <rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" />
          </svg>
          {allOpen ? L(lang, "Quick sell", "Vente rapide") : L(lang, "All items", "Tous les articles")}
        </button>
      </div>
      {!allOpen && (
        <div className="bar-grid">
          {items.map((p) => {
            const name = (lang === "en" && p.name_en) || p.name;
            return (
              <button type="button" key={p.id} className="bar-box" style={{ "--box": productColor(p) }} onClick={() => onTap(p)}
                aria-label={`${name} · ${priceText(p)}`}>
                <ProductPicture p={p} />
                <span className="bar-box-text">
                  <span className={`bar-box-name${String(name).length > 22 ? " is-long" : ""}`}>{name}</span>{/* BAR FIT: a long name gets a smaller font */}
                  <span className="bar-box-price">{priceText(p)}</span>
                </span>
              </button>
            );
          })}
          {!items.length && <div className="bar-empty">{L(lang, "No product to show yet — use “All items”.", "Aucun produit à afficher — utilisez « Tous les articles ».")}</div>}
        </div>
      )}
    </section>
  );
}
