# Stale / not-moving products — the feature is BUILT and IGNORED

**Do not build anything from this document.** Peter is taking it to Paul first.
The question is not *what to build* — it is *why a working feature that has
identified 34.2 million XAF of Paul's money has never been opened*.

---

## What already exists (verified 2026-08-22, live on prod)

Peter's 2026-07-14 design shipped in full, and **both questions that were
recorded as "left open" were in fact answered the same day, in the code**:

| decision | resolved to | where |
|---|---|---|
| **Ranking basis** | **tied-up value** — `qty_before × cost_price` desc, oldest flag as tiebreak | `backend/src/routes/stockChecks.js:275-279` |
| **Threshold** | **60 days**, fixed, deliberately not per-org configurable | `backend/src/lib/stockChecks.js:183` — comment reads *"(Peter, 2026-07-14)"* |

The rest of the design is there too:

- **Nightly cron** over every Pro / Pro Plus org — `scanStaleProductsAllOrgs`,
  wired in `backend/src/index.js:429`. Last run on prod: **2026-08-22 03:40 UTC**.
- **Auto-scans ALL products**, not a sample: stock > 0, product itself older than
  the threshold (a new product hasn't had a fair chance), kit parents excluded,
  no sale AND no movement at that location inside the window.
- **Its own surface, not the "To count" queue** — `GET /stock-checks/stale`, and a
  separate `stale` tab in `StockCheckPage` labelled *"📦 not moving"*. Merging it
  into the movement-triggered list was explicitly rejected: that list nags on
  every receive, and a long tail of slow movers there would be ignored.
- **Sidebar signal excluded** — `MP-STALE-OUT-OF-QUEUE`, `Layout.jsx:927`. The
  badge counts actionable work; stale is observational. The full list is always
  viewable.
- **Dedupe + cooldown** — `MP-STALE-RUNAWAY`. A product acknowledged as genuinely
  slow is not re-flagged for another 60 days. Without it an earlier low-stock
  cron produced 67k rows in 18 days for one org.
- **Acknowledgement is honest** — `POST /stock-checks/:id/acknowledge-slow` writes
  `resolution_reason='slow_mover'` with `qty_counted` null, *not* a bare
  `verified`, because nobody counted anything.

## The actual state on prod

| org | pending stale rows | distinct products | tied-up value |
|---|---|---|---|
| **Paul — `6b10ecca…`** | **674** | **362** | **34,235,248 XAF** |
| other | 1 | 1 | 24,200 XAF |

Worst single line: **1,210,000 XAF**. Every row has a real `cost_price` (none
are zero, so the ranking is meaningful throughout).

**Acknowledged as slow movers, all time, both orgs: 0.**

The feature that answers Paul's original "slow-moving goods" complaint has been
running for over a month, has ranked 362 of his products worst-first, and nobody
has ever opened it or actioned a single row.

---

## The three hypotheses — Paul only has to say which

Peter should get him to open **Stock Check → 📦 not moving** once.

### 1 · He does not know the tab exists
It is deliberately excluded from the sidebar badge, which was the right call for
nagging and may be the wrong one for discovery. Nothing anywhere else in the app
mentions that 34.2M is sitting still.
→ *Fix would be a summary line where he actually looks (Home or Inventory), not a
badge — a count would re-create the nagging the design rejected. A value would
not: "34.2M not moving" is information, not a chore.*

### 2 · 674 rows is not a list anyone can work
Even ranked worst-first, that is not something a shopkeeper triages. The top 20
lines are probably most of the value; the tail is noise he has to scroll past.
→ *Fix would be a default top-N or a value floor, with "show all" still there.*

### 3 · 60 days is too tight for his catalogue
If a large share of his 362 products are genuinely seasonal or long-tail, the
threshold is over-flagging and the list is correctly ignored.
→ *Fix would be a longer default, or per-org after all — which Peter explicitly
ruled out on 2026-07-14, so it would be a reversal, not an oversight.*

**These are not mutually exclusive**, and 1 and 2 could both be true. But they
imply different work, and one five-minute look decides it. Do not guess.

## What NOT to do

- **Do not lower the threshold or add a badge to "make it more visible"** before
  knowing which of the three it is. If the answer is #2, more visibility makes it
  worse.
- **Do not merge it into "To count".** That was decided and the reasoning still
  holds.
- **Do not treat 0 acknowledgements as "the feature is broken".** The
  acknowledge path is wired and tested; nobody has reached it.
