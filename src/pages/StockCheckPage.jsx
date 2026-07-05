// MP-STOCK-CHECK: sidebar surface for physically re-counting received/transferred
// (or manually-flagged) products, so miscounts/theft are caught at movement time.
// Pending list → confirm count → verified|mismatch. A Mismatches view is the boss's
// fraud-signal trail. Boss can manually add a product via the existing fuzzy search.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import toast from "react-hot-toast";
import { unitLabel } from "../utils/units";

function fmtDate(iso, en) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// MP-STOCK-CHECK: normalize ANY list/search response to an array before .map().
// Accepts a raw axios response, our {success,data:[…]} envelope body, a bare array,
// or a {results:[…]} shape — anything else → []. A truthy non-array object (e.g. the
// envelope) would slip past `x || []` and throw ".map is not a function"; this can't.
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.data)) return x.data;                 // envelope body: { data: [...] }
  if (Array.isArray(x?.data?.data)) return x.data.data;      // axios response: resp.data = { data: [...] }
  if (Array.isArray(x?.data?.results)) return x.data.results;
  if (Array.isArray(x?.results)) return x.results;
  return [];
}

export default function StockCheckPage() {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending");           // pending | mismatch
  const [verifyFor, setVerifyFor] = useState(null);    // the row being counted
  const [countInput, setCountInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const list = useQuery({
    queryKey: ["stock-checks", tab],
    queryFn: () => api.get(`/stock-checks?status=${tab}`).then(r => toArray(r)),
    refetchInterval: 15000,
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, counted_qty }) => api.post(`/stock-checks/${id}/verify`, { counted_qty }).then(r => r.data),
    onSuccess: (res) => {
      if (res.matches) {
        toast.success(en ? "✓ Count matches" : "✓ Le comptage correspond");
      } else {
        toast(en ? `⚠ Mismatch — expected ${res.expected}, counted ${res.counted}`
                 : `⚠ Écart — attendu ${res.expected}, compté ${res.counted}`,
          { icon: "⚠️", duration: 6000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
      setVerifyFor(null); setCountInput("");
      qc.invalidateQueries({ queryKey: ["stock-checks"] });
      qc.invalidateQueries({ queryKey: ["stock-check-summary"] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  const rows = Array.isArray(list.data) ? list.data : [];

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>{en ? "Stock Check" : "Vérification de stock"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, maxWidth: 620 }}>
            {en
              ? "Re-count products flagged at receive/transfer to catch miscounts early. This checks stock at movement time — it complements (doesn't replace) a full count."
              : "Recomptez les produits signalés à la réception/au transfert pour détecter tôt les écarts. Cela vérifie le stock au moment du mouvement — en complément d'un comptage complet."}
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary" style={{ fontWeight: 700 }}>
          + {en ? "Add product to re-count" : "Ajouter un produit à recompter"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        {["pending", "mismatch"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border)", cursor: "pointer", fontWeight: 700, fontSize: 13,
              background: tab === t ? "var(--brand-light)" : "transparent", color: tab === t ? "#1a1a2e" : "var(--text-secondary)" }}>
            {t === "pending" ? (en ? "To count" : "À compter") : (en ? "Mismatches" : "Écarts")}
          </button>
        ))}
      </div>

      {list.isLoading && <div style={{ color: "var(--text-muted)", padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}
      {!list.isLoading && rows.length === 0 && (
        <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center", background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)" }}>
          {tab === "pending"
            ? (en ? "Nothing to re-count right now." : "Rien à recompter pour le moment.")
            : (en ? "No mismatches — all counted items matched." : "Aucun écart — tout correspond.")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => {
          const p = r.pa_products || {};
          const loc = r.pa_locations || {};
          const isMismatch = r.status === "mismatch";
          const delta = isMismatch ? (Number(r.qty_counted) - Number(r.qty_expected)) : null;
          return (
            <div key={r.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: `3px solid ${isMismatch ? "#f87171" : "var(--brand-light)"}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {en ? (p.name_en || p.name) : p.name}
                    {p.sku && <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{p.sku}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>📍 {loc.name || "—"}</span>
                    <span>{r.flagged_by === "boss" ? (en ? "🔍 boss-flagged" : "🔍 signalé par le patron") : (en ? "🎲 auto-check" : "🎲 auto-vérif")}</span>
                    <span>{r.movement_type === "receive" ? (en ? "receive" : "réception") : r.movement_type === "transfer" ? (en ? "transfer" : "transfert") : (en ? "manual" : "manuel")}</span>
                    {r.reference && <span>#{r.reference}</span>}
                    <span>{fmtDate(r.created_at, en)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Before" : "Avant"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_before)}</b></span>
                    <span style={{ color: "var(--text-muted)" }}>{en ? "Expected" : "Attendu"}: <b style={{ color: "var(--text-primary)" }}>{Number(r.qty_expected)} {unitLabel(p.unit)}</b></span>
                    {isMismatch && <>
                      <span style={{ color: "var(--text-muted)" }}>{en ? "Counted" : "Compté"}: <b style={{ color: "#f87171" }}>{Number(r.qty_counted)}</b></span>
                      <span style={{ color: "#f87171", fontWeight: 700 }}>{delta > 0 ? "+" : ""}{delta}</span>
                    </>}
                  </div>
                  {r.moved_by_name && (
                    <div style={{ fontSize: 12, color: isMismatch ? "#fca5a5" : "var(--text-muted)", marginTop: 4 }}>
                      👤 {en ? "Moved by" : "Déplacé par"}: <b>{r.moved_by_name}</b>
                      {isMismatch && r.verified_by_name && <span> · {en ? "counted by" : "compté par"} {r.verified_by_name}</span>}
                    </div>
                  )}
                </div>
                {r.status === "pending" && (
                  <button onClick={() => { setVerifyFor(r); setCountInput(""); }} className="btn btn-success" style={{ fontWeight: 700, alignSelf: "center", whiteSpace: "nowrap" }}>
                    {en ? "Confirm count" : "Confirmer le comptage"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {verifyFor && (
        <VerifyModal row={verifyFor} en={en} value={countInput} setValue={setCountInput}
          busy={verifyMut.isPending}
          onCancel={() => { setVerifyFor(null); setCountInput(""); }}
          onSubmit={() => {
            const n = Number(countInput);
            if (!Number.isFinite(n) || n < 0) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; }
            verifyMut.mutate({ id: verifyFor.id, counted_qty: n });
          }} />
      )}

      {showAdd && <AddToRecount en={en} onClose={() => setShowAdd(false)}
        onAdded={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ["stock-checks"] }); qc.invalidateQueries({ queryKey: ["stock-check-summary"] }); }} />}
    </div>
  );
}

function VerifyModal({ row, en, value, setValue, onCancel, onSubmit, busy }) {
  const p = row.pa_products || {};
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Confirm physical count" : "Confirmer le comptage physique"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
          {en ? "How many did you physically count?" : "Combien avez-vous physiquement compté ?"}
        </label>
        <input className="input" type="number" min="0" autoFocus value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSubmit()} placeholder={en ? "Counted quantity" : "Quantité comptée"} style={{ marginTop: 6 }} />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
          {en ? `System expects ${Number(row.qty_expected)}.` : `Le système attend ${Number(row.qty_expected)}.`}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy} onClick={onSubmit}>{busy ? "…" : (en ? "Confirm" : "Confirmer")}</button>
        </div>
      </div>
    </div>
  );
}

// Boss manual add — fuzzy product search (existing /products?search= → search_products_fuzzy
// RPC) EXCLUDING kit parents, then pick a location; server fills qty from current stock.
function AddToRecount({ en, onClose, onAdded }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);   // { id, name }
  const [locId, setLocId] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useQuery({
    queryKey: ["stock-check-product-search", q],
    // Same fuzzy path POS/Inventory use (search_products_fuzzy). toArray() guarantees
    // an array regardless of the envelope shape, then drop kit parents (no stock row).
    queryFn: () => api.get(`/products?search=${encodeURIComponent(q)}`).then(r => toArray(r).filter(p => !p.is_multipart)),
    enabled: q.trim().length >= 1 && !picked,
  });
  const locs = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => toArray(r)),
  });
  const results = Array.isArray(search.data) ? search.data : [];
  const locList = Array.isArray(locs.data) ? locs.data : [];

  const add = async () => {
    if (!picked || !locId) return;
    setBusy(true);
    try {
      await api.post("/stock-checks", { product_id: picked.id, location_id: locId });
      toast.success(en ? "Added to re-count list" : "Ajouté à la liste de recomptage");
      onAdded();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12 }}>{en ? "Add product to re-count" : "Ajouter un produit à recompter"}</div>

        {!picked ? (
          <>
            <input className="input" autoFocus placeholder={en ? "Search product (name / SKU)…" : "Chercher un produit (nom / SKU)…"}
              value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
              {search.isLoading && <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "Searching…" : "Recherche…"}</div>}
              {results.map(p => (
                <div key={p.id} onClick={() => setPicked({ id: p.id, name: en ? (p.name_en || p.name) : p.name })}
                  style={{ padding: "9px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseDown={e => e.preventDefault()}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{[p.sku, p.barcode].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              ))}
              {q.trim().length >= 1 && !search.isLoading && results.length === 0 &&
                <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 8 }}>{en ? "No match." : "Aucun résultat."}</div>}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700 }}>{picked.name}</span>
              <button onClick={() => { setPicked(null); }} style={{ background: "none", border: "none", color: "var(--brand-light)", cursor: "pointer", fontSize: 12 }}>{en ? "change" : "changer"}</button>
            </div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Location to re-count" : "Emplacement à recompter"}</label>
            <select className="input" value={locId} onChange={e => setLocId(e.target.value)} style={{ marginTop: 6 }}>
              <option value="">{en ? "— pick a location —" : "— choisir un emplacement —"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
              {en ? "Expected count = the product's current stock at that location." : "Comptage attendu = le stock actuel du produit à cet emplacement."}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !picked || !locId} onClick={add}>
            {busy ? "…" : (en ? "Add to re-count" : "Ajouter au recomptage")}
          </button>
        </div>
      </div>
    </div>
  );
}
