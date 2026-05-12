import { useState } from "react";
import CameraScanner from "./CameraScanner";

// Detect if device is mobile/tablet
const isMobile = () => /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

export default function BarcodeInput({ value, onChange, onScan, placeholder, lang, style, inputRef, ...inputProps }) {
  const [showCamera, setShowCamera] = useState(false);
  const mobile = isMobile();

  const handleScan = (code) => {
    setShowCamera(false);
    onChange(code);
    if (onScan) onScan(code);
  };

  return (
    <>
      {showCamera && (
        <CameraScanner
          lang={lang}
          onScan={handleScan}
          onClose={() => setShowCamera(false)}
        />
      )}
      <div style={{ display: "flex", gap: 8, ...(style || {}) }}>
        <input
          ref={inputRef}
          className="input"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || (mobile
            ? (lang === "en" ? "Tap camera button to scan..." : "Appuyez sur camera pour scanner...")
            : (lang === "en" ? "Scan barcode or type..." : "Scanner ou saisir..."))}
          style={{ flex: 1 }}
          {...inputProps}
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
