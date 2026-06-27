// MP-BT-THERMAL — JS service for direct Bluetooth (Classic SPP) ESC/POS printing.
//
// Wraps the in-repo native plugin (BluetoothPrinterPlugin). Remembers the chosen
// printer (localStorage), requests Android 12+ runtime permission via the native
// layer, encodes the sale to ESC/POS bytes (escpos.js) and sends them. Every
// failure throws an Error carrying a stable .code so the UI can message it and
// fall back to the system print dialog.
import { registerPlugin, Capacitor } from "@capacitor/core";
import { buildSaleEscposBase64 } from "./escpos";

const BT = registerPlugin("BluetoothPrinter");
const SAVED_KEY = "mp_bt_printer";

export function isBtPrintSupported() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function getSavedPrinter() {
  try { const v = localStorage.getItem(SAVED_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function saveSavedPrinter(dev) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify({ id: dev.id, name: dev.name || "" })); } catch { /* ignore */ }
}
export function clearSavedPrinter() { try { localStorage.removeItem(SAVED_KEY); } catch { /* ignore */ } }

function notNative() { const e = new Error("Bluetooth printing is only available in the Android app"); e.code = "NOT_NATIVE"; return e; }

// Paired/bonded printers (the user pairs in Android Bluetooth settings first).
// Triggers the runtime BT permission prompt via the native layer.
export async function listPairedPrinters() {
  if (!isBtPrintSupported()) throw notNative();
  try { await BT.requestPermissions(); } catch { /* native re-checks on the call */ }
  const r = await BT.listPaired(); // rejects with .code on NO_BT / BT_OFF / PERM_DENIED
  return (r && r.devices) || [];
}

// Print a sale. deviceId optional (defaults to the saved printer).
// Returns { ok:true } or throws { code, message }.
export async function printSaleViaBluetooth(saleOpts, deviceId) {
  if (!isBtPrintSupported()) throw notNative();
  const dev = deviceId ? { id: deviceId } : getSavedPrinter();
  if (!dev || !dev.id) { const e = new Error("No Bluetooth printer selected"); e.code = "NO_DEVICE"; throw e; }
  try { await BT.requestPermissions(); } catch { /* native re-checks */ }
  const data = buildSaleEscposBase64(saleOpts);
  await BT.print({ address: dev.id, data }); // rejects with .code on CONNECT_FAILED / BT_OFF / PERM_DENIED
  return { ok: true };
}
