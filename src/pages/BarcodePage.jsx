import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore, useAuthStore } from "../store";
import api, { formatCFA } from "../utils/api";
import CameraScanner from "../components/common/CameraScanner";

export default function BarcodePage() {
  const { lang } = useLangStore();
  const { user, org } = useAuthStore();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [copies, setCopies] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  const [showOrg, setShowOrg] = useState(true);
  const [labelSize, setLabelSize] = useState("medium"); // small, medium, large
  const [priceType, setPriceType] = useState("sell"); // sell, wholesale

  const { data: productsData } = useQuery({
    queryKey: ["products-barcode"],
    queryFn: () => api.get("/products?limit=200").then(r => r.data)
  });

  const products = (productsData?.data || []).filter(p =>
    search ? p.name?.toLowerCase().includes(search.toLowerCase()) || p.barcode?.includes(search) : true
  );

  const labelDims = {
    small:  { width: 150, height: 80,  fontSize: 9,  barcodeH: 30 },
    medium: { width: 200, height: 110, fontSize: 11, barcodeH: 40 },
    large:  { width: 260, height: 140, fontSize: 13, barcodeH: 50 },
  };

  const dims = labelDims[labelSize];

  // Generate simple barcode SVG using Code-128 style bars (visual representation)
  const generateBarcodeLines = (code) => {
    if (!code) return "";
    const chars = code.split("").map(c => c.charCodeAt(0));
    const lines = [];
    let x = 10;
    chars.forEach((ch, i) => {
      const w1 = ((ch % 3) + 1) * 1.2;
      const w2 = ((ch % 5) + 1) * 0.8;
      lines.push(`<rect x="${x}" y="0" width="${w1}" height="${dims.barcodeH}" fill="black"/>`);
      x += w1 + w2;
    });
    return lines.join("");
  };

  const getLabelSVG = (product) => {
    const price = priceType === "wholesale" ? product.wholesale_price : product.sell_price;
    const barcodeCode = product.barcode || product.id?.slice(-8).toUpperCase();
    const totalWidth = dims.width;
    const totalHeight = dims.height;
    const orgName = org?.name || "Mon Partenaire";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" style="border:1px solid #ccc;border-radius:4px;background:white;font-family:Arial,sans-serif;">
      ${showOrg ? `<text x="${totalWidth/2}" y="14" text-anchor="middle" font-size="${dims.fontSize - 1}" fill="#666">${orgName}</text>` : ""}
      <text x="${totalWidth/2}" y="${showOrg ? 28 : 16}" text-anchor="middle" font-size="${dims.fontSize + 1}" font-weight="bold" fill="#000">${product.name?.length > 22 ? product.name.slice(0, 22) + "…" : product.name}</text>
      <g transform="translate(${(totalWidth - (barcodeCode.length * 3.5)) / 2}, ${showOrg ? 35 : 22})">
        ${generateBarcodeLines(barcodeCode)}
      </g>
      <text x="${totalWidth/2}" y="${showOrg ? 35 + dims.barcodeH + 12 : 22 + dims.barcodeH + 12}" text-anchor="middle" font-size="${dims.fontSize - 1}" fill="#333" font-family="monospace">${barcodeCode}</text>
      ${showPrice ? `<text x="${totalWidth/2}" y="${totalHeight - 8}" text-anchor="middle" font-size="${dims.fontSize + 1}" font-weight="bold" fill="#4f46e5">${formatCFA(price)}</text>` : ""}
    </svg>`;
  };

  const handlePrint = () => {
    if (!selected) return;
    const label = getLabelSVG(selected);
    const labelsHtml = Array(copies).fill(label).join("");

    const w = window.open("", "_blank", "width=800,height=600");
    w.document.write(`
      <html><head>
        <title>Labels — ${selected.name}</title>
        <style>
          body { margin: 0; padding: 10px; background: #fff; }
          .labels { display: flex; flex-wrap: wrap; gap: 6px; }
          .label { display: inline-block; }
          @media print {
            body { margin: 0; padding: 0; }
            .no-print { display: none; }
            .labels { gap: 4px; }
          }
        </style>
      </head><body>
        <div class="no-print" style="padding:10px 0 16px;display:flex;gap:10px;align-items:center">
          <button onclick="window.print()" style="padding:8px 20px;background:#4f46e5;color:#fff;border:none;borderRadius:8px;cursor:pointer;font-size:14px;font-weight:600">🖨️ Print</button>
          <button onclick="window.close()" style="padding:8px 16px;background:#eee;border:none;borderRadius:8px;cursor:pointer;font-size:14px">Close</button>
          <span style="color:#666;font-size:13px">${copies} label(s) for ${selected.name}</span>
        </div>
        <div class="labels">${labelsHtml}</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
  };

  const handlePrintAll = (productList) => {
    const labelsHtml = productList.map(p => getLabelSVG(p)).join("");
    const w = window.open("", "_blank", "width=800,height=600");
    w.document.write(`
      <html><head>
        <title>All Labels</title>
        <style>
          body { margin: 0; padding: 10px; background: #fff; }
          .labels { display: flex; flex-wrap: wrap; gap: 6px; }
          @media print { body { margin: 0; } .no-print { display: none; } }
        </style>
      </head><body>
        <div class="no-print" style="padding:10px 0 16px">
          <button onclick="window.print()" style="padding:8px 20px;background:#4f46e5;color:#fff;border:none;borderRadius:8px;cursor:pointer;font-size:14px;font-weight:600">🖨️ Print All</button>
          <button onclick="window.close()" style="padding:8px 16px;background:#eee;border:none;borderRadius:8px;cursor:pointer;margin-left:8px;font-size:14px">Close</button>
        </div>
        <div class="labels">${labelsHtml}</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">🏷️ {lang === "en" ? "Barcode Labels" : "Étiquettes code-barres"}</h1>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {lang === "en" ? "Generate and print product labels for shelves or products." : "Générez et imprimez des étiquettes pour les rayons ou les produits."}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => handlePrintAll(products.slice(0, 50))} disabled={products.length === 0}>
          🖨️ {lang === "en" ? "Print All" : "Tout imprimer"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

        {/* LEFT: Product list */}
        <div>
          <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={lang === "en" ? "Search product by name or barcode..." : "Chercher par nom ou code-barres..."}
              style={{ flex: 1, paddingLeft: 12 }} />
            <button onClick={() => setShowCamera(true)}
              style={{ flexShrink: 0, height: 42, width: 42, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              title={lang === "en" ? "Scan with camera" : "Scanner avec la caméra"}>
              📷
            </button>
          </div>

          {showCamera && (
            <CameraScanner
              lang={lang}
              onScan={(code) => {
                setShowCamera(false);
                setSearch(code);
                const match = (productsData?.data || []).find(p => p.barcode === code);
                if (match) setSelected(match);
              }}
              onClose={() => setShowCamera(false)}
            />
          )}

          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", maxHeight: 520, overflowY: "auto" }}>
            {products.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                {lang === "en" ? "No products found" : "Aucun produit trouvé"}
              </div>
            ) : products.map(p => (
              <div key={p.id}
                onClick={() => setSelected(p)}
                style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", background: selected?.id === p.id ? "rgba(79,70,229,0.1)" : "transparent", borderLeft: selected?.id === p.id ? "3px solid var(--brand)" : "3px solid transparent" }}
                onMouseEnter={e => selected?.id !== p.id && (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                onMouseLeave={e => selected?.id !== p.id && (e.currentTarget.style.background = "transparent")}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                    {p.barcode || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>no barcode</span>}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--brand-light)", fontWeight: 600 }}>{formatCFA(p.sell_price)}</div>
                <button onClick={e => { e.stopPropagation(); setSelected(p); setTimeout(handlePrint, 100); }}
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" }}>
                  🖨️
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Label preview & settings */}
        <div>
          {/* Settings */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>⚙️ {lang === "en" ? "Label settings" : "Paramètres étiquette"}</div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Size" : "Taille"}</label>
              <div style={{ display: "flex", gap: 6 }}>
                {["small", "medium", "large"].map(s => (
                  <button key={s} onClick={() => setLabelSize(s)}
                    style={{ flex: 1, padding: "6px 4px", borderRadius: 8, border: `1px solid ${labelSize === s ? "var(--brand)" : "var(--border)"}`, background: labelSize === s ? "rgba(79,70,229,0.15)" : "var(--bg-elevated)", color: labelSize === s ? "var(--brand-light)" : "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: labelSize === s ? 700 : 400 }}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Price to show" : "Prix à afficher"}</label>
              <select className="input" value={priceType} onChange={e => setPriceType(e.target.value)}>
                <option value="sell">{lang === "en" ? "Walk-in price" : "Prix client"}</option>
                <option value="wholesale">{lang === "en" ? "Wholesale price" : "Prix grossiste"}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="label">{lang === "en" ? "Number of copies" : "Nombre de copies"}</label>
              <input className="input" type="number" min={1} max={100} value={copies} onChange={e => setCopies(Math.max(1, Math.min(100, +e.target.value)))} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} />
                {lang === "en" ? "Show price on label" : "Afficher le prix"}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={showOrg} onChange={e => setShowOrg(e.target.checked)} />
                {lang === "en" ? "Show shop name" : "Afficher le nom du magasin"}
              </label>
            </div>
          </div>

          {/* Preview */}
          {selected ? (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                👁️ {lang === "en" ? "Preview" : "Aperçu"} — {selected.name}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}
                dangerouslySetInnerHTML={{ __html: getLabelSVG(selected) }} />
              <button className="btn btn-primary" style={{ width: "100%", height: 44, fontWeight: 700, fontSize: 15 }}
                onClick={handlePrint}>
                🖨️ {lang === "en" ? `Print ${copies} label(s)` : `Imprimer ${copies} étiquette(s)`}
              </button>
            </div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "2px dashed var(--border)", borderRadius: 12, padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              ← {lang === "en" ? "Select a product to preview its label" : "Sélectionnez un produit pour voir son étiquette"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
