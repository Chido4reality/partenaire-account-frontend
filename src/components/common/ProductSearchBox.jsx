import { useState, useEffect, useRef } from "react";
import api from "../../utils/api";
import BarcodeInput from "./BarcodeInput";

// ── SHARED PRODUCT SEARCH BOX ────────────────────────────────────────────────
// One typo-tolerant, scrollable product search used by every MP product-search
// box (Receive Goods, New Transfer, …). It hits GET /products?search= which runs
// the DB function search_products_fuzzy (trigram + unaccent + substring-anywhere
// + barcode, ranked best-first) and HYDRATES full product rows (sell_price /
// cost_price / wholesale_price / min_price / stock), so onSelect receives a
// complete product and price-on-select keeps working.
//
//  • Typo-tolerant: server fuzzy when online; offline/error → client substring
//    filter of `fallbackProducts` (so it still works without a connection).
//  • SCROLLABLE results: max-height (~55vh / 300px) + overflow-y:auto, anchored
//    absolutely under the input so it never pushes page content down.
//  • Barcode scanning: the fuzzy function matches barcodes; an exact single
//    barcode hit auto-selects (USB scanner "just scan"). Camera scan comes free
//    from the embedded BarcodeInput.
//  • Keyboard: Enter adds the top match. Click/tap selects a row.
//
// Props:
//   onSelect(product)   – required; gets the full product row.
//   locationId          – optional; attaches per-location stock to results.
//   fallbackProducts    – optional cached list for offline/error client search.
//   renderMeta(product) – optional right-side cell (e.g. price / available).
//   placeholder, autoFocus, inputRef, lang, limit (default 30),
//   minChars (default 1), clearOnSelect (default true — clear + refocus for
//   rapid entry; pass false when the parent replaces the box on select).
export default function ProductSearchBox({
  onSelect,
  locationId = "",
  fallbackProducts = null,
  renderMeta,
  placeholder,
  autoFocus = false,
  inputRef,
  lang = "en",
  limit = 30,
  minChars = 1,
  clearOnSelect = true,
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const localRef = useRef(null);
  const ref = inputRef || localRef;

  const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const clientFilter = (term) => {
    if (!Array.isArray(fallbackProducts)) return [];
    const t = norm(term), raw = term.trim();
    return fallbackProducts
      .filter(p => norm(p.name).includes(t) || norm(p.name_en).includes(t) || (p.barcode && String(p.barcode).includes(raw)))
      .slice(0, limit);
  };

  const pick = (p) => {
    onSelect(p);
    setResults([]); setOpen(false);
    if (clearOnSelect) { setQ(""); ref.current?.focus(); }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < minChars) { setResults([]); setOpen(false); return; }
    let cancelled = false;
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    const t = setTimeout(async () => {
      let list = null;
      if (online) {
        try {
          const r = await api
            .get(`/products?search=${encodeURIComponent(term)}&location_id=${locationId || ""}&limit=${limit}`, { timeout: 20000 })
            .then(x => x.data);
          if (Array.isArray(r?.data)) list = r.data;
        } catch { /* fall through to offline client filter */ }
      }
      if (list === null) list = clientFilter(term);
      if (cancelled) return;
      // USB-scanner "just scan": a single exact barcode hit auto-selects.
      if (list.length === 1 && list[0].barcode && String(list[0].barcode) === term) { pick(list[0]); return; }
      setResults(list); setOpen(true);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, locationId, limit, minChars]);

  return (
    <div style={{ position: "relative" }}>
      <BarcodeInput
        inputRef={ref}
        lang={lang}
        value={q}
        onChange={setQ}
        onScan={(code) => setQ(code)}
        autoFocus={autoFocus}
        placeholder={placeholder || (lang === "en" ? "Search or scan — Enter to add" : "Chercher ou scanner — Entrée")}
        onFocus={() => { if (results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) pick(results[0]); } }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60, marginTop: 4,
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10,
          overflowY: "auto", maxHeight: "min(55vh, 300px)", WebkitOverflowScrolling: "touch",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}>
          {results.map((p, i) => (
            <div
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: i === 0 ? "rgba(251,197,3,0.06)" : "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = i === 0 ? "rgba(251,197,3,0.06)" : "transparent")}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}{i === 0 && <span style={{ color: "var(--brand-light)", fontSize: 10, marginLeft: 6 }}>↵</span>}
                </div>
                {p.barcode && <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.barcode}</div>}
              </div>
              {renderMeta && <div style={{ flexShrink: 0 }}>{renderMeta(p)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
