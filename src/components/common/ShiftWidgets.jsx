// MP-CASH-SHIFTS-UI — shared widgets for the cash-shift contract
// shipped in aa71d81. Exports:
//
//   <ActiveShiftIndicator />       — self-contained banner (queries
//                                    /shifts/current, hosts open/close
//                                    modals, refetches every 30s).
//                                    Drop into POSPage / Dashboard /
//                                    ShiftsPage above the main content.
//
//   <OpenShiftModal />             — POST /shifts/open. Validates
//                                    location + non-negative float,
//                                    surfaces 409 inline so the user
//                                    can keep their input.
//
//   <CloseShiftModal shift={...}/> — POST /shifts/:id/close. Renders
//                                    the drawer breakdown read from
//                                    /shifts/current, live variance
//                                    preview, confirm-on-variance.
//
// MP-REQUIRE-OPEN-SHIFT Phase 3 additions:
//
//   useActiveShift()               — hook: { locId, hasShift, isLoading,
//                                    data, locationName }. Reuses the
//                                    same ["current-shift", locId] key
//                                    so the indicator + every blocker
//                                    share one cache (no duplicate
//                                    network calls).
//
//   <ShiftRequiredBlocker />       — centered card surfaced when no
//                                    shift is open. Hosts OpenShiftModal
//                                    on demand. Renders nothing when a
//                                    shift IS open. Mount it on pages
//                                    whose entire purpose is money
//                                    operations (RefundsPage).
//
// All three share invalidation of  ["current-shift", location_id] and
// ["shifts-history", ...]. They also invalidate the legacy keys
// ["my-shift"] / ["all-shifts"] so the legacy ShiftsPage section keeps
// agreeing with the new endpoints until Stage 2 retires that path.

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../../store";
import api, { formatCFA } from "../../utils/api";
import { buildLedgerTextV2 as buildLedgerText, buildWeeklyText } from "../../utils/reportText";

// ── ModalShell — same overlay pattern as the rest of the app ─────
function ModalShell({ children, onClose, busy }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, positive, negative }) {
  const color = positive ? "#34d399" : negative ? "#f87171" : "var(--text-primary)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// OPEN MODAL
// ─────────────────────────────────────────────────────────────────
export function OpenShiftModal({ open, onClose, onOpened }) {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();

  // MP-OPEN-SHIFT-LOCATION-CLARITY: load the org's locations so
  // we can render a prominent in-modal dropdown when there's a
  // real choice. Reuses the ["locations"] react-query key the
  // rest of the app already populates — likely a cache hit.
  const { data: locsResp } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    enabled: open,
  });
  const locations = locsResp?.data || [];
  const multiLoc = locations.length > 1;
  const singleLoc = locations.length === 1;

  // Local in-modal selection. Defaults to the store's
  // selectedLocation (which doubles as "most recently active"
  // since it persists across sessions), falling back to first
  // alphabetical when no store value exists.
  const sortedLocs = [...locations].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")));
  const [chosenLocId, setChosenLocId] = useState(selectedLocation?.id || null);
  useEffect(() => {
    if (!open) return;
    const next = selectedLocation?.id
      || (sortedLocs[0] && sortedLocs[0].id)
      || null;
    setChosenLocId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedLocation?.id, locations.length]);
  const chosenLoc = locations.find(l => l.id === chosenLocId) || selectedLocation || null;
  const chosenName = chosenLoc?.name || (lang === "fr" ? "Aucun" : "None");

  const [openingFloat, setOpeningFloat] = useState("");
  const [notes, setNotes]               = useState("");
  const [error, setError]               = useState(null);

  const fl = Number(openingFloat);
  const validInput = openingFloat !== "" && Number.isFinite(fl) && fl >= 0;
  const hasLoc     = !!chosenLocId;

  const m = useMutation({
    mutationFn: () => api.post("/shifts/open", {
      location_id:   chosenLocId,
      opening_float: fl,
      notes:         notes || null,
    }),
    onSuccess: (res) => {
      const d = res?.data?.data || {};
      // Sync the global store to whatever was picked so the rest
      // of the app (sales, refunds, etc.) attributes to the SAME
      // location the shift was opened at. Without this, the top-
      // bar location selector could silently disagree.
      if (chosenLoc && chosenLocId !== selectedLocation?.id) {
        setLocation(chosenLoc);
      }
      // MP-PHASE-3-OFFLINE-SHIFT: optimistic 202 from the offline queue →
      // tell the cashier it'll sync rather than implying it hit the server.
      toast.success(res?.data?.offline_queued
        ? (lang === "fr" ? `Poste ouvert à ${chosenName} · se synchronisera` : `Shift opened at ${chosenName} · will sync`)
        : (lang === "fr"
            ? `Poste ouvert à ${chosenName} avec ${formatCFA(d.opening_float)}`
            : `Shift opened at ${chosenName} with ${formatCFA(d.opening_float)}`));
      // MP-PHASE-3-OFFLINE-SHIFT: offline open is optimistic. The
      // ["current-shift", locId] query can't refetch while offline
      // (networkMode 'online' pauses it), so without seeding the cache the
      // POS keeps seeing no open shift and blocks sales — making the "·
      // will sync" toast a false promise. Seed it so the shift reads as open
      // immediately. Drawer math starts at zero (offline sales don't update
      // it locally yet — Phase 3.1; the authoritative close reconciles from
      // server-side pa_drawer_ledger once the queue drains). All consumers
      // read these with `|| 0` guards, so the zeros are safe.
      if (res?.data?.offline_queued && chosenLocId) {
        const nowIso = new Date().toISOString();
        qc.setQueryData(["current-shift", chosenLocId], {
          shift_id:            d.shift_id,
          status:              "open",
          opening_float:       fl,
          opened_at:           nowIso,
          shift_date:          nowIso.split("T")[0],
          cashier_id:          user?.id ?? null,
          cashier_name:        user?.name ?? null,
          location_id:         chosenLocId,
          cash_sales_received: 0,
          cash_refunds:        0,
          cash_expenses:       0,
          expected_drawer:     fl,
          actual_cash:         null,
        });
      }
      // New keys (canonical) + legacy keys (still read by the
      // bridge ShiftsPage table until Stage 2 swap completes). When queued,
      // do NOT invalidate current-shift — a refetch on a connectivity flicker
      // would hit /shifts/current before the open has synced and clobber the
      // seed with "no open shift", re-blocking sales. The seed holds until
      // the queue drains the open; a later online refetch returns the real row.
      if (!res?.data?.offline_queued) {
        qc.invalidateQueries({ queryKey: ["current-shift"] });
      }
      qc.invalidateQueries({ queryKey: ["shifts-history"] });
      qc.invalidateQueries({ queryKey: ["my-shift"] });
      qc.invalidateQueries({ queryKey: ["all-shifts"] });
      setOpeningFloat(""); setNotes(""); setError(null);
      onClose(); onOpened?.(d);
    },
    onError: (err) => {
      const r = err.response;
      if (r?.status === 409) {
        setError(lang === "fr"
          ? "Un poste est déjà ouvert à cet emplacement. Fermez-le d'abord."
          : "A shift is already open at this location. Close it first.");
      } else if (r?.data?.message) {
        setError(r.data.message);
      } else {
        setError(lang === "fr" ? "Erreur réseau. Réessayez." : "Network error. Retry.");
      }
    }
  });

  if (!open) return null;

  return (
    <ModalShell onClose={() => { setError(null); onClose(); }} busy={m.isPending}>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
        🔓 {multiLoc
          ? (lang === "fr" ? "Choisir l'emplacement et le fond de caisse" : "Choose location and opening float")
          : (lang === "fr" ? "Ouvrir le poste de caisse" : "Open cash shift")}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {lang === "fr" ? "Comptez le fond de caisse au démarrage." : "Count the opening float."}
      </div>

      {/* MP-OPEN-SHIFT-LOCATION-CLARITY: prominent in-modal
          location picker. Read-only display when only one
          location exists (no real choice to make); full
          dropdown when there are multiple. Either way, sits
          at the top of the modal so the cashier sees which
          till they're committing to before they enter cash. */}
      <div style={{
        background: "var(--bg-card)", borderRadius: 10,
        padding: "12px 14px", marginBottom: 14,
        border: multiLoc ? "1px solid rgba(79,70,229,0.30)" : "1px solid transparent",
      }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
          {lang === "fr" ? "Ouvrir la caisse à" : "Open shift at"}
        </div>
        {multiLoc ? (
          <select
            className="input"
            value={chosenLocId || ""}
            onChange={e => setChosenLocId(e.target.value)}
            style={{ fontSize: 15, fontWeight: 700 }}
            autoFocus>
            {sortedLocs.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: hasLoc ? "var(--text-primary)" : "#f87171" }}>
            📍 {chosenName}
          </div>
        )}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <Row label={lang === "fr" ? "Caissier" : "Cashier"}
               value={user?.full_name || user?.name || "—"} />
        </div>
      </div>

      <div className="form-group">
        <label className="label">
          {lang === "fr" ? "Solde d'ouverture (FCFA) *" : "Opening float (FCFA) *"}
        </label>
        <input className="input" type="number" min="0" step="1"
          value={openingFloat}
          onChange={e => { setOpeningFloat(e.target.value); setError(null); }}
          placeholder="0"
          autoFocus={!multiLoc}
          style={{ fontSize: 18, fontWeight: 700, textAlign: "center" }} />
        {openingFloat !== "" && !validInput && (
          <div style={{ fontSize: 11, color: "#f87171", marginTop: 4, fontWeight: 600 }}>
            {lang === "fr" ? "Doit être un nombre ≥ 0" : "Must be a number ≥ 0"}
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="label">{lang === "fr" ? "Notes (optionnel)" : "Notes (optional)"}</label>
        <textarea className="input" rows={2}
          value={notes} onChange={e => setNotes(e.target.value)}
          placeholder={lang === "fr" ? "Commentaire éventuel" : "Optional comment"} />
      </div>

      {!hasLoc && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#f87171" }}>
          {lang === "fr"
            ? "Aucun emplacement sélectionné. Choisissez-en un via la barre du haut."
            : "No location selected. Pick one in the top bar."}
        </div>
      )}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#f87171" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} disabled={m.isPending}
          onClick={() => { setError(null); onClose(); }}>
          {lang === "fr" ? "Annuler" : "Cancel"}
        </button>
        <button className="btn btn-primary" style={{ flex: 2 }}
          disabled={!validInput || !hasLoc || m.isPending}
          onClick={() => m.mutate()}>
          {m.isPending ? "..." : (lang === "fr" ? "✓ Ouvrir le poste" : "✓ Open shift")}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// CLOSE MODAL
// ─────────────────────────────────────────────────────────────────
// MP-VOID-AS-RETURN-AND-OWNER-REPORT Unit 3: collapsible category
// row for the close-shift breakdown. Children render below when
// the row is expanded; clicking the row header toggles. Negative
// sign auto-prefixed for the four debit categories.
function CategoryRow({ label, total, count, sign, children, color }) {
  const [open, setOpen] = useState(false);
  const isNeg = sign === "−";
  const amountColor = color
    || (isNeg ? "#f87171" : total > 0 ? "#34d399" : "var(--text-muted)");
  const hasDrill = count > 0;
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        onClick={() => hasDrill && setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 0", fontSize: 13,
          cursor: hasDrill ? "pointer" : "default",
          opacity: hasDrill ? 1 : 0.55,
        }}>
        <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          {hasDrill && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", width: 10, display: "inline-block" }}>
              {open ? "▾" : "▸"}
            </span>
          )}
          {!hasDrill && <span style={{ width: 10 }} />}
          {label}
          {count > 0 && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
              ({count})
            </span>
          )}
        </span>
        <span style={{ color: amountColor, fontWeight: 700, fontFamily: "monospace" }}>
          {sign}{formatCFA(Math.abs(total))}
        </span>
      </div>
      {open && hasDrill && (
        <div style={{ padding: "4px 0 10px 16px", fontSize: 11, color: "var(--text-muted)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function CloseShiftModal({ open, onClose, shift, onClosed }) {
  const { lang } = useLangStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [actual, setActual]         = useState("");
  const [notes, setNotes]           = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError]           = useState(null);

  const expected = Number(shift?.expected_drawer || 0);

  // MP-VOID-AS-RETURN-AND-OWNER-REPORT Unit 3: fetch the
  // categorized drawer breakdown for the per-category modal view.
  // pa_drawer_ledger gives coarse totals; this endpoint slices
  // them into sales_cash / debt_collection / void_refunds / etc.
  // Each category carries a transactions[] drilldown so expand
  // is no-fetch.
  //
  // MP-CASHIER-ROLE-GATING: the categorized view is owner+manager
  // only — backend returns 403 for cashier. Disable the query for
  // cashier to avoid the 403 noise + render the simple lump-sum
  // pa_drawer_ledger fallback (which works without this fetch).
  const canSeeCategorized = user?.role !== "cashier";
  const { data: catResp } = useQuery({
    queryKey: ["shift-categorized", shift?.shift_id],
    queryFn: () => api.get(`/shifts/${shift.shift_id}/categorized`).then(r => r.data?.data),
    enabled: open && !!shift?.shift_id && canSeeCategorized,
  });
  const cat = catResp || null;
  const fr  = lang === "fr";
  const amt      = actual === "" ? null : Number(actual);
  const validAmt = amt !== null && Number.isFinite(amt) && amt >= 0;
  const variance = validAmt ? amt - expected : null;

  const m = useMutation({
    mutationFn: () => api.post(`/shifts/${shift.shift_id}/close`, {
      actual_cash: amt,
      notes:       notes || null,
    }),
    onSuccess: (res) => {
      const d = res?.data?.data || {};
      // MP-PHASE-3-OFFLINE-SHIFT: offline close is optimistic — variance
      // isn't known until close_cash_shift runs server-side on sync.
      if (res?.data?.offline_queued) {
        toast.success(lang === "fr" ? "Poste fermé · se synchronisera" : "Shift closed · will sync");
      } else {
        const v = Number(d.variance || 0);
        const msg = v === 0
          ? (lang === "fr" ? "Poste fermé. Caisse exacte ✓" : "Shift closed. Drawer exact ✓")
          : v > 0
            ? (lang === "fr" ? `Poste fermé. Excédent : +${formatCFA(v)}` : `Shift closed. Surplus: +${formatCFA(v)}`)
            : (lang === "fr" ? `Poste fermé. Manquant : ${formatCFA(v)}` : `Shift closed. Shortage: ${formatCFA(v)}`);
        toast.success(msg);
      }
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["shifts-history"] });
      qc.invalidateQueries({ queryKey: ["my-shift"] });
      qc.invalidateQueries({ queryKey: ["all-shifts"] });
      setActual(""); setNotes(""); setConfirming(false); setError(null);
      onClose(); onClosed?.(d);
    },
    onError: (err) => {
      setError(err.response?.data?.message
        || (lang === "fr" ? "Erreur réseau. Réessayez." : "Network error. Retry."));
      setConfirming(false);
    }
  });

  if (!open || !shift) return null;

  const handleSubmit = () => {
    if (!validAmt || m.isPending) return;
    // Two-step submit when variance ≠ 0 so the cashier can't
    // accidentally lock in a wrong count.
    if (variance !== 0 && !confirming) { setConfirming(true); return; }
    m.mutate();
  };

  let varText, varColor;
  if (amt === null) {
    varText  = lang === "fr" ? "Entrez le solde réel pour voir l'écart" : "Enter actual cash to see variance";
    varColor = "var(--text-muted)";
  } else if (variance === 0) {
    varText  = lang === "fr" ? "Écart : 0 FCFA — Caisse exacte" : "Variance: 0 FCFA — Drawer exact";
    varColor = "#34d399";
  } else if (variance > 0) {
    varText  = lang === "fr" ? `Écart : +${formatCFA(variance)} — Excédent` : `Variance: +${formatCFA(variance)} — Surplus`;
    varColor = "#fbbf24";
  } else {
    varText  = lang === "fr" ? `Écart : −${formatCFA(Math.abs(variance))} — Manquant` : `Variance: −${formatCFA(Math.abs(variance))} — Shortage`;
    varColor = "#f87171";
  }

  return (
    <ModalShell onClose={() => { setError(null); setConfirming(false); onClose(); }} busy={m.isPending}>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
        🔒 {lang === "fr" ? "Fermer le poste de caisse" : "Close cash shift"}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {lang === "fr" ? "Comptez l'argent dans la caisse et entrez le total." : "Count the cash and enter the total."}
      </div>

      <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        {/* Opening float — always shown, single line. */}
        <Row label={fr ? "Solde d'ouverture" : "Opening float"}
             value={formatCFA(shift.opening_float || 0)} />

        {/* MP-VOID-AS-RETURN-AND-OWNER-REPORT Unit 3: per-category
            breakdown with expand-on-click drilldowns. Falls back
            to the simple lump-sum view if the categorized fetch
            hasn't loaded or failed (best-effort UX). */}
        {cat ? (
          <>
            <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
            <CategoryRow
              label={fr ? "Ventes en espèces" : "Cash sales"}
              total={cat.sales_cash.total} count={cat.sales_cash.count} sign="+">
              {cat.sales_cash.transactions.map(tx => (
                <div key={tx.payment_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.sale_number || "—"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.amount)}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Encaissements dette" : "Debt collections"}
              total={cat.debt_collection.total} count={cat.debt_collection.count} sign="+">
              {cat.debt_collection.transactions.map(tx => (
                <div key={tx.payment_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.sale_number || "—"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.amount)}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Échanges (entrée)" : "Exchanges (in)"}
              total={cat.exchange_in.total} count={cat.exchange_in.count} sign="+">
              {cat.exchange_in.transactions.map(tx => (
                <div key={tx.return_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.return_ref || tx.sale_number || "—"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.price_difference)}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Remboursements" : "Refunds"}
              total={cat.refunds.total} count={cat.refunds.count} sign="−">
              {cat.refunds.transactions.map(tx => (
                <div key={tx.return_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.return_ref || "—"} ← {tx.sale_number || "?"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.refund_amount)}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Annulations — espèces rendues" : "Voids — cash refunded"}
              total={cat.void_refunds.total} count={cat.void_refunds.count} sign="−">
              {cat.void_refunds.transactions.map(tx => (
                <div key={tx.return_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.return_ref || "—"} ← {tx.sale_number || "?"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.refund_amount)}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Échanges (sortie)" : "Exchanges (out)"}
              total={cat.exchange_out.total} count={cat.exchange_out.count} sign="−">
              {cat.exchange_out.transactions.map(tx => (
                <div key={tx.return_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.return_ref || tx.sale_number || "—"} {tx.customer_name ? `· ${tx.customer_name}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(Math.abs(tx.price_difference))}</span>
                </div>
              ))}
            </CategoryRow>
            <CategoryRow
              label={fr ? "Dépenses" : "Expenses"}
              total={cat.expenses.total} count={cat.expenses.count} sign="−">
              {cat.expenses.transactions.map(tx => (
                <div key={tx.expense_id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{tx.category || "—"} {tx.description ? `· ${tx.description}` : ""}</span>
                  <span style={{ fontFamily: "monospace" }}>{formatCFA(tx.amount)}</span>
                </div>
              ))}
            </CategoryRow>
          </>
        ) : (
          /* Fallback: pa_drawer_ledger lump sums while categorized
             fetch is loading or if it failed. Same fields the
             modal showed pre-Unit-3. */
          <>
            <Row label={fr ? "+ Ventes en espèces"      : "+ Cash sales"}
                 value={formatCFA(shift.cash_sales_received || 0)} positive />
            <Row label={fr ? "− Remboursements espèces" : "− Cash refunds"}
                 value={formatCFA(shift.cash_refunds || 0)} negative />
            <Row label={fr ? "− Dépenses espèces"       : "− Cash expenses"}
                 value={formatCFA(shift.cash_expenses || 0)} negative />
          </>
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700 }}>{fr ? "Caisse attendue" : "Expected drawer"}</span>
          <strong style={{ fontSize: 18, color: "var(--brand-light)" }}>{formatCFA(expected)}</strong>
        </div>
      </div>

      <div className="form-group">
        <label className="label">
          {lang === "fr" ? "Solde réel comptabilisé (FCFA) *" : "Actual cash counted (FCFA) *"}
        </label>
        <input className="input" type="number" min="0" step="1"
          value={actual}
          onChange={e => { setActual(e.target.value); setError(null); setConfirming(false); }}
          autoFocus
          style={{ fontSize: 18, fontWeight: 700, textAlign: "center" }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: varColor, marginTop: 8, textAlign: "center" }}>
          {varText}
        </div>
      </div>

      <div className="form-group">
        <label className="label">
          {lang === "fr" ? "Notes de fermeture (optionnel)" : "Closing notes (optional)"}
        </label>
        <textarea className="input" rows={2}
          value={notes} onChange={e => setNotes(e.target.value)}
          placeholder={lang === "fr" ? "Ex : client a payé en pièces" : "e.g. customer paid in coins"} />
      </div>

      {confirming && variance !== 0 && (
        <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#fbbf24" }}>
          {lang === "fr"
            ? "L'écart sera enregistré dans l'historique. Voulez-vous continuer ?"
            : "The variance will be recorded in history. Continue?"}
        </div>
      )}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#f87171" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} disabled={m.isPending}
          onClick={() => { setError(null); setConfirming(false); onClose(); }}>
          {lang === "fr" ? "Annuler" : "Cancel"}
        </button>
        <button className="btn btn-primary" style={{ flex: 2, ...(confirming && variance !== 0 ? { background: "#fbbf24", borderColor: "#fbbf24" } : {}) }}
          disabled={!validAmt || m.isPending}
          onClick={handleSubmit}>
          {m.isPending
            ? "..."
            : confirming && variance !== 0
              ? (lang === "fr" ? "✓ Confirmer la fermeture" : "✓ Confirm close")
              : (lang === "fr" ? "✓ Fermer le poste" : "✓ Close shift")}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SEND REPORT PROMPT (MP-REPORT-SIMPLIFY-AND-AUTOSEND)
//
// Pops after CloseShiftModal succeeds, IF the org has opted into
// auto-send (daily_summary_enabled) AND has an owner WhatsApp set
// (whatsapp_number). Otherwise self-dismisses (with a toast nudge
// when phone is missing but auto-send is on).
//
// Pulls /reports/daily-ledger for today + location, builds the
// simplified plain-text body via buildLedgerText (shared util), and
// on Saturdays appends the weekly summary from /reports/weekly-
// ledger. Opens a wa.me deep link — one-tap design per spec; we do
// NOT auto-deliver (would require WhatsApp Business API).
// ─────────────────────────────────────────────────────────────────
function SendReportPromptModal({ locationId, onClose }) {
  const { lang } = useLangStore();
  const fr = lang === "fr";

  // Org settings: existing /settings endpoint, response is
  // { success, data: { whatsapp_number, daily_summary_enabled, ... } }.
  const { data: settingsResp, isLoading: settingsLoading } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });
  const settings = settingsResp?.data || null;
  const autoSendEnabled = settings ? settings.daily_summary_enabled !== false : true; // default ON per task
  const phoneRaw   = settings?.whatsapp_number || "";
  const phoneDigits = phoneRaw.toString().replace(/\D/g, "");
  const phoneOk    = phoneDigits.length >= 8;
  const phoneWithCode = phoneDigits.startsWith("237") ? phoneDigits : "237" + phoneDigits;

  const today    = new Date().toISOString().slice(0, 10);
  const isSaturday = new Date(today + "T00:00:00").getUTCDay() === 6;

  // Daily ledger (only enabled once we know auto-send is on + phone OK).
  const fetchEnabled = !!locationId && !settingsLoading && autoSendEnabled && phoneOk;
  const { data: ledgerResp, isLoading: ledgerLoading } = useQuery({
    queryKey: ["report-prompt-daily", today, locationId],
    queryFn: () => api.get(`/reports/daily-ledger?date=${today}&location_id=${locationId}`).then(r => r.data),
    enabled: fetchEnabled,
  });
  const ledger = ledgerResp?.data || null;

  // Weekly summary only on Saturdays. Endpoint requires a specific
  // location (no all-shops aggregation).
  const { data: weeklyResp } = useQuery({
    queryKey: ["report-prompt-weekly", today, locationId],
    queryFn: () => api.get(`/reports/weekly-ledger?week_ending=${today}&location_id=${locationId}`).then(r => r.data),
    enabled: fetchEnabled && isSaturday,
  });
  const weekly = weeklyResp?.data || null;

  // Auto-dismiss + nudge branches. Effects run AFTER render so the
  // modal mounts briefly even when self-dismissing — acceptable
  // for the small UX cost; alternative would mean lifting all this
  // logic into the parent.
  useEffect(() => {
    if (settingsLoading || !settings) return;
    if (!autoSendEnabled) {
      // Toggle off — no prompt, no toast (spec: "Skip prompt entirely.
      // Normal shift-close success toast.")
      onClose();
      return;
    }
    if (!phoneOk) {
      toast(
        fr
          ? "Numéro WhatsApp du propriétaire non configuré — réglez dans Paramètres pour activer l'envoi auto."
          : "Owner WhatsApp number not set — configure in Settings to enable auto-send.",
        { duration: 5500 }
      );
      onClose();
      return;
    }
  }, [settingsLoading, settings, autoSendEnabled, phoneOk, onClose, fr]);

  if (settingsLoading || !settings) return null;
  if (!autoSendEnabled || !phoneOk) return null;

  // Compose the text body. Daily always; weekly appended on Sat.
  const dailyTxt  = ledger ? buildLedgerText(ledger, lang) : "";
  const weeklyTxt = (isSaturday && weekly) ? buildWeeklyText(weekly, lang) : "";
  const fullText  = dailyTxt + weeklyTxt;

  const handleSend = () => {
    if (!fullText) return;
    const url = `https://wa.me/${phoneWithCode}?text=${encodeURIComponent(fullText)}`;
    window.open(url, "_blank");
    toast.success(fr ? "WhatsApp ouvert — tapez Envoyer pour livrer" : "WhatsApp opened — tap Send to deliver");
    onClose();
  };

  const previewLines = fullText ? fullText.split("\n") : [];

  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
        📤 {fr ? "Envoyer le rapport au propriétaire ?" : "Send daily report to owner?"}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        {fr ? "Destinataire" : "Recipient"}: <strong>+{phoneWithCode}</strong>
        {isSaturday && (
          <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 8, background: "rgba(79,70,229,0.15)", color: "var(--brand-light)", fontSize: 11, fontWeight: 700 }}>
            {fr ? "Inclut résumé hebdo" : "Includes weekly recap"}
          </span>
        )}
      </div>

      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "10px 12px", marginBottom: 12,
        maxHeight: 280, overflowY: "auto",
        fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap",
        color: "var(--text-secondary)",
      }}>
        {ledgerLoading || !fullText
          ? <em style={{ color: "var(--text-muted)" }}>{fr ? "Préparation du message…" : "Preparing message…"}</em>
          : previewLines.join("\n")}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
          {fr ? "Passer" : "Skip"}
        </button>
        <button className="btn btn-primary" style={{ flex: 2, background: "#25D366", border: "none", color: "#fff" }}
          disabled={!fullText}
          onClick={handleSend}>
          📱 {fr ? "Envoyer via WhatsApp" : "Send via WhatsApp"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// INDICATOR (self-contained: queries /current, hosts both modals)
// ─────────────────────────────────────────────────────────────────
export function ActiveShiftIndicator() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const locId = selectedLocation?.id || null;

  const [showOpen, setShowOpen]   = useState(false);
  const [showClose, setShowClose] = useState(false);
  // MP-REPORT-SIMPLIFY-AND-AUTOSEND: when a close succeeds, capture
  // the location_id so SendReportPromptModal knows what to fetch.
  // null = no prompt pending.
  const [reportPromptLoc, setReportPromptLoc] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["current-shift", locId],
    queryFn: () => api.get(`/shifts/current?location_id=${locId}`).then(r => r.data?.data),
    enabled: !!locId,
    refetchInterval: 30000,
  });

  // Without a location, the backend can't resolve a shift. Show a
  // slim hint so the cashier knows what to do next, but don't
  // pretend there's no shift open elsewhere.
  if (!locId) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, background: "rgba(100,100,100,0.08)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
        📍 {lang === "fr"
          ? "Sélectionnez un emplacement pour voir le poste de caisse."
          : "Select a location to see the cash shift."}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
        {lang === "fr" ? "Chargement du poste…" : "Loading shift…"}
      </div>
    );
  }

  const isOpen   = !!(data && data.shift_id);
  const opened   = isOpen && new Date(data.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const expected = Number(data?.expected_drawer || 0);
  // MP-OPEN-SHIFT-LOCATION-CLARITY: show WHICH location the
  // shift is at so cashiers know which till they're committing
  // to. Backend echoes location_name; fall back to the store's
  // current selectedLocation name (matches the shift the
  // /current query was scoped to via location_id param).
  const locName = data?.location_name || selectedLocation?.name || null;

  return (
    <>
      {isOpen ? (
        <div role="button" tabIndex={0}
          onClick={() => setShowClose(true)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowClose(true); } }}
          style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.35)",
            cursor: "pointer", transition: "background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(16,185,129,0.16)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(16,185,129,0.10)"}
          title={lang === "fr" ? "Cliquer pour fermer le poste" : "Click to close the shift"}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#34d399" }}>
            🟢 {locName
              ? (lang === "fr"
                  ? `Poste ouvert à ${locName} depuis ${opened}`
                  : `Shift open at ${locName} since ${opened}`)
              : (lang === "fr"
                  ? `Poste ouvert depuis ${opened}`
                  : `Shift open since ${opened}`)}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>•</span>
          <span style={{ fontSize: 13 }}>
            {lang === "fr" ? "Caisse attendue : " : "Expected drawer: "}
            <strong style={{ color: "var(--brand-light)" }}>{formatCFA(expected)}</strong>
          </span>
          {data?.cashier_name && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
              {/* MP-DRAWER-MODE-TOGGLE: in shared mode the listed
                  cashier is the SHIFT OPENER, not necessarily the
                  current viewer. Relabel so cashiers don't mistake
                  it for "you". */}
              {data.drawer_mode === "shared"
                ? `🔑 ${lang === "fr" ? "Ouvert par" : "Opened by"} : ${data.cashier_name}`
                : `👤 ${data.cashier_name}`}
            </span>
          )}
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.30)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>
            🔴 {lang === "fr" ? "Aucun poste de caisse ouvert" : "No cash shift open"}
          </span>
          <button onClick={() => setShowOpen(true)}
            style={{
              marginLeft: "auto", padding: "6px 12px", borderRadius: 8,
              border: "1px solid var(--brand)", background: "var(--brand)",
              color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
            {lang === "fr" ? "Ouvrir le poste" : "Open shift"}
          </button>
        </div>
      )}

      <OpenShiftModal  open={showOpen}  onClose={() => setShowOpen(false)} />
      <CloseShiftModal
        open={showClose}
        onClose={() => setShowClose(false)}
        shift={data}
        onClosed={() => {
          // MP-REPORT-SIMPLIFY-AND-AUTOSEND: trigger the report
          // prompt after the close succeeds. SendReportPromptModal
          // self-dismisses if auto-send is disabled or the owner
          // phone isn't set.
          if (locId) setReportPromptLoc(locId);
        }}
      />
      {reportPromptLoc && (
        <SendReportPromptModal
          locationId={reportPromptLoc}
          onClose={() => setReportPromptLoc(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// MP-REQUIRE-OPEN-SHIFT Phase 3 — useActiveShift + blocker
// ─────────────────────────────────────────────────────────────────

// Shared hook so every consumer (indicator, blocker, disabled
// submit buttons) reads from the SAME react-query cache. The key
// matches what ActiveShiftIndicator uses above so a single
// /shifts/current request serves every consumer at this location.
//
// The backend's /shifts/current is now cashier-scoped (Phase 2
// granularity flip), so `hasShift === true` means THIS cashier
// has THEIR drawer open at THIS location.
export function useActiveShift() {
  const { selectedLocation } = useSettingsStore();
  const locId = selectedLocation?.id || null;
  const { data, isLoading } = useQuery({
    queryKey: ["current-shift", locId],
    queryFn: () => api.get(`/shifts/current?location_id=${locId}`).then(r => r.data?.data),
    enabled: !!locId,
    refetchInterval: 30000,
  });
  return {
    locId,
    locationName: selectedLocation?.name || null,
    isLoading,
    data,
    hasShift: !!(data && data.shift_id),
  };
}

// Centered blocker card. Use either as a self-rendering wall
// (returns null when a shift IS open) or as a children-gating
// wrapper:
//
//   <ShiftRequiredBlocker><RefundList /></ShiftRequiredBlocker>
//
// While the active-shift query is loading, children render
// optimistically — the backend is the authoritative gate, so the
// worst case is a 400 NO_OPEN_SHIFT that the axios interceptor
// turns into a localized toast. When there's no selectedLocation
// (a state the rest of the app already handles upstream), we also
// pass through to children.
export function ShiftRequiredBlocker({ children }) {
  const { lang } = useLangStore();
  const fr = lang === "fr";
  const { locId, hasShift, isLoading } = useActiveShift();
  const [showOpen, setShowOpen] = useState(false);

  if (!locId)         return children || null;
  if (isLoading)      return children || null;
  if (hasShift)       return children || null;

  return (
    <>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "36px 24px", textAlign: "center",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 16, maxWidth: 480, margin: "32px auto",
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
          {fr ? "Ouvrez votre caisse pour continuer" : "Open your shift to continue"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
          {fr
            ? "Toute opération qui touche l'argent (ventes, remboursements, dépenses, encaissement de dette) nécessite un poste de caisse ouvert."
            : "Every money operation (sales, refunds, expenses, debt collection) requires an open cash shift."}
        </div>
        <button className="btn btn-primary" onClick={() => setShowOpen(true)}>
          🔓 {fr ? "Ouvrir la caisse" : "Open shift now"}
        </button>
      </div>
      <OpenShiftModal open={showOpen} onClose={() => setShowOpen(false)} />
    </>
  );
}

// Helper: short EN/FR hint string to render next to a disabled
// submit button. Centralised so the wording stays consistent
// across POSPage, CustomersPage, ExpenditurePage, RefundsPage.
export function noShiftHint(lang) {
  return lang === "fr"
    ? "🔒 Ouvrez la caisse pour confirmer"
    : "🔒 Open shift to confirm";
}
