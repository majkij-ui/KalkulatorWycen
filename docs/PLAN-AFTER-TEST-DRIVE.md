# Plan after the first test drive *(M.J. notes of 2026-10-13)*

Builds on [PLAN-CALENDAR-AND-THREADS.md](PLAN-CALENDAR-AND-THREADS.md) (§3.4 rules, §6 tracks, §7
decisions) and [PLAN-GEAR.md](PLAN-GEAR.md). Nothing here is built yet. Recommendations come first in each
decision. Decisions A–F were confirmed by M.J. on 2026-10-13 (see each section).

## 1. What came out of testing

| # | Note | Kind |
|---|---|---|
| 1 | Finance: profit after **direct** costs (everything in Realizacja) and after **overheads** (subscriptions, gear purchases, tax, ZUS / health), also as an average per project for a closed quarter or year | feature |
| 2 | Ekipa: one person in several roles with several day rates, counted as one person | feature |
| 3 | Klienci: CIONET + DE Group, and PHH + PHN + Interferie are one client each for stats and filters, while each name stays visible | feature |
| 4 | Skrzynka: a thread jumps down the list while you accept its proposals one by one | bug |
| 5 | „Znaleziono 1 zapisanych wycen" comes back at every start (S-AI) | bug |
| 6 | Sprzęt: a second kind of gear that never goes on set (laptop, magic arm, SD cards): tracked as a cost, kept out of the pickers | feature |
| 7 | Finanse: a „Subskrypcje i koszty stałe" tab: set up recurring payments, see month and year totals and what a change does to the year; manual costs still possible | feature |
| 8 | Quotes in EUR end to end: type and see prices in EUR, consistent PDF (today it mixes PLN and zł) | feature + bugs |
| 9 | PDF: the gross price is highlighted (orange, bold); the net price should lead | change |
| 10 | Period report (quarter / half / year): PDF plus a file an AI agent can read, and more stats in Finance | feature |

## 2. Root causes of the two bugs (checked in code and data)

- **#5 Recurring banner — not reproduced yet.** First suspect was the migration banner („Znaleziono N
  zapisanych wycen"): the S-AI library quote's project `p-1791701624673-7mau8nz` was deleted on 11.10 as a
  duplicate. But the start-up count already includes deleted projects (`listAllProjects`), so on today's
  data it is 0, and no other start-up notice in the hub talks about an unsaved quote. Waiting for the exact
  wording / a screenshot from M.J. (and which app: the hub or the old QuoteGen).
- **#4 Jumping thread.** Groups are sorted by the newest date among their **pending** proposals
  (`groupProposals`, `lib/inbox.ts`). Accepting the newest items re-sorts the group lower; a leftover
  `project_update` (contact) often has no date and drops to the bottom. Fix: a stable order for the session
  (sort by the group's newest date over all its proposals, handled ones included) and keep a group in place
  until it is empty. **Fixed 2026-10-13** (`3c8249c`): a second cause was found — once a thread's new
  project was accepted, the rest of the thread (e.g. a contact update without a thread id) fell back to a
  group „by client" at the end of the list. Grouping, titles and order now come from all proposals in the
  files (`pendingProposals().all`); only the waiting ones are shown.

## 3. Proposed design

### 3.1 Margin in two layers (#1)

- **Layer 1 — „Marża na realizacji"** per project = revenue (best known, T6) − **direct costs** (Realizacja:
  crew, rentals, logistics, catering, direct services, gear bought for the project). Before tax. This is
  the number for judging a single job.
- **Layer 2 — „Wynik po kosztach firmy"** = layer 1 − ryczałt tax − ZUS / health − subscriptions and other
  fixed costs − gear purchases − marketing. Shown for a **period** (month / quarter / half / year), where it
  is a fact, and as an **average per project** in that period: overhead of the period spread over its jobs,
  so each job shows „after overheads".
- Unfinished periods are labelled „wstępnie" (overheads still to come).
- **Decision A — confirmed 2026-10-13:** overheads are spread **by revenue share** (share of revenue =
  share of overheads). Layer 2 per project is meaningful **for a year only**: the year view (closed, or the
  current year marked „wstępnie") shows each job after overheads; month / quarter / half views show layer 1
  per project and the period's overheads as totals, not per job.
- **Decision B — confirmed 2026-10-13:** a Finance toggle **„Rozłóż duże zakupy sprzętu"**. On: every
  purchase of **5,000 zł netto or more** (threshold editable) is spread evenly over **36 months** from its
  purchase month; cheaper items count in full in their month. Off: the cash view, each purchase in full in
  its month (how the year's shopping hit the account). Layer 2 per project uses the spread view; the toggle
  switches every number on the screen, and the report says which view it shows.
  - Consequence to show clearly: with the spread view, 2026 also carries the remaining months of 2024–2025
    purchases (e.g. the RED Komodo pack, 57,000 zł from 04.2024, adds about 1,583 zł a month until
    03.2027), while 2026 purchases weigh less in 2026.
  - An item sold or retired early: the not-yet-spread rest, minus the sale price, lands in that month
    (needs a sale price field; until then retirement just stops the spreading).
  - Management view only: tax depreciation rules (10,000 zł threshold for fixed assets) are not modelled.
- **One source for gear purchases:** the catalogue (purchase price + date). Today they are typed by hand
  as fixed costs „Sprzęt" (34 „other" entries in `finances.json`, some of them gear). Moving them to the
  catalogue goes through a reviewed patch, never silently, to avoid counting twice.

### 3.2 Subscriptions and fixed costs (#7)

- New `subscriptions.json`: `{ id, name, category, amount, currency (PLN / EUR / USD), cadence (monthly /
  yearly / custom months), startDate, endDate?, notes }`. The subscription is the fact; its monthly costs
  are **derived**, never stored twice.
- Finance gets sub-tabs: **Projekty** (today's view) · **Koszty stałe i subskrypcje** · later **Raport**.
  The new tab:
  - subscriptions at the top with month and year values and an on/off „co jeśli" toggle;
  - the month-by-month fixed costs below (today's list moved here, easier to add and edit);
  - categories beyond ZUS / Marketing / Inne: Oprogramowanie, Bank, Biuro / księgowość, Telefon i internet,
    Ubezpieczenia, Sprzęt (from the catalogue).
- **Decision C — confirmed 2026-10-13:** a subscription's months count **automatically**; any month can be
  corrected to what actually happened (amount paid, FX, a skipped or paused month).
- Today's recurring manual entries (ZUS, Oprogramowanie, Opłaty bankowe, FPD) become subscriptions via a
  reviewed patch, with the past months kept as they are.

### 3.3 One person, several roles (#2)

- `CrewMember.roleRates?: { roleId, rate, note? }[]` (additive). The person's `rate` stays the fallback.
- Picking a person on a line with role X takes **their rate for X**. In Realizacja you pick the person,
  then the role (from their roles first) and the rate follows.
- Stats stay per person, with a breakdown by role (already in T9a).
- **„Scal osoby"**: merges duplicates you already typed (Łukasz ×3): rewrites `personId` on cost rows and
  quote lines, keeps the frozen names, with undo.

### 3.4 Client groups (#3)

- New `client-groups.json`: `{ id, name, members: clientKey[] }`. This is the one exception to „no client
  file" (decision 3): it stores a grouping, not clients. **Decision D — confirmed 2026-10-13.** Why it was a
  question at all: decision 3 kept clients as a plain field so there is nothing to maintain. A group file is
  the first thing that has to stay in step with client names: renaming a client through „Scal nazwy" must
  move its membership (built in), and typing a new spelling in a project header silently leaves the group
  (the client page shows „poza grupą" so it's visible).
- Klienci: a group is one row with its members inside (each keeps its name and own page). The group page
  shows the stats over all members: revenue, return rhythm, last job, win rate, payments.
- Filters by group in Projekty and, after 3.1, in Finance and the report. „Scal nazwy" keeps the group
  membership in step.
- The T6 glue goes here: Klienci revenue and the Projekty client filter read the money loop's
  best-known revenue (§6, „Glue left after T6").

### 3.5 Gear that never goes on set (#6)

- `EquipmentItem.onSet?: false` → „Zaplecze i drobiazgi" (laptop, magic arm, cards, cables).
- Kept out of the quote picker, the G3 grid, kits and payoff („Odpracował" does not apply). Shown on the
  Sprzęt screen under its own tab with purchase price and date, and counted as cost (3.1).
- Fast entry: name, price, date in one row; bulk add.

### 3.6 Quotes in EUR (#8) and the PDF (#9)

- **Decision E — confirmed 2026-10-13:** the quote's currency is chosen per quote; in EUR you type and see
  every price in EUR. The rate is frozen per quote (NBP on a chosen day, editable). Finance stays in PLN at that
  rate until an invoice gives the real amount.
- The session first **audits every money display** (calculator tabs, totals, plan, PDF rows and texts) and
  lists the mixed PLN / zł spots before changing anything. Old PLN quotes must calculate and print exactly
  as before (golden tests, like T9b).
- PDF: net leads (the bold accent moves to netto); gross becomes a quiet line.

### 3.7 Period report (#10) and Finance stats

- „Raport" for a quarter / half / year:
  - revenue and both margin layers, per project and per client group;
  - payments and overdue, subscriptions and fixed costs;
  - marketing (spend, leads, cost per job, ROAS), gear (spend, payoff), crew (who, how much);
  - the previous period for comparison.
- Exports:
  - **PDF** through the call sheet's desktop path;
  - **one Markdown file** with the same tables and a JSON block (**Decision F — confirmed 2026-10-13**),
    made for pasting into a conversation with an AI agent.
- The stats in Finance absorb the money-related part of T7 (response time and conversion stay in
  Marketing).

## 4. Sessions and order

| Wave | Session | Contents | Runs with | Needs |
|---|---|---|---|---|
| 0 | **Main session** | Bugs #4, #5. Then 3.5 Zaplecze (small, equipment files only) | anything | — |
| 1 | **S1 Koszty stałe i subskrypcje** | 3.2: Finance sub-tabs, subscriptions, fixed costs moved and reworked, new categories, review patch for recurring entries | S2, S3 | decision C |
| 1 | **S2 Grupy i role** | 3.3 + 3.4: role rates per person, „Scal osoby", client groups (Klienci, Projekty filter), T6 glue for Klienci revenue | S1, S3 | decision D |
| 1 | **S3 Waluta i PDF** | 3.6: audit, EUR end to end, net-first PDF, golden tests | S1, S2 | decision E |
| 2 | **S4 Warstwy marży** | 3.1: layer 1 per project, layer 2 per period and per project, gear depreciation, catalogue as the one gear-cost source (review patch), group filter in Finance | — | S1, S2, Zaplecze; decisions A, B |
| 3 | **S5 Raport okresowy** | 3.7: report screen, PDF, Markdown + JSON, Finance stats | — | S4 |
| later | backlog | T9c (retire old quote rows) after the S3 calculator changes; mail runbook asks for invoice amounts, due dates and extra sales; G3 packing list via PDF | — | — |

**Why this order:**
- S1, S2 and S3 touch different parts of the app (Finance; Ekipa and Klienci; calculator and PDF). They
  share only the `SCHEMAS` list in `scripts/data.mts` (two new files), which is trivial to merge.
- S4 needs subscriptions (S1), groups (S2) and the gear kinds (Zaplecze), because layer 2 is built from
  them.
- The report (S5) reads everything, so it comes last.
- T9c also edits the calculator, so it waits until S3 is merged.

**Data:** as of 2026-10-13 all 18 catalogue items have a purchase price (15 with a date; 9 at 5,000 zł or
more). Sessions build with whatever is there: every number is derived on read, so M.J. can correct
prices, dates and amounts by hand later without breaking anything. Still missing before S4: the four
invoices (S-AI, JHJ, Morris & Lloyd, CIONET wywiady), rental rates, and the Zaplecze items.

## 5. S1 as built

*(not built yet — S1 writes here)*

## 6. S2 as built

*(not built yet — S2 writes here)*

## 7. S3 as built

*(not built yet — S3 writes here)*
