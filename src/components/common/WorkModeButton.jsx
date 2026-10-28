// WAREHOUSE MODE (Peter, 2026-10-28): the big two-way switch at the top-left of the menu
// (desktop sidebar + phone drawer). "Warehouse Mode" in POS Mode, "POS Mode" in Warehouse Mode.
//
// Shown only when the server says this person may use it (warehouse_mode_available: Pro Plus +
// the org switched on + not a cashier). Saved on the server (PATCH /auth/work-mode) so it follows
// the person to every device. After a switch every cached query is reset — the location and
// stock lists differ between the two modes — and the person lands on the dashboard, because the
// page they were on may be one Warehouse Mode hides.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../../store";
import { useWorkMode, useWorkModeAvailable, applyWorkModeAttribute } from "../../utils/workMode";

const GREEN = "#7BE0A5";
// The shop selected in POS Mode, kept while in Warehouse Mode (where shops are hidden and the
// selection is cleared) and put back on the way out. Per device, best-effort.
const POS_LOC_KEY = "mp-pos-location-before-warehouse";
function rememberPosLocation() {
  try {
    const loc = useSettingsStore.getState().selectedLocation;
    if (loc) localStorage.setItem(POS_LOC_KEY, JSON.stringify(loc)); else localStorage.removeItem(POS_LOC_KEY);
  } catch { /* storage blocked — the shop is simply re-picked */ }
  useSettingsStore.getState().setLocation(null);
}
function restorePosLocation() {
  let loc = null;
  try { loc = JSON.parse(localStorage.getItem(POS_LOC_KEY) || "null"); localStorage.removeItem(POS_LOC_KEY); } catch { loc = null; }
  // Layout re-checks it against the POS location list (and refreshes or clears it).
  useSettingsStore.getState().setLocation(loc);
}
const GOLD = "#FBC503";

// `wrapStyle`: the spacing around the button. The wrapper is part of the button so that when the
// button is not available NOTHING renders — no empty padded box in POS Mode.
export default function WorkModeButton({ compact = false, onSwitched, wrapStyle }) {
  const { lang } = useLangStore();
  const en = lang === "en";
  const role = useAuthStore((s) => s.user?.role);
  const patchUser = useAuthStore((s) => s.patchUser);
  const mode = useWorkMode();
  const available = useWorkModeAvailable();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!available || role === "cashier") return null;

  const toWarehouse = mode !== "warehouse";
  const next = toWarehouse ? "warehouse" : "pos";
  const accent = toWarehouse ? GREEN : GOLD;
  const label = toWarehouse ? (en ? "Warehouse Mode" : "Mode Entrepôt") : (en ? "POS Mode" : "Mode Caisse");
  const sub = toWarehouse
    ? (en ? "Hide the selling screens" : "Masquer les écrans de vente")
    : (en ? "Back to selling" : "Revenir à la vente");

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch("/auth/work-mode", { work_mode: next });
      patchUser({ work_mode: next });
      if (next === "warehouse") rememberPosLocation(); else restorePosLocation();
      applyWorkModeAttribute(next);
      navigate("/");
      await qc.resetQueries();
      if (onSwitched) onSwitched();
      toast.success(next === "warehouse"
        ? (en ? "Warehouse Mode on" : "Mode Entrepôt activé")
        : (en ? "POS Mode on" : "Mode Caisse activé"));
    } catch (e) {
      const d = e?.response?.data || {};
      toast.error((en ? d.message_en : d.message_fr) || d.message
        || (en ? "Could not switch mode. Check your connection." : "Impossible de changer de mode. Vérifiez votre connexion."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={wrapStyle}>
    <button type="button" onClick={onClick} disabled={busy}
      title={label}
      aria-label={label}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: compact ? "10px 0" : "11px 14px", justifyContent: compact ? "center" : "flex-start",
        borderRadius: 12, cursor: busy ? "wait" : "pointer",
        border: `1.5px solid ${accent}`, background: `${accent}1F`, color: accent,
        fontWeight: 800, fontSize: 14, textAlign: "left", opacity: busy ? 0.6 : 1,
      }}>
      <span style={{ fontSize: 18 }}>{toWarehouse ? "🏭" : "🛒"}</span>
      {!compact && (
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span>{busy ? (en ? "Switching…" : "Changement…") : label}</span>
          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{sub}</span>
        </span>
      )}
    </button>
    </div>
  );
}
