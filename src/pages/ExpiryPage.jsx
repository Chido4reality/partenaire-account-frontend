// EXPIRY-TRACKING (Peter, 2026-10-04) — the Expiring stock screen.
//
// Every figure is an ESTIMATE (GET /expiry/stock → pa_expiry_estimate): what is left
// of each dated delivery, assuming the oldest stock is sold first. Stock that no dated
// delivery accounts for (opening stock, transfers in, adjustments up) shows as
// "no expiry recorded". Expired lots can be written off: the existing damaged
// write-off (stock leaves sellable, lands in the damaged pile as 'expired', its loss
// valued at cost on the day). Pro and above.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import useExpiryFeature from "../hooks/useExpiryFeature";
import PaywallModal from "../components/common/PaywallModal";

const BUCKETS = [
  { key: "expired", en: "Expired",       fr: "Périmé",          color: "#f87171" },
  { key: "d30",     en: "≤ 30 days",     fr: "≤ 30 jours",      color: "#fb923c" },
  { key: "d60",     en: "≤ 60 days",     fr: "≤ 60 jours",      color: "#fbbf24" },
  { key: "d90",     en: "≤ 90 days",     fr: "≤ 90 jours",      color: "#a3e635" },
];
const MINOR = [
  { key: "later", en: "Later than 90 days", fr: "Au-delà de 90 jours" },
  { key: "none",  en: "No expiry recorded", fr: "Sans date enregistrée" },
];

const fmtDate = (iso, en) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return en ? `${d}/${m}/${y}` : `${d}/${m}/${y}`;
};
const daysLabel = (n, en) => {
  if (n === null || n === undefined) return "";
  if (n < 0) return en ? `${-n} day${n === -1 ? "" : "s"} ago` : `il y a ${-n} jour${n === -1 ? "" : "s"}`;
  if (n === 0) return en ? "today" : "aujourd'hui";
  return en ? `in ${n} day${n === 1 ? "" : "s"}` : `dans ${n} jour${n === 1 ? "" : "s"}`;
};

export default function ExpiryPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const { user } = useAuthStore();
  const fmt = useCurrency();
  const qc = useQueryClient();
  const { canExpiry, plan, userIdNumber } = useExpiryFeature();
  const canPickLocation = ["owner", "manager", "accountant"].includes(user?.role);
  const canWriteOff = ["owner", "manager"].includes(user?.role);
  const [location, setLocation] = useState("");
  const [bucket, setBucket] = useState("expired");
  const [writeOff, setWriteOff] = useState(null);
  const [paywall, setPaywall] = useState(false);

  // MP-LOCATIONS-CACHE-FIX: shared ["locations"] key — same queryFn shape as every consumer.
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data), enabled: canExpiry && canPickLocation });
  const locList = Array.isArray(locs.data?.data) ? locs.data.data : [];

  const q = useQuery({
    queryKey: ["expiry-stock", location],
    queryFn: () => api.get("/expiry/stock", { params: { location_id: location || undefined } }).then(r => r.data),
    enabled: canExpiry,
  });
  const summary = q.data?.summary || {};
  const rows = (q.data?.data || []).filter(r => r.bucket === bucket);
  const seesValue = summary.expired && summary.expired.value !== null && summary.expired.value !== undefined;

  if (!canExpiry) {
    return (
      <div style={{ padding: 16, maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>⏳ {en ? "Expiring stock" : "Stock à expiration"}</h2>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{en ? "Expiry tracking is part of the Pro plan" : "Le suivi des dates d'expiration fait partie du forfait Pro"}</div>
          <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 12 }}>
            {en ? "Record an expiry date on every delivery, get alerts 90, 60 and 30 days before, and write off expired stock with its loss value."
                : "Enregistrez la date d'expiration de chaque livraison, recevez des alertes 90, 60 et 30 jours avant, et sortez le stock périmé avec sa perte."}
          </div>
          {user?.role === "owner" && (
            <button className="btn btn-primary" onClick={() => setPaywall(true)}>{en ? "See plans" : "Voir les forfaits"}</button>
          )}
        </div>
        {paywall && <PaywallModal feature="track_expiry" currentPlan={plan} mpId={userIdNumber} onClose={() => setPaywall(false)} />}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>⏳ {en ? "Expiring stock" : "Stock à expiration"}</h2>
        {canPickLocation && (
          <select className="input" style={{ maxWidth: 240 }} value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">{en ? "All locations" : "Tous les emplacements"}</option>
            {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", marginBottom: 14 }}>
        <strong>{en ? "ESTIMATE." : "ESTIMATION."}</strong>{" "}
        {en ? "Quantities assume the oldest stock is sold first: the newest deliveries are counted as still on the shelf. Stock with no dated delivery (opening stock, transfers in) shows as “no expiry recorded”."
            : "Les quantités supposent que le stock le plus ancien est vendu en premier : les livraisons les plus récentes sont comptées comme encore en rayon. Le stock sans livraison datée (stock initial, transferts reçus) apparaît « sans date enregistrée »."}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
        {BUCKETS.map(b => {
          const s = summary[b.key] || { qty: 0, value: 0, lines: 0 };
          const on = bucket === b.key;
          return (
            <button key={b.key} onClick={() => setBucket(b.key)} className="card"
              style={{ textAlign: "left", padding: 12, cursor: "pointer", border: `2px solid ${on ? b.color : "var(--border)"}`, background: on ? "var(--bg-elevated)" : undefined }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{en ? b.en : b.fr}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{Number(s.qty || 0).toLocaleString()}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                {s.lines} {en ? (s.lines === 1 ? "lot" : "lots") : (s.lines === 1 ? "lot" : "lots")}
                {seesValue ? ` · ${fmt(s.value || 0)}` : ""}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {MINOR.map(b => {
          const s = summary[b.key] || { qty: 0, lines: 0 };
          return (
            <button key={b.key} className="btn btn-sm" onClick={() => setBucket(b.key)}
              style={{ border: `1.5px solid ${bucket === b.key ? "var(--brand)" : "var(--border)"}`, background: "transparent" }}>
              {en ? b.en : b.fr}: {Number(s.qty || 0).toLocaleString()}
            </button>
          );
        })}
      </div>

      {q.isLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
      {q.isError && <div style={{ color: "#f87171" }}>{en ? "Could not load — check your connection." : "Chargement impossible — vérifiez votre connexion."}</div>}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <div style={{ color: "var(--text-muted)", padding: 12 }}>{en ? "Nothing in this group." : "Rien dans ce groupe."}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(r => (
          <div key={`${r.product_id}:${r.location_id}:${r.expiry_date}`} className="card"
            style={{ padding: 12, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 220px" }}>
              <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{(en && r.product_name_en) || r.product_name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {r.location_name}
                {r.expiry_date ? ` · ${en ? "expires" : "expire le"} ${fmtDate(r.expiry_date, en)} (${daysLabel(r.days_left, en)})` : ""}
                {r.batch_nos ? ` · ${en ? "lot" : "lot"} ${r.batch_nos}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800 }}>≈ {Number(r.est_qty).toLocaleString()} {r.unit || ""}</div>
              {r.est_value !== null && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>≈ {fmt(r.est_value)}</div>}
            </div>
            {canWriteOff && r.bucket === "expired" && (
              <button className="btn btn-sm btn-secondary" onClick={() => setWriteOff(r)}>
                🗑️ {en ? "Write off as expired" : "Sortir comme périmé"}
              </button>
            )}
          </div>
        ))}
      </div>

      {writeOff && (
        <WriteOffModal en={en} fmt={fmt} row={writeOff} onClose={() => setWriteOff(null)}
          onDone={() => { setWriteOff(null); qc.invalidateQueries({ queryKey: ["expiry-stock"] }); qc.invalidateQueries({ queryKey: ["expiry-pos-warnings"] }); }} />
      )}
    </div>
  );
}

function WriteOffModal({ en, fmt, row, onClose, onDone }) {
  const [qty, setQty] = useState(String(row.est_qty));
  const [note, setNote] = useState("");
  // One id per opened modal: a double tap or a retried request is written off ONCE
  // (the route dedups on local_id).
  const [localId] = useState(() => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `exp-${Date.now()}-${Math.random()}`));
  const mut = useMutation({
    mutationFn: () => api.post("/stock-checks/damaged/writeoff", {
      product_id: row.product_id, location_id: row.location_id, quantity: Number(qty),
      reason: "expired", expiry_date: row.expiry_date, note: note.trim() || null, local_id: localId,
    }).then(r => r.data),
    onSuccess: (res) => {
      const loss = res?.data?.loss_value;
      toast.success(en ? `Written off as expired${loss != null ? ` — loss ${fmt(loss)}` : ""}` : `Sorti comme périmé${loss != null ? ` — perte ${fmt(loss)}` : ""}`);
      onDone();
    },
    onError: (e) => toast.error(e?.response?.data?.[en ? "message_en" : "message_fr"] || e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });
  const n = Number(qty);
  const ok = Number.isFinite(n) && n > 0;
  return (
    <div className="modal-overlay" onClick={() => !mut.isPending && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{en ? "Write off as expired" : "Sortir comme périmé"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {row.product_name} · {row.location_name} · {en ? "expired" : "périmé le"} {fmtDate(row.expiry_date, en)}
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          {en ? "These units leave sellable stock and go to the damaged goods pile as “expired”. The loss is recorded at today's cost price."
              : "Ces unités sortent du stock vendable et vont dans les marchandises endommagées comme « périmé ». La perte est enregistrée au prix d'achat du jour."}
        </div>
        <div className="form-group">
          <label className="label">{en ? "Quantity to write off" : "Quantité à sortir"} ({en ? "estimate" : "estimation"}: {Number(row.est_qty).toLocaleString()})</label>
          <input className="input" type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} />
        </div>
        {row.unit_cost !== null && ok && (
          <div style={{ fontSize: 12.5, marginBottom: 10 }}>{en ? "Loss" : "Perte"}: <strong>≈ {fmt(n * row.unit_cost)}</strong></div>
        )}
        <div className="form-group">
          <label className="label">{en ? "Note (optional)" : "Note (facultatif)"}</label>
          <input className="input" value={note} maxLength={300} onChange={e => setNote(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={mut.isPending} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={!ok || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : (en ? "Write off" : "Sortir du stock")}
          </button>
        </div>
      </div>
    </div>
  );
}
