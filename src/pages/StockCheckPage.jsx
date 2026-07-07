// MP-STOCK-CHECK: sidebar surface for physically re-counting received/transferred
// (or boss-watched) products, so miscounts/theft are caught at movement time.
// Pending list → Done | Mismatch (| owner Delete). A Mismatches view is the boss's
// permanent fraud-signal trail.
//
// MP-STOCK-CHECK-RESHAPE: the pending list is fed by THREE coexisting sources —
// SYSTEM sampling, boss "🔍 Flag for re-count", and persistent boss WATCHES (every
// movement of a watched product into its watched location auto-creates a check).
// The old manual "add product & count now" (which duplicated the full Count feature)
// is replaced by "➕ Watch a product" (owner-only). Resolution is Done / Mismatch,
// plus an owner-only Delete for false flags — staff can never erase a flag on their
// own movement (anti-fraud).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useLangStore, useAuthStore } from "../store";
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

// How a check landed on the list — badge shown on each row.
function flaggedLabel(flaggedBy, en) {
  if (flaggedBy === "boss")     return en ? "🔍 boss-flagged"     : "🔍 signalé par le patron";
  if (flaggedBy === "watch")    return en ? "👁 watched"          : "👁 surveillé";
  if (flaggedBy === "transfer") return en ? "🔁 transfer variance" : "🔁 écart de transfert";
  return en ? "🎲 auto-check" : "🎲 auto-vérif";
}

export default function StockCheckPage() {
  const lang = useLangStore(s => s.lang);
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const isOwner = useAuthStore(s => s.user?.role) === "owner";
  const [tab, setTab] = useState("pending");           // pending | mismatch
  const [resolveFor, setResolveFor] = useState(null);  // the row being resolved
  const [deleteFor, setDeleteFor] = useState(null);    // the pending row being deleted (owner)
  const [showWatch, setShowWatch] = useState(false);

  const list = useQuery({
    queryKey: ["stock-checks", tab],
    queryFn: () => api.get(`/stock-checks?status=${tab}`).then(r => toArray(r)),
    refetchInterval: 15000,
  });

  const watches = useQuery({
    queryKey: ["stock-check-watches"],
    queryFn: () => api.get("/stock-checks/watches").then(r => toArray(r)),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["stock-checks"] });
    qc.invalidateQueries({ queryKey: ["stock-check-summary"] });
  };

  const resolveMut = useMutation({
    mutationFn: ({ id, counted_qty, resolution }) =>
      api.post(`/stock-checks/${id}/verify`, { counted_qty, resolution }).then(r => r.data),
    onSuccess: (res) => {
      if (res.matches) {
        toast.success(en ? "✓ Done — removed from the list" : "✓ Fait — retiré de la liste");
      } else {
        toast(en ? `⚠ Mismatch kept — expected ${res.expected}, counted ${res.counted}`
                 : `⚠ Écart conservé — attendu ${res.expected}, compté ${res.counted}`,
          { icon: "⚠️", duration: 6000, style: { background: "#451a03", color: "#fbbf24", border: "1px solid #92400e" } });
      }
      setResolveFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/stock-checks/${id}`).then(r => r.data),
    onSuccess: () => {
      toast.success(en ? "Flag deleted" : "Signalement supprimé");
      setDeleteFor(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec")),
  });

  const rows = Array.isArray(list.data) ? list.data : [];
  const watchList = Array.isArray(watches.data) ? watches.data : [];

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
        {isOwner && (
          <button onClick={() => setShowWatch(true)} className="btn btn-primary" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
            ➕ {en ? "Watch a product" : "Surveiller un produit"}
          </button>
        )}
      </div>

      {/* Watched products — persistent boss oversight. Owner adds/removes; every
          movement of a watched product into its location auto-creates a check. */}
      <WatchedSection watchList={watchList} loading={watches.isLoading} en={en} isOwner={isOwner}
        onRemoved={() => qc.invalidateQueries({ queryKey: ["stock-check-watches"] })} />

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
                    <span>{flaggedLabel(r.flagged_by, en)}</span>
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
                  <div style={{ display: "flex", gap: 8, alignSelf: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={() => setResolveFor(r)} className="btn btn-success" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                      {en ? "Resolve count" : "Résoudre"}
                    </button>
                    {isOwner && (
                      <button onClick={() => setDeleteFor(r)} title={en ? "Delete this flag (no count)" : "Supprimer ce signalement"}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", color: "#f87171", fontWeight: 700, padding: "0 12px", whiteSpace: "nowrap" }}>
                        🗑 {en ? "Delete" : "Supprimer"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {resolveFor && (
        <ResolveModal row={resolveFor} en={en} busy={resolveMut.isPending}
          onCancel={() => setResolveFor(null)}
          onResolve={(counted_qty, resolution) => resolveMut.mutate({ id: resolveFor.id, counted_qty, resolution })} />
      )}

      {deleteFor && (
        <ConfirmDeleteModal row={deleteFor} en={en} busy={deleteMut.isPending}
          onCancel={() => setDeleteFor(null)} onConfirm={() => deleteMut.mutate(deleteFor.id)} />
      )}

      {showWatch && <WatchProductModal en={en} onClose={() => setShowWatch(false)}
        onAdded={() => { setShowWatch(false); qc.invalidateQueries({ queryKey: ["stock-check-watches"] }); }} />}
    </div>
  );
}

// Watched-products section — product · location · who · when, owner-only Remove.
function WatchedSection({ watchList, loading, en, isOwner, onRemoved }) {
  const [removing, setRemoving] = useState(null);
  const remove = async (w) => {
    setRemoving(w.id);
    try {
      await api.delete(`/stock-checks/watches/${w.id}`);
      toast.success(en ? "Stopped watching" : "Surveillance arrêtée");
      onRemoved();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
    } finally { setRemoving(null); }
  };
  if (loading) return null;
  if (!watchList.length) return null;
  return (
    <div style={{ marginTop: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-secondary)" }}>
        👁 {en ? "Watched products" : "Produits surveillés"}
        <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11.5 }}>
          {en ? "auto-checked on every movement into their location" : "auto-vérifiés à chaque mouvement vers leur emplacement"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {watchList.map(w => {
          const p = w.pa_products || {};
          const loc = w.pa_locations || {};
          return (
            <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--bg-elevated)", borderRadius: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{en ? (p.name_en || p.name) : p.name}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>📍 {loc.name || "—"}</span>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {w.created_by_name ? `${en ? "by" : "par"} ${w.created_by_name} · ` : ""}{fmtDate(w.created_at, en)}
                </div>
              </div>
              {isOwner && (
                <button onClick={() => remove(w)} disabled={removing === w.id}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textDecoration: "underline", whiteSpace: "nowrap" }}>
                  {removing === w.id ? "…" : (en ? "Remove" : "Retirer")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Resolve a pending check: enter the physical count, then ✓ Done (verified, wiped
// from the list — with a confirm warning) or ⚠ Mismatch (kept forever as the trail).
function ResolveModal({ row, en, onCancel, onResolve, busy }) {
  const p = row.pa_products || {};
  const expected = Number(row.qty_expected) || 0;
  const [value, setValue] = useState("");
  const [confirmDone, setConfirmDone] = useState(false);
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 0 && value !== "";
  const matches = valid && n === expected;

  const goMismatch = () => { if (!valid) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; } onResolve(n, "mismatch"); };
  const goDone = () => { if (!valid) { toast.error(en ? "Enter a valid count" : "Entrez un comptage valide"); return; } setConfirmDone(true); };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Resolve count" : "Résoudre le comptage"}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
          {en ? (p.name_en || p.name) : p.name} · {(row.pa_locations || {}).name}
        </div>

        {!confirmDone ? (
          <>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
              {en ? "How many did you physically count?" : "Combien avez-vous physiquement compté ?"}
            </label>
            <input className="input" type="number" min="0" autoFocus value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && goDone()} placeholder={en ? "Counted quantity" : "Quantité comptée"} style={{ marginTop: 6 }} />
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
              {en ? `System expects ${expected}.` : `Le système attend ${expected}.`}
              {valid && !matches && <span style={{ color: "#fbbf24" }}> {en ? `Off by ${n - expected > 0 ? "+" : ""}${n - expected}.` : `Écart de ${n - expected > 0 ? "+" : ""}${n - expected}.`}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
              <button className="btn" style={{ flex: 1.4, background: "#92400e", color: "#fde68a", fontWeight: 700 }} disabled={busy} onClick={goMismatch}>
                ⚠ {en ? "Mismatch" : "Écart"}
              </button>
              <button className="btn btn-success" style={{ flex: 1.4, fontWeight: 700 }} disabled={busy} onClick={goDone}>
                ✓ {en ? "Done" : "Fait"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, padding: 12 }}>
              {matches
                ? (en ? `Count matches (${expected}). Marking this Done removes it from the list.`
                      : `Le comptage correspond (${expected}). Marquer « Fait » le retire de la liste.`)
                : (en ? `Counted ${n} vs expected ${expected}. Marking Done anyway will accept it as OK and remove it from the list — it will NOT be recorded as a mismatch. Continue?`
                      : `Compté ${n} contre ${expected} attendu. Marquer « Fait » quand même l'accepte et le retire de la liste — il ne sera PAS enregistré comme écart. Continuer ?`)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={() => setConfirmDone(false)}>{en ? "Back" : "Retour"}</button>
              <button className="btn btn-success" style={{ flex: 2, fontWeight: 700 }} disabled={busy} onClick={() => onResolve(n, "done")}>
                {busy ? "…" : (en ? "✓ Confirm Done" : "✓ Confirmer")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Owner-only: delete a PENDING flag without counting (a false flag / duplicate).
function ConfirmDeleteModal({ row, en, onCancel, onConfirm, busy }) {
  const p = row.pa_products || {};
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{en ? "Delete this flag?" : "Supprimer ce signalement ?"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
          {en
            ? `This removes the pending check for "${p.name_en || p.name}" without counting it. Use this only for a false flag or a duplicate — it can't be undone.`
            : `Cela retire la vérification en attente pour « ${p.name} » sans la compter. À n'utiliser que pour un faux signalement ou un doublon — irréversible.`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn" style={{ flex: 1.6, background: "#7f1d1d", color: "#fecaca", fontWeight: 700 }} disabled={busy} onClick={onConfirm}>
            {busy ? "…" : (en ? "🗑 Delete flag" : "🗑 Supprimer")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Owner-only: watch a product (fuzzy search via search_products_fuzzy, kit parents
// excluded) at a chosen location. Persists to pa_stock_check_watches → every future
// movement of it into that location auto-creates a check.
function WatchProductModal({ en, onClose, onAdded }) {
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
      await api.post("/stock-checks/watches", { product_id: picked.id, location_id: locId });
      toast.success(en ? "Now watching this product" : "Produit maintenant surveillé");
      onAdded();
    } catch (e) {
      toast.error(e?.response?.data?.message || (en ? "Failed" : "Échec"));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{en ? "Watch a product" : "Surveiller un produit"}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {en
            ? "Every receive/transfer of this product into the chosen location will be auto-flagged for a re-count."
            : "Chaque réception/transfert de ce produit vers l'emplacement choisi sera auto-signalé pour un recomptage."}
        </div>

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
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{en ? "Location to watch" : "Emplacement à surveiller"}</label>
            <select className="input" value={locId} onChange={e => setLocId(e.target.value)} style={{ marginTop: 6 }}>
              <option value="">{en ? "— pick a location —" : "— choisir un emplacement —"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !picked || !locId} onClick={add}>
            {busy ? "…" : (en ? "➕ Watch this product" : "➕ Surveiller")}
          </button>
        </div>
      </div>
    </div>
  );
}
