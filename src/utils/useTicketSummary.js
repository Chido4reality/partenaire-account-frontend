// MP-CASHIER-PHASE-1b — ONE definition of the cashier-queue summary query.
//
// WHY THIS FILE EXISTS. react-query dedupes by queryKey: two components sharing a
// key but declaring different queryFn shapes do NOT both run — whichever mounts
// first populates the cache and the other silently receives its shape. That has
// shipped twice already (["locations"], ["my-permissions"]), so this key gets a
// shared hook before its second consumer rather than after. Same reasoning as
// utils/useStockCheckSummary.js.
//
// WHY THIS AND NOT selectedLocation.sales_mode. GET /locations does select("*"),
// so sales_mode does reach the client on the location row — but that row arrives
// through the ["locations"] cache, the key with ~16 consumers that has drifted
// twice. This endpoint is server-authoritative, is the badge source anyway, and
// degrades safe: no location_id, or a location that isn't in cashier mode, comes
// back as mode:'direct' with both counts zero. A stale or failed read therefore
// HIDES the cashier surfaces rather than showing them to the wrong person.
//
// Response envelope from the server:
//   { success: true, data: { awaiting_payment, awaiting_pickup, mode } }
// This hook returns the INNER object (or null while loading/disabled) — the same
// convention as useMyPermissions. One canonical unwrap, so consumers cannot
// disagree about it.
//
// Consumers as of Phase 1b: Layout.jsx (nav gate + both badges), POSPage.jsx
// (cashier-mode switch), TicketListPage.jsx (header + empty state).
import { useQuery } from "@tanstack/react-query";
import api from "./api";

export const ticketSummaryKey = (locationId) => ["ticket-summary", locationId || null];

export function useTicketSummary(locationId, opts = {}) {
  const q = useQuery({
    queryKey: ticketSummaryKey(locationId),
    queryFn: () =>
      api
        .get("/sales/tickets/summary?location_id=" + encodeURIComponent(locationId || ""))
        .then((r) => r.data?.data || null),
    enabled: !!locationId,
    // 60s, matching the stock-check badge after MP-PEAK-MTN-RESILIENCE. The badge
    // is a "there is work waiting" hint, not a live counter; polling it harder on
    // a shop's mobile connection buys nothing and costs Paul data.
    refetchInterval: 60000,
    staleTime: 30000,
    retry: 1,
    ...opts,
  });
  return { summary: q.data || null, ...q };
}

// The ONE carry-forward-4 gate. Mirrors the backend's hasTicketCapability.
//
// ⚠️ THE EARLY RETURN IS THE GUARANTEE, NOT A STYLE CHOICE. Three of fourteen
// active staff have no pa_staff_permissions row at all. `perms` is null for them
// — and null while any user is still loading. Reading a flag before confirming
// cashier mode is what would take payment away from those three at every DIRECT
// location in the system on deploy day. Do NOT "tidy" this into a single boolean
// expression: `mode === "cashier" && (isPrivileged || perms?.[flag])` happens to
// evaluate the same today, but it invites the next edit that reorders the terms,
// and the failure is silent and system-wide. Keep the guard on its own line.
export function ticketNavVisible({ mode, role, perms, flag }) {
  if (mode !== "cashier") return false;
  if (role === "owner" || role === "manager") return true;
  return perms?.[flag] === true;
}

export default useTicketSummary;
