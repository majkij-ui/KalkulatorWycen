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

- **#5 Recurring banner — fixed 2026-10-16 (`5f8923d`).** M.J.'s screenshot showed the migration banner
  („Znaleziono 1 zapisanych wycen"). Cause: saving the calculator into „Moje wyceny" while a project is open
  made a library copy linked to nothing, so the banner offered to turn it into a new project. That is how
  the S-AI duplicate (deleted 11.10) appeared; on 16.10 it was „Morris Lloyd - Wisła Październik" (saved
  14.10, same quote as the project „Morris & Lloyd — rolki, październik (Wisła)"). Now library saves from an
  open project store `projectId` and are never pending; the banner names the quotes and has „Pomiń" (per
  quote or all, remembered on this computer); „Przenieś" skips both.
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

**Merged and installed 2026-10-13 (S1 → S2 → S3):** only conflict was the `SCHEMAS` list in `scripts/data.mts`
(both entries kept). 567 tests. Real data, read-only, before vs after: all 11 saved quotes compute identically;
Finance 2026 unchanged (167,813 zł revenue, 82,574 zł project profit). Not applied yet, waiting for M.J.: the S1
subscription and category patches (`imports/2026-10-13-s1-*.json`) and the S2 client groups. Next: Zaplecze
(main session), then S4.

## 4a. Quote as a project document (Q1) and quote variants (Q2) *(decided with M.J. 2026-10-16)*

**Why:** the hub still carries the original QuoteGen design: ONE global calculator that a project is
loaded into („openProject" → `loadQuoteSnapshot`) and written back from („Zapisz"). This caused the
S-AI client leak, prices carried between projects, „Nowy projekt" inheriting old data and library copies
turning into duplicate projects (bug #5). M.J. also loses unsaved work when leaving a project and coming
back.

**Decided:**
1. **Retire „Moje wyceny"** (the quote library sheet, its save buttons and the migration banner). One
   place to save a quote — the project.
2. **No singleton calculator.** A project's quote is its own document; the Wycena tab edits it in place.
   Its state stays with the project while you move between tabs, screens and other projects, and survives
   a restart. Opening another project opens that project's document.
3. **Variants A/B/C come next (Q2)**, in their own session. Q1 must not block them: the document model
   leaves room for several variants of one project, and everything that counts money (financials,
   Realizacja plan, Finance, reports) reads one chosen variant.

Order: foundation clean-up (dead code, strict build) goes into Q1 step 0; Q1 runs alone on the
calculator; Q2 after Q1; S4 can start after Q1 is merged.

## 5. S1 as built

*(2026-10-13, branch `claude/fixed-costs-subscriptions-1a3bd1`; merged and installed the same day.)*

**Built:**
- **Finance sub-tabs.** „Projekty” is the old screen without the month list. „Koszty stałe i subskrypcje” is
  new. Tabs come from the `FINANCE_TABS` list in `finance-section.tsx`, so S5 adds „Raport” as one more entry.
  The period picker is shared by both tabs. The „Koszty stałe” tile adds „w tym subskrypcje X · plan na kolejne
  miesiące Y”, and clicking it opens the new tab.
- **`subscriptions.json`** (`lib/subscription-types.ts`, `lib/subscriptions-store.ts`). Fields: `name`,
  `category`, `amount` (one charge), `currency` (PLN / EUR / USD), `rate` (zł per unit, editable, „NBP”
  button), `cadence` (`monthly` / `yearly` / `custom` + `everyMonths`), `startDate` (first charge), `endDate?`,
  `notes?`. The schema is passthrough with soft delete. Currency, cadence and category are strings with known
  keys, so a value from a newer build stays in the file. Such a subscription is flagged and not counted,
  rather than counted wrong. Added to `SCHEMAS` in `scripts/data.mts`.
- **Months derived on read** (`lib/subscriptions.ts`, pure). `effectiveFixedCosts` / `fixedCostsInYear` return
  the manual costs plus the derived charges, and Finance passes them to `summarizeMoney` / `moneyTrend`.
  Tiles, trend, result, „co jeśli” and the month list all use it. Nothing derived is ever stored.
- **Decision C.** A correction is a normal fixed cost with `subscriptionId` + `month`, and it replaces the
  derived charge of that month. Removing it („auto”, soft delete) brings the derived charge back. There is
  no flag for „skipped”: a skipped month is a 0 zł correction.
- **Categories** (`lib/fixed-cost-categories.ts`): ZUS, Marketing, Oprogramowanie, Bank, Księgowość / biuro,
  Telefon i internet, Ubezpieczenia, Inne. They are stored as an optional `category` next to the unchanged
  `type` enum (`.catch('other')`). New categories write `type: 'other'`, so an old build counts them under
  „Inne”. No version bump. „Sprzęt” is left to S4, because gear comes from the catalogue.
- **Fixed costs** gain optional `category`, `subscriptionId` and `deletedAt`. Deleting is soft everywhere,
  with Cofnij. The hard `deleteFixedCost` is gone. Breakdowns skip deleted entries and add `byCategory`,
  `subscriptions` and `derived`. Marketing ignores deleted readings: re-entering a cleared month creates a new
  record instead of reviving the deleted one.
- **The tab.**
  - Subscriptions at the top. Columns: per month (a yearly charge / 12), per year, the actual amount in the
    selected year, and a „co jeśli” switch. Totals exclude ended subscriptions.
  - „Co jeśli” removes the subscription's charges and corrections from the selected year. It shows the
    fixed costs and Wynik firmy before and after, and saves nothing.
  - The form warns about manual entries that may be the same payment (same category, or the name in the
    description) and offers „Zacznij raty od <month after them>”.
  - A new amount or cadence on a subscription with past months asks „od <bieżący miesiąc>” (the default:
    past uncorrected months are saved as corrections at the old price) or „we wszystkich miesiącach” (the
    old price was a typo).
  - Below it, every month of the period, with three kinds of rows:
    - „auto” / „plan”: clicking the amount saves a correction; „Pomiń” saves 0 zł.
    - corrections: „poprawiona” / „pominięta” / „dopłata”, the amount editable, „auto” to restore.
    - manual costs: category, description and amount editable in place, × with Cofnij.
  - Each month has a quick-entry row („+”, Enter saves and stays open). „Powtarzaj co miesiąc do” is gone:
    a monthly repeat is now a subscription. `repeatMonthly` / `monthRange` stay in lib.

**Real-life cases, as built** (each has a test in `subscriptions.test.ts`):

| Case | What Finance counts |
|---|---|
| Monthly fee from day X | one charge a month from the start, on the same day (31st → last day of the month) |
| Yearly licence | the full amount in its payment month (cash view); the table also shows /12 per month |
| Every N months (insurance) | every N months from the start |
| EUR / USD | amount × the subscription's rate; no rate → not counted, „brak kursu — nie liczy się” |
| A month paid differently (amount, FX) | the correction, instead of the derived charge |
| Skipped / paused month | a 0 zł correction („pominięta”) |
| Correction removed („auto”) | the derived charge again; Cofnij restores the correction |
| Two corrections in one month | both (they are facts), no derived charge |
| Extra payment outside a charge month | counts as itself; the regular charge stays |
| Ended (`endDate`) | no charges whose day is after the end; corrections stay |
| Deleted | no derived charges; corrections stay as plain costs („usunięta subskrypcja”); Cofnij |
| New price from now on | past uncorrected months saved at the old price; the new price from the current month |
| Typo in the price | „we wszystkich miesiącach”: every derived month changes |
| Category changed | corrections follow the subscription's category on read |
| Manual entry overlaps a new subscription | form warning plus „Zacznij raty od …” |
| Future months of the selected year | counted (a forecast); the tile says „plan na kolejne miesiące” |

**Tests:**
- New: `subscriptions.test.ts` (26), `fixed-cost-categories.test.ts` (6), `subscriptions-store.test.ts` (4),
  plus 1 each in `finance-calc` and `marketing-calc`. 492 in total (454 before).
- 32 deliberate mutations across `subscriptions`, `fixed-cost-categories`, `finance-calc`, `marketing-calc`
  and both stores. 28 were caught at first. The four survivors (two redundant guards, short-name matching, a
  raw start date that skips the schema) now have tests: 32 / 32 caught.

**Verified in the browser preview.** The seed was the real `finances.json` with both patches below applied,
plus 3 synthetic projects and the 2 real campaigns. Storage was restored byte for byte afterwards.
- Year and Q4 numbers checked by hand: Q4 2,960.04 + 1,803.14 + 2,258.24 = 7,021.42 zł; result 6,735 − 7,021.
- The correction replaces the auto row; „Pomiń”; „auto” plus Cofnij.
- Quick entry: two rows with Enter; in-place edits; delete plus Cofnij.
- Subscription form: double-count warning and „Zacznij od listopada”; „nowa cena od października” saved
  July–September at the old price; deleting and restoring a subscription.
- The NBP rate (EUR 4.3806, 13.10) and EUR counting.
- „Co jeśli” on ZUS: −4,251 zł.
- Marketing: clearing a reading, then entering a new one.
- Phone width (375 px) without horizontal scroll; no console errors.

**Switch-over (prepared, not applied — M.J. decides).** Both patches are in `imports/` and dry-run cleanly
against the real hub folder (`npm run data -- apply <file> --dry-run`).
- `imports/2026-10-13-s1-subscriptions.json` (adds `subscriptions.json` only; `finances.json` untouched):
  - ZUS 1,417.14 zł a month from 20.10.2026 (the Feb, Apr, Jun and Aug amount; odd months were 1,312–1,358);
  - FPD 455.10 zł a month from 01.10;
  - Opłaty bankowe 10.30 zł a month from 01.10;
  - Artlist 2,611.51 zł a year from 01.06.2027, because June 2026 is already a manual entry.
- `imports/2026-10-13-s1-categories.json`: `category` on 25 old entries (Oprogramowanie → software, Opłaty
  bankowe → bank, FPD → office), `ifMissing`. Amounts, months and `type` are unchanged; only the split by
  category changes.
- Effect on the real data, applied to a scratch copy and recomputed with the app's functions:
  - January–September are unchanged to the grosz.
  - October–December gain 1,882.54 zł a month.
  - 2026 fixed costs go from 43,817.25 to 49,464.87 zł (+5,647.62).
  - The 2026 result goes from 38,756.86 to 33,109.24 zł.
  - Revenue (167,813.23) and project profit are unchanged.
- An alternative to discuss, not prepared: also link the past months as corrections, so each subscription
  shows its history and „co jeśli” covers the whole year. That touches about 40 records and needs 0 zł
  corrections for the gaps (Feb FPD, „FPD (dwa miesiące)” in March, September).

**Open for M.J.:**
1. Apply the two patches as they are? (Recommended: yes. Past months stay as they are.)
2. September has no ZUS and no FPD entry, because the data stops at 20.09. Were they paid? If yes, start those
   two in September (+1,872.24 zł) or type them by hand.
3. What is FPD? It is set as „Księgowość / biuro”.
4. Was the June 2,611.51 zł Artlist alone? If yes, linking that entry (one `update`) is cleaner than starting
   in 2027.
5. Which tools make up the rest of „Oprogramowanie” (98–1,129 zł a month)? Add them in the new tab from
   October (the form warns about overlaps), or send the list for a patch.
6. Future months of the current year now count in the year's fixed costs and result (forecast, shown as
   „plan na kolejne miesiące”). Keep it that way, or count only up to the current month?

**Desktop-app checks (cannot be proven in the browser):**
- The first save creates `subscriptions.json` in AppData.
- The „NBP” button inside the app (CSP is null; the PDF uses the same API).
- Clearing and re-entering a Marketing reading.
- After installing, don't open an older build: it would count soft-deleted costs and ignore derived months.

**Known limits / next:**
- Yearly charges are cash-view only. S4's „Rozłóż duże zakupy” toggle could spread them later.
- No price history field: „od teraz” stores the past months as corrections, so they show „poprawiona”.
- A pause over several months means skipping each month.
- „Co jeśli” is per year and resets when you leave the tab.
- The mobile top nav icons have no `aria-label` (existed before S1).
- `nbp-fx.ts` gained `fetchNbpMidRate` at the end of the file. S3 may touch the same file, which is a
  trivial merge.

## 6. S2 as built

*(2026-10-13, branch `claude/grupy-role-hub-8145ba` on top of `90e913a`; merged and installed the same day.)*

### Data (additive, passthrough, no version bump)

- `CrewMember.roleRates?: { roleId, rate, note? }[]` — lenient list (a bad entry is dropped, a missing field
  stays missing), rate 0 = unknown. `CrewMember.mergedInto?` on a duplicate soft-deleted by „Scal osoby".
- `client-groups.json` (`createCollectionStore`, web key `nonoise-client-groups-v1`, in `SCHEMAS` of
  `npm run data`): `{ id, name, members: clientKey[], createdAt, updatedAt, deletedAt? }`. Members are compared
  through `clientKey`, so a typed name also matches. Dissolving is soft (`deletedAt`) with „Cofnij".
- Nothing else is stored: revenue, group stats and „poza grupą" are derived.

### One person, several roles (3.3)

My cost when a person is picked, everywhere (quote lines, „zaktualizuj stawki", kits in the quote and in
Realizacja, Realizacja rows): **rate for that role → person.rate → role.costRate → role.clientRate**
(`crewCostRate`, `personRateFor`). The client price stays the role's (decision 7).

| Realizacja crew row | Picking a person from Ekipa |
|---|---|
| role X, person has a rate for X | that rate |
| role X, no rate for X, person has a day rate | the day rate |
| role X, person has no rates, row empty | role X's cost (else its client rate) |
| role X, person has no rates, amount typed | the amount stays |
| no role, person has roles | their first role, rate as above |
| role not in Ekipa („Operator B") | person's day rate, else unchanged |
| role changed to another Ekipa role on a linked row | the person's rate in the new role (full chain) |
| same role, other spelling / free-text person | amount unchanged |

- Pickers show each person's rate for the line's role; a linked row suggests the person's roles first.
- Ekipa person sheet: an own rate and note per role (placeholder = what counts instead), the day rate is
  „dla ról bez własnej stawki". Stats per role: days, pay, average day rate. The list shows „+ N stawki w rolach".

### „Scal osoby"

Ekipa › „Scal osoby" (or „Scal z…" on a person): suggestions by first name (Łukasz ×N), tick the cards, pick
who stays (default: most days, then projects, then oldest), preview the merged card and what gets rewired,
confirm. Writes, in this order, each one queued write on fresh data: projects (`updateProjects` →
`patchProjects`), kits (`updateGearKits`), the quote open in the calculator (so a later „Zapisz" doesn't bring
the duplicate back), then people.

- Rewired: `Project.costs[].personId` (also soft-deleted rows, and rows **without** `personId` that matched a
  duplicate by name — otherwise they would drop to „spoza bazy"), crew lines in `Project.quote` snapshots
  (`ShootingDay.crew`), `GearKit.crew` (same role + person after the merge = one entry; other fields kept).
  Call sheets point at cost rows (`costId`), not people — nothing to rewrite.
- Frozen names (`person`, `personName`) stay as typed. The kept card gets the union of roles and role rates;
  empty fields (rate, phone, e-mail, city) are filled from the first duplicate that has them; a rate that
  doesn't fit („stawka 1 500 zł", a clashing role rate) goes to the notes with „Scalono z „…" (date)".
- Duplicates: `deletedAt` + `mergedInto`. `crewMemberById` follows `mergedInto`, so stats, call-sheet contacts
  and the Realizacja crew row still find the kept person when an older copy writes a stale id (deleted projects
  are not rewritten; they resolve this way after a restore).
- „Cofnij" (notice on the Ekipa list) restores each reference, kit and card exactly, but only where nothing
  changed since (the row still points at the kept person, the kit still has the merged crew, the card was not
  edited).

### Client groups (3.4, decision D)

- A client is in at most one group: adding moves it. `lib/client-groups.ts` is the shared lookup for S4/S5:
  a client filter value is a client key **or** `grupa:<id>` — `clientScope`, `scopeKeys`, `inClientScope`,
  `clientScopeOf` (the bucket a project counts under in per-client tables), `groupDirectory` (picker entries).
- Klienci list: a group is one row (numbers over all members) with its members inside, each opening its own
  page; search finds a group by its name or a member; tiles count a group as one client.
- Group page: the client stats over all members (revenue and share, profit, win rate, return rhythm and last
  job, size bars, payments, first contact, crew on the jobs, projects with each one's spelling), members with
  their own numbers (✕ removes), „Dodaj klienta do grupy", similar names outside the group, rename, dissolve
  with „Cofnij". A member without projects stays listed („brak projektów").
- Client page: „W grupie …" with a link and „Wyjmij z grupy"; „Dodaj do grupy klientów…" (existing or new).
- **„Poza grupą"**: a client outside every group whose name looks like a member (`looksLikeSameClient`, the
  „Scal nazwy" hint: a shared meaningful word or one name starting the other) shows a banner with „Dodaj do
  grupy". A new spelling with nothing in common (e.g. a full legal name) is not caught.
- „Scal nazwy" keeps memberships in step:

| Merge | Group membership afterwards |
|---|---|
| spellings of a member → a new spelling | the group holds the new key in the member's place |
| an outside client → a member's name | unchanged (the member is already in the group) |
| a member → an outside client's name | the group holds the new key |
| members of two groups | the result stays where the target already was; else the first group of the merged clients (page first); the other group loses them |
| „Cofnij" | each group's previous members, where untouched since |

- Projekty: groups are in the client picker (found by member names, labelled „grupa"); the banner names the
  members; the choice is remembered as `grupa:<id>` (an unknown/dissolved group shows everyone).

### T6 glue (Klienci revenue and the Projekty filter)

Klienci (list, tiles, client and group pages: revenue, share, years, profit, margin, size bars, project amounts)
and the Projekty client banner read the money loop's best-known numbers (`projectMoney`): invoices when complete,
else plan + extras; a year = the revenue pieces dated in it (invoice date), so an extra invoiced in January
counts there. Profit = best-known revenue − tax − costs (Realizacja when entered). „Bez kwoty" = a job with
neither plan nor invoice. `lib/client-money.ts` takes only types from `money-loop` (which imports
`client-stats`); the ledger is built once per screen (`useProjectMoney`). Without it the plan is used, which is
exactly what the loop gives a project without invoices — the old tests pass unchanged.

### Code and tests

- Pure: `crew-types.ts` (roleRates, `personRateFor`, `normalizeRoleRates`, `rolesForPerson`, `crewMemberById`),
  `crew-rates.ts` (Realizacja rows), `crew-merge.ts`, `quote-crew.ts` (`crewCostRate` takes the role id — small),
  `crew-stats.ts` (per-role stats, merged ids), `client-groups.ts`, `client-money.ts`, `client-stats.ts`
  (stats over a set of keys, `groupStats`, `clientListRows`), `clients.ts` (`scopeRevenue`), `project-list.ts`.
  Store/hooks: `client-groups-store.ts`, `use-client-groups.ts`, `use-project-money.ts`.
- UI: `components/crew/` (person sheet, `crew-merge-sheet.tsx`, section), `components/realization/` (picker,
  role field), `produkcja-crew.tsx` (rate labels only), `components/clients/` (`client-groups-panel.tsx`, list,
  page), `components/projects/` (filter, picker).
- 496 tests (+42): `crew-rates`, `crew-merge`, `client-groups`, `client-groups-store` (web path), money-loop and
  group cases in `client-stats`, group filter in `project-list`, per-role stats, merged person on a call sheet.
  Deliberate mutations: 62 across the pure modules, 61 caught; the survivor is equivalent (an unknown
  `grupa:<id>` cannot equal a client key). `npm run data -- apply` accepts a minimal group and a crew record
  with `roleRates`, and refuses a group with a bad member. Typecheck clean apart from the known legacy
  `quote-pdf-document.tsx`. The static export was **not** built in this session (main session).
- Verified in the browser preview on seeded localStorage (restored byte for byte afterwards): list with a group
  row, group page numbers checked by hand (profit after Realizacja costs, year share, payment median), „poza
  grupą" → „Dodaj do grupy", „Scal nazwy" of a member into a new spelling and „Cofnij", creating „PHH + PHN +
  Interferie" from a client page and adding members by search, dissolve + „Cofnij", Projekty filter by group
  and best-known revenue for a year, role rates on the person sheet, Realizacja pick and role change, the
  quote's person select, „Scal osoby" with preview, „Cofnij", and a merge from „Scal z…" while the quote was
  open in the calculator; phone width without horizontal scroll; no console errors.

### Real data (read-only, 13.10.2026)

- Spellings: „CIONET", „DE Group Sp. z o.o.", „Polski Holding Hotelowy Sp. z o.o.", „PHN Property Management
  Sp. z o.o.", „Interferie S.A.". Patch for the main session (dry run accepted: +2 in `client-groups.json`):
  ids `cg-cionet-de-group` (`cionet`, `de group sp. z o.o.`) and `cg-phh-phn-interferie`
  (`polski holding hotelowy sp. z o.o.`, `phn property management sp. z o.o.`, `interferie s.a.`).
- With the groups: CIONET + DE Group 23,020 zł (6 projects, 5 jobs, 3 from invoices, median 23 days to pay),
  PHH + PHN + Interferie 7,018 zł (5 jobs, all from invoices, one invoice open). No names „poza grupą".
- The money loop changes no client's revenue today (every invoice equals its plan; 167,813 zł either way).
- Ekipa has Łukasz **twice** („op bez sprzętu" 1,200, „ze sprzętem" 1,500, same three roles), no cost rows,
  kits or quote lines yet — merging is safe at any time. The difference is gear, not role: recommended model is
  one Łukasz at 1,200 plus a role „Operator z własnym sprzętem" (own client rate) where he has 1,500; „Scal z…"
  keeps the 1,500 in the notes so nothing is lost. Open question for M.J.

### Check in the desktop app

1. `client-groups.json` is created on the first group change and survives a restart; `npm run data` patch
   above applies with the hub closed.
2. „Scal osoby" with real data: `crew.json`, `projects.json` and `gear-kits.json` written once each; „Cofnij".
3. The open quote after a merge: „Zapisz" keeps the kept person.
4. Window focus reload while the Klienci group page is open (groups reload on focus).

### Known limits / follow-ups

- „Cofnij" for both merges lives in the notice until you leave the screen (as elsewhere).
- Groups in Finance and the report are S4/S5 (`clientScope` / `clientScopeOf` are ready).
- The old quote library (`quotes.json`, one S-AI record, not written by the hub) is not rewritten by „Scal osoby".
- One rate per role; „with / without gear" for the same role would need several rates per role (see above).
- The phone top-bar section icons have no accessible names (pre-existing).

## 7. S3 as built *(2026-10-13, branch `claude/s3-currency-pdf-export-18e90b`)*

**Audit first (shown to M.J. before building).** Every money display was listed: header total and tab chips,
price-list prices in every tab, quick-mode totals, day totals, G5 gear and T9b crew lines, Dodatkowe (fuel,
catering, lodging, actor fee, revisions, overtime), the plan (old Profit), Realizacja, project list, Finance, the
PDF tab and the printed PDF. The calculator was all zł; EUR existed only on the PDF. Mixed or glitchy spots found:
- terms in EUR PDFs printed PLN amounts with „zł"/„PLN" baked into the templates (the one real EUR-on-PDF quote in
  the hub, Tchibo, prints „150 PLN net" next to € amounts);
- the actor-fee line always said „zł"/„PLN"; descriptions written before a flip kept the old currency;
- the English PDF printed amounts in „zł" but its terms in „PLN";
- flipping PLN → EUR → PLN rounded twice, and a rate change after a flip, raised a false „Ceny w PDF różnią się"
  warning, whose text showed EUR numbers with „zł";
- without an NBP fetch the rate silently stayed 4.30;
- nothing outside the PDF could show the EUR total. Tchibo: the PDF says 1,460 € (rows edited by hand), the
  calculator 5,600 zł (1,281 €), Finance 5,600 zł;
- net-first (#9) was already in the hub since 18.08 (`9b755df`); the old QuoteGen still makes gross the big
  orange number, so the PDF in note #9 most likely came from the old app.

**Decided with M.J. (2026-10-13):** converted price-list values round to **whole euros**; labels **„zł" in
Polish, „PLN" in English, „€" in both**; **my costs stay in zł** in the calculator and the plan.

**Data (additive, no version bump; old quotes have none of it and read as PLN):**
- `QuoteData.currency?: 'PLN' | 'EUR'`, `exchangeRate?` (zł per 1 €), `exchangeRateDate?` (NBP table day),
  `exchangeRateSource?: 'nbp' | 'manual'`, `currencySwitchMemo?` (typed amounts before/after the last switch).
- `LocalPdfState.followsQuote?`: drafts built since S3; a draft without it is the old EUR-on-PDF mode.

**Where amounts live** (`lib/quote-currency.ts`):

| Amount | Stored in | In an EUR quote |
|---|---|---|
| Price list (incl. formats), catalogue gear rate on the line, crew role rate on the line | PLN, always | shown and computed as zł ÷ rate, **whole euros**; a price typed in € is saved as € × rate (whole euros come back exactly) |
| Typed in the quote: day adjustment, rental amount, actor fee, catering and lodging rate, revision and overtime price | the quote's currency | € as typed; a rate change does not move them |
| My costs: person rate, role cost, plan overrides and own items, transfer amount, fuel price | PLN, always | zł; fuel passes to the client price at the exact rate |
| Financials (`sumaNetto`, costs, tax, profit), plan, gear revenue | PLN | revenue = quote total × frozen rate; costs from the PLN view (typed € amounts × rate) |

**Real-life cases → behaviour** (each has a test):

| Case | What happens |
|---|---|
| Old PLN quote (any shape) | identical numbers and PDF — both views are the same objects (`quote-currency-legacy.test.ts`) |
| Old EUR-on-PDF quote (Tchibo) | stays a PLN quote; the PDF prints exactly as before; banner: „Przełącz wycenę na EUR po kursie 4,3699" or „Wróć do PLN na PDF" |
| PLN → EUR | rate from NBP (today's table fetched on open, any day selectable) or typed; typed amounts convert once to whole euros |
| EUR → PLN | typed amounts × rate to whole złoty; **unedited ones come back exactly** (150 zł → 34 € → 150 zł) |
| Rate changed in EUR | price-list, gear and role prices follow; typed € amounts stay; the PDF warns if its prices now differ |
| Currency switched with a PDF draft | row prices from the calculator in the new currency; hand-edited prices converted at the rate; hand-edited descriptions kept; a notice says so |
| EUR quote saved | financials in zł (Tchibo-like quick quote at 4,3699: 1,852.50 € → 8,095.24 zł; costs 5,100 zł as in PLN) |
| Transfer amount set in the plan | it is zł and replaces total × rate, as in PLN |

**Screens:**
- Calculator header: PLN | EUR switch next to the margin slider; in EUR „kurs 4,3806 · NBP z 13.10.2026" (click to
  change the rate) and „≈ 14 199 zł" under the total. The panel explains what converts. The digit roll no longer
  eats the space before „zł"/„€", and a currency switch does not flash a delta.
- All tabs show prices in the quote currency (InlinePrice through `lib/price-display.tsx`); crew lines show „421 €/dzień
  · mój koszt 1200 zł"; Dodatkowe labels say „(€)"; fuel stays „zł/l" with „≈ 0,12 €/km".
- Plan (Realizacja): all zł, plus „Wycena w EUR: 1 852,50 € × kurs 4,3699 = 8 095,24 zł".
- Price list dialog stays in zł and says so in an EUR quote.
- PDF tab: the same currency switch (the old „Waluta PDF" toggle, rate field and NBP button are gone, except
  through the legacy banner); row inputs show their unit; the stale-price warning uses the PDF currency.
- PDF and preview: net leads; VAT and gross are a quiet line (normal weight, muted, smaller).

**Code:** `lib/quote-currency.ts` (rules, views, switch, memo, labels), `lib/quote-financials.ts` (`quoteViews`,
`quotePlnPlan`, `buildQuoteBreakdown`), `lib/pdf-draft.ts` (PDF draft moved out of the tab: build, coerce,
`reconcilePdfCurrency`, `isLegacyEurDraft`), `lib/pdf-texts-config.ts` (`buildTermsAndConditions` with money),
`lib/pdf-currency.ts`, `lib/nbp-fx.ts` (chosen day), `lib/price-display.tsx`, `components/quote-currency-control.tsx`;
the context exposes `money`, `clientData`, `clientPricing`, `costData`, `sumaNettoPln`, `breakdownPln`,
`formatPln`, `setQuoteCurrency`, `setExchangeRate`. `produkcja-crew.tsx` changed for display only (S2 also edits it).

**Tests:** 487 (454 before): `quote-currency-legacy.test.ts` (golden, 4 fixtures: old-app v2 snapshot, hub quote
with G5 gear and T9b crew, quick quote, old EUR-on-PDF quote — financials, totals, PDF split, plan lines and plan,
planned crew, gear revenue, PDF rows and descriptions PL/EN, terms, restored legacy rows and their calculator
reference; values from the code before S3; one deliberate change: the English PDF in PLN now says „PLN" in the
gear-value sentence too), `quote-currency.test.ts` (17), `pdf-draft.test.ts` (9), `nbp-fx.test.ts` (3).
49 deliberate mutations, 47 caught; 2 are equivalent today (the memo direction guard, which only matters with a
third currency; planned crew reading the client view, whose crew cost rates equal the PLN view).

**Verified** on the production export (`npm run build`, served by `scripts/serve-export.mjs`, launch config
„export") in the browser on seeded localStorage: a hub quote with gear, crew, rental, discount, catering, actor fee
and day adjustment (14,199 zł → EUR at NBP 4.3806 = 3,241 €, every tab, crew and gear lines, day total and PDF rows
checked by hand; terms 34 € / 46 €; no „zł" in the EUR PDF; back to PLN with a hand-edited row: notice, row
converted, and after the memo fix exactly 14,199 zł again); the Tchibo-shaped old quote (prints 150/630/260/420 =
1,460 €, banner, switch to EUR keeps the rows, saved financials 8,095.24 zł, plan all zł); NBP fetch for today;
no console errors besides the missing Vercel analytics script. The hub data folder was only read.

**Desktop-only checks for the main session** (Tauri app):
1. „Pobierz z NBP" in the currency panel works in WKWebView (new range URL on the same host as before).
2. „Pobierz PDF" for an EUR quote: native save dialog, file written, „€" renders in Archivo / JetBrains Mono in the
   html2canvas capture, page cuts still at row boundaries, quiet VAT/gross line legible.
3. The date field and the popover in the sticky header (z-index, focus) in the app window.
4. On the real data: Tchibo opens with the legacy banner and prints as before; nothing changes unless a banner
   button is clicked.
5. After merging S2: crew lines in an EUR quote still show the client rate in € and „mój koszt" in zł.

**Known limits / next:**
- Free text is not converted („500PLN netto" typed in Opcje dodatkowe stays as typed).
- Invoices stay in zł in the money loop: an EUR job's plan is total × frozen rate until an invoice (in zł) replaces
  it; FX differences show as Δ. Invoice amounts in EUR are not modelled.
- The kit and role databases stay in zł (new-role form „zł / dzień"); only the quote converts.
- Rate edits do not rewrite descriptions already in a draft (as with any calculator change since T9b); the stale
  warning shows when prices differ.
- The calculator's tab strip overflows by a few pixels below ~900 px (existed before S3).

## 8. Q1 as built

*(not built yet — Q1 writes here)*
