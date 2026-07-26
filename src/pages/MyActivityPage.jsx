// MP-STAFF-ACTIVITY-LEDGER Phase 4: a staff member's OWN activity timeline, read-only.
// Only reachable when the owner turned on staff_can_view_own_activity; the server forces
// p_user_id = the caller, so this can only ever show the viewer's own actions.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { LEDGER_TYPES, LEDGER_TYPE_ORDER, ltLabel, fmtLedgerWhen } from "../utils/ledgerTypes";
import TransferDetailModal from "../components/TransferDetailModal";
import BufferDetailModal from "../components/BufferDetailModal";

export default function MyActivityPage() {
  const en = useLangStore((s) => s.lang) === "en";
  const fmt = useCurrency();
  const [type, setType] = useState("all");
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transferId, setTransferId] = useState(null);
  const [bufferId, setBufferId] = useState(null);

  const fromIso = new Date(fromDate + "T00:00:00").toISOString();
  const toIso = (() => { const d = new Date(toDate + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString(); })();
  const qs = [type !== "all" ? `types=${encodeURIComponent(type)}` : "", `from=${encodeURIComponent(fromIso)}`, `to=${encodeURIComponent(toIso)}`, "limit=300"].filter(Boolean).join("&");

  const q = useQuery({
    queryKey: ["my-activity", type, fromIso, toIso],
    queryFn: () => api.get(`/staff/my-activity?${qs}`).then((r) => r.data),
    retry: false,
  });
  const disabled = q.error?.response?.status === 403;
  const rows = q.data?.data || [];
  const sel = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, width: "100%" };

  const openDetail = (r) => {
    if (r.ref_type === "transfer" && r.ref_id) setTransferId(r.ref_id);
    else if (r.ref_type === "buffer" && r.ref_id) setBufferId(r.ref_id);
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 12px 40px" }}>
      <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 2 }}>📒 {en ? "My activity" : "Mon activité"}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
        {en ? "A record of what you did — only you can see this." : "Un relevé de ce que vous avez fait — vous seul le voyez."}
      </div>

      {disabled ? (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 30, background: "var(--bg-elevated)", borderRadius: 12 }}>
          {en ? "The shop owner has not turned on this view." : "Le propriétaire de la boutique n'a pas activé cette vue."}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "Type" : "Type"}</label>
              <select value={type} onChange={(e) => setType(e.target.value)} style={sel}>
                <option value="all">{en ? "All" : "Tous"}</option>
                {LEDGER_TYPE_ORDER.map((t) => <option key={t} value={t}>{LEDGER_TYPES[t].icon} {ltLabel(t, en)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "From" : "Du"}</label>
              <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} style={sel} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>{en ? "To" : "Au"}</label>
              <input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} style={sel} />
            </div>
          </div>

          {q.isLoading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>{en ? "Loading…" : "Chargement…"}</div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>{en ? "Nothing in this range." : "Rien dans cette période."}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map((r) => {
                const tappable = r.ref_type === "transfer" || r.ref_type === "buffer";
                return (
                  <button key={r.entry_id} onClick={tappable ? () => openDetail(r) : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, textAlign: "left", cursor: tappable ? "pointer" : "default", width: "100%" }}>
                    <div style={{ fontSize: 20, flexShrink: 0 }}>{LEDGER_TYPES[r.activity_type]?.icon || "•"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                        {ltLabel(r.activity_type, en)}
                        {r.ref_number ? <span style={{ color: "var(--text-muted)", fontWeight: 500, fontFamily: "monospace", fontSize: 11, marginLeft: 6 }}>{r.ref_number}</span> : null}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                        {fmtLedgerWhen(r.occurred_at, en)}{r.branch_name ? ` · ${r.branch_name}` : ""}
                      </div>
                    </div>
                    {r.amount != null && <div style={{ fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{fmt(r.amount)}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {transferId && <TransferDetailModal transferId={transferId} onClose={() => setTransferId(null)} />}
      {bufferId && <BufferDetailModal bufferId={bufferId} onClose={() => setBufferId(null)} />}
    </div>
  );
}
