// ============================================================================
// MP-COMPARE — Compare two months, or two locations (Peter, 2026-09-25)
//
// Default: LIKE-FOR-LIKE — this month day 1 → today against the same days of
// last month (clamped for short months). "Full months" opens any month against
// any month. Each side is (month, location); the same location twice compares
// months, the same month twice compares locations.
//
// Every figure comes from GET /reports/compare, which sums what Reports /daily
// already shows (and the ledger's own rules for debt collected / refunds) — the
// page does no money arithmetic of its own beyond displaying the server's
// difference and percentage.
//
// Access is decided on the SERVER (Pro / Pro Plus; owner; manager with the
// grant). The page only renders what the server says, including its refusal.
// ============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLangStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { useOfflineCachedQuery } from "../utils/offlineQuery";

const METRIC_LABEL = {
  sales:          { en: "Sales",           fr: "Ventes" },
  gross_profit:   { en: "Gross profit",    fr: "Marge brute" },
  credit_given:   { en: "Credit given",    fr: "Crédit accordé" },
  debt_collected: { en: "Debt collected",  fr: "Dettes encaissées" },
  expenses:       { en: "Expenses",        fr: "Dépenses" },
  refunds:        { en: "Refunds",         fr: "Remboursements" },
  net_cash:       { en: "Net cash",        fr: "Trésorerie nette" },
};

function thisMonthKey() {
  // The server decides "today" in the shop's local day; this is only the
  // picker's starting value, so the device month is close enough.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function prevMonthKey(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function ComparePage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const locale = en ? "en-GB" : "fr-FR";

  const [full, setFull] = useState(false);
  const [monthA, setMonthA] = useState(thisMonthKey());
  const [monthB, setMonthB] = useState(prevMonthKey(thisMonthKey()));
  const [locA, setLocA] = useState("all");
  const [locB, setLocB] = useState("all");

  const { data: locationsData } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then((r) => r.data),
    staleTime: 300000,
  });
  const locations = locationsData?.data || [];

  const params = new URLSearchParams({ mode: full ? "full" : "like", location_a: locA, location_b: locB });
  if (full) { params.set("a", monthA); params.set("b", monthB); }
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["compare", params.toString()],
    // A month of paged reads on both sides can take longer than the client's
    // default 6 s timeout.
    queryFn: () => api.get(`/reports/compare?${params.toString()}`, { timeout: 60000 }).then((r) => r.data.data),
    retry: false,
    staleTime: 60000,
  });

  const monthName = (ym) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${ym}-01T00:00:00Z`));
  const dayRange = (side) => {
    const from = new Date(`${side.from}T00:00:00Z`), to = new Date(`${side.to}T00:00:00Z`);
    const f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return `${f.format(from)} – ${f.format(to)} ${to.getUTCFullYear()}`;
  };
  const sideTitle = (side) => `${side.location_name ? side.location_name.trim() : (en ? "All locations" : "Tous les points de vente")}`;
  const dateTime = (iso) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala" }).format(new Date(iso));

  const refusal = error?.response?.status === 403
    ? (error.response.data?.code === "not_permitted"
        ? (en ? error.response.data.message_en : error.response.data.message_fr)
        : (en ? error.response.data?.message_en || "Compare is part of the Pro plan." : error.response.data?.message_fr || "La comparaison fait partie du forfait Pro."))
    : null;

  const LocSelect = ({ value, onChange }) => (
    <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}>
      <option value="all">{en ? "All locations" : "Tous les points de vente"}</option>
      {locations.map((l) => <option key={l.id} value={l.id}>{(l.name || "").trim()}</option>)}
    </select>
  );

  const tone = (m) => {
    if (m.diff === 0 || m.diff === null) return "var(--text-muted, #888)";
    const up = m.diff > 0;
    return up === m.higher_is_better ? "#16a34a" : "#dc2626";
  };
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
  const pctText = (p) => (p === null ? "—" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toLocaleString(locale)} %`);

  const capitalStatus = (c) => {
    if (!c) return "";
    if (c.source === "live") return en ? "Live — today" : "En direct — aujourd'hui";
    if (c.source === "none") return en ? "No data yet" : "Pas encore de données";
    const when = c.captured_at ? dateTime(c.captured_at) : "";
    const partial = c.source === "partial"
      ? (en ? ` · only ${c.locations_found} of ${c.locations_expected} locations` : ` · seulement ${c.locations_found} sur ${c.locations_expected} points de vente`)
      : "";
    return c.captured_late
      ? (en ? `Captured late, on ${when} — not a month-end figure${partial}` : `Relevé en retard, le ${when} — pas un chiffre de fin de mois${partial}`)
      : (en ? `Month-end snapshot · ${when}${partial}` : `Relevé de fin de mois · ${when}${partial}`);
  };
  const capitalCell = (c, k) => (c && c.source !== "none" ? fmt(c[k] || 0) : "—");

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        .cmp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .cmp-table { width: 100%; border-collapse: collapse; }
        .cmp-table th, .cmp-table td { padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border, #e5e7eb); white-space: nowrap; }
        .cmp-table th:first-child, .cmp-table td:first-child { text-align: left; white-space: normal; }
        .cmp-cards { display: none; }
        @media (max-width: 640px) {
          .cmp-grid { grid-template-columns: minmax(0, 1fr); }
          .cmp-table-wrap { display: none; }
          .cmp-cards { display: grid; gap: 10px; }
        }
      `}</style>

      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>{en ? "Compare" : "Comparer"}</h1>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontWeight: 600 }}>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          {en ? "Full months" : "Mois complets"}
          <span style={{ fontWeight: 400, color: "var(--text-muted, #888)", fontSize: 13 }}>
            {full
              ? (en ? "— any month against any month" : "— n'importe quel mois contre n'importe quel mois")
              : (en ? "— off: this month so far against the same days of last month"
                    : "— désactivé : ce mois jusqu'à aujourd'hui contre les mêmes jours du mois dernier")}
          </span>
        </label>
        <div className="cmp-grid">
          {[["A", monthA, setMonthA, locA, setLocA], ["B", monthB, setMonthB, locB, setLocB]].map(([k, m, setM, l, setL]) => (
            <div key={k} style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{k}</div>
              {full
                ? <input className="form-input" type="month" value={m} max={thisMonthKey()} onChange={(e) => e.target.value && setM(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
                : <div style={{ marginBottom: 8, color: "var(--text-muted, #888)", fontSize: 13 }}>
                    {data ? `${monthName(data[k.toLowerCase()].month)} · ${dayRange(data[k.toLowerCase()])}` : "…"}
                  </div>}
              <LocSelect value={l} onChange={setL} />
            </div>
          ))}
        </div>
        {!full && data?.b?.clamped && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted, #888)" }}>
            {en ? `${monthName(data.b.month)} is shorter — compared up to its last day.`
                : `${monthName(data.b.month)} est plus court — comparé jusqu'à son dernier jour.`}
          </div>
        )}
      </div>

      {refusal && <div className="card" style={{ padding: 16, color: "#b91c1c" }}>{refusal}</div>}
      {!refusal && error && <div className="card" style={{ padding: 16, color: "#b91c1c" }}>
        {en ? "The comparison could not be loaded. Please try again." : "La comparaison n'a pas pu être chargée. Veuillez réessayer."}</div>}
      {isLoading && <div className="card" style={{ padding: 16 }}>{en ? "Loading…" : "Chargement…"}</div>}

      {data && (
        <>
          <div className="card cmp-table-wrap" style={{ padding: 0, overflow: "auto", opacity: isFetching ? 0.6 : 1 }}>
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>{en ? "Figure" : "Indicateur"}</th>
                  <th>A · {sideTitle(data.a)}<div style={{ fontWeight: 400, fontSize: 12 }}>{dayRange(data.a)}</div></th>
                  <th>B · {sideTitle(data.b)}<div style={{ fontWeight: 400, fontSize: 12 }}>{dayRange(data.b)}</div></th>
                  <th>{en ? "Difference" : "Écart"}</th>
                  <th>{en ? "% change" : "Variation %"}</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((m) => (
                  <tr key={m.key}>
                    <td>{METRIC_LABEL[m.key][en ? "en" : "fr"]}
                      {m.key === "gross_profit" && <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
                        {en ? "margin" : "marge"} {data.gross_margin_pct.a ?? "—"} % · {data.gross_margin_pct.b ?? "—"} %</div>}
                    </td>
                    <td>{fmt(m.a)}</td>
                    <td>{fmt(m.b)}</td>
                    <td style={{ color: tone(m), fontWeight: 600 }}>{signed(m.diff)}</td>
                    <td style={{ color: tone(m) }}>{pctText(m.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cmp-cards">
            {data.metrics.map((m) => (
              <div key={m.key} className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{METRIC_LABEL[m.key][en ? "en" : "fr"]}</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span>A</span><span style={{ whiteSpace: "nowrap" }}>{fmt(m.a)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span>B</span><span style={{ whiteSpace: "nowrap" }}>{fmt(m.b)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: tone(m), fontWeight: 600 }}>
                  <span>{en ? "Difference" : "Écart"}</span><span style={{ whiteSpace: "nowrap" }}>{signed(m.diff)} · {pctText(m.pct)}</span></div>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>{en ? "Capital (stock at cost)" : "Capital (stock au coût)"}</h2>
          <div className="cmp-grid">
            {["a", "b"].map((k) => {
              const c = data.capital[k];
              return (
                <div key={k} className="card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700 }}>{k.toUpperCase()} · {sideTitle(data[k])} · {monthName(data[k].month)}</div>
                  <div style={{ fontSize: 12, marginBottom: 10, color: c.source === "none" || c.captured_late ? "#b45309" : "var(--text-muted, #888)" }}>
                    {capitalStatus(c)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 700 }}>
                    <span>{en ? "Capital — sellable stock" : "Capital — stock vendable"}</span><span style={{ whiteSpace: "nowrap" }}>{capitalCell(c, "sellable")}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginTop: 6 }}>
                    <span>{en ? "Damaged stock (not in capital)" : "Stock abîmé (hors capital)"}</span><span style={{ whiteSpace: "nowrap" }}>{capitalCell(c, "damaged")}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginTop: 4 }}>
                    <span>{en ? "Goods in transit (not in capital)" : "Marchandises en transit (hors capital)"}</span><span style={{ whiteSpace: "nowrap" }}>{capitalCell(c, "in_transit")}</span></div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 12 }}>
            {en ? "Past months show the stock recorded when that month closed, at the cost price of that moment. A month the app never recorded shows no data."
                : "Les mois passés montrent le stock relevé à la clôture du mois, au prix de revient de ce moment. Un mois jamais relevé n'affiche aucune donnée."}
          </p>
        </>
      )}
    </div>
  );
}
