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

**Applied 2026-10-16 with M.J.'s answers** (`imports/2026-10-13-s1-subscriptions.json` as edited, plus the
categories patch): ZUS from 20.09 and FPD (biuro rachunkowe) from 01.09 — both paid in September; Artlist yearly
from 06.2026 with the June 2,611.51 zł entry linked as its charge; Frame.io Pro $15 from 13.10 (Stripe receipt,
NBP 3.8827); Google Workspace Business Standard from 07.10 at an ESTIMATED 60 zł (amount only in Google's PDF
invoice); Frameset from 10.2026 at 0 zł (no receipts in the nonoise.media mailbox — to fill in); future months
count as forecast. Real data after: 2026 fixed costs 51,692 zł, result 31,131 zł (revenue 179,538 zł).

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

*(2026-10-16, branch `claude/quote-as-project-document-c51b97`, on top of `v3/project-hub` `03c6aa0`)*

**Step 0 (own commit).** Deleted `components/pdf/quote-pdf-document.tsx` (the only type error, unused) and
`components/ui/sidebar.tsx` (unused); `typescript.ignoreBuildErrors: false`. `next build` type-checks again and passes.

**Audit (shown to M.J. first).** The calculator was one global `QuoteProvider` (data, margin, price list, templates, a
library state, a PDF-draft bridge), autosaved to `settings.json` / `nonoise-app-state-v1`, with the price list in the
global `quote-gen-pricing-config` (overwritten by every loaded quote) and the PDF draft in the global
`nonoise-pdf-draft`. `openProject`, `createBlankProject` and `changeActiveClient` replaced that state; the sidebar
„Projekty" closed the project; „Zapisz" (project header) and „Zapisz wycenę" / „Moje wyceny" (sticky header) saved to
two different places. Real data (read-only): `settings.json` held exactly the Morris & Lloyd project's quote (nothing
unsaved lost by dropping it); in the hub's `quotes.json` the S-AI copy equals the S-AI project, but **the Morris Lloyd
copy is a „wariant 2 dni" PDF** (postprodukcja 5,500 vs 6,600, sprzęt 1,200 vs 600, ekipa „2 dni" vs „1 dzień";
calculator data identical except the name) — effectively variant B for Q2. All 9 quotes of the old QuoteGen are
already projects. M.J. has a saved default price list and no templates.

**Decided with M.J. (2026-10-16):** the model below with every case in the table; templates retired; the old-QuoteGen
import stays as a button in Ustawienia (reads only the old app's file); JSON export and import stay as actions of the
project's quote.

**Model.** Each project's quote is its own document `{ data, pricingConfig, marginMultiplier, pdfDraft }` stored in
`Project.quote` (the same QuoteSnapshot v2 shape as before; unknown snapshot fields pass through). An in-memory store
in the hub (`lib/quote-documents.ts`, pure, injectable timers and writer) holds the documents being edited:
- `Project.quote` is the source of truth; a document without pending changes always mirrors it (a change from outside,
  e.g. „Scal osoby", gives a new document and a new `epoch`); pending changes win until saved;
- saves itself ~0.6 s after the last change, immediately when you open another project, close the project, leave the
  Projekty section, when the window loses focus / hides, and before the desktop window closes (`onCloseRequested`,
  waits at most 3 s); each save recomputes `financials` (`planProjectSave`, unchanged rules) and patches only
  `quote`, `financials`, `client` on the latest project;
- „silent" changes (automatic PDF-draft fixes) do not trigger a save; they ride along with the next real change;
- `useQuote()` keeps its surface (minus library, templates, `loadQuoteSnapshot`, `isCalculating`) bound to the open
  project's document, so the 700-line tabs did not change; without an open project it shows an empty quote with the
  default price list and ignores edits.

**Data.** No schema change. New only inside the draft: `pdfDraft.uwagiManualText` (the hand-typed „Uwagi", lost on
leaving the tab before Q1). Nothing writes `settings.json`, `nonoise-app-state-v1`, `nonoise-pdf-draft`,
`quote-gen-pricing-config` or the hub's `quotes.json` any more; the files and keys stay where they are, untouched.
`src-tauri/capabilities/default.json` gains `core:window:allow-destroy` (the close listener holds the close until the
save finishes, then destroys the window).

**Real-life cases, as built** (tests in `quote-documents.test.ts` unless noted):

| Case | Behaviour |
|---|---|
| Edit A → Kalendarz → back to A | saved on its own; sidebar „Projekty" from another screen returns to A on the same tab and calculator sub-tab (remembered per project until the app closes); a second click shows the list |
| Edit A → open B, edit → back to A | A is saved when B opens; each project has its own data, price list, margin and PDF (test „brak przecieków", „A → B → A") |
| Quit mid-edit → reopen | saved on close / hide / blur; reopens from `projects.json` (test „restart", web path; verified in the export by reloading inside the 0.6 s window) |
| „Nowy projekt" | empty quote, my saved default price list (factory without one), margin 0 %; nothing written until the first real edit |
| Lead without a quote | empty quote with the project's client, follows a client change in the header; the first real edit (also a hand edit in the PDF) creates the quote (`project-save.test.ts`) |
| Retro project with imported financials | the first real edit asks „Ten projekt ma finanse z importu (X zł). Zastąpić je wyceną z kalkulatora (Y zł)?" — „Zastąp" saves; „Cofnij zmiany" drops the edits; until answered the edits stay in memory, nothing is written |
| EUR quote | currency, rate, NBP day are part of the document; financials in zł as in S3 (golden tests unchanged) |
| PDF edits | stored in the project's `pdfDraft`; a PDF never edited follows the calculator and stores nothing; viewing writes nothing |
| Two projects, different price lists | each quote keeps its own; price edits (inline or „Edytuj stawki") change only the open quote; „Zapisz stawki jako domyślne" sets new quotes and „Wyczyść" |
| ↺ „Wyzeruj" / ⌫ „Wyczyść" | this project only, two clicks; ⌫ also resets the price list to my default; client name, project name and PDF draft stay; „Cofnij zmiany z tej sesji" restores the quote and financials from when the project was first opened this session (two clicks; also undoes accidental edits now that saving is automatic) |
| Realizacja plan | reads the live document; edits save on their own; the „zmieniony — kliknij Zapisz" chip is gone |
| Ekipa „Scal osoby" | saves pending quotes first, then patches the latest projects; quotes waiting for the import question are retargeted in memory (and back on „Cofnij") |
| Old quote | loads through `resolveSnapshot` exactly like `computeSnapshotFinancials`; re-saved it computes identically (test with an old-app v2 snapshot, a snapshot without price list, an EUR quote, an unknown field) |
| JSON export / import | Ustawienia wyceny: „Eksportuj wycenę do pliku" (same snapshot shape), „Wczytaj wycenę z pliku do tego projektu" (replaces this quote; undo = „Cofnij zmiany z tej sesji"; a non-quote file changes nothing) |
| Templates | retired (none were saved) |
| `npm run data` while the hub is closed | no global state overrides it on start; documents come from `projects.json` |
| Save fails (disk) | header „Wycena niezapisana · Spróbuj ponownie"; edits stay in memory and the next change retries |

**Screens.** Project header: „Zapisz" replaced by „✓ Zapisano / Zapisywanie… / Wycena czeka na decyzję / Wycena
niezapisana", „Cofnij zmiany z tej sesji" and the import question. Sticky header: „Moje wyceny", „Zapisz wycenę" and
„Wersja robocza" removed; the pill shows the project's name; both resets need a second click. Projekty: migration banner
removed. Ustawienia: explanation plus „Stara aplikacja QuoteGen" — „Sprawdź starą aplikację" lists old-app quotes that
are not projects yet („Pomiń" per quote or all, „Przenieś do projektów", backup first); in the browser the web library
key stands in for the old app. Price-list dialog: „Przywróć domyślne" only fills the form (applied by its „Zapisz").

**Code.** New: `lib/quote-documents.ts`, `components/settings-section.tsx`. Rewritten: `lib/quote-context.tsx` (inside the
hub now: `ProjectHubProvider` → `QuoteProvider` → equipment, events, crew, inbox), `lib/project-hub-context.tsx`
(`quoteDocs`, flushes, `latestProjects`, `reloadProjects`, `useQuoteDocState`), PDF tab (draft from/to the document,
`docEpoch` remount), project and sticky headers, settings sheet, `quote-library.ts` (types and read-only libraries).
Deleted: `quote-library-sheet.tsx`, `calculating-overlay.tsx`, `persisted-state.ts`, the settings/template types and
`storage.ts` settings functions, `getPricingConfig` / `savePricingConfig` / `resetPricingToDefault`,
`canReprefillBlankQuote`, `isPlanUnsaved`, `mergeQuoteSources`. Pure modules (quote-calc, quote-financials, pdf-draft,
quote-currency, quote-crew, quote-gear) untouched; golden tests pass unchanged.

**Tests:** 585 (568 before): `quote-documents.test.ts` (18), `project-save.test.ts` +1 (PDF draft counts as work);
removed with their code: `canReprefillBlankQuote`, `mergeQuoteSources`; the plan test no longer checks „unsaved". 23
deliberate mutations of the store and save rules, 23 caught (two survived at first — `forget`, a „kept" save left
dirty — and got assertions).

**Real data (read-only script, `projects.json` hash and mtime unchanged):** all 11 saved quotes loaded and re-saved
through the store give identical financials (sumaNetto, costs, tax, profit, margin) and equal the stored ones; all 13
quote-less projects with imported financials ask before anything is written; all 11 quote-less leads get a quote on
the first real edit.

**Verified** on the production export (`npm run build`, „export" launch config) with seeded localStorage (restored
afterwards): two quoted projects with different price lists (PLN, margin +10 %; EUR at 4.30), a lead, a retro project,
and stale old global keys. Checked: A edited → Kalendarz → „Projekty" back on A's tab and sub-tab; PDF edits in A
(Termin, „Uwagi") not visible in B, back in A after B was edited; reload inside the debounce window kept the edit; a
restart brings back the PDF and margin; viewing a PDF writes nothing; lead and „Nowy projekt" start with the default
price list and write nothing; retro question, „Cofnij zmiany", „Zastąp", „Cofnij zmiany z tej sesji" (2,000 zł back);
„Wyczyść" + undo restores 8,250 zł; a plan edit in Realizacja saves and recomputes financials; the Ustawienia import
(one skipped, one imported, backup key); old global keys never written; no console errors besides the missing Vercel
analytics script.

**Desktop-only checks for the main session** (Tauri app, real data):
1. Close the window (red button / Cmd+W) right after an edit: the window closes (needs `core:window:allow-destroy`) and
   the edit is in `projects.json` after restart. If the window refuses to close, the permission is missing.
2. Cmd+Q right after typing (within ~0.6 s): macOS quit may skip the close listener; check whether the last edit
   survives (blur usually saves first). If not, a Rust `ExitRequested` hook is the follow-up.
3. Restart persistence on real projects: open Morris & Lloyd, change a PDF text, switch to S-AI, quit, reopen — both
   as left; Finance and the project list show recomputed numbers.
4. „Pobierz PDF" from a project's PDF tab: native dialog, file written, content of THAT project (and the draft
   restored after a restart).
5. Ustawienia → „Sprawdź starą aplikację" reads `com.michal.quotegen/quotes.json` (expect „Wszystkie wyceny ze starej
   aplikacji są już projektami."); the hub's own `quotes.json` (S-AI, Morris Lloyd „wariant 2 dni") is not offered.
6. JSON export (native save dialog) and „Wczytaj wycenę z pliku" in the app window.
7. Retro project (e.g. „YoPro"): one edit → question → „Cofnij zmiany"; nothing changes in Finance.

**For Q2 (variants A/B/C):**
- Keep `Project.quote` as the **chosen** variant: every reader (financials, Realizacja plan, money loop, clients,
  reports, gear and crew stats, `npm run data`) keeps working unchanged. Put the other variants in an additive
  `Project.quoteVariants?: { id, label, snapshot, createdAt, updatedAt, deletedAt? }[]` and name the chosen one with
  e.g. `Project.quoteLabel?`; choosing B swaps snapshots and recomputes `financials` (variants never count money).
- The store is keyed by a document id (today the project id = the chosen variant). Give each variant its own key
  (e.g. `${projectId}#${variantId}`) and a writer that patches only `quoteVariants[i]` (no financials); the chosen
  variant keeps today's writer. `origin` / „Cofnij zmiany z tej sesji" is per document.
- `pdfDraft` lives in each variant's snapshot (each variant prints its own PDF). The Morris Lloyd „wariant 2 dni"
  copy in the hub's `quotes.json` can become variant B of „Morris & Lloyd — rolki, październik (Wisła)" with a
  one-off `npm run data` patch.
- The PDF tab remounts on `docEpoch`; switching variant should bump it (or key the calculator by document id).

**Known limits / next:**
- A retro edit waiting for the import question lives only in memory: quitting before answering loses it (by design:
  nothing replaces imported financials without a yes).
- „Cofnij zmiany z tej sesji" goes back to the first open in this app session, not to an arbitrary earlier version.
- `components/quote-pdf-document.tsx` (react-pdf, unused, no type error) is still in the tree.

## 10. Z1 as built *(2026-10-16, branch `claude/z1-zaplecze-equipment-fed32c`)*

„Zaplecze i drobiazgi" (§3.5): gear that never goes on set (laptop, magic arm, SD cards, cables) is tracked as a
cost but never shows up in a picker or a payoff number. Based on `origin/v3/project-hub` (b469106).

**Data.** `EquipmentItem.onSet?: false`, additive, no version bump. Missing = on set, so every existing item stays as
it is. Only `false` is stored: moving an item back to „Na plan" deletes the key, so the file looks like before Z1; any
other value (`true`, garbage) is dropped on read. `.passthrough()` kept.

**Filter at the source.** `lib/equipment-context.tsx` now exposes two lists:
- `items` = **on-set only**. Every consumer that reads `useEquipment().items` is excluded from zaplecze without being
  touched: the quote gear picker and kits (`produkcja-gear.tsx`, unedited), the Realizacja gear grid and packing lists
  (`project-realization.tsx`, `project-equipment.tsx`), the call sheet's packing list, and the payoff stats.
  A future reader gets the safe list by default.
- `allItems` = whole catalogue. Used by the Sprzęt screen, the item panel, the kits panel (labels) and the three
  calendar files that draw gear purchases (`calendar-section.tsx`, `event-form.tsx`, `project-timeline.tsx`; one-line
  switch each), because a purchase is a cost whichever kind it is.
- Belt and braces in the pure code (`lib/equipment-roi.ts`, `buildPackingList` and `applyKitToGearDay` in
  `lib/gear-usage.ts`): they ignore `onSet === false` even if someone hands them the full list. No calculator tab file
  was edited; `lib/quote-gear.ts` untouched (Q2).

**`lib/gear-backstage.ts`** (pure, `lib/gear-backstage.test.ts`, 17 tests):
- `isOnSet`, `onSetItems`, `backstageItems`, `withOnSet` (move between kinds, round-trips to the original record).
- `gearPurchases(items)` → `{ itemId, name, date, price, quantity, onSet, undated }[]` for the S4 ledger:
  `price` = purchase price × quantity; **all** items are listed (zaplecze, on-set and retired: selling does not undo
  the spend); `date` is `YYYY-MM-DD` or `null`, with `undated: true` so the ledger can show those for completion
  instead of dropping them; items without a price stay in with `price: 0`. Sorted by date, undated last, then name.
- `investedSplit(items)` → on-set / zaplecze / total plus counts of unpriced and undated zaplecze.
- `parseBackstageRows`, `parseMoney`, `parseDateText` for the paste box (below).

**Sprzęt screen.**
- Tabs „Na plan" / „Zaplecze i drobiazgi" (counts on the tabs).
- „Zainwestowane" tile: total, with „na plan" and „zaplecze" lines. The Odpracował / Zarobił / Nieużywane tiles and the
  kits panel belong to „Na plan"; on the zaplecze tab the tiles are zaplecze total and „Bez daty zakupu".
- Zaplecze tab (`components/equipment/backstage-panel.tsx`): one entry row (name, price per unit, date, qty, note).
  **Enter saves and stays in the row** (focus returns to the name; the date is kept, because purchases arrive in
  batches). „Wklej listę": one item per line, `name ; price ; date ; qty ; note`, separated by `;` or a tab (so cells
  pasted from a spreadsheet work); price accepts „9 500", „140,50 zł"; date accepts `2025-03-12` and `12.03.2025`.
  Unreadable dates are reported by line number and the item goes in without a date; nothing is guessed.
- Rows show date („bez daty" / „bez ceny" flagged), qty × unit price and total. Click opens the item panel.
- Item panel: new „Rodzaj" section with „Przenieś do zaplecza" / „Przenieś na plan". A zaplecze item has no rental
  rate, category, stats or project history. Moving an on-set item that was already on set in won/done projects asks
  first (see known limits). Retire and delete are unchanged (retire is the soft way out).

**Verified.** `npm test` 602 pass (585 before + 17). `tsc` clean. 14 deliberate mutations, all caught (`isOnSet` always
true, price ignoring qty, `undated` never set, `withOnSet` leaving the key, backstage counted as on-set, impossible
date accepted, undated sorted first, qty 0 not normalised, no filter in `computeGearReport`, none in the catalogue map,
none in the packing list, none in kit apply, schema accepting `true`, schema without the field). Browser preview with
seeded localStorage (restored afterwards): tabs and tile split; fast entry (Enter twice, focus back to name); paste of
three lines with one bad date; move to and from zaplecze (no `onSet` key left in storage after moving back); the
quote's „Dodaj z mojego sprzętu" picker, the Realizacja grid and packing list showed no zaplecze items; calendar and
projects views render; no console errors; 375 px wide: no horizontal scroll.

**Known limits.**
- An item moved to zaplecze **after** it was used keeps its old lines in projects. Stats treat it like an item deleted
  from the catalogue: its days stop counting for Odpracował / Zarobił and quote money for it becomes „nieprzypisane";
  packing lists and pickers skip it. The Realizacja day header (`Sprzęt: N pozycji`) and the „Na planie (N)" filter
  still count such stale lines. The move asks for confirmation when the item was used in won/done projects.
- A kit that contains an item later moved to zaplecze shows it as „(zaplecze)" and does not add or price it.
- Calendar and monthly „zakupy sprzętu" include zaplecze purchases (they are costs).
- No hard delete was added; the existing „Usuń z katalogu" still exists as before.

**For S4.** Read `gearPurchases(allItems)` (not `items`). Zaplecze rows carry `onSet: false`; both kinds are costs.
Depreciation for on-set gear stays S4's call. Undated purchases need a policy (flag, or fall back to the file date).

**Real data (read-only).** `equipment.json` has 22 items (the brief said 18), none marked `onSet`. Nothing in it looks
like zaplecze (no laptop, cards, cables or arms). Possible edge cases for M.J.: Rode Wireless GO II ×2 and Viltrox
6-inch (both bought in 2026, likely on set), Manfrotto Statyw (tripod, on set). Three items have no purchase date
(Sony 85mm f/1.8, Tamron 17-28mm, Amaran Halo 600X) and Sony A7S III is noted „zużyty, martwe HDMI" (retire?). Nothing
was changed.

## 11. F1 as built

*(2026-10-16, branch `claude/f1-fundamenty-tech-debt-8b1b86`, on top of `v3/project-hub` `411a12d`)*

**Automatic backups.** At every start (desktop only) the hub copies its data files — projects, events, finances,
subscriptions, campaigns, equipment, gear-kits, crew, crew-roles, client-groups, call-sheets, inbox-decisions and the
new company.json — into `backups/auto-<YYYY-MM-DD-HHmm>/`. The copy is the file's text, unparsed (a corrupt file is
backed up as it is); missing files are skipped; a fresh install creates nothing. Start-up waits for it at most 3 s.
- **Retention (confirmed by M.J. 2026-10-16; one constant `DEFAULT_RETENTION` in `lib/auto-backup.ts`): keep the last 14 copies
  AND the newest copy of each day for the last 30 days.** Several starts a day don't push out yesterday's copy, and
  there is always a copy from minutes ago. Real data is ~0.35 MB per copy, so at most ~44 folders ≈ 15 MB. The
  alternatives („last 14" only, „one per day for 30 days" only) are a one-line change.
- Pruning touches only folders named exactly `auto-YYYY-MM-DD-HHmm`; `backups/*.json` from `npm run data`, anything
  else and future-dated folders (clock changes) are never removed. Pruning runs only after a fully successful copy.
- A failed copy shows „Nie udało się zrobić automatycznej kopii danych (…)" at the bottom of the window; the app works
  normally. A failed prune only logs.
- Capabilities: read/write/mkdir/read-dir in `$APPDATA/**` were already there; **new: `fs:allow-remove` scoped to
  `$APPDATA/backups/auto-*` and `$APPDATA/backups/auto-*/**` only.**

**Business settings → `company.json`.** PDF texts, the portfolio catalogue and „Zapisz stawki jako domyślne" moved from
the window's localStorage into `company.json`: a one-record collection (`{ version, items: [{ id: "company", … }] }`,
so `createCollectionStore`, the backups and `npm run data -- apply` with `update` work unchanged). Fields: `pdfTexts`,
`portfolio`, `defaultPricing`, reserved `name`, `contact`, `defaultTaxRatePercent`, `defaultCurrency` (nothing reads
them yet), `migratedFromLocalStorage`, timestamps; passthrough. Content fields are accepted loosely (`unknown`) and
cleaned by the getters on read, so a write can never drop what is in the file.

| Case | Behaviour |
|---|---|
| First start, no company.json | created from `quote-gen-pdf-texts`, `quote-gen-portfolio-catalogue`, `quote-gen-user-default-pricing` (PDF texts: string fields only, as the getter did); the keys stay |
| An old key unreadable (bad JSON, wrong shape) | skipped and logged; the rest migrates; the key stays in localStorage |
| Later starts | file read into memory before providers mount; localStorage no longer read |
| Edit PDF texts / catalogue / default prices | memory at once, file in the background (read–merge–write, unknown fields kept), old key still written as a mirror (rolling back to an older build keeps working) |
| company.json exists but unreadable | never overwritten; getters fall back to localStorage as before F1; notice „Nie udało się odczytać pliku company.json…" |
| Creating the file fails | same fallback, notice |
| A later write fails | change stays in memory and localStorage until quit; notice |
| `npm run data` | `company.json` in `SCHEMAS`; `update` per field; a value the schema would „fix" is refused (checked: `defaultTaxRatePercent: "8,5"` refused, a valid update applied with a backup) |

`getPdfTextsConfig`, `getPortfolioCatalogue`, `getSavedUserDefault`, `getUserDefault` and the savers kept their
signatures; `quote-context`, `quote-documents` and the calculator tabs are untouched (Q2). UI-only preferences stay in
localStorage. **Start-up order** (`components/app-root.tsx`): carry-over → backup → company.json → providers.

**Screens.** Ustawienia: card „Dane i kopie zapasowe" (this start's backup folder and file count, pruned count, data
folder path; where the settings were read from). Bottom notice bar (`components/app-notices.tsx`) for background
failures.

**Docs.** `ARCHITECTURE.md` (repo root). The old QuoteGen `architecture.md` clashed with it on the case-insensitive
disk and moved to `docs/architecture-quotegen-legacy.md`. Release skill `.claude/skills/wydanie/SKILL.md` with
`real-data-check.mts` (read-only; quote financials and Finance year totals with the code of a given tree).

**Tests:** 615 (585 before; +30): `auto-backup.test.ts` (15: folder names, parsing, retention cases, copy/prune with an
in-memory fs, failures, the backup list covers every store's file), `company-settings.test.ts` (15: migration, schema
passthrough, getters from the file, saves to file + mirror, foreign fields kept, unreadable file, no file loaded).
31 deliberate mutations, 31 caught (three survived at first — future-dated folders, minutes 60, an empty key — and got
assertions). `npx tsc --noEmit` 0 errors.

**Real data (read-only, hashes and mtimes of every `*.json` unchanged):** with `real-data-check.mts`, old tree
(`411a12d`) vs this branch: all 11 saved quotes identical and equal to the stored financials; Finance 2026 identical
(revenue 179,538 zł, profit 82,822 zł, project costs 81,455 zł, fixed costs 51,692 zł, 19 projects).

**Verified in the browser preview** (dev, seeded localStorage, restored afterwards): first start created the company
record from the three keys (keys kept); a new project's quote starts from the migrated default price (rezOp 3,333 zł)
and its PDF shows the migrated company name and producer; editing „Edytuj treści PDF" saved to the file and the mirror;
after a reload with a diverging old key the file wins; a corrupt company record shows the notice, is left untouched, the
app runs; no console errors. The Ustawienia card shows the browser wording (no backups in the preview).

**Desktop-only checks for the main session** (installed app, real data):
1. Start the hub: `backups/auto-<today>-<HHmm>/` appears with the data files (8 today: no gear-kits, crew-roles,
   client-groups, call-sheets files yet; company.json from the second start on); `backups/*.json` untouched.
   Ustawienia → „Dane i kopie zapasowe" shows the folder.
2. First start: `company.json` created; `migratedFromLocalStorage.keys` lists what the window had (Q1 noted a saved
   default price list). Check the default price list, PDF texts and catalogue look as before.
3. Change a PDF text, quit, restart: the change is there and in `company.json`.
4. Start 15+ times (or drop dummy `backups/auto-2026-01-0X-0800` folders in while the hub is closed): old `auto-`
   folders are pruned per the rule; a folder with another name is not. If nothing is pruned and the console says
   „sprzątanie … nie powiodło się", the `fs:allow-remove` scope does not match — the backup itself still works.
5. `npm run data -- apply` with a `company.json` update (hub closed) is picked up on the next start.

**Known limits / next:**
- The backup runs once per start, not periodically; a hub left open for days has only the start-of-session copy.
- `name`, `contact`, tax rate and currency are reserved in `company.json` without UI (branding session).
- Notices are per session; a dismissed notice comes back on the next failing start.

## 12. S4 as built

*(2026-10-16, branch `claude/warstwy-marzy-s4-77d607`, on top of `v3/project-hub` `7c8ac53`.)*

M.J. confirmed the rules on 2026-10-16 after a real-data example and the case table below: layer 1 is before
tax; Klienci shows layer 1 too; the toggle defaults to on and switches every number, including layer 2 per
project; Rode Wireless GO II is inside the August „Sprzęt" (5,156.73 zł) and Viltrox inside September's
(970.81 zł); which lens was sold in June stays open.

**One ledger.** `lib/margin-ledger.ts` (pure) is what Finance reads, and what S5 should read:
`marginSummary(input, period)` and `marginTrend(input, year)`. Input = the money loop (`moneyLedger`), the
year's fixed costs with subscription charges (`fixedCostsInYear`), the whole gear catalogue (`allItems`), the
toggle, the gear settings, today and an optional set of project ids (client / group filter,
`projectIdsInScope` over S2's `scopeKeys`). Output: per-project rows (period revenue, direct costs, layer 1,
tax, and in a year view share / overhead / layer 2), company costs (tax, ZUS, subscriptions and other fixed
costs, marketing, gear), totals for the company and for the filter, „wstępnie", the gear breakdown, and the
untouched `MoneySummary` underneath (payments, coverage, plan). Nothing new is duplicated: revenue, costs and
tax are the money loop's; fixed costs go through `summarizeFixedCosts`; purchases through Z1's
`gearPurchases`.
- `ProjectMoney.margin` (money loop) = best-known revenue − best-known costs, before tax; `ClientMoney`
  carries it and `ClientStats.profit` became `margin` (the Klienci tile „Marża na realizacji").
- `moneyLedger(…, defaultTaxRatePercent?)`: a project without a plan takes company.json's
  `defaultTaxRatePercent` (`companyTaxRate`, else 8.5 %). Nothing sets it today, so no number moves.
- `lib/gear-costs.ts` (pure): `gearCostLines` (catalogue purchase → `spread` / `full` line with first and
  last month, monthly amount, retirement, unspread rest), `gearCostInPeriod`, `linkedCost` /
  `countedAmount` for manual entries that cover a catalogue item, `gearSpreadSettings`.

**Data (additive, no version bump):**
- Fixed-cost category `gear` („Sprzęt spoza katalogu"), `type` stays `other`, so older builds count it under
  „Inne".
- `FixedCost.catalogueItemIds?: string[]` — the catalogue items this manual amount included; the ledger counts
  `amount − their prices` from the entry and the items from the catalogue. The amount in the file stays what
  was paid. A bad value drops to `undefined` without touching the record.
- company.json `gearSpreadThresholdPln?` (default 5,000) and `gearSpreadMonths?` (default 36, no UI). The
  threshold is edited next to the toggle („od 5 000 zł na 36 mies.").
- The toggle and the Finance client filter are UI preferences in localStorage
  (`nonoise-finance-spread-gear`, `nonoise-finance-client`).

**Real-life cases → behaviour** (tests in `margin-ledger.test.ts`, `gear-costs.test.ts`,
`money-loop-labels.test.ts`):

| Case | Behaviour |
|---|---|
| Job with Realizacja costs | layer 1 = revenue − Realizacja costs (T6 rules: partial in production keeps the plan) |
| Job without Realizacja costs | plan costs, tagged „plan"; plan 0 shows „brak kosztów · w planie 0 zł" |
| Retro import, invoice + financials only | invoice revenue, plan costs |
| No plan, no invoice | „brak kwoty": no layer 1, share 0 |
| EUR job | in zł: plan = € × the frozen rate, the invoice (zł) replaces it |
| Extra sale | revenue, layer 1 and the year share go up; an extra invoiced next year counts there without costs |
| 6,000 zł gear in May | on: 166.67 zł a month 05.2026–04.2029 (2026: 1,333.33); off: 6,000 in May |
| Laptop in Zaplecze, 4,500 zł | below the threshold: in full in its month in both views |
| Threshold | ≥ 5,000 zł, per purchase line (price × quantity); 0 = spread everything |
| Yearly subscription | in full in its payment month in both views (the toggle is gear only) |
| Month without jobs | no rows, layer 1 = 0, result = −company costs |
| Current / open period | „wstępnie": company costs to the end of the period from plan (subscription charges, spread gear) |
| Client group | its rows and sums; year view: its layer 2 = the sum of its jobs', shares over all jobs; other views: layer 1 only (result tile „dla klienta tylko w widoku roku") |
| Lost project | not counted anywhere |
| Retired item | spreading stops after the retirement month; „nierozłożone X zł" is shown, not counted (no sale price yet); the cash view is unchanged |
| Undated / unpriced item | counted nowhere, listed „bez daty zakupu — uzupełnij" |
| Manual „Sprzęt" covering a catalogue item | the entry counts the rest, the item counts from the catalogue — total = what was paid |
| A year without revenue | company costs stay unallocated; result = −costs |

**Finance UI** (Projekty tab): a bar with the client / group filter (same picker as Projekty) and the toggle
„Rozłóż duże zakupy sprzętu" with the threshold. Tiles: Przychód netto · Marża na realizacji (direct costs,
% of revenue, vs plan) · Koszty firmy (tax, ZUS, stałe i subskrypcje, marketing, sprzęt in the chosen view;
with a filter in a year view: the group's share) · Wynik po kosztach firmy (green / red, „wstępnie"). Chart:
layer 1 bars, company-cost bars, result line. „Plan a rzeczywistość" rows: Przychód · Koszty · Marża na
realizacji · (year only) Po kosztach firmy with „podatek X · koszty firmy Y (share %)" · Zapłata. New panel
„Sprzęt w kosztach firmy": the catalogue lines in the period (carried ones first, „z 2024"), manual entries
with what was subtracted, retired rests, undated items, and the sentence „2026 niesie 28 139 zł z
rozkładania zakupów sprzed tego okresu (np. RED Komodo X pakiet: 1 583 zł / mies. do 03.2027)". The
„Koszty stałe i subskrypcje" tab gets the category „Sprzęt spoza katalogu" in its picker.

**Real data (read-only; the hub folder's hashes unchanged by this session).** `real-data-check.mts`, old
tree `7c8ac53` vs this branch: identical (11 quotes; 2026 revenue 179,538 zł, project profit after tax
82,822 zł, costs 81,455 zł, fixed costs 51,692 zł). Layers for 2026 with the patch simulated in memory:

| | sprzęt w całości | rozłożony |
|---|---|---|
| Marża na realizacji | 98,083 | 98,083 |
| Koszty firmy (tax 15,261 · ZUS 17,604 · stałe 13,339 · marketing 8,134 · sprzęt) | 66,953 (sprzęt 12,615) | 95,091 (sprzęt 40,754, of which 28,139 carried from 2023–2025) |
| Wynik po kosztach firmy | **31,131** (= Finance before S4) | **2,992** |

Per job (spread): S-AI 31,960 → −10,645 (44.8 %); JHJ 13,355 → −299; Morris & Lloyd pakiet 9,290 → 710;
CIONET TribesDay II 6,700 → 2,357. CIONET + DE Group 2026: revenue 23,020, layer 1 19,860, layer 2 7,668
(spread) / 11,275 (cash); Klienci shows the same 19,860. Without the patch the cash view shows 28,731
(Rode and Viltrox counted twice). Undated: Amaran Halo 600X, Sony 85mm, Tamron 17-28 (8,540 zł).

**Patch for the main session** — `imports/2026-10-16-s4-gear.json` (dry run against the real folder:
finances.json 8 changed, 0 new): `category: "gear"` (ifMissing) on the eight 2026 „Sprzęt…" entries;
`catalogueItemIds` on August (`eq-1791901788868-nvmo4bk`, Rode ×2) and September (`eq-viltrox-6-inch`).
Amounts and months unchanged. Apply with the hub closed.

**Tests:** 670 (632 before; +38: `gear-costs` 13, `margin-ledger` 23, labels 2; `client-stats` assertions
moved to `margin`). 40 deliberate mutations across `gear-costs`, `margin-ledger`, `money-loop`,
`client-money`, `client-stats`, labels, schema and categories: 36 caught at first; the four survivors (first
month of a period counted as „carried", threshold 0, a linked gear entry subtracted twice, costs of a
project anchored in another period) got tests — 40 / 40. `tsc` clean.

**Verified on the production export** (`npm run build`, launch config „export") with the real data (patch
applied in memory) seeded into localStorage, restored byte for byte afterwards: year 2026 tiles and every
row as above; toggle off → 31,131 zł; filter „CIONET + DE Group" (rows, 13 % of revenue, its share of company
costs, result); Q3 (no layer-2 column, not „wstępnie") and Q4 („wstępnie", result tile „tylko w widoku
roku"); threshold edited to 3,000 zł (company record updated; DJI Ronin 3,500 zł starts spreading, +1,167 zł);
reload keeps the toggle and threshold; Klienci group tile; phone width. Fixed during the check: the threshold
field now selects its value on focus.

**Desktop-only checks for the main session:** the threshold edit writes `gearSpreadThresholdPln` into
company.json and survives a restart; after applying the patch, Finance 2026 in the cash view = 31,131 zł.

**Known limits / next:**
- Sale price for retired gear is not modelled (the rest is only shown); tax depreciation rules are not modelled.
- A yearly subscription is not spread (cash only); a later toggle could spread it like gear.
- With a client filter, layer 2 exists only in the year view (decision A); the trend line stays company-wide.
- The month list for Finance periods still has no „Miesiąc" kind in the picker (the chart shows months).
- Pre-existing: at 375 px the phone top bar is 29 px wider than the screen on every section (10 icons);
  Finance itself fits.
- Open for M.J.: which lens was sold in June 2026 (−577.99 zł entry) — if it is in the catalogue, set its
  `retiredAt`.
