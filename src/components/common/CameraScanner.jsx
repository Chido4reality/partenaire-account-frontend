import { useEffect, useRef, useState } from "react";

// MP-REFUND-SEARCH-ENHANCED: optional title / placeholder /
// inputMode props let consumers reuse the scanner for non-product
// codes (e.g. alphanumeric sale numbers VNT-…, DOZ-…). Defaults
// preserve the product-barcode behaviour of all existing callers.
export default function CameraScanner({
  onScan, onClose, lang,
  title, placeholder, inputMode = "numeric"
}) {
  const videoRef    = useRef(null);
  const streamRef   = useRef(null);
  const readerRef   = useRef(null);
  const [status, setStatus]     = useState("requesting"); // requesting | scanning | error | manual
  const [manualCode, setManualCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    requestCamera();
    return () => cleanup();
  }, []);

  const cleanup = () => {
    if (readerRef.current) { try { readerRef.current.reset(); } catch {} }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
  };

  const requestCamera = async () => {
    setStatus("requesting");
    try {
      // Request camera with explicit constraints for iPhone
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("scanning");
        startZXing();
      }
    } catch (err) {
      console.error("Camera error:", err);
      if (err.name === "NotAllowedError") {
        setErrorMsg(lang === "en"
          ? "Camera permission denied. Go to Settings > Safari > Camera and allow access, then try again."
          : "Permission camera refusee. Allez dans Reglages > Safari > Camera et autorisez l acces.");
      } else {
        setErrorMsg(lang === "en"
          ? "Camera not available on this device. Use manual entry below."
          : "Camera non disponible. Utilisez la saisie manuelle ci-dessous.");
      }
      setStatus("error");
    }
  };

  const startZXing = async () => {
    try {
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8, BarcodeFormat.QR_CODE, BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      reader.decodeFromStream(streamRef.current, videoRef.current, (result, err) => {
        if (result) {
          const code = result.getText();
          cleanup();
          onScan(code);
        }
      });
    } catch (err) {
      console.error("ZXing error:", err);
      // Still show camera, just no auto-detect
    }
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) { cleanup(); onScan(manualCode.trim()); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 200, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.8)", flexShrink: 0, paddingTop: "max(14px, env(safe-area-inset-top))" }}>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 16 }}>
          {title || (lang === "en" ? "Scan Barcode" : "Scanner le code-barres")}
        </span>
        <button onClick={() => { cleanup(); onClose(); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
          {lang === "en" ? "Cancel" : "Annuler"}
        </button>
      </div>

      {status === "requesting" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>[]</div>
          <div style={{ fontSize: 15 }}>{lang === "en" ? "Requesting camera access..." : "Demande acces camera..."}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 8 }}>{lang === "en" ? "Please allow camera when prompted" : "Veuillez autoriser la camera"}</div>
        </div>
      )}

      {status === "error" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>[]</div>
          <div style={{ color: "#fbbf24", marginBottom: 20, textAlign: "center", fontSize: 14, lineHeight: 1.7, maxWidth: 300 }}>{errorMsg}</div>
          <button onClick={requestCamera} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 10, padding: "10px 24px", cursor: "pointer", fontSize: 13, marginBottom: 24 }}>
            {lang === "en" ? "Try again" : "Reessayer"}
          </button>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 10 }}>{lang === "en" ? "Or enter barcode manually:" : "Ou saisir manuellement:"}</div>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
            style={{ background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12, padding: "14px", color: "#fff", fontSize: 18, width: "100%", maxWidth: 300, textAlign: "center", letterSpacing: 3, marginBottom: 12 }}
            placeholder={placeholder || "0000000000"} autoFocus inputMode={inputMode} />
          <button onClick={handleManualSubmit} disabled={!manualCode.trim()}
            style={{ background: "#4f46e5", border: "none", borderRadius: 12, padding: "14px 40px", color: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 600, opacity: manualCode.trim() ? 1 : 0.4 }}>
            {lang === "en" ? "Search Product" : "Rechercher"}
          </button>
        </div>
      )}

      {status === "scanning" && (
        <>
          <div style={{ flex: 1, position: "relative" }}>
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} playsInline muted autoPlay />
            {/* Overlay frame */}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ width: 260, height: 160, position: "relative" }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 36, height: 36, borderTop: "3px solid #fff", borderLeft: "3px solid #fff" }} />
                <div style={{ position: "absolute", top: 0, right: 0, width: 36, height: 36, borderTop: "3px solid #fff", borderRight: "3px solid #fff" }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, width: 36, height: 36, borderBottom: "3px solid #fff", borderLeft: "3px solid #fff" }} />
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 36, height: 36, borderBottom: "3px solid #fff", borderRight: "3px solid #fff" }} />
                <div style={{ position: "absolute", top: "50%", left: 8, right: 8, height: 2, background: "#4f46e5", boxShadow: "0 0 8px #4f46e5" }} />
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center" }}>
              <div style={{ color: "#fff", fontSize: 13, background: "rgba(0,0,0,0.6)", padding: "8px 20px", borderRadius: 20, display: "inline-block" }}>
                {lang === "en" ? "Point at barcode and hold steady" : "Pointez sur le code-barres"}
              </div>
            </div>
          </div>
          {/* Manual fallback */}
          <div style={{ padding: "12px 16px", background: "rgba(0,0,0,0.8)", flexShrink: 0, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={manualCode} onChange={e => setManualCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
                style={{ flex: 1, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14 }}
                placeholder={placeholder || (lang === "en" ? "Type barcode..." : "Saisir code-barres...")}
                inputMode={inputMode} />
              <button onClick={handleManualSubmit} style={{ background: "#4f46e5", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                {lang === "en" ? "Go" : "OK"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Video element always in DOM for scanning state */}
      {status !== "scanning" && <video ref={videoRef} style={{ display: "none" }} playsInline muted />}
    </div>
  );
}
