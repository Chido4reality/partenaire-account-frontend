// BAR LAYOUT (Peter 2026-11-18) — the compact row under the bar header: Home fixed on the left, then
// the branch's real tables grouped by area ("Terrasse  T1 · Open  T2 · Free"). The tables scroll
// sideways on one line; Home never scrolls away. Selected = filled amber; a table with an open bill
// = amber outline; free = light outline.
const L = (lang, en, fr) => (lang === "en" ? en : fr);

export default function TablesRow({ lang, floor, view, onHome, onTable, extraPill }) {
  const zones = floor?.zones || [];
  const tables = floor?.tables || [];
  const groups = [...zones.map((z) => ({ key: z.id, name: z.name, tables: tables.filter((t) => t.zone_id === z.id) })),
    { key: "none", name: null, tables: tables.filter((t) => !t.zone_id || !zones.some((z) => z.id === t.zone_id)) }]
    .filter((g) => g.tables.length);
  const status = (t) => !t.tab ? L(lang, "Free", "Libre") : t.tab.status === "open" ? L(lang, "Open", "Ouverte") : L(lang, "To pay", "À encaisser");
  const homeOn = view?.view === "home";
  return (
    <nav className="bar-row" aria-label={L(lang, "Tables", "Tables")}>
      <button type="button" className={`bar-home${homeOn ? " is-on" : ""}`} onClick={onHome} aria-pressed={homeOn}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        </svg>
        {L(lang, "Home", "Accueil")}
      </button>
      <span className="bar-row-sep" aria-hidden="true" />
      <div className="bar-row-scroll">
        {groups.map((g) => (
          <span key={g.key} className="bar-row-group">
            {g.name && <span className="bar-zone">{g.name}</span>}
            {g.tables.map((t) => {
              const on = view?.view === "table" && view.tableId === t.id;
              const cls = on ? " is-on" : t.tab ? " has-bill" : "";
              return (
                <button type="button" key={t.id} className={`bar-pill${cls}`} onClick={() => onTable(t)} aria-pressed={on}>
                  {t.is_vip && <span title="VIP" aria-label="VIP">👑 </span>}<b>{t.label}</b> · {status(t)}
                </button>
              );
            })}
          </span>
        ))}
        {extraPill}
        {!groups.length && <span className="bar-zone" style={{ opacity: 0.6 }}>{L(lang, "No tables yet", "Pas encore de tables")}</span>}
      </div>
    </nav>
  );
}
