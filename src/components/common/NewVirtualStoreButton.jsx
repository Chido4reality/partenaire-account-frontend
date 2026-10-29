// WAREHOUSE MODE (Peter, 2026-10-28): "+ New virtual store" — used on the Transfers screen
// (under the TO list) and in Settings → Locations.
//
// A virtual store is a name to send goods to: it keeps no stock, nothing is sold or counted
// there, and it only shows in Warehouse Mode. Created ONLY by the owner, or a manager the owner
// allowed (can_create_virtual_stores). Everyone else never sees this button; the server refuses
// them too (and logs every creation in the Accountant Log).

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { useAuthStore } from "../../store";
import { useMyPermissions } from "../../utils/useMyPermissions";
import { useIsWarehouseMode } from "../../utils/workMode";

export function useCanCreateVirtualStore() {
  const role = useAuthStore((s) => s.user?.role);
  const wh = useIsWarehouseMode();
  // Fail closed: a manager whose permissions are still loading (or failed) sees nothing.
  const { perms } = useMyPermissions({ enabled: wh && role === "manager" });
  if (!wh) return false;
  if (role === "owner") return true;
  return role === "manager" && !!perms && perms.can_create_virtual_stores === true;
}

// `open` / `onOpenChange` (optional): let a form open the name field itself — the New Transfer
// destination dropdown's "+ New virtual store" option. Without them the button keeps its own state.
export default function NewVirtualStoreButton({ en, onCreated, label, open: openProp, onOpenChange }) {
  const qc = useQueryClient();
  const allowed = useCanCreateVirtualStore();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v) => { setOpenState(v); if (onOpenChange) onOpenChange(v); };
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => api.post("/locations", { name: name.trim(), kind: "virtual" }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(en ? "Virtual store created" : "Magasin virtuel créé");
      qc.invalidateQueries({ queryKey: ["locations"] });
      setOpen(false); setName("");
      if (onCreated && res?.data) onCreated(res.data);
    },
    onError: (err) => {
      const d = err?.response?.data || {};
      toast.error((en ? d.message_en : d.message_fr) || d.message || (en ? "Could not create it." : "Création impossible."));
    },
  });

  if (!allowed) return null;

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}
        style={{ borderStyle: "dashed" }}>
        + {label || (en ? "New virtual store" : "Nouveau magasin virtuel")}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input className="input" autoFocus value={name} maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !create.isPending) create.mutate(); }}
        placeholder={en ? "Name of the virtual store" : "Nom du magasin virtuel"}
        style={{ flex: "1 1 180px" }} />
      <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim() || create.isPending}
        onClick={() => create.mutate()}>
        {create.isPending ? "…" : (en ? "Create" : "Créer")}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); setName(""); }}>
        {en ? "Cancel" : "Annuler"}
      </button>
    </div>
  );
}
