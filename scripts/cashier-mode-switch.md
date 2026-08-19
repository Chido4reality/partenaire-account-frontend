# Turning cashier mode on for a shop

**Flipping `sales_mode` is one of four steps.** Doing only that leaves the shop
with a workflow nobody can use and a help page that describes the old one.

This list exists because three of the four are easy to forget and one of them —
the `shift` topic — is an *existing correct* topic that becomes **wrong** on the
same day, which is harder to remember than something missing.

---

## 1 · Grant the permissions BEFORE flipping the till

`Accountant Log → Permissions`, per staff member:

| flag | who needs it |
|---|---|
| `can_receive_payment` | whoever takes money at the till |
| `can_release_goods` | whoever hands goods over |
| `can_pay_expenses` | whoever pays suppliers — **a separate trust from taking payment** |

⚠️ **A staff member with no permissions record can do almost nothing.** The
default is BLOCK (`MP-PERM-CLOSED-DEFAULT`). Open each person's permissions and
**save**, even if nothing changes — otherwise the ticket screens are invisible to
them and they will report the feature as broken.

⚠️ Permissions are **org-wide**, not per location. Granting `can_pay_expenses`
lets that person pay out at *every* shop, including tills they have never worked
at. `branch_scope` exists and these three flags do not use it — a known gap, not
an accident. Decide whether that is acceptable before a second shop goes live.

⚠️ Check `max_expense_amount` while you are there. **Blank = no limit. 0 refuses
every expense.** Two of Paul's staff carry 0 and 2 and have never recorded one.

## 2 · Flip the till

`pa_locations.sales_mode = 'cashier'` for that location.

Effects, immediately: Cashier / Pickup / Payouts appear for anyone holding the
matching flag; the POS "Send to cashier" path replaces direct completion; expenses
raised there become payouts instead of drawer events.

⚠️ **Nothing is retroactive.** Sales and expenses recorded before the flip stay as
they were. There is no migration and none is wanted.

## 3 · Fix the `shift` help topic — it becomes WRONG today

`src/data/helpTopics.js`, topic id `shift`. It states:

> Expected drawer = opening float + cash received + cash debts collected − cash refunds − **expenses**

That is correct in direct mode. From today, **"expenses" means paid-out expenses
only** — a raised-but-unpaid payout is deliberately not subtracted, which is the
governing rule of the whole feature. Add that qualification, or an owner will
expect a raised expense to be in the figure and it will not be.

This is the one that will be missed: it is not a missing topic, it is a correct
topic that quietly stops being true.

## 4 · Release the held help topics

`src/data/helpTopics.js` — delete the `held: true` line from each:

- `cashier-workflow` — send to cashier · collect · hand over
- `expense-tickets` — raise · pay out · cancel
- `cashier-oversight` — the Reports → Till tab

`HelpPage` filters `held` out of the list, the search and the deep-link lookup, so
until the flag is removed they are invisible and unreachable — which is the point.
The July rule stands: a topic ships only when its flow is shipped **and
device-verified**.

Then check each new screen's `?` lands on its own topic:

| screen | topic id |
|---|---|
| Cashier | `cashier-workflow` |
| Pickup | `cashier-workflow` |
| Payouts | `expense-tickets` |
| Reports → Till | `cashier-oversight` |

⚠️ **Verify the landing, do not assume it.** The Stock Check `?` originally
pointed at the damaged-goods topic. Landing on the wrong topic is worse than
having no button, because the reader believes they have read the answer.

---

## Before any of it

```
npm run mount-check          # frontend — does it render, in every state
npm run check-rls            # backend  — no public table without RLS
```

and the person-driven items in `regression-pass.md`. Cashier mode rewired the
approval and cart paths, which is where five of Paul's fourteen complaints lived.
