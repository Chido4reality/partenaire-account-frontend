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

const VARIANTS = {
  queue:  { status: "pending_payment", flag: "can_receive_payment", titleKey: "cashier_queue", subKey: "awaiting_payment", actionKey: "take_payment",  emptyKey: "queue_empty",  linesKey: "pa_sale_ticket_items", verb: "pay" },
  pickup: { status: "paid",            flag: "can_release_goods",   titleKey: "pickup_list",   subKey: "awaiting_pickup",  actionKey: "release_goods", emptyKey: "pickup_empty", linesKey: "pa_sale_items",        verb: "release" },
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
  const locationId = useSettingsStore(s => s.selectedLocation?.id) || null;
  const fmt = useCurrency();
  const { isOnline } = useNetworkStatus();
  const qc = useQueryClient();

  // The refusal IS the screen. Held in state, never a toast: a toast disappears
  // and leaves the cashier looking at a list that just didn't work, with a
  // customer waiting. Shape: { saleId, code, title, detail }.
  const [refusal, setRefusal] = useState(null);

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
  const tickets = listResp?.data || [];

  const settle = useMutation({
    // EVERY mutation sends the version the row was RENDERED with. Not a re-read,
    // not the latest — the token the person actually looked at.
    mutationFn: ({ id, version }) => api.post(`/sales/tickets/${id}/${V.verb}`, { version }),
    onSuccess: () => {
      setRefusal(null);
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
      // Whatever the row was showing is now known to be stale.
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ticketSummaryKey(locationId) });
    },
  });

  const Panel = ({ tone = "amber", title, detail, children }) => (
    <div style={{
      border: `1px solid ${tone === "amber" ? "#d9a441" : "#c94f4f"}`,
      background: tone === "amber" ? "#fff8e8" : "#fdf0f0",
      borderRadius: 10, padding: "14px 16px", margin: "12px 0", lineHeight: 1.45,
    }}>
      <div style={{ fontWeight: 700, marginBottom: detail || children ? 6 : 0 }}>{title}</div>
      {detail ? <div style={{ fontSize: 14, opacity: 0.85 }}>{detail}</div> : null}
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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t(V.titleKey, lang)}</h2>
        <span style={{ opacity: 0.7, fontSize: 14 }}>
          {t(V.subKey, lang)} · {tickets.length}
        </span>
      </div>

      {!isOnline ? <Panel tone="red" title={t("offline_online_only", lang)} /> : null}

      {refusal ? (
        <Panel tone="red" title={refusal.title} detail={refusal.detail}>
          <button
            onClick={() => { setRefusal(null); refetch(); }}
            style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid #c94f4f", background: "#fff", cursor: "pointer" }}
          >{t("reload_list", lang)}</button>
        </Panel>
      ) : null}

      {/* isError is checked separately from empty — a failed fetch that renders as
          "nothing waiting" is the bug that keeps recurring in these list views. */}
      {isError ? (
        <Panel tone="red"
          title={en ? "Could not load the list." : "Impossible de charger la liste."}
          detail={en ? "This is a connection problem, not an empty queue." : "C'est un problème de connexion, pas une file vide."}>
          <button onClick={() => refetch()} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid #c94f4f", background: "#fff", cursor: "pointer" }}>
            {t("reload_list", lang)}
          </button>
        </Panel>
      ) : isLoading ? (
        <div style={{ padding: 24, opacity: 0.6 }}>…</div>
      ) : tickets.length === 0 ? (
        <Panel title={t(V.emptyKey, lang)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {/* FIFO — the server orders by created_at ascending. The queue is a
              queue; re-sorting it in the client would jump someone's turn. */}
          {tickets.map(tk => {
            const lines = tk[V.linesKey] || [];
            const busy = settle.isPending && settle.variables?.id === tk.id;
            return (
              <div key={tk.id} style={{
                border: "1px solid #e2e2e2", borderRadius: 10, padding: 14,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 210 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{tk.sale_number}</div>
                  <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
                    {lines.length} {t("items_count", lang)} · {t("sent_by", lang)} {tk.ticket_raised_by_name || "—"}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    {t("waiting_for", lang)} {waitedFor(tk.created_at, lang)}
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt(Number(tk.total_amount) || 0)}</div>
                <button
                  disabled={!isOnline || busy}
                  onClick={() => settle.mutate({ id: tk.id, version: tk.version })}
                  style={{
                    padding: "10px 18px", borderRadius: 8, border: "none", fontWeight: 700,
                    background: (!isOnline || busy) ? "#bbb" : "#14213d", color: "#fff",
                    cursor: (!isOnline || busy) ? "not-allowed" : "pointer",
                  }}
                >{busy ? "…" : t(V.actionKey, lang)}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
