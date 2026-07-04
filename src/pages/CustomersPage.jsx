import { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOfflineCachedQuery } from "../utils/offlineQuery";
import toast from "react-hot-toast";
import { isPendingApproval, keepWorkingToast } from "../utils/approval";
import { useLangStore, useSettingsStore, useAuthStore } from "../store";
import api, { formatDate } from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import { momoLabel } from "../utils/paymentLabels";
import { useActiveShift, noShiftHint } from "../components/common/ShiftWidgets";
import PaymentEventReceipt from "../components/common/PaymentEventReceipt";
import useOwnerApproval from "../hooks/useOwnerApproval";
import RestrictedAction from "../components/common/RestrictedAction";

const PAYMENT_METHODS = [
  { key: "cash",         icon: "💵", en: "Cash",        fr: "Espèces" },
  { key: "mobile_money", icon: "📱", en: "Mobile Money", fr: "Mobile Money" },
  { key: "bank",         icon: "🏦", en: "Bank",        fr: "Banque" },
];

const TYPES = [
  { value: "retail",    en: "Retail",     fr: "Detail" },
  { value: "wholesale", en: "Wholesale",  fr: "Grossiste" },
  { value: "vip",       en: "VIP",        fr: "VIP" },
  { value: "garage",    en: "Garage",     fr: "Garage" },
];

export default function CustomersPage() {
  const { lang } = useLangStore();
  const { selectedLocation } = useSettingsStore();
  const { org, user } = useAuthStore();
  const role = user?.role || "";
  const qc = useQueryClient();
  // MP-OWNER-PIN-APPROVAL: PIN-entry modal for sensitive operations.
  // The hook returns a promise-based requestApproval() helper and the
  // modal element to mount somewhere in the render tree.
  const { requestApproval, modal: approvalModal } = useOwnerApproval();

  // MP-PAYMENT-EVENT-RECEIPTS Phase 3: post-success receipt modal
  // for Encaisser dette. Capture the response shape from the
  // collect-debt mutation; the shared PaymentEventReceipt
  // component renders + lets the cashier print or share via
  // WhatsApp before they dismiss.
  const [receiptEvent, setReceiptEvent] = useState(null);

  // Org settings power the receipt header (shop name, address,
  // receipt_footer). Cached under the existing ["org-settings"]
  // key so this is typically a cache hit.
  const { data: orgSettingsResp } = useOfflineCachedQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });
  const orgSettings = orgSettingsResp?.data || org || {};
  // MP-REQUIRE-OPEN-SHIFT Phase 3: Encaisser dette is a cash event
  // and gets gated. The customer CRUD form below is intentionally
  // NOT gated (admin operation per Decision 1's lenient list).
  const { hasShift: shiftIsOpen } = useActiveShift();
  const fmt = useCurrency();

  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [debtOnly, setDebtOnly]     = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [selected, setSelected]     = useState(null);
  const [confirmDel, setConfirmDel] = useState(null); // MP-CUSTOMER-DELETE: customer pending delete
  const [delError, setDelError]     = useState(null); // 409 message shown in the modal
  const [form, setForm]             = useState({ name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "", total_debt: "" });
  // MP-CUSTOMER-DEDUP: when a phone already belongs to a customer, hold that
  // existing customer here so the Add modal can offer to open it instead of
  // creating a split duplicate.
  const [dupeMatch, setDupeMatch]   = useState(null);
  // MP-COLLECT-DEBT-NO-INVOICE: separate concern from the edit form.
  // Edit form = admin correction of the balance number; this = cashier
  // recording real money received (creates pa_sales + pa_payments +
  // audit). Modal stays open across submits — closed only on success or
  // cancel.
  const [showCollectDebt, setShowCollectDebt] = useState(false);
  const [collectForm, setCollectForm]         = useState({ amount: "", payment_method: "cash", notes: "" });
  const [collectError, setCollectError]       = useState(null);

  const { data, isLoading } = useOfflineCachedQuery({
    queryKey: ["customers", search, typeFilter, debtOnly],
    queryFn: () => api.get(`/customers?search=${search}&type=${typeFilter}&has_debt=${debtOnly}&limit=50`).then(r => r.data),
    refetchInterval: 30000
  });

  // MP-CUSTOMER-DEBT-SUMMARY: org-wide aggregate (not filtered/paginated
  // like the list above). Invalidated by the add/update/delete mutations.
  const { data: summaryResp } = useOfflineCachedQuery({
    queryKey: ["customer-summary"],
    queryFn: () => api.get("/customers/summary").then(r => r.data),
    refetchInterval: 30000
  });
  const summary = summaryResp?.data || { total_debt: 0, customers_with_debt: 0, total_customers: 0 };

  const { data: detail } = useOfflineCachedQuery({
    queryKey: ["customer-detail", selected?.id],
    queryFn: () => api.get(`/customers/${selected.id}`).then(r => r.data),
    enabled: !!selected?.id
  });

  // MP-CUSTOMER-EDIT-PREFILL: seed the shared form from the FULL record
  // when an edit modal opens. Root cause: `form` was initialised with an
  // empty string for every field, and the inputs read
  // `form.x !== undefined ? form.x : selected.x` — a defined "" always
  // won, so every field but name (which used `||`, empty-falsy) showed
  // blank. Seeding the form also fixes the PATCH payload (it no longer
  // overwrites real values with empty strings).
  useEffect(() => {
    const c = detail?.data;
    if (selected?.id && c) {
      setForm({
        name: c.name || "",
        phone: c.phone || "",
        address: c.address || "",
        customer_type: c.customer_type || "retail",
        credit_limit: c.credit_limit ?? "",
        notes: c.notes || "",
        total_debt: c.total_debt ?? 0   // MP-CUSTOMER-EDIT-DEBT: editable
      });
    }
  }, [detail?.data, selected?.id]);

  // Opening "Add customer" must start from a clean form (don't inherit a
  // previously-edited customer's values).
  useEffect(() => {
    if (showAdd) { setForm({ name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "", total_debt: "" }); setDupeMatch(null); }
  }, [showAdd]);

  // MP-CUSTOMER-DEDUP: digits-only phone normalizer (matches the backend).
  const normPhone = (p) => String(p || "").replace(/\D/g, "");
  // Open the existing customer the dupe check found (close Add, select it).
  const openExistingCustomer = (m) => { setDupeMatch(null); setShowAdd(false); setSelected({ id: m.id, name: m.name, phone: m.phone }); };
  // Submit handler with a client-side pre-check against the loaded list (instant
  // feedback); the backend 409 below is the authoritative guard (normalized,
  // covers list-miss / double-submit / race).
  const handleAddCustomer = () => {
    setDupeMatch(null);
    const inc = normPhone(form.phone);
    if (inc) {
      const local = (data?.data || []).find(c => normPhone(c.phone) === inc);
      if (local) { setDupeMatch({ id: local.id, name: local.name, phone: local.phone }); return; }
    }
    addMutation.mutate();
  };

  const addMutation = useMutation({
    mutationFn: () => api.post("/customers", { ...form, credit_limit: +form.credit_limit || 0, total_debt: +form.total_debt || 0 }),
    onSuccess: () => {
      toast.success(lang === "en" ? "Customer added!" : "Client ajoute!");
      setShowAdd(false);
      setForm({ name: "", phone: "", address: "", customer_type: "retail", credit_limit: "", notes: "", total_debt: "" });
      qc.invalidateQueries(["customers"]);
      qc.invalidateQueries(["customer-summary"]);
      // MP-POS-CUSTOMER-FINDABLE: the POS sale-flow quick-pick reads a SEPARATE
      // cache key (["pos-customers"], 60s staleTime). The edit/collect paths
      // already refresh it; the ADD path did not, so a just-added customer was
      // absent from the sale search until the cache lapsed. Mirror the edit path.
      qc.invalidateQueries(["pos-customers"]);
    },
    onError: (err) => {
      // MP-CUSTOMER-DEDUP: backend rejected a same-phone duplicate — surface
      // the existing customer in the modal with an "open" offer.
      if (err.response?.status === 409 && err.response?.data?.code === "CUSTOMER_PHONE_EXISTS") {
        setDupeMatch(err.response.data.existing || null);
        return;
      }
      toast.error(err.response?.data?.message || "Error");
    }
  });

  // MP-OWNER-PIN-APPROVAL: customer edit gated per role.
  //   Owner:    direct PATCH
  //   Manager:  direct unless credit_limit OR total_debt is changing →
  //             one approval token covers the sensitive change
  //   Cashier:  always needs approval — broad 'edit_customer' unless
  //             a sensitive field changed, in which case the more
  //             specific action_type wins (matches backend's audit
  //             label resolution)
  const updateMutation = useMutation({
    mutationFn: async () => {
      const body = { ...form, total_debt: +form.total_debt || 0 };
      const headers = {};
      const newCredit = Number(body.credit_limit || 0);
      const oldCredit = Number(selected?.credit_limit || 0);
      const newDebt   = Number(body.total_debt   || 0);
      const oldDebt   = Number(selected?.total_debt   || 0);
      const creditChanged = newCredit !== oldCredit;
      const debtChanged   = newDebt   !== oldDebt;
      const safeChanged   = ["name","phone","address","customer_type","notes"]
        .some(k => (body[k] ?? "") !== (selected?.[k] ?? ""));

      // Owners don't need approval for any field.
      // Managers need approval only when credit_limit/total_debt changes.
      // Cashiers need approval for any change.
      let needsApproval = false;
      let actionType = null;
      let descSuffix = "";
      if (role === "manager") {
        if (creditChanged) {
          needsApproval = true; actionType = "edit_customer_credit";
          descSuffix = lang === "fr"
            ? ` (limite de crédit : ${oldCredit.toLocaleString()} → ${newCredit.toLocaleString()} ${fmt.symbol})`
            : ` (credit limit: ${oldCredit.toLocaleString()} → ${newCredit.toLocaleString()} ${fmt.symbol})`;
        } else if (debtChanged) {
          needsApproval = true; actionType = "edit_customer_debt";
          descSuffix = lang === "fr"
            ? ` (solde : ${oldDebt.toLocaleString()} → ${newDebt.toLocaleString()} ${fmt.symbol})`
            : ` (debt: ${oldDebt.toLocaleString()} → ${newDebt.toLocaleString()} ${fmt.symbol})`;
        }
      } else if (role === "cashier") {
        if (!creditChanged && !debtChanged && !safeChanged) {
          return { data: { success: true, data: selected } }; // no-op
        }
        needsApproval = true;
        actionType = creditChanged ? "edit_customer_credit"
                   : debtChanged   ? "edit_customer_debt"
                   :                 "edit_customer";
        if (creditChanged) descSuffix = lang === "fr"
          ? ` (limite : ${oldCredit.toLocaleString()} → ${newCredit.toLocaleString()})`
          : ` (credit: ${oldCredit.toLocaleString()} → ${newCredit.toLocaleString()})`;
        else if (debtChanged) descSuffix = lang === "fr"
          ? ` (solde : ${oldDebt.toLocaleString()} → ${newDebt.toLocaleString()})`
          : ` (debt: ${oldDebt.toLocaleString()} → ${newDebt.toLocaleString()})`;
      }

      if (needsApproval) {
        const { token } = await requestApproval({
          actionType,
          targetTable: "pa_customers",
          targetId:    selected.id,
          context: {
            credit_limit_old: oldCredit, credit_limit_new: newCredit,
            total_debt_old:   oldDebt,   total_debt_new:   newDebt,
          },
          description: (lang === "fr"
            ? `Modifier le client « ${selected.name} »`
            : `Edit customer "${selected.name}"`) + descSuffix,
        });
        headers["Approval-Token"] = token;
      }
      return api.patch(`/customers/${selected.id}`, body, { headers });
    },
    onSuccess: (res) => {
      // Phase 5b: debt/credit change HELD for owner approval → nothing changed.
      if (isPendingApproval(res)) {
        toast(keepWorkingToast(lang === "en"), { icon: "⏳", duration: 4000 });
        return;
      }
      toast.success(lang === "en" ? "Customer updated!" : "Client mis a jour!");
      qc.invalidateQueries(["customers"]);
      qc.invalidateQueries(["customer-summary"]);
      qc.invalidateQueries(["customer-detail", selected.id]);
      // MP-DEBT-LINE-INSERT-FIX (Bug B): POS reads the debt banner from
      // ["customer-debt", customer.id] and the customer list from
      // ["pos-customers"]. Without these invalidations, editing
      // total_debt here leaves POS showing the stale amount until a
      // hard reload.
      qc.invalidateQueries(["customer-debt", selected.id]);
      qc.invalidateQueries(["pos-customers"]);
    },
    onError: (err) => {
      // MP-OWNER-PIN-APPROVAL: user closed the PIN modal — silent.
      if (err?.code === "cancelled") return;
      toast.error(err.response?.data?.message || "Error");
    }
  });

  // MP-COLLECT-DEBT-NO-INVOICE: POST /customers/:id/collect-debt.
  // RPC-backed (collect_debt_no_invoice) so all 4 table writes are
  // atomic. On 400/404 we surface the message inline in the modal
  // (no toast, so the cashier can correct and retry). On success we
  // close, toast the new balance, and invalidate the same key set as
  // customer-edit + the daily-summary key so the dashboard refreshes.
  //
  // MP-PHASE-4 WAVE 1 — offline optimistic UI: when api.post returns
  // the offlineAwareAdapter's 202, the server-computed debt_after
  // isn't known. Compute it client-side from the current customer
  // balance and seed every debt-bearing cache slot so the UI reflects
  // the new balance immediately (was Peter's "doesn't change until
  // sync" complaint, which risked re-submit + duplicate writes).
  // Mirror of the Phase 3 shift-open pattern in ShiftWidgets.jsx.
  const collectMutation = useMutation({
    mutationFn: () => api.post(`/customers/${selected.id}/collect-debt`, {
      amount:         +collectForm.amount || 0,
      payment_method: collectForm.payment_method,
      location_id:    selectedLocation?.id,
      notes:          collectForm.notes || null,
    }),
    onSuccess: (res) => {
      const offlineQueued = !!res?.data?.offline_queued;
      const d = res?.data?.data || {};
      // For online, trust server's debt_before/debt_after. For offline,
      // synthesize from the modal's known state — server's RPC will
      // recompute authoritatively on sync.
      const amt = +collectForm.amount || 0;
      const debtBefore = Number(selected?.total_debt || 0);
      const debtAfter  = Math.max(0, debtBefore - amt);
      const customerId = selected?.id;
      const method     = collectForm.payment_method;

      const displayAmount = offlineQueued ? amt : (d.amount ?? amt);
      const displayAfter  = offlineQueued ? debtAfter : (d.debt_after ?? debtAfter);
      toast.success(lang === "en"
        ? `${offlineQueued ? "Queued · " : ""}Collected ${fmt(displayAmount)} — debt now ${fmt(displayAfter)}`
        : `${offlineQueued ? "En attente · " : ""}Encaissé ${fmt(displayAmount)} — dette: ${fmt(displayAfter)}`);
      setShowCollectDebt(false);
      setCollectForm({ amount: "", payment_method: "cash", notes: "" });
      setCollectError(null);

      if (offlineQueued && customerId) {
        // Update every cache slot that exposes the collected customer's
        // total_debt. Each slot has its own envelope shape ({data:[…]},
        // {data:{…}}, raw arrays/objects) — handle each defensively.
        const updateRow = (c) => c?.id === customerId
          ? { ...c, total_debt: debtAfter }
          : c;

        // ["customers", search, typeFilter, debtOnly] — list slot.
        qc.setQueriesData(
          { predicate: (q) => q.queryKey?.[0] === "customers" },
          (old) => {
            if (!old) return old;
            const arr = Array.isArray(old) ? old : (old.data || []);
            const next = arr.map(updateRow);
            return Array.isArray(old) ? next : { ...old, data: next };
          }
        );
        // ["pos-customers"] — POS quick-pick list. Same row shape.
        qc.setQueriesData(
          { predicate: (q) => q.queryKey?.[0] === "pos-customers" },
          (old) => {
            if (!old) return old;
            const arr = Array.isArray(old) ? old : (old.data || []);
            const next = arr.map(updateRow);
            return Array.isArray(old) ? next : { ...old, data: next };
          }
        );
        // ["customer-detail", id] — single-record slot.
        qc.setQueryData(["customer-detail", customerId], (old) => {
          if (!old) return old;
          const rec = old.data || old;
          if (!rec || rec.id !== customerId) return old;
          const next = { ...rec, total_debt: debtAfter };
          return old.data ? { ...old, data: next } : next;
        });
        // ["customer-summary"] — org-wide aggregate. Best-effort
        // decrement; total_customers stays put, customers_with_debt
        // decrements only when this customer's new balance is zero.
        qc.setQueriesData(
          { predicate: (q) => q.queryKey?.[0] === "customer-summary" },
          (old) => {
            if (!old) return old;
            const s = old.data || old;
            if (!s) return old;
            const newTotal = Math.max(0, Number(s.total_debt || 0) - amt);
            const becameZero = debtBefore > 0 && debtAfter === 0;
            const next = {
              ...s,
              total_debt: newTotal,
              customers_with_debt: becameZero
                ? Math.max(0, Number(s.customers_with_debt || 0) - 1)
                : s.customers_with_debt,
            };
            return old.data ? { ...old, data: next } : next;
          }
        );
        // ["current-shift", locId] — drawer math. Cash payment of
        // collected debt lands in cash_sales_received (matches how
        // POSPage's invoice-settle path attributes to the drawer).
        // Mobile-money / bank don't touch the drawer.
        if (method === "cash" && selectedLocation?.id) {
          qc.setQueryData(["current-shift", selectedLocation.id], (old) => {
            if (!old) return old;
            const cur = Number(old.cash_sales_received || 0);
            const expected = Number(old.expected_drawer || 0);
            return { ...old, cash_sales_received: cur + amt, expected_drawer: expected + amt };
          });
        }
        // Non-seeded keys whose refetch is harmless (no clobber risk):
        // credits/customer-debt/daily-summary all serve stale cached
        // data offline and re-arrive at the truth on next online refetch.
        qc.invalidateQueries(["credits"]);
        qc.invalidateQueries(["customer-debt", customerId]);
        qc.invalidateQueries(["dashboard"]);
        qc.invalidateQueries(["daily-summary"]);
      } else {
        // Online path unchanged — invalidate everything so the next
        // refetch picks up the server's RPC-computed truth.
        qc.invalidateQueries(["customers"]);
        qc.invalidateQueries(["customer-summary"]);
        qc.invalidateQueries(["customer-detail", customerId]);
        qc.invalidateQueries(["customer-debt", customerId]);
        qc.invalidateQueries(["pos-customers"]);
        qc.invalidateQueries(["dashboard"]);
        qc.invalidateQueries(["daily-summary"]);
      }

      // MP-PAYMENT-EVENT-RECEIPTS Phase 3: surface the receipt for
      // the customer. Backend already enriched the response with
      // applied_to_invoices, ghost_portion, customer/cashier/
      // location fields — no follow-up fetch. Offline path has no
      // server enrichment; synthesize the minimum shape the receipt
      // component needs so the cashier still gets a printable record.
      const receiptData = offlineQueued
        ? {
            sale_number:    d.sale_number || null,
            amount:         amt,
            payment_method: method,
            applied_to_invoices: [],
            ghost_portion:  amt,
            debt_before:    debtBefore,
            debt_after:     debtAfter,
            customer_id:    customerId,
            customer_name:  selected?.name || null,
            customer_phone: selected?.phone || null,
            cashier_name:   user?.full_name || null,
            location_id:    selectedLocation?.id || null,
            location_name:  selectedLocation?.name || null,
            shift_id:       null,
            offline_queued: true,
          }
        : d;
      setReceiptEvent({ eventType: "debt_collection", data: receiptData });
    },
    onError: (err) => {
      setCollectError(err.response?.data?.message || "Error");
    }
  });

  // MP-CUSTOMER-DELETE + MP-OWNER-PIN-APPROVAL: hard delete (backend
  // 409s if customer has sales/payments/etc). 409 keeps the modal open
  // and shows why; success removes them from the list. Non-owners
  // (manager, cashier) must surface an owner PIN first.
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const headers = {};
      if (role !== "owner") {
        const debtClause = Number(confirmDel?.total_debt || 0) > 0
          ? (lang === "fr"
              ? ` (solde dû : ${Number(confirmDel.total_debt).toLocaleString()} ${fmt.symbol})`
              : ` (outstanding debt: ${Number(confirmDel.total_debt).toLocaleString()} ${fmt.symbol})`)
          : "";
        const { token } = await requestApproval({
          actionType:   "delete_customer",
          targetTable:  "pa_customers",
          targetId:     confirmDel.id,
          context:      { customer_name: confirmDel.name, total_debt: Number(confirmDel?.total_debt || 0) },
          description:  (lang === "fr"
            ? `Supprimer le client « ${confirmDel.name} »`
            : `Delete customer "${confirmDel.name}"`) + debtClause,
        });
        headers["Approval-Token"] = token;
      }
      return api.delete(`/customers/${confirmDel.id}`, { headers });
    },
    onSuccess: (res) => {
      // Phase 5b: delete HELD for owner approval → nothing deleted.
      if (isPendingApproval(res)) {
        toast(keepWorkingToast(lang === "en"), { icon: "⏳", duration: 4000 });
        setConfirmDel(null); setDelError(null);
        return;
      }
      toast.success(lang === "en" ? "Customer deleted" : "Client supprimé");
      if (selected?.id === confirmDel.id) setSelected(null);
      setConfirmDel(null); setDelError(null);
      qc.invalidateQueries(["customers"]);
      qc.invalidateQueries(["customer-summary"]);
    },
    onError: (err) => {
      // MP-OWNER-PIN-APPROVAL: silent on PIN-modal cancel.
      if (err?.code === "cancelled") return;
      const r = err.response;
      if (r?.status === 409) {
        setDelError((r.data?.message || "Customer has transaction history. Cannot delete.")
          + (lang === "en"
              ? " You can hide them by editing their notes for now. A full archive feature is coming."
              : " Vous pouvez les masquer via leurs notes pour l'instant. L'archivage complet arrive bientôt."));
      } else {
        toast.error(r?.data?.message || "Error");
        setConfirmDel(null);
      }
    }
  });

  const customers = data?.data || [];

  // ── MULTI-BRANCH CUSTOMERS VIEW ──────────────────────────────────────────
  // Gated: ONLY when the org has >1 active location. CORE for pro/pro_plus,
  // ADVANCED for pro_plus. free/lite/trial/single-location → screen unchanged.
  // All data is read-only (the two STABLE branch RPCs), fetched once and joined
  // to the existing customer list client-side.
  const { data: planResp } = useOfflineCachedQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data),
  });
  const effectivePlan = planResp?.data?.effective_plan || "silver";

  const { data: locResp } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
  });
  const activeLocations = (locResp?.data || []).filter(l => l.is_active !== false);
  const multiBranch    = activeLocations.length > 1;
  const branchCore     = multiBranch && (effectivePlan === "pro" || effectivePlan === "pro_plus");
  const branchAdvanced = multiBranch && effectivePlan === "pro_plus";

  const { data: branchDebtResp } = useOfflineCachedQuery({
    queryKey: ["customers-branch-debt"],
    queryFn: () => api.get("/customers/branch-debt").then(r => r.data),
    enabled: branchCore,
  });
  const { data: branchRecvResp } = useOfflineCachedQuery({
    queryKey: ["customers-branch-receivables"],
    queryFn: () => api.get("/customers/branch-receivables").then(r => r.data),
    enabled: branchCore,
  });
  const branchDebtRows = branchDebtResp?.data || [];
  const branchRecvRows = (branchRecvResp?.data || []).filter(r => r.location_id);

  const [branchFilter, setBranchFilter]     = useState("");   // C2 — "" = all branches
  const [showTopDebtors, setShowTopDebtors] = useState(false);

  // Roll the per-(customer,branch) rows up by customer.
  const branchByCustomer = useMemo(() => {
    const m = {};
    for (const r of branchDebtRows) {
      const id = r.customer_id;
      if (!m[id]) m[id] = { branches: [], totalOwed: 0, totalBalance: 0, anyOverdue: false, oldestDue: null, homeBranchId: null };
      const e = m[id];
      e.branches.push(r);
      e.totalOwed    += Number(r.owed || 0);
      e.totalBalance += Number(r.balance || 0);
      if (Number(r.overdue || 0) > 0) e.anyOverdue = true;
      if (r.oldest_due_date && (!e.oldestDue || r.oldest_due_date < e.oldestDue)) e.oldestDue = r.oldest_due_date;
    }
    for (const id in m) {
      const e = m[id];
      // A6 home branch: most sales; tie → most recent activity.
      let home = null;
      for (const b of e.branches) {
        if (!home || Number(b.sale_count) > Number(home.sale_count) ||
            (Number(b.sale_count) === Number(home.sale_count) && String(b.last_activity || "") > String(home.last_activity || ""))) home = b;
      }
      e.homeBranchId = home ? home.location_id : null;
      e.branchesOwing = e.branches.filter(b => Number(b.owed || 0) > 0).sort((a, b) => Number(b.owed) - Number(a.owed));
    }
    return m;
  }, [branchDebtRows]);

  const nameById = useMemo(() => { const m = {}; for (const c of customers) m[c.id] = c.name; return m; }, [customers]);
  const branchOf = (cid, locId) => (branchByCustomer[cid]?.branches || []).find(b => b.location_id === locId);

  // C2 — when a branch is picked, restrict the (loaded) list to customers active there.
  const displayedCustomers = (branchCore && branchFilter)
    ? customers.filter(c => !!branchOf(c.id, branchFilter))
    : customers;

  // A5 — top debtors per branch (owing rows grouped by branch, top 5 by owed).
  const topDebtorsByBranch = useMemo(() => {
    if (!branchAdvanced) return [];
    const byLoc = {};
    for (const r of branchDebtRows) {
      if (Number(r.owed || 0) <= 0) continue;
      if (!byLoc[r.location_id]) byLoc[r.location_id] = { location_id: r.location_id, location_name: r.location_name, rows: [] };
      byLoc[r.location_id].rows.push(r);
    }
    return Object.values(byLoc)
      .map(g => ({ ...g, rows: g.rows.sort((a, b) => Number(b.owed) - Number(a.owed)).slice(0, 5),
                   total: g.rows.reduce((s, r) => s + Number(r.owed), 0) }))
      .sort((a, b) => b.total - a.total);
  }, [branchDebtRows, branchAdvanced]);

  // A10 — branch-aware WhatsApp reminder: names each branch + amount owed there.
  const sendBranchReminder = (c) => {
    if (!c?.phone) { toast.error(lang === "en" ? "No phone number for this customer" : "Pas de numéro pour ce client"); return; }
    let phone = String(c.phone).replace(/\s+/g, "").replace(/^0/, "");
    if (!phone.startsWith("237")) phone = "237" + phone;
    const today = new Date().toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const orgName = org?.name || (lang === "en" ? "our shop" : "notre boutique");
    const owing = branchByCustomer[c.id]?.branchesOwing || [];
    let msg = lang === "en" ? `Hello ${c.name},\n\nReminder from ${orgName} (as of ${today}).\n\n`
                            : `Bonjour ${c.name},\n\nRappel de ${orgName} (au ${today}).\n\n`;
    if (owing.length) {
      owing.forEach(b => { msg += (lang === "en" ? "Balance due: " : "Solde dû: ") + `*${Number(b.owed).toLocaleString()} ${fmt.symbol}* — ${b.location_name}\n`; });
      if (owing.length > 1) msg += (lang === "en" ? "Total: " : "Total: ") + `*${owing.reduce((s, b) => s + Number(b.owed), 0).toLocaleString()} ${fmt.symbol}*\n`;
    } else {
      msg += lang === "en" ? "No outstanding balance.\n" : "Aucun solde impayé.\n";
    }
    msg += lang === "en" ? `\nPlease contact us to arrange payment.\nThank you!\n\n— ${orgName}`
                         : `\nMerci de nous contacter pour régler ce montant.\nMerci de votre confiance!\n\n— ${orgName}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    toast.success(lang === "en" ? "WhatsApp opened!" : "WhatsApp ouvert!");
  };

  const typeColor = (type) => {
    if (type === "vip")       return { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" };
    if (type === "wholesale") return { bg: "rgba(251,197,3,0.15)",   color: "var(--brand-light)" };
    if (type === "garage")    return { bg: "rgba(16,185,129,0.15)",  color: "#34d399" };
    return { bg: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" };
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* MP-OWNER-PIN-APPROVAL: mounts the PIN-entry modal at the
          page root so it overlays everything else (z:2500). The hook
          self-manages open state — we just need to render the element. */}
      {approvalModal}
      {/* Left: customer list */}
      <div style={{ flex: 1, padding: 24, overflowY: "auto", borderRight: selected ? "1px solid var(--border)" : "none" }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">{lang === "en" ? "Customers" : "Clients"}</h1>
            <div className="page-sub">{customers.length} {lang === "en" ? "customers" : "clients"}</div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + {lang === "en" ? "New Customer" : "Nouveau client"}
          </button>
        </div>

        {/* MP-CUSTOMER-DEBT-SUMMARY: org-wide aggregate (all customers,
            not just the current filtered/paginated page). */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
              💰 {lang === "en" ? "Total owed to you" : "Total dû"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: summary.total_debt > 0 ? "#f87171" : "var(--text-primary)" }}>
              {fmt(summary.total_debt)}
            </div>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
              {lang === "en" ? "Customers with debt" : "Clients avec dette"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{summary.customers_with_debt}</div>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
              {lang === "en" ? "Total customers" : "Total clients"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{summary.total_customers}</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input className="input" placeholder={lang === "en" ? "Search by name or phone..." : "Chercher par nom ou telephone..."}
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }} />
          <select className="input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 140 }}>
            <option value="">{lang === "en" ? "All types" : "Tous types"}</option>
            {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
          </select>
          <button className={`btn ${debtOnly ? "btn-danger" : "btn-secondary"}`} onClick={() => setDebtOnly(d => !d)}>
            {lang === "en" ? "With debt only" : "Avec credit"}
          </button>
        </div>

        {/* ── MULTI-BRANCH: per-branch receivables (C3) + aging (A4) + branch
            filter (C2) + top debtors (A5). Hidden unless >1 location + plan. ── */}
        {branchCore && (
          <>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {branchRecvRows.map(b => (
                <div key={b.location_id}
                  onClick={() => setBranchFilter(f => f === b.location_id ? "" : b.location_id)}
                  style={{ background: branchFilter === b.location_id ? "rgba(251,197,3,0.1)" : "var(--bg-card)", border: `1px solid ${branchFilter === b.location_id ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, padding: "12px 16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>🏪 {b.location_name}</div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ color: Number(b.owed) > 0 ? "#f87171" : "var(--text-muted)", fontWeight: 800, fontSize: 16 }}>{fmt(b.owed)}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{b.debtors} {lang === "en" ? "debtor(s)" : "débiteur(s)"}</span>
                    </div>
                  </div>
                  {branchAdvanced && Number(b.owed) > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, fontSize: 11 }}>
                      {[
                        { v: b.not_yet_due, en: "Not due", fr: "Pas dû",  c: "var(--text-muted)" },
                        { v: b.d1_30,       en: "1–30d",   fr: "1–30j",   c: "#fbbf24" },
                        { v: b.d31_60,      en: "31–60d",  fr: "31–60j",  c: "#fb923c" },
                        { v: b.d60plus,     en: "60+d",    fr: "60+j",    c: "#f87171" },
                      ].filter(x => Number(x.v) > 0).map((x, i) => (
                        <span key={i} style={{ padding: "2px 8px", borderRadius: 8, background: "var(--bg-elevated)", color: x.c }}>{lang === "en" ? x.en : x.fr}: {fmt(x.v)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{lang === "en" ? "Branch:" : "Succursale:"}</span>
              <select className="input" value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={{ width: 200 }}>
                <option value="">{lang === "en" ? "All branches" : "Toutes les succursales"}</option>
                {activeLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {branchAdvanced && (
                <button className={`btn btn-sm ${showTopDebtors ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowTopDebtors(s => !s)}>
                  🏆 {lang === "en" ? "Top debtors" : "Top débiteurs"}
                </button>
              )}
            </div>

            {branchAdvanced && showTopDebtors && (
              <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                {topDebtorsByBranch.map(g => (
                  <div key={g.location_id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🏆 {g.location_name} — {lang === "en" ? "top debtors" : "top débiteurs"}</div>
                    {g.rows.map((r, i) => {
                      const c = customers.find(x => x.id === r.customer_id);
                      return (
                        <div key={r.customer_id} onClick={() => c && setSelected(c)}
                          style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < g.rows.length - 1 ? "1px solid var(--border)" : "none", cursor: c ? "pointer" : "default", fontSize: 13 }}>
                          <span>{i + 1}. {nameById[r.customer_id] || (lang === "en" ? "Customer" : "Client")}{Number(r.overdue) > 0 ? " ⚠️" : ""}</span>
                          <span style={{ color: "#f87171", fontWeight: 700 }}>{fmt(r.owed)}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Customer list */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            {lang === "en" ? "Loading..." : "Chargement..."}
          </div>
        ) : customers.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>[ ]</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{lang === "en" ? "No customers yet" : "Aucun client"}</div>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
              + {lang === "en" ? "Add first customer" : "Ajouter le premier client"}
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {branchCore && branchFilter && displayedCustomers.length === 0 && (
              <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
                {lang === "en" ? "No customers with activity at this branch." : "Aucun client avec activité à cette succursale."}
              </div>
            )}
            {displayedCustomers.map(c => {
              const tc = typeColor(c.customer_type);
              const isSelected = selected?.id === c.id;
              return (
                <div key={c.id} onClick={() => setSelected(c)}
                  style={{ background: isSelected ? "rgba(251,197,3,0.1)" : "var(--bg-card)", border: `1px solid ${isSelected ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: tc.bg, color: tc.color }}>
                          {TYPES.find(t => t.value === c.customer_type)?.[lang === "en" ? "en" : "fr"]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {c.phone && <span>{c.phone}</span>}
                        {c.last_purchase && <span style={{ marginLeft: 12 }}>{lang === "en" ? "Last:" : "Dernier:"} {formatDate(c.last_purchase)}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {c.total_debt > 0 ? (
                        <div>
                          <div style={{ color: "#f87171", fontWeight: 700, fontSize: 14 }}>{fmt(c.total_debt)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.open_invoices} {lang === "en" ? "invoice(s)" : "facture(s)"}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#34d399" }}>
                          {lang === "en" ? "No debt" : "Sans credit"}
                        </span>
                      )}
                    </div>
                  </div>
                  {branchCore && branchByCustomer[c.id] && (() => {
                    const e = branchByCustomer[c.id];
                    const homeName = branchAdvanced && e.homeBranchId ? (activeLocations.find(l => l.id === e.homeBranchId) || {}).name : null;
                    const owing = e.branchesOwing || [];
                    const fb = branchFilter ? branchOf(c.id, branchFilter) : null;
                    const hasFooter = homeName || fb || owing.length > 1 || (e.totalBalance < 0 && e.totalOwed === 0) || (branchAdvanced && e.anyOverdue);
                    if (!hasFooter) return null;
                    return (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 11 }}>
                        {homeName && <span style={{ padding: "2px 8px", borderRadius: 8, background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>🏠 {homeName}</span>}
                        {fb ? (
                          Number(fb.owed) > 0
                            ? <span style={{ color: "#f87171", fontWeight: 700 }}>{fb.location_name}: {fmt(fb.owed)}</span>
                            : Number(fb.balance) < 0
                              ? <span style={{ color: "#34d399" }}>{fb.location_name}: {lang === "en" ? "in credit" : "en crédit"} {fmt(Math.abs(fb.balance))}</span>
                              : null
                        ) : (
                          e.totalBalance < 0 && e.totalOwed === 0
                            ? <span style={{ color: "#34d399" }}>{lang === "en" ? "In credit" : "En crédit"} {fmt(Math.abs(e.totalBalance))}</span>
                            : owing.length > 1
                              ? <>
                                  {owing.map((b, i) => (
                                    <span key={b.location_id} style={{ color: "var(--text-secondary)" }}>{i > 0 ? " · " : ""}{b.location_name}: {fmt(b.owed)}</span>
                                  ))}
                                  <span style={{ color: "#f87171", fontWeight: 700, marginLeft: 4 }}>· {lang === "en" ? "Total" : "Total"} {fmt(e.totalOwed)}</span>
                                </>
                              : null
                        )}
                        {branchAdvanced && e.anyOverdue && <span style={{ padding: "2px 8px", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171" }}>⚠️ {lang === "en" ? "Overdue" : "En retard"}{e.oldestDue ? ` · ${formatDate(e.oldestDue)}` : ""}</span>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: customer detail */}
      {selected && (
        <div style={{ width: 400, overflowY: "auto", padding: 24, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}>x</button>
          </div>

          {/* MP-COLLECT-DEBT-NO-INVOICE: debt headline + Encaisser
              button. Sits ABOVE the Edit form so cashiers don't
              accidentally edit the balance when they meant to record
              cash. Button disabled when total_debt = 0 OR no location
              is selected (we need location_id for the sale). */}
          {(() => {
            const curDebt = Number(detail?.data?.total_debt ?? selected.total_debt ?? 0);
            const hasDebt = curDebt > 0;
            const noLoc   = !selectedLocation?.id;
            const disabled = !hasDebt || noLoc || !shiftIsOpen;
            // Priority order matches what the user can actually do
            // about it: pick a location, then open a shift, then
            // (the no-debt case is just informational).
            const tooltip = !hasDebt
              ? (lang === "en" ? "No debt to collect" : "Pas de dette à encaisser")
              : noLoc
                ? (lang === "en" ? "Select a location first" : "Sélectionnez d'abord un emplacement")
                : !shiftIsOpen
                  ? noShiftHint(lang)
                  : "";
            return (
              <div style={{ background: hasDebt ? "rgba(239,68,68,0.08)" : "var(--bg-card)", border: `1px solid ${hasDebt ? "rgba(239,68,68,0.3)" : "var(--border)"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                      💰 {lang === "en" ? "Current debt" : "Dette actuelle"}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: hasDebt ? "#f87171" : "var(--text-primary)" }}>
                      {fmt(curDebt)}
                    </div>
                  </div>
                  <RestrictedAction>
                  <button
                    title={tooltip}
                    disabled={disabled}
                    onClick={() => {
                      setCollectError(null);
                      setCollectForm({ amount: "", payment_method: "cash", notes: "" });
                      setShowCollectDebt(true);
                    }}
                    style={{
                      padding: "10px 14px", borderRadius: 10,
                      border: `1px solid ${disabled ? "var(--border)" : "var(--brand)"}`,
                      background: disabled ? "var(--bg-elevated)" : "var(--brand)",
                      color: disabled ? "var(--text-muted)" : "#152B52",
                      fontWeight: 700, fontSize: 13,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.6 : 1,
                      whiteSpace: "nowrap"
                    }}>
                    💵 {lang === "en" ? "Collect debt" : "Encaisser dette"}
                  </button>
                  </RestrictedAction>
                </div>
              </div>
            );
          })()}

          {/* ── MULTI-BRANCH: per-branch debt + branch-aware WhatsApp reminder ── */}
          {branchCore && branchByCustomer[selected.id] && (() => {
            const e = branchByCustomer[selected.id];
            const homeName = branchAdvanced && e.homeBranchId ? (activeLocations.find(l => l.id === e.homeBranchId) || {}).name : null;
            return (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>🏪 {lang === "en" ? "Debt by branch" : "Dette par succursale"}</div>
                  {homeName && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>🏠 {homeName}</span>}
                </div>
                {e.branches.map(b => {
                  const owed = Number(b.owed || 0), bal = Number(b.balance || 0), overdue = Number(b.overdue || 0);
                  return (
                    <div key={b.location_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                      <span>{b.location_name}{branchAdvanced && overdue > 0 && b.oldest_due_date ? <span style={{ color: "#f87171", fontSize: 11, marginLeft: 6 }}>⚠️ {formatDate(b.oldest_due_date)}</span> : null}</span>
                      {owed > 0
                        ? <span style={{ color: overdue > 0 ? "#f87171" : "var(--text-primary)", fontWeight: 700 }}>{fmt(owed)}</span>
                        : bal < 0
                          ? <span style={{ color: "#34d399" }}>{lang === "en" ? "in credit" : "en crédit"} {fmt(Math.abs(bal))}</span>
                          : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{lang === "en" ? "settled" : "réglé"}</span>}
                    </div>
                  );
                })}
                {e.branchesOwing && e.branchesOwing.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontWeight: 800, fontSize: 14 }}>
                    <span>{lang === "en" ? "Total owed" : "Total dû"}</span>
                    <span style={{ color: "#f87171" }}>{fmt(e.totalOwed)}</span>
                  </div>
                )}
                {branchAdvanced && selected.phone && e.totalOwed > 0 && (
                  <button onClick={() => sendBranchReminder(selected)}
                    style={{ width: "100%", marginTop: 12, padding: "10px", borderRadius: 10, border: "1px solid #25D366", background: "rgba(37,211,102,0.12)", color: "#25D366", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    📲 {lang === "en" ? "WhatsApp reminder (per branch)" : "Rappel WhatsApp (par succursale)"}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Edit form */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{lang === "en" ? "Edit details" : "Modifier"}</div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Name" : "Nom"}</label>
              <input className="input" value={form.name || selected.name}
                onChange={e => setF("name", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={form.phone !== undefined ? form.phone : (selected.phone || "")}
                onChange={e => setF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Type" : "Type"}</label>
              <select className="input" value={form.customer_type || selected.customer_type}
                onChange={e => setF("customer_type", e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={form.address !== undefined ? form.address : (selected.address || "")}
                onChange={e => setF("address", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? `Credit limit (${fmt.symbol})` : `Limite credit (${fmt.symbol})`}</label>
              <input className="input" type="number" value={form.credit_limit !== undefined ? form.credit_limit : (selected.credit_limit || "")}
                onChange={e => setF("credit_limit", e.target.value)} placeholder="0" />
            </div>
            {/* MP-CUSTOMER-EDIT-DEBT: direct balance edit (audited). */}
            <div className="form-group">
              <label className="label">{lang === "en" ? "Current debt (XAF)" : "Dette actuelle (XAF)"}</label>
              <input className="input" type="number" min="0" value={form.total_debt ?? 0}
                onChange={e => setF("total_debt", e.target.value)} placeholder="0" />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en"
                  ? "Changes the customer's balance directly. Logged for audit. Use only to correct migration errors or backfill paper records. For normal balance changes, record a payment or credit sale."
                  : "Modifie directement le solde du client. Enregistré pour audit. À utiliser uniquement pour corriger des erreurs de migration ou saisir des dettes sur papier. Pour les changements normaux, enregistrez un paiement ou une vente à crédit."}
              </div>
            </div>
            <button className="btn btn-primary btn-block" disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? "..." : (lang === "en" ? "Save changes" : "Enregistrer")}
            </button>
            {/* MP-CUSTOMER-DELETE: destructive, separated from Save. */}
            <button
              onClick={() => { setDelError(null); setConfirmDel(selected); }}
              style={{ width: "100%", marginTop: 8, padding: "9px 12px", borderRadius: 8,
                background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.4)",
                color: "#ef4444", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              🗑 {lang === "en" ? "Delete customer" : "Supprimer le client"}
            </button>
          </div>

          {/* Purchase history */}
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
            {lang === "en" ? "Purchase history" : "Historique des achats"}
          </div>
          {detail?.data?.sales?.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              {lang === "en" ? "No purchases yet" : "Aucun achat"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {detail?.data?.sales?.map(s => (
                <div key={s.sale_number} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>{s.sale_number}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(s.sale_date)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{fmt(s.total_amount)}</div>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8,
                      background: s.payment_status === "paid" ? "rgba(16,185,129,0.15)" : s.payment_status === "partial" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                      color: s.payment_status === "paid" ? "#34d399" : s.payment_status === "partial" ? "#fbbf24" : "#f87171"
                    }}>
                      {s.payment_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Payment history */}
          {detail?.data?.payments?.length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, marginTop: 16 }}>
                {lang === "en" ? "Payment history" : "Historique des paiements"}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {detail.data.payments.map((p, i) => (
                  <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(p.payment_date)} - {p.payment_method}</div>
                    <div style={{ fontWeight: 600, color: "#34d399", fontSize: 13 }}>+{fmt(p.amount)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {lang === "en" ? "Add New Customer" : "Ajouter un client"}
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={form.name} onChange={e => setF("name", e.target.value)} placeholder="Jean Dupont" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Phone" : "Telephone"}</label>
              <input className="input" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Customer type" : "Type de client"}</label>
              <select className="input" value={form.customer_type} onChange={e => setF("customer_type", e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={form.address} onChange={e => setF("address", e.target.value)} placeholder="Douala" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? `Credit limit (${fmt.symbol})` : `Limite credit (${fmt.symbol})`}</label>
              <input className="input" type="number" value={form.credit_limit} onChange={e => setF("credit_limit", e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Initial debt (XAF)" : "Dette initiale (XAF)"}</label>
              <input className="input" type="number" min="0" value={form.total_debt} onChange={e => setF("total_debt", e.target.value)} placeholder="0" />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {lang === "en"
                  ? "If this customer already owes you money from before, enter the amount here. Leave 0 for new customers with no existing balance."
                  : "Si ce client vous doit déjà de l'argent, saisissez le montant ici. Laissez 0 pour un nouveau client sans solde."}
              </div>
            </div>
            <div className="form-group">
              <label className="label">{lang === "en" ? "Notes" : "Notes"}</label>
              <input className="input" value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder={lang === "en" ? "Optional notes..." : "Notes optionnelles..."} />
            </div>
            {dupeMatch && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, marginBottom: 8 }}>
                  ⚠️ {lang === "en"
                    ? `A customer with this phone already exists: ${dupeMatch.name}`
                    : `Un client avec ce numéro existe déjà : ${dupeMatch.name}`}
                </div>
                <button className="btn btn-primary btn-block" onClick={() => openExistingCustomer(dupeMatch)}>
                  {lang === "en" ? `Open ${dupeMatch.name}` : `Ouvrir ${dupeMatch.name}`}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!form.name || addMutation.isPending}
                onClick={handleAddCustomer}>
                {addMutation.isPending ? "..." : (lang === "en" ? "Add Customer" : "Ajouter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MP-COLLECT-DEBT-NO-INVOICE: collect modal */}
      {showCollectDebt && selected && (() => {
        const curDebt   = Number(detail?.data?.total_debt ?? selected.total_debt ?? 0);
        const amt       = Number(collectForm.amount) || 0;
        const overMax   = amt > curDebt;
        const newDebt   = Math.max(0, curDebt - amt);
        // MP-REQUIRE-OPEN-SHIFT Phase 3: shiftIsOpen also gates submit
        // — if the shift closes from another device while the modal is
        // open, the button locks immediately on the next 30s refetch.
        const canSubmit = amt > 0 && !overMax && !collectMutation.isPending && selectedLocation?.id && shiftIsOpen;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
            onClick={() => { if (!collectMutation.isPending) setShowCollectDebt(false); }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, maxWidth: 440, width: "100%" }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                💵 {lang === "en" ? "Collect debt" : "Encaisser dette"} — {selected.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                {lang === "en"
                  ? "Records cash received against ghost debt (no open invoice required). Creates a sale + payment + audit entry."
                  : "Enregistre l'argent reçu sur une dette sans facture ouverte. Crée une vente + paiement + audit."}
              </div>

              {/* Current debt — read-only */}
              <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {lang === "en" ? "Current debt" : "Dette actuelle"}
                </span>
                <strong style={{ color: "#f87171", fontSize: 14 }}>{fmt(curDebt)}</strong>
              </div>

              {/* Amount */}
              <div className="form-group">
                <label className="label">{lang === "en" ? `Amount to collect (${fmt.symbol})` : `Montant à encaisser (${fmt.symbol})`}</label>
                <input className="input" type="number" min="0" max={curDebt}
                  value={collectForm.amount}
                  onChange={e => { setCollectForm(f => ({ ...f, amount: e.target.value })); setCollectError(null); }}
                  autoFocus placeholder="0" />
                {overMax && (
                  <div style={{ fontSize: 11, color: "#f87171", marginTop: 4, fontWeight: 600 }}>
                    {lang === "en" ? `Maximum: ${fmt(curDebt)}` : `Maximum: ${fmt(curDebt)}`}
                  </div>
                )}
              </div>

              {/* Payment method picker */}
              <div className="form-group">
                <label className="label">{lang === "en" ? "Payment method" : "Mode de paiement"}</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {PAYMENT_METHODS.map(m => (
                    <button key={m.key}
                      onClick={() => setCollectForm(f => ({ ...f, payment_method: m.key }))}
                      style={{ padding: "8px 4px", borderRadius: 8,
                               border: `1.5px solid ${collectForm.payment_method === m.key ? "var(--brand)" : "var(--border)"}`,
                               background: collectForm.payment_method === m.key ? "rgba(251,197,3,0.12)" : "transparent",
                               color: collectForm.payment_method === m.key ? "var(--brand-light)" : "var(--text-secondary)",
                               cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                      <div style={{ fontSize: 14 }}>{m.icon}</div>
                      <div style={{ marginTop: 2 }}>{m.key === "mobile_money" ? momoLabel(fmt.currency, lang === "en") : (lang === "en" ? m.en : m.fr)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Location (read-only, follows the global selector) */}
              <div className="form-group">
                <label className="label">{lang === "en" ? "Location" : "Emplacement"}</label>
                <div style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-elevated)", fontSize: 13, color: selectedLocation?.id ? "var(--text-primary)" : "#f87171" }}>
                  {selectedLocation?.name || (lang === "en" ? "No location selected — switch via the top bar" : "Aucun emplacement — changer via la barre du haut")}
                </div>
              </div>

              {/* Notes (optional) */}
              <div className="form-group">
                <label className="label">{lang === "en" ? "Notes (optional)" : "Notes (optionnel)"}</label>
                <input className="input" value={collectForm.notes}
                  onChange={e => setCollectForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder={lang === "en" ? "e.g. settled in person" : "ex: réglé en main propre"} />
              </div>

              {/* Computed new debt */}
              <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {lang === "en" ? "New debt after collection" : "Nouvelle dette"}
                </span>
                <strong style={{ color: newDebt === 0 ? "#34d399" : "var(--text-primary)", fontSize: 14 }}>
                  {fmt(newDebt)}
                </strong>
              </div>

              {/* Inline server error (e.g. amount > debt server-side, customer not found) */}
              {collectError && (
                <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#f87171" }}>
                  {collectError}
                </div>
              )}

              {/* MP-REQUIRE-OPEN-SHIFT Phase 3: inline hint when the
                  cashier has no open drawer. Visible inside the modal
                  so they know exactly why submit is locked. */}
              {!shiftIsOpen && (
                <div style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#fbbf24", fontWeight: 600, textAlign: "center" }}>
                  {noShiftHint(lang)}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }}
                  disabled={collectMutation.isPending}
                  onClick={() => { setShowCollectDebt(false); setCollectError(null); }}>
                  {lang === "en" ? "Cancel" : "Annuler"}
                </button>
                <button className="btn btn-primary" style={{ flex: 2 }}
                  disabled={!canSubmit}
                  onClick={() => collectMutation.mutate()}>
                  {collectMutation.isPending
                    ? "..."
                    : `💵 ${lang === "en" ? "Collect" : "Encaisser"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MP-CUSTOMER-DELETE: confirm / 409-reason modal */}
      {confirmDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
          onClick={() => { if (!deleteMutation.isPending) { setConfirmDel(null); setDelError(null); } }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, maxWidth: 420, width: "100%" }}>
            {delError ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                  {lang === "en" ? "Can't delete this customer" : "Suppression impossible"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 18 }}>{delError}</div>
                <button className="btn btn-secondary btn-block" onClick={() => { setConfirmDel(null); setDelError(null); }}>
                  {lang === "en" ? "Close" : "Fermer"}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                  {lang === "en" ? `Delete ${confirmDel.name}?` : `Supprimer ${confirmDel.name} ?`}
                </div>
                {Number(confirmDel.total_debt) > 0 && (
                  <div style={{ fontSize: 13, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    {lang === "en"
                      ? `This customer owes ${fmt(confirmDel.total_debt)}. Deleting will remove them from your records.`
                      : `Ce client doit ${fmt(confirmDel.total_debt)}. La suppression le retirera de vos enregistrements.`}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
                  {lang === "en"
                    ? "This permanently removes the customer. Customers with sales or payment history can't be deleted."
                    : "Suppression définitive. Les clients avec historique de ventes ou paiements ne peuvent pas être supprimés."}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} disabled={deleteMutation.isPending}
                    onClick={() => { setConfirmDel(null); setDelError(null); }}>
                    {lang === "en" ? "Cancel" : "Annuler"}
                  </button>
                  <button style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.5)", background: "#ef4444", color: "#fff", fontWeight: 700, cursor: deleteMutation.isPending ? "wait" : "pointer" }}
                    disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                    {deleteMutation.isPending ? "..." : (lang === "en" ? "Delete" : "Supprimer")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MP-PAYMENT-EVENT-RECEIPTS Phase 3: receipt modal for
          Encaisser dette. Stays mounted until the cashier
          explicitly dismisses (or hits ESC / overlay tap), so
          they have time to print or share. */}
      {receiptEvent && (
        <PaymentEventReceipt
          eventType={receiptEvent.eventType}
          data={receiptEvent.data}
          org={orgSettings}
          lang={lang}
          onClose={() => setReceiptEvent(null)}
        />
      )}
    </div>
  );
}
