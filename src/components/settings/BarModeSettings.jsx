// BAR MODE — build step 1 of 11 (backend docs/bar-mode-spec.md): the switches, ALL OFF.
//
// BarModeOrgSwitch — Settings → Mode, OWNER only, Pro Plus only (same as the Warehouse Mode
//   switch, Peter 2026-11-16). Turns Bar Mode on or off for the business (Stenamo admins have the
//   same switch in the admin portal). While ON, the card also lists the shops with a "This shop is
//   a bar" switch each (pa_locations.bar_enabled — separate from the direct/cashier mode).
//   Step 1 has no bar screens yet: these switches change nothing else anyone sees.
//
// It reads GET /auth/bar-mode on its own (not /auth/me), so /auth/me stays byte-identical for
// every business, and it fetches nothing at all for a non-owner or a plan below Pro Plus.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { isSellableLocation } from "../../utils/locations";

export const BAR_MODE_QUERY_KEY = ["bar-mode"];

// The card is offered only to an owner on Pro Plus. Anyone else: nothing rendered, nothing fetched.
export const barModeCardOffered = ({ isOwner, effectivePlan }) => isOwner === true && effectivePlan === "pro_plus";

// The shops that can be a bar (never a warehouse, the Goods Buffer or a virtual store).
export const barCandidateShops = (locations) =>
  (Array.isArray(locations) ? locations : []).filter((l) => isSellableLocation(l) && l.type === "shop");

const errText = (e, en) => {
  const d = e?.response?.data || {};
  return (en ? d.message_en : d.message_fr) || d.message || (en ? "Could not save." : "Enregistrement impossible.");
};

export function BarModeOrgSwitch({ lang, effectivePlan, isOwner, locations }) {
  const offered = barModeCardOffered({ isOwner, effectivePlan });
  const en = lang === "en";
  const qc = useQueryClient();
  const [saving, setSaving] = useState(null);
  const { data } = useQuery({
    queryKey: BAR_MODE_QUERY_KEY,
    queryFn: async () => (await api.get("/auth/bar-mode")).data,
    enabled: offered,
    staleTime: 60_000,
  });
  if (!offered || !data) return null;
  const enabled = data.enabled === true;
  const shops = barCandidateShops(locations);

  const flipOrg = async () => {
    if (saving) return;
    setSaving("org");
    try {
      await api.post("/auth/bar-mode-enabled", { enabled: !enabled });
      await qc.invalidateQueries({ queryKey: BAR_MODE_QUERY_KEY });
      toast.success(!enabled ? (en ? "Bar Mode turned on" : "Mode Bar activé")
                             : (en ? "Bar Mode turned off" : "Mode Bar désactivé"));
    } catch (e) { toast.error(errText(e, en)); } finally { setSaving(null); }
  };
  const flipShop = async (loc) => {
    if (saving) return;
    setSaving(loc.id);
    try {
      await api.patch(`/locations/${loc.id}/bar`, { enabled: loc.bar_enabled !== true });
      await qc.invalidateQueries({ queryKey: ["locations"] });
      toast.success(loc.bar_enabled !== true
        ? (en ? `${loc.name} is now a bar` : `${loc.name} est maintenant un bar`)
        : (en ? `${loc.name} is no longer a bar` : `${loc.name} n'est plus un bar`));
    } catch (e) { toast.error(errText(e, en)); } finally { setSaving(null); }
  };

  return (
    <div data-bar-mode-card style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>🍺 {en ? "Bar Mode" : "Mode Bar"}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            {en
              ? "For a shop that runs as a bar: tabs per table, rounds, and the night's sales on the shift's date. You choose which shops are bars. Turning it on changes nothing in your other shops."
              : "Pour une boutique qui fonctionne comme un bar : notes par table, tournées, et les ventes de la nuit à la date du service. Vous choisissez quelles boutiques sont des bars. L'activer ne change rien dans vos autres boutiques."}
          </div>
        </div>
        <button type="button" className={enabled ? "btn btn-secondary" : "btn btn-primary"} disabled={!!saving} onClick={flipOrg}>
          {saving === "org" ? "…" : enabled ? (en ? "Turn off" : "Désactiver") : (en ? "Turn on" : "Activer")}
        </button>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: enabled ? "#7BE0A5" : "var(--text-muted)" }}>
        {enabled ? (en ? "● On" : "● Activé") : (en ? "○ Off" : "○ Désactivé")}
      </div>
      {enabled && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{en ? "Which shops are bars?" : "Quelles boutiques sont des bars ?"}</div>
          {shops.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{en ? "No shop yet." : "Aucune boutique pour l'instant."}</div>
          )}
          {shops.map((loc) => (
            <label key={loc.id} data-bar-shop={loc.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={loc.bar_enabled === true} disabled={!!saving} onChange={() => flipShop(loc)} />
              <span>{loc.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {loc.bar_enabled === true ? (en ? "bar" : "bar") : (en ? "normal shop" : "boutique normale")}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
