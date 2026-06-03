// Sprint D-2 — Online Cart inbox.
//
// Dozie orders from MP-linked sellers land here as pa_online_cart rows.
// A cashier opens an entry, maps each loose Dozie line ({qty,name,price},
// no product_id) to a real pa_product via the reusable MappingModal,
// then either:
//   • Confirm Complete  (paid_online_full)  → atomic sale + stock
//   • Send to Cart       (pay_at_shop|…)    → prefill the /pos screen
// Owners can additionally Void an entry (reverses sale + stock).
//
// Buyer-safety invariant (Sprint C): nothing here surfaces stock counts.

import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api from "../utils/api";
import toast from "react-hot-toast";

// Small Levenshtein for the auto-match confidence label. Mirrors the
// Sprint C FU.4 server-side migration matcher closely enough for the
// cashier to trust the pre-selection (they can always override).
function levenshtein(a, b) {
  a = (a || "").toLowerCase().trim();
  b = (b || "").toLowerCase().trim();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = Array(b.length + 1).fill(0).map((_, i) => i);
  const v1 = Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}
function similarity(a, b) {
  const maxLen = Math.max((a || "").length, (b || "").length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}
function confidenceOf(sim, lang) {
  if (sim >= 0.85) return { key: "high",   label: lang === "en" ? "High match"   : "Forte corresp.", color: "#10b981" };
  if (sim >= 0.6)  return { key: "medium", label: lang === "en" ? "Medium match" : "Corresp. moyenne", color: "#fbbf24" };
  return { key: "low", label: lang === "en" ? "Pick manually" : "À choisir", color: "#f87171" };
}

const MODE_PILL = {
  paid_online_full: { en: "Paid online",   fr: "Payé en ligne", bg: "rgba(16,185,129,0.15)",  color: "#10b981" },
  pay_at_shop:      { en: "Pay at shop",   fr: "Payer en boutique", bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
  partial:          { en: "Partial",       fr: "Acompte",       bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" },
  credit:           { en: "Credit",        fr: "Crédit",        bg: "rgba(239,68,68,0.15)",   color: "#f87171" },
};

function ageLabel(iso, lang) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return lang === "en" ? `${mins}m ago` : `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === "en" ? `${hrs}h ago` : `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return lang === "en" ? `${days}d ago` : `il y a ${days}j`;
}

// ── Reusable mapping modal ──────────────────────────────────────────
// Used by BOTH the Confirm-Complete and Send-to-Cart paths. Emits
// onConfirm(mappings) where mappings = [{dozie_item_index, product_id,
// qty, price}]. Confirm stays disabled until every Dozie line has a
// product mapped.
function MappingModal({ entry, lang, busy, onConfirm, onClose, confirmLabel }) {
  const items = Array.isArray(entry?.items) ? entry.items : [];
  // Per-row state: { search, candidates, product, qty, price }.
  const [rows, setRows] = useState(() =>
    items.map(it => ({
      search: it.name || "",
      candidates: [],
      product: null,
      qty: Number(it.qty || it.quantity || 1),
      price: Number(it.price || 0),
      autoTried: false
    }))
  );

  const runSearch = async (idx, q) => {
    const term = (q || "").trim();
    if (!term) { setRows(r => r.map((x, i) => i === idx ? { ...x, candidates: [] } : x)); return; }
    try {
      const res = await api.get(`/products/search?q=${encodeURIComponent(term)}&limit=10`);
      const list = res.data?.data || [];
      setRows(r => r.map((x, i) => {
        if (i !== idx) return x;
        // Auto-select the closest name match the first time only.
        let product = x.product;
        if (!x.autoTried && list.length) {
          const best = list
            .map(p => ({ p, sim: similarity(items[idx]?.name, p.name) }))
            .sort((a, b) => b.sim - a.sim)[0];
          if (best && best.sim >= 0.6) product = best.p;
        }
        return { ...x, candidates: list, product, autoTried: true };
      }));
    } catch (_) { /* search failure → cashier picks manually */ }
  };

  // Kick off one auto-search per row on mount.
  useEffect(() => {
    items.forEach((it, i) => runSearch(i, it.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allMapped = rows.length > 0 && rows.every(r => r.product && r.qty > 0);
  const fmt = n => Number(n || 0).toLocaleString();

  const submit = () => {
    const mappings = rows.map((r, i) => ({
      dozie_item_index: i,
      product_id: r.product.id,
      qty: Number(r.qty),
      price: Number(r.price)
    }));
    onConfirm(mappings);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{lang === "en" ? "Map Dozie items to products" : "Associer les articles Dozie aux produits"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry?.dozie_order_ref} · {entry?.buyer_name || "—"}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <div style={{ padding: 16, overflowY: "auto" }}>
          {rows.map((r, idx) => {
            const sim = r.product ? similarity(items[idx]?.name, r.product.name) : 0;
            const conf = confidenceOf(sim, lang);
            return (
              <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    “{items[idx]?.name}” <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {fmt(items[idx]?.price)} FCFA</span>
                  </div>
                  {r.product && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(0,0,0,0.2)", color: conf.color }}>
                      {conf.label}
                    </span>
                  )}
                </div>

                <input className="input" value={r.search}
                  placeholder={lang === "en" ? "Search MP product…" : "Rechercher un produit…"}
                  onChange={e => {
                    const v = e.target.value;
                    setRows(rs => rs.map((x, i) => i === idx ? { ...x, search: v } : x));
                  }}
                  onKeyDown={e => { if (e.key === "Enter") runSearch(idx, r.search); }}
                  style={{ marginBottom: 6 }} />

                <select className="input"
                  value={r.product?.id || ""}
                  onChange={e => {
                    const p = r.candidates.find(c => c.id === e.target.value) || null;
                    setRows(rs => rs.map((x, i) => i === idx
                      ? { ...x, product: p, price: p ? Number(p.sell_price || x.price) : x.price }
                      : x));
                  }}
                  style={{ marginBottom: 8 }}>
                  <option value="">{lang === "en" ? "— select product —" : "— choisir un produit —"}</option>
                  {r.candidates.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.barcode ? ` · ${c.barcode}` : ""}</option>
                  ))}
                </select>

                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ flex: 1, fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en" ? "Qty" : "Qté"}
                    <input className="input" type="number" min="0" step="any" value={r.qty}
                      onChange={e => setRows(rs => rs.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                  </label>
                  <label style={{ flex: 1, fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en" ? "Unit price" : "Prix unitaire"}
                    <input className="input" type="number" min="0" step="any" value={r.price}
                      onChange={e => setRows(rs => rs.map((x, i) => i === idx ? { ...x, price: e.target.value } : x))} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: allMapped ? "#10b981" : "var(--text-muted)" }}>
            {allMapped
              ? (lang === "en" ? "All items mapped" : "Tous les articles associés")
              : (lang === "en" ? "Map every item to enable confirm" : "Associez chaque article pour activer")}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
              {lang === "en" ? "Cancel" : "Annuler"}
            </button>
            <button onClick={submit} disabled={!allMapped || busy}
              style={{ padding: "8px 16px", borderRadius: 8, background: (!allMapped || busy) ? "rgba(251,197,3,0.4)" : "var(--brand)", border: "none", color: "#152B52", fontWeight: 600, cursor: (!allMapped || busy) ? "not-allowed" : "pointer", fontSize: 13 }}>
              {busy ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Last-used location for this cashier — survives refresh independently
// of the persisted settings store (which can hold a stale/deleted loc).
const LOC_LS_KEY = "mp-online-cart-location";

const TABS = [
  { key: "pending",        en: "Pending",   fr: "En attente" },
  { key: "completed",      en: "Completed", fr: "Terminé" },
  { key: "voided",         en: "Voided",    fr: "Annulé" },
  { key: "expired_warned", en: "Stale",     fr: "Périmé" },
];

export default function OnlineCartPage() {
  const { lang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState("pending");
  const [openEntry, setOpenEntry] = useState(null);   // detail panel
  const [mapMode, setMapMode] = useState(null);        // 'confirm' | 'send'

  const isOwner = user?.role === "owner";

  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    staleTime: 60000
  });
  // ["locations"] is a cache key shared with POS/Settings; tolerate
  // either the {success,data} envelope or a bare array so a different
  // page priming the cache can't blank this dropdown.
  const locations = Array.isArray(locData) ? locData
    : Array.isArray(locData?.data) ? locData.data : [];

  // Cashier-friendly default: keep the store selection if it's still
  // a valid active location, else fall back to the last-used id
  // (localStorage) and finally the first location. Without this a
  // fresh visit leaves selectedLocation null and every action errors
  // with "Select a location first".
  useEffect(() => {
    if (!locations.length) return;
    const byId = (id) => locations.find(l => l.id === id);
    if (selectedLocation && byId(selectedLocation.id)) return;
    const lastId = localStorage.getItem(LOC_LS_KEY);
    const pick = byId(lastId) || locations[0];
    if (pick) setLocation(pick);
  }, [locations, selectedLocation, setLocation]);

  const { data, isLoading } = useQuery({
    queryKey: ["online-cart", tab],
    queryFn: () => api.get(`/online-cart?status=${tab}`).then(r => r.data),
    refetchInterval: 30000
  });
  const entries = data?.data || [];

  const stats = useMemo(() => {
    const sum = entries.reduce((s, e) => s + Number(e.total_amount || 0), 0);
    return { count: entries.length, sum };
  }, [entries]);

  const refresh = () => {
    qc.invalidateQueries(["online-cart"]);
    qc.invalidateQueries(["online-cart-pending-count"]);
  };

  const confirmMut = useMutation({
    mutationFn: ({ id, mappings }) =>
      api.post(`/online-cart/${id}/confirm-complete`, { location_id: selectedLocation?.id, mappings }),
    onSuccess: (res) => {
      toast.success(lang === "en" ? `Sale ${res.data?.data?.sale_ref || ""} created` : `Vente ${res.data?.data?.sale_ref || ""} créée`);
      setMapMode(null); setOpenEntry(null); refresh();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (lang === "en" ? "Failed" : "Échec"))
  });

  const sendMut = useMutation({
    mutationFn: ({ id, mappings }) =>
      api.post(`/online-cart/${id}/send-to-cart`, { location_id: selectedLocation?.id, mappings }),
    onSuccess: (res) => {
      const url = res.data?.data?.redirect_url;
      setMapMode(null); setOpenEntry(null); refresh();
      // Backend returns /cart?from_online=…; the actual sales screen is
      // /pos — prefill D-2.4 lives there.
      if (url) {
        const u = new URL(url, window.location.origin);
        navigate(`/pos?from_online=${u.searchParams.get("from_online")}&session=${u.searchParams.get("session")}`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.message || (lang === "en" ? "Failed" : "Échec"))
  });

  const voidMut = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/online-cart/${id}/void`, { reason }),
    onSuccess: () => { toast.success(lang === "en" ? "Voided" : "Annulé"); setOpenEntry(null); refresh(); },
    onError: (e) => toast.error(e?.response?.data?.message || (lang === "en" ? "Failed" : "Échec"))
  });

  // Fix 1.4: abandon an in-progress cart → entry returns to fresh pending.
  const cancelSessionMut = useMutation({
    mutationFn: (id) => api.post(`/online-cart/${id}/cancel-cart-session`),
    onSuccess: () => {
      toast.success(lang === "en" ? "Returned to pending" : "Remis en attente");
      setOpenEntry(null); refresh();
    },
    onError: (e) => toast.error(e?.response?.data?.message || (lang === "en" ? "Failed" : "Échec"))
  });

  // Fix 1.3: resume a cart left in progress — re-open the prefilled
  // /pos screen with the same online-cart id + session.
  const resumeCart = (e) => {
    setOpenEntry(null);
    navigate(`/pos?from_online=${e.id}&session=${e.cart_session_id || ""}`);
  };

  const openDetail = async (row) => {
    try {
      const res = await api.get(`/online-cart/${row.id}`);
      setOpenEntry(res.data?.data || row);
    } catch (_) { setOpenEntry(row); }
  };

  const startMap = (mode) => {
    if (!selectedLocation?.id) {
      toast.error(lang === "en" ? "Select a location first" : "Choisissez d'abord un site");
      return;
    }
    setMapMode(mode);
  };

  const t = (en, fr) => (lang === "en" ? en : fr);

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>📥 {t("Online Cart", "Panier en ligne")}</h2>
        <select className="input" value={selectedLocation?.id || ""} style={{ width: "auto", minWidth: 180 }}
          onChange={e => {
            const loc = locations.find(l => l.id === e.target.value) || null;
            setLocation(loc);
            if (loc) localStorage.setItem(LOC_LS_KEY, loc.id);
          }}>
          <option value="">{t("Select location…", "Choisir un site…")}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("Entries", "Entrées")}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.count}</div>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("Total value", "Valeur totale")}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.sum.toLocaleString()} FCFA</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: tab === tb.key ? 700 : 400,
              background: tab === tb.key ? "var(--brand)" : "transparent",
              color: tab === tb.key ? "#152B52" : "var(--text-secondary)",
              border: "1px solid " + (tab === tb.key ? "var(--brand)" : "var(--border)"), cursor: "pointer" }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{t("Loading…", "Chargement…")}</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {t("Nothing here.", "Rien ici.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map(e => {
            const pill = MODE_PILL[e.payment_mode] || { en: e.payment_mode, fr: e.payment_mode, bg: "rgba(100,100,100,0.15)", color: "var(--text-muted)" };
            return (
              <div key={e.id} onClick={() => openDetail(e)}
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{e.dozie_order_ref || e.id.slice(0, 8)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {e.buyer_name || "—"}{e.buyer_phone ? ` · ${e.buyer_phone}` : ""} · {ageLabel(e.created_at, lang)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  {e.cart_started_at && e.status === "pending" && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10, background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                      🛒 {t("Cart in progress", "Panier en cours")}
                    </span>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10, background: pill.bg, color: pill.color }}>
                    {lang === "en" ? pill.en : pill.fr}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{Number(e.total_amount || 0).toLocaleString()} FCFA</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail panel ── */}
      {openEntry && !mapMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1500, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 540, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{openEntry.dozie_order_ref || openEntry.id?.slice(0, 8)}</div>
              <button onClick={() => setOpenEntry(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 18, overflowY: "auto" }}>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
                {openEntry.buyer_name || "—"}{openEntry.buyer_phone ? ` · ${openEntry.buyer_phone}` : ""}
              </div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                {t("Payment", "Paiement")}: <strong>{(MODE_PILL[openEntry.payment_mode] || {})[lang === "en" ? "en" : "fr"] || openEntry.payment_mode}</strong>
                {" · "}{Number(openEntry.total_amount || 0).toLocaleString()} FCFA
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("Items", "Articles")}</div>
              {(openEntry.items || []).map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>{it.qty || it.quantity} × {it.name}</span>
                  <span>{Number(it.price || 0).toLocaleString()} FCFA</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {openEntry.status === "pending" && openEntry.payment_mode === "paid_online_full" && (
                <button onClick={() => startMap("confirm")}
                  style={{ padding: "8px 16px", borderRadius: 8, background: "#10b981", border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                  ✓ {t("Confirm Complete", "Confirmer & terminer")}
                </button>
              )}
              {openEntry.status === "pending" && openEntry.payment_mode !== "paid_online_full" && !openEntry.cart_started_at && (
                <button onClick={() => startMap("send")}
                  style={{ padding: "8px 16px", borderRadius: 8, background: "var(--brand)", border: "none", color: "#152B52", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                  → {t("Send to Cart", "Envoyer au panier")}
                </button>
              )}
              {openEntry.status === "pending" && openEntry.cart_started_at && (
                <>
                  <button onClick={() => resumeCart(openEntry)}
                    style={{ padding: "8px 16px", borderRadius: 8, background: "#fbbf24", border: "none", color: "#1a1a1a", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                    🛒 {t("Resume Cart", "Reprendre le panier")}
                  </button>
                  <button onClick={() => cancelSessionMut.mutate(openEntry.id)} disabled={cancelSessionMut.isLoading}
                    style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                    {t("Return to pending", "Remettre en attente")}
                  </button>
                </>
              )}
              {isOwner && (openEntry.status === "pending" || openEntry.status === "completed") && (
                <button onClick={() => {
                    const reason = window.prompt(t("Void reason?", "Raison de l'annulation ?"));
                    if (reason && reason.trim()) voidMut.mutate({ id: openEntry.id, reason: reason.trim() });
                  }}
                  style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                  {t("Void", "Annuler")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reusable mapping modal (both paths) ── */}
      {openEntry && mapMode && (
        <MappingModal
          entry={openEntry}
          lang={lang}
          busy={confirmMut.isLoading || sendMut.isLoading}
          confirmLabel={mapMode === "confirm" ? t("Confirm & complete", "Confirmer") : t("Send to cart", "Envoyer")}
          onClose={() => setMapMode(null)}
          onConfirm={(mappings) => {
            if (mapMode === "confirm") confirmMut.mutate({ id: openEntry.id, mappings });
            else sendMut.mutate({ id: openEntry.id, mappings });
          }}
        />
      )}
    </div>
  );
}
