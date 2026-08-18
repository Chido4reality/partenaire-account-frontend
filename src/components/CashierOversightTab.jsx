// MP-CASHIER-OVERSIGHT — the Reports tab that reassembles the split act.
//
// Cashier mode splits ONE act across THREE people. That makes theft harder to
// DO but, on its own, no easier to SEE — and not being able to see what his
// staff had done was Paul's original complaint. This is the browsable ledger
// behind the shift-report block.
//
// ⚠️ THE SENTENCE IS PART OF THE FEATURE, not decoration. Per-cashier totals are
// anchored on the PAYMENT so they tie to the drawer; per-salesperson totals are
// anchored on the TICKET and are NOT meant to tie. Two figures that are correct
// and different read as an error unless the screen says so — so the note renders
// ALWAYS, never only when the numbers happen to diverge.
//
// ⚠️ SELF-SERVED IS FLAGGED, NEVER ACCUSED. One person raising and paying their
// own ticket is the single shape this workflow cannot prevent, so it is measured
// and put where the boss will see it. In a quiet shop with one person on, that
// is simply what the day looked like, and the wording says exactly that.
import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { refusalFromError } from "../utils/ticketDepartures";

const METHODS = [
  { key: "cash",          en: "Cash",   fr: "Espèces" },
  { key: "mobile_money",  en: "MoMo",   fr: "MoMo" },
  { key: "bank",          en: "Bank",   fr: "Banque" },
  { key: "other",         en: "Other",  fr: "Autre" },
];

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const EXP_STATUS = {
  pending_payout: { en: "Waiting at the till", fr: "En attente à la caisse", tone: "warning" },
  paid:           { en: "Paid out",            fr: "Payé",                  tone: "ok" },
  cancelled:      { en: "Cancelled",           fr: "Annulé",                tone: "danger" },
};

const STATUS = {
  pending_payment: { en: "Waiting to pay", fr: "En attente", tone: "warning" },
  paid:            { en: "Paid",           fr: "Payé",       tone: "ok" },
  released:        { en: "Handed over",    fr: "Remis",      tone: "muted" },
  cancelled:       { en: "Cancelled",      fr: "Annulé",     tone: "danger" },
  refunded:        { en: "Refunded",       fr: "Remboursé",  tone: "danger" },
};

// The ticket list is the one block that grows without bound: a shop at 200 sales
// a day over a 30-day window is thousands of rows, and rendering all of them
// froze nothing at 35 but will at 3,000. Paged in the client because the
// endpoint already caps at 500 and returns a `truncated` flag — so the page
// count is honest about what it holds rather than implying it holds everything.
const TICKETS_PER_PAGE = 50;

export default function CashierOversightTab({ from, to, locationId, lang }) {
  const en = lang === "en";
  const fmt = useCurrency();
  const [openId, setOpenId] = useState(null);
  const [page, setPage] = useState(0);
  const qc = useQueryClient();

  // ── CANCELLING A TICKET ───────────────────────────────────────────────────
  // This is the ONLY surface in the app that can cancel one. POST
  // /sales/tickets/:id/cancel has existed since Phase 1b and had NO caller, so
  // the mode-switch refusal in routes/locations.js has been telling owners to
  // "settle or cancel them first" while offering only one of the two — an owner
  // whose customer walked out had no exit at all, and would only find that out
  // at the moment he needed it.
  //
  // Here rather than in the cashier queue because the permission gate is
  // owner/manager-or-raiser, /reports is already ["owner","manager"], and this
  // list is the one place a voided or abandoned ticket is visible at all.
  //
  // { ticket, reason, error } — ticket is the row being cancelled.
  const [cancelling, setCancelling] = useState(null);

  const cancelTicket = useMutation({
    // The version the OWNER looked at, not a re-read: same compare-and-set
    // contract as pay and release.
    mutationFn: ({ id, version, reason }) =>
      api.post(`/sales/tickets/${id}/cancel`, { version, reason }),
    onSuccess: () => {
      setCancelling(null);
      qc.invalidateQueries({ queryKey: ["cashier-oversight"] });
      // The queue list and the nav badge both count pending tickets, and this
      // ticket has just stopped being one.
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket-summary"] });
    },
    // The server composed the sentence — a stale version, an illegal status, a
    // missing reason and a permission refusal all come back bilingual and are
    // rendered verbatim. Same mapper the cashier queue uses, so there is one
    // wording to maintain.
    onError: (err) => setCancelling(c => c && ({ ...c, error: refusalFromError(err, en) })),
  });

  const { data: resp, isLoading, isError, refetch } = useQuery({
    queryKey: ["cashier-oversight", from, to, locationId || ""],
    queryFn: () => api.get(
      `/reports/cashier-oversight?from=${from}&to=${to}` +
      (locationId ? `&location_id=${encodeURIComponent(locationId)}` : "")
    ).then(r => r.data),
    enabled: !!from && !!to,
  });
  const d = resp?.data || null;
  // Shorthand, and a total that is always an object so the section cannot
  // crash on an older server response that predates expense_totals.
  const ET = (d && d.expense_totals) || { paid_count: 0, paid_total: 0, pending_count: 0, pending_total: 0, cancelled_count: 0, cancelled_total: 0, self_paid_count: 0, self_paid_total: 0 };

  // The tapped ticket's full detail. By-id, so a still-pending ticket opens
  // fine — status filtering a by-id lookup would make a ticket unreadable
  // precisely when someone is trying to understand it.
  const { data: detailResp, isLoading: detailLoading } = useQuery({
    queryKey: ["cashier-oversight-sale", openId],
    queryFn: () => api.get(`/sales/${openId}`).then(r => r.data),
    enabled: !!openId,
  });
  const detail = detailResp?.data || null;

  const Card = ({ title, sub, children, right }) => (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: sub ? 4 : 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>{title}</div>
        {right}
      </div>
      {sub ? <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>{sub}</div> : null}
      {children}
    </div>
  );

  if (isError) {
    return (
      <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.45)", color: "var(--text-primary)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 700 }}>{en ? "Could not load the cashier ledger." : "Impossible de charger le journal caissier."}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
          {en ? "This is a connection problem, not an empty period." : "C'est un problème de connexion, pas une période vide."}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => refetch()}>
          {en ? "Try again" : "Réessayer"}
        </button>
      </div>
    );
  }
  if (isLoading || !d) return <div style={{ padding: 24, color: "var(--text-secondary)" }}>…</div>;

  const T = d.per_cashier_totals, S = d.per_salesperson_totals;
  // Clamp rather than reset-on-change: narrowing the date range while on page 5
  // would otherwise render an empty table with no way back. Derived in render so
  // there is no effect to fire, and no window where page > last page.
  const lastPage = Math.max(0, Math.ceil(d.ticket_count / TICKETS_PER_PAGE) - 1);
  const safePage = Math.min(page, lastPage);
  const nothing = d.per_cashier.length === 0 && d.per_salesperson.length === 0;

  return (
    <div>
      {/* ── THE SENTENCE. Always. ─────────────────────────────────────── */}
      <div style={{
        background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.45)",
        color: "var(--text-primary)", borderRadius: 10, padding: "12px 14px", marginBottom: 16,
        fontSize: 13, lineHeight: 1.55,
      }}>
        {en ? d.notes.anchor_en : d.notes.anchor_fr}
      </div>

      {nothing ? (
        <Card title={en ? "No cashier activity in this period." : "Aucune activité caissier sur cette période."}
              sub={en ? "Tickets appear here once a shop is set to the cashier workflow and someone raises one."
                      : "Les tickets apparaissent ici dès qu'une boutique utilise le circuit caissier et qu'un ticket est créé."} />
      ) : null}

      {/* ── PER CASHIER — ties to the drawer ─────────────────────────── */}
      {d.per_cashier.length > 0 && (
        <Card
          title={en ? "Per cashier — money taken" : "Par caissier — argent encaissé"}
          sub={en ? "Anchored on the payment, so these figures tie to the drawer."
                  : "Calculé sur le paiement : ces montants correspondent à la caisse."}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{en ? "Cashier" : "Caissier"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Took" : "Encaissé"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Tickets" : "Tickets"}</th>
                  {METHODS.map(m => <th key={m.key} style={{ textAlign: "right" }}>{en ? m.en : m.fr}</th>)}
                  <th style={{ textAlign: "right" }}>{en ? "Self-served" : "Auto-encaissé"}</th>
                </tr>
              </thead>
              <tbody>
                {d.per_cashier.map(c => (
                  <tr key={c.user_id}>
                    <td style={{ fontWeight: 600 }}>{c.name || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(c.collected_total)}</td>
                    <td style={{ textAlign: "right" }}>{c.ticket_count}</td>
                    {METHODS.map(m => (
                      <td key={m.key} style={{ textAlign: "right", color: c.by_method[m.key] ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {fmt(c.by_method[m.key] || 0)}
                      </td>
                    ))}
                    <td style={{ textAlign: "right" }}>
                      {c.self_served_count > 0 ? (
                        <span style={{
                          fontSize: 12, fontWeight: 700, color: "var(--text-primary)",
                          background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)",
                          borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
                        }}>{c.self_served_count} · {fmt(c.self_served_value)}</span>
                      ) : <span style={{ color: "var(--text-secondary)" }}>—</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>{en ? "All cashiers" : "Tous les caissiers"}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt(T.collected_total)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{T.ticket_count}</td>
                  {METHODS.map(m => (
                    <td key={m.key} style={{ textAlign: "right", fontWeight: 700 }}>{fmt(T.by_method[m.key] || 0)}</td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {T.self_served_count > 0 ? `${T.self_served_count} · ${fmt(T.self_served_value)}` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {T.self_served_count > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
              {en ? d.notes.self_served_en : d.notes.self_served_fr}
            </div>
          )}
        </Card>
      )}

      {/* ── PER SALESPERSON — does NOT tie, and says so ───────────────── */}
      {d.per_salesperson.length > 0 && (
        <Card
          title={en ? "Per salesperson — sent to the till" : "Par vendeur — envoyé à la caisse"}
          sub={en ? "Anchored on the ticket. These are NOT drawer figures and are not meant to match the totals above."
                  : "Calculé sur le ticket. Ce ne sont PAS des montants de caisse et ils ne doivent pas correspondre aux totaux ci-dessus."}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>{en ? "Salesperson" : "Vendeur"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Sent" : "Envoyé"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Tickets" : "Tickets"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Still uncollected" : "Non encaissé"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Cancelled" : "Annulés"}</th>
                </tr>
              </thead>
              <tbody>
                {d.per_salesperson.map(s => (
                  <tr key={s.user_id}>
                    <td style={{ fontWeight: 600 }}>{s.name || "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(s.sent_total)}</td>
                    <td style={{ textAlign: "right" }}>{s.sent_count}</td>
                    <td style={{ textAlign: "right", color: s.uncollected_total > 0 ? "var(--warning)" : "var(--text-secondary)", fontWeight: s.uncollected_total > 0 ? 700 : 400 }}>
                      {s.uncollected_total > 0 ? `${fmt(s.uncollected_total)} (${s.uncollected_count})` : "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{s.cancelled_count || "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>{en ? "All salespeople" : "Tous les vendeurs"}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt(S.sent_total)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{S.sent_count}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {S.uncollected_total > 0 ? `${fmt(S.uncollected_total)} (${S.uncollected_count})` : "—"}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── DRAWER TIE-OUT ───────────────────────────────────────────── */}
      <Card
        title={en ? "Drawer tie-out" : "Rapprochement caisse"}
        sub={en ? "Read from the same drawer record the Cash register screen shows, so the two can never disagree."
                : "Lu depuis le même enregistrement de caisse que l'écran Gestion de caisse : les deux ne peuvent pas diverger."}
      >
        {!d.drawer.available ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {en ? "The drawer figures could not be read for this period." : "Les montants de caisse n'ont pas pu être lus pour cette période."}
          </div>
        ) : d.drawer.shifts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {en ? "No shifts in this period." : "Aucun poste sur cette période."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
              {[
                { l: en ? "Expected" : "Attendu",  v: fmt(d.drawer.totals.expected) },
                { l: en ? "Counted"  : "Compté",   v: fmt(d.drawer.totals.actual) },
                { l: en ? "Variance" : "Écart",    v: fmt(d.drawer.totals.variance),
                  c: d.drawer.totals.variance === 0 ? "#34d399" : d.drawer.totals.variance > 0 ? "var(--warning)" : "#f87171" },
              ].map(x => (
                <div key={x.l}>
                  <div className="label" style={{ marginBottom: 2 }}>{x.l}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: x.c || "var(--text-primary)" }}>{x.v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {en
                ? `${d.drawer.totals.counted_shifts} closed shift(s) counted.`
                : `${d.drawer.totals.counted_shifts} poste(s) fermé(s) comptés.`}
              {d.drawer.totals.open_shifts > 0 && (
                <> {en
                  ? `${d.drawer.totals.open_shifts} shift(s) still open, holding ${fmt(d.drawer.totals.expected_open)} — not counted yet, so deliberately left out of the comparison above.`
                  : `${d.drawer.totals.open_shifts} poste(s) encore ouvert(s), contenant ${fmt(d.drawer.totals.expected_open)} — pas encore comptés, donc volontairement exclus de la comparaison ci-dessus.`}</>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ── THE TICKET LIST ──────────────────────────────────────────── */}
      {/* ── MP-EXPENSE-TICKETS: MONEY OUT, ITS OWN SECTION ────────────────────
          NOT folded into the per-cashier or per-salesperson rows. Those are money
          IN and tie to the drawer's positive side; putting payouts in the same
          rows invites the next reader to add the two together, which is exactly
          the arithmetic the shift-report workflow block was kept out of the
          drawer buckets to prevent.
          And the per-cashier scoreboard already mis-signs one lifecycle
          (dashboard_cashier_sales counts unpaid tickets against the salesperson),
          so extending a surface that is already wrong in this dimension would
          compound it. */}
      {(d.expenses || []).length > 0 && (
        <Card
          title={en ? "Expenses — money out" : "Dépenses — argent sortant"}
          sub={en ? "Paid-out expenses tie to ‘cash expenses’ in the drawer: same rows, same shift. Waiting and cancelled ones have moved no money and are in neither."
                  : "Les dépenses payées correspondent aux « dépenses espèces » de la caisse : mêmes lignes, même poste. Celles en attente ou annulées n’ont déplacé aucun argent et ne figurent dans aucun des deux."}
          right={<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {en ? "Paid out" : "Payé"} −{fmt(ET.paid_total)}
            {ET.pending_count > 0 ? ` · ${en ? "waiting" : "en attente"} ${fmt(ET.pending_total)}` : ""}
          </span>}
        >
          {/* The three states carry OPPOSITE meanings for the drawer, so they are
              counted apart and never summed into one "expenses" figure. */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10, fontSize: 13 }}>
            <span><strong style={{ color: "#f87171" }}>−{fmt(ET.paid_total)}</strong> {en ? `paid out (${ET.paid_count})` : `payé (${ET.paid_count})`}</span>
            <span style={{ color: "var(--text-secondary)" }}>{fmt(ET.pending_total)} {en ? `waiting (${ET.pending_count})` : `en attente (${ET.pending_count})`}</span>
            <span style={{ color: "var(--text-secondary)" }}>{fmt(ET.cancelled_total)} {en ? `cancelled (${ET.cancelled_count})` : `annulé (${ET.cancelled_count})`}</span>
            {ET.self_paid_count > 0 && (
              <span style={{ color: "var(--warning)", fontWeight: 600 }}>
                ⚠ {en ? `self-paid ${ET.self_paid_count}` : `auto-payé ${ET.self_paid_count}`} · {fmt(ET.self_paid_total)}
              </span>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{en ? "What" : "Quoi"}</th>
                  <th>{en ? "State" : "État"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Amount" : "Montant"}</th>
                  <th>{en ? "Raised by" : "Créé par"}</th>
                  <th>{en ? "Paid out by" : "Payé par"}</th>
                </tr>
              </thead>
              <tbody>
                {(d.expenses || []).map(e => {
                  const st = EXP_STATUS[e.status] || { en: e.status, fr: e.status, tone: "muted" };
                  return (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 600 }}>
                        {e.description}
                        {e.category ? <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}> · {e.category}</span> : null}
                        {/* The caption is the ONLY record a cancelled expense leaves —
                            it moved no stock, no money and no debt — so it is read
                            back here rather than being write-only. */}
                        {e.cancel_reason ? (
                          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic" }}>“{e.cancel_reason}”</div>
                        ) : null}
                      </td>
                      <td style={{ fontWeight: 600, fontSize: 12,
                        color: st.tone === "danger" ? "#f87171" : st.tone === "warning" ? "var(--warning)" : st.tone === "ok" ? "#34d399" : "var(--text-secondary)" }}>
                        {en ? st.en : st.fr}
                        {e.self_paid ? (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)",
                            background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)",
                            borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>
                            {en ? "self-paid" : "auto-payé"}
                          </span>
                        ) : null}
                      </td>
                      {/* Signed. Only a PAID row has left the drawer, so only a paid
                          row is shown as a minus — a pending payout rendered with a
                          minus is a figure someone will subtract. */}
                      <td style={{ textAlign: "right", fontWeight: 700, color: e.status === "paid" ? "#f87171" : "var(--text-secondary)" }}>
                        {e.status === "paid" ? "−" : ""}{fmt(e.amount)}
                      </td>
                      <td>{e.raised_by_name || "—"}<div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{when(e.raised_at)}</div></td>
                      {/* "—" and not the raiser: nobody has paid it, and inventing an
                          actor here is how a record starts lying. */}
                      <td>{e.paid_by_name || "—"}
                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {e.paid_at ? when(e.paid_at) : ""}{e.payment_method ? ` · ${e.payment_method}` : ""}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {d.tickets.length > 0 && (
        <Card
          title={en ? "Every ticket" : "Tous les tickets"}
          sub={en ? "Who raised it, who took the money, who handed over the goods — and when."
                  : "Qui l'a créé, qui a encaissé, qui a remis la marchandise — et quand."}
          right={<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {d.ticket_count === 0 ? "0" :
              `${safePage * TICKETS_PER_PAGE + 1}–${Math.min((safePage + 1) * TICKETS_PER_PAGE, d.ticket_count)} ${en ? "of" : "sur"} ${d.ticket_count}`}
            {d.truncated ? (en ? " · first 500 only" : " · 500 premiers seulement") : ""}
          </span>}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>{en ? "Sale" : "Vente"}</th>
                  <th>{en ? "Status" : "Statut"}</th>
                  <th style={{ textAlign: "right" }}>{en ? "Amount" : "Montant"}</th>
                  <th>{en ? "Raised by" : "Créé par"}</th>
                  <th>{en ? "Paid by" : "Encaissé par"}</th>
                  <th>{en ? "Handed over by" : "Remis par"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.tickets.slice(safePage * TICKETS_PER_PAGE, (safePage + 1) * TICKETS_PER_PAGE).map(t => {
                  const st = STATUS[t.status] || { en: t.status, fr: t.status, tone: "muted" };
                  const open = openId === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr
                          onClick={() => setOpenId(open ? null : t.id)}
                          style={{ cursor: "pointer" }}>
                        <td style={{ fontWeight: 600 }}>
                          {open ? "▾ " : "▸ "}{t.sale_number}
                          {/* A voided ticket is IN this list on purpose — one
                              somebody tried to collect on is the single event
                              most worth an owner's attention, and filtering it
                              out would blind the oversight screen to it. It is
                              excluded from every figure, so it is marked rather
                              than counted. */}
                          {t.is_voided && (
                            <span style={{
                              marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)",
                              background: "rgba(239,68,68,0.22)", border: "1px solid rgba(239,68,68,0.55)",
                              borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap",
                            }}>{en ? "voided" : "annulé"}</span>
                          )}
                          {t.self_served && (
                            <span style={{
                              marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)",
                              background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)",
                              borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap",
                            }}>{en ? "self-served" : "auto-encaissé"}</span>
                          )}
                        </td>
                        <td style={{
                          color: st.tone === "warning" ? "var(--warning)"
                               : st.tone === "danger"  ? "#f87171"
                               : st.tone === "ok"      ? "#34d399" : "var(--text-secondary)",
                          fontWeight: 600, fontSize: 12,
                        }}>{en ? st.en : st.fr}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(t.amount)}</td>
                        <td>{t.raised_by_name || "—"}<div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{when(t.raised_at)}</div></td>
                        <td>{t.paid_by_name || "—"}<div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{when(t.paid_at)}</div></td>
                        <td>{t.released_by_name || "—"}<div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{when(t.released_at)}</div></td>
                        {/* ONLY a pending ticket can be cancelled — TRANSITIONS.cancel
                            is pending_payment -> cancelled, so offering it on a paid or
                            released row would be offering an action guaranteed to
                            refuse. A VOIDED pending ticket keeps the button on purpose:
                            it is precisely the row that has no other way out. */}
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {t.status === "pending_payment" ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setCancelling({ ticket: t, reason: "", error: null }); }}
                              style={{
                                border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.10)",
                                color: "#f87171", borderRadius: 7, padding: "5px 10px",
                                fontSize: 12, fontWeight: 700, cursor: "pointer",
                              }}
                            >{en ? "Cancel ticket" : "Annuler le ticket"}</button>
                          ) : t.cancel_reason ? (
                            // The caption, read back. A cancelled ticket moved no stock,
                            // no money and no debt, so this sentence is the ONLY record
                            // that it existed and why it ended.
                            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 220, whiteSpace: "normal", textAlign: "left" }}>
                              <span style={{ fontStyle: "italic" }}>“{t.cancel_reason}”</span>
                              {t.cancelled_by_name ? <div>{en ? "by " : "par "}{t.cancelled_by_name} · {when(t.cancelled_at)}</div> : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--bg-surface)" }}>
                            {detailLoading || !detail ? (
                              <div style={{ color: "var(--text-secondary)", padding: 8 }}>…</div>
                            ) : (
                              <div style={{ padding: "4px 2px" }}>
                                <div className="label" style={{ marginBottom: 6 }}>
                                  {en ? "Items" : "Articles"}
                                </div>
                                {(detail.pa_sale_items || []).filter(l => l.product_id && l.line_type !== "debt_payment").length === 0 ? (
                                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                    {en ? "No goods lines — the items are only written when the ticket is paid."
                                        : "Aucune ligne de marchandise — les articles ne sont écrits qu'au paiement du ticket."}
                                  </div>
                                ) : (
                                  <div>
                                    {(detail.pa_sale_items || [])
                                      .filter(l => l.product_id && l.line_type !== "debt_payment")
                                      .map((l, i) => (
                                        <div key={l.id || i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0", fontSize: 14, color: "var(--text-primary)" }}>
                                          <span style={{ fontWeight: 800, minWidth: 34, fontVariantNumeric: "tabular-nums" }}>
                                            {Number.isInteger(Number(l.quantity)) ? Number(l.quantity) : Number(Number(l.quantity).toFixed(3))}
                                          </span>
                                          <span style={{ flex: 1 }}>
                                            {(en ? (l.pa_products?.name_en || l.pa_products?.name) : (l.pa_products?.name || l.pa_products?.name_en)) || (en ? "Unnamed item" : "Article sans nom")}
                                            {l.is_damaged ? <span style={{ color: "#f87171", fontSize: 12 }}> · {en ? "damaged" : "abîmé"}</span> : null}
                                          </span>
                                          <span style={{ color: "var(--text-secondary)" }}>{fmt(l.unit_price)}</span>
                                        </div>
                                      ))}
                                  </div>
                                )}
                                {(detail.pa_payments || []).length > 0 && (
                                  <>
                                    <div className="label" style={{ margin: "10px 0 4px" }}>{en ? "Payments" : "Paiements"}</div>
                                    {detail.pa_payments.map((p, i) => (
                                      <div key={p.id || i} style={{ fontSize: 13, color: "var(--text-primary)" }}>
                                        {fmt(p.amount)} · {p.payment_method} · {when(p.created_at)}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.ticket_count > TICKETS_PER_PAGE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                          paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-secondary" disabled={safePage === 0}
                onClick={() => { setPage(Math.max(0, safePage - 1)); setOpenId(null); }}>
                ← {en ? "Previous" : "Précédent"}
              </button>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {safePage + 1} / {lastPage + 1}
              </span>
              <button className="btn btn-secondary"
                disabled={safePage >= lastPage}
                onClick={() => { setPage(safePage + 1); setOpenId(null); }}>
                {en ? "Next" : "Suivant"} →
              </button>
            </div>
          )}
        </Card>
      )}

      {/* ── CONFIRM + REASON ────────────────────────────────────────────────
          A confirm step because cancelling is irreversible and the row is one
          click from a table of fifty. A REQUIRED free-text reason because this
          is the one ending that leaves no trace anywhere else — no stock
          movement, no payment row, no debt, no drawer line — so the caption is
          the only evidence the ticket existed and why it ended.

          Free text, never a dropdown: "customer walked out", "wrong items
          scanned" and "duplicate of 0042" are three different facts, and an
          enum collapses them into one token that explains none of them. The
          server enforces it too (reason_required) — the check below is a
          courtesy to the person typing, not the guarantee. */}
      {cancelling && (
        <div
          style={{ position: "fixed", inset: 0, pointerEvents: "auto", zIndex: 3500, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => { if (!cancelTicket.isPending) setCancelling(null); }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16,
            padding: 24, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
              {en ? "Cancel this ticket?" : "Annuler ce ticket ?"}
            </div>
            {/* Name it. The button was one row among fifty. */}
            <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              {cancelling.ticket.sale_number}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              {fmt(cancelling.ticket.amount)}
              {cancelling.ticket.raised_by_name ? ` · ${en ? "raised by" : "créé par"} ${cancelling.ticket.raised_by_name}` : ""}
              {cancelling.ticket.is_voided ? (en ? " · already voided" : " · déjà annulé (void)") : ""}
            </div>

            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.45 }}>
              {en ? "Nothing is reversed — no stock, no money, no debt. The ticket simply ends, and your reason is the only record of it."
                  : "Rien n'est inversé — ni stock, ni argent, ni dette. Le ticket se termine, et votre motif en est la seule trace."}
            </div>

            <div className="form-group">
              <label className="label">{en ? "Why? *" : "Pourquoi ? *"}</label>
              <textarea className="input" rows={3} autoFocus
                value={cancelling.reason}
                onChange={e => setCancelling(c => ({ ...c, reason: e.target.value, error: null }))}
                placeholder={en ? "e.g. customer left without paying" : "ex. le client est parti sans payer"} />
            </div>

            {cancelling.error ? (
              <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12.5, color: "#f87171" }}>
                <div style={{ fontWeight: 700 }}>{cancelling.error.title}</div>
                {cancelling.error.detail ? <div style={{ marginTop: 2 }}>{cancelling.error.detail}</div> : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}
                disabled={cancelTicket.isPending}
                onClick={() => setCancelling(null)}>
                {en ? "Keep it" : "Garder"}
              </button>
              <button className="btn btn-danger" style={{ flex: 2 }}
                disabled={cancelling.reason.trim().length < 4 || cancelTicket.isPending}
                onClick={() => cancelTicket.mutate({
                  id: cancelling.ticket.id,
                  version: cancelling.ticket.version,
                  reason: cancelling.reason.trim(),
                })}>
                {cancelTicket.isPending ? "…" : (en ? "Cancel the ticket" : "Annuler le ticket")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
