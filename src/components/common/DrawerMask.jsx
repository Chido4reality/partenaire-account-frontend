// HIDE THE CASH AMOUNT — EVERY DEVICE (Peter, 2026-10-16). One helper for every screen that
// shows a drawer money figure (expected drawer, float, cash in, counted, variance), so the
// rule is applied the same way everywhere: while the org setting is ON and nobody has
// re-entered their password in the last 90 s, each figure reads ••••• and a "Show" button
// opens the password prompt. One reveal unmasks every drawer surface (useDrawerReveal is
// module-level); leaving the screen or 90 s hides them all again. Setting OFF → unmasked.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../utils/api";
import { useDrawerReveal, MASK } from "../../utils/useDrawerReveal";
import RevealPinModal from "./RevealPinModal";

// The org setting, from the SAME ["settings"] query (same key, same shape) the drawer card
// and the shift banner already use — no extra request. Absent ⇒ ON (the server default).
export function useDrawerMask() {
  const { data: orgResp } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings").then((r) => r.data),
    staleTime: 300000,
  });
  const { gateOn, revealed } = useDrawerReveal({ enabled: orgResp?.data?.hide_drawer_amount !== false });
  const masked = gateOn && !revealed;
  return { masked, gateOn, maskMoney: (fmt) => (masked ? () => MASK : fmt) };
}

// "🔒 Amounts hidden — Show" + the password prompt. Renders nothing when unmasked.
export function DrawerRevealButton({ en, masked, style }) {
  const [ask, setAsk] = useState(false);
  if (!masked) return null;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setAsk(true); }}
        style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "4px 10px", cursor: "pointer",
          color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, ...style }}>
        🔒 {en ? "Cash amounts hidden — Show" : "Montants de caisse masqués — Afficher"}
      </button>
      {ask && <RevealPinModal open onClose={() => setAsk(false)} />}
    </>
  );
}

export { MASK };
