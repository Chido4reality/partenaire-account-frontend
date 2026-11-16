// BAR MODE — build step 2 of 11 (docs/bar-mode-spec.md): the bar floor.
// Zones + tables (owner / manager set them up), table tabs and named counter tabs.
// Open → close → pay only: NO rounds and NO stock effect yet, so every tab is 0 F.
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

const L = (lang, en, fr) => (lang === "en" ? en : fr);
const errText = (lang, e) => {
  const d = e?.response?.data;
  if (d) return (lang === "en" ? d.message_en : d.message_fr) || d.message || L(lang, "Refused.", "Refusé.");
  return L(lang, "No connection — try again.", "Pas de connexion — réessayez.");
};
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

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

  const tabActions = (tab) => {
    if (!tab) return null;
    const ver = tab.pa_sales?.version;
    return tab.status === "open"
      ? <button style={btn} disabled={busy} onClick={() => act.mutate({ kind: "close", path: `/bar/tabs/${tab.id}/close` })}>{L(lang, "Close tab", "Fermer la note")}</button>
      : <button style={btnMain} disabled={busy} onClick={() => act.mutate({ kind: "pay", path: `/bar/tabs/${tab.id}/pay`, body: { version: ver } })}>{L(lang, "Take payment", "Encaisser")}</button>;
  };
  const statusWord = (s) => s === "open" ? L(lang, "open", "ouverte") : L(lang, "closed — to pay", "fermée — à encaisser");

  const tableCard = (t) => (
    <div key={t.id} style={{ ...card, minWidth: 150, borderColor: t.tab ? "var(--accent, #f59e0b)" : undefined }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{t.label}</div>
      {t.tab ? (
        <>
          <div style={{ fontSize: 12, opacity: 0.8, margin: "4px 0 8px" }}>
            {statusWord(t.tab.status)} · {t.tab.waiter_name || t.tab.opened_by_name || "?"} · {hhmm(t.tab.opened_at)}
          </div>
          {tabActions(t.tab)}
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
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {L(lang, "Rounds (drinks on a tab) come in the next step — for now a tab is opened, closed and paid at 0 F.",
          "Les tournées (boissons sur une note) arrivent à l'étape suivante — pour l'instant une note s'ouvre, se ferme et s'encaisse à 0 F.")}
      </div>

      {setup && canSetup && <SetupPanel lang={lang} barId={barId} zones={zones} busy={busy} act={act} />}

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
                <span style={{ fontSize: 12, opacity: 0.7 }}>{statusWord(t.status)}</span>
                <span style={{ marginLeft: "auto" }}>{tabActions(t)}</span>
              </div>
            );
          })}
        </section>
      )}
      {role === "cashier" && <div style={{ fontSize: 12, opacity: 0.6 }}>{L(lang, "Taking payment needs your till open at this bar.", "Encaisser demande votre caisse ouverte dans ce bar.")}</div>}
    </div>
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
