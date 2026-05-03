# Camera barcode scanner component
# Run from frontend folder

Set-Content -Path "src\components\common\CameraScanner.jsx" -Encoding UTF8 -Value @'
import { useEffect, useRef, useState } from "react";

export default function CameraScanner({ onScan, onClose, lang }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef  = useRef(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setScanning(true);
        scanLoop();
      }
    } catch (err) {
      setError(lang === "en" ? "Camera access denied. Please allow camera in browser settings." : "Acces camera refuse. Veuillez autoriser la camera dans les parametres.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  const scanLoop = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== 4) {
      animRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    const ctx = canvas.getContext("2d");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Use BarcodeDetector API if available (Chrome on Android)
    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: ["code_128","code_39","ean_13","ean_8","qr_code","upc_a","upc_e","itf","data_matrix"] });
      detector.detect(canvas).then(barcodes => {
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue;
          stopCamera();
          onScan(code);
          return;
        }
        animRef.current = requestAnimationFrame(scanLoop);
      }).catch(() => {
        animRef.current = requestAnimationFrame(scanLoop);
      });
    } else {
      // Fallback - just show camera, user manually enters
      animRef.current = requestAnimationFrame(scanLoop);
    }
  };

  const [manualCode, setManualCode] = useState("");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 200, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.5)" }}>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: 16 }}>
          {lang === "en" ? "Scan Barcode" : "Scanner le code-barres"}
        </div>
        <button onClick={() => { stopCamera(); onClose(); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14 }}>
          {lang === "en" ? "Cancel" : "Annuler"}
        </button>
      </div>

      {error ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ color: "#f87171", marginBottom: 20, textAlign: "center", fontSize: 14 }}>{error}</div>
          <div style={{ color: "#fff", marginBottom: 12, fontSize: 13 }}>
            {lang === "en" ? "Enter barcode manually:" : "Saisir le code-barres manuellement:"}
          </div>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, padding: "12px 16px", color: "#fff", fontSize: 16, width: "100%", maxWidth: 300, textAlign: "center", letterSpacing: 2 }}
            placeholder="Type barcode..." autoFocus
            onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) { stopCamera(); onScan(manualCode.trim()); } }}
          />
          <button onClick={() => { if (manualCode.trim()) { stopCamera(); onScan(manualCode.trim()); } }}
            style={{ marginTop: 12, background: "var(--brand)", border: "none", borderRadius: 10, padding: "12px 32px", color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600 }}>
            {lang === "en" ? "Search" : "Rechercher"}
          </button>
        </div>
      ) : (
        <>
          {/* Camera view */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} playsInline muted />
            <canvas ref={canvasRef} style={{ display: "none" }} />

            {/* Scan frame overlay */}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "relative", width: 260, height: 160 }}>
                {/* Corner brackets */}
                {[["0,0","topleft"],["auto,0","topright"],["0,auto","bottomleft"],["auto,auto","bottomright"]].map(([pos, name]) => {
                  const [t, r, b, l] = name === "topleft" ? ["0","auto","auto","0"] : name === "topright" ? ["0","0","auto","auto"] : name === "bottomleft" ? ["auto","auto","0","0"] : ["auto","0","0","auto"];
                  return (
                    <div key={name} style={{ position: "absolute", top: t, right: r, bottom: b, left: l, width: 30, height: 30, borderTop: name.includes("top") ? "3px solid #fff" : "none", borderBottom: name.includes("bottom") ? "3px solid #fff" : "none", borderLeft: name.includes("left") ? "3px solid #fff" : "none", borderRight: name.includes("right") ? "3px solid #fff" : "none" }} />
                  );
                })}
                {/* Scanning line */}
                <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "rgba(79,70,229,0.8)", boxShadow: "0 0 8px var(--brand)" }} />
              </div>
            </div>

            {/* Instruction */}
            <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center" }}>
              <div style={{ color: "#fff", fontSize: 13, background: "rgba(0,0,0,0.5)", padding: "8px 20px", borderRadius: 20, display: "inline-block" }}>
                {lang === "en" ? "Point camera at barcode" : "Pointez la camera sur le code-barres"}
              </div>
            </div>
          </div>

          {/* Manual entry fallback */}
          <div style={{ padding: "16px 20px", background: "rgba(0,0,0,0.5)" }}>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 8, textAlign: "center" }}>
              {lang === "en" ? "Or type barcode manually:" : "Ou tapez le code-barres:"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={manualCode} onChange={e => setManualCode(e.target.value)}
                style={{ flex: 1, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14 }}
                placeholder="Barcode..." 
                onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) { stopCamera(); onScan(manualCode.trim()); } }}
              />
              <button onClick={() => { if (manualCode.trim()) { stopCamera(); onScan(manualCode.trim()); } }}
                style={{ background: "var(--brand)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Go" : "OK"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
'@

Write-Host "Camera scanner component created!" -ForegroundColor Green
