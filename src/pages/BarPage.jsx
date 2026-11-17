// BAR MODE — build steps 2 + 3a (docs/bar-mode-spec.md): the bar floor.
// Zones + tables (owner / manager set them up), table tabs and named counter tabs.
// 3a: ROUNDS on an open tab (TabPanel): send a round of products, the bartender SERVES it whole
// (that reserves the stock) or it is cancelled while still waiting. The tab's total is what was
// served. Close → pay with ONE tender (cash or mobile money); the stock leaves the shelf at pay.
// A tab with nothing served still ends cancelled.
//
// Reached only from the "Bar" menu entry, which shows only when GET /bar/mine lists a bar for this
// person (Bar Mode on + Pro Plus + a location ticked as a bar). Every action is refused by the
// server anywhere else, so typing /bar at a shop shows "no bar" and nothing more.
//
// ONLINE ONLY (spec decision 12): opening, closing and paying are refused here while offline, with
// a sentence, and are never queued — a tab replayed later could collide with a colleague's.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useAuthStore, useLangStore } from "../store";
import { useNetworkStatus } from "../utils/useNetworkStatus";
import { SHOP_TZ } from "../utils/shopTime";

const L = (lang, en, fr) => (lang === "en" ? en : fr);
const errText = (lang, e) => {
  const d = e?.response?.data;
  if (d) return (lang === "en" ? d.message_en : d.message_fr) || d.message || L(lang, "Refused.", "Refusé.");
  return L(lang, "No connection — try again.", "Pas de connexion — réessayez.");
};
// shop time (WAT), never the device's zone
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: SHOP_TZ }); } catch { return ""; } };

const money = (v) => `${(Number(v) || 0).toLocaleString("fr-FR")} F`;
// one key per round draft: a retry of the SAME draft can never make a second round (server: one round per key per tab)
const newKey = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

const card = { background: "var(--card-bg, rgba(255,255,255,0.04))", border: "1px solid var(--border, rgba(255,255,255,0.12))", borderRadius: 12, padding: 14 };
const btn = { padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border, rgba(255,255,255,0.2))", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 600 };
const btnMain = { ...btn, background: "var(--accent, #f59e0b)", color: "#111", border: "none" };

export default function BarPage() {
  const { lang } = useLangStore();
  const role = useAuthStore((s) => s.user?.role);
  const { isOnline } = useNetworkStatus();
  const qc = useQueryClient();
  const [pickedBar, setBarId] = useState(null);
  const [msg, setMsg] = useState(null);       // { ok, text }
  const [counterName, setCounterName] = useState("");
  const [setup, setSetup] = useState(false);
  const [openTab, setOpenTab] = useState(null);   // { id, title } — the tab whose rounds are shown
  const [tender, setTender] = useState({});       // tab id → "cash" | "mobile_money"

  const mine = useQuery({ queryKey: ["bar-mine"], queryFn: () => api.get("/bar/mine").then((r) => r.data?.data || { bars: [] }), staleTime: 60000 });
  const bars = mine.data?.bars || [];
  // the picked bar, else the first one — chosen on the FIRST render, so the floor never flashes empty
  const barId = (pickedBar && bars.some((b) => b.id === pickedBar)) ? pickedBar : (bars[0]?.id || null);

  const floor = useQuery({
    queryKey: ["bar-floor", barId], enabled: !!barId,
    queryFn: () => api.get(`/bar/${barId}/floor`).then((r) => r.data?.data),
    refetchInterval: 20000, refetchOnWindowFocus: true,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["bar-floor", barId] });
  const act = useMutation({
    mutationFn: async ({ kind, path, body }) => {
      if (!isOnline) { const e = new Error("offline"); e.offline = true; throw e; }
      return api.post(path, body || {}).then((r) => ({ kind, data: r.data?.data }));
    },
    onSuccess: ({ kind }) => {
      setMsg({ ok: true, text: ({ open: L(lang, "Tab opened.", "Note ouverte."), close: L(lang, "Tab closed.", "Note fermée."),
        pay: L(lang, "Tab paid.", "Note encaissée."), zone: L(lang, "Zone added.", "Zone ajoutée."), table: L(lang, "Table added.", "Table ajoutée.") })[kind] || "OK" });
      if (kind === "open") setCounterName("");
      refresh();
    },
    onError: (e) => {
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

  const F = floor.data;
  const zones = F?.zones || [];
  const tables = F?.tables || [];
  const named = F?.named_tabs || [];
  // Names are free text, so two "Paul" tabs are normal: beside a repeated name we show who opened it and when.
  const dupNames = useMemo(() => {
    const c = new Map();
    for (const t of named) { const k = (t.name || "").toLowerCase(); c.set(k, (c.get(k) || 0) + 1); }
    return c;
  }, [named]);
  const canSetup = mine.data?.can_setup === true;
  const busy = act.isPending || patch.isPending;

  if (mine.isLoading) return <div style={{ padding: 20 }}>{L(lang, "Loading…", "Chargement…")}</div>;
  if (mine.isError) return <div style={{ padding: 20 }}>{L(lang, "Could not load the bar. Check the connection.", "Impossible de charger le bar. Vérifiez la connexion.")}</div>;
  if (!bars.length) return <div style={{ padding: 20 }}>{L(lang, "No bar is set up for you.", "Aucun bar n'est configuré pour vous.")}</div>;

  const tabActions = (tab, title) => {
    if (!tab) return null;
    const ver = tab.pa_sales?.version;
    const total = Number(tab.pa_sales?.total_amount) || 0;
    const tnd = tender[tab.id] || "cash";
    return tab.status === "open"
      ? <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          <button style={btn} disabled={busy} onClick={() => setOpenTab({ id: tab.id, title })}>{L(lang, "Rounds", "Tournées")}</button>
          <button style={btn} disabled={busy} onClick={() => act.mutate({ kind: "close", path: `/bar/tabs/${tab.id}/close` })}>{L(lang, "Close tab", "Fermer la note")}</button>
        </span>
      : <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {total > 0 && <select value={tnd} onChange={(e) => setTender((m) => ({ ...m, [tab.id]: e.target.value }))} style={{ padding: 6, borderRadius: 8 }}>
            <option value="cash">{L(lang, "Cash", "Espèces")}</option>
            <option value="mobile_money">{L(lang, "Mobile money", "Mobile money")}</option>
          </select>}
          <button style={btnMain} disabled={busy} onClick={() => act.mutate({ kind: "pay", path: `/bar/tabs/${tab.id}/pay`, body: { version: ver, payment_method: tnd } })}>{L(lang, "Take payment", "Encaisser")}</button>
        </span>;
  };
  const totalOf = (tab) => (Number(tab?.pa_sales?.total_amount) > 0 ? ` · ${money(tab.pa_sales.total_amount)}` : "");
  const statusWord = (s) => s === "open" ? L(lang, "open", "ouverte") : L(lang, "closed — to pay", "fermée — à encaisser");

  const tableCard = (t) => (
    <div key={t.id} style={{ ...card, minWidth: 150, borderColor: t.tab ? "var(--accent, #f59e0b)" : undefined }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{t.label}</div>
      {t.tab ? (
        <>
          <div style={{ fontSize: 12, opacity: 0.8, margin: "4px 0 8px" }}>
            {statusWord(t.tab.status)} · {t.tab.waiter_name || t.tab.opened_by_name || "?"} · {hhmm(t.tab.opened_at)}{totalOf(t.tab)}
          </div>
          {tabActions(t.tab, t.label)}
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, opacity: 0.6, margin: "4px 0 8px" }}>{L(lang, "free", "libre")}</div>
          <button style={btn} disabled={busy} onClick={() => act.mutate({ kind: "open", path: `/bar/${barId}/tabs`, body: { table_id: t.id } })}>{L(lang, "Open tab", "Ouvrir une note")}</button>
        </>
      )}
      {setup && canSetup && !t.tab && (
        <div style={{ marginTop: 8 }}>
          <button style={{ ...btn, fontSize: 12, padding: "4px 8px" }} disabled={busy}
            onClick={() => { if (window.confirm(L(lang, `Remove table ${t.label}?`, `Retirer la table ${t.label} ?`))) patch.mutate({ path: `/bar/tables/${t.id}`, body: { is_active: false } }); }}>
            {L(lang, "Remove", "Retirer")}
          </button>
        </div>
      )}
    </div>
  );

  const groups = [...zones.map((z) => ({ key: z.id, name: z.name, tables: tables.filter((t) => t.zone_id === z.id) })),
    { key: "none", name: zones.length ? L(lang, "No zone", "Sans zone") : null, tables: tables.filter((t) => !t.zone_id || !zones.some((z) => z.id === t.zone_id)) }]
    .filter((g) => g.tables.length || (setup && g.key !== "none"));

  return (
    <div style={{ padding: 16, display: "grid", gap: 14, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>🍺 {L(lang, "Bar", "Bar")}</h2>
        {bars.length > 1 && (
          <select value={barId || ""} onChange={(e) => { setBarId(e.target.value); setMsg(null); }} style={{ padding: 6, borderRadius: 8 }}>
            {bars.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {bars.length === 1 && <span style={{ opacity: 0.8 }}>{bars[0].name}</span>}
        {canSetup && <button style={{ ...btn, marginLeft: "auto" }} onClick={() => setSetup((v) => !v)}>{setup ? L(lang, "Done", "Terminé") : L(lang, "Set up tables", "Configurer les tables")}</button>}
      </div>

      {!isOnline && <div style={{ ...card, borderColor: "#ef4444", color: "#f87171" }}>
        {L(lang, "Offline — tabs cannot be opened, closed or paid until the connection is back.", "Hors ligne — impossible d'ouvrir, fermer ou encaisser une note avant le retour de la connexion.")}
      </div>}
      {msg && <div role="status" style={{ ...card, borderColor: msg.ok ? "#22c55e" : "#ef4444", color: msg.ok ? "#4ade80" : "#f87171" }}>{msg.text}</div>}
      {setup && canSetup && <SetupPanel lang={lang} barId={barId} zones={zones} busy={busy} act={act} />}
      {openTab && <TabPanel key={openTab.id} lang={lang} tabId={openTab.id} title={openTab.title} barId={barId}
        canServe={mine.data?.can_serve === true} isOnline={isOnline} onClose={() => setOpenTab(null)} onChanged={refresh} />}

      {floor.isLoading && <div>{L(lang, "Loading…", "Chargement…")}</div>}
      {floor.isError && <div style={{ color: "#f87171" }}>{errText(lang, floor.error)}</div>}

      {F && groups.map((g) => (
        <section key={g.key} style={{ display: "grid", gap: 8 }}>
          {g.name && <h3 style={{ margin: "4px 0" }}>{g.name}</h3>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{g.tables.map(tableCard)}</div>
        </section>
      ))}
      {F && !tables.length && <div style={{ opacity: 0.7 }}>{canSetup
        ? L(lang, "No tables yet — press “Set up tables”.", "Pas encore de tables — appuyez sur « Configurer les tables ».")
        : L(lang, "No tables yet — ask the owner or a manager to add them.", "Pas encore de tables — demandez au propriétaire ou à un gérant de les ajouter.")}</div>}

      {F && (
        <section style={{ ...card, display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0 }}>{L(lang, "Counter tabs", "Notes au comptoir")}</h3>
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            onSubmit={(e) => { e.preventDefault(); act.mutate({ kind: "open", path: `/bar/${barId}/tabs`, body: { name: counterName } }); }}>
            <input value={counterName} onChange={(e) => setCounterName(e.target.value)} maxLength={60} required
              placeholder={L(lang, "Name (who is it for?)", "Nom (pour qui ?)")} style={{ padding: 8, borderRadius: 8, minWidth: 200 }} />
            <button type="submit" style={btn} disabled={busy || !counterName.trim()}>{L(lang, "Open counter tab", "Ouvrir une note au comptoir")}</button>
          </form>
          {!named.length && <div style={{ opacity: 0.6, fontSize: 13 }}>{L(lang, "No counter tab open.", "Aucune note au comptoir ouverte.")}</div>}
          {named.map((t) => {
            const dup = (dupNames.get((t.name || "").toLowerCase()) || 0) > 1;
            return (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border, rgba(255,255,255,0.08))", paddingTop: 8 }}>
                <strong>{t.name}</strong>
                <span style={{ fontSize: 12, opacity: dup ? 1 : 0.7, color: dup ? "var(--accent, #f59e0b)" : undefined }}>
                  {dup && "⚠ "}{t.waiter_name || t.opened_by_name || "?"} · {hhmm(t.opened_at)}
                </span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{statusWord(t.status)}{totalOf(t)}</span>
                <span style={{ marginLeft: "auto" }}>{tabActions(t, t.name)}</span>
              </div>
            );
          })}
        </section>
      )}
      {role === "cashier" && <div style={{ fontSize: 12, opacity: 0.6 }}>{L(lang, "Taking payment needs your till open at this bar.", "Encaisser demande votre caisse ouverte dans ce bar.")}</div>}
    </div>
  );
}

// ── ROUNDS on one tab (3a) ───────────────────────────────────────────────────────────────────
// Send: a draft of products + whole quantities, one idempotency key per draft (a retry of the same
// draft can never become a second round; any edit to the draft takes a new key). Prices are the
// server's. Serve: the WHOLE round, only for a person the owner allowed (can_serve). Cancel: only
// while the round is still waiting. Online only, like every tab action.
function TabPanel({ lang, tabId, title, barId, canServe, isOnline, onClose, onChanged }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState([]);          // [{ id, name, price, qty }]
  const [key, setKey] = useState(newKey);
  const [note, setNote] = useState(null);          // { ok, text }
  const tabQ = useQuery({ queryKey: ["bar-tab", tabId], queryFn: () => api.get(`/bar/tabs/${tabId}`).then((r) => r.data?.data), refetchInterval: 15000 });
  const term = search.trim();
  const found = useQuery({
    queryKey: ["bar-products", barId, term], enabled: term.length >= 2, staleTime: 30000,
    queryFn: () => api.get(`/products?search=${encodeURIComponent(term)}&location_id=${barId}`).then((r) => r.data?.data || r.data || []),
  });
  const reload = () => { qc.invalidateQueries({ queryKey: ["bar-tab", tabId] }); onChanged(); };
  const run = useMutation({
    mutationFn: async ({ path, body }) => {
      if (!isOnline) { const e = new Error("offline"); e.offline = true; throw e; }
      return api.post(path, body).then((r) => r.data?.data);
    },
    onSuccess: (_d, v) => { setNote({ ok: true, text: v.okText }); if (v.sent) { setDraft([]); setKey(newKey()); setSearch(""); } reload(); },
    onError: (e) => { setNote({ ok: false, text: e.offline ? L(lang, "No connection — nothing was sent. Try again when you are online.", "Pas de connexion — rien n'a été envoyé. Réessayez une fois en ligne.") : errText(lang, e) }); reload(); },
  });
  const editDraft = (fn) => { setDraft(fn); setKey(newKey()); };   // a changed draft is a different round
  const add = (p) => editDraft((d) => d.some((x) => x.id === p.id) ? d.map((x) => x.id === p.id ? { ...x, qty: Math.min(999, x.qty + 1) } : x)
    : [...d, { id: p.id, name: p.name, price: Number(p.sell_price) || 0, qty: 1 }]);
  const setQty = (id, q) => editDraft((d) => d.map((x) => x.id === id ? { ...x, qty: Math.max(1, Math.min(999, q)) } : x));
  const drop = (id) => editDraft((d) => d.filter((x) => x.id !== id));

  const T = tabQ.data;
  const saleV = T?.pa_sales?.version;
  const rounds = T?.rounds || [];
  const isOpen = T?.status === "open";
  const draftTotal = draft.reduce((s, x) => s + x.price * x.qty, 0);
  const words = { sent: L(lang, "waiting at the bar", "en attente au bar"), served: L(lang, "served", "servie"), cancelled: L(lang, "cancelled", "annulée") };

  return (
    <section style={{ ...card, display: "grid", gap: 10, borderColor: "var(--accent, #f59e0b)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {T && <span style={{ fontWeight: 700 }}>{money(T.pa_sales?.total_amount)}</span>}
        <button style={{ ...btn, marginLeft: "auto" }} onClick={onClose}>{L(lang, "Back to the floor", "Retour à la salle")}</button>
      </div>
      {note && <div role="status" style={{ fontSize: 13, color: note.ok ? "#4ade80" : "#f87171" }}>{note.text}</div>}
      {tabQ.isLoading && <div>{L(lang, "Loading…", "Chargement…")}</div>}
      {tabQ.isError && <div style={{ color: "#f87171" }}>{errText(lang, tabQ.error)}</div>}

      {rounds.map((rd) => (
        <div key={rd.id} style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.08))", paddingTop: 8, opacity: rd.status === "cancelled" ? 0.5 : 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{L(lang, "Round", "Tournée")} {rd.round_no}</strong>
            <span style={{ fontSize: 12, color: rd.status === "sent" ? "var(--accent, #f59e0b)" : undefined }}>{words[rd.status] || rd.status}</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{money(rd.total)}{rd.served_by_name ? ` · ${rd.served_by_name}` : ""}</span>
            {rd.status === "sent" && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                {canServe && <button style={btnMain} disabled={run.isPending} onClick={() => run.mutate({ path: `/bar/rounds/${rd.id}/serve`,
                  body: { version: rd.version, sale_version: saleV }, okText: L(lang, "Round served.", "Tournée servie.") })}>{L(lang, "Serve", "Servir")}</button>}
                <button style={btn} disabled={run.isPending} onClick={() => run.mutate({ path: `/bar/rounds/${rd.id}/cancel`,
                  body: { version: rd.version }, okText: L(lang, "Round cancelled.", "Tournée annulée.") })}>{L(lang, "Cancel", "Annuler")}</button>
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            {(rd.pa_bar_round_items || []).map((i) => `${Number(i.quantity)} × ${(lang === "en" && i.pa_products?.name_en) || i.pa_products?.name || "?"}`).join(", ")}
          </div>
        </div>
      ))}
      {T && !rounds.length && <div style={{ opacity: 0.6, fontSize: 13 }}>{L(lang, "No round yet.", "Pas encore de tournée.")}</div>}
      {T && !canServe && rounds.some((r) => r.status === "sent") && <div style={{ fontSize: 12, opacity: 0.7 }}>
        {L(lang, "A bartender serves waiting rounds.", "Un barman sert les tournées en attente.")}</div>}

      {T && isOpen && (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border, rgba(255,255,255,0.12))", paddingTop: 10 }}>
          <strong>{L(lang, "New round", "Nouvelle tournée")}</strong>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={L(lang, "Find a product (2 letters or more)", "Chercher un produit (2 lettres ou plus)")}
            style={{ padding: 8, borderRadius: 8 }} />
          {term.length >= 2 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(found.data || []).slice(0, 12).map((p) => (
                <button key={p.id} style={{ ...btn, fontSize: 13, padding: "6px 10px" }} disabled={p.is_multipart === true}
                  title={p.is_multipart ? L(lang, "Kits and shots: at the till for now", "Ensembles et shots : à la caisse pour l'instant") : undefined}
                  onClick={() => add(p)}>+ {(lang === "en" && p.name_en) || p.name} · {money(p.sell_price)}</button>
              ))}
              {found.data && !found.data.length && <span style={{ fontSize: 13, opacity: 0.6 }}>{L(lang, "No product found.", "Aucun produit trouvé.")}</span>}
            </div>
          )}
          {draft.map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ ...btn, padding: "2px 10px" }} onClick={() => setQty(x.id, x.qty - 1)}>−</button>
              <span style={{ minWidth: 24, textAlign: "center" }}>{x.qty}</span>
              <button style={{ ...btn, padding: "2px 10px" }} onClick={() => setQty(x.id, x.qty + 1)}>+</button>
              <span>{x.name}</span>
              <span style={{ opacity: 0.7, fontSize: 13 }}>{money(x.price * x.qty)}</span>
              <button style={{ ...btn, padding: "2px 8px", marginLeft: "auto" }} onClick={() => drop(x.id)}>✕</button>
            </div>
          ))}
          {draft.length > 0 && (
            <button style={btnMain} disabled={run.isPending} onClick={() => run.mutate({ path: `/bar/tabs/${tabId}/rounds`, sent: true,
              body: { idempotency_key: key, items: draft.map((x) => ({ product_id: x.id, quantity: x.qty })) },
              okText: L(lang, "Round sent to the bar.", "Tournée envoyée au bar.") })}>
              {L(lang, "Send round", "Envoyer la tournée")} · {money(draftTotal)}
            </button>
          )}
        </div>
      )}
      {T && !isOpen && <div style={{ fontSize: 13, opacity: 0.7 }}>{L(lang, "This tab is closed — take payment from the floor.", "Cette note est fermée — encaissez depuis la salle.")}</div>}
    </section>
  );
}

function SetupPanel({ lang, barId, zones, busy, act }) {
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
    </section>
  );
}
