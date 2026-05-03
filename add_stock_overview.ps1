# Add Stock Overview tab to Inventory page
# This adds a new tab showing all products with quantities per location

$inv = Get-Content "src\pages\InventoryPage.jsx" -Raw

# Add overview tab to the tabs array
$inv = $inv -replace "\{ key: ""alerts"",   en: \`"Alerts \(\$\{alerts\.length\}\)`"", fr: `"Alertes \(\$\{alerts\.length\}\)`" \},", "{ key: `"alerts`",   en: `"Alerts (`${alerts.length})`", fr: `"Alertes (`${alerts.length})`" },
    { key: `"overview`", en: `"Stock Overview`", fr: `"Vue d ensemble`" },"

# Add overview tab content before the closing of the component
$overviewContent = @'

      {/* Stock Overview tab */}
      {tab === "overview" && (
        <StockOverview lang={lang} />
      )}
'@

$inv = $inv -replace "\{/\* Add Product Modal \*/\}", $overviewContent + "`n`n      {/* Add Product Modal */}"

Set-Content "src\pages\InventoryPage.jsx" -Value $inv -Encoding UTF8

# Append the StockOverview component at the end of the file
$overviewComponent = @'

function StockOverview({ lang }) {
  const { data: stockData, isLoading } = useQuery({
    queryKey: ["stock-overview"],
    queryFn: () => api.get("/stock").then(r => r.data),
    refetchInterval: 60000
  });

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const stock = stockData?.data || [];
  const locations = locData?.data || [];

  // Group stock by product
  const byProduct = {};
  stock.forEach(s => {
    const pid = s.pa_products?.id || s.product_id;
    const pname = s.pa_products?.name || "Unknown";
    const punit = s.pa_products?.unit || "pce";
    const pbarcode = s.pa_products?.barcode || "";
    if (!byProduct[pid]) byProduct[pid] = { name: pname, unit: punit, barcode: pbarcode, locations: {}, total: 0 };
    byProduct[pid].locations[s.location_id] = s.quantity;
    byProduct[pid].total += +s.quantity;
  });

  const products = Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));

  if (isLoading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>;

  if (products.length === 0) return (
    <div className="empty-state">
      <div style={{ fontWeight: 600 }}>{lang === "en" ? "No stock yet" : "Aucun stock"}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        {lang === "en"
          ? "All products with quantities at each location. Use this to plan transfers."
          : "Tous les produits avec quantites par emplacement. Utilisez ceci pour planifier les transferts."}
      </div>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "auto" }}>
        <table className="table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>{lang === "en" ? "Product" : "Produit"}</th>
              <th>{lang === "en" ? "Barcode" : "Code-barres"}</th>
              {locations.map(l => (
                <th key={l.id} style={{ textAlign: "right", minWidth: 120 }}>
                  <div>{l.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "none", fontWeight: 400 }}>{l.type}</div>
                </th>
              ))}
              <th style={{ textAlign: "right", color: "var(--brand-light)" }}>
                {lang === "en" ? "TOTAL" : "TOTAL"}
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{p.barcode || "-"}</td>
                {locations.map(l => {
                  const qty = p.locations[l.id];
                  return (
                    <td key={l.id} style={{ textAlign: "right" }}>
                      {qty != null ? (
                        <span style={{ fontWeight: qty > 0 ? 500 : 400, color: qty > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                          {qty} {p.unit}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>-</span>
                      )}
                    </td>
                  );
                })}
                <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)" }}>
                  {p.total} {p.unit}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)" }}>
              <td colSpan={2} style={{ fontWeight: 600, padding: "12px 16px" }}>
                {lang === "en" ? "Total items tracked" : "Total articles suivis"}: {products.length}
              </td>
              {locations.map(l => {
                const locTotal = stock.filter(s => s.location_id === l.id).reduce((sum, s) => sum + +s.quantity, 0);
                return (
                  <td key={l.id} style={{ textAlign: "right", fontWeight: 600, padding: "12px 16px", color: "var(--text-secondary)" }}>
                    {locTotal} {lang === "en" ? "units" : "unites"}
                  </td>
                );
              })}
              <td style={{ textAlign: "right", fontWeight: 700, color: "var(--brand-light)", padding: "12px 16px" }}>
                {stock.reduce((sum, s) => sum + +s.quantity, 0)} {lang === "en" ? "units" : "unites"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
'@

Add-Content "src\pages\InventoryPage.jsx" -Value $overviewComponent -Encoding UTF8

Write-Host "Stock Overview tab added!" -ForegroundColor Green
Write-Host "Run: npm run dev" -ForegroundColor Cyan
