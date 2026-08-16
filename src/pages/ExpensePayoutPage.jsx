// MP-EXPENSE-TICKETS — the cashier's expense queue.
//
// The sale queue with the sign reversed: money OUT instead of IN. Deliberately
// a SEPARATE page rather than a third tab on the ticket list, because Q12 made
// the sidebar badge the entire notification design — one combined badge says
// "something needs attention" without saying which, so the cashier opens the
// section and hunts. Three counts say "two payments waiting, nothing to hand
// over, one payout" without a click.
//
// WHAT IS DELIBERATELY ABSENT: edit, category change, amount change. The
// salesperson raised it and any over-cap approval was resolved then; if the
// cashier can change the amount, that approval means nothing. The row has two
// buttons — pay it, or refuse it with a reason.
//
// ONLINE ONLY. Payout and cancel are excluded from the offline queue (see
// ONLINE_ONLY_RX in utils/pendingSync.js): both are a compare-and-set, and a
// replay hours later either 409s or pays a supplier a second time. Offline
// degrades VISIBLY — the action is disabled with a sentence.
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../utils/api";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import { useCurrency } from "../utils/useCurrency";
import { useNetworkStatus } from "../utils/useNetworkStatus";
import { useTicketSummary, ticketSummaryKey, ticketNavVisible } from "../utils/useTicketSummary";
import { useMyPermissions } from "../utils/useMyPermissions";
import { refusalFromError, departedTickets, departureSentence } from "../utils/ticketDepartures";

const METHODS = [
  { key: "cash",         en: "Cash",   fr: "Espèces" },
  { key: "mobile_money", en: "MoMo",   fr: "MoMo" },
  { key: "bank",         en: "Bank",   fr: "Virement" },
];

// "12 min" / "2 h 05" — how long the supplier has been waiting. Coarse on
// purpose: the cashier needs "a while" vs "just now", not a stopwatch.
function waitedFor(iso, en) {
  if (!iso) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} ${en ? "min" : "min"}`;
  return `${Math.floor(mins / 60)} ${en ? "h" : "h"} ${String(mins % 60).padStart(2, "0")}`;
}

export default function ExpensePayoutPage() {
  const lang = useLangStore(s => s.lang) || "fr";
  const en = lang === "en";
  const role = useAuthStore(s => s.user?.role) || "cashier";
  const locationId = useSettingsStore(s => s.selectedLocation?.id) || null;
  const fmt = useCurrency();
  const { isOnline } = useNetworkStatus();
  const qc = useQueryClient();

  const [refusal, setRefusal] = useState(null);
  const [cancelling, setCancelling] = useState(null);   // { expense, reason, error }
  const [method, setMethod] = useState("cash");

  const { summary } = useTicketSummary(locationId, { onError: () => {} });
  const { perms } = useMyPermissions({ enabled: !!locationId, retry: 1 });
  const mode = summary?.mode || "direct";
  const allowed = ticketNavVisible({ mode, role, perms, flag: "can_pay_expenses" });

  const listKey = ["expense-payouts", locationId];
  const { data: listResp, isLoading, isError, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get(
      `/expenditures?status=pending_payout&limit=100` +
      (locationId ? `&location_id=${encodeURIComponent(locationId)}` : "")
    ).then(r => r.data),
    enabled: !!locationId && allowed,
    refetchInterval: 60000,
    retry: 1,
  });
  const rows = listResp?.data || [];

  // ── DEPARTURE NOTICE ──────────────────────────────────────────────────────
  // Same reasoning as the cashier queue: in a two-till shop a row can vanish
  // mid-reach when the other cashier pays it, and a queue that silently shrinks
  // leaves someone unable to tell paid from cancelled from "I misread it".
  // Reuses the tested diff from utils/ticketDepartures — the server has no
  // recently_settled for expenses yet, so status resolves to "unknown" and the
  // sentence says "is no longer in this list" rather than guessing.
  const prevRef = useRef(null);
  const explainedRef = useRef(new Set());
  const [departures, setDeparture] = useState([]);
  useEffect(() => {
    if (isLoading || isError || !listResp) return;
    const next = listResp.data || [];
    const gone = departedTickets({
      prev: prevRef.current, next, settled: [], ownIds: explainedRef.current,
    });
    prevRef.current = next;
    if (explainedRef.current.size) {
      const present = new Set(next.map(r => r.id));
      explainedRef.current.forEach(id => { if (!present.has(id)) explainedRef.current.delete(id); });
    }
    if (gone.length) setDeparture(p => [...gone, ...p.filter(x => !gone.some(g => g.id === x.id))].slice(0, 3));
  }, [listResp, isLoading, isError]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: ticketSummaryKey(locationId) });
    // The payout has just become a drawer event: it now counts in cash_expenses,
    // the day total and every expense report.
    qc.invalidateQueries({ queryKey: ["expenditures"] });
    qc.invalidateQueries({ queryKey: ["current-shift"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const payout = useMutation({
    mutationFn: ({ id, version }) => api.post(`/expenditures/${id}/payout`, { version, payment_method: method }),
    onSuccess: () => { setRefusal(null); invalidate(); },
    onError: (err, vars) => {
      const row = rows.find(r => r.id === vars?.id);
      if (vars?.id) explainedRef.current.add(vars.id);
      setRefusal(refusalFromError(err, en, { saleId: vars?.id, saleNumber: row?.description || null }));
      invalidate();
    },
  });

  const cancel = useMutation({
    mutationFn: ({ id, version, reason }) => api.post(`/expenditures/${id}/cancel`, { version, reason }),
    onSuccess: (_r, vars) => { if (vars?.id) explainedRef.current.add(vars.id); setCancelling(null); invalidate(); },
    onError: (err) => setCancelling(c => c && ({ ...c, error: refusalFromError(err, en) })),
  });

  const Panel = ({ tone = "amber", lead, title, detail, children }) => (
    <div style={{
      border: `1px solid ${tone === "amber" ? "rgba(245,158,11,0.45)" : "rgba(239,68,68,0.45)"}`,
      background: tone === "amber" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
      color: "var(--text-primary)", borderRadius: 10, padding: "14px 16px",
      margin: "12px 0", lineHeight: 1.45,
    }}>
      {lead ? <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{lead}</div> : null}
      <div style={{ fontWeight: 700, marginBottom: detail || children ? 6 : 0 }}>{title}</div>
      {detail ? <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{detail}</div> : null}
      {children}
    </div>
  );

  if (!locationId) {
    return <div style={{ padding: 16 }}><Panel title={en ? "Choose a location first." : "Choisissez d'abord un emplacement."} /></div>;
  }

  if (!allowed) {
    return <div style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 4 }}>{en ? "Expenses to pay" : "Dépenses à payer"}</h2>
      <Panel
        title={mode !== "cashier"
          ? (en ? "This till pays expenses directly." : "Cette caisse règle les dépenses directement.")
          : (en ? "You are not allowed to pay expenses here." : "Vous n'êtes pas autorisé à payer les dépenses ici.")}
        detail={mode !== "cashier"
          ? (en ? "Expenses are recorded and paid in one step here, so there is no queue."
                : "Les dépenses sont enregistrées et payées en une seule étape ici, il n'y a donc pas de file.")
          : (en ? "Ask the owner to grant it in Settings → Permissions."
                : "Demandez au patron de vous l'accorder dans Paramètres → Autorisations.")} />
    </div>;
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{en ? "Expenses to pay" : "Dépenses à payer"}</h2>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          {rows.length} · {fmt(total)}
        </span>
      </div>
      {/* MONEY OUT, said once and plainly. The sale queues are money in and look
          almost identical; a cashier moving between them needs the direction to
          be unmistakable before they hand cash over. */}
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
        {en ? "Money leaving the drawer. Nothing has been paid yet."
            : "Argent sortant de la caisse. Rien n'a encore été payé."}
      </div>

      {!isOnline ? <Panel tone="red"
        title={en ? "You are offline." : "Vous êtes hors ligne."}
        detail={en ? "Paying out cannot wait in the sync queue — a replay could pay the same supplier twice. Reconnect first."
                  : "Un paiement ne peut pas attendre dans la file de synchronisation — une relecture pourrait payer le même fournisseur deux fois. Reconnectez-vous d'abord."} /> : null}

      {departures.map(d => (
        <div key={d.id} style={{
          display: "flex", alignItems: "flex-start", gap: 12, border: "1px solid var(--border)",
          background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", margin: "8px 0",
        }}>
          <span aria-hidden="true">↩</span>
          <div style={{ flex: 1, fontSize: 14 }}>{departureSentence(d, en)}</div>
          <button onClick={() => setDeparture(p => p.filter(x => x.id !== d.id))}
            style={{ border: "1px solid var(--border-hover)", background: "var(--bg-elevated)", color: "var(--text-secondary)", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>OK</button>
        </div>
      ))}

      {refusal ? (
        <Panel tone="red" lead={refusal.saleNumber} title={refusal.title} detail={refusal.detail}>
          <button onClick={() => { setRefusal(null); refetch(); }}
            style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-hover)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontWeight: 600, cursor: "pointer" }}>
            {en ? "Reload the list" : "Recharger la liste"}
          </button>
        </Panel>
      ) : null}

      {/* THE TENDER, chosen once for the session rather than per row: a cashier
          paying five suppliers from the till is paying all five in cash. Per-row
          would be five identical taps. It is stated on the button so the choice
          is never invisible at the moment of paying. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 4px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{en ? "Paying with" : "Payer avec"}</span>
        {METHODS.map(m => (
          <button key={m.key} onClick={() => setMethod(m.key)}
            style={{
              padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              border: method === m.key ? "1px solid var(--brand)" : "1px solid var(--border)",
              background: method === m.key ? "rgba(251,197,3,0.15)" : "var(--bg-elevated)",
              color: method === m.key ? "var(--brand-light)" : "var(--text-secondary)",
            }}>{en ? m.en : m.fr}</button>
        ))}
      </div>

      {isError ? (
        <Panel tone="red"
          title={en ? "Could not load the list." : "Impossible de charger la liste."}
          detail={en ? "This is a connection problem, not an empty queue." : "C'est un problème de connexion, pas une file vide."}>
          <button onClick={() => refetch()} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-hover)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontWeight: 600, cursor: "pointer" }}>
            {en ? "Reload the list" : "Recharger la liste"}
          </button>
        </Panel>
      ) : isLoading ? (
        <div style={{ padding: 24, color: "var(--text-secondary)" }}>…</div>
      ) : rows.length === 0 ? (
        <Panel title={en ? "Nothing to pay out." : "Rien à payer."} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {rows.map(r => {
            const busy = payout.isPending && payout.variables?.id === r.id;
            const cat = r.pa_expenditure_categories?.name || r.pa_expenditure_categories?.name_en || r.category || null;
            return (
              <div key={r.id} style={{
                border: "1px solid var(--border)", background: "var(--bg-card)", borderRadius: 10,
                padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 14, flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{r.description}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                    {[cat, r.recorded_by_name, waitedFor(r.created_at, en)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 110 }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt(r.amount)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {en ? "not yet paid" : "pas encore payé"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setCancelling({ expense: r, reason: "", error: null })}
                    disabled={busy}
                    style={{ padding: "10px 14px", borderRadius: 8, fontWeight: 700, whiteSpace: "nowrap", border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.10)", color: "#f87171", cursor: "pointer" }}
                  >{en ? "Cancel" : "Annuler"}</button>
                  <button
                    disabled={!isOnline || busy}
                    onClick={() => payout.mutate({ id: r.id, version: r.version })}
                    title={!isOnline ? (en ? "You are offline" : "Vous êtes hors ligne") : ""}
                    style={{
                      padding: "10px 18px", borderRadius: 8, border: "none", fontWeight: 700, whiteSpace: "nowrap",
                      background: (!isOnline || busy) ? "var(--bg-elevated)" : "var(--brand)",
                      color: (!isOnline || busy) ? "var(--text-muted)" : "var(--on-brand)",
                      cursor: (!isOnline || busy) ? "not-allowed" : "pointer",
                    }}
                  >{busy ? "…" : (en ? `Pay out ${fmt(r.amount)}` : `Payer ${fmt(r.amount)}`)}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CANCEL — required reason. This is the one ending that leaves no trace in
          stock, money or debt, so the caption is the only record that the expense
          existed and why it ended. Free text, never a dropdown. */}
      {cancelling && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "auto", zIndex: 3500, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => { if (!cancel.isPending) setCancelling(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16,
            padding: 24, maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
              {en ? "Cancel this expense?" : "Annuler cette dépense ?"}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{cancelling.expense.description}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              {fmt(cancelling.expense.amount)}
              {cancelling.expense.recorded_by_name ? ` · ${en ? "raised by" : "créé par"} ${cancelling.expense.recorded_by_name}` : ""}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.45 }}>
              {en ? "Nothing is reversed — no money has left the drawer. The expense simply ends, and your reason is the only record of it."
                  : "Rien n'est inversé — aucun argent n'est sorti de la caisse. La dépense se termine, et votre motif en est la seule trace."}
            </div>
            <div className="form-group">
              <label className="label">{en ? "Why? *" : "Pourquoi ? *"}</label>
              <textarea className="input" rows={3} autoFocus
                value={cancelling.reason}
                onChange={e => setCancelling(c => ({ ...c, reason: e.target.value, error: null }))}
                placeholder={en ? "e.g. supplier never delivered" : "ex. le fournisseur n'a jamais livré"} />
            </div>
            {cancelling.error ? (
              <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12.5, color: "#f87171" }}>
                <div style={{ fontWeight: 700 }}>{cancelling.error.title}</div>
                {cancelling.error.detail ? <div style={{ marginTop: 2 }}>{cancelling.error.detail}</div> : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={cancel.isPending}
                onClick={() => setCancelling(null)}>{en ? "Keep it" : "Garder"}</button>
              <button className="btn btn-danger" style={{ flex: 2 }}
                disabled={cancelling.reason.trim().length < 4 || cancel.isPending}
                onClick={() => cancel.mutate({ id: cancelling.expense.id, version: cancelling.expense.version, reason: cancelling.reason.trim() })}>
                {cancel.isPending ? "…" : (en ? "Cancel the expense" : "Annuler la dépense")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
