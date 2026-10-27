import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { availabilityText, pendingNumbers } from "../../utils/transferAvailability";

// TRANSFER RESERVATION (2026-10-27): what the PENDING transfers out of one location hold, per
// product. { <product_id>: { assigned, pending: [{ transfer_id, transfer_number, quantity }] } }.
// An older server (no route) or no connection → {} — the screens then show plain stock, and the
// server still refuses an over-assigned transfer.
export function useReservedAt(locationId) {
  const q = useQuery({
    queryKey: ["transfers-reserved", locationId],
    queryFn: () => api.get(`/transfers/reserved?location_id=${locationId}`).then((r) => r.data?.data?.products || {}),
    enabled: !!locationId,
    refetchInterval: 30000,
    retry: false,
  });
  return q.data || {};
}

// "In stock X · assigned Y · available Z" — assigned in amber with the TRF numbers when > 0.
export function AvailabilityLine({ a, en, style }) {
  if (!a) return null;
  const held = a.assigned > 0;
  return (
    <div data-availability={`${a.inStock}/${a.assigned}/${a.available}`}
      style={{ fontSize: 11.5, color: held ? "#f59e0b" : "var(--text-muted)", lineHeight: 1.4, ...style }}>
      {availabilityText(a, en)}
      {held && <span data-assigned-to> — {en ? "pending" : "en attente"}: {pendingNumbers(a)}</span>}
    </div>
  );
}
