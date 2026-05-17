// ADMIN-CONTACT-UPDATE: open the WhatsApp APP, not the in-webview wa.me
// page. Tries the whatsapp:// scheme first; if the app takes over the
// page goes hidden/blurred and we stop. Otherwise fall back to wa.me in
// a new window (the Electron wrapper hands window.open to the OS).
// `rawText` is plain text — encoded here.
export function openWhatsApp(e, phone, rawText) {
  if (e && e.preventDefault) e.preventDefault();
  const text = rawText ? encodeURIComponent(rawText) : "";
  const app = `whatsapp://send?phone=${phone}` + (text ? `&text=${text}` : "");
  const web = `https://wa.me/${phone}` + (text ? `?text=${text}` : "");
  let took = false;
  const mark = () => { took = true; };
  document.addEventListener("visibilitychange", mark, { once: true });
  window.addEventListener("blur", mark, { once: true });
  try { window.location.href = app; } catch (_) { /* scheme not handled */ }
  setTimeout(() => {
    document.removeEventListener("visibilitychange", mark);
    window.removeEventListener("blur", mark);
    if (!took) {
      try { window.open(web, "_blank", "noopener"); }
      catch (_) { window.location.href = web; }
    }
  }, 1500);
  return false;
}
