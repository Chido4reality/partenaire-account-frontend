# Offline optimistic-success gap — options

**Status: PROPOSAL. Nothing built.** Found while reproducing item 13
(2026-08-22). Not credit-specific.

---

## The gap, precisely

`utils/api.js:245` — when `!net.connected || net.degraded`, the axios adapter
enqueues the write and returns an **optimistic success response without touching
the network**. No server gate runs, because nothing is sent.

`net.degraded` is armed by `recordWriteFailure()` (`api.js:366`) after *any*
network error or 5xx on an offline-eligible write. One flaky write arms it, and
the **next** sale skips the network entirely. That is MP-DEGRADED-ROUTING,
deliberate: it trades correctness at ring-up for not making a cashier watch a
45-second spinner.

So at ring-up under degraded routing, **every** server-side gate is skipped:

| gate | where it lives |
|---|---|
| credit block / ceiling | `decideCredit` |
| below-cost | bundle + `createSaleCore` |
| oversell | `decideOversell` |
| discount cap | `pa_permission_decision` |
| high-value threshold | `decideHighValue` (new) |

The UI reports the sale complete, prints a receipt, and the goods leave.

**The server still holds.** On replay `createSaleCore` runs the gates and 403s;
the item becomes `failed_permanent` (pendingSync line 22). Verified for credit:
papa john's debt never moved. So this is a **false success at the till**, not a
data-integrity bypass. The loss is the goods, not the ledger.

**What makes it serious:** the rejection surfaces only in sync-status UI
(OnlineOfflineBar badge, `/pending-sync`, ConflictModal) — places a cashier
mid-queue is not looking, possibly hours later, with the customer long gone.

---

## ⚠️ Two prerequisites — any local check is WRONG without these

Both are in `GET /staff/my-permissions`, the client's only view of its own rules.

1. **The no-row default is inverted.** `/my-permissions` returns
   `credit_policy: "allow"` when the staffer has no permissions row.
   `decideCredit` returns **block** for a non-owner with no row
   (MP-PERM-CLOSED-DEFAULT). So the client believes credit is allowed for
   exactly the users the server refuses — **the Joseph case**, who had no
   permissions row earlier today.
2. **`max_credit_amount` is absent from the payload.** The select lists
   `max_discount_pct`, `max_expense_amount` and `approve_above_amount` but not
   this one, so the client cannot evaluate the credit ceiling at all. Classic
   named-select-list omission: absent, not null.

Fixing these is cheap and is a precondition for options 1 and 2. Note also that
react-query has **no persister** here, so after a reload while offline `perms`
is `null` — any local check must treat "I don't know" as a gate, not a pass.

---

## Options

### 1 · Local pre-check mirroring the server gates
Evaluate the cart client-side before completing offline: credit (`paid < total`),
below-cost (`unit_price < min_price`), oversell (`qty > stock`), discount cap,
high-value threshold. Product, stock and policy data are all already local.

- **For:** catches it at ring-up, where the cashier can still act.
- **Against:** a second implementation of every rule — the one-fact-many-readers
  shape this codebase keeps getting bitten by. It will drift from the server,
  and the drift is silent. Also inherits both prerequisites above.

### 2 · Refuse to complete a GATED cart offline; queue ungated ones as today
If the cart trips any locally-detectable gate condition, refuse at ring-up:
*"This sale needs the boss's approval and the network is down — it cannot be
completed here."* Everything else queues exactly as now.

- **For:** no false success can occur. Preserves offline selling for the large
  majority of carts, which trip no gate at all. Fails **closed** when the local
  check is unsure, so the prerequisite gaps degrade to over-refusal rather than
  over-acceptance.
- **Against:** a genuinely offline shop cannot sell on credit even where the
  staffer is permitted. Real business cost, and Paul's shops do go offline.

### 3 · Complete it, but never call it a sale — mark it PROVISIONAL
Queue as today, but a gated cart produces a visibly provisional result: the
confirmation and the receipt both say "awaiting approval — not yet final", and
the sale shows as provisional until sync confirms.

- **For:** loses no sale; honest; does not need an accurate mirror, since it can
  trigger on the coarse question "does this cart involve credit / a discount /
  below-min pricing / oversell?"
- **Against:** the cashier may hand the goods over anyway. Softer than refusing.

### 4 · Make a permanent sync failure unmissable, in context
When a queued **sale** hits `failed_permanent`, raise a blocking modal on the POS
naming the sale, customer, amount and reason, requiring acknowledgement — plus a
persistent red bar until cleared. Today it is a badge.

- **For:** cheap, needs no mirror, and covers gates that cannot be evaluated
  locally at all.
- **Against:** after the fact. Necessary, not sufficient.

### 5 · Make the ROUTING decision depend on the cart, not just the network
The degraded shortcut is right for an ordinary sale and wrong for a gated one.
Keep instant queueing for carts that trip nothing; for a gated cart, always
attempt the network first and accept the spinner, falling back to option 2 or 3
only on a true network failure.

- **For:** surgical. Pays the latency cost only on the small minority of carts
  that need a server decision, and preserves the reason MP-DEGRADED-ROUTING
  exists. Most "degraded" states are not truly offline, so most gated carts
  would simply get a real answer.
- **Against:** still needs the local "is this cart gated?" test — but only as a
  coarse trigger, not as a reimplementation of each rule's outcome.

---

## Recommendation

**5 + 2 + 4, with the two prerequisites first.**

1. Fix `/my-permissions`: correct the no-row default to match `decideCredit`, and
   add `max_credit_amount`.
2. Add a coarse **"does this cart need a server decision?"** test — credit,
   discount, below-min, oversell, or over-threshold. Deliberately coarse: it asks
   *whether* a decision is needed, never *what* the decision is. That is what
   keeps it from becoming a second copy of the rules.
3. Gated cart + degraded → attempt the network anyway (option 5).
4. Gated cart + genuinely offline → refuse at ring-up (option 2).
5. Anything that still fails on replay → unmissable in-context alert (option 4).

Ungated sales are untouched throughout, which is the overwhelming majority of
trade and the whole reason offline mode exists.

**Open question for Peter:** step 4 is the business trade-off. A permitted
staffer at a genuinely offline shop loses the ability to sell on credit until
connectivity returns. The alternative is option 3 — let it through, labelled
provisional, and accept that some will be rejected later. That is his call, not
a technical one.
