# Smart scan detection - auto detects desktop vs mobile
# Run from frontend folder

# Update BarcodeInput to auto-detect mobile vs desktop
Set-Content -Path "src\components\common\BarcodeInput.jsx" -Encoding UTF8 -Value @'
import { useState } from "react";
import CameraScanner from "./CameraScanner";

// Detect if device is mobile/tablet
const isMobile = () => /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

export default function BarcodeInput({ value, onChange, placeholder, lang, style }) {
  const [showCamera, setShowCamera] = useState(false);
  const mobile = isMobile();

  return (
    <>
      {showCamera && (
        <CameraScanner
          lang={lang}
          onScan={(code) => { setShowCamera(false); onChange(code); }}
          onClose={() => setShowCamera(false)}
        />
      )}
      <div style={{ display: "flex", gap: 8, ...(style || {}) }}>
        <input
          className="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || (mobile
            ? (lang === "en" ? "Tap camera button to scan..." : "Appuyez sur camera pour scanner...")
            : (lang === "en" ? "Scan barcode or type..." : "Scanner ou saisir..."))}
          style={{ flex: 1 }}
        />
        {/* Only show camera button on mobile */}
        {mobile && (
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            title={lang === "en" ? "Scan with camera" : "Scanner avec camera"}
            style={{
              background: "rgba(79,70,229,0.2)",
              border: "1.5px solid var(--brand)",
              borderRadius: "var(--radius-md)",
              padding: "0 16px",
              color: "var(--brand-light)",
              cursor: "pointer",
              fontSize: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              minWidth: 52,
              fontWeight: 700
            }}>
            []
          </button>
        )}
      </div>
      {/* Desktop hint */}
      {!mobile && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {lang === "en" ? "USB barcode scanner: just scan directly" : "Lecteur USB: scannez directement"}
        </div>
      )}
    </>
  );
}
'@

# Also update POSPage camera button to only show on mobile
$pos = Get-Content "src\pages\POSPage.jsx" -Raw

# Replace the camera button with mobile-only version
$pos = $pos -replace '          \{/\* Camera scan button \*/\}
        <button onClick=\{\(\) => setShowCamera\(true\)\}.*?\{lang === "en" \? "Scan Barcode with Camera" : "Scanner avec la camera"\}
        </button>', '          {/* Camera scan button - mobile only */}
        {/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && (
          <button onClick={() => setShowCamera(true)} style={{ width: "100%", padding: 14, marginBottom: 10, background: "rgba(79,70,229,0.15)", border: "2px solid var(--brand)", borderRadius: 12, color: "var(--brand-light)", cursor: "pointer", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>[ ]</span>
            {lang === "en" ? "Scan Barcode with Camera" : "Scanner avec la camera"}
          </button>
        )}'

Set-Content "src\pages\POSPage.jsx" -Value $pos -Encoding UTF8

Write-Host "Smart detection done!" -ForegroundColor Green
Write-Host "Desktop: USB scanner only" -ForegroundColor Cyan
Write-Host "Mobile: Camera button shows" -ForegroundColor Cyan
