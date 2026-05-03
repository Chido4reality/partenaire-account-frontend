# Run from frontend folder
# Replaces CameraScanner with ZXing-based scanner that works on all phones

Set-Content -Path "src\components\common\CameraScanner.jsx" -Encoding UTF8 -Value @'
import { useEffect, useRef, useState } from "react";

export default function CameraScanner({ onScan, onClose, lang }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const readerRef  = useRef(null);
  const [error, setError]       = useState(null);
  const [manualCode, setManualCode] = useState("");
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    startScanner();
    return () => stopScanner();
  }, []);

  const stopScanner = () => {
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
  };

  const startScanner = async () => {
    try {
      // Dynamically import ZXing
      const { BrowserMultiFormatReader } = await import("@zxing/library");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (!devices || devices.length === 0) throw new Error("No camera found");

      // Prefer back camera
      const backCamera = devices.find(d => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear") || d.label.toLowerCase().includes("environment")) || devices[devices.length - 1];

      setLoading(false);

      reader.decodeFromVideoDevice(backCamera.deviceId, videoRef.current, (result, err) => {
        if (result) {
          const code = result.getText();
          stopScanner();
          onScan(code);
        }
      });
    } catch (err) {
      setLoading(false);
      setError(lang === "en"
        ? "Camera not available. Please type the barcode manually."
        : "Camera non disponible. Veuillez saisir le code-barres manuellement.");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.97)", zIndex: 200, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.5)", flexShrink: 0 }}>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: 16 }}>
          {lang === "en" ? "Scan Barcode" : "Scanner le code-barres"}
        </div>
        <button onClick={() => { stopScanner(); onClose(); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
          {lang === "en" ? "Cancel" : "Annuler"}
        </button>
      </div>

      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14 }}>
          {lang === "en" ? "Starting camera..." : "Demarrage camera..."}
        </div>
      )}

      {error ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>[]</div>
          <div style={{ color: "#fbbf24", marginBottom: 24, textAlign: "center", fontSize: 14, lineHeight: 1.6 }}>{error}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", marginBottom: 10, fontSize: 13 }}>
            {lang === "en" ? "Enter barcode manually:" : "Saisir le code-barres:"}
          </div>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)}
            style={{ background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 18, width: "100%", maxWidth: 320, textAlign: "center", letterSpacing: 3, marginBottom: 12 }}
            placeholder="0000000000" autoFocus
            onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) { stopScanner(); onScan(manualCode.trim()); } }}
          />
          <button onClick={() => { if (manualCode.trim()) { stopScanner(); onScan(manualCode.trim()); } }}
            disabled={!manualCode.trim()}
            style={{ background: "var(--brand)", border: "none", borderRadius: 12, padding: "14px 40px", color: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 600, opacity: manualCode.trim() ? 1 : 0.5 }}>
            {lang === "en" ? "Search Product" : "Rechercher"}
          </button>
        </div>
      ) : (
        <>
          {/* Camera view */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} playsInline muted />

            {/* Scan frame */}
            {!loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <div style={{ width: 260, height: 160, position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, width: 36, height: 36, borderTop: "3px solid #fff", borderLeft: "3px solid #fff", borderRadius: "4px 0 0 0" }} />
                  <div style={{ position: "absolute", top: 0, right: 0, width: 36, height: 36, borderTop: "3px solid #fff", borderRight: "3px solid #fff", borderRadius: "0 4px 0 0" }} />
                  <div style={{ position: "absolute", bottom: 0, left: 0, width: 36, height: 36, borderBottom: "3px solid #fff", borderLeft: "3px solid #fff", borderRadius: "0 0 0 4px" }} />
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 36, height: 36, borderBottom: "3px solid #fff", borderRight: "3px solid #fff", borderRadius: "0 0 4px 0" }} />
                  <div style={{ position: "absolute", top: "50%", left: 8, right: 8, height: 2, background: "rgba(79,70,229,0.9)", boxShadow: "0 0 10px var(--brand)", animation: "scan 1.5s ease-in-out infinite alternate" }} />
                </div>
              </div>
            )}

            <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center" }}>
              <div style={{ color: "#fff", fontSize: 13, background: "rgba(0,0,0,0.6)", padding: "8px 20px", borderRadius: 20, display: "inline-block" }}>
                {lang === "en" ? "Point camera at barcode" : "Pointez sur le code-barres"}
              </div>
            </div>
          </div>

          {/* Manual fallback */}
          <div style={{ padding: "14px 20px", background: "rgba(0,0,0,0.6)", flexShrink: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 8, textAlign: "center" }}>
              {lang === "en" ? "Or type barcode:" : "Ou tapez le code-barres:"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={manualCode} onChange={e => setManualCode(e.target.value)}
                style={{ flex: 1, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14 }}
                placeholder="Type barcode..."
                onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) { stopScanner(); onScan(manualCode.trim()); } }}
              />
              <button onClick={() => { if (manualCode.trim()) { stopScanner(); onScan(manualCode.trim()); } }}
                style={{ background: "var(--brand)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                {lang === "en" ? "Go" : "OK"}
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes scan {
          from { transform: translateY(-30px); }
          to   { transform: translateY(30px); }
        }
      `}</style>
    </div>
  );
}
'@

Write-Host "Camera scanner fixed with ZXing!" -ForegroundColor Green
Write-Host "Now push to GitHub" -ForegroundColor Cyan
