# Regression pass — Paul's historical complaints

**No build ships to Play without a pass against this list.** Every item was fixed
once. The point is that the codebase has changed enormously since — Phase 1a and
1b, the 13-defect pending sweep, six SQL objects rewritten, the rate limiter, the
overlay hardening, expense tickets — and several of those touched the exact paths
involved.

**Prove each one. Do not reason from the commit that fixed it.** That inference
is what this month removed.

---

## A. Provable without a person — re-run these before every release

Run against **staging and prod**. Each is a constraint, an FK, a column list or a
count: it either holds or it does not.

```sql
-- #6  offline sale stuck in the queue (is_damaged NOT NULL vs explicit null)
--     Expect: is_nullable = NO, default false  AND  0 rows with a NULL.
--     The COLUMN is still NOT NULL — the fix was client-side (stop sending an
--     explicit null), so the constraint holding is not the proof. The row count is.
select is_nullable, column_default from information_schema.columns
 where table_schema='public' and table_name='pa_sale_items' and column_name='is_damaged';
select count(*) as must_be_zero from pa_sale_items where is_damaged is null;

-- #9  damaged tab 500 (missing FKs → PostgREST cannot resolve an embed)
--     Expect 4 rows. pa_sale_ticket_items is included deliberately: it shipped
--     WITHOUT its product_id FK once and 500'd the cashier queue the same way.
select tc.table_name, kcu.column_name, ccu.table_name as references
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
 where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
   and tc.table_name in ('pa_sale_items','pa_sale_ticket_items')
   and kcu.column_name in ('product_id','sale_id');

-- #14 Tank Cover — transfer with NO DESTINATION
--     ⚠️ to_location is NULLABLE. The DB does not enforce this; every write path
--     validates it in code. So the proof is "no NEW instances", not a constraint.
--     Expect 0 created after 2026-07-17 (the day it was reproduced).
select count(*) as null_dest_since_fix
  from pa_stock_transfers where to_location is null and created_at > '2026-07-17';
```

### Results, 2026-08-18

| # | Complaint | Verdict | Evidence |
|---|---|---|---|
| 6 | Offline sale stuck in sync queue | **still fixed** | `is_damaged` NOT NULL default false; **0** NULL rows in staging *and* prod |
| 9 | Damaged tab 500 (missing FKs) | **still fixed** | all 4 FKs present, incl. `pa_sale_ticket_items.product_id` → `pa_products` |
| 14 | Transfer with no destination | **still fixed** | prod **0 of 132** transfers created since the fix have a null destination; staging's 28 are all from one 15-minute window on 2026-07-17, the day it was reproduced |

⚠️ **#14 carries a standing risk.** `to_location` is nullable and the guarantee is
code-only, held by every write path validating independently. That is the
one-fact-two-readers shape. It has held for a month across 132 prod transfers, but
a new write path that forgets would reopen it silently. A NOT NULL constraint would
make it structural — blocked today only because the 28 staging rows would have to
be cleaned first.

### Not yet automated — do these before the next release

- **#5** drawer variance (refunds vs exchanges split across two labels) — display
  only. Now higher risk: the drawer has **expense payouts** in it since
  MP-EXPENSE-TICKETS. Compare `pa_drawer_ledger.cash_expenses` against the
  `/shifts/:id/cash-expenses` drill-down for the same shift; they must agree, and
  both now filter `status='paid'`.
- **#7** blank CSV export — assert the export has a non-empty header row and one
  line per row for a known date range.
- **#10** damaged label missing from receipts and reports — assert the label
  string appears for a sale containing a damaged line.

---

## B. Needs Peter — the approval and cart paths

**These five cannot be proved from code.** They run through approval, the cart and
price resolution, which cashier mode rewired. Inspecting the code tells you the
guard exists; only driving it tells you the guard fires and the cart survives.

### Setup (once)

| | |
|---|---|
| Environment | **staging** — `pos.partenairedozie.com` pointed at staging, or the dev server |
| Shop | **Bepanda** (`b0b0b0b0-0000-0000-0000-000000000001`) — currently `sales_mode='cashier'` |
| Boss login | Boss Dozie (owner) — approves, and sees every surface |
| Staff login | **Ada** (cashier) — has `can_receive_payment`, `can_release_goods`, `can_pay_expenses` |
| ⚠️ Watch | Ada has **no open shift** unless you open one. Several gates depend on it. |

> A second browser (or a private window) for Ada saves re-logging between steps.
> Several of these need Boss and Ada acting within the same minute.

### 1 · Cascading approvals — the sale must not die

The original: below-cost approved, then credit approved, then "price changed",
then no popup at all, and the sale could not be completed.

1. As **Ada**, add a product and set a price **below its cost** — this must trip
   the below-cost gate.
2. Add a **credit** payment for a registered customer, over their limit if they
   have one, so a second approval is required in the same sale.
3. Send for approval. As **Boss**, approve in My Requests.
4. Back as Ada: press Confirm.

**Pass:** the sale completes at the approved price, in one go.
**Regression looks like:** a second popup demanding approval for something already
approved; a "price changed" message; Confirm doing nothing; or the cart emptying.

⚠️ **Highest risk item on this list.** The bundled-approval path and the overlay
hardening both touched it, and `anyRootOverlay` now governs whether these modals
appear at all.

### 2 · The send-request popup must appear

1. As **Ada**, trigger any action her policy sets to `approve` — an over-cap
   discount is easiest.
2. Watch for the popup that lets her send the request.

**Pass:** the popup appears and sending it returns a "keep working" toast.
**Regression looks like:** nothing appears and the action silently fails — the
original complaint exactly.

⚠️ The overlay work changed which modals may render over the cart sheet. If it
appears on desktop but not on a phone, say so — that is the Vaul layer.

### 3 · Double-sale — completing from My Requests must clear the cart

1. As **Ada**, build a cart needing approval and send it.
2. As **Boss**, approve.
3. As **Ada**, complete the sale **from My Requests**, not from the POS.
4. Go back to the POS.

**Pass:** the cart is empty; the sale cannot be rung a second time.
**Regression looks like:** the items still sitting in the cart at the original
price, sellable again — a duplicate sale and duplicate stock movement.

⚠️ `useDraftCartStore` persists the cart per (user × location) and the open-shift
fix changed when the cart sheet collapses. This is the one that costs Paul money.

### 4 · Approved prices must hold

1. As **Ada**, change a price so it needs approval; send it.
2. As **Boss**, approve.
3. As **Ada**, complete the sale.
4. Check the sale in Reports and on the receipt.

**Pass:** the approved price is what was charged and what is printed.
**Regression looks like:** the original price reappearing anywhere — cart, receipt
or report.

### 13 · The Nora incident — a blocked credit must not slip through

1. Pick a staff member whose `credit_policy` is **block**.
2. As that person, try to complete a sale with a credit or partial payment.

**Pass:** refused, with a sentence naming the reason.
**Regression looks like:** the sale completing and debt appearing on the customer.

⚠️ Check it on a **cashier-mode till too**. The credit terms are resolved when the
ticket is RAISED and the cashier only chooses the tender, so this gate now has two
places to be right.

### While you are there

- The **expense cap** refusal should now name the number: *"Expense above your
  limit (2 max)"*, and for a cap of 0, *"Your expense limit is 0, so no expense
  can be recorded."* Kosi (cap 0) and David Bepanda (cap 2) are the live cases.
- Report anything that is **dimmed without saying why**. Every disabled control in
  this feature is supposed to name its reason.

---

## C. Before touching the frontend at all

```
npm run mount-check
```

23 scenarios across Payouts, Queue, Pickup and the oversight tab. Catches the
class a parse check cannot: `cond ? a : ({x})` is valid JavaScript and shipped a
dead page to a user. A React warning counts as a failure.
