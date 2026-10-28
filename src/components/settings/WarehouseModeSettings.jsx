// WAREHOUSE MODE (Peter, 2026-10-28) — the two Settings pieces.
//
// WarehouseModeOrgSwitch — Settings → Mode, OWNER only: turns the Warehouse Mode button on or
//   off for the whole business (Stenamo admins have the same switch in the admin portal).
//   Turning it on needs Pro Plus (the server refuses otherwise); turning it off sends everyone
//   back to POS Mode. Audit row on the server.
//
// VirtualStoresSection — Settings → Warehouses & Shops, Warehouse Mode only: the list of
//   virtual stores (dashed cards, "keeps no stock") and "+ Add virtual store" for the owner or
//   a manager the owner allowed.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { useAuthStore } from "../../store";
import { applyWorkModeAttribute, effectiveWorkMode } from "../../utils/workMode";
import { isVirtualStore } from "../../utils/locations";
import NewVirtualStoreButton from "../common/NewVirtualStoreButton";

export function WarehouseModeOrgSwitch({ lang, effectivePlan }) {
  const en = lang === "en";
  const qc = useQueryClient();
  const org = useAuthStore((s) => s.org);
  const enabled = org?.warehouse_mode_enabled === true;
  const [saving, setSaving] = useState(false);

  // Shown on Pro Plus, or while still on (so a downgraded owner can always switch it off).
  if (effectivePlan !== "pro_plus" && !enabled) return null;

  const flip = async () => {
    if (saving) return;
    setSaving(true);
    const target = !enabled;
    try {
      await api.post("/auth/warehouse-mode-enabled", { enabled: target });
      const st = useAuthStore.getState();
      st.patchOrg({ warehouse_mode_enabled: target });
      // The owner's own button follows at once (the server computes it; /auth/me tells us).
      try {
        const me = (await api.get("/auth/me"))?.data?.user;
        if (me) st.patchUser({ work_mode: me.work_mode === "warehouse" ? "warehouse" : "pos",
          warehouse_mode_available: me.warehouse_mode_available === true });
      } catch { if (!target) st.patchUser({ work_mode: "pos", warehouse_mode_available: false }); }
      const mode = effectiveWorkMode(useAuthStore.getState().user);
      applyWorkModeAttribute(mode);
      if (!target) await qc.resetQueries();
      toast.success(target
        ? (en ? "Warehouse Mode button turned on" : "Bouton Mode Entrepôt activé")
        : (en ? "Warehouse Mode turned off — everyone is back in POS Mode" : "Mode Entrepôt désactivé — tout le monde revient en Mode Caisse"));
    } catch (e) {
      const d = e?.response?.data || {};
      toast.error((en ? d.message_en : d.message_fr) || d.message || (en ? "Could not save." : "Enregistrement impossible."));
    } finally { setSaving(false); }
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>🏭 {en ? "Warehouse Mode" : "Mode Entrepôt"}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            {en
              ? "Shows a \"Warehouse Mode\" button to you, your managers, warehouse staff and accountants (never cashiers). In Warehouse Mode the selling screens and real shops are hidden, and goods can be sent to virtual stores. Each person switches back to POS Mode with one tap."
              : "Affiche un bouton « Mode Entrepôt » pour vous, vos gérants, magasiniers et comptables (jamais les caissiers). En Mode Entrepôt, les écrans de vente et les vraies boutiques sont masqués, et la marchandise peut être envoyée vers des magasins virtuels. Chacun revient au Mode Caisse d'un seul geste."}
          </div>
          {enabled && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
              {en ? "Turning it off sends everyone back to POS Mode." : "Le désactiver renvoie tout le monde en Mode Caisse."}
            </div>
          )}
        </div>
        <button type="button" className={enabled ? "btn btn-secondary" : "btn btn-primary"} disabled={saving} onClick={flip}>
          {saving ? "…" : enabled ? (en ? "Turn off" : "Désactiver") : (en ? "Turn on" : "Activer")}
        </button>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: enabled ? "#7BE0A5" : "var(--text-muted)" }}>
        {enabled ? (en ? "● On" : "● Activé") : (en ? "○ Off" : "○ Désactivé")}
      </div>
    </div>
  );
}

export function VirtualStoresSection({ lang, locations }) {
  const en = lang === "en";
  const virtuals = (locations || []).filter(isVirtualStore);
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{en ? "Virtual stores" : "Magasins virtuels"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {en ? "Names to send goods to. They keep no stock; a transfer to one completes at once."
                : "Des noms vers lesquels envoyer la marchandise. Ils ne gardent aucun stock ; un transfert vers l'un d'eux se termine aussitôt."}
          </div>
        </div>
        <NewVirtualStoreButton en={en} label={en ? "Add virtual store" : "Ajouter un magasin virtuel"} />
      </div>
      {virtuals.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "14px 16px", border: "1px dashed var(--border-hover)", borderRadius: 12 }}>
          {en ? "No virtual store yet." : "Aucun magasin virtuel pour l'instant."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {virtuals.map((loc) => (
            <div key={loc.id} style={{ border: "1.5px dashed var(--border-hover)", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(123,224,165,0.12)", color: "#7BE0A5", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                {(loc.name || "?").trim().charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{loc.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{en ? "Virtual · keeps no stock" : "Virtuel · aucun stock"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 14 }}>
        {en ? "Real shops are hidden in Warehouse Mode. Virtual stores are hidden in POS Mode."
            : "Les vraies boutiques sont masquées en Mode Entrepôt. Les magasins virtuels sont masqués en Mode Caisse."}
      </div>
    </div>
  );
}
