// FLW-PAY-FIX (2026-10-17): a Flutterwave checkout the owner left for, remembered on THIS device.
// The Android app opens checkout in the system browser and nothing brings the payer back into the
// app, so the app re-checks the pending reference itself when it comes back to the foreground (and
// at start-up). The confirm endpoint is public and idempotent: it only asks Flutterwave about our
// own reference and activates the plan if Flutterwave says it was paid.
import api from "./api";

const KEY = "mp-flw-pending";
const MAX_AGE_MS = 24 * 3600e3;

export function rememberPendingPayment(txRef) {
  try { if (txRef) localStorage.setItem(KEY, JSON.stringify({ tx_ref: txRef, at: Date.now() })); } catch { /* storage off */ }
}
export function pendingPayment() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && p.tx_ref && Date.now() - p.at < MAX_AGE_MS) return p;
    localStorage.removeItem(KEY);
  } catch { /* storage off */ }
  return null;
}
export function forgetPendingPayment() { try { localStorage.removeItem(KEY); } catch { /* storage off */ } }

// → "approved" | "not_paid_yet" | "pending" | "unknown" | "error"
export async function confirmPayment(txRef, transactionId = null) {
  try {
    const r = await api.post("/subscriptions/flw/confirm-return", { tx_ref: txRef, transaction_id: transactionId },
      { timeout: 30000 });          // a cold Render start + Flutterwave's verify can exceed the 6 s default
    const status = r.data?.status || "error";
    if (status === "approved") forgetPendingPayment();
    return status;
  } catch (e) {
    const s = e?.response?.data?.status;
    if (s === "unknown_reference" || s === "bad_reference") { forgetPendingPayment(); return "unknown"; }
    return "error";
  }
}
