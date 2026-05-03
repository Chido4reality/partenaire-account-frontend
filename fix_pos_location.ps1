# Fix POS to show location selector directly on the sales screen
# Run from frontend folder

$pos = Get-Content "src\pages\POSPage.jsx" -Raw

# Add location query at the top of the component
$oldQuery = 'const { data: products } = useQuery({'
$newCode = 'const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });
  const locations = locData?.data || [];

  const ' + $oldQuery

$pos = $pos -replace [regex]::Escape('const { data: products } = useQuery({'), $newCode

# Replace the location error with a proper selector in the UI
# Find the USB scanner hint and add location selector before it
$oldHint = '        {/* USB scanner hint */}'
$newHint = '        {/* Location selector */}
        <div style={{ marginBottom: 12 }}>
          <select className="input" value={selectedLocation?.id || ""} 
            onChange={e => {
              const loc = locations.find(l => l.id === e.target.value);
              setLocation(loc || null);
            }}
            style={{ background: "var(--bg-elevated)", borderColor: !selectedLocation ? "#ef4444" : "var(--border)" }}>
            <option value="">{lang === "en" ? "-- Select selling location --" : "-- Choisir le point de vente --"}</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name} ({l.type})</option>
            ))}
          </select>
          {!selectedLocation && (
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>
              {lang === "en" ? "Please select a location to start selling" : "Veuillez choisir un emplacement pour vendre"}
            </div>
          )}
        </div>

        {/* USB scanner hint */}'

$pos = $pos -replace [regex]::Escape('        {/* USB scanner hint */}'), $newHint

# Also import setLocation from settings store
$pos = $pos -replace 'const { selectedLocation } = useSettingsStore\(\);', 'const { selectedLocation, setLocation } = useSettingsStore();'

Set-Content "src\pages\POSPage.jsx" -Value $pos -Encoding UTF8
Write-Host "POS location selector fixed!" -ForegroundColor Green
