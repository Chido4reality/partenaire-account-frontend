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
