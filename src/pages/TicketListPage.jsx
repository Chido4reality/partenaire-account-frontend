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
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { useNetworkStatus } from "../utils/useNetworkStatus";
import { useTicketSummary, ticketSummaryKey, ticketNavVisible } from "../utils/useTicketSummary";
import { useMyPermissions } from "../utils/useMyPermissions";
import { t } from "../utils/i18n";
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

  // ── A VOIDED TICKET NEEDS AN EXIT ─────────────────────────────────────────
  // The seventh-instance guard refuses to release a voided ticket, correctly —
  // but the row then sat in the pickup list forever with no way to clear it.
  // Dismissing is CLIENT-SIDE and deliberately so: there is no transition to
  // make, because a voided ticket has already reached its end state, and
  // inventing a server-side "dismissed" flag would add a lifecycle to a record
  // whose lifecycle is the point of this design.
  //
  // It must NOT just vanish, either — Peter's complaint about the 409 was
  // exactly that. So it stays until the storekeeper clears it himself, and the
  // owner sees it regardless in the oversight tab's ticket list, which now
  // includes voided tickets and marks them.
  //
  // sessionStorage, not localStorage: dismissing is "I have dealt with this
  // now", not a permanent preference, and a fresh shift should see it again if
  // it is somehow still there.
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem("mp-ticket-dismissed") || "[]")); }
    catch { return new Set(); }
  });
  const dismiss = (id) => {
    setDismissed(prev => {
      const next = new Set(prev); next.add(id);
      try { sessionStorage.setItem("mp-ticket-dismissed", JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
    setRefusal(null);
  };
  // Ids this session has been told are voided, so the row can offer the exit
  // without re-asking the server.
  const [voidedIds, setVoidedIds] = useState(() => new Set());

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
  const tickets = (listResp?.data || []).filter(t => !dismissed.has(t.id));

  const settle = useMutation({
    // EVERY mutation sends the version the row was RENDERED with. Not a re-read,
    // not the latest — the token the person actually looked at.
    mutationFn: ({ id, version }) => api.post(`/sales/tickets/${id}/${V.verb}`, { version }),
    onSuccess: (res) => {
      setRefusal(null);
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
      // The server already composed the sentence, bilingually, from the ticket's
      // REAL current status (STATUS_EN/STATUS_FR in lib/saleTickets.js). Rendering
      // it verbatim means one wording to maintain and the cashier learns the
      // ticket was collected or cancelled under them — not that "something went
      // wrong". Composing a client-side message here would be a second source of
      // truth that drifts.
      setRefusal({
        saleId: vars?.id,
        code: b.code || "error",
        title: (en ? b.message_en : b.message_fr) || b.message || (en ? "That did not work." : "Cela n'a pas fonctionné."),
        detail: b.current_status
          ? (en ? `Current state: ${b.current_status}.` : `État actuel : ${b.current_status}.`)
          : null,
      });
      // A voided ticket cannot be released and never will be, so the row is
      // given an exit rather than left to be pressed again forever.
      if (b.code === "sale_voided" && vars?.id) {
        setVoidedIds(prev => new Set(prev).add(vars.id));
      }
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
  const Panel = ({ tone = "amber", title, detail, children }) => (
    <div style={{
      border: `1px solid ${tone === "amber" ? "rgba(245,158,11,0.45)" : "rgba(239,68,68,0.45)"}`,
      background: tone === "amber" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
      color: "var(--text-primary)",
      borderRadius: 10, padding: "14px 16px", margin: "12px 0", lineHeight: 1.45,
    }}>
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

      {refusal ? (
        <Panel tone="red" title={refusal.title} detail={refusal.detail}>
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
            // A repayment and new credit can BOTH be in play, and then the same
            // figure means two different things — the debt being settled and the
            // cash being handed over. Each part names its job, exactly as the POS
            // states it before sending, so the cashier and the salesperson are
            // reading the same sentence.
            const debtPortion = lines
              .filter(l => l.line_type === "debt_payment")
              .reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 1), 0);
            const settles = Math.min(dueNow, debtPortion);

            // Once the server has told us this ticket is voided, the only
            // honest control is the way out — offering "Hand over" again would
            // be offering an action that is guaranteed to refuse.
            const isVoided = voidedIds.has(tk.id);
            const actionBtn = isVoided ? (
              <button
                onClick={() => dismiss(tk.id)}
                style={{
                  padding: "10px 18px", borderRadius: 8, fontWeight: 700, whiteSpace: "nowrap",
                  border: "1px solid var(--border-hover)", background: "var(--bg-elevated)",
                  color: "var(--text-primary)", cursor: "pointer",
                }}
              >{en ? "Dismiss" : "Retirer"}</button>
            ) : (
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
                : dueNow === 0        ? (en ? "Confirm" : "Confirmer")
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
                <div style={{ textAlign: "right", minWidth: 130 }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt(dueNow)}</div>
                  {debtPortion > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {en ? `${fmt(settles)} settles debt` : `${fmt(settles)} règle la dette`}
                    </div>
                  )}
                  {isCredit && (
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
