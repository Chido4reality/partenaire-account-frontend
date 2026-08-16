// MP-CASHIER-PHASE-1b — the cashier queue and the pickup list.
//
// ONE component, two variants. They are the same list with a different status, a
// different action and a different permission flag; two files would drift, and
// the drift would land on the money path.
//
// WHAT IS DELIBERATELY ABSENT: edit, discount, add-item, remove-line. The
// salesperson's approvals were resolved before the ticket was raised, so if the
// cashier can change the cart those approvals mean nothing. The row has exactly
// one button.
//
// ONLINE ONLY. Pay and release are excluded from the offline queue (see
// ONLINE_ONLY_RX in utils/pendingSync.js). Offline degrades VISIBLY — the action
// is disabled with a sentence — rather than queueing a money event that would
// replay against a ticket someone else has already settled.
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { useNetworkStatus } from "../utils/useNetworkStatus";
import { useTicketSummary, ticketSummaryKey, ticketNavVisible } from "../utils/useTicketSummary";
import { useMyPermissions } from "../utils/useMyPermissions";
import { t } from "../utils/i18n";
import { refusalFromError, departedTickets, departureSentence } from "../utils/ticketDepartures";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";

const VARIANTS = {
  queue:  { status: "pending_payment", flag: "can_receive_payment", titleKey: "cashier_queue", subKey: "awaiting_payment", actionKey: "take_payment",  emptyKey: "queue_empty",  linesKey: "pa_sale_ticket_items", verb: "pay" },
  pickup: { status: "paid",            flag: "can_release_goods",   titleKey: "pickup_list",   subKey: "awaiting_pickup",  actionKey: "release_goods", emptyKey: "pickup_empty", linesKey: "pa_sale_items",        verb: "release" },
};

// THE PICKUP DESK HANDS OVER GOODS, so its row has to name them. "1 items" tells
// a storekeeper coming onto shift nothing about what to fetch, and with two
// customers waiting it is how the wrong order reaches the wrong person.
//
// Past this many lines the block scrolls INSIDE the row rather than growing, so
// a seven-line order cannot push the next ticket off the screen. Scrolling is
// not the same as hiding: the count is always stated, and nothing is behind a
// tap into a detail view — a list you have to open twice is one people stop
// trusting, and a storekeeper with an armful of stock will not open it at all.
//
// ⚠️ THIS APP HAS ONE THEME AND IT IS DARK (--bg-base #0f0e17, --text-primary
// #f4f3ff, see index.css). Every colour here comes from that scale. A hardcoded
// light fill with no colour set is invisible: the text inherits near-white and
// lands on near-white, which is exactly how the item lines shipped illegible.
// The item lines are the PRIMARY content of a pickup row — the quantity is the
// heaviest thing on the line, then the product name, both at least as prominent
// as the sale number. Nothing here is a footnote.
const MAX_VISIBLE_LINES = 5;
const LINE_PX = 34;

// ⚠️ A pa_sale_items row is NOT necessarily a product. A debt_payment line is
// money travelling on the ticket, and legacy rows carry no line_type at all
// (product_id is the reliable tell — see isDebtLine in routes/sales.js). Either
// one rendered as a picking line sends the storekeeper to fetch a debt, and both
// inflate the count the cashier reads.
// Exported for the line-filter test — these three decide what a storekeeper is
// sent to fetch, so they are checked against real pa_sale_items rows.
export const isGoodsLine = (l) => !!l && !!l.product_id && l.line_type !== "debt_payment";

// Never blank. A line whose product embed failed is still a line the storekeeper
// has to be told about — silently dropping it would hand over a short order.
export const lineName = (l, en) => {
  const p = l.pa_products || {};
  const n = en ? (p.name_en || p.name) : (p.name || p.name_en);
  return n || (en ? "Unnamed item" : "Article sans nom");
};

// Quantities can be fractional (2.5 kg). Show what was actually sold, without
// trailing-zero noise on the whole numbers that make up almost every line.
export const qtyText = (q) => {
  const n = Number(q) || 0;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
};

// The pure rules — refusalFromError / departedTickets / departureSentence — live
// in utils/ticketDepartures.js so they can be exercised without mounting this
// page. See the header there.

// "12 min" / "2 h 05" — how long the customer has been standing there. Deliberately
// coarse: the cashier needs "a while" vs "just now", not a stopwatch.
function waitedFor(iso, lang) {
  if (!iso) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} ${t("minutes_short", lang)}`;
  return `${Math.floor(mins / 60)} ${t("hours_short", lang)} ${String(mins % 60).padStart(2, "0")}`;
}

export default function TicketListPage({ variant = "queue" }) {
  const V = VARIANTS[variant] || VARIANTS.queue;
  const lang = useLangStore(s => s.lang) || "fr";
  const en = lang === "en";
  const role = useAuthStore(s => s.user?.role) || "cashier";
  const org  = useAuthStore(s => s.org) || {};   // receipt header (name, currency)
  const locationId = useSettingsStore(s => s.selectedLocation?.id) || null;
  const fmt = useCurrency();
  const { isOnline } = useNetworkStatus();
  const qc = useQueryClient();

  // The refusal IS the screen. Held in state, never a toast: a toast disappears
  // and leaves the cashier looking at a list that just didn't work, with a
  // customer waiting. Shape: { saleId, code, title, detail }.
  const [refusal, setRefusal] = useState(null);
  // ── THE PAYMENT RECEIPT, AT COLLECTION ──────────────────────────────────
  // At SEND the customer gets an order slip that says, in bold, that nothing
  // has been paid. At COLLECTION they must get the opposite: proof that they
  // paid and what it settled. Without this a customer who has just handed over
  // money walks away holding only a document stating they have not paid — and
  // the shop has no printed record of what the cashier took.
  //
  // Reuses PaymentEventReceipt, the same component the direct sale, the debt
  // collection and the refund paths all print through. /pay already returns the
  // full sale (items, customer) plus applied_to_invoices, which is exactly the
  // shape eventType="sale" expects — so this is a render, not a new receipt.
  const [paidReceipt, setPaidReceipt] = useState(null);

  // ── THE CLIENT-SIDE DISMISS IS GONE ───────────────────────────────────────
  // It existed because a voided ticket sat in these lists forever with no way to
  // clear it: voiding never touches status, so the row stayed 'pending_payment'
  // and the only exit on offer was a sessionStorage hide.
  //
  // That was two ways for a row to disappear, and the second one LIED. It hid
  // the row for one cashier, in one browser session, while the server still
  // counted the ticket — so the nav badge kept claiming a queue one longer than
  // the list, every other till still saw the row, and the mode-switch guard in
  // routes/locations.js still refused to let the location leave cashier mode.
  // Two mechanisms, one of which quietly disagreed with the truth, is worse than
  // either alone.
  //
  // Fixed at the source instead: the list, the badge and the mode guard all
  // exclude voided rows now, and cancel is permitted on a voided ticket so it
  // can actually reach a terminal state rather than being papered over.

  const { summary } = useTicketSummary(locationId, { onError: () => {} });
  const { perms } = useMyPermissions({ enabled: !!locationId, retry: 1 });
  const mode = summary?.mode || "direct";
  const allowed = ticketNavVisible({ mode, role, perms, flag: V.flag });

  const listKey = ["tickets", V.status, locationId];
  const { data: listResp, isLoading, isError, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get(`/sales/tickets?status=${V.status}&location_id=${encodeURIComponent(locationId || "")}`).then(r => r.data),
    // Only ask once the server has told us this till is in cashier mode AND this
    // user holds the flag — otherwise every direct-mode till would poll a 403.
    enabled: !!locationId && allowed,
    refetchInterval: 60000,
    retry: 1,
  });
  // No client-side filtering any more: what the server returns IS the queue.
  const tickets = listResp?.data || [];

  // ── MP-TICKET-DEPARTURE-NOTICE ────────────────────────────────────────────
  // A row that vanishes mid-reach is the quiet failure in a two-cashier shop:
  // the other till took the payment, this list refetched on window focus, and
  // the ticket left without a word. The cashier sees the queue shrink and cannot
  // tell paid from cancelled from "I misread it".
  //
  // Detected by DIFFING SNAPSHOTS, not by asking the server what changed — the
  // fact of departure is free on the client. Only the who and the why come from
  // the server (recently_settled), because both describe the row after it left
  // this status and no query filtered on that status can return it.
  //
  // A ref, not state: writing the snapshot must not itself cause a render, or
  // every fetch would re-run this and re-announce.
  const prevTicketsRef = useRef(null);
  // Ids whose departure this user has ALREADY been told about — by settling the
  // ticket themselves (receipt + state change they initiated) or by a refusal
  // panel that named it. Announcing "VNT-0021 is no longer in this list" on top
  // of either would be telling them something they just read.
  const explainedRef = useRef(new Set());
  const [departures, setDeparture] = useState([]);

  useEffect(() => {
    // Only diff against a real, delivered list. isLoading / isError snapshots
    // would read as "everything left at once" — the isError-vs-empty trap that
    // keeps recurring in these list views, in a new costume.
    if (isLoading || isError || !listResp) return;
    const next = listResp.data || [];
    const gone = departedTickets({
      prev: prevTicketsRef.current,
      next,
      settled: listResp.recently_settled,
      ownIds: explainedRef.current,
    });
    prevTicketsRef.current = next;
    // Consumed once — the id is dropped as soon as the row is actually gone, so
    // the set cannot grow for the life of the page.
    if (explainedRef.current.size) {
      const stillPresent = new Set(next.map(t => t.id));
      explainedRef.current.forEach(id => { if (!stillPresent.has(id)) explainedRef.current.delete(id); });
    }
    if (gone.length) {
      // Newest first, capped: a cashier returning after an hour should see what
      // just happened, not a wall. Capped rather than auto-expiring, because an
      // explanation that disappears by itself recreates the exact complaint this
      // fixes.
      setDeparture(prev => [...gone, ...prev.filter(p => !gone.some(g => g.id === p.id))].slice(0, 3));
    }
  }, [listResp, isLoading, isError]);

  const settle = useMutation({
    // EVERY mutation sends the version the row was RENDERED with. Not a re-read,
    // not the latest — the token the person actually looked at.
    mutationFn: ({ id, version }) => api.post(`/sales/tickets/${id}/${V.verb}`, { version }),
    onSuccess: (res, vars) => {
      setRefusal(null);
      // This ticket is about to leave the list because THIS user settled it.
      // Recorded before the invalidate so the refetch that follows does not
      // announce the cashier's own payment back at them.
      if (vars?.id) explainedRef.current.add(vars.id);
      // Only a PAYMENT produces a receipt. A release moves goods, not money —
      // printing a second "payment" document at handover would tell the customer
      // they paid twice.
      const body = res?.data;
      if (variant === "queue" && body?.data) {
        // body.data is the SERVER sale row: its lines are pa_sale_items, not the
        // `items` array POSPage passes from its own cart. PaymentEventReceipt now
        // understands both — see the saleItems normaliser there. unapplied_repayment
        // rides along so the receipt can state money the cashier took that no
        // invoice absorbed, rather than leaving the customer to notice.
        setPaidReceipt({
          ...body.data,
          applied_to_invoices: body.applied_to_invoices || undefined,
          unapplied_repayment: body.unapplied_repayment || undefined,
        });
      }
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ticketSummaryKey(locationId) });
    },
    onError: (err, vars) => {
      const b = err?.response?.data || {};
      // Mapping lives in utils/ticketDepartures so it can be exercised without
      // mounting the page — the panel is a div; the mapping is the part that can
      // actually be wrong.
      //
      // The sale number is resolved HERE, from the row that was pressed. The
      // server never needs to send it: this client knows exactly which button
      // was tapped, and a panel that says "this ticket" above four rows names
      // none of them.
      const pressed = (listResp?.data || []).find(x => x.id === vars?.id);
      setRefusal(refusalFromError(err, en, {
        saleId: vars?.id,
        saleNumber: pressed?.sale_number || null,
      }));
      // The refusal panel has just named this ticket and said what happened to
      // it. The refetch below will drop the row (a voided ticket is no longer
      // listed, and a paid one has left this status), so suppress the departure
      // notice for it — otherwise the cashier reads the explanation and then,
      // half a second later, "VNT-0021 is no longer in this list" underneath it.
      if (vars?.id) explainedRef.current.add(vars.id);
      // Whatever the row was showing is now known to be stale.
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ticketSummaryKey(locationId) });
    },
  });

  // A TINT over the dark base, never a light fill — the same pattern the POS
  // slip banner uses. This panel carried a cream background with no colour set,
  // so every refusal, the offline warning and both empty states rendered
  // near-white on near-white: the messages that matter most when something has
  // gone wrong were the least readable things on the screen.
  // `lead` sits ABOVE the title: it is the identifier, and it has to be the first
  // thing read. A refusal panel over a queue of four rows that never names the
  // ticket makes "do not take payment for it" unactionable.
  const Panel = ({ tone = "amber", lead, title, detail, children }) => (
    <div style={{
      border: `1px solid ${tone === "amber" ? "rgba(245,158,11,0.45)" : "rgba(239,68,68,0.45)"}`,
      background: tone === "amber" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
      color: "var(--text-primary)",
      borderRadius: 10, padding: "14px 16px", margin: "12px 0", lineHeight: 1.45,
    }}>
      {lead ? (
        <div style={{
          fontFamily: "monospace", fontSize: 13.5, fontWeight: 700,
          color: "var(--text-primary)", marginBottom: 4, wordBreak: "break-all",
        }}>{lead}</div>
      ) : null}
      <div style={{ fontWeight: 700, marginBottom: detail || children ? 6 : 0 }}>{title}</div>
      {detail ? <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{detail}</div> : null}
      {children}
    </div>
  );

  if (!locationId) {
    return <div style={{ padding: 16 }}>
      <Panel title={en ? "Choose a location first." : "Choisissez d'abord un emplacement."} />
    </div>;
  }

  // Not a cashier till, or this user doesn't hold the flag. Say which, in words —
  // someone who typed the URL deserves an explanation, not a blank page.
  if (!allowed) {
    return <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 4 }}>{t(V.titleKey, lang)}</h2>
      <Panel
        title={mode !== "cashier"
          ? t("not_cashier_till", lang)
          : (en ? "You are not allowed to do this here." : "Vous n'êtes pas autorisé à faire cela ici.")}
        detail={mode !== "cashier"
          ? (en ? "Sales are completed directly at this till, so there is no queue."
                : "Les ventes sont finalisées directement à cette caisse, il n'y a donc pas de file.")
          : (en ? "Ask the owner to grant it in Settings → Permissions."
                : "Demandez au patron de vous l'accorder dans Paramètres → Autorisations.")}
      />
    </div>;
  }

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      {paidReceipt && (
        <PaymentEventReceipt
          eventType="sale"
          data={paidReceipt}
          org={org}
          lang={lang}
          onClose={() => setPaidReceipt(null)}
        />
      )}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t(V.titleKey, lang)}</h2>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          {t(V.subKey, lang)} · {tickets.length}
        </span>
      </div>

      {!isOnline ? <Panel tone="red" title={t("offline_online_only", lang)} /> : null}

      {/* ── WHAT LEFT THE LIST ──────────────────────────────────────────────
          Neutral tone, not amber/red: nothing has gone wrong. A colleague did
          their job; this is the shop working. Colouring it as a warning would
          teach cashiers that a normal payment looks like an error.

          NOT A TOAST, and not auto-expiring. A toast is exactly the thing that
          leaves someone staring at a list that changed for no visible reason —
          and an explanation that removes itself after a few seconds recreates
          the same complaint in miniature for anyone who looked away. It stays
          until the cashier clears it, capped at 3 so it cannot become a wall. */}
      {departures.map(d => (
        <div key={d.id} style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          border: "1px solid var(--border)", background: "var(--bg-card)",
          color: "var(--text-primary)", borderRadius: 10,
          padding: "10px 12px", margin: "8px 0", lineHeight: 1.45,
        }}>
          <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1.4 }}>↩</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14 }}>{departureSentence(d, en)}</div>
            {/* The amount and customer are the cashier's own memory aids — this
                is how they recognise the ticket they were reaching for. */}
            {(d.customer_name || d.total_amount != null) ? (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                {[d.customer_name, d.total_amount != null ? fmt(d.total_amount) : null]
                  .filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => setDeparture(prev => prev.filter(p => p.id !== d.id))}
            aria-label={en ? "Dismiss" : "Fermer"}
            style={{
              flexShrink: 0, border: "1px solid var(--border-hover)", background: "var(--bg-elevated)",
              color: "var(--text-secondary)", borderRadius: 8, padding: "4px 10px",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >{en ? "OK" : "OK"}</button>
        </div>
      ))}

      {/* lead = WHICH ticket, in monospace above the sentence so it can be matched
          against the sale numbers in the rows below at a glance. Kept out of the
          server's sentence so neither language has to be re-worded to carry it. */}
      {refusal ? (
        <Panel tone="red" lead={refusal.saleNumber} title={refusal.title} detail={refusal.detail}>
          <button
            onClick={() => { setRefusal(null); refetch(); }}
            style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-hover)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontWeight: 600, cursor: "pointer" }}
          >{t("reload_list", lang)}</button>
        </Panel>
      ) : null}

      {/* isError is checked separately from empty — a failed fetch that renders as
          "nothing waiting" is the bug that keeps recurring in these list views. */}
      {isError ? (
        <Panel tone="red"
          title={en ? "Could not load the list." : "Impossible de charger la liste."}
          detail={en ? "This is a connection problem, not an empty queue." : "C'est un problème de connexion, pas une file vide."}>
          <button onClick={() => refetch()} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-hover)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontWeight: 600, cursor: "pointer" }}>
            {t("reload_list", lang)}
          </button>
        </Panel>
      ) : isLoading ? (
        <div style={{ padding: 24, color: "var(--text-secondary)" }}>…</div>
      ) : tickets.length === 0 ? (
        <Panel title={t(V.emptyKey, lang)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {/* FIFO — the server orders by created_at ascending. The queue is a
              queue; re-sorting it in the client would jump someone's turn. */}
          {tickets.map(tk => {
            const lines = tk[V.linesKey] || [];
            // The picking list and the count both mean GOODS. A debt line is
            // money and belongs to neither.
            const goods = lines.filter(isGoodsLine);
            const busy  = settle.isPending && settle.variables?.id === tk.id;

            const totalAmt = Number(tk.total_amount) || 0;
            const dueNow   = Number(tk.paid_amount) || 0;
            const onAcct   = Math.max(0, totalAmt - dueNow);
            const isCredit = variant === "queue" && onAcct > 0;
            // A FULL-credit ticket: goods leave, no money is taken. Distinct from
            // isCredit, which is also true of a partial payment — there the cashier
            // DOES collect something and the row must keep saying so.
            const collectNothing = variant === "queue" && dueNow === 0;
            // A repayment and new credit can BOTH be in play, and then the same
            // figure means two different things — the debt being settled and the
            // cash being handed over. Each part names its job, exactly as the POS
            // states it before sending, so the cashier and the salesperson are
            // reading the same sentence.
            const debtPortion = lines
              .filter(l => l.line_type === "debt_payment")
              .reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 1), 0);
            const settles = Math.min(dueNow, debtPortion);

            // No voided branch here any more. A voided ticket is filtered out of
            // this list by the server, so the row cannot be on screen to need an
            // exit; if one is voided between fetch and press, the refusal names
            // it and the refetch removes it.
            const actionBtn = (
              <button
                disabled={!isOnline || busy}
                onClick={() => settle.mutate({ id: tk.id, version: tk.version })}
                style={{
                  padding: "10px 18px", borderRadius: 8, border: "none", fontWeight: 700,
                  background: (!isOnline || busy) ? "var(--bg-elevated)" : "var(--brand)",
                  color: (!isOnline || busy) ? "var(--text-muted)" : "var(--on-brand)",
                  cursor: (!isOnline || busy) ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                }}
              >{busy ? "…"
                : variant === "pickup" ? t("release_goods", lang)
                // ⚠️ NAME THE ABSENCE. This used to read "Confirm", which names no
                // object at all while every neighbouring row says "Collect 5 000".
                // The button is the same size, fill and position in both cases, so
                // a cashier under time pressure pattern-matches the coloured button
                // rather than reading it — and the one row where NOTHING should be
                // collected looked identical to the rows where money must change
                // hands. The risk was never refusing to press; it was pressing while
                // believing money had been taken.
                : collectNothing      ? (en ? "Collect nothing — on account" : "Rien à encaisser — sur compte")
                : (en ? `Collect ${fmt(dueNow)}` : `Encaisser ${fmt(dueNow)}`)}</button>
            );

            // Sale number, customer and waiting time are how the person at the
            // counter is matched to the order — both desks need all three.
            // The customer's name is also the FALLBACK when the slip did not
            // print: a printer that is off or out of paper must not leave a
            // customer unable to be served.
            const heading = (
              <div style={{ minWidth: 210 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{tk.sale_number}</div>
                {tk.pa_customers?.name && (
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{tk.pa_customers.name}</div>
                )}
                {variant === "queue" && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                    {goods.length} {t("items_count", lang)} · {t("sent_by", lang)} {tk.ticket_raised_by_name || "—"}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                  {t("waiting_for", lang)} {waitedFor(tk.created_at, lang)}
                  {variant === "pickup" ? ` · ${t("sent_by", lang)} ${tk.ticket_raised_by_name || "—"}` : ""}
                </div>
              </div>
            );

            // ── THE PICKUP ROW ────────────────────────────────────────────
            // No amount. He is not collecting money, and the figure competes for
            // the eye with the only thing he is here to read. It is on the
            // receipt the customer is holding if it is ever needed.
            if (variant === "pickup") {
              const scrolls = goods.length > MAX_VISIBLE_LINES;
              return (
                <div key={tk.id} style={{
                  border: "1px solid var(--border)", background: "var(--bg-card)", borderRadius: 10, padding: 14,
                  display: "flex", flexDirection: "column", gap: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                    {heading}
                    {actionBtn}
                  </div>

                  <div>
                    {/* A label, in the app's label style — the lines below it are
                        the content and must outweigh it. */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "baseline",
                      fontSize: 11, letterSpacing: "0.05em", color: "var(--text-secondary)", marginBottom: 6,
                    }}>
                      <span style={{ fontWeight: 600 }}>
                        {t("to_hand_over", lang).toUpperCase()} · {goods.length}
                      </span>
                      {scrolls ? <span>{t("scroll_for_more", lang)}</span> : null}
                    </div>
                    {goods.length === 0 ? (
                      // Not "nothing to do" — a paid ticket with no goods lines is
                      // a debt-only ticket or a projection that lost its lines, and
                      // either way he must not hand over a guess.
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--warning)" }}>
                        {en ? "No goods on this ticket — check with the cashier before handing anything over."
                            : "Aucune marchandise sur ce ticket — vérifiez avec le caissier avant de remettre quoi que ce soit."}
                      </div>
                    ) : (
                      // NO PANEL. The lines sit on the card itself, separated by
                      // hairlines. An inverted light pill inside a dark card is
                      // what forced the contrast problem, and a container adds
                      // nothing a separator does not.
                      <div style={{
                        borderTop: "1px solid var(--border)",
                        maxHeight: scrolls ? MAX_VISIBLE_LINES * LINE_PX : undefined,
                        overflowY: scrolls ? "auto" : "visible",
                        // Contain the scroll so a flick inside the block does not
                        // also drag the list behind it.
                        overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
                      }}>
                        {goods.map((l, i) => (
                          <div key={l.id || i} style={{
                            display: "flex", alignItems: "baseline", gap: 10,
                            padding: "7px 2px", minHeight: LINE_PX,
                            borderTop: i ? "1px solid var(--border)" : "none",
                          }}>
                            {/* The quantity is the most prominent thing on the
                                line: he reads "2" before he reads the name. */}
                            <span style={{
                              fontWeight: 800, fontSize: 19, lineHeight: 1.2, minWidth: 40,
                              color: "var(--text-primary)", fontVariantNumeric: "tabular-nums",
                            }}>{qtyText(l.quantity)}</span>
                            <span style={{
                              fontSize: 16, fontWeight: 600, flex: 1, lineHeight: 1.3,
                              color: "var(--text-primary)",
                            }}>
                              {lineName(l, en)}
                              {l.pa_products?.unit
                                ? <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}> ({l.pa_products.unit})</span>
                                : null}
                            </span>
                            {/* Damaged stock lives in a different pile. Fetching
                                it from sellable stock is a real mis-pick, so the
                                line says so. */}
                            {l.is_damaged ? (
                              <span style={{
                                // --danger as TEXT is only 3.6:1 on its own tint. The red is
                                // carried by the fill and border instead, so the word
                                // itself sits at full primary contrast.
                                fontSize: 11, fontWeight: 700, color: "var(--text-primary)",
                                background: "rgba(239,68,68,0.22)", border: "1px solid rgba(239,68,68,0.55)",
                                borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
                              }}>{t("damaged_short", lang)}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // ── THE CASHIER ROW ───────────────────────────────────────────
            // Unchanged: he takes money. The product list would slow the till and
            // he has no reason to read it. The terms were set by the salesperson
            // and he cannot change them, so the row states what is due NOW rather
            // than the order total — "Take payment" is a lie on a credit ticket.
            return (
              <div key={tk.id} style={{
                border: "1px solid var(--border)", background: "var(--bg-card)", borderRadius: 10, padding: 14,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
              }}>
                {heading}
                {/* ── WHICH NUMBER IS THE BIG ONE ───────────────────────────
                    On a FULL-CREDIT ticket nothing is collected, so dueNow is 0 —
                    and rendering that at 17px bold made the least useful number on
                    the row the most prominent one, with the figure that actually
                    matters (the goods going on account) demoted to small grey text.
                    A cashier scanning the queue reads the big number.
                    So when there is nothing to collect the emphasis swaps: the
                    on-account amount becomes the headline and the zero is stated in
                    words underneath, because "0" alone reads as unknown-or-free
                    rather than as "collect nothing". A partial-payment ticket is
                    unchanged — there, dueNow IS the number the cashier acts on. */}
                <div style={{ textAlign: "right", minWidth: 130 }}>
                  {collectNothing ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt(onAcct)}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        {en ? "goods on account" : "marchandise sur compte"}
                        {tk.due_date ? ` · ${tk.due_date}` : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, fontWeight: 600 }}>
                        {en ? "nothing to collect" : "rien à encaisser"}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt(dueNow)}</div>
                  )}
                  {debtPortion > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {en ? `${fmt(settles)} settles debt` : `${fmt(settles)} règle la dette`}
                    </div>
                  )}
                  {isCredit && !collectNothing && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {en ? `${fmt(onAcct)} goods on account` : `${fmt(onAcct)} marchandise sur compte`}
                      {tk.due_date ? ` · ${tk.due_date}` : ""}
                    </div>
                  )}
                  {!isCredit && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {en ? "paid in full" : "payé intégralement"}
                    </div>
                  )}
                </div>
                {actionBtn}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
