// BAR MODE — build steps 2 + 3a (docs/bar-mode-spec.md): the bar floor.
// Zones + tables (owner / manager set them up), table tabs and named counter tabs.
// 3a: ROUNDS on an open tab: send a round of products, the bartender SERVES it whole
// (that reserves the stock) or it is cancelled while still waiting. The tab's total is what was
// served. Close → pay with ONE tender (cash or mobile money); the stock leaves the shelf at pay.
// A tab with nothing served still ends cancelled.
//
// BAR LAYOUT (Peter 2026-11-18, docs/bar-mockup.png.png): one screen, three parts.
//   TOP    header (menu · Stenamo Book / Bar · branch · Counter tabs · Set up tables) and the tables
//          row (Home fixed left, then each area's tables with their status).
//   LEFT   the quick-sell grid (components/bar/QuickGrid.jsx); "All items" opens the full search.
//   RIGHT  Home → the EXISTING POS cart (POSPage embedded: same cart, Hold, payment, customer,
//          offline queue). A table / counter tab → its rounds, the next-round draft and the
//          existing round + tab actions.
// Drafts are kept apart per view (Home = the POS cart per branch; each tab = store/barDrafts.js).
// Switching view never sends a round, closes a tab or moves items between bills.
// Switching BRANCH returns to Home of the new branch — nothing from the old branch stays on screen
// (utils/barLayout.js barViewReducer; the bug found in testing).
//
// Reached only from the "Bar" menu entry, which shows only when GET /bar/mine lists a bar for this
// person (Bar Mode on + Pro Plus + a location ticked as a bar). Every action is refused by the
// server anywhere else, so typing /bar at a shop shows "no bar" and nothing more.
//
// ONLINE ONLY (spec decision 12): opening, closing and paying tabs are refused here while offline,
// with a sentence, and are never queued — a tab replayed later could collide with a colleague's.
// (Home's counter sale is a normal POS sale and keeps the POS offline queue.)
import { useEffect, useMemo, useReducer, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import { useNetworkStatus } from "../utils/useNetworkStatus";
import { SHOP_TZ } from "../utils/shopTime";
import { useCurrency } from "../utils/useCurrency";
import POSPage from "./POSPage";
import QuickGrid from "../components/bar/QuickGrid";
import TablesRow from "../components/bar/TablesRow";
import { BAR_CSS } from "../components/bar/barTheme";
import { useBarChrome } from "../store/barChrome";
import { useBarDraftStore } from "../store/barDrafts";
import { HOME, barViewReducer, currentTabId, tabBelongsToBar, draftKey } from "../utils/barLayout";
import TabMoney, { tabMoneyLine } from "../components/bar/TabMoney";   // step 1.0: Ordered / Paid / Balance due
import { OpenShiftModal } from "../components/common/ShiftWidgets";

const L = (lang, en, fr) => (lang === "en" ? en : fr);
const errText = (lang, e) => {
  const d = e?.response?.data;
  if (d) return (lang === "en" ? d.message_en : d.message_fr) || d.message || L(lang, "Refused.", "Refusé.");
  return L(lang, "No connection — try again.", "Pas de connexion — réessayez.");
};
// shop time (WAT), never the device's zone
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ }); } catch { return ""; } };

// one key per round draft: a retry of the SAME draft can never make a second round (server: one round per key per tab)
const newKey = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

// the last bar branch used, per person, on this device (a convenience: storage may be blocked → null)
const LAST_BAR_KEY = "mp-bar-last-branch";
export function readLastBar(userId) {
  try { const m = JSON.parse(localStorage.getItem(LAST_BAR_KEY) || "{}"); return (userId && m && m[userId]) || null; } catch { return null; }
}
function writeLastBar(userId, barId) {
  if (!userId || !barId) return;
  try { const m = JSON.parse(localStorage.getItem(LAST_BAR_KEY) || "{}") || {}; if (m[userId] !== barId) { m[userId] = barId; localStorage.setItem(LAST_BAR_KEY, JSON.stringify(m)); } } catch { /* blocked storage */ }
}

const card = { background: "rgba(15,31,63,.85)", border: "1px solid rgba(148,163,184,.28)", borderRadius: 14, padding: 14, color: "#f8fafc" };
const btn = { padding: "8px 14px", borderRadius: 10, border: "1.5px solid rgba(148,163,184,.4)", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700 };

export default function BarPage() {
  const { lang } = useLangStore();
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const { selectedLocation, setLocation } = useSettingsStore();
  const { isOnline } = useNetworkStatus();
  const qc = useQueryClient();
  const fmt = useCurrency();
  const [view, dispatch] = useReducer(barViewReducer, { barId: null, view: HOME });
  const [msg, setMsg] = useState(null);       // { ok, text }
  const [setup, setSetup] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tender, setTender] = useState({});       // tab id → "cash" | "mobile_money"
  const menuOpen = useBarChrome((s) => s.menuOpen);

  const mine = useQuery({ queryKey: ["bar-mine"], queryFn: () => api.get("/bar/mine").then((r) => r.data?.data || { bars: [] }), staleTime: 60000 });
  const bars = mine.data?.bars || [];
  // BAR BRANCH (Peter 2026-11-19, tablet): the view lives in this page's state, which is lost whenever /bar is
  // left (☰ → Cash, New Sale…) — coming back fell to bars[0], and /bar/mine has no order, so it JUMPED to
  // Bepanda. Now: the picked bar, else the LAST bar branch used on this device (per person), else the app's
  // location when it is a bar, else the first — chosen on the FIRST render, so the floor never flashes empty.
  const isBar = (id) => !!id && bars.some((b) => b.id === id);
  const last = readLastBar(userId);
  const barId = isBar(view.barId) ? view.barId : isBar(last) ? last : isBar(selectedLocation?.id) ? selectedLocation.id : (bars[0]?.id || null);
  useEffect(() => { if (barId) writeLastBar(userId, barId); }, [userId, barId]);
  // the reducer owns the branch: the first bar (or a bar that vanished from the list) goes through "branch" too
  useEffect(() => { if (barId && barId !== view.barId) dispatch({ type: "branch", barId }); }, [barId, view.barId]);
  const v = view.barId === barId ? view : { barId, view: HOME };

  // the bar's branch IS the app's selling location here, so the Home counter sale sells at this bar
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/locations").then((r) => r.data), retry: 1 });
  useEffect(() => {
    if (!barId || selectedLocation?.id === barId) return;
    const full = (locs.data?.data || []).find((l) => l.id === barId);
    const bar = bars.find((b) => b.id === barId);
    if (full || bar) setLocation(full || { id: barId, name: bar.name });
  }, [barId, selectedLocation?.id, locs.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const floor = useQuery({
    queryKey: ["bar-floor", barId], enabled: !!barId,
    queryFn: () => api.get(`/bar/${barId}/floor`).then((r) => r.data?.data),
    refetchInterval: 20000, refetchOnWindowFocus: true,
  });
  const F = floor.data;
  useEffect(() => { if (F) dispatch({ type: "floor", barId, floor: F }); }, [F, barId]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["bar-floor", barId] });

  // OPEN A SHIFT IN PLACE (Peter 2026-11-19): is a shift open at THIS bar? Same key + shape as the POS's
  // useActiveShift, so the shift modal's invalidation refreshes both. No shift → beside Take payment:
  // "Open a shift first" + an Open shift button (the POS shift modal), and payment works right after.
  const shiftQ = useQuery({
    queryKey: ["current-shift", barId], enabled: !!barId, refetchInterval: 30000,
    queryFn: () => api.get(`/shifts/current?location_id=${barId}`).then((r) => r.data?.data),
  });
  const [refusedNoShift, setRefusedNoShift] = useState(null);   // the bar whose pay the server refused for no shift
  const [showOpenShift, setShowOpenShift] = useState(false);
  const shiftOpen = shiftQ.isSuccess ? !!(shiftQ.data && shiftQ.data.shift_id) : null;
  const needShift = shiftOpen === false || refusedNoShift === barId;   // cleared when a shift is opened here or a payment goes through
  const shift = { need: needShift, open: () => setShowOpenShift(true) };
  const act = useMutation({
    mutationFn: async ({ kind, path, body }) => {
      if (!isOnline) { const e = new Error("offline"); e.offline = true; throw e; }
      try {
        return await api.post(path, body || {}).then((r) => ({ kind, data: r.data?.data }));
      } catch (e) {
        // LOST RESPONSE (Peter's tablet 2026-11-19: "No connection" while the server had PAID the tab).
        // A pay with no answer, or refused as "already paid", is checked against the server before
        // anything is said: the tab's TRUE state decides. Never re-sent — the server's tab status and
        // version already refuse a second payment, and this only reads.
        const m = kind === "pay" && /^\/bar\/tabs\/([^/]+)\/pay$/.exec(path);
        // "already paid" comes in two shapes (BE probe 2026-11-20): the tab's (tab_status) or the ticket's (current_status)
        const d409 = e.response && e.response.status === 409 && e.response.data;
        const lost = !e.response || (d409 && (d409.tab_status === "paid" || d409.current_status === "paid"));
        if (m && lost) {
          const t = await api.get(`/bar/tabs/${m[1]}`).then((r) => r.data?.data).catch(() => null);
          if (t && t.status === "paid") return { kind, data: t, recovered: true };
        }
        throw e;
      }
    },
    onSuccess: ({ kind }) => {
      if (kind === "pay") setRefusedNoShift(null);
      setMsg({ ok: true, text: ({ open: L(lang, "Tab opened.", "Note ouverte."), close: L(lang, "Tab closed.", "Note fermée."),
        pay: L(lang, "Tab paid.", "Note encaissée."), zone: L(lang, "Zone added.", "Zone ajoutée."), table: L(lang, "Table added.", "Table ajoutée.") })[kind] || "OK" });
      refresh();
    },
    onError: (e) => {
      if (e?.response?.data?.code === "no_open_shift") {   // shown beside Take payment, not at the top
        setRefusedNoShift(barId); setMsg(null); qc.invalidateQueries({ queryKey: ["current-shift", barId] }); refresh(); return;
      }
      setMsg({ ok: false, text: e.offline ? L(lang, "Tabs need a connection. Nothing was saved — try again when you are online.",
        "Les notes ont besoin d'une connexion. Rien n'a été enregistré — réessayez une fois en ligne.") : errText(lang, e) });
      refresh();
    },
  });
  const patch = useMutation({
    mutationFn: ({ path, body }) => api.patch(path, body).then((r) => r.data?.data),
    onSuccess: () => refresh(),
    onError: (e) => setMsg({ ok: false, text: errText(lang, e) }),
  });

  // the table view's own product list (the POS list is only mounted at Home)
  const tabProducts = useQuery({
    queryKey: ["bar-products-all", barId], enabled: !!barId && v.view !== HOME, staleTime: 60000,
    queryFn: () => api.get(`/products?exclude_components=true&location_id=${barId}`).then((r) => r.data?.data || r.data || []),
  });

  const zones = F?.zones || [];
  const tables = F?.tables || [];
  const named = F?.named_tabs || [];
  const canSetup = mine.data?.can_setup === true;
  const canServe = mine.data?.can_serve === true;
  const busy = act.isPending || patch.isPending;

  if (mine.isLoading) return <div style={{ padding: 20 }}>{L(lang, "Loading…", "Chargement…")}</div>;
  if (mine.isError) return <div style={{ padding: 20 }}>{L(lang, "Could not load the bar. Check the connection.", "Impossible de charger le bar. Vérifiez la connexion.")}</div>;
  if (!bars.length) return <div style={{ padding: 20 }}>{L(lang, "No bar is set up for you.", "Aucun bar n'est configuré pour vous.")}</div>;

  const switchBranch = (id) => { dispatch({ type: "branch", barId: id }); setMsg(null); setShowAll(false); setCounterOpen(false); setSetup(false); };
  const goHome = () => { dispatch({ type: "home" }); setShowAll(false); };
  const tabId = currentTabId(v, F);
  const selTable = v.view === "table" ? tables.find((t) => t.id === v.tableId) : null;
  const selNamed = v.view === "named" ? named.find((t) => t.id === v.tabId) : null;
  const zoneName = (t) => zones.find((z) => z.id === t?.zone_id)?.name || null;
  const title = selTable ? [selTable.label, zoneName(selTable)].filter(Boolean).join(" · ") : selNamed ? selNamed.name : "";

  return (
    <div className="bar-screen">
      <style>{BAR_CSS}</style>
      <header className="bar-top">
        <button type="button" className="bar-icon-btn bar-menu-btn" aria-label={L(lang, "Menu", "Menu")} aria-pressed={menuOpen}
          onClick={() => useBarChrome.getState().setMenuOpen(!menuOpen)}>☰</button>
        <div className="bar-brand"><span aria-hidden="true">📖</span>Stenamo Book <small>/ {L(lang, "Bar", "Bar")}</small></div>
        <span className="bar-vsep" aria-hidden="true" />
        {bars.length > 1
          ? <select className="bar-select" aria-label={L(lang, "Branch", "Succursale")} value={barId || ""} onChange={(e) => switchBranch(e.target.value)}>
              {bars.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          : <span className="bar-select" style={{ cursor: "default" }}>{bars[0].name}</span>}
        <div className="bar-top-right">
          <button type="button" className="bar-outline-btn is-accent" aria-pressed={counterOpen} onClick={() => { setCounterOpen((x) => !x); setSetup(false); }}>
            <span className="bar-lbl-long">{L(lang, "Counter tabs", "Notes au comptoir")}</span>
            <span className="bar-lbl-short" aria-hidden="true">{L(lang, "Tabs", "Notes")}</span>{/* BAR FIT: phone = short labels, one header line */}
          </button>
          {canSetup && <button type="button" className="bar-outline-btn" aria-pressed={setup} aria-label={setup ? undefined : L(lang, "Set up tables", "Configurer les tables")}
            onClick={() => { setSetup((x) => !x); setCounterOpen(false); }}>
            {setup ? L(lang, "Done", "Terminé") : <><span className="bar-lbl-long">{L(lang, "Set up tables", "Configurer les tables")}</span><span className="bar-lbl-short" aria-hidden="true">⚙</span></>}</button>}
        </div>
      </header>

      <TablesRow lang={lang} floor={F} view={v} onHome={goHome}
        onTable={(t) => { dispatch({ type: "table", tableId: t.id }); setShowAll(false); }}
        extraPill={selNamed ? <button type="button" className="bar-pill is-on" aria-pressed="true">{selNamed.name}</button> : null} />

      {!isOnline && <div className="bar-msg" style={{ borderColor: "#ef4444", color: "#fca5a5" }}>
        {L(lang, "Offline — tabs cannot be opened, closed or paid until the connection is back.", "Hors ligne — impossible d'ouvrir, fermer ou encaisser une note avant le retour de la connexion.")}
      </div>}
      {msg && <div role="status" className="bar-msg" style={{ borderColor: msg.ok ? "#22c55e" : "#ef4444", color: msg.ok ? "#86efac" : "#fca5a5" }}>{msg.text}</div>}
      {floor.isError && <div className="bar-msg" style={{ borderColor: "#ef4444", color: "#fca5a5" }}>{errText(lang, floor.error)}</div>}
      {setup && canSetup && <div className="bar-panel"><SetupPanel lang={lang} barId={barId} zones={zones} tables={tables} busy={busy} act={act} patch={patch} /></div>}
      {counterOpen && F && <div className="bar-panel">
        <CounterTabsPanel lang={lang} barId={barId} named={named} busy={busy} act={act} tender={tender} setTender={setTender} shift={shift}
          onRounds={(t) => { dispatch({ type: "named", tabId: t.id }); setCounterOpen(false); setShowAll(false); }} />
      </div>}

      {v.view === HOME ? (
        // Home = the POS, embedded. key = branch: a branch switch mounts a fresh POS on the new branch's own cart.
        // BAR CART FIX (Peter 2026-11-18): mount it only once the APP's location IS this bar. The POS reads
        // its saved cart by the app location, and the setLocation effect above runs AFTER the child's
        // restore effect — so a POS mounted in the same render as the switch restored the OLD branch's cart.
        <div className="bar-home-body">
          {selectedLocation?.id !== barId ? <div className="bar-msg" role="status">{L(lang, "Loading…", "Chargement…")}</div> :
          <POSPage key={barId} embed={{
            locationId: barId,
            showAll,
            renderLeft: ({ addToCart, products, cart, fmt: pfmt, priceOf }) => (
              <QuickGrid key={`${barId}:home`} lang={lang} barId={barId} products={products} busy={cart.length > 0}
                onTap={(p) => addToCart(p, 1, true)} priceText={(p) => pfmt(priceOf(p))}
                allOpen={showAll} onAll={() => setShowAll((x) => !x)} />
            ),
          }} />}
        </div>
      ) : (
        <div className="bar-body">
          <TableSide key={`${barId}:${tabId || v.tableId || v.tabId}`} lang={lang} barId={barId} userId={userId} tabId={tabId}
            table={selTable} title={title} products={tabProducts.data || []} fmt={fmt} showAll={showAll} setShowAll={setShowAll}
            canServe={canServe} isOnline={isOnline} busy={busy} act={act} tender={tender} setTender={setTender} shift={shift} onChanged={refresh}
            onWrongBranch={goHome} />
        </div>
      )}
      {role === "cashier" && v.view !== HOME && <div style={{ fontSize: 12, opacity: 0.6, padding: "0 16px 10px" }}>{L(lang, "Taking payment needs a shift open at this bar.", "Encaisser demande un shift ouvert dans ce bar.")}</div>}
      {/* the POS shift-bar modal, at the page root (its stacking needs to be outside the scroll panes) */}
      <OpenShiftModal open={showOpenShift} onClose={() => setShowOpenShift(false)}
        onOpened={() => { setShowOpenShift(false); setRefusedNoShift(null); qc.invalidateQueries({ queryKey: ["current-shift", barId] }); refresh(); }} />
    </div>
  );
}

// ── Close / take payment on one tab (unchanged actions; moved from the floor cards) ──────────
export function TabActions({ lang, tab, busy, act, tender, setTender, shift }) {
  if (!tab) return null;
  const noShift = !!(shift && shift.need);
  const ver = tab.pa_sales?.version;
  const total = Number(tab.pa_sales?.total_amount) || 0;
  const tnd = tender[tab.id] || "cash";
  return tab.status === "open"
    ? <button className="bar-cbtn" style={btn} disabled={busy} onClick={() => act.mutate({ kind: "close", path: `/bar/tabs/${tab.id}/close` })}>{L(lang, "Close tab", "Fermer la note")}</button>
    // no shift: the hint + Open shift + Take payment take their OWN full-width line (else they crush the money block)
    : <span className={noShift ? "bar-pay-actions is-noshift" : "bar-pay-actions"} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...(noShift ? { flex: "1 1 100%", justifyContent: "flex-end" } : {}) }}>
        {total > 0 && <select value={tnd} onChange={(e) => setTender((m) => ({ ...m, [tab.id]: e.target.value }))} style={{ padding: 6, borderRadius: 8 }}>
          <option value="cash">{L(lang, "Cash", "Espèces")}</option>
          <option value="mobile_money">{L(lang, "Mobile money", "Mobile money")}</option>
        </select>}
        {noShift && <span className="bar-noshift" role="status">{L(lang, "Open a shift first", "Ouvrez d'abord un shift")}</span>}
        {noShift && <button type="button" className="bar-cbtn" style={btn} onClick={shift.open}>{L(lang, "Open shift", "Ouvrir un shift")}</button>}
        <button className="bar-cmain" disabled={busy || noShift} title={noShift ? L(lang, "Open a shift first", "Ouvrez d'abord un shift") : undefined}
          onClick={() => act.mutate({ kind: "pay", path: `/bar/tabs/${tab.id}/pay`, body: { version: ver, payment_method: tnd } })}>{L(lang, "Take payment", "Encaisser")}</button>
      </span>;
}
const statusWord = (lang, s) => s === "open" ? L(lang, "open", "ouverte") : L(lang, "closed — to pay", "fermée — à encaisser");

// ── Counter tabs (named) — the existing list + form, behind the header's "Counter tabs" button ──
export function CounterTabsPanel({ lang, barId, named, busy, act, tender, setTender, shift, onRounds }) {
  const [counterName, setCounterName] = useState("");
  const fmtMoney = useCurrency();
  // Names are free text, so two "Paul" tabs are normal: beside a repeated name we show who opened it and when.
  const dupNames = useMemo(() => {
    const c = new Map();
    for (const t of named) { const k = (t.name || "").toLowerCase(); c.set(k, (c.get(k) || 0) + 1); }
    return c;
  }, [named]);
  return (
    <section style={{ ...card, display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>{L(lang, "Counter tabs", "Notes au comptoir")}</h3>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={(e) => { e.preventDefault(); act.mutate({ kind: "open", path: `/bar/${barId}/tabs`, body: { name: counterName } }); setCounterName(""); }}>
        <input value={counterName} onChange={(e) => setCounterName(e.target.value)} maxLength={60} required
          placeholder={L(lang, "Name (who is it for?)", "Nom (pour qui ?)")} style={{ padding: 8, borderRadius: 8, minWidth: 200 }} />
        <button type="submit" style={btn} disabled={busy || !counterName.trim()}>{L(lang, "Open counter tab", "Ouvrir une note au comptoir")}</button>
      </form>
      {!named.length && <div style={{ opacity: 0.6, fontSize: 13 }}>{L(lang, "No counter tab open.", "Aucune note au comptoir ouverte.")}</div>}
      {named.map((t) => {
        const dup = (dupNames.get((t.name || "").toLowerCase()) || 0) > 1;
        const total = Number(t.pa_sales?.total_amount) || 0;
        return (
          <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid rgba(148,163,184,.2)", paddingTop: 8 }}>
            <strong>{t.name}</strong>
            <span style={{ fontSize: 12, opacity: dup ? 1 : 0.7, color: dup ? "var(--brand, #FBC503)" : undefined }}>
              {dup && "⚠ "}{t.waiter_name || t.opened_by_name || "?"} · {hhmm(t.opened_at)}
            </span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{statusWord(lang, t.status)}{t.figures ? ` · ${tabMoneyLine(lang, t.figures, fmtMoney)}` : total > 0 ? ` · ${fmtMoney(total)}` : ""}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
              {t.status === "open" && <button style={btn} disabled={busy} onClick={() => onRounds(t)}>{L(lang, "Rounds", "Tournées")}</button>}
              <TabActions lang={lang} tab={t} busy={busy} act={act} tender={tender} setTender={setTender} shift={shift} />
            </span>
          </div>
        );
      })}
    </section>
  );
}

// ── One table / counter tab: grid on the left, its bill on the right ─────────────────────────
// Send: a draft of products + whole quantities, one idempotency key per draft (a retry of the same
// draft can never become a second round; any edit to the draft takes a new key). Prices are the
// server's. Serve: the WHOLE round, only for a person the owner allowed (can_serve). Cancel: only
// while the round is still waiting. Online only, like every tab action.
export function TableSide({ lang, barId, userId, tabId, table, title, products, fmt, showAll, setShowAll, canServe, isOnline, busy, act, tender, setTender, shift, onChanged, onWrongBranch }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(null);          // { ok, text }
  const [search, setSearch] = useState("");
  const dKey = draftKey(userId, barId, tabId);
  const stored = useBarDraftStore((s) => (dKey ? s.drafts[dKey] : null));
  const draft = stored?.items || [];
  const roundKey = stored?.roundKey || null;
  const saveDraft = (items) => useBarDraftStore.getState().setDraft(dKey, items, newKey());   // a changed draft is a different round

  const tabQ = useQuery({ queryKey: ["bar-tab", tabId], enabled: !!tabId, queryFn: () => api.get(`/bar/tabs/${tabId}`).then((r) => r.data?.data), refetchInterval: 15000 });
  const T = tabQ.data;
  // second guard behind the reducer: a tab that is not on THIS branch is never shown or acted on
  const foreign = !!T && !tabBelongsToBar(T, barId);
  useEffect(() => { if (foreign) onWrongBranch(); }, [foreign]);   // eslint-disable-line react-hooks/exhaustive-deps

  const term = search.trim();
  const found = useQuery({
    queryKey: ["bar-products", barId, term], enabled: showAll && term.length >= 2, staleTime: 30000,
    queryFn: () => api.get(`/products?search=${encodeURIComponent(term)}&location_id=${barId}`).then((r) => r.data?.data || r.data || []),
  });
  const reload = () => { qc.invalidateQueries({ queryKey: ["bar-tab", tabId] }); onChanged(); };
  const run = useMutation({
    mutationFn: async ({ path, body }) => {
      if (!isOnline) { const e = new Error("offline"); e.offline = true; throw e; }
      return api.post(path, body).then((r) => r.data?.data);
    },
    onSuccess: (_d, vars) => { setNote({ ok: true, text: vars.okText }); if (vars.sent) useBarDraftStore.getState().clearDraft(dKey); reload(); },
    onError: (e) => { setNote({ ok: false, text: e.offline ? L(lang, "No connection — nothing was sent. Try again when you are online.", "Pas de connexion — rien n'a été envoyé. Réessayez une fois en ligne.") : errText(lang, e) }); reload(); },
  });
  const isOpen = !!T && !foreign && T.status === "open";
  const add = (p) => {
    if (!isOpen || p.is_multipart === true) return;
    saveDraft(draft.some((x) => x.id === p.id) ? draft.map((x) => x.id === p.id ? { ...x, qty: Math.min(999, x.qty + 1) } : x)
      : [...draft, { id: p.id, name: (lang === "en" && p.name_en) || p.name, price: Number(p.sell_price) || 0, qty: 1 }]);
  };
  const setQty = (id, q) => saveDraft(draft.map((x) => x.id === id ? { ...x, qty: Math.max(1, Math.min(999, q)) } : x));
  const drop = (id) => saveDraft(draft.filter((x) => x.id !== id));

  const saleV = T?.pa_sales?.version;
  const rounds = T?.rounds || [];
  const draftTotal = draft.reduce((s, x) => s + x.price * x.qty, 0);
  const words = { sent: L(lang, "waiting at the bar", "en attente au bar"), served: L(lang, "served", "servie"), cancelled: L(lang, "cancelled", "annulée") };
  // the floor's copy of the tab carries the version / total the tab actions need
  const floorTab = table?.tab || (T ? { ...T, pa_sales: T.pa_sales } : null);

  return (
    <>
      <div className="bar-left">
        <QuickGrid key={`${barId}:${tabId || "free"}`} lang={lang} barId={barId} products={products} busy={draft.length > 0}
          onTap={add} priceText={(p) => fmt(Number(p.sell_price) || 0)} allOpen={showAll} onAll={() => setShowAll((x) => !x)} />
        {showAll && (
          <div style={{ display: "grid", gap: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L(lang, "Find a product (2 letters or more)", "Chercher un produit (2 lettres ou plus)")}
              style={{ padding: 10, borderRadius: 10, background: "#0f1f3f", color: "#f8fafc", border: "1px solid rgba(148,163,184,.4)" }} />
            {term.length >= 2 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(found.data || []).slice(0, 12).map((p) => (
                  <button key={p.id} style={{ ...btn, fontSize: 13, padding: "6px 10px" }} disabled={p.is_multipart === true || !isOpen}
                    title={p.is_multipart ? L(lang, "Kits and shots: sell them in New Sale for now", "Ensembles et shots : vendez-les dans Nouvelle vente pour l'instant") : undefined}
                    onClick={() => add(p)}>+ {(lang === "en" && p.name_en) || p.name} · {fmt(Number(p.sell_price) || 0)}</button>
                ))}
                {found.data && !found.data.length && <span style={{ fontSize: 13, opacity: 0.6 }}>{L(lang, "No product found.", "Aucun produit trouvé.")}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BAR FIT: head fixed, rounds + draft scroll in the middle, Send round / Total / actions ALWAYS visible at the bottom */}
      <section className="bar-card bar-side-card">
        <div className="bar-card-head">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
          <span>{title}</span>
        </div>
        <div className="bar-card-body">
          {note && <div role="status" style={{ fontSize: 14, color: note.ok ? "#15803d" : "#b91c1c" }}>{note.text}</div>}
          {!tabId && table && (
            <>
              <div style={{ opacity: 0.7 }}>{L(lang, "This table is free.", "Cette table est libre.")}</div>
            </>
          )}
          {tabId && tabQ.isLoading && <div>{L(lang, "Loading…", "Chargement…")}</div>}
          {tabId && tabQ.isError && <div style={{ color: "#b91c1c" }}>{errText(lang, tabQ.error)}</div>}
          {T && !foreign && (
            <>
              {rounds.map((rd) => (
                <div key={rd.id} className="bar-line" style={{ display: "grid", gap: 4, opacity: rd.status === "cancelled" ? 0.5 : 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{L(lang, "Round", "Tournée")} {rd.round_no}</strong>
                    <span style={{ fontSize: 13, color: rd.status === "sent" ? "#b45309" : "#4b5563" }}>{words[rd.status] || rd.status}</span>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>{fmt(rd.total)}{rd.served_by_name ? ` · ${rd.served_by_name}` : ""}</span>
                    {rd.status === "sent" && (
                      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                        {canServe && <button className="bar-cmain" style={{ padding: "6px 12px", fontSize: 14 }} disabled={run.isPending} onClick={() => run.mutate({ path: `/bar/rounds/${rd.id}/serve`,
                          body: { version: rd.version, sale_version: saleV }, okText: L(lang, "Round served.", "Tournée servie.") })}>{L(lang, "Serve", "Servir")}</button>}
                        <button className="bar-cbtn" disabled={run.isPending} onClick={() => run.mutate({ path: `/bar/rounds/${rd.id}/cancel`,
                          body: { version: rd.version }, okText: L(lang, "Round cancelled.", "Tournée annulée.") })}>{L(lang, "Cancel", "Annuler")}</button>
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    {(rd.pa_bar_round_items || []).map((i) => `${Number(i.quantity)} × ${(lang === "en" && i.pa_products?.name_en) || i.pa_products?.name || "?"}`).join(", ")}
                  </div>
                </div>
              ))}
              {!rounds.length && <div style={{ opacity: 0.6, fontSize: 14 }}>{L(lang, "No round yet.", "Pas encore de tournée.")}</div>}
              {!canServe && rounds.some((r) => r.status === "sent") && <div style={{ fontSize: 13, opacity: 0.7 }}>
                {L(lang, "A bartender serves waiting rounds.", "Un barman sert les tournées en attente.")}</div>}

              {isOpen && (
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  <strong>{L(lang, "Next round", "Prochaine tournée")}</strong>
                  {!draft.length && <div style={{ fontSize: 14, opacity: 0.6 }}>{L(lang, "Tap products on the left to add them.", "Touchez les produits à gauche pour les ajouter.")}</div>}
                  {draft.map((x) => (
                    <div key={x.id} className="bar-line bar-draft-line">
                      <button className="bar-cbtn" style={{ padding: "2px 10px" }} aria-label="−" onClick={() => setQty(x.id, x.qty - 1)}>−</button>
                      <input type="number" min={1} max={999} value={x.qty} aria-label={L(lang, "Quantity", "Quantité")}
                        onChange={(e) => setQty(x.id, Math.floor(Number(e.target.value) || 1))} style={{ width: 56, textAlign: "center" }} />
                      <button className="bar-cbtn" style={{ padding: "2px 10px" }} aria-label="+" onClick={() => setQty(x.id, x.qty + 1)}>+</button>
                      <span style={{ fontWeight: 700 }}>{x.name}</span>
                      <span style={{ marginLeft: "auto", opacity: 0.8 }}>{fmt(x.price * x.qty)}</span>
                      <button className="bar-cbtn" style={{ padding: "2px 8px" }} aria-label={L(lang, "Remove", "Retirer")} onClick={() => drop(x.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="bar-card-foot">
          {!tabId && table && (
            <button className="bar-cmain" disabled={busy} onClick={() => act.mutate({ kind: "open", path: `/bar/${barId}/tabs`, body: { table_id: table.id } })}>{L(lang, "Open tab", "Ouvrir une note")}</button>
          )}
          {T && !foreign && isOpen && draft.length > 0 && (
            <button className="bar-cmain" disabled={run.isPending || !roundKey} onClick={() => run.mutate({ path: `/bar/tabs/${tabId}/rounds`, sent: true,
              body: { idempotency_key: roundKey, items: draft.map((x) => ({ product_id: x.id, quantity: x.qty })) },
              okText: L(lang, "Round sent to the bar.", "Tournée envoyée au bar.") })}>
              {L(lang, "Send round", "Envoyer la tournée")} · {fmt(draftTotal)}
            </button>
          )}
          {T && !foreign && (
            <div className="bar-foot-row">
              <TabMoney lang={lang} figures={T.figures} fallbackTotal={T.pa_sales?.total_amount} />
              <TabActions lang={lang} tab={floorTab} busy={busy} act={act} tender={tender} setTender={setTender} shift={shift} />
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export function SetupPanel({ lang, barId, zones, tables = [], busy, act, patch }) {
  const [zoneName, setZoneName] = useState("");
  const [label, setLabel] = useState("");
  const [zoneId, setZoneId] = useState("");
  return (
    <section style={{ ...card, display: "grid", gap: 10 }}>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={(e) => { e.preventDefault(); act.mutate({ kind: "zone", path: `/bar/${barId}/zones`, body: { name: zoneName } }); setZoneName(""); }}>
        <input value={zoneName} onChange={(e) => setZoneName(e.target.value)} maxLength={60} required
          placeholder={L(lang, "New zone (e.g. Terrace)", "Nouvelle zone (ex. Terrasse)")} style={{ padding: 8, borderRadius: 8 }} />
        <button type="submit" style={btn} disabled={busy || !zoneName.trim()}>{L(lang, "Add zone", "Ajouter la zone")}</button>
      </form>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={(e) => { e.preventDefault(); act.mutate({ kind: "table", path: `/bar/${barId}/tables`, body: { label, zone_id: zoneId || null } }); setLabel(""); }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required
          placeholder={L(lang, "Table name or number", "Nom ou numéro de table")} style={{ padding: 8, borderRadius: 8 }} />
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
          <option value="">{L(lang, "No zone", "Sans zone")}</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button type="submit" style={btn} disabled={busy || !label.trim()}>{L(lang, "Add table", "Ajouter la table")}</button>
      </form>
      {tables.some((t) => !t.tab) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, opacity: 0.7 }}>{L(lang, "Remove a free table:", "Retirer une table libre :")}</span>
          {tables.filter((t) => !t.tab).map((t) => (
            <button key={t.id} style={{ ...btn, fontSize: 12, padding: "4px 8px" }} disabled={busy}
              onClick={() => { if (window.confirm(L(lang, `Remove table ${t.label}?`, `Retirer la table ${t.label} ?`))) patch.mutate({ path: `/bar/tables/${t.id}`, body: { is_active: false } }); }}>
              {L(lang, "Remove", "Retirer")} {t.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
