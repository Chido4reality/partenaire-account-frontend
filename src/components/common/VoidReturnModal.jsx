import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { useCurrency } from "../../utils/useCurrency";
import OwnerPIN from "./OwnerPIN";
import { useSettingsStore, useAuthStore } from "../../store";
import useOwnerApproval from "../../hooks/useOwnerApproval";
import { isPendingApproval, pendingApprovalMessage } from "../../utils/approval";

/**
 * VoidReturnModal — handles void, refund, exchange
 * Props:
 *   sale: the sale object with pa_sale_items
 *   onClose: function
 *   lang: "en" | "fr"
 */
// MP-PAYMENT-EVENT-RECEIPTS Phase 3: onSuccess({ mode, data })
// bubbles the response back up so the parent page can open a
// PaymentEventReceipt. mode is 'void' / 'refund' / 'exchange';
// data is the backend's enriched response payload.
export default function VoidReturnModal({ sale, onClose, lang = "fr", onSuccess }) {
  const qc = useQueryClient();
  const fmt = useCurrency();
  const { selectedLocation } = useSettingsStore();
  // MP-REFUNDS-STAFF-ACCESS: cashier is allowed to see this modal
  // (refund + exchange flows) but NOT the Void button. Voiding wipes
  // a sale entirely and restores stock — fraud vector if a cashier
  // could do it alone. Backend mirrors this gate
  // (returns.js: /void requires owner/manager; /return + /exchange
  // open to cashier).
  const { user } = useAuthStore();
  // MP-OWNER-PIN-APPROVAL (Wave 2): voiding is now token-gated, so
  // cashier can void too (with an owner/manager PIN at the counter).
  // Same-day rule still enforced server-side for non-owner.
  const canVoid = ["owner", "manager", "cashier"].includes(user?.role);
  const { requestApproval, modal: approvalModal } = useOwnerApproval();
  // The return inherits the sale's location. Some report payloads
  // don't include location_id (pre-multi-location / trimmed select),
  // so fall back to the cashier's currently selected location.
  const returnLocationId = sale.location_id || selectedLocation?.id || null;
  const [mode, setMode] = useState(null); // "void" | "refund" | "exchange"
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(sale.total_amount || "");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [restock, setRestock] = useState(true);
  // MP-DEBT-LINE-FULL-VISIBILITY: debt-payment rows are not stock-
  // returnable items — they belong to the customer-debt ledger, not
  // the product ledger. Keep them OUT of the refund/exchange item
  // selection so a cashier can't accidentally try to "return" a debt
  // repayment. (Voiding a sale that includes debt rows: see void mode
  // banner below.)
  const [selectedItems, setSelectedItems] = useState(
    (sale.pa_sale_items || [])
      .filter(i => i.line_type !== "debt_payment" && i.product_id !== null)
      .map(i => ({ ...i, returnQty: i.quantity, selected: true, retReason: "changed_mind" }))
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [loading, setLoading] = useState(false);
  // Phase 5b: when a gated staffer's action is HELD for owner approval the server
  // returns 202 pending_approval and nothing happened — show this instead of a
  // receipt (which would wrongly read "Refund Recorded / 0 FCFA").
  const [held, setHeld] = useState(null); // the held message string

  // Sprint L: return-window banner. <30d OK, 30d–1y needs an
  // override reason, >1y the server rejects.
  const saleAgeDays = Math.floor(
    (Date.now() - new Date(sale.created_at || sale.sale_date || Date.now()).getTime()) / 86400000
  );
  const pastWindow = saleAgeDays > 30;
  const RET_REASONS = [
    ["defective",   lang === "en" ? "Defective"     : "Défectueux"],
    ["wrong_item",  lang === "en" ? "Wrong item"    : "Mauvais article"],
    ["changed_mind",lang === "en" ? "Changed mind"  : "A changé d'avis"],
    ["damaged",     lang === "en" ? "Damaged"       : "Endommagé"],
    ["other",       lang === "en" ? "Other"         : "Autre"],
  ];
  const setItemReason = (idx, r) =>
    setSelectedItems(prev => prev.map((it, i) => i === idx ? { ...it, retReason: r } : it));

  // Exchange-specific state
  const [newItems, setNewItems] = useState([]);
  const [exchSearch, setExchSearch] = useState("");

  const { data: productsData } = useQuery({
    queryKey: ["products-all"],
    queryFn: () => api.get("/products?limit=500").then(r => r.data),
    enabled: mode === "exchange",
  });
  const allProducts = productsData?.data || [];
  const filteredProducts = exchSearch.trim().length > 0
    ? allProducts.filter(p => p.name.toLowerCase().includes(exchSearch.toLowerCase()) && p.is_active !== false)
    : [];

  const addNewItem = (product) => {
    setNewItems(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      if (existing) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: product.id, name: product.name,
        sell_price: product.sell_price || 0,
        min_price: product.min_price || product.cost_price || 0,
        quantity: 1 }];
    });
    setExchSearch("");
  };

  const updateNewItemQty = (idx, qty) => {
    const q = Math.max(1, +qty || 1);
    setNewItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: q } : it));
  };
  // Exchange-time negotiation: the replacement price is editable.
  // Empty is tolerated mid-typing (treated as 0 for live totals).
  const updateNewItemPrice = (idx, price) => {
    const p = price === "" ? "" : Math.max(0, +price || 0);
    setNewItems(prev => prev.map((it, i) => i === idx ? { ...it, sell_price: p } : it));
  };

  const removeNewItem = (idx) => setNewItems(prev => prev.filter((_, i) => i !== idx));

  const returnedTotal = selectedItems.filter(i => i.selected).reduce((s, i) => s + i.returnQty * i.unit_price, 0);
  const newTotal = newItems.reduce((s, i) => s + i.quantity * i.sell_price, 0);
  const cashDiff = newTotal - returnedTotal;

  const items = sale.pa_sale_items || [];
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const toggleItem = (idx) => {
    setSelectedItems(prev => prev.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  };

  const setReturnQty = (idx, qty) => {
    setSelectedItems(prev => prev.map((it, i) => i === idx ? { ...it, returnQty: +qty } : it));
  };

  // MP-VOID-REASON-REQUIRED-FIELD: derived validity for the void
  // path's reason field. Min 3 trimmed chars matches the backend
  // 400 VOID_REASON_REQUIRED + DB CHECK void_reason_when_voided.
  const voidReasonValid = reason.trim().length >= 3;

  const handleSubmit = async () => {
    // MP-OWNER-PIN-APPROVAL (Wave 3): refund + exchange now use the
    // same useOwnerApproval flow as void (Wave 2). No inline PIN
    // input anywhere in this modal; the PIN modal pops on submit.
    setLoading(true);
    setPinError("");

    // Sprint L: returns past 30 days require an override reason
    // (the server also enforces this; fail fast for clearer UX).
    if (mode !== "void" && pastWindow && !overrideReason.trim()) {
      setPinError(lang === "en"
        ? "This sale is past 30 days — an override reason is required."
        : "Vente de plus de 30 jours — une raison de dérogation est requise.");
      setLoading(false);
      return;
    }

    // MP-VOID-REASON-REQUIRED-FIELD: void requires a reason. Frontend
    // disables Confirm Void until voidReasonValid, but a stray
    // keyboard-submit could still reach here — backstop.
    if (mode === "void" && !voidReasonValid) {
      toast.error(lang === "en"
        ? "Reason required (helps the owner understand voids)."
        : "Raison obligatoire (aide le patron à comprendre les annulations).");
      setLoading(false);
      return;
    }

    try {
      let res;
      if (mode === "void") {
        // MP-OWNER-PIN-APPROVAL: owner direct; manager + cashier
        // surface an Approval-Token via the PIN modal. Cancelling
        // the modal throws code:'cancelled' which we swallow.
        const headers = {};
        if (user?.role !== "owner") {
          try {
            const { token } = await requestApproval({
              actionType:  "void_sale",
              targetTable: "pa_sales",
              targetId:    sale.id,
              context:     { sale_number: sale.sale_number, total: sale.total_amount, reason: reason.trim() },
              description: (lang === "fr"
                ? `Annuler la vente ${sale.sale_number || ""}`
                : `Void sale ${sale.sale_number || ""}`) + ` (${fmt(sale.total_amount || 0)})`,
            });
            headers["Approval-Token"] = token;
          } catch (e) {
            if (e?.code === "cancelled") { setLoading(false); return; }
            throw e;
          }
        }
        res = await api.post(`/returns/void/${sale.id}`, { reason }, { headers });
      } else {
        // Unified return/replace contract (Sprint L). Exchange =
        // refund + replacement_items; backend computes price_difference.
        const items_returned = selectedItems.filter(i => i.selected).map(i => ({
          product_id: i.product_id, qty: +i.returnQty,
          unit_price: +i.unit_price, reason: i.retReason || "other"
        }));
        const replacement_items = mode === "exchange"
          ? newItems.map(i => ({ product_id: i.product_id, qty: +i.quantity, unit_price: +i.sell_price }))
          : [];
        // MP-OWNER-PIN-APPROVAL (Wave 3): legacy pin in body is gone;
        // owner/manager PIN comes via the approval modal and rides as
        // an Approval-Token header. Owner role skips the modal entirely.
        const body = {
          reason, location_id: returnLocationId,
          return_type: mode === "exchange" ? "replace_different" : "refund",
          items_returned, replacement_items,
          refund_method: refundMethod,
          return_window_override: pastWindow,
          override_reason: overrideReason || null,
          notes: reason || null
        };
        const headers = {};
        // MP-CASHIER-REFUNDS: owner AND cashier process refunds/exchanges
        // directly — no PIN modal. (Manager still requires approval; void is
        // unchanged.) Mirrors the backend, which no longer requires an
        // Approval-Token from cashiers on /returns/return + /exchange.
        if (user?.role !== "owner" && user?.role !== "cashier") {
          try {
            const refundTotal = items_returned.reduce((s, i) => s + (i.qty * i.unit_price), 0);
            const { token } = await requestApproval({
              actionType:  mode === "exchange" ? "exchange_sale" : "refund_sale",
              targetTable: "pa_sales",
              targetId:    sale.id,
              context: {
                sale_number: sale.sale_number,
                return_type: body.return_type,
                refund_amount: refundTotal,
                item_count: items_returned.length,
                replacement_count: replacement_items.length,
              },
              description: (lang === "fr"
                ? `${mode === "exchange" ? "Échanger" : "Rembourser"} la vente ${sale.sale_number || ""}`
                : `${mode === "exchange" ? "Exchange" : "Refund"} sale ${sale.sale_number || ""}`)
                + ` (${fmt(refundTotal)})`,
            });
            headers["Approval-Token"] = token;
          } catch (e) {
            if (e?.code === "cancelled") { setLoading(false); return; }
            throw e;
          }
        }
        // Both legacy paths delegate to one server handler.
        res = await api.post(`/returns/${mode === "exchange" ? "exchange" : "return"}/${sale.id}`, body, { headers });
      }

      // Phase 5b: action HELD for owner approval → nothing executed. Show the
      // held confirmation (no receipt, no amount, no "recorded").
      if (isPendingApproval(res?.data)) {
        setHeld(pendingApprovalMessage(res?.data, lang === "en"));
        setLoading(false);
        return;
      }

      const ref = res?.data?.data?.return_ref;
      toast.success(ref
        ? (lang === "en" ? `✓ Return ${ref} recorded` : `✓ Retour ${ref} enregistré`)
        : (lang === "en" ? "✓ Done!" : "✓ Effectué!"));

      // MP-PAYMENT-EVENT-RECEIPTS Phase 3: the old wa_message
      // confirm-dialog flow (window.confirm → wa.me deeplink) is
      // replaced by the parent's PaymentEventReceipt modal, which
      // owns both print + WhatsApp share. Bubble the response up
      // so the parent can mount the receipt; the parent decides
      // when to close THIS modal.

      qc.invalidateQueries(["reports-sales-detail"]);
      qc.invalidateQueries(["reports-returns"]);
      qc.invalidateQueries(["stock"]);
      qc.invalidateQueries(["pos-customers"]);

      const payload = res?.data?.data || {};
      if (onSuccess) onSuccess({ mode, data: payload });
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "Error";
      if (msg.includes("PIN")) setPinError(msg);
      else toast.error(msg);
    } finally { setLoading(false); }
  };

  // Phase 5b: held-for-approval confirmation — replaces the receipt entirely.
  if (held) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, maxWidth: 420, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>⏳</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{lang === "en" ? "Waiting for owner approval" : "En attente de l'approbation du propriétaire"}</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 22 }}>{held}</div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={onClose}>{lang === "en" ? "OK" : "OK"}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {/* MP-OWNER-PIN-APPROVAL (Wave 2): PIN modal for void flow.
          Renders inside this dialog's portal stack so its z:2500
          stays above the outer modal (z:300). */}
      {approvalModal}
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, maxWidth: 500, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          {lang === "en" ? "Void / Return" : "Annulation / Retour"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          {sale.sale_number} · {fmt(total)}
          {sale.pa_customers?.name && ` · ${sale.pa_customers.name}`}
          {sale.channel === "online" && sale.dozie_order_ref && (
            <> · <span style={{ fontFamily: "monospace" }}>{sale.dozie_order_ref}</span></>
          )}
        </div>

        {/* MP-REFUND-SEARCH-ENHANCED: online-channel warning. Cashier
            refunds CASH from the till; original-channel re-refund
            (Mobile Money / card) is the owner's manual job. Proper
            channel-aware refund routing is deferred to a future
            task. */}
        {sale.channel === "online" && (
          <div style={{
            background: "rgba(249,115,22,0.10)", border: "1px solid rgba(249,115,22,0.40)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 16,
            fontSize: 12, color: "#fb923c", lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ⚠ {lang === "en" ? "Online sale" : "Vente en ligne"}
              {sale.dozie_payment_mode && (
                <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 8, background: "rgba(249,115,22,0.15)", fontSize: 11, textTransform: "uppercase" }}>
                  {sale.dozie_payment_mode}
                </span>
              )}
            </div>
            <div style={{ color: "var(--text-secondary)" }}>
              {lang === "en"
                ? "Refund will be processed as cash from the till. The owner needs to refund the customer on the original channel (Mobile Money / card) separately."
                : "Le remboursement sera traité en espèces depuis la caisse. Le propriétaire devra rembourser le client sur le canal d'origine (Mobile Money / carte) séparément."}
            </div>
          </div>
        )}

        {/* MP-CASHIER-VIEW-ITEMS: read-only itemized contents, shown the
            moment the sale opens — for EVERY role. A cashier looking up a
            receipt by number needs to SEE what was sold (a picking list for
            the magasin): product names + quantities + the location. This is
            VIEW-ONLY and reads from the already-permitted GET /sales/:id
            payload — it is NOT coupled to the reports plan-section gate
            (which only guards the bulk /reports/sales-detail listing). All
            money actions (refund/exchange/void) stay gated exactly as before.
            Rendered above the mode buttons so viewing needs no action at all. */}
        {!mode && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                🧾 {lang === "en" ? "Sale contents" : "Contenu de la vente"}
              </div>
              {sale.pa_locations?.name && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  📍 {sale.pa_locations.name}
                </div>
              )}
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 0" }}>
                {lang === "en"
                  ? "Items not loaded — reconnect to see the full list."
                  : "Articles non chargés — reconnectez-vous pour voir la liste complète."}
              </div>
            ) : (
              <>
                {items.map((item, i) => {
                  const isDebt = item.line_type === "debt_payment" || item.product_id === null;
                  const pname = (lang === "en" && item.pa_products?.name_en)
                    ? item.pa_products.name_en
                    : item.pa_products?.name;
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", fontSize: 13, borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {isDebt ? (
                        <span style={{ color: "var(--text-secondary)" }}>💰 {lang === "en" ? "Debt repayment" : "Remboursement dette"}</span>
                      ) : (
                        <span style={{ fontWeight: 600 }}>
                          {pname || (lang === "en" ? "Item" : "Article")}
                          <span style={{ color: "var(--brand-light)", fontWeight: 700 }}> × {item.quantity}</span>
                          {item.pa_products?.unit && <span style={{ color: "var(--text-muted)", fontSize: 11 }}> {item.pa_products.unit}</span>}
                        </span>
                      )}
                      <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmt(item.quantity * item.unit_price)}</span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 2, fontWeight: 800, fontSize: 14, borderTop: "1px solid var(--border)" }}>
                  <span>{lang === "en" ? "Total" : "Total"}</span>
                  <span>{fmt(total)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Mode selection */}
        {!mode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
              {lang === "en" ? "What do you want to do?" : "Que souhaitez-vous faire?"}
            </div>
            {canVoid && (
              <button onClick={() => setMode("void")}
                style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>
                ⚠️ {lang === "en" ? "Void sale (full cancellation, stock restored)" : "Annuler la vente (annulation totale, stock restauré)"}
                <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginTop: 3 }}>
                  {lang === "en" ? "For same-day mistakes — owner/manager only" : "Pour les erreurs du jour — propriétaire/manager seulement"}
                </div>
              </button>
            )}
            <button onClick={() => setMode("refund")}
              style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>
              ↩️ {lang === "en" ? "Return + Refund (full or partial)" : "Retour + Remboursement (total ou partiel)"}
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginTop: 3 }}>
                {lang === "en" ? "Customer returns product, gets money back" : "Client retourne produit, reçoit remboursement"}
              </div>
            </button>
            <button onClick={() => setMode("exchange")}
              style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(251,197,3,0.4)", background: "rgba(251,197,3,0.08)", color: "var(--brand-light)", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>
              🔄 {lang === "en" ? "Exchange (swap for another product)" : "Échange (contre un autre produit)"}
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginTop: 3 }}>
                {lang === "en" ? "Customer swaps product" : "Client échange un produit"}
              </div>
            </button>
            <button onClick={onClose} style={{ padding: "10px", border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
              {lang === "en" ? "Cancel" : "Annuler"}
            </button>
          </div>
        )}

        {/* VOID mode */}
        {mode === "void" && (
          <div>
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 4 }}>⚠️ {lang === "en" ? "Full void" : "Annulation totale"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {lang === "en" ? "This will cancel the entire sale and restore all stock." : "Ceci annule la vente entière et restaure tout le stock."}
              </div>
            </div>
            {items.map((item, i) => {
              const isDebt = item.line_type === "debt_payment" || item.product_id === null;
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                  {isDebt ? (
                    <>
                      <span>💰 {lang === "en" ? "Debt Repayment" : "Remboursement dette"} · {fmt(item.quantity * item.unit_price)}</span>
                      <span style={{ color: "#fbbf24", fontSize: 11 }}>{lang === "en" ? "debt NOT auto-restored" : "dette NON restaurée auto"}</span>
                    </>
                  ) : (
                    <>
                      <span>{item.pa_products?.name} × {item.quantity}</span>
                      <span style={{ color: "#34d399" }}>+{item.quantity} {lang === "en" ? "restored" : "restauré"}</span>
                    </>
                  )}
                </div>
              );
            })}
            {items.some(i => i.line_type === "debt_payment" || i.product_id === null) && (
              <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                ⚠️ {lang === "en"
                  ? "This sale includes a debt-repayment line. Voiding restores product stock but does NOT add the repaid amount back to the customer's total_debt. If you want to reverse the debt repayment too, edit the customer's debt manually after voiding."
                  : "Cette vente contient une ligne de remboursement de dette. L'annulation restaure le stock produit mais NE rétablit PAS le montant remboursé sur la dette du client. Si vous voulez aussi annuler le remboursement, modifiez la dette du client manuellement après l'annulation."}
              </div>
            )}
            {mode !== "void" && pastWindow && <WindowBanner days={saleAgeDays} value={overrideReason} setValue={setOverrideReason} lang={lang} />}
            <VoidPinAndReason pin={pin} setPin={setPin} reason={reason} setReason={setReason} pinError={pinError} lang={lang} reasonValid={voidReasonValid} noPin />
            <ActionButtons mode="void" loading={loading} disabled={!voidReasonValid} onBack={() => setMode(null)} onConfirm={handleSubmit} lang={lang} />
          </div>
        )}

        {/* REFUND mode */}
        {mode === "refund" && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {lang === "en" ? "Select items to return:" : "Sélectionner les articles à retourner:"}
            </div>
            {selectedItems.map((item, i) => (
              <div key={i} style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", marginBottom: 8, border: `1px solid ${item.selected ? "var(--brand)" : "var(--border)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={item.selected} onChange={() => toggleItem(i)} style={{ width: 16, height: 16 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.pa_products?.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Sold: {item.quantity} × {fmt(item.unit_price)}</div>
                  </div>
                  {item.selected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Return qty:" : "Qté retour:"}</span>
                      <input type="number" value={item.returnQty} onChange={e => setReturnQty(i, e.target.value)}
                        min={1} max={item.quantity}
                        style={{ width: 60, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 13 }} />
                      <select value={item.retReason} onChange={e => setItemReason(i, e.target.value)}
                        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 12 }}>
                        {RET_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Restock condition */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--bg-card)", borderRadius: 10, marginBottom: 14, border: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Return to stock?" : "Remettre en stock?"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Only if product is in good condition" : "Seulement si le produit est en bon état"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: restock ? "#34d399" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: restock ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>

            {/* Refund amount */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div className="form-group">
                <label className="label">{lang === "en" ? `Refund amount (${fmt.symbol})` : `Montant remboursé (${fmt.symbol})`}</label>
                <input className="input" type="number" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} placeholder={total} />
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>Max: {fmt(total)}</div>
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Refund method" : "Mode remboursement"}</label>
                <select className="input" value={refundMethod} onChange={e => setRefundMethod(e.target.value)}>
                  <option value="cash">{lang === "en" ? "Cash" : "Espèces"}</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="bank">{lang === "en" ? "Bank transfer" : "Virement"}</option>
                </select>
              </div>
            </div>

            {mode !== "void" && pastWindow && <WindowBanner days={saleAgeDays} value={overrideReason} setValue={setOverrideReason} lang={lang} />}
            <PinAndReason reason={reason} setReason={setReason} lang={lang} />
            <ActionButtons mode="refund" loading={loading} onBack={() => setMode(null)} onConfirm={handleSubmit} lang={lang} />
          </div>
        )}

        {/* EXCHANGE mode */}
        {mode === "exchange" && (
          <div>
            {/* Returned items */}
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              ↩️ {lang === "en" ? "Items being returned:" : "Articles retournés:"}
            </div>
            {selectedItems.map((item, i) => (
              <div key={i} style={{ background: "var(--bg-card)", borderRadius: 10, padding: "10px 12px", marginBottom: 8, border: `1px solid ${item.selected ? "rgba(239,68,68,0.4)" : "var(--border)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={item.selected} onChange={() => toggleItem(i)} style={{ width: 16, height: 16 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.pa_products?.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.quantity} × {fmt(item.unit_price)}</div>
                  </div>
                  {item.selected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Qty:" : "Qté:"}</span>
                      <input type="number" value={item.returnQty} onChange={e => setReturnQty(i, e.target.value)}
                        min={1} max={item.quantity}
                        style={{ width: 56, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 13 }} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* New items picker */}
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 16, marginBottom: 8 }}>
              🆕 {lang === "en" ? "New items given:" : "Nouveaux articles donnés:"}
            </div>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <input className="input" value={exchSearch} onChange={e => setExchSearch(e.target.value)}
                placeholder={lang === "en" ? "Search product to add…" : "Chercher produit à ajouter…"}
                style={{ fontSize: 13 }} />
              {filteredProducts.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 50, maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
                  {filteredProducts.slice(0, 8).map(p => (
                    <div key={p.id} onClick={() => addNewItem(p)}
                      style={{ padding: "8px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", fontSize: 13 }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-card)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{p.name}</span>
                      <span style={{ color: "var(--brand-light)", fontWeight: 600 }}>{fmt(p.sell_price || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {newItems.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 12px", background: "var(--bg-card)", borderRadius: 8, marginBottom: 8 }}>
                {lang === "en" ? "No new items added yet" : "Aucun nouvel article ajouté"}
              </div>
            )}
            {newItems.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-card)", borderRadius: 10, padding: "8px 12px", marginBottom: 6, border: "1px solid rgba(251,197,3,0.3)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en" ? "Negotiated price (editable)" : "Prix négocié (modifiable)"} · = {fmt((+item.sell_price || 0) * item.quantity)}
                  </div>
                  {item.min_price > 0 && (+item.sell_price || 0) < item.min_price && (
                    <div style={{ fontSize: 10, color: "#fbbf24", marginTop: 2 }}>
                      ⚠ {lang === "en"
                        ? `Below min ${fmt(item.min_price)} — owner PIN required`
                        : `Sous le min ${fmt(item.min_price)} — PIN patron requis`}
                    </div>
                  )}
                </div>
                <input type="number" value={item.sell_price} onChange={e => updateNewItemPrice(i, e.target.value)} min={0}
                  title={lang === "en" ? "Unit price" : "Prix unitaire"}
                  style={{ width: 80, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 13 }} />
                <input type="number" value={item.quantity} onChange={e => updateNewItemQty(i, e.target.value)} min={1}
                  title={lang === "en" ? "Qty" : "Qté"}
                  style={{ width: 50, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)", fontSize: 13 }} />
                <button onClick={() => removeNewItem(i)}
                  style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
              </div>
            ))}

            {/* Price difference summary */}
            <div style={{ background: "var(--bg-card)", borderRadius: 10, padding: "12px 14px", marginTop: 12, marginBottom: 14, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                <span>{lang === "en" ? "Returned value:" : "Valeur retournée:"}</span>
                <span style={{ color: "#34d399" }}>{fmt(returnedTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                <span>{lang === "en" ? "New items value:" : "Valeur nouveaux articles:"}</span>
                <span style={{ color: "var(--brand-light)" }}>{fmt(newTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <span>{cashDiff === 0 ? (lang === "en" ? "Even exchange" : "Échange égal") : cashDiff > 0 ? (lang === "en" ? "Customer pays:" : "Client paie:") : (lang === "en" ? "Refund to customer:" : "Remboursement client:")}</span>
                <span style={{ color: cashDiff === 0 ? "var(--text-muted)" : cashDiff > 0 ? "#fbbf24" : "#34d399" }}>
                  {cashDiff === 0 ? "—" : fmt(Math.abs(cashDiff))}
                </span>
              </div>
            </div>

            {mode !== "void" && pastWindow && <WindowBanner days={saleAgeDays} value={overrideReason} setValue={setOverrideReason} lang={lang} />}
            <PinAndReason reason={reason} setReason={setReason} lang={lang} />
            <ActionButtons mode="exchange" loading={loading} onBack={() => setMode(null)} onConfirm={handleSubmit} lang={lang} />
          </div>
        )}
      </div>
    </div>
  );
}

function WindowBanner({ days, value, setValue, lang }) {
  return (
    <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 6 }}>
        ⚠ {lang === "en"
          ? `This sale is ${days} days old. Returns past 30 days require a reason.`
          : `Vente vieille de ${days} jours. Un retour > 30 jours nécessite une raison.`}
      </div>
      <input className="input" value={value} onChange={e => setValue(e.target.value)}
        placeholder={lang === "en" ? "Required: reason for override" : "Obligatoire : raison de la dérogation"} />
    </div>
  );
}

// MP-VOID-REASON-REQUIRED-FIELD: void-specific variant of PinAndReason.
// Surfaces a preset-reason dropdown that pre-fills the text field so
// the common cases ring through with one tap; "Other" keeps the field
// editable for free-form context. Validation message renders when the
// reason isn't yet valid so the cashier knows why Confirm is disabled.
// MP-OWNER-PIN-APPROVAL (Wave 2): void's PIN entry moved to the
// OwnerApprovalModal that pops on submit. When `noPin` is true (the
// new void flow), we render reason-only and span the full width.
function VoidPinAndReason({ pin, setPin, reason, setReason, pinError, lang, reasonValid, noPin }) {
  const PRESETS = [
    { value: "Customer changed mind",   fr: "Le client a changé d'avis" },
    { value: "Wrong item rung",         fr: "Mauvais article scanné" },
    { value: "Wrong customer selected", fr: "Mauvais client sélectionné" },
    { value: "Cashier error",           fr: "Erreur de caissier" },
    { value: "__other__",               fr: "Autre — saisir manuellement", en: "Other — type manually" },
  ];
  const onPresetChange = (v) => {
    if (!v) return;
    if (v === "__other__") {
      // Clear so the cashier types something — "Other" is meaningless
      // by itself; the actual reason goes into the text field.
      setReason("");
      return;
    }
    setReason(v);
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: noPin ? "1fr" : "1fr 2fr", gap: 10 }}>
        {!noPin && (
          <div className="form-group">
            <label className="label">🔐 {lang === "en" ? "Manager/Owner PIN *" : "PIN Manager/Patron *"}</label>
            <input className="input" type="password" inputMode="numeric" maxLength={4}
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
            {pinError && <div style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>{pinError}</div>}
          </div>
        )}
        <div className="form-group">
          <label className="label">
            {lang === "en" ? "Reason *" : "Raison *"}
          </label>
          <select className="input" defaultValue=""
            onChange={e => onPresetChange(e.target.value)}
            style={{ marginBottom: 6 }}>
            <option value="" disabled>
              {lang === "en" ? "Pick a common reason…" : "Choisir une raison fréquente…"}
            </option>
            {PRESETS.map(p => (
              <option key={p.value} value={p.value}>
                {p.value === "__other__"
                  ? (lang === "en" ? p.en : p.fr)
                  : (lang === "en" ? p.value : p.fr)}
              </option>
            ))}
          </select>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={lang === "en"
              ? "Type the reason (min 3 chars)"
              : "Tapez la raison (min 3 caractères)"} />
          {!reasonValid && (
            <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 4 }}>
              {lang === "en"
                ? "Reason required (helps the owner understand voids)."
                : "Raison obligatoire (aide le patron à comprendre les annulations)."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// MP-OWNER-PIN-APPROVAL (Wave 3): inline PIN input removed — the
// OwnerApprovalModal collects the owner/manager PIN on submit. The
// reason field stays since it carries forward to the audit log row.
function PinAndReason({ reason, setReason, lang }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="form-group">
        <label className="label">{lang === "en" ? "Reason" : "Raison"}</label>
        <input className="input" value={reason} onChange={e => setReason(e.target.value)}
          placeholder={lang === "en" ? "e.g. Wrong product scanned" : "Ex: Mauvais produit scanné"} />
      </div>
    </div>
  );
}

function ActionButtons({ mode, loading, disabled, onBack, onConfirm, lang }) {
  const labels = {
    void: { en: "✓ Confirm Void", fr: "✓ Confirmer l'annulation" },
    refund: { en: "✓ Confirm Refund", fr: "✓ Confirmer le remboursement" },
    exchange: { en: "✓ Confirm Exchange", fr: "✓ Confirmer l'échange" },
  };
  // MP-VOID-REASON-REQUIRED-FIELD: disabled (vs loading) styles the
  // button as inert + cursor not-allowed so the cashier sees WHY the
  // submit isn't firing without needing to click and read the toast.
  const isDisabled = loading || !!disabled;
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
      <button onClick={onBack}
        style={{ flex: 1, padding: "10px", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>
        ← {lang === "en" ? "Back" : "Retour"}
      </button>
      <button onClick={onConfirm} disabled={isDisabled}
        style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: mode === "void" ? "#ef4444" : mode === "refund" ? "#fbbf24" : "var(--brand)", color: "#152B52", cursor: isDisabled ? "not-allowed" : "pointer", opacity: isDisabled ? 0.55 : 1, fontWeight: 700, fontSize: 14 }}>
        {loading ? "..." : (lang === "en" ? labels[mode].en : labels[mode].fr)}
      </button>
    </div>
  );
}
