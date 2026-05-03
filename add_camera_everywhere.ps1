# Add camera scan button to all barcode input fields across the app
# Run from frontend folder

# 1. Create a reusable BarcodeInput component
Set-Content -Path "src\components\common\BarcodeInput.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import CameraScanner from "./CameraScanner";

export default function BarcodeInput({ value, onChange, placeholder, lang, style }) {
  const [showCamera, setShowCamera] = useState(false);

  return (
    <>
      {showCamera && (
        <CameraScanner
          lang={lang}
          onScan={(code) => { setShowCamera(false); onChange(code); }}
          onClose={() => setShowCamera(false)}
        />
      )}
      <div style={{ display: "flex", gap: 8, ...style }}>
        <input
          className="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || "Scan or type barcode..."}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          title={lang === "en" ? "Scan with camera" : "Scanner avec camera"}
          style={{
            background: "rgba(79,70,229,0.15)", border: "1px solid var(--brand)",
            borderRadius: "var(--radius-md)", padding: "0 14px",
            color: "var(--brand-light)", cursor: "pointer", fontSize: 18,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, minWidth: 48
          }}>
          [ ]
        </button>
      </div>
    </>
  );
}
'@

Write-Host "BarcodeInput component created!" -ForegroundColor Green

# 2. Update InventoryPage - Add camera to barcode fields
$inv = Get-Content "src\pages\InventoryPage.jsx" -Raw

# Add import
if ($inv -notmatch "BarcodeInput") {
  $inv = "import BarcodeInput from `"../components/common/BarcodeInput`";`n" + $inv
}

# Replace barcode input in Add Product modal
$inv = $inv -replace '<input className="input" value=\{newProduct\.barcode\} onChange=\{e => setNewProduct\(p => \(\{ \.\.\.p, barcode: e\.target\.value \}\)\)\} placeholder="Scan or type barcode" />',
'<BarcodeInput lang={lang} value={newProduct.barcode} onChange={v => setNewProduct(p => ({ ...p, barcode: v }))} placeholder={lang === "en" ? "Scan or type barcode" : "Scanner ou saisir code-barres"} />'

# Replace barcode input in Receive Goods modal
$inv = $inv -replace '<input className="input" value=\{item\.barcode\} onChange=\{e => setItem\(idx, "barcode", e\.target\.value\)\} placeholder="Scan barcode" />',
'<BarcodeInput lang={lang} value={item.barcode} onChange={v => setItem(idx, "barcode", v)} placeholder={lang === "en" ? "Scan barcode" : "Scanner code-barres"} />'

Set-Content "src\pages\InventoryPage.jsx" -Value $inv -Encoding UTF8
Write-Host "Inventory updated with camera!" -ForegroundColor Green

# 3. Update TransfersPage - Add camera to scan step
$trans = Get-Content "src\pages\TransfersPage.jsx" -Raw

if ($trans -notmatch "BarcodeInput") {
  $trans = "import BarcodeInput from `"../components/common/BarcodeInput`";`n" + $trans
}

# Replace scan input in transfers
$trans = $trans -replace '<input ref=\{scanRef\} className="input" value=\{scanInput\}[\s\S]*?placeholder=\{lang === "en" \? "Type or scan barcode.*?autoFocus />',
'<BarcodeInput lang={lang} value={scanInput} onChange={v => setScanInput(v)} placeholder={lang === "en" ? "Type or scan barcode" : "Saisir ou scanner"} />'

Set-Content "src\pages\TransfersPage.jsx" -Value $trans -Encoding UTF8
Write-Host "Transfers updated with camera!" -ForegroundColor Green

Write-Host ""
Write-Host "All pages updated! Now push to GitHub." -ForegroundColor Cyan
