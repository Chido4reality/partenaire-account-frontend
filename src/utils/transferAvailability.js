// TRANSFER RESERVATION (2026-10-27) — a PENDING transfer reserves its units at the source.
// available to transfer = in stock − Σ the source's PENDING transfers (GET /transfers/reserved).
// Pure (no imports): scripts/transfer-availability-check.mjs tests it. The server is the rule —
// this only shows the numbers and sets the limits on the quantity fields.

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round = (v) => Math.round(v * 1e6) / 1e6;

// reserved = the `products` map of GET /transfers/reserved ({ <product_id>: { assigned, pending } }).
// excludeTransferId = the transfer being edited: its own lines are not "assigned" to anything else.
export function availabilityOf(inStock, reserved, productId, excludeTransferId = null) {
  const r = (reserved && productId && reserved[productId]) || null;
  const pending = ((r && r.pending) || []).filter((p) => !excludeTransferId || p.transfer_id !== excludeTransferId);
  const assigned = round(pending.reduce((s, p) => s + n(p.quantity), 0));
  const stock = n(inStock);
  return { inStock: stock, assigned, available: Math.max(0, round(stock - assigned)), pending };
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

// "In stock 50 · assigned 30 · available 20" / « En stock 50 · attribué 30 · disponible 20 »
export function availabilityText(a, en) {
  if (!a) return "";
  return en
    ? `In stock ${fmt(a.inStock)} · assigned ${fmt(a.assigned)} · available ${fmt(a.available)}`
    : `En stock ${fmt(a.inStock)} · attribué ${fmt(a.assigned)} · disponible ${fmt(a.available)}`;
}

// The TRF numbers holding the units: "TRF-…0005, TRF-…0007".
export const pendingNumbers = (a) => ((a && a.pending) || []).map((p) => p.transfer_number).filter(Boolean).join(", ");

// A server refusal in the reader's language (message_en / message_fr, else message, else fallback).
export function serverMessage(data, en, fallback = "Error") {
  const d = data || {};
  return (en ? (d.message_en || d.message) : (d.message_fr || d.message)) || fallback;
}
