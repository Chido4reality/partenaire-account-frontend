// MP-INVENTORY-DOZIE-CONTROLS — reusable two-button photo picker.
//
//   📷 Snap    → camera (input accept="image/*" capture="environment")
//   🖼️ Gallery → file picker (input accept="image/*", NO capture)
//
// Both inputs hand the raw File to onPicked(file); the caller owns
// readPhotoToDataUrl + upload. i18n follows InventoryPage's prevailing
// inline `lang` ternary pattern (the page does not use the translations
// module), so labels are passed via the `lang` prop.
import { useRef } from "react";

export default function PhotoUploadButtons({ onPicked, lang = "en", disabled = false }) {
  const snapRef = useRef(null);
  const galleryRef = useRef(null);

  const handle = (e) => {
    const file = e.target.files && e.target.files[0];
    // Reset so picking the same file twice still fires onChange.
    e.target.value = "";
    if (file) onPicked(file);
  };

  const btnStyle = {
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "10px 14px", borderRadius: 10,
    border: "1px dashed var(--border)", background: "var(--bg-card)",
    cursor: disabled ? "not-allowed" : "pointer", fontSize: 13,
    opacity: disabled ? 0.6 : 1
  };

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <label style={btnStyle}>
        📷 {lang === "en" ? "Snap" : "Photographier"}
        <input ref={snapRef} type="file" accept="image/*" capture="environment"
          disabled={disabled} style={{ display: "none" }} onChange={handle} />
      </label>
      <label style={btnStyle}>
        🖼️ {lang === "en" ? "Gallery" : "Galerie"}
        <input ref={galleryRef} type="file" accept="image/*"
          disabled={disabled} style={{ display: "none" }} onChange={handle} />
      </label>
    </div>
  );
}
