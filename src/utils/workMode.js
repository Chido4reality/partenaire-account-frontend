// WAREHOUSE MODE (Peter, 2026-10-28) — one place for "which mode is this person in" and
// "which screens does Warehouse Mode hide".
//
// The mode is per USER (pa_users.work_mode), but the server decides whether it counts: login and
// /auth/me send `work_mode` (the EFFECTIVE mode — 'pos' unless the org is on Pro Plus, Warehouse
// Mode is switched on for it, and the role is owner / manager / warehouse / accountant) and
// `warehouse_mode_available` (may this person see the button). Anything missing — an old
// backend, a cached session from before the feature — reads as POS, exactly today's app.
//
// Warehouse Mode only HIDES. It builds no screen of its own and the server never refuses a sale
// because of it (a sale queued offline in POS Mode must still land after a switch).

import { useAuthStore } from "../store";

// Menu entries and routes hidden in Warehouse Mode (the POS screens). Everything else stays.
export const WAREHOUSE_HIDDEN_ROUTES = new Set([
  "/pos", "/online-cart", "/shifts", "/refunds",
  "/dozie-listings", "/dozie-orders", "/dozie-messages", "/dozie-disputes",   // Stenamo Market
  "/customers", "/credits", "/cashier", "/pickup", "/my-activity",
  "/expenditures", "/reports", "/compare", "/operations",
]);

export function isHiddenInWarehouse(pathname) {
  const p = String(pathname || "").split("?")[0].replace(/\/+$/, "") || "/";
  for (const r of WAREHOUSE_HIDDEN_ROUTES) if (p === r || p.startsWith(`${r}/`)) return true;
  return false;
}

export const workModeAvailable = (user) => !!user && user.warehouse_mode_available === true;
export const effectiveWorkMode = (user) =>
  workModeAvailable(user) && user.work_mode === "warehouse" ? "warehouse" : "pos";

// Outside React (the API client): the mode right now.
export const currentWorkMode = () => effectiveWorkMode(useAuthStore.getState().user);

export function useWorkMode() {
  return useAuthStore((s) => effectiveWorkMode(s.user));
}
export function useIsWarehouseMode() {
  return useWorkMode() === "warehouse";
}
export function useWorkModeAvailable() {
  return useAuthStore((s) => workModeAvailable(s.user));
}

// GET endpoints the server filters by ?view=warehouse (real shops left out). The API client adds
// the parameter only to these, only in Warehouse Mode; every other request is untouched.
// stock-checks/summary + expiry/badge = the Stock Check and Check Expiry/Low menu badges;
// notifications = the bell (POS-only alert types left out there).
const VIEW_PATHS = /^\/(locations|stock|stock-checks(\/(stale|damaged|watches|summary))?|expiry\/(check|badge)|restock\/to-buy(-count)?|transfers(\/incoming|\/allowed-sources)?|notifications)\/?$/;
export const takesWarehouseView = (path) => VIEW_PATHS.test(String(path || ""));

// The colour switch: index.css swaps the --brand tokens under :root[data-work-mode="warehouse"].
export function applyWorkModeAttribute(mode) {
  if (typeof document === "undefined") return;
  if (mode === "warehouse") document.documentElement.setAttribute("data-work-mode", "warehouse");
  else document.documentElement.removeAttribute("data-work-mode");
}

