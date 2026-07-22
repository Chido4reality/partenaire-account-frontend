// MP-GOODS-BUFFER — pre-register arrived goods (quantity only, NO price). Any staff member
// captures what landed; the boss (or a permitted staffer) later prices it and RELEASES it
// into inventory, splitting the quantity across locations. Until release, buffer goods are
// a display flag only — never stock, never sellable, never in reports/alerts.
//
// This screen references only the product CATALOGUE (to identify a product) — it has no
// view of stock. Non-privileged staff never see a price field and never send price params;
// the release RPC is the real gate.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import ProductSearchBox from "../components/common/ProductSearchBox";
import { openWhatsApp } from "../utils/whatsapp";

const genLocalId = () => {
  try { return crypto.randomUUID(); } catch { return `gb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`; }
};
const toArr = (r) => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);
const num = (x) => Number(x) || 0;

const STATUS_LABEL = {
  pending:  { en: "Pending",   fr: "En attente" },
  partial:  { en: "Partial",   fr: "Partiel" },
  released: { en: "Released",  fr: "Libéré" },
  closed:   { en: "Closed",    fr: "Clôturé" },
};
const STATUS_COLOR = { pending: "#fbbf24", partial: "#60a5fa", released: "#34d399", closed: "#94a3b8" };
const errMsg = (e, en) => (en ? e?.response?.data?.message_en : e?.response?.data?.message_fr)
  || e?.response?.data?.message || (en ? "Something went wrong." : "Une erreur est survenue.");

export default function GoodsBufferPage() {
  const en = useLangStore(s => s.lang) === "en";
  const lang = en ? "en" : "fr";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const org = useAuthStore(s => s.org);
  const selectedLocation = useSettingsStore(s => s.selectedLocation);
  const meName = user?.full_name || user?.name || null;

  const [locFilter, setLocFilter] = useState(""); // "" = all locations

  // ── Queries ──────────────────────────────────────────────────
  const pendingQ = useQuery({
    queryKey: ["goods-buffer-pending", locFilter],
    queryFn: () => api.get(`/goods-buffer/pending${locFilter ? `?location_id=${locFilter}` : ""}`).then(toArr),
    refetchInterval: 30000,
  });
  const accessQ = useQuery({
    queryKey: ["goods-buffer-access"],
    queryFn: () => api.get("/goods-buffer/access").then(r => r.data?.data || { can_release: false }),
    staleTime: 60000,
  });
  const locsQ = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then(r => r.data) });
  const locList = Array.isArray(locsQ.data?.data) ? locsQ.data.data : [];
  const locName = (id) => locList.find(l => l.id === id)?.name || "";
  const canRelease = !!accessQ.data?.can_release;
  const pending = pendingQ.data || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["goods-buffer-pending"] });
    qc.invalidateQueries({ queryKey: ["goods-buffer-count"] });
  };

  // ── Add-entry form ───────────────────────────────────────────
  const [addNew, setAddNew] = useState(false); // false = pick from catalogue, true = stage a new name
  const [picked, setPicked] = useState(null);   // {id, name} from catalogue
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [addLoc, setAddLoc] = useState(selectedLocation?.id || "");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");

  const resetAdd = () => {
    setPicked(null); setNewName(""); setNewUnit(""); setNewBarcode("");
    setQty(""); setSupplier(""); setNote("");
  };

  const createMut = useMutation({
    mutationFn: (body) => api.post("/goods-buffer", body).then(r => r.data),
    onSuccess: (r) => {
      const dup = r?.data?.duplicate;
      toast.success(dup ? (en ? "Already registered" : "Déjà enregistré")
                        : (en ? "Registered ✓" : "Enregistré ✓"));
      resetAdd(); invalidate();
    },
    onError: (e) => toast.error(errMsg(e, en)),
  });

  const submitAdd = () => {
    const q = num(qty);
    if (q <= 0) return toast.error(en ? "Enter a quantity" : "Entrez une quantité");
    if (addNew) {
      if (!newName.trim()) return toast.error(en ? "Enter the product name" : "Entrez le nom du produit");
    } else if (!picked) {
      return toast.error(en ? "Choose a product" : "Choisissez un produit");
    }
    createMut.mutate({
      qty: q,
      product_id: addNew ? null : picked.id,
      new_product_name: addNew ? newName.trim() : null,
      new_product_unit: addNew ? (newUnit.trim() || null) : null,
      barcode: addNew ? (newBarcode.trim() || null) : null,
      location_id: addLoc || null,
      supplier_name: supplier.trim() || null,
      note: note.trim() || null,
      local_id: genLocalId(),
    });
  };

  // ── Row actions: release / close / edit / delete ─────────────
  const [releaseFor, setReleaseFor] = useState(null);
  const [closeFor, setCloseFor] = useState(null);
  const [editFor, setEditFor] = useState(null);

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/goods-buffer/${id}`, { data: { reason: "removed by staff" } }).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Removed" : "Supprimé"); invalidate(); },
    onError: (e) => toast.error(errMsg(e, en)),
  });

  // ── WhatsApp: compose the pending list and share to the shop's number ──
  const sendWhatsApp = () => {
    const phone = String(org?.whatsapp_number || "").replace(/\D/g, "");
    if (!phone) return toast.error(en ? "No shop WhatsApp number set (Settings)" : "Aucun numéro WhatsApp (Réglages)");
    if (!pending.length) return toast.error(en ? "Nothing pending" : "Rien en attente");
    const lines = pending.map(r =>
      `• ${r.product_label} — ${num(r.qty_remaining)}${r.qty_released > 0 ? `/${num(r.qty_received)}` : ""}` +
      `${r.location_name ? ` @ ${r.location_name}` : ""}${r.created_by_name ? ` (${r.created_by_name})` : ""}`);
    const header = en ? `Goods waiting to be added to stock — ${org?.name || ""}`
                      : `Marchandises en attente d'ajout au stock — ${org?.name || ""}`;
    openWhatsApp(null, phone, `${header}\n${lines.join("\n")}`);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 4px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "10px 0 4px" }}>
        <h2 style={{ margin: 0 }}>{en ? "Goods Buffer" : "Zone tampon"}</h2>
        <button className="btn btn-secondary" onClick={sendWhatsApp} title="WhatsApp">💬 {en ? "Share" : "Partager"}</button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 0 }}>
        {en ? "Arrived but not yet in stock. Register what landed (quantity only). The boss prices it and adds it to inventory."
            : "Arrivé mais pas encore en stock. Enregistrez ce qui est arrivé (quantité seulement). Le patron fixe le prix et l'ajoute à l'inventaire."}
      </p>

      {/* ── B. ADD ENTRY (all staff) ── */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className={`btn ${!addNew ? "btn-primary" : "btn-secondary"}`} style={{ flex: 1 }} onClick={() => { setAddNew(false); setPicked(null); }}>
            {en ? "Find product" : "Trouver un produit"}
          </button>
          <button className={`btn ${addNew ? "btn-primary" : "btn-secondary"}`} style={{ flex: 1 }} onClick={() => { setAddNew(true); setPicked(null); }}>
            + {en ? "New product" : "Nouveau produit"}
          </button>
        </div>

        {!addNew ? (
          picked ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 10 }}>
              <strong>{picked.name}</strong>
              <button className="btn btn-secondary" onClick={() => setPicked(null)}>{en ? "Change" : "Changer"}</button>
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <ProductSearchBox lang={lang} placeholder={en ? "Search product…" : "Rechercher un produit…"}
                onSelect={(p) => setPicked({ id: p.id, name: p.name })} clearOnSelect />
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder={en ? "New product name *" : "Nom du nouveau produit *"} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" style={{ flex: 1 }} value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder={en ? "Unit (pcs, kg, carton…)" : "Unité (pce, kg, carton…)"} />
              <input className="input" style={{ flex: 1 }} value={newBarcode} onChange={e => setNewBarcode(e.target.value)} placeholder={en ? "Barcode (optional)" : "Code-barres (facultatif)"} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {en ? "No price here — the boss sets the price when adding it to stock."
                  : "Pas de prix ici — le patron fixe le prix au moment de l'ajout au stock."}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input className="input" style={{ flex: 1 }} type="number" inputMode="numeric" min="0" value={qty}
            onChange={e => setQty(e.target.value)} placeholder={en ? "Quantity *" : "Quantité *"} />
          <select className="input" style={{ flex: 1.4 }} value={addLoc} onChange={e => setAddLoc(e.target.value)}>
            <option value="">{en ? "Where it landed" : "Où c'est arrivé"}</option>
            {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input className="input" style={{ flex: 1 }} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={en ? "Supplier (optional)" : "Fournisseur (facultatif)"} />
          <input className="input" style={{ flex: 1 }} value={note} onChange={e => setNote(e.target.value)} placeholder={en ? "Note (optional)" : "Note (facultatif)"} />
        </div>
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={createMut.isPending} onClick={submitAdd}>
          {createMut.isPending ? "…" : (en ? "Register arrival" : "Enregistrer l'arrivée")}
        </button>
      </div>

      {/* ── A. LIST (all staff) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{en ? "Waiting to be added to stock" : "En attente d'ajout au stock"}</strong>
        <select className="input" style={{ width: 180 }} value={locFilter} onChange={e => setLocFilter(e.target.value)}>
          <option value="">{en ? "All locations" : "Tous les sites"}</option>
          {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {pendingQ.isLoading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>
      ) : pendingQ.isError ? (
        <div style={{ padding: 20, textAlign: "center", color: "#f87171" }}>{en ? "Could not load." : "Échec du chargement."}</div>
      ) : pending.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>{en ? "Nothing waiting." : "Rien en attente."}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {pending.map((r, i) => {
            const isMine = meName && r.created_by_name && r.created_by_name === meName;
            const editable = isMine && num(r.qty_released) === 0 && r.status === "pending";
            const releasable = canRelease && (r.status === "pending" || r.status === "partial") && num(r.qty_remaining) > 0;
            return (
              <div key={r.buffer_id} style={{ padding: "11px 13px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                      {r.product_label}
                      {r.is_new_product ? <span style={{ fontSize: 11, color: "#60a5fa", marginLeft: 6 }}>{en ? "NEW" : "NOUVEAU"}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {[r.location_name, r.created_by_name,
                        r.created_at ? new Date(r.created_at).toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "short" }) : null
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{num(r.qty_remaining)}
                      {num(r.qty_released) > 0 ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}> / {num(r.qty_received)}</span> : null}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[r.status] || "var(--text-muted)" }}>
                      {(STATUS_LABEL[r.status] || {})[en ? "en" : "fr"] || r.status}
                    </span>
                  </div>
                </div>
                {(releasable || editable) && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {releasable && (
                      <button className="btn btn-primary" style={{ flex: 1, minWidth: 130 }} onClick={() => setReleaseFor(r)}>
                        ➕ {en ? "Add to inventory" : "Ajouter au stock"}
                      </button>
                    )}
                    {releasable && (
                      <button className="btn btn-secondary" onClick={() => setCloseFor(r)}>{en ? "Close" : "Clôturer"}</button>
                    )}
                    {editable && <button className="btn btn-secondary" onClick={() => setEditFor(r)}>{en ? "Edit" : "Modifier"}</button>}
                    {editable && (
                      <button className="btn" style={{ color: "#f87171", border: "1px solid var(--border)", background: "transparent" }}
                        onClick={() => { if (confirm(en ? "Remove this entry?" : "Supprimer cette entrée ?")) deleteMut.mutate(r.buffer_id); }}>
                        {en ? "Delete" : "Supprimer"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {releaseFor && (
        <ReleaseModal row={releaseFor} en={en} lang={lang} fmt={fmt} locList={locList}
          onClose={() => setReleaseFor(null)} onDone={() => { setReleaseFor(null); invalidate(); }} />
      )}
      {closeFor && (
        <CloseModal row={closeFor} en={en} onClose={() => setCloseFor(null)} onDone={() => { setCloseFor(null); invalidate(); }} />
      )}
      {editFor && (
        <EditModal row={editFor} en={en} locList={locList} onClose={() => setEditFor(null)} onDone={() => { setEditFor(null); invalidate(); }} />
      )}
    </div>
  );
}

// ── C. RELEASE PANEL (privileged) ───────────────────────────────
function ReleaseModal({ row, en, lang, fmt, locList, onClose, onDone }) {
  const remaining = num(row.qty_remaining);
  const [sell, setSell] = useState("");
  const [cost, setCost] = useState("");
  const [min, setMin] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [mergeProduct, setMergeProduct] = useState(null); // {id,name} for a staged NEW product
  const [rows, setRows] = useState([{ location_id: "", quantity: "" }]);

  const assigned = rows.reduce((s, r) => s + num(r.quantity), 0);
  const left = remaining - assigned;
  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));

  const mut = useMutation({
    mutationFn: (body) => api.post(`/goods-buffer/${row.buffer_id}/release`, body).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Added to inventory ✓" : "Ajouté au stock ✓"); onDone(); },
    onError: (e) => toast.error(errMsg(e, en)),
  });

  const submit = () => {
    const assignments = rows
      .filter(r => r.location_id && num(r.quantity) > 0)
      .map(r => ({ location_id: r.location_id, quantity: num(r.quantity) }));
    if (!assignments.length) return toast.error(en ? "Add at least one location + quantity" : "Ajoutez au moins un site + une quantité");
    if (assigned > remaining) return toast.error(en ? "That's more than what's left" : "C'est plus que ce qui reste");
    if (num(sell) <= 0) return toast.error(en ? "Set a selling price" : "Fixez un prix de vente");
    mut.mutate({
      assignments,
      sell_price: num(sell), cost_price: sell !== "" ? num(cost) : null,
      min_price: min !== "" ? num(min) : null, wholesale_price: wholesale !== "" ? num(wholesale) : null,
      merge_product_id: (row.is_new_product && mergeProduct) ? mergeProduct.id : null,
      invoice_ref: invoiceRef.trim() || null,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>{en ? "Add to inventory" : "Ajouter au stock"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
          {row.product_label} — {remaining} {en ? "to release" : "à libérer"}
        </div>

        {row.is_new_product && (
          <div style={{ marginBottom: 12, padding: 10, border: "1px dashed var(--border)", borderRadius: 8 }}>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>
              {en ? "New product — creates a fresh catalogue item, OR merge into an existing one:" : "Nouveau produit — crée un article, OU fusionnez dans un existant :"}
            </div>
            {mergeProduct ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{en ? "Merge into" : "Fusionner dans"}: <strong>{mergeProduct.name}</strong></span>
                <button className="btn btn-secondary" onClick={() => setMergeProduct(null)}>{en ? "Cancel" : "Annuler"}</button>
              </div>
            ) : (
              <ProductSearchBox lang={lang} placeholder={en ? "Merge into existing product… (optional)" : "Fusionner dans un produit existant… (facultatif)"}
                onSelect={(p) => setMergeProduct({ id: p.id, name: p.name })} clearOnSelect />
            )}
          </div>
        )}

        {/* Prices — owner/privileged only ever reach this modal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <PriceInput label={en ? "Selling price *" : "Prix de vente *"} value={sell} onChange={setSell} sym={fmt.symbol} />
          <PriceInput label={en ? "Cost price" : "Prix d'achat"} value={cost} onChange={setCost} sym={fmt.symbol} />
          <PriceInput label={en ? "Min price" : "Prix min"} value={min} onChange={setMin} sym={fmt.symbol} />
          <PriceInput label={en ? "Wholesale" : "Gros"} value={wholesale} onChange={setWholesale} sym={fmt.symbol} />
        </div>

        {/* Multi-location split */}
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{en ? "Split across locations" : "Répartir sur les sites"}</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <select className="input" style={{ flex: 1.6 }} value={r.location_id} onChange={e => setRow(i, { location_id: e.target.value })}>
              <option value="">{en ? "Location" : "Site"}</option>
              {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input className="input" style={{ flex: 1 }} type="number" inputMode="numeric" min="0" value={r.quantity}
              onChange={e => setRow(i, { quantity: e.target.value })} placeholder={en ? "Qty" : "Qté"} />
            {rows.length > 1 && <button className="btn btn-secondary" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button className="btn btn-secondary" style={{ marginBottom: 10 }} onClick={() => setRows(rs => [...rs, { location_id: "", quantity: "" }])}>
          + {en ? "Another location" : "Autre site"}
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 10,
                      color: left < 0 ? "#f87171" : "var(--text-secondary)" }}>
          <span>{en ? "Assigned" : "Réparti"}: {assigned} / {remaining}</span>
          <span>{en ? "Left" : "Reste"}: {left}</span>
        </div>

        <input className="input" style={{ marginBottom: 10 }} value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)}
          placeholder={en ? "Invoice ref (optional)" : "Réf. facture (facultatif)"} />

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={mut.isPending || left < 0 || assigned === 0 || num(sell) <= 0} onClick={submit}>
            {mut.isPending ? "…" : (en ? "Add to inventory" : "Ajouter au stock")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceInput({ label, value, onChange, sym }) {
  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="label" style={{ fontSize: 11.5 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input className="input" type="number" inputMode="decimal" min="0" value={value} onChange={e => onChange(e.target.value)} placeholder="0" />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sym}</span>
      </div>
    </div>
  );
}

// ── D. CLOSE REMAINDER (privileged), reason required ────────────
function CloseModal({ row, en, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: () => api.post(`/goods-buffer/${row.buffer_id}/close`, { reason: reason.trim() }).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Closed" : "Clôturé"); onDone(); },
    onError: (e) => toast.error(errMsg(e, en)),
  });
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{en ? "Close remainder" : "Clôturer le reste"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
          {row.product_label} — {num(row.qty_remaining)} {en ? "will be dropped (not added to stock)." : "seront abandonnés (non ajoutés au stock)."}
        </div>
        <div className="form-group">
          <label className="label">{en ? "Reason (required)" : "Raison (obligatoire)"}</label>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={en ? "e.g. never delivered, wrong entry" : "ex. jamais livré, erreur de saisie"} autoFocus />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={mut.isPending || !reason.trim()} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : (en ? "Close" : "Clôturer")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit own pending line (adjust) ──────────────────────────────
function EditModal({ row, en, locList, onClose, onDone }) {
  const [qty, setQty] = useState(String(num(row.qty_received)));
  const [note, setNote] = useState("");
  const [supplier, setSupplier] = useState("");
  const [loc, setLoc] = useState(row.landed_location_id || "");
  const [name, setName] = useState(row.is_new_product ? row.product_label : "");
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: () => api.post(`/goods-buffer/${row.buffer_id}/adjust`, {
      new_qty: num(qty), reason: reason.trim() || "edit",
      new_note: note.trim() || null, new_supplier_name: supplier.trim() || null,
      new_location_id: loc || null, new_product_name: (row.is_new_product && name.trim()) ? name.trim() : null,
    }).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Saved" : "Enregistré"); onDone(); },
    onError: (e) => toast.error(errMsg(e, en)),
  });
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>{en ? "Edit entry" : "Modifier l'entrée"}</div>
        {row.is_new_product && (
          <div className="form-group"><label className="label">{en ? "Product name" : "Nom du produit"}</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
        )}
        <div className="form-group"><label className="label">{en ? "Quantity" : "Quantité"}</label>
          <input className="input" type="number" inputMode="numeric" min="0" value={qty} onChange={e => setQty(e.target.value)} /></div>
        <div className="form-group"><label className="label">{en ? "Location" : "Site"}</label>
          <select className="input" value={loc} onChange={e => setLoc(e.target.value)}>
            <option value="">{en ? "—" : "—"}</option>
            {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ flex: 1 }} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={en ? "Supplier" : "Fournisseur"} />
          <input className="input" style={{ flex: 1 }} value={note} onChange={e => setNote(e.target.value)} placeholder={en ? "Note" : "Note"} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }} disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "…" : (en ? "Save" : "Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}
