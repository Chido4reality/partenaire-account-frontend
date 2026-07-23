// MP-GOODS-BUFFER — pre-register arrived goods (quantity only, NO price). Any staff member
// captures what landed; the boss (or a permitted staffer) later prices it and RELEASES it
// into inventory, splitting the quantity across locations. Until release, buffer goods are
// a display flag only — never stock, never sellable, never in reports/alerts.
//
// This screen references only the product CATALOGUE (to identify a product) — it has no
// view of stock. Non-privileged staff never see a price field and never send price params;
// the release RPC is the real gate.

import { useState, useMemo, useEffect } from "react";
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
// Client-side candidate codes — unique-enough; the RPC rejects SKU_TAKEN / BARCODE_TAKEN
// on the rare collision so the user just regenerates.
const genSku = () => `SKU-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 46655).toString(36).toUpperCase().padStart(3, "0")}`;
const genBarcode = () => { let s = "2"; for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10); return s; }; // 12-digit, internal-use prefix
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
            <input className="input" value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder={en ? "Unit (pcs, kg, carton…)" : "Unité (pce, kg, carton…)"} />
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" style={{ flex: 1 }} value={newBarcode} onChange={e => setNewBarcode(e.target.value)} placeholder={en ? "Barcode (optional)" : "Code-barres (facultatif)"} />
              <button type="button" className="btn btn-secondary" onClick={() => setNewBarcode(genBarcode())}>{en ? "Generate" : "Générer"}</button>
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
            // Own-line gate by created_by ID (shared branch logins mean full_names
            // collide/blank — name-match would offer Edit/Delete on someone else's line).
            // created_by_name stays for DISPLAY only. RPC NOT_YOUR_BUFFER_LINE is the real guard.
            const isMine = !!(r.created_by && user?.id && r.created_by === user.id);
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

// ── Reusable multi-location split editor (parent split + each kit part's split) ──
function SplitRows({ rows, setRows, locList, en }) {
  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <select className="input" style={{ flex: 1.6 }} value={r.location_id} onChange={e => setRow(i, { location_id: e.target.value })}>
            <option value="">{en ? "Location" : "Site"}</option>
            {locList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input className="input" style={{ flex: 1 }} type="number" inputMode="numeric" min="0" value={r.quantity}
            onChange={e => setRow(i, { quantity: e.target.value })} placeholder={en ? "Qty" : "Qté"} />
          {rows.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button type="button" className="btn btn-secondary" style={{ marginBottom: 8, fontSize: 12 }}
        onClick={() => setRows(rs => [...rs, { location_id: "", quantity: "" }])}>
        + {en ? "Another location" : "Autre site"}
      </button>
    </>
  );
}

// ── One kit part: existing product OR new inline part + qty-per-unit + its own split ──
function PartRow({ part, onChange, onRemove, locList, en, lang }) {
  const setSplit = (updater) => onChange({ ...part, assignments: typeof updater === "function" ? updater(part.assignments) : updater });
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className={`btn ${part.mode === "existing" ? "btn-primary" : "btn-secondary"}`} style={{ fontSize: 11, padding: "4px 8px" }}
            onClick={() => onChange({ ...part, mode: "existing", new_name: "", new_unit: "" })}>{en ? "Existing" : "Existant"}</button>
          <button type="button" className={`btn ${part.mode === "new" ? "btn-primary" : "btn-secondary"}`} style={{ fontSize: 11, padding: "4px 8px" }}
            onClick={() => onChange({ ...part, mode: "new", product: null })}>{en ? "New part" : "Nouvelle pièce"}</button>
        </div>
        <button type="button" className="btn btn-secondary" style={{ fontSize: 11 }} onClick={onRemove}>✕</button>
      </div>

      {part.mode === "existing" ? (
        part.product ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>{part.product.name}</strong>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => onChange({ ...part, product: null })}>{en ? "Change" : "Changer"}</button>
          </div>
        ) : (
          <div style={{ marginBottom: 6 }}>
            <ProductSearchBox lang={lang} placeholder={en ? "Find the part product…" : "Trouver la pièce…"}
              onSelect={(p) => onChange({ ...part, product: { id: p.id, name: p.name } })} clearOnSelect />
          </div>
        )
      ) : (
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input className="input" style={{ flex: 1.6 }} value={part.new_name} onChange={e => onChange({ ...part, new_name: e.target.value })} placeholder={en ? "New part name *" : "Nom de la pièce *"} />
          <input className="input" style={{ flex: 1 }} value={part.new_unit} onChange={e => onChange({ ...part, new_unit: e.target.value })} placeholder={en ? "Unit" : "Unité"} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{en ? "Qty per kit" : "Qté par kit"}</span>
        <input className="input" style={{ width: 90 }} type="number" inputMode="numeric" min="0" value={part.qty_per_unit}
          onChange={e => onChange({ ...part, qty_per_unit: e.target.value })} placeholder="1" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>{en ? "Quantity arrived — split across locations:" : "Quantité arrivée — répartir sur les sites :"}</div>
      <SplitRows rows={part.assignments} setRows={setSplit} locList={locList} en={en} />
    </div>
  );
}

// ── C. RELEASE PANEL (privileged) ───────────────────────────────
function ReleaseModal({ row, en, lang, fmt, locList, onClose, onDone }) {
  const remaining = num(row.qty_remaining);
  const isNew = !!row.is_new_product;
  const [sell, setSell] = useState("");
  const [cost, setCost] = useState("");
  const [min, setMin] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [mergeProduct, setMergeProduct] = useState(null); // {id,name} for a staged NEW product
  const [rows, setRows] = useState([{ location_id: "", quantity: "" }]);
  const [sku, setSku] = useState("");         // NEW product only
  const [barcode, setBarcode] = useState(""); // NEW product only
  const [kit, setKit] = useState(false);
  const [parts, setParts] = useState([]);     // kit parts
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Prefill: EXISTING product → its current prices (a blank re-save would overwrite the
  // real price). NEW product → generate an SKU + prefill the barcode staff scanned at add.
  useEffect(() => {
    let alive = true;
    api.get(`/goods-buffer/${row.buffer_id}/release-info`).then(r => r.data?.data || null)
      .then(info => {
        if (!alive) return;
        if (info && !info.is_new_product && info.product) {
          const p = info.product;
          setSell(p.sell_price != null ? String(p.sell_price) : "");
          setCost(p.cost_price != null ? String(p.cost_price) : "");
          setMin(p.min_price != null ? String(p.min_price) : "");
          setWholesale(p.wholesale_price != null ? String(p.wholesale_price) : "");
        } else if (info && info.is_new_product) {
          setSku(genSku());
          setBarcode(info.buffer_barcode || genBarcode());
        }
        setLoadingInfo(false);
      })
      .catch(() => { if (alive) { if (isNew) { setSku(genSku()); setBarcode(genBarcode()); } setLoadingInfo(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assigned = rows.reduce((s, r) => s + num(r.quantity), 0);
  const left = remaining - assigned;
  const prices = () => ({
    sell_price: num(sell),
    cost_price: cost !== "" ? num(cost) : null,   // null (not 0) so a blank never overwrites a real price
    min_price: min !== "" ? num(min) : null,
    wholesale_price: wholesale !== "" ? num(wholesale) : null,
  });
  const newCodes = () => (isNew ? { sku: sku.trim() || null, barcode: barcode.trim() || null } : {});

  const mut = useMutation({
    mutationFn: (body) => api.post(`/goods-buffer/${row.buffer_id}/release`, body).then(r => r.data),
    onSuccess: () => { toast.success(en ? "Added to inventory ✓" : "Ajouté au stock ✓"); onDone(); },
    onError: (e) => toast.error(errMsg(e, en)),
  });

  const submit = () => {
    if (num(sell) <= 0) return toast.error(en ? "Set a selling price" : "Fixez un prix de vente");
    if (kit) {
      // Kit: the parent holds the price + ZERO stock; the arrival lands on the PARTS.
      const kitParts = parts
        .map(p => {
          const idBit = p.mode === "existing" ? (p.product ? { part_product_id: p.product.id } : null)
                                              : (p.new_name.trim() ? { new_part_name: p.new_name.trim(), unit: p.new_unit.trim() || null } : null);
          if (!idBit) return null;
          const asg = p.assignments.filter(a => a.location_id && num(a.quantity) > 0).map(a => ({ location_id: a.location_id, quantity: num(a.quantity) }));
          if (!asg.length || num(p.qty_per_unit) <= 0) return null;
          return { ...idBit, quantity_per_unit: num(p.qty_per_unit), assignments: asg };
        })
        .filter(Boolean);
      if (!kitParts.length) return toast.error(en ? "Add at least one part with qty-per-kit + a location" : "Ajoutez au moins une pièce avec qté/kit + un site");
      mut.mutate({ kit_parts: kitParts, ...prices(), ...newCodes(),
        merge_product_id: (isNew && mergeProduct) ? mergeProduct.id : null, invoice_ref: invoiceRef.trim() || null });
      return;
    }
    const assignments = rows.filter(r => r.location_id && num(r.quantity) > 0).map(r => ({ location_id: r.location_id, quantity: num(r.quantity) }));
    if (!assignments.length) return toast.error(en ? "Add at least one location + quantity" : "Ajoutez au moins un site + une quantité");
    if (assigned > remaining) return toast.error(en ? "That's more than what's left" : "C'est plus que ce qui reste");
    mut.mutate({ assignments, ...prices(), ...newCodes(),
      merge_product_id: (isNew && mergeProduct) ? mergeProduct.id : null, invoice_ref: invoiceRef.trim() || null });
  };

  const addPart = () => setParts(ps => [...ps, { mode: "existing", product: null, new_name: "", new_unit: "", qty_per_unit: "1", assignments: [{ location_id: "", quantity: "" }] }]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>{en ? "Add to inventory" : "Ajouter au stock"}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
          {row.product_label} — {remaining} {en ? "to release" : "à libérer"}
          {loadingInfo ? <span style={{ color: "var(--text-muted)" }}> · {en ? "loading prices…" : "chargement des prix…"}</span> : null}
        </div>

        {/* NEW product: SKU + barcode (generated, editable, optional) + merge option */}
        {isNew && (
          <div style={{ marginBottom: 12, padding: 10, border: "1px dashed var(--border)", borderRadius: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input className="input" value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU" />
              <button type="button" className="btn btn-secondary" onClick={() => setSku(genSku())}>{en ? "Generate SKU" : "Générer SKU"}</button>
              <input className="input" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder={en ? "Barcode" : "Code-barres"} />
              <button type="button" className="btn btn-secondary" onClick={() => setBarcode(genBarcode())}>{en ? "Generate barcode" : "Générer code-barres"}</button>
            </div>
            {mergeProduct ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{en ? "Merge into" : "Fusionner dans"}: <strong>{mergeProduct.name}</strong></span>
                <button type="button" className="btn btn-secondary" onClick={() => setMergeProduct(null)}>{en ? "Cancel" : "Annuler"}</button>
              </div>
            ) : (
              <ProductSearchBox lang={lang} placeholder={en ? "…or merge into an existing product (optional)" : "…ou fusionner dans un produit existant (facultatif)"}
                onSelect={(p) => setMergeProduct({ id: p.id, name: p.name })} clearOnSelect />
            )}
          </div>
        )}

        {/* Prices — apply to the product, or the KIT PARENT in kit mode */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <PriceInput label={en ? "Selling price *" : "Prix de vente *"} value={sell} onChange={setSell} sym={fmt.symbol} />
          <PriceInput label={en ? "Cost price" : "Prix d'achat"} value={cost} onChange={setCost} sym={fmt.symbol} />
          <PriceInput label={en ? "Min price" : "Prix min"} value={min} onChange={setMin} sym={fmt.symbol} />
          <PriceInput label={en ? "Wholesale" : "Gros"} value={wholesale} onChange={setWholesale} sym={fmt.symbol} />
        </div>

        {/* Kit toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={kit} onChange={e => { setKit(e.target.checked); if (e.target.checked && parts.length === 0) addPart(); }} />
          🧩 {en ? "Multi-part product (kit)" : "Produit multi-pièces (kit)"}
        </label>

        {!kit ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{en ? "Split across locations" : "Répartir sur les sites"}</div>
            <SplitRows rows={rows} setRows={setRows} locList={locList} en={en} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 10,
                          color: left < 0 ? "#f87171" : "var(--text-secondary)" }}>
              <span>{en ? "Assigned" : "Réparti"}: {assigned} / {remaining}</span>
              <span>{en ? "Left" : "Reste"}: {left}</span>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
              {en ? "The kit itself holds the price and NO stock. The quantities below belong to the parts — each part is stocked and split across locations."
                  : "Le kit lui-même porte le prix et AUCUN stock. Les quantités ci-dessous appartiennent aux pièces — chaque pièce est stockée et répartie sur les sites."}
            </div>
            {parts.map((p, i) => (
              <PartRow key={i} part={p} locList={locList} en={en} lang={lang}
                onChange={np => setParts(ps => ps.map((x, j) => j === i ? np : x))}
                onRemove={() => setParts(ps => ps.filter((_, j) => j !== i))} />
            ))}
            <button type="button" className="btn btn-secondary" style={{ marginBottom: 10 }} onClick={addPart}>+ {en ? "Add part" : "Ajouter une pièce"}</button>
          </>
        )}

        <input className="input" style={{ marginBottom: 10 }} value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)}
          placeholder={en ? "Invoice ref (optional)" : "Réf. facture (facultatif)"} />

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>{en ? "Cancel" : "Annuler"}</button>
          <button className="btn btn-primary" style={{ flex: 2 }}
            disabled={mut.isPending || num(sell) <= 0 || (!kit && (left < 0 || assigned === 0)) || (kit && parts.length === 0)}
            onClick={submit}>
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
