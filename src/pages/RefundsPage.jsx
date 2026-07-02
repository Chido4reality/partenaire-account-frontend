// MP-REFUNDS-STAFF-ACCESS — operational refund/exchange page open
// to all roles (owner / manager / cashier).
//
// MP-REFUND-SEARCH-ENHANCED — multi-mode search:
//   🔍 Receipt number  — exact sale_number lookup, auto-detects
//                        VNT-… → search_by=number,
//                        DOZ-… → search_by=dozie_ref. Includes
//                        voided sales (badged) so the cashier
//                        can see "this was already voided".
//   💰 Amount          — find every receipt matching paid_amount
//                        OR total_amount across all dates.
//   📷 Scan QR         — reuses <CameraScanner /> (zxing handles
//                        QR + barcodes). Decoded string runs
//                        through the same auto-detect as the
//                        receipt-number tab.
//   📅 By date         — legacy daily list. include_online=true
//                        so online (Dozie) sales mix in with a
//                        channel badge.
//
// Channel detection comes from the backend (pa_sales row joined
// to pa_online_cart). Online sales show a banner inside the
// refund modal explaining the cash-from-till + boss-handles-
// original-channel refund flow ("Simple" approach; channel-
// aware refund routing is future work).
//
// VoidReturnModal shows the Void option only to backend-permitted
// roles (owner|manager|cashier; accountant/warehouse are 403'd by
// POST /returns/void, so they don't see it). Impersonated "View as
// owner" sessions resolve as owner. Void is also disabled there when
// the sale is already voided or already has a return against it
// (is_voided / has_existing_refund).

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import { cacheData, getCachedData } from "../utils/offlineStore";
import { useLangStore, useAuthStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import VoidReturnModal from "../components/common/VoidReturnModal";
import CameraScanner from "../components/common/CameraScanner";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";
import { ShiftRequiredBlocker, useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";

// Auto-detect the lookup mode from a free-text sale reference.
// VNT-YYYYMMDD-NNNN → POS sale; anything else (DOZ-…, or future
// online prefixes) → Dozie ref. Strings the user pastes from a
// printed receipt get .trim()'d upstream.
function detectRefMode(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v.startsWith("VNT-")) return "number";
  return "dozie_ref"; // DOZ-… or unknown prefix → try the online cart table
}

export default function RefundsPage() {
  const { lang } = useLangStore();
  const fr = lang === "fr";
  // MP-REQUIRE-OPEN-SHIFT Phase 3: per-row Refund button needs to
  // know if the cashier has a drawer open; backend rejects otherwise.
  const { hasShift: shiftIsOpen } = useActiveShift();

  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState("date"); // "number" | "amount" | "scan" | "date"
  const [date, setDate] = useState(today);
  const [page, setPage] = useState(1);

  // Search inputs (per-tab; each tab's submitted value lives in
  // its own state so switching tabs doesn't clobber a typed query).
  const [numberInput, setNumberInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);

  // Submitted queries — drive the active useQuery key.
  const [activeQuery, setActiveQuery] = useState(null);
  // shape: { by: "number"|"amount"|"dozie_ref", value: string }

  const [selected, setSelected] = useState(null);          // hydrated sale for modal
  const [loadingSale, setLoadingSale] = useState(null);    // id being fetched
  // MP-OPS-MONEY-EXPLAINABLE: deep-link from Operations (?ref=VNT-…) → auto-search
  // and open that receipt so an anomaly / voided / MoMo row "opens the sale".
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoOpenRef, setAutoOpenRef] = useState(null);
  // MP-RECEIPT-RETURN-BARCODE: when a scanned/typed complete receipt ref finds
  // no sale, show "not found — enter manually" (manual entry still works).
  const [notFoundRef, setNotFoundRef] = useState(null);

  // MP-PAYMENT-EVENT-RECEIPTS Phase 3: receipt modal opens after
  // VoidReturnModal succeeds. Mapping:
  //   void mode     → eventType: 'void'
  //   refund mode   → eventType: 'refund'
  //   exchange mode → eventType: 'refund' (refund + replacement,
  //                   the receipt focuses on the refund side; the
  //                   replacement-out is documented in the audit
  //                   log and matters less to the customer)
  const [receiptEvent, setReceiptEvent] = useState(null);
  const fmt = useCurrency();
  const { org, user } = useAuthStore();
  const { data: orgSettingsResp } = useOfflineCachedQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });
  const orgSettings = orgSettingsResp?.data || org || {};

  // MP-REFUNDS-LOCATION-SCOPING: a Pro-Plus pinned cashier
  // (pa_users.assigned_location_id) is confined to their own location — the
  // backend FORCES this on GET /sales regardless of what we send, so this is
  // belt-and-braces: we mirror it client-side to hide the chooser and show the
  // right list. Owner/manager get a chooser ("All" + each location).
  const role = user?.role;
  const isOwnerOrManager = role === "owner" || role === "manager";
  const { data: myPlanResp } = useOfflineCachedQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
  });
  // forced_location is populated by getForcedLocationId server-side (only for a
  // pinned cashier on a capable plan) — same authoritative helper the search now
  // uses, so client + server can't disagree.
  const forcedLoc = myPlanResp?.data?.forced_location || null;
  const forcedLocId = forcedLoc?.id || null;
  const { data: locationsResp } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    enabled: isOwnerOrManager,
  });
  const orgLocations = locationsResp?.data || [];
  // Owner/manager chooser value: "" = All locations (default).
  const [locFilter, setLocFilter] = useState("");
  const showLocationChooser = isOwnerOrManager && !forcedLocId;
  // Effective location_id sent to GET /sales: a confined cashier → their forced
  // location; owner/manager → their chosen filter (omitted for "All"). Empty
  // string = no filter.
  const effLocId = forcedLocId || (isOwnerOrManager ? (locFilter || "") : "");

  const PAGE_LIMIT = 50;

  // Search query — only fires when activeQuery is set.
  const { data: searchResp, isLoading: searchLoading, refetch: refetchSearch } = useOfflineCachedQuery({
    queryKey: ["refunds-search", activeQuery, effLocId],
    queryFn: () => {
      const { by, value } = activeQuery;
      const params = new URLSearchParams({ search_by: by, value, limit: String(PAGE_LIMIT) });
      if (effLocId) params.set("location_id", effLocId);
      return api.get(`/sales?${params.toString()}`).then(r => r.data);
    },
    enabled: !!activeQuery,
  });

  // Date-list query — drives the "By date" tab. include_online=true
  // so the cashier sees both channels in one list (POS + online).
  const { data: dateResp, isLoading: dateLoading, refetch: refetchDate } = useOfflineCachedQuery({
    queryKey: ["refunds-by-date", date, page, PAGE_LIMIT, effLocId],
    queryFn: () =>
      api.get(`/sales?date=${date}&include_online=true&limit=${PAGE_LIMIT}&page=${page}${effLocId ? `&location_id=${effLocId}` : ""}`)
        .then(r => r.data),
    enabled: tab === "date",
  });

  // Pick which list is currently active for rendering.
  const isSearching = tab !== "date";
  const sales = (isSearching ? searchResp?.data : dateResp?.data) || [];
  const total = (isSearching ? searchResp?.total : dateResp?.total) || 0;
  const isLoading = isSearching ? searchLoading : dateLoading;
  const hasNext = !isSearching && (page * PAGE_LIMIT < total);

  const refetch = () => { isSearching ? refetchSearch() : refetchDate(); };

  // Reset pagination + clear any active search when the user
  // switches tabs — keeps the visible list aligned with the tab.
  useEffect(() => {
    setPage(1);
    setNotFoundRef(null);
    if (tab === "date") setActiveQuery(null);
  }, [tab]);

  // A COMPLETE POS receipt ref (VNT-YYYYMMDD-NNNN) — safe to auto-open the exact
  // match. Partial numbers fall through to the results list (no auto-open).
  const isCompleteVnt = (v) => /^VNT-\d{8}-\d+$/i.test(String(v || "").trim());

  const runNumberSearch = () => {
    const v = numberInput.trim();
    if (!v) return;
    setNotFoundRef(null);
    setActiveQuery({ by: detectRefMode(v), value: v });
    // Full receipt number (typed OR sent by a 1D keyboard-wedge scanner + Enter)
    // → pre-open the exact sale; partial number → just show the results list.
    setAutoOpenRef(isCompleteVnt(v) ? v.trim().toUpperCase() : null);
  };
  const runAmountSearch = () => {
    const v = amountInput.trim();
    if (!v || !Number.isFinite(Number(v)) || Number(v) < 0) return;
    setActiveQuery({ by: "amount", value: v });
  };
  // MP-RECEIPT-RETURN-BARCODE: decode from the camera scanner OR the 1D
  // keyboard-wedge field. The receipt barcode encodes the sale_number verbatim
  // (VNT-…). Validate the prefix so a stray PRODUCT barcode doesn't run a junk
  // search; a VNT- match pre-loads the return flow, DOZ- keeps the online path,
  // anything else is rejected with a clear message. Manual entry always works.
  const onScanResult = (code) => {
    setScannerOpen(false);
    const v = String(code || "").trim();
    if (!v) return;
    const up = v.toUpperCase();
    setTab("number");
    setNumberInput(v); // show what was scanned so the cashier can edit if needed
    if (!up.startsWith("VNT-") && !up.startsWith("DOZ-")) {
      setActiveQuery(null);
      setAutoOpenRef(null);
      setNotFoundRef(null);
      toast.error(fr
        ? "Ce n'est pas un code de reçu. Scannez le code-barres au bas du reçu, ou saisissez le N°."
        : "Not a receipt barcode. Scan the barcode at the bottom of the receipt, or type the number.");
      return;
    }
    setNotFoundRef(null);
    setActiveQuery({ by: detectRefMode(v), value: v });
    // VNT receipts pre-open the exact sale; DOZ- keeps the existing results flow.
    setAutoOpenRef(up.startsWith("VNT-") ? up : null);
  };

  const handleRefund = async (saleId) => {
    setLoadingSale(saleId);
    // MP-CASHIER-VIEW-ITEMS: open the modal IMMEDIATELY from the list row. The
    // search response now carries pa_sale_items + pa_locations, so the row
    // already has the line items — the "Sale contents" picking list shows the
    // instant the cashier taps, with NO dependency on the secondary
    // GET /sales/:id succeeding (it can time out on a cold Render backend and
    // previously left the modal on an itemless summary). We then enrich in the
    // background with the full detail (payments, etc.) without blocking the view.
    const fromList = (sales || []).find(s => s.id === saleId);
    if (fromList && fromList.id) setSelected(fromList);
    try {
      const { data } = await api.get(`/sales/${saleId}`);
      const sale = data?.data || data;
      if (sale && sale.id) {
        // Don't let an enrichment response that somehow lacks items clobber the
        // line items we already showed from the (item-bearing) list row.
        if ((!sale.pa_sale_items || sale.pa_sale_items.length === 0) && fromList?.pa_sale_items?.length) {
          sale.pa_sale_items = fromList.pa_sale_items;
        }
        // MP-PHASE-4.3: cache the full detail so a later OFFLINE refund of
        // the same sale can open the modal from this cached copy. Best-effort.
        try { cacheData(`sale-detail-${saleId}`, sale); } catch {}
        setSelected(sale);
      }
    } catch (err) {
      // Enrichment failed (timeout/offline). The modal is already open from the
      // list row (items included). Prefer a richer cached copy if we have one.
      try {
        const cached = await getCachedData(`sale-detail-${saleId}`);
        if (cached && cached.id) { setSelected(cached); return; }
      } catch {}
      if (!fromList) console.error("[refunds] failed to load sale", err);
    } finally {
      setLoadingSale(null);
    }
  };

  // ── Search header tabs ─────────────────────────────────────
  const TABS = [
    { key: "number", emoji: "🔍", en: "Receipt #", fr: "N° Reçu" },
    { key: "amount", emoji: "💰", en: "Amount",    fr: "Montant" },
    { key: "scan",   emoji: "📷", en: "Scan receipt", fr: "Scanner reçu" },
    { key: "date",   emoji: "📅", en: "By date",   fr: "Par date" },
  ];

  // Open the scanner immediately when the user picks the scan tab.
  useEffect(() => {
    if (tab === "scan") setScannerOpen(true);
  }, [tab]);

  // MP-OPS-MONEY-EXPLAINABLE: consume ?ref=VNT-… → run the number search and
  // remember to auto-open that receipt; then drop the param so it fires once.
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;
    setTab("number");
    setNumberInput(ref);
    setActiveQuery({ by: detectRefMode(ref), value: ref });
    setAutoOpenRef(ref.trim().toUpperCase());
    const next = new URLSearchParams(searchParams);
    next.delete("ref");
    setSearchParams(next, { replace: true });
  }, [searchParams]);

  // When a deep-linked / scanned / typed complete receipt ref resolves, open the
  // exact sale — or flag "not found" so the cashier knows to enter it manually.
  useEffect(() => {
    if (!autoOpenRef || searchLoading) return;
    const rows = searchResp?.data || [];
    const match = rows.find(s => String(s.sale_number || "").toUpperCase() === autoOpenRef);
    if (match && match.id) { handleRefund(match.id); setAutoOpenRef(null); setNotFoundRef(null); }
    else if (searchResp) { setNotFoundRef(autoOpenRef); setAutoOpenRef(null); }
  }, [autoOpenRef, searchResp, searchLoading]);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">↩ {fr ? "Remboursements" : "Refunds"}</h1>
          <div className="page-sub">
            {fr
              ? "Cherchez un reçu par N°, montant, scan QR ou par date."
              : "Find a receipt by number, amount, QR scan or by date."}
          </div>
        </div>
      </div>

      {/* MP-REQUIRE-OPEN-SHIFT Phase 3 blocker */}
      <ShiftRequiredBlocker />

      {/* MP-REFUNDS-LOCATION-SCOPING: owner/manager location chooser. Default
          "All". Choosing a location filters the refundable-sale list to it
          (passed as ?location_id on every GET /sales call). */}
      {showLocationChooser && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <label className="label" style={{ margin: 0 }}>📍 {fr ? "Site" : "Location"}</label>
          <select className="input" value={locFilter}
            onChange={e => { setLocFilter(e.target.value); setPage(1); }}
            style={{ width: 240 }}>
            <option value="">{fr ? "Tous les sites" : "All locations"}</option>
            {orgLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Confined cashier: read-only note so they understand why only one
          location's sales appear (the server enforces this). */}
      {forcedLocId && forcedLoc?.name && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 12, color: "var(--text-muted)" }}>
          📍 {fr ? "Remboursements limités à votre site :" : "Refunds limited to your location:"}{" "}
          <strong style={{ color: "var(--text-secondary)" }}>{forcedLoc.name}</strong>
        </div>
      )}

      {/* Tab selector */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 6,
      }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: "1 1 120px", padding: "10px 12px",
                background: active ? "var(--brand)" : "transparent",
                color: active ? "#152B52" : "var(--text-secondary)",
                border: "none", borderRadius: 8,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}>
              {t.emoji} {fr ? t.fr : t.en}
            </button>
          );
        })}
      </div>

      {/* Per-tab input row */}
      <div style={{ marginBottom: 18 }}>
        {tab === "number" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="VNT-20260522-0007 / DOZ-…"
              value={numberInput}
              onChange={e => setNumberInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runNumberSearch(); }}
              autoFocus
              style={{ flex: 1, minWidth: 240, fontFamily: "monospace" }}
            />
            <button className="btn btn-primary" onClick={runNumberSearch} disabled={!numberInput.trim()}>
              🔍 {fr ? "Chercher" : "Search"}
            </button>
          </div>
        )}

        {tab === "amount" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="input"
              type="number" min="0" step="1"
              placeholder={fr ? "Ex : 1500" : "e.g. 1500"}
              value={amountInput}
              onChange={e => setAmountInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runAmountSearch(); }}
              autoFocus
              style={{ flex: 1, minWidth: 200, textAlign: "center", fontWeight: 700, fontSize: 16 }}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{fmt.symbol}</span>
            <button className="btn btn-primary" onClick={runAmountSearch} disabled={!amountInput.trim()}>
              💰 {fr ? "Chercher" : "Search"}
            </button>
          </div>
        )}

        {tab === "scan" && (
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "14px 18px",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                📷 {fr ? "Pointez la caméra sur le QR du reçu" : "Point the camera at the receipt QR"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {fr
                  ? "Le code décodé sera utilisé pour retrouver la vente. Fonctionne aussi avec les codes-barres."
                  : "The decoded code will be used to find the sale. Works with barcodes too."}
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => setScannerOpen(true)}>
              📷 {fr ? "Ouvrir la caméra" : "Open camera"}
            </button>
          </div>
        )}

        {tab === "date" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="label" style={{ margin: 0 }}>{fr ? "Date" : "Date"}</label>
            <input className="input" type="date" value={date}
              onChange={e => { setDate(e.target.value); setPage(1); }}
              style={{ width: 180 }} />
            <button className="btn btn-secondary"
              onClick={() => { setDate(today); setPage(1); }}
              disabled={date === today}>
              {fr ? "Aujourd'hui" : "Today"}
            </button>
          </div>
        )}
      </div>

      {/* MP-RECEIPT-RETURN-BARCODE: scanned/typed receipt not found → tell the
          cashier to enter it manually (the manual field above still works). */}
      {notFoundRef && (
        <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", fontSize: 13, fontWeight: 600 }}>
          {fr
            ? `Vente introuvable pour « ${notFoundRef} » — saisissez le N° manuellement.`
            : `Sale not found for "${notFoundRef}" — enter the number manually.`}
        </div>
      )}

      {/* Result count line for search modes */}
      {isSearching && activeQuery && !isLoading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          {sales.length === 0
            ? (fr ? "Aucun reçu trouvé." : "No receipt found.")
            : activeQuery.by === "amount"
              ? (fr
                  ? `${sales.length} reçu(s) de ${fmt(Number(activeQuery.value))}.`
                  : `${sales.length} receipt(s) of ${fmt(Number(activeQuery.value))}.`)
              : (fr
                  ? `${sales.length} résultat(s) pour « ${activeQuery.value} ».`
                  : `${sales.length} result(s) for "${activeQuery.value}".`)
          }
        </div>
      )}

      {/* Result list */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {fr ? "Chargement…" : "Loading…"}
        </div>
      ) : sales.length === 0 ? (
        <div className="empty-state" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>🧾</div>
          <div style={{ fontWeight: 600 }}>
            {isSearching && activeQuery
              ? (fr ? "Aucun reçu trouvé" : "No receipt found")
              : (fr ? "Aucune vente ce jour" : "No sales on this day")}
          </div>
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>{fr ? "Date" : "Date"}</th>
                  <th>{fr ? "N° vente" : "Sale #"}</th>
                  <th>{fr ? "Client" : "Customer"}</th>
                  <th style={{ textAlign: "right" }}>{fr ? "Total" : "Total"}</th>
                  <th style={{ textAlign: "right" }}>{fr ? "Payé" : "Paid"}</th>
                  <th>{fr ? "Canal" : "Channel"}</th>
                  <th>{fr ? "Statut" : "Status"}</th>
                  <th style={{ textAlign: "right" }}>{fr ? "Action" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => {
                  const dateStr = s.created_at
                    ? new Date(s.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
                    : "—";
                  const timeStr = s.created_at
                    ? new Date(s.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                    : "";
                  const statusColor = s.payment_status === "paid"   ? "#34d399"
                                    : s.payment_status === "partial" ? "#fbbf24"
                                    : s.payment_status === "credit"  ? "#f87171"
                                    : "var(--text-muted)";
                  const isVoided = s.is_voided;
                  const isOnline = s.channel === "online";
                  const hasRefund = s.has_existing_refund;
                  return (
                    // MP-CASHIER-OPEN-SALE: the whole row opens the sale
                    // detail. Opening/viewing is NOT gated on an open shift
                    // (only the money ACTION inside the modal is, enforced
                    // server-side) — so a cashier can look up a receipt and
                    // view it before their till is open. Previously the only
                    // tap target was the shift-disabled Refund button, so
                    // tapping a result did nothing for a cashier.
                    <tr key={s.id}
                      onClick={() => { if (loadingSale !== s.id) handleRefund(s.id); }}
                      style={{ cursor: loadingSale === s.id ? "wait" : "pointer" }}>
                      <td style={{ color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                        {dateStr} <span style={{ opacity: 0.6 }}>{timeStr}</span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontWeight: 600 }}>
                        {s.sale_number}
                        {isOnline && s.dozie_order_ref && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                            {s.dozie_order_ref}
                          </div>
                        )}
                      </td>
                      <td>
                        {s.customer_name || s.pa_customers?.name || (fr ? "Comptoir" : "Walk-in")}
                        {/* MP-SALE-CASHIER-NAME: accountability — who rang this sale. */}
                        {(s.cashier_name || s.pa_users?.full_name) && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                            {fr ? "Vendu par" : "Sold by"}: {s.cashier_name || s.pa_users?.full_name}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(s.total_amount)}</td>
                      <td style={{ textAlign: "right" }}>{fmt(s.paid_amount)}</td>
                      <td>
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                          background: isOnline ? "rgba(249,115,22,0.15)" : "rgba(59,130,246,0.15)",
                          color: isOnline ? "#f97316" : "#60a5fa",
                        }}>
                          {isOnline ? (fr ? "EN LIGNE" : "ONLINE") : "POS"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${statusColor}22`, color: statusColor, fontWeight: 600 }}>
                          {s.payment_status}
                        </span>
                        {isVoided && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(100,100,100,0.15)", color: "var(--text-muted)", fontWeight: 600, marginLeft: 4 }}>
                            {fr ? "annulée" : "voided"}
                          </span>
                        )}
                        {hasRefund && !isVoided && (
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(168,85,247,0.15)", color: "#a78bfa", fontWeight: 600, marginLeft: 4 }}
                            title={fr ? "Cette vente a déjà été remboursée au moins une fois" : "This sale has already been refunded at least once"}>
                            ↩ {fr ? "déjà rembours." : "refunded"}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {/* MP-CASHIER-OPEN-SALE: this button now OPENS the
                            sale detail (view + act). Opening is no longer
                            blocked by shift state or void status — the
                            cashier can always view. The actual refund /
                            exchange / void inside the modal stays gated by
                            the open-shift contract (backend-enforced); the
                            page-level ShiftRequiredBlocker nudges them to
                            open a till before acting. stopPropagation so the
                            button click doesn't double-fire the row onClick. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRefund(s.id); }}
                          disabled={loadingSale === s.id}
                          title={!shiftIsOpen ? noShiftHint(lang) : (fr ? "Ouvrir la vente" : "Open sale")}
                          style={{
                            padding: "6px 12px", borderRadius: 8,
                            border: "1px solid rgba(251,191,36,0.4)",
                            background: "rgba(251,191,36,0.10)",
                            color: "#fbbf24",
                            fontWeight: 700, fontSize: 12,
                            cursor: loadingSale === s.id ? "wait" : "pointer",
                            opacity: loadingSale === s.id ? 0.6 : 1,
                          }}>
                          {loadingSale === s.id
                            ? "…"
                            : (fr ? "Ouvrir ›" : "Open ›")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination only on date tab — search modes are capped at PAGE_LIMIT */}
          {tab === "date" && (page > 1 || hasNext) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}>
                ← {fr ? "Précédent" : "Previous"}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fr ? `Page ${page}` : `Page ${page}`}{total > 0 ? ` · ${total} ${fr ? "ventes" : "sales"}` : ""}
              </div>
              <button className="btn btn-secondary"
                disabled={!hasNext}
                onClick={() => setPage(p => p + 1)}>
                {fr ? "Suivant" : "Next"} →
              </button>
            </div>
          )}
          {/* Hint when search hit the cap — backend caps responses at 100,
              we ask for PAGE_LIMIT=50, so this rarely triggers; cashier
              should narrow the query rather than paginate. */}
          {isSearching && sales.length >= PAGE_LIMIT && (
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
              {fr
                ? `Affichage des ${PAGE_LIMIT} premiers résultats — affinez votre recherche pour voir d'autres reçus.`
                : `Showing first ${PAGE_LIMIT} results — narrow your search to see more.`}
            </div>
          )}
        </div>
      )}

      {scannerOpen && (
        <CameraScanner
          lang={lang}
          title={fr ? "Scanner le reçu" : "Scan receipt"}
          placeholder={fr ? "Saisir N° de reçu…" : "Type receipt #…"}
          inputMode="text"
          onScan={onScanResult}
          onClose={() => { setScannerOpen(false); if (tab === "scan") setTab("number"); }}
        />
      )}

      {selected && (
        <VoidReturnModal
          sale={selected}
          lang={lang}
          onSuccess={({ mode, data }) => {
            // mode: 'void' | 'refund' | 'exchange' — exchange folds
            // into the 'refund' event type (refund + replacement).
            const eventType = mode === "void" ? "void" : "refund";
            setReceiptEvent({ eventType, data });
          }}
          onClose={() => { setSelected(null); refetch(); }}
        />
      )}

      {/* MP-PAYMENT-EVENT-RECEIPTS Phase 3: receipt modal for
          refund + void. Same shared component the POS sale and
          debt-collection flows use. */}
      {receiptEvent && (
        <PaymentEventReceipt
          eventType={receiptEvent.eventType}
          data={receiptEvent.data}
          org={orgSettings}
          lang={lang}
          onClose={() => setReceiptEvent(null)}
        />
      )}
    </div>
  );
}
