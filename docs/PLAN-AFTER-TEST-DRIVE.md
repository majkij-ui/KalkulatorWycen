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

**Merged and installed 2026-10-16 (Z1, F1 → S4 → Q2):** only conflicts were this document's as-built sections
(kept in order §9–§12). 690 tests, `tsc` clean. Applied: S1 patches, S2 client groups, S4 gear patch (8 „Sprzęt…"
entries → `gear`, Rode / Viltrox linked). The Q2 Morris variant patch was already in `projects.json` (written
15:42 with a backup; a re-run is „bez zmian"). Real data, read-only: 2026 revenue 179,538 zł and project profit
82,822 zł unchanged; result after company costs 31,131 zł in the cash view, 2,992 zł with gear spread (28,139 zł
carried from 2023–2025 purchases). Not yet started on the desktop: the F1 first start (no `company.json` yet).

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

## 9. Q2 as built

*(2026-10-16, branch `claude/quote-variants-abc-d13a9b`, on top of `v3/project-hub` `b469106`)*

**Why:** M.J. often sends a client 2–3 versions of an offer (a cheap one, an expensive anchor, a middle option) and
rebuilt the quote and PDF each time. Now each project has variants A, B, C…, each a full quote with its own price
list, margin, currency and PDF.

**Decided with M.J. (2026-10-16):** the model and every case in the table below; one combined PDF with all variants
side by side comes **later**; Morris & Lloyd's variants are named **A** (today's quote) and **B** („wariant 2 dni").
M.J. also wants the PDF total to become the final number that counts (financials, Realizacja profit, Finance), with
a warning that the calculator is out of date. That is a money rule of its own and goes to a **separate session**
after Q2 (proposal below under „Next").

**Data (additive, passthrough, no version bump).**
- `Project.quote` stays the variant **chosen for money**. Every reader is unchanged: financials, Realizacja plan,
  money loop, Finance, clients, gear and crew stats, `npm run data`.
- `Project.quoteVariants?: { id, label, snapshot, createdAt, updatedAt, deletedAt? }[]` holds the other variants
  (`lenientArray` + passthrough; a broken snapshot reads as an empty quote instead of dropping the variant). Variants
  never count money.
- `Project.quoteLabel?` names the chosen variant (empty = „A"); `Project.quoteVariantId?` is its permanent id (empty =
  `main`), so a variant keeps its identity when it is swapped in and out.
- Pure rules in `lib/quote-variants.ts`: list / add / rename / delete / restore, `chooseVariantPlan` (swap and
  financials), `asksWhichVariant`, `variantFigures` (comparison), `quoteSentEvent`, crew retargeting for „Scal osoby".

**Store.** `quote-documents.ts` keys documents by id: the project id is the chosen variant (Q1 writer, financials,
import question); `projectId#variantId` is another variant, whose writer (`writeVariant`) patches only its own
`quoteVariants` entry on the latest project — no financials, no import question. New: `flushProject(projectId)`;
`forget(projectId)` also drops that project's variant documents, `forget('p#v')` only that one. „Cofnij zmiany z tej
sesji" works per document. `QuoteDocScope` (in `quote-context.tsx`) binds the calculator to the viewed variant's
document; `QuoteProvider` itself still serves the chosen variant, so Realizacja and Ekipa never read a variant you are
only looking at.

**Real-life cases, as built** (tests in `quote-variants.test.ts`):

| Case | Behaviour |
|---|---|
| Old project, no variants | Looks as today; the only addition is a small „+ Wariant" above the calculator tabs. File name, data, Realizacja unchanged; the schema adds no fields. |
| „+ Wariant" | „Kopia wariantu X" (full copy of the viewed variant incl. price list, margin, currency, PDF and unsaved edits) or „Pusta wycena" (my default price list). Next free letter (deleted ones count, so „Cofnij" never gives two „B"); opens at once and is written immediately. The first time, the chosen one is named „A". |
| Create B from A, edit B | Only B's entry is written; A, its PDF and financials untouched; a third variant untouched too (test „no leak"). |
| Switch A ↔ B | Pills „A · ✓B · C" (✓ = chosen); the calculator sub-tab stays; the PDF tab remounts per document (`key = docId:epoch`). The viewed variant is remembered per project until the app closes; after a restart the project opens on the chosen one. |
| Header | „Zapisano" / „Cofnij zmiany z tej sesji (wariant B)" talk about the viewed variant on the Wycena tab, about the chosen one elsewhere. |
| Rename | Double-click the pill or „Zmień nazwę" (free text; the field selects the old name). |
| Delete B | Soft delete (`deletedAt`), „Usunięto wariant B · Cofnij". With only the chosen one left the screen looks as today. |
| Delete the chosen one | Not allowed: „Najpierw wybierz inny wariant do rozliczeń" (also guarded in the pure rule). |
| Choose B, project in „Wycena" / „Nieprzyjęta" | Immediately: B → `quote`, A → variants (in B's place), financials recomputed from B; notice with „Cofnij" (chooses A back, financials equal to the cent). |
| Choose B, project „W realizacji" / „Zrealizowany" | Asks first: „Rozliczać wariant B? Finanse projektu: 11 725 zł → Y zł." |
| Status set to „W realizacji" / „Zrealizowany" with 2+ variants | From the header or the calendar's status suggestion (`requestStatus`): dialog „Który wariant przyjął klient?" with each variant's netto and PDF netto; the answer chooses that variant and sets the status; „Anuluj" changes nothing. Moving won → done does not ask again. |
| Retro project with imported financials | Editing A still asks the Q1 question; creating or editing B never asks (counts nothing). Choosing B asks „Ten projekt ma finanse z importu (X zł). Zastąpić je wariantem B (Y zł)?". Choosing is refused while A's edits wait for the import answer (they live only in memory and a swap would lose them). |
| EUR in one variant | Each variant has its own currency and rate; comparison shows netto in its currency plus „≈ w złotych"; choosing an EUR variant gives financials in zł (S3 rules, unchanged). |
| „Porównaj warianty" | Calculator netto, PDF netto (when hand-edited), shooting days, crew person-days, gear in the price (detailed mode), plan profit and margin. Live from the documents (unsaved edits included), never stored. |
| PDF per variant | Each variant's own `pdfDraft`; with 2+ variants the file name ends in „ (wariant B)". |
| „Wycena wysłana" | After „Pobierz PDF" (Tauri: after the file is written; web: after the print dialog) the PDF tab offers „Zapisz »Wycena wysłana« na osi projektu (wariant B · 13 500 zł netto)". Saving creates `quote_sent` with `amountNetto` = PDF total in zł (EUR × the draft's rate) and `data.quoteVersion` = the label (omitted for single-quote projects). Never automatic. |
| „Scal osoby" | Also retargets crew lines in variant snapshots (incl. deleted variants), in the same write; „Cofnij" restores only lines still pointing at the kept person. |
| Project deleted | Its variant documents are dropped from memory with it. |
| Restart | Variants, labels, PDFs and EUR come back from `projects.json` (test through the web storage path). |

**Real data (read-only).** In the hub's `quotes.json`, „Morris Lloyd - Wisła Październik" has exactly the same
calculator data as „Morris & Lloyd — rolki, październik (Wisła)" (11,725 zł); only the hand-edited PDF differs
(sprzęt 1,200 vs 600, postprodukcja 5,500 vs 6,600; PDF 13,500 vs 14,000). One-off patch
`imports/2026-10-16-q2-morris-variant.json` (`update … ifMissing`): adds it as variant „B" (id `qv-morris-wisla-2dni`,
original timestamps, `migratedFromQuoteId`) and names the current quote „A". Dry-run against the real folder: „1
zmienione"; `projects.json` hash and mtime unchanged, no backup written. Applied to a scratch copy: the other 35
projects byte-identical, Morris gains only `quoteVariants` + `quoteLabel`, the variant re-saves through the store
unchanged, a second run is „bez zmian". **The main session applies it** (hub closed):
`npm run data -- apply imports/2026-10-16-q2-morris-variant.json`.

**Code.** New: `lib/quote-variants.ts`, `components/projects/quote-variants-bar.tsx` (bar, comparison),
`components/projects/variant-status-question.tsx`. Changed: `project-types.ts` (schema), `quote-documents.ts`
(variant documents, `flushProject`, `forget`), `project-hub-context.tsx` (`writeVariant`, `addVariant`,
`renameVariant`, `deleteVariant`, `restoreVariant`, `chooseVariant`, `requestStatus` / `statusQuestion`; leaving a
project flushes all its documents), `quote-context.tsx` (`QuoteDocScope`, `docId`, `variantLabel`),
`quote-calculator.tsx`, `app-shell.tsx`, `project-header.tsx`, `event-notice.tsx`, `podglad-pdf.tsx`,
`crew-section.tsx`. Pure modules (quote-calc, quote-financials, pdf-draft, quote-currency, quote-crew, quote-gear)
untouched; golden tests pass unchanged. Finance, equipment files and settings / backups untouched.

**Tests:** 605 (585 before): `quote-variants.test.ts` (20): rules, schema round trip, crew merge, store (no leak
between variants, import question only for the chosen one, choose with pending edits in both, choose blocked by a
pending import answer, per-document undo, forget, `flushProject`), restart. 27 deliberate mutations of the store and
the rules, 27 caught (three survived at first — deleting the chosen variant on inconsistent data, „Cofnij" of a merge
after a later edit, a variant save touching its siblings — and got assertions).

**Verified** on the production export (`npm run build`, „export" launch config) with seeded localStorage (the real
Morris project with the patch applied, a quote with an EUR variant, a retro project, an old project; restored
afterwards to the single key it had): status → „W realizacji" asked „Który wariant przyjął klient?" (A 11,725 / PDF
14,000, B 11,725 / PDF 13,500) and choosing B swapped the quotes; A ↔ B with the PDF tab open showed each variant's own
PDF; „Pobierz PDF" (print stubbed) named the file „… (wariant A)" and wrote nothing; „Wycena wysłana" saved
`{ amountNetto: 14000, quoteVersion: "A" }`; an edit in A left B and the financials alone; choosing A asked
„11 725 zł → 12 325 zł", „Cofnij" restored 11,725; „+ Wariant" copy, rename, delete + „Cofnij"; reload kept everything
and opened on the chosen one; Realizacja showed the chosen 11,725 while another variant was viewed; EUR variant chosen
without a question in a „Wycena" project (financials 7,852 zł); old project shows only „+ Wariant"; retro project:
blank B kept 2,000 zł, choosing asked the import question, „Anuluj" changed nothing; phone width wraps. No console
errors besides the missing Vercel analytics script.

**Desktop-only checks for the main session** (Tauri app, real data, after applying the patch):
1. Morris & Lloyd → Wycena: pills „✓A · B"; B's PDF says „wariant 2 dni", 13,500 zł; A's says „wariant C", 14,000 zł.
2. „Pobierz PDF" on B: the native dialog proposes „… (wariant B).pdf"; after saving, the „Wycena wysłana" offer
   appears; „Zapisz" puts it on the timeline with version B.
3. Edit B, close the window right away (red button): after restart B has the edit, A and Finance unchanged.
4. Morris is „W realizacji": „Wybierz do rozliczeń" on B asks with amounts; „Cofnij" returns to A (Finance back to
   11,725).
5. A project in „Wycena" with variants → calendar event „Zlecenie potwierdzone" → „Ustaw" opens the variant question.
6. Ekipa „Scal osoby" on someone used in a variant: the variant's crew line follows; „Cofnij" restores it.

**Known limits / next:**
- **Next session — „PDF total is the final price"** (asked by M.J.): proposed precedence hand-typed „Kwota przelewu"
  > PDF total (hand-edited prices) > calculator, reusing `profitTransferAmount` plus a `profitTransferFromPdf` marker
  so hand-typed transfers on done projects (S-AI 80,440 vs PDF 67,800; JHJ 25,780 vs 21,800; M&L Broker 16,200 vs
  13,180) are never overwritten; a sticky-header warning when the calculator disagrees; existing projects only via a
  button (Morris 11,725 → 14,000, UAM 8,238 → 8,630). Needs its own case table and M.J.'s confirmation.
- One PDF with all variants side by side: later (M.J.).
- Choosing a variant starts a fresh „Cofnij zmiany z tej sesji" point for the project's documents (all are saved
  first); the swap itself is undone with its own „Cofnij".
- The variant shown in Wycena is remembered only until the app closes.
- `quote_sent` amounts for EUR use the PDF draft's rate at the moment of saving.
- Gear and crew statistics read only the chosen variant (by design: variants never count).

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

## 13. Crew pricing, Realizacja, project finances and own work *(M.J. feedback 2026-10-18)*

M.J. tested pricing a shoot day and settling it in Realizacja. Functionally everything works, but the crew row
hides the numbers he needs, Realizacja shows the same costs three times (top summary, days, Profit collapsible +
„Koszty całego projektu" at the bottom), and nothing tells him how much of a job's margin is his own labour.

### 13.1 Items

**A. Wycena — crew rows** (`components/tabs/produkcja-crew.tsx`, `lib/quote-crew.ts`, `lib/crew-types.ts`)
- **A1 „Ja" in Ekipa.** One person flagged as M.J. himself, with roles Reżyser, Reżyser-operator, Operator,
  Asystent and a rate per role. He also works on other people's productions in lower roles, so crew stats per
  role must include him.
- **A2 Default first shoot day.** A new quote's day 1 starts with director + operator = „Ja" (see question 2).
- **A3 Two editable amounts per row.** Left „Koszt" (what I pay / settle with the person = `costRate`), right
  „Klient" (what goes to the PDF = `clientRate`). Picking a person fills BOTH from that person's rate in the role
  (Kamil 1,200 → koszt 1,200, klient 1,200); either can be changed per row. Today the client side is the role rate
  (1,500) and cannot be edited (decision 7, plan §6d) — this replaces decision 7 for new and edited lines.
  *Why:* the client should see cheap people and pricier gear (people's rates get haggled, gear's less); M.J.
  shifts the margin himself.
- **A4 Role rates findable.** They are edited in Ekipa → Role (client rate + my cost; built-ins come from the
  default price list), but M.J. could not find that. Link to it from the crew picker.

- **A5 Margin as its own line** (M.J. 2026-10-18). The header margin multiplier no longer stretches every line
  proportionally; lines show their own client prices and the margin lands as one extra line item („marża
  produkcji" — the client-facing label is for M.J. to choose). Totals stay what the multiplier gives today.

**B. Realizacja tab** (`components/realization/*`, `components/tabs/profit.tsx`)
- **B1** Remove the top summary (koszty według kategorii, koszty / zysk / marża rzeczywista) → tab C.
- **B2 „Koszty projektu" at the top**, above the days: everything not per day — przedprodukcja, dojazd / paliwo,
  nocleg, catering, postprodukcja, sprzęt kupiony na ten projekt, inne. Prefilled from the quote. Replaces the
  bottom „Koszty całego projektu" (which sits after the packing list and gets lost).
- **B3 Days = crew and gear only**, prefilled 1:1 from the quote's shoot days, with the Profit mechanics: tick
  what really was a cost, edit the amount, add a person or a custom day cost if needed.
- **B4** Remove the Profit collapsible at the bottom; its mechanics live in B2 / B3, its „Kwota przelewu" moves to C.
- **B5** Gear grid, packing list and call sheet: unchanged (they work well).

**C. New project tab „Finanse"** between Realizacja and Notatki (name: question 6)
- **C1 Headline:** big „Zatwierdzona cena" (the chosen variant's PDF total; the calculator when the PDF is not
  hand-edited); below, smaller and editable, „Kwota finalnego przelewu" (with extra sales agreed by mail or on
  set). This is the „PDF total is the final price" session proposed in §9 (P1), folded in here.
- **C2** Kept as today: zysk netto, marża, ryczałt 8,5 %, łączne koszty.
- **C3** Plan vs actual by category (moved from Realizacja's top), low-key: small differences don't matter, big
  jobs (S-AI) show where he under- or over-estimated.
- **C4 Two margins:** „Marża" = what stays on his account after external costs and tax (his own work counts as
  his), and „Marża producencka" = the same minus his own work valued at its rate, also as % of the total — „if I
  only produced and sent someone else, is anything left?".

**D. Own work vs external cost**
- **D1** Every cost line in B2 / B3: checkbox „realny koszt" (unticked = didn't happen) plus a pill
  „Zewnętrzny | Moja praca". No third kind: a counted line is either paid out or his own work. Lines with
  person = „Ja" default to „Moja praca".
- **D2** Company Finance and the S5 report show the producer margin next to S4's layers.

### 13.2 Questions for M.J. (the session confirms them at step 1; main session's recommendation)
1. **Header margin and „Klient" (A3).** `clientRate` is before the quote's margin multiplier. Rec: the row shows
   and edits the amount that lands in the PDF; check on real quotes which multiplier M.J. uses before deciding.
2. **Default day 1 (A2):** one line „Reżyser-operator · Ja" or two lines „Reżyser · Ja" + „Operator · Ja"? Rec:
   one line — one person-day of his work; two lines would count his day twice in own work and crew stats. He
   splits it when the client should see two lines.
3. **Value of own work (C4):** the line's „Koszt" (what he would pay someone for that role); „Ja"'s rates in Ekipa
   give the default. Rec: yes.
4. **Final transfer vs extra sales (C1):** one truth. Facts today: `profitTransferAmount` (hand-typed, in the
   quote's plan; S-AI 80,440, JHJ 25,780, M&L Broker 16,200), `extra_sale` events, invoices (win in the money
   loop). Rec: the field shows approved price + extra sales; typing a number is the hand-typed override (as
   today); a gap to approved + extras offers „Zapisz różnicę jako dosprzedaż" — never silent.
5. **Existing projects whose PDF ≠ calculator** (Morris 11,725 → 14,000; UAM 8,238 → 8,630): switch only with a
   button per project (rec, so 2026 doesn't move silently) or automatically?
6. **Tab name:** „Finanse" (rec — the word M.J. uses), „Zysk" or „Rozliczenie".
7. **Own gear in days:** catalogue gear is not a cash cost (S4 counts purchases); show it as „mój sprzęt" with no
   amount and no pill; rentals are external. Rec: yes.
8. **Existing plans that include his own roles** (e.g. a „Reżyser" line without a person counted as a cost): no
   silent change — list them on real data and propose a review patch.

### 13.2a Decisions (M.J. 2026-10-18)
1. **The PDF is the price; Finanse is final.** The multiplier only helps arrive at PDF numbers („what if +10 %").
   „Klient" in a crew row = that line's client price before margin; the margin is a separate line (A5).
   The four layers (calculator → PDF → Realizacja → Finanse) are written down in ARCHITECTURE.md „Money pipeline".
2. One line „Reżyser-operator · Ja" by default (as recommended).
3. Own work is valued at the line's „Koszt" (as recommended).
4. Final transfer: approved price + extra sales; a typed number is the override; a gap offers „Zapisz różnicę
   jako dosprzedaż" (as recommended).
5. **PDF ≠ calculator is normal and permanent.** Nothing goes backwards from the PDF into the calculator. Finanse
   (revenue) reads the PDF, never the calculator; Realizacja (costs) starts from the calculator and is adjusted.
   No per-project button: the PDF rule applies to every project, but every project whose revenue moves because
   of it is listed for M.J. before release (expected: Morris 11,725 → 14,000, UAM 8,238 → 8,630); hand-typed
   transfers, extra sales and invoices still win.
6. Tab name: **„Finanse"**.
7. Own gear in days: „mój sprzęt", no amount, no pill; rentals external (as recommended).
8. Old plans: no silent changes; M.J. will rebuild most of them himself — leave them alone apart from a listed,
   optional review patch.

### 13.3 Sessions

| Session | Model | Contents | Runs with | Needs |
|---|---|---|---|---|
| **R1 Ekipa w wycenie** | Opus | A1–A5 | S5 | — |
| **S5 Raport okresowy** | Opus | §3.7 on S4's ledger | R1 | S4 |
| **R2 Realizacja i finanse projektu** | Opus | B, C, D1, P1, producer margin per project and in the ledger (Finance tile; report row if S5 is merged) | — | R1 merged |
| later | | T9c (old quote rows), company profile / branding, G3 packing-list PDF | | R2 |

R1 and S5 share no files (calculator crew vs Finance / report). R2 waits for R1: it reads R1's row amounts and the
„Ja" flag, and it reshapes the realization and plan code R1's lines feed.

## 14. R1 as built

*(2026-10-18, branch `claude/r1-ekipa-w-wycenie`, rebased on `v3/project-hub` `f6caf24` after S5.)*

**Phase 1 (real data, read-only).** 14 quote documents then (16 at the end: M.J. added Solvo Film CeZ and Zabudowy
Warszawa during the session). Margin multiplier: every document at 1.00 except Dräger (lost, 1.15). Crew lines only in
Morris A (ReżOp placeholder 1,500 / 1,500; „Asystent/Operator · Kamil" Klient 1,500 from the role, Koszt 1,200) and
Morris B; Morris A's hand-edited PDF already shows people cheaper (Ekipa 2,400 vs 3,000). No `crew-roles.json` at the
start; M.J. later created a role „Ja jako Asystent" (1,400) and used it on Solvo Film Grodzisk — the real „Ja hired on
someone else's production" case.

**Decided with M.J. (2026-10-18):** (1) quotes without the new flag keep today's stretched look, PDF included; new
quotes, „Pusta wycena" and variant copies use the margin line; (2) PDF label „Koordynacja i produkcja" / „Production &
coordination", negative = „Rabat" / „Discount", description editable; (3) a role change after a hand edit refills both
amounts; (4) M.J. is never on two lines on one day (a combined role such as „ReżOp + dron op" is one line) — no special
handling, no dedupe; (5) ship the roles and „Ja" as a data patch, ReżOp keeps its built-in name (and keeps following
the price list), day 1 = „ReżOp · Ja".

**Data (additive, passthrough, no version bump).**
- `CrewMember.self?: true` — „Ja" (R2 reads exactly this). At most one live: `withSelfRule` takes the flag from the
  others in the same write; `selfCrewMember` picks the oldest live one if a restore ever leaves two.
- `QuoteCrewLine.clientFromPerson?` (R1 line: „Klient" follows the person's rate in the role), `clientEdited?`,
  `costEdited?` (typed by hand). Lines without them are pre-R1 and keep decision 7 on „zaktualizuj stawki".
- `QuoteData.marginAsLine?: true` — set by `blankQuoteSnapshot` (new project, lead, „Pusta wycena"), by
  `withMarginLine` in `addVariantPatch` (copies) and by ⌫/↺ resets. `mergeQuoteDataPartial` never adds it, so every
  saved quote reads as before.
- PDF draft: optional `rows.marza` (only in drafts of flagged quotes; `PDF_ROW_KEYS` stays the seven rows).

**Real-life cases, as built** (tests in `quote-crew-r1.test.ts` and `quote-margin-line.test.ts`):

| Case | Behaviour |
|---|---|
| Kamil as Operator (role 1,500) | Koszt 1,200, Klient 1,200 |
| Person without a rate in the role | their day rate in both; no rates at all: Koszt = role cost (else client rate), Klient = role rate |
| Klient typed, then Koszt typed | each kept on its own, „ręcznie" + ↺ (back to Ekipa); the other does not follow |
| Role or person changed after a hand edit | both amounts refilled; the marks go (M.J. 3) |
| „zaktualizuj stawki" after a hand edit | typed amounts stay, the rest refreshes; hand edits never count as „inne stawki" |
| Pre-R1 line with a person (Morris A, Kamil 1,500 / 1,200) | unchanged; refresh keeps Klient = role, Koszt = person |
| qty 2 placeholder | amounts per person-day; picking a person splits it: person (qty 1) + placeholder (qty 1) |
| EUR quote | Klient in whole euros (stored in zł, S3), Koszt in zł: 1,200 zł → 275 € at 4.3699 |
| Old quote opened (Dräger 1.15) | identical numbers and PDF (1,610 / 6,210 / 1,725 / 4,140 = 13,685); header says „rozciąga ceny pozycji (starsza wycena)" |
| New quote, margin 1.15 | items at own prices + one „Koordynacja i produkcja" = (m − 1) × what the multiplier stretches (pre, post, crew lines, old counters and gear fields, quick production); catalogue gear, rentals, day adjustment, travel, catering, lodging, actor fee stay outside; copyright % surcharge on the subtotal incl. the line; total identical (Dräger as a copy: 1,400 / 5,400 / 1,500 / 3,600 + 1,785) |
| Margin 1.0 / below 1 | no line, PDF row 0 and not printed / negative „Rabat" („Rabat od wyceny.") |
| Hand-edited PDF draft | never rewritten; a draft without the margin row reads it as 0; „Zaktualizuj ceny z kalkulatora" also fills the margin row |
| Variant copy of an old quote | gets the flag, totals identical; its copied draft stays as typed, so „Ceny w PDF różnią się" shows until updated |
| New quote's day 1 | „ReżOp · Ja" at my rates (Koszt = Klient = 1,500 after the patch); without Ja a ReżOp placeholder |
| „Scal osoby" with Ja | the kept card is Ja if any merged card was; „Cofnij" restores both flags |
| Ja hired elsewhere as Asystent | change the line's role to Asystent: both amounts from my Asystent rate; crew stats per role count him |
| Ja in Ekipa | „Ja" pill, „To ja" on the card (moving it says who had it), first in quote pickers, out of „najczęściej pracuję z…" and the „wypłacone" tile, his card says „Wartość mojej pracy" |

**Screens.** Produkcja crew row: Rola (select) · Osoba · Osób (placeholders) · Koszt (zł) · Klient (quote currency) ·
Razem (or „Z marżą" in older quotes); „Stawki ról" next to „+ Dodaj rolę…" opens Ekipa › Role over the calculator
(A4). Sticky header under the slider: „Koordynacja i produkcja: X (osobna pozycja)" / „Rabat: −X" or „rozciąga ceny
pozycji (starsza wycena)". PDF tab: the margin row last with „marża z nagłówka · drukuje się, gdy ≠ 0", negatives
allowed; printout prints it last when ≠ 0. Role sheet text explains rates for placeholders vs people.

**Code.** `quote-crew.ts` (`crewClientRate`, `withCrewPerson`, `staffCrewLine`, `withCrewRole`, `withCrewAmount`,
`resetCrewAmount`, `defaultFirstDayCrew`, refresh rules), `quote-calc.ts` (`MARGIN_PHASE`, `lineMarginMultiplier`,
`marginLineAmount`), `pdf-draft.ts` (`pdfRowKeys`, `pdfMarginRowTitle`, `printsMarginRow`, margin row in build / coerce /
total / currency), `crew-types.ts` (`self`, `selfCrewMember`, `withSelfRule`), `crew-merge.ts`, `crew-stats.ts`
(`crewPaidThisYear`, ranking without Ja), `project-save.ts`, `quote-variants.ts` (`withMarginLine`), `pdf-i18n.ts`;
UI in `produkcja-crew.tsx`, `produkcja.tsx`, `sticky-header.tsx`, `podglad-pdf.tsx`, `printable-quote.tsx`,
`components/crew/*`, `crew-context.tsx`, `quote-context.tsx` (`addShootingDay(firstDayCrew)`). Realizacja, Profit,
Finance, money loop and margin ledger untouched.

**Tests:** 723 on the R1 branch (690 + 33), 761 after rebasing on S5. Golden tests (`quote-crew-legacy`,
`quote-currency-legacy`) unchanged; three decision-7 unit tests rewritten for A3 plus one new pre-R1 refresh test. 50
deliberate mutations, 50 caught (five survived at first — role change with a person whose role rate equals the role's,
a kept hand-typed Koszt, ↺ with a deleted person, detailed pre/post in the margin base, the discount text — and got
assertions). `npx tsc --noEmit` clean; `npm run build` passes.

**Real data (read-only, `projects.json` hash and mtime unchanged by every run).** All 16 documents (incl. variants and
the deleted S-AI copy) computed by the base tree and the branch: totals, VAT, catering/lodging, every phase and item,
financials, plan lines, PDF rows PL and EN with titles and descriptions, restored hand-edited drafts and their totals,
gear revenue, crew staleness and refreshed lines, variant figures — byte-identical. The release check
(`.claude/skills/wydanie/real-data-check.mts`) is identical too.

**Data patch for the main session** (hub closed): `npm run data -- apply imports/2026-10-18-r1-ja-and-roles.json`.
Adds roles „Reżyser" (`cr-r1-rezyser`, order 5) and „Asystent" (`cr-r1-asystent`, order 25), both client 1,500;
stores the built-in `asystent` as „Operator" (client 1,500, frozen from the default price list); adds „Michał"
(`cm-r1-ja`, `self: true`, roles Reżyser / ReżOp / Operator / Asystent, 1,500 each); moves Kamil's and Łukasz's 1,000
„Asystent" rates (notes kept) from Gafer to Asystent and replaces Gafer by Asystent in their roles. Dry run on the real
folder: crew-roles +3 (4 with M.J.'s „Ja jako Asystent"), crew +1 new and 2 changed; nothing written. Applied to a
scratch copy and simulated: Ekipa shows Reżyser | ReżOp | Operator | Asystent | Gafer…, day 1 = „ReżOp · Michał"
1,500 / 1,500, Kamil and Łukasz as Operator 1,200 / 1,200, as Asystent 1,000; Morris A then shows „1 pozycja ekipy ma
inne stawki niż baza" — the name only (Asystent/Operator → Operator), amounts the same. Notes: re-check Kamil's and
Łukasz's cards before applying (the `update` sets their whole `roleIds` / `roleRates`); a second run reports the two
people as „zmienione" again with the same values; M.J. can retire „Ja jako Asystent" afterwards (Solvo's old line keeps
1,400 / 1,400 until he edits it).

**Verified** on the production export served by `node scripts/serve-export.mjs 3011` (the preview tool does not read
the worktree's launch file; opened by URL), build checked by its strings and commit, with seeded localStorage (Morris,
Dräger, Tchibo ×2, Solvo, the patched crew and roles) restored afterwards to the two keys the origin had: Ekipa „Ja"
pill, card, moving „To ja" to Kamil and back; Morris A unchanged with Koszt/Klient columns and the rename notice; new
project → 0.5 day documentation, +15 %, detailed production → day 1 „ReżOp · Ja · Michał" 1,500 / 1,500, Operator × 2 →
Kamil splits off at 1,200 / 1,200, Klient 1,400 „ręcznie" (no stale notice), role → ReżOp refilled 1,500 / 1,500;
header „Koordynacja i produkcja: 750,00 zł"; PDF 600 / 4,500 + 765 = 5,865, −10 % → „Rabat −510 zł / Rabat od wyceny."
(4,590), 0 % → seven printed rows; Dräger PDF as before; Dräger copy B with the flag, draft kept + warning, update →
1,400 / 5,400 / 1,500 / 3,600 + 1,785; „Stawki ról" sheet over the calculator (no autofocus); reload keeps the flag and
line marks; phone width without horizontal scroll; no console errors besides the missing Vercel analytics script.

**Desktop-only checks for the main session** (installed app, after the patch):
1. Ekipa: Michał has „Ja"; Reżyser / Operator / Asystent listed; Kamil and Łukasz show their Asystent rate 1,000.
2. Nowy projekt → Produkcja szczegółowa: day 1 „ReżOp · Ja"; `projects.json` gets `marginAsLine: true` and the line
   with `clientFromPerson`.
3. Morris & Lloyd A: numbers and PDF as before; „zaktualizuj" only renames Asystent/Operator → Operator.
4. „Pobierz PDF" of a new quote with +15 %: „Koordynacja i produkcja" printed last; with 0 % not printed.
5. „Stawki ról" sheet in the app window (z-index over the sticky header, focus).

**Known limits / for R2.**
- The plan still counts a „Ja" line's Koszt as a cost (profit ≈ 0 on Klient = Koszt rows); D1 „Moja praca" is R2's.
- S5's report crew section (`crewOnProjects`) will count Realizacja rows of „Ja" as crew pay once they exist.
- The Realizacja person picker shows Michał without the „Ja" pill (components/realization untouched).
- Keeping ReżOp unrenamed breaks nothing: day 1 uses the built-in id `rezOp`. Renaming `asystent` to „Operator" means
  Realizacja rows with the role text „Asystent/Operator" (Morris, CIONET TribesDay — amounts untouched) no longer match
  a role by name: picking a person there uses their day rate, and a kit saved from such a day skips that row.
- Gear revenue (`equipment-roi`) of a flagged quote excludes the margin on old gear fields (the margin is not gear).
- No button converts an old stretched quote to the margin line (only Dräger has a margin ≠ 1.00); a copy does.

## 15. S5 as built

*(2026-10-18, branch `claude/s5-raport-okresowy`, on top of `v3/project-hub` `1ee75f5`.)*

M.J. answered the ten phase-1 questions as recommended: mock order plus a one-line „Wyceny w toku"; the .md starts with
the definitions and „Do wyjaśnienia"; W2 per project / group only in a year view (decision A); crew by the period's jobs;
marketing with both column sets and „od startu do dziś" as the headline; gear without forecasts beyond 10 years; a
previous period without a project or a recorded fixed cost is „brak danych"; „w drugim widoku wynik = X"; open invoices
as of the generation date; Polish text, English JSON keys with Polish labels; a third Finance tab „Raport".

**Where it lives.** Finanse → „Raport" (third tab, uses the page's Rok / Półrocze / Kwartał picker and the same „Rozłóż duże
zakupy sprzętu" switch, which is the same state as in „Projekty").
- `lib/period-report.ts` (pure): `buildPeriodReport(input, period) → PeriodReport`. Money comes from `marginSummary`
  ONLY (this period, the previous one, the other gear view, and one `scope`d call per client / group). Everything else
  calls its module: `openInvoices` / `paymentDays`, `effectiveFixedCosts` / `totalsBySubscription`, `summarizeCampaign`
  (a campaign clipped to the period, and unclipped for „od startu do dziś"), `computeGearReport`, `crewOnProjects`,
  `summarizePeriod` (quotes in progress). It adds period choice, grouping and comparisons, no money rules.
- `lib/period-report-sections.ts` (pure): `reportSections(report)` turns the report into formatted tables. The screen,
  the PDF sheet and the Markdown all render these, so „the same tables" is literal (a test checks every table is in the
  file verbatim).
- `lib/period-report-markdown.ts` (pure): definitions → „Do wyjaśnienia" → sections 1–8 → fenced JSON of the whole
  report. File name „Raport Q3 2026.md" (open period: „… (wstępnie)").
- UI: `components/finance/report-tab.tsx` (screen), `printable-report.tsx` (white A4 sheet), `lib/export-report.ts`
  (save). PDF goes through the call sheet's desktop path (`exportCallSheetPdf`: html2canvas-pro → jsPDF → native save
  dialog + `writeFile`); Markdown uses the same dialog and `writeFile`. No new permission.

**Report shape (open for R2).** `metrics[]` is a list of rows `{ key, label, unit, group, value, previous, change,
changePct, emphasis, pctOfRevenue }` (revenue, direct costs, W1, tax, ZUS, fixed, marketing, gear, company costs, W2,
paid, awaiting). Project and client rows carry `extra: Record<string, number | null>`. R2 adds „Marża producencka" as one
more `metrics` row and one `extra` key; the renderers take whatever is on the list (a test does exactly that). The rest
of the JSON: `period`, `provisional`, `view`, `definitions`, `alternativeView`, `pipeline`, `coverage`, `projects`,
`clients`, `payments`, `companyCosts`, `marketing`, `gear`, `crew`, `previous`, `notes`.

**Cases → behaviour** (all tested in `period-report.test.ts`):

| Case | Behaviour |
|---|---|
| Closed quarter / half / year | the report is a fact; title and files have no „wstępnie" |
| Open period (today inside it) | „wstępnie" in title, tile, file name, PDF; company costs to the end of the period from plan (subscription instalments, spread gear), the planned part named; note „Okres jeszcze trwa" |
| Month without jobs (builder only, the picker has no month) | no project or client rows, W1 = 0, W2 = −company costs, tables say „Brak projektów w okresie" |
| Gear switch on / off | koszty firmy and W2 change, W1 does not; the report names the view in its header and definitions, and adds „w drugim widoku wynik = X" (equals the other view's real report) |
| Client group | one row (members that have jobs in the period listed), sums from `marginSummary({ scope })`; W2 per group and per project only in a year view, otherwise `null` |
| EUR job | revenue in zł at the quote's frozen rate, row marked „EUR, kurs 4,3661", a note; an invoice in zł replaces the plan as everywhere |
| Previous period has no project and no fixed cost | `previous.hasData = false`: comparison columns „—", a note; carried gear alone does not count (2025 shows 28,858 zł of spread gear, but is „brak danych") |
| Previous period wraps the year | Q1 → Q4 of last year, H1 → H2, January → December, year → year |
| Project with an invoice in the period but its anchor earlier | row marked „tylko część przychodu w okresie", no costs, its crew and gear stay in the earlier period |
| Invoices | issued in the period (counted projects) listed; open invoices on the generation date, all periods, `issuedInPeriod` marked, 30-day term marked „przyjęty", invoices without amount counted apart |
| Crew | by the period's jobs (anchored, counted): paid and days of the job even when the calendar day falls later (a note says so) |
| Gear forecast | payoff month only within 10 years, otherwise „powyżej 10 lat" |

**„Do wyjaśnienia" — what is listed instead of chosen** (`notes`, kind `disagreement` / `gap` / `info`): Marketing's ROAS
revenue is the frozen plan, Finanse's is invoices and extra sales (listed per job when they differ); Marketing spend is a
panel reading or a budget estimate, the ledger counts entered costs only (listed when they differ); Ekipa counts Realizacja
rows only (paid vs direct costs of the period) and dates a day by the calendar; gear without a purchase date is outside
company costs but inside „zainwestowano" of the payoff stats. Gaps: jobs without Realizacja costs (plan), invoices without
amount, deposits, jobs without amount, unpriced / retired gear, crew names outside Ekipa. `payments.paymentSplit` (plan-based,
unused by the UI) is not used.

**Real data, read-only (2026-10-18, hub folder only read; the hub was open and M.J. was editing, so figures move).**
Q3 2026 vs Q2: revenue 73,325 vs 84,690 zł; W1 50,460 (69 %) vs 36,210; company costs 31,058 vs 29,656 (tax 6,233,
ZUS 4,193, fixed 3,827, marketing 1,306, gear 15,500 spread); W2 19,402 vs 6,554 spread, 26,535 in the cash view; paid
15,145, waiting 58,180. 2026 year: 192,334 / 115,689 / 96,179 / 19,510 zł, equal to the Finance „Projekty" tiles (checked
side by side); 2025 is „brak danych". Q4 2026 is „wstępnie" and carries Tchibo Event as EUR at 4.3661.

**Tests:** 728 (690 before, +38 in `period-report.test.ts`): parity with `marginSummary`, comparison and year wrap,
month without jobs, open vs closed period, no previous data, gear view and alternative line, groups and year-only W2, EUR,
payments, marketing clipping and disagreements, crew by jobs, notes, Markdown order, verbatim tables, JSON round trip,
fence and pipe escaping, the R2 hook. 55 deliberate mutations, 55 caught (13 survived the first pass and got tests).
`npx tsc --noEmit` clean.

**Verified on the production export** (`npm run build`, served on port 3012, real hub data copied into the page's
localStorage, restored afterwards): Q3, Q4 (open), year with and without previous data, switch off and on, the groups,
EUR; tiles identical to the Finance tab for 2026; Markdown download (50 KB, JSON parses); PDF (4 pages, Polish letters,
cuts between rows after a fix that stopped headings and table headers being cut points); phone width, no horizontal page
scroll (tables scroll inside their cards).

**Desktop-only checks for the main session** (installed app, real data):
1. „Zapisz PDF" opens the native save dialog, writes the file (4 pages for Q3), Polish letters and page cuts look as in
   the browser (html2canvas on WKWebView).
2. „Zapisz Markdown + JSON" opens the dialog with a .md filter, writes UTF-8; the JSON block parses.
3. After a restart the tab shows the same numbers as „Projekty" for the same period; the switch survives.

**Known limits / next:**
- The picker has no month (the builder supports it).
- The PDF table header is not repeated on the next page (same as the call sheet).
- Ekipa shows Realizacja rows only; most jobs still carry plan costs without people.
- ROAS per period is the lead cohort of the period, which can include jobs from later quarters; the since-start columns
  are the headline.
- R2: add the „Marża producencka" metric row and `extra.producerMargin`; nothing else in the report changes.

## 16. R2 as built

*(2026-10-18/19, branch `claude/r2-realizacja-finanse`, on top of `v3/project-hub` `506bce4`.)*

**Decided with M.J. (2026-10-18), after the phase-1 report:** (1) producer margin company-wide = the sum of the
projects' producer margins, AFTER tax; the company result stays S4's „Wynik po kosztach firmy"; EBBT is §17.2, not R2;
(Q2) option A — the first change in Realizacja writes the whole draft as lines, later quote edits only through a banner;
(3) „Zacznij od wyceny" for pre-R2 projects, as a quiet button with a confirmation, the cost change and „Cofnij"; every
nagging list hideable per project („Ukryj", back when the quote changes again); (4) no data patch for old unticked
lines (decision 8) — M.J. marks „Moja praca" himself.

**One cost model.** `Project.costs` is the only list of actual costs; the plan is the calculator (price-list costs, no
margin) with the old Profit overrides and custom items still applied (they stay in the quote; the editor is gone).
`lib/realization-costs.ts` (pure):
- **draft** — no live line yet: Realizacja shows the plan from the live quote (`quotePlanRows` → `draftCosts`), nothing
  is stored, Finance counts the plan; same total.
- **first change** (tick, amount, pill, person, added line, kit, „ta sama ekipa", move) → `startFromQuote` writes every
  draft line (`planKey`, `source: 'plan'`) and sets `Project.costsFromQuoteAt`, then applies the change. From then on
  Realizacja is the truth. Hand changes mark the line `edited`.
- **quote changed later** → `quoteChanges`: added (key in no record, deleted ones included), changed (never-edited line
  whose plan values differ), removed (never-edited line whose key is gone). Banner „Wycena zmieniła się: +N / ~M / −K,
  koszty ±X zł[, moja praca ±Y zł] · Pokaż · Uwzględnij · Ukryj"; „Uwzględnij" (`applyQuoteChanges`) adds, overwrites
  and soft-deletes only those lines, with „Cofnij".
- **pre-R2 costs** (live lines, no `costsFromQuoteAt`): counted exactly as entered. `missingFromQuote` lists plan lines
  not visible there (a day that already has crew covers its crew; a category already entered anywhere covers its plan
  lines; quick crew is covered by any crew) as „W wycenie, nie ma w Realizacji" with „Dodaj", „Dodaj wszystkie", and
  the plan's unticked lines („Dodaj jako Moja praca" / „jako koszt"); nothing counts until added and the mode stays.
  The quiet „Zacznij od wyceny…" (`restartFromQuote`) soft-deletes the entered lines with one stamp and starts from the
  plan, after „Koszty w Finansach: X → Y zł"; „Cofnij" restores the previous list and marker.
- „Ukryj" stores the list's signature per project in localStorage (`nonoise-realization-hidden-v1`, a UI preference
  like „Pomiń" in the import); a different signature (the quote changed again) shows it again.

**Data (additive, optional, no version bump).** `ProjectCost.planKey`, `skipped` (unticked: didn't happen, counts
nowhere, stays visible), `ownWork` („Moja praca": not a cost, valued at the line's amount), `edited`;
`Project.costsFromQuoteAt`; `QuoteCrewLine.ownWork` (set when „Ja" is picked — `createQuoteCrewLine`, `withCrewPerson`,
day 1 „ReżOp · Ja", kits; „zaktualizuj stawki" flags a pre-R2 Ja line and lists it as stale until then);
`ProjectFinancials.ownWork` (only when > 0) and `revenueSource` (`transfer` / `pdf` / `calculator`).

**Money.**
- Plan revenue `financials.sumaNetto` = typed transfer, else the chosen variant's PDF total (`approvedPrice`: EUR × the
  quote's frozen rate; a pre-S3 EUR draft on a PLN quote × the draft's rate), else the calculator. `koszty` = external
  plan costs; Ja lines are `ownWork`.
- Money loop: expected = typed transfer (the whole transfer, extras included) or plan + extra sales; a typed transfer is
  also recognised from the quote when financials predate R2 (`isTypedTransfer`). Invoices win as before. Costs =
  counted external lines, `ownWork` = counted own lines; T6's „partial in production keeps the plan" compares
  Realizacja (costs + own work) with the plan (costs + own work). `profit` = Marża (zysk netto), `producerMargin` =
  profit − own work, `producerMarginPct`.
- Margin ledger rows: `ownWork` (anchored, like costs) and `producerMargin` = W1 − tax − own work; totals sum them.
  Finance has a fifth tile „Marża producencka" (marża − podatek − Twoja praca, % of revenue). S5: metric row
  `producerMargin` after W1, `extra.producerMargin` on projects and clients, a definition. Crew stats skip unticked rows.

**Screens.**
- **Realizacja:** B1/B4 done (summary, Profit collapsible and `profit.tsx` / `plan-section.tsx` /
  `realization-summary.tsx` removed; „Przepisz ekipę z planu" replaced by the draft). B2 „Koszty projektu" on top with
  its total (external + „moja praca"). B3 day cards hold „Ekipa i sprzęt": crew, rentals, other day costs, „Mój sprzęt N
  pozycji z katalogu — bez kwoty"; a quick quote's crew sits in „Ekipa z szybkiej wyceny — wszystkie dni" above the
  days; a quote day without a Realizacja day is a „Dzień N z wyceny" card after them with „Przenieś do dnia…". Every
  line: tick + „Zewnętrzny | Moja praca" (hidden on unticked lines). The person picker shows „Ja"; picking Ja sets
  Moja praca, another person clears it. Gear grid, packing list and call sheet unchanged.
- **Finanse (project tab, between Realizacja and Notatki):** big „Zatwierdzona cena" (source, € × rate, calculator
  difference „to normalne"); „Kwota finalnego przelewu" (price + extras; a typed number is the override, „z ceny"
  resets it; a higher one offers „Zapisz różnicę jako dosprzedaż", which writes `extra_sale` and clears the override,
  with „Cofnij"; a lower one says „O X zł mniej"); extras and invoices listed; tiles „Zysk netto (marża)" and „Marża
  producencka"; the breakdown with an editable ryczałt; the plan-vs-Realizacja table by category with „Moja praca".
  A retro project is read-only („z importu").

**Real-life cases, as built** (tests in `r2-money.test.ts`, `realization-costs.test.ts`, `project-finance.test.ts`,
`period-report.test.ts`):

| Case | Behaviour |
|---|---|
| Ticked / unticked | ticked counts (cost or own work); unticked = didn't happen, counts nowhere, stays visible; old „nie mój koszt" lines arrive unticked |
| Moja praca / Zewnętrzny | own work is not a cost: an external line switched to Moja praca raises Marża by its amount, Marża producencka stays; an unticked line ticked as Moja praca leaves Marża and lowers Marża producencka |
| A Ja line | quote: own work in the plan, not koszty (new quote day 1: koszty 0, ownWork 1 500, zysk 1 372,50 instead of −127,50); Realizacja: Moja praca by default |
| „Ja jako Asystent" role without the Ja card (Solvo) | no person → Zewnętrzny; unticked there; M.J. ticks + Moja praca, or picks Ja |
| Realizacja day not in the quote / quote day without a Realizacja day | empty day with „+ Osoba / + Koszt dnia" / „Dzień N z wyceny" card, counted, „Przenieś do dnia…" |
| Quote edited after Realizacja started | nothing rewritten; banner; edited lines never touched; removals soft |
| Another variant chosen (Q2) | financials by the PDF rule of the new variant (the dialog shows them); draft follows; started Realizacja gets the banner |
| Post-production, gear bought | Koszty projektu; a bought item via „+ Koszt projektu" (`sprzet`); catalogue purchases stay in S4 |
| Rental vs own gear | rentals are external lines in `wynajem` (project-wide „Wynajem sprzętu" or per day); own gear „mój sprzęt", no amount, no pill |
| Extra sale | final transfer = price + extras; expected + extra (T6) |
| Hand-typed transfer | override incl. extras; gap → „Zapisz różnicę jako dosprzedaż" (same number after); lower = text only |
| Invoice | wins; Finanse lists it; an invoice without an amount is named |
| EUR job | PDF € × the quote's rate (Tchibo Event 1 460 € × 4,3661 = 6 374,51 zł); costs in zł |
| Retro project | price and costs from the import, read-only, no lines |
| Lost project | numbers shown with „nie wchodzą do Finansów firmy"; counted nowhere |
| Old „Asystent/Operator" rows | text kept; `crewRoleByName` maps the old name to role `asystent` (now „Operator"), so person rates and kits work |
| Pre-R2 Realizacja | as entered; missing plan lines listed (JHJ: AI 600, wynajem 1 500, „lukasz" 1 000, dysk 325, dojazd 1 300 = 4 725 zł); „Zacznij od wyceny" |

**Real data (read-only; snapshots 2026-10-18 22:26 / 23:23 and 2026-10-19 03:11 — `projects.json` unchanged since
22:37, hash `93ebfa94`).** `real-data-check.mts` (now also printing money per project and Ja lines without the flag),
base `506bce4` vs branch: every project's best-known revenue and costs and every year identical; `computed` financials
move only for Tchibo Event (6 501,12 → 6 374,51) and UAM (lost, 8 238 → 8 630); no unflagged Ja lines. Stored
financials change only with the patch below; with it simulated on a copy: those two projects and Finance 2026 — revenue
202 384,35 → 202 257,74, tax 16 348,42 → 16 337,66, project profit 113 115,93 → 113 000,08 — nothing else; costs
72 920 unchanged. Every other project's Marża producencka = its Marża (no own work recorded yet). Not caused by R2: JHJ
costs 8 700 (crew entered on 18.10, done → actual; plan 12 425) and Zabudowy 0 (an empty „Sprzęt 0 zł" line); JHJ also
got an empty „Sprzęt 0 zł" line at 22:37 (the old „Koszt projektu" default; R2's default is „Inne").

**Data patch for the main session** (hub closed, regenerate first — M.J. edits live):
`node --import ./scripts/register-ts.mjs scripts/r2-pdf-price-patch.mts > imports/2026-10-18-r2-pdf-price.json`, check
the list it prints (expected: Tchibo Event, UAM), `npm run data -- apply imports/2026-10-18-r2-pdf-price.json --dry-run`,
then without `--dry-run`. The committed file is the 23:23 version (2 changed; dry run on the real folder: „2 zmienione",
nothing written). Without the patch the two would move at their next quote save.

**Tests:** 810 (761 before; +49: `r2-money` 21, `realization-costs` 19, `project-finance` 8, `period-report` +1; the
`quote-currency-legacy` golden keeps every number except `legacyEurPdf`'s financials and plan, which now follow its PDF
— asserted explicitly). 63 deliberate mutations across quote-financials, profit-calc, quote-crew, project-costs,
money-loop, realization-plan, margin-ledger, period-report, crew-stats, crew-types, realization-costs, project-finance and
pdf-draft: 56 caught at first; 6 survivors got tests (anchored own work in the ledger, a person only on the first copy,
deleted-only rows = draft, skipped own work in the banner delta, plan revenue source, `pdfRowsTotal` without rows); one
was an equivalent branch and was removed — 62 / 62. `npx tsc --noEmit` clean; `npm run build` passes.

**Verified on the production export** (`npm run build`, `node scripts/serve-export.mjs 3013`, opened by URL; build
checked by its strings; real data with the patch simulated copied into the page's localStorage, restored afterwards to
the two keys the origin had, from a non-app page so nothing wrote back): Tchibo Event Finanse 6 375 zł from the PDF
(1 460 € × 4,3661, kalkulator 6 501); S-AI 67 800 PDF, typed 80 440, „Zapisz różnicę jako dosprzedaż (+12 640 zł)" →
extra sale, same 80 440, „Cofnij" restored both; S-AI Realizacja draft (Koszty projektu 8 320 + quick crew 40 160), first
tick wrote all lines, Montaż → Moja praca → Marża producencka 13 123 zł (16,3 %), zysk unchanged 25 123; Morris (pre-R2):
lines as entered, missing list „nic liczonego · odznaczone 1", „Ukryj" kept after reload, „Zacznij od wyceny…" showed
5 300 → 5 300, replaced and „Cofnij" restored the costs byte for byte; JHJ missing list 5 (4 725 zł) + 5 unticked, „ja na
planie" added as Moja praca → producer margin 11 289 zł, costs still 8 700; new project → day 1 „ReżOp · Michał" with the
„Ja" pill and Moja praca, financials koszty 0 / ownWork 1 500; first change, then two quote edits → banner „+1 … moja praca
+1 500 zł", „Uwzględnij" → „Dzień 2 z wyceny" card after Dzień 1, „Ukryj" survived a tab switch and came back after the
next edit; company Finance 2026: 202 258 zł, Marża producencka tile 113 000 zł, result 33 169 zł; Raport row „Marża
producencka 113 000 zł · 56 %". Phone width: tabs scroll sideways, rows wrap; the page is 29 px wider only because of the
known top bar. No console errors besides the missing Vercel analytics script.

**Desktop-only checks for the main session** (installed app, after the patch):
1. Tchibo Event → Finanse: 6 375 zł from the PDF; company Finance 2026 revenue 202 258 zł.
2. A project in Realizacja: the first tick writes the lines (`projects.json` gets `costsFromQuoteAt` and `planKey`s);
   close the window right away (red button) — after restart the tick and the lines are there.
3. „Ukryj" on a banner survives an app restart (localStorage in WKWebView).
4. „Zapisz różnicę jako dosprzedaż" puts an `extra_sale` in `events.json` and clears `profitTransferAmount`.

**Known limits / next:**
- A quote crew line of the Ja card made before R2 counts as a plan cost until „zaktualizuj stawki" (or a re-pick) flags
  it; the release check lists such lines (none today).
- The open/closed state of the lists resets when the events reload on window focus (as other local state in the tab).
- The draft and the money loop agree only after the quote's ~0.6 s autosave (Finance reads the saved financials).
- Fuel price / consumption are no longer editable (the plan keeps their saved values; Realizacja edits km and zł/km).
- Rentals: lines stay in category `wynajem` (project-wide „Wynajem sprzętu" and day rentals) for §17.1 to sum.

## 17. Next: rentals as one source of truth, and EBBT *(planned with M.J. 2026-10-18 — not built yet)*

### 17.1 Rentals („Wynajem sprzętu")
**Why.** Gear payoff on a shoot („odpracował") must be the quote's gear line minus what was paid for rentals.
Rental costs live in several places today: quote day rentals (`QuoteExternalRental`), the plan's „wynajem"
lines, Realizacja costs, and S4's direct costs. The app needs ONE number per project, the **rental total**, that
every other place reads.
- **Realizacja:** a fixed line „Wynajem sprzętu" near the top (in „Koszty projektu"), always there (0 zł when
  nothing was rented). Typing a total is enough; listing items is optional.
- **Items:** what was rented, picked from a dropdown or created on the spot (like a new person or role in the crew
  picker), with an amount (optionally days and the rental house). The picks form a dictionary of rented gear
  (its own small collection, or catalogue items of a „wynajem" kind — the session decides). The session also
  decides how a typed total and listed items combine (e.g. items sum up, with the rest shown as „bez szczegółów
  X zł").
- **Sprzęt tab:** a section „Wynajmowany sprzęt" aggregating the picks: item, times rented, days, total spent,
  last rental, per year. This is the basis for deciding whether to buy instead of rent.
- **Company Finanse (main tab, not the project tab):** rental spend per period, top rented items, plus a row in
  the S5 report.
- **Readers of the one number:** the gear payoff denominator (gear line − rental total), layer 1 direct costs,
  and the S5 report.
- **Open (four layers, ARCHITECTURE.md):** the gear line should be the PDF's gear row(s), since M.J. reshuffles
  people and gear there, falling back to the calculator — confirm in the session.
- **Rules:** additive; existing quote rentals and Realizacja rental costs map into it without changing any
  number.

### 17.2 Company result, producer margin and EBBT
- **Company result** = the sum of the projects' net profit after all costs and taxes: S4's „Wynik po kosztach
  firmy" (after tax, ZUS, fixed costs and subscriptions, gear and marketing). Crew and everything else paid out
  on jobs is already deducted in project profit.
- **Producer margin, company-wide** = the sum of the projects' producer margins, after tax (decided 2026-10-18;
  built in R2).
- **EBBT, „earnings before bad things"** = revenue − direct costs − ryczałt − ZUS. It leaves out everything M.J.
  could in theory skip: gear purchases, subscriptions and other fixed costs, and marketing. Taxes and ZUS can't be
  skipped; crew costs are already in project profit.
  - **The gap EBBT − company result** = the room to optimise the business.
  - **Where:** a Finance tile or line next to the result, and a `metrics[]` row in the S5 report. EBBT is the
    same in both gear views.

### 17.3 Session
One session after R2 is merged („F2 Wynajem i EBBT"): the Realizacja line and items, the rental dictionary, the
Sprzęt section, Finanse stats, the payoff denominator, the EBBT tile and the report row. It builds on R2's cost
model (`Project.costs` with `planKey`, `skipped`, `ownWork`).

## 18. Small fixes to make the hub usable *(M.J. feedback 2026-10-24)*

### 18.1 Items
- **U-PDF:** the PDF editor becomes its own project tab „PDF", between Wycena and Realizacja (with the variant
  pills, since each variant has its own PDF). Today it is a sub-tab inside the calculator.
- **U-SUMA:** Realizacja gets a total at the top (all categories together; today there are only per-category
  totals). Next to it:
  - the PDF total;
  - what the gear earned (from the PDF);
  - the reconciliation = PDF − (Realizacja total + gear earned): quoted in M.J.'s favour or against him.

  It never reconciles exactly. Pricing his own work as he feels it should be priced shows whether he misquoted.
- **U-GEAR — „ile zarobił" (gear) is wrong.**
  - What a job's gear earned = the PDF's „Sprzęt" row (what the client was charged for his gear).
  - It is split between the catalogue items used on that job, in proportion to their day rental prices. Example:
    1,000 zł, items at 70 and 30 zł / day → 700 and 300.
  - Shown per item in the Sprzęt section (left menu). Payoff (earned back vs purchase price) follows from the
    same numbers. „Ile odpracował" works and stays.
- **U-DOJAZD:** in Realizacja „Koszty projektu", fuel / travel is one plain amount (default from the quote,
  editable), not km × zł/km.
- **U-CENA (project Finanse tab):** „Zatwierdzona cena" can be refreshed from the PDF with a button („Odśwież z
  PDF") and edited by hand (an override, when there's no time to change the PDF). Today it looks stuck: the PDF
  changes, the old number stays, and it can't be edited.
- **U-DOSPRZEDAŻ:** more control over extra sales.
  - Each extra sale gets a category (picked from a list or created on the spot, like a new person or role), a
    phase (before / on set / after the project), an amount and a note.
  - The Finanse tab lets him state directly: the final price, the money that reached his account, and the extra
    sale(s) with their category — so the numbers are right without massaging the rest of the hub.
  - Company Finanse: how often he upsells, average amount when it happens, by category and phase; plus an S5
    report row.
- **U-LISTA — bug:** the project list reads the frozen plan (`Project.financials`), while the project Finanse tab
  reads the money loop. JHJ, 24.10:
  - the list shows 22,250 zł / zysk 7,934;
  - Finanse shows 26,340 zł (PDF 22,250 + extra sales 4,090) / zysk 11,676 (Realizacja costs 12,425, own work
    10,100, marża producencka 1,576 = 6 %).

  Fix: every screen that shows a project's money reads the money loop (`projectMoney`), never `financials`
  directly. Audit the other readers.
- **Old quotes:** no special work. M.J. will revisit them; it is enough that every number can be overridden
  (U-CENA, U-DOSPRZEDAŻ, Realizacja lines).
- **Planned in §17, joins these sessions:** rentals as one number (§17.1, belongs with U-GEAR / U-SUMA) and EBBT
  (§17.2, belongs with company Finanse).

### 18.2 Sessions
| Session | Model | Contents | Runs with |
|---|---|---|---|
| **U1 Projekt: PDF i Finanse** | Opus | U-PDF, U-CENA, U-DOSPRZEDAŻ (incl. company stats and the report row), U-LISTA, EBBT (§17.2) | U2 |
| **U2 Realizacja i sprzęt** | Opus | U-SUMA, U-GEAR, U-DOJAZD, rentals (§17.1) incl. the Sprzęt „Wynajmowany sprzęt" section and one rental figure in company Finanse | U1 |

U1 owns the project tab bar, the PDF placement, the project Finanse tab, the project list, the money loop's
extra sales and the margin ledger (EBBT). U2 owns components/realization/*, the gear catalogue and payoff
(`equipment-roi`, `gear-usage`) and the rental data. Both only read the PDF draft (`pdf-draft`). Both may add a
row to company Finanse and the S5 report; the main session merges those.

### 18.3 Decisions (M.J. 2026-10-24)
1. **What a job's gear earned** = the PDF's „Sprzęt" total − the Realizacja rental total (category `wynajem`),
   by default. Sometimes M.J. bills a rental as a separate line, so the PDF gear row already shows only his own
   gear; for that he can override the figure per project.
2. **Split between items:** day rental price × days on set. Items come from the Realizacja gear grid, else the
   quote's gear. Items without a day price are listed „bez stawki" and get nothing. Zaplecze never counts.
3. **Reconciliation in Realizacja** = PDF total − (external costs + own work + gear earned), before tax.
   + = quoted in his favour, − = against him. The „Koordynacja i produkcja" line is part of the PDF, so it counts
   in his favour.
4. **Zatwierdzona cena** stays as approved. When the PDF differs it shows „PDF: X zł · Odśwież"; it can also be
   typed by hand.
5. **Extra-sale categories to start with:** dodatkowa produkcja, dodatkowa postprodukcja, surowe materiały
   (more can be added on the spot). Phases: przed realizacją, na planie, po projekcie.
6. **Money received:** the amount and date are entered in the Finanse tab and saved as a payment event on the
   timeline. Invoices still decide revenue when there is one.

## 19. U1 as built

*(2026-10-24, branch `claude/u1-pdf-finanse`, on top of `v3/project-hub` `ff6289b`; ran beside U2.)*

**Decided with M.J. (2026-10-24), after the phase-1 report — all as recommended:** (1) the approved price freezes when a
project goes to W realizacji / Zrealizowany and when a variant is chosen on an accepted project; the 11 accepted projects
get today's PDF total by a patch, so nothing moves; (2) the „Kwota finalnego przelewu" input is replaced by a read-out
„cena + dosprzedaż" and „Wpłynęło na konto" (amount + date → payment event); a payment above price + extras offers „Zapisz
różnicę jako dosprzedaż"; typed transfers already saved (S-AI 80,440, CIONET wywiady 3,260) keep counting; (3) T6 stays: a
payment without an invoice anchors the project on the payment date; the amount on the account is NET; (4) Marketing ROAS
and „Pochodzenie klientów" move onto the money loop; (5) the stuck price was JHJ „and some others"; the list numbers after
the fix make sense to him.

**Why the price looked stuck (phase-1 finding).** The project Finanse tab already followed the chosen variant's PDF live
(checked on the export: JHJ PDF +500 → Finanse 22,250 → 22,750 at once). It looked stuck when another variant's PDF was
edited (Finanse counts the chosen one; Wycena remembers the viewed variant — Morris & Lloyd rolki ✓A / B), when a typed
transfer or an invoice decided revenue (S-AI 80,440 vs PDF 67,800; JHJ and M&L Broker until 23/24.10), when a retro
project's PDF edit waited for the import question (Finanse kept „Projekt bez wyceny" with nothing editable — YoPro), and
on the project list (saved plan, U-LISTA). The price itself could not be typed anywhere. All four now have an answer:
the variant note (PDF and Finanse tabs), the frozen price with „PDF: X zł · Odśwież" and „Zmień", the pending-import
sentence, and the list on the money loop.

**Data (additive, optional, no version bump).**
- `QuoteData.approvedPrice?: { pln, source: 'pdf' | 'calculator' | 'typed', at, amount?, currency?, rate? }` in the chosen
  variant's quote (like `profitTransferAmount`); read only through `approvedPriceRecord` (a broken record = none). An older
  build keeps the field (data passthrough) and prices from the PDF as before.
- `ProjectFinancials.revenueSource` gains `approved`; an older build reads it as „missing" and adds extras as before
  (`isTypedTransfer` stays false — the approved price is not a transfer).
- `extra_sale.data.category?` (free text) and `phase?` (`before` / `on_set` / `after`; any other value reads as none);
  `what` is the note. No category file: the list is the three seeds (dodatkowa produkcja, dodatkowa postprodukcja, surowe
  materiały) plus every category already used, case- and space-insensitive (`extra-sales.ts`). The calendar form gets a
  „Kategoria" field with the seeds as suggestions.
- Payments from the Finanse tab are ordinary `invoice_paid` events with `data.amount` (net); a payment ticked without an
  amount gets its amount filled in the same event.

**Money.**
- **One function for plan revenue**: `planRevenue` / `snapshotPlanRevenue` (`quote-financials.ts`): typed transfer →
  approved price → the chosen variant's PDF → calculator. `quotePlnPlan`, `financials`, the project Finanse tab and (after
  merge) U2's Realizacja reconciliation read it.
- `approved-price.ts`: `statusChangePatch` (quote / lost → won / done freezes the chosen variant's PDF — or calculator —
  total and recomputes `financials`; the revenue number does not change), `withFrozenPrice`, `withoutApprovedPrice`. The hub
  flushes the project's quote documents before a status change, so the freeze sees what is on screen. `chooseVariantPlan`
  freezes the new variant's price on an accepted project; a variant that already has its price keeps it, so „Cofnij"
  returns to the cent. „+ Wariant" (copy) drops the price; „Wyczyść" / „Wyzeruj" keep it (`clearedDoc`, now in
  `quote-documents.ts`).
- Project Finanse (`project-finance.ts`): price state `live` (quote / lost: follows the PDF), `frozen`, `typed`; `pdfDiff`
  from 0.50 zł; `typedPrice` (equal to the PDF = freeze on an accepted project, back to live on a quote), `refreshedPrice`;
  `due` = price + extras; the legacy transfer with its gap; `received` = payments, whether an invoice decides (an issued
  invoice with its own amount), the gap above the base (typed transfer, else price + extras) and the shortfall.
- **EBBT** (`margin-ledger.ts`, §17.2) = W1 − ryczałt − ZUS on `MarginTotals.ebbt` (company always; a client filter only in
  the year view, with its revenue share of ZUS) and `ProjectMargin.ebbt` (year view). The same in both gear views.
- **U-LISTA**: `listMoney` (`project-list.ts`) — the list shows the money loop's revenue and profit; Klienci rows of quotes
  and lost projects, the Finance „Wyceny (niewliczone)" list, the „w wycenach X" tile and the report's „Wyceny w toku"
  (`summarizePeriod(…, money)`), Marketing ROAS / profit / pipeline (`summarizeCampaign({ money })`) and „Pochodzenie
  klientów" (`originBreakdown(…, money)`) all read the loop. `useProjectMoney` uses the company tax rate like Finance. The
  report's „ROAS z planu" disagreement (`marketing_revenue`) is gone — there is nothing left to disagree about.
- Stay on the plan by design: the variant comparison „Zysk (plan)" and the choose dialog, the header's import question.

**Screens.**
- **Project tab „PDF"** between Wycena and Realizacja: the variant pills (the same viewed variant as Wycena) and the PDF
  editor of that variant (`QuotePdfView`: `QuoteDocScope` + `PodgladPdfTab` keyed `docId:docEpoch`); the calculator
  sub-tab is gone. Autosave, the project flushes, „Pobierz PDF" and „Wycena wysłana" are the same code. The header talks
  about the viewed variant on Wycena and PDF. A non-chosen variant says „Ten wariant nie jest wybrany do rozliczeń —
  Finanse projektu liczą wariant A"; Finanse says the same when another variant is being viewed.
- **Project Finanse**: „Zatwierdzona cena" (on a quote „Cena (jeszcze nie zatwierdzona)") with „Zmień" (typed, Enter /
  Escape), the source line (frozen date, PDF / calculator, € × rate), „PDF: X zł (±d) · Odśwież"; „Dosprzedaż" (list with
  category, phase, date, note, amount; add / edit / delete with „Cofnij"; category picker with „+ Nowa kategoria"); „Do
  zapłaty (cena + dosprzedaż)"; a legacy typed transfer with „Zapisz różnicę jako dosprzedaż" and „Usuń"; „Wpłynęło na
  konto" (payments, fill an amount-less one, „+ Wpłata" net + date with the anchor sentence, the gap button, the
  shortfall); the R2 tiles, breakdown and plan-vs-Realizacja table unchanged.
- **Company Finanse**: tiles in a 3 × 2 grid with **EBBT** next to the result („pole do optymalizacji X zł — sprzęt,
  subskrypcje i stałe, marketing", „taki sam w obu widokach sprzętu"); a **Dosprzedaż** panel (how often, average per
  project with extras, total, by category and by phase). Report: metrics rows `extraSales` („w tym dosprzedaż", after
  revenue) and `ebbt` (before W2), definitions, `extra.extraSales` on project rows (anchored projects only).

**Real-life cases, as built** (tests in `approved-price.test.ts`, `project-finance.test.ts`, `extra-sales.test.ts`,
`u1-money.test.ts`, `margin-ledger.test.ts`, `period-report.test.ts`, `quote-documents.test.ts`):

| Case | Behaviour |
|---|---|
| PDF changed after approval | JHJ stays 22,250 with „PDF: 22,750 zł (+500 zł) · Odśwież"; revenue 26,340 until „Odśwież" (→ 26,840) |
| Typed price | Morris 12,500: counts, „Wpisana ręcznie", „PDF: 11,980 (−520) · Odśwież"; equal to the PDF = a freeze (accepted) / back to live (quote) |
| Variant swap on an accepted project | B's PDF frozen (10,300); „Cofnij" back to A's own price, financials to the cent; on a quote nothing freezes |
| EUR | Tchibo 1,460 € × 4.3661 = 6,374.51 zł frozen with amount and rate; a new rate shows „PDF: X zł · Odśwież"; revenue stays |
| No PDF draft | Zabudowy, Solvo ×2, Event after movie: the calculator total freezes the same way |
| Retro import, no quote | read-only „z importu", invoices decide; a PDF edit waiting for „Zastąp" is named in Finanse |
| Extra sale with / without category, each phase | from the list or new; phases przed realizacją / na planie / po projekcie; old ones „bez kategorii · bez fazy"; amounts and revenue as before |
| Payment, invoice with amount | the invoice decides; the payment only pays it; no gap offer |
| Payment, invoice without amount (S-AI, CIONET wywiady, M&L Broker) | the payment's amount becomes the invoice amount; anchor stays the invoice date |
| Payment, no invoice | revenue = payment on the payment day (T6), anchor moves there; above price + extras → „Zapisz różnicę jako dosprzedaż" (same number after); lower → „O X zł mniej"; W realizacji and lower → plan, „wpłynęło X z Y" |
| Typed transfer before R2 (S-AI 80,440) | still the whole transfer; price frozen at 67,800 separately; gap 12,640 → extra sale or „Usuń" |
| Lost project | numbers greyed, „nie wchodzą do Finansów firmy"; price not frozen; not in the extra-sale stats |
| List vs Finanse | the list = the project Finanse tab for every project (6 rows move, below) |
| EBBT | W1 − ryczałt − ZUS, same in both gear views; client filter only in the year view |

**Real data (read-only; `projects.json` 13:37 and `events.json` 13:33 of 24.10, unchanged through the session — read at
14:00 and 18:51, hashes `2b3e2662` / `2e768f13` at the end).** `real-data-check.mts` (now also printing the list figure,
the price, extras with category / phase, EBBT in both gear views and the extra-sale stats), base `ff6289b` vs branch: all
15 quotes' computed and stored financials identical, 2026 identical (revenue 203,977.74, tax 16,483.86, costs 78,995,
project profit 108,498.88), every project's best-known revenue, costs, profit, own work and producer margin identical. Only
the list display moves, as confirmed:

| Project | List before | List after (= Finanse) |
|---|---|---|
| JHJ — Film na 25lecie | 22,250 / zysk 7,934 | 26,340 / 11,676 |
| M&L Broker — Pakiet Reels | 13,180 / 4,750 | 16,200 / 7,513 |
| CIONET TribesDay II | 8,200 / 6,003 | 9,400 / 7,101 |
| Event after movie — Tribes Day | 7,810 / 96 | 7,810 / 5,946 (z faktur) |
| Morris & Lloyd — rolki | 11,980 / 5,662 | 11,980 / 4,912 |
| Zabudowy Warszawa | 10,050 / 9,050 | 10,050 / 10,050 |

Marketing (confirmed move): the spring B2B campaign's won revenue 115,870 → 122,980 (JHJ +4,090, M&L Broker +3,020),
profit +6,505; „Pochodzenie": Google Ads +7,110 / +6,505, Powracający +1,200 / +6,198, Polecenie zysk +1,000. 2026 EBBT
90,894.68 zł (45 % of revenue) in both views; result 28,668 (spread) / 56,807 (cash) → room to optimise 62,227 / 34,088.
Extra sales 2026: 3 of 23 counted projects (13 %), 8,310 zł, 2,770 average, all „bez kategorii".

**Data patch for the main session** (hub closed, regenerate first — M.J. edits live):
`node --import ./scripts/register-ts.mjs scripts/u1-approved-price-patch.mts > imports/2026-10-24-u1-approved-price.json`,
check the list it prints (expected 11: Morris rolki 11,980, Tchibo Event 6,374.51, Solvo Grodzisk 1,800, CIONET TribesDay
II 8,200, Solvo CeZ 4,200, CIONET wywiady 3,260, M&L Broker 13,180, Event after movie 7,810, JHJ 22,250, Zabudowy 10,050,
S-AI 67,800 — none „POMINIĘTY"), `npm run data -- apply imports/2026-10-24-u1-approved-price.json --dry-run`, then without
`--dry-run`. It sets `quote` (the raw snapshot + `data.approvedPrice`) and `financials` (same numbers, `revenueSource`
`approved` / `transfer`). Simulated on a scratch copy with `npm run data -- apply --dir`: „11 zmienione", the check
identical before / after except `revenueSource`; the committed file is a fresh read (dry run on the real folder:
„11 zmienione", nothing written). Without the patch those projects keep following their PDF until „Odśwież" / „Zmień".

**Tests:** 848 (810 before; +38: `approved-price` 10, `project-finance` 20 (rewritten, R2 cases kept), `extra-sales` 6,
`u1-money` 4, `margin-ledger` +3, `period-report` +2 (the marketing case rewritten), `quote-documents` +1; `money-loop` and
`quote-variants` adjusted — an extra sale carries its id; the swap test runs on a quote, the accepted case has its own).
51 deliberate mutations across quote-financials, approved-price, quote-variants, project-finance, extra-sales,
margin-ledger, period-report, marketing-calc, finance-calc, project-list, money-loop, event-kinds and quote-documents: 45
caught at first; the 6 survivors (EUR record without the currency, the legacy transfer vs the approved price, an invoice
without amount, extras of a project anchored earlier, the list from invoices, „Wyczyść" keeping the price) got tests —
51 / 51. `npx tsc --noEmit` clean; `npm run build` passes.

**Verified on the production export** (`npm run build`, `node scripts/serve-export.mjs 3014`, opened by URL, build checked
by its strings; the real data with the patch simulated copied into the page's localStorage, restored afterwards to the
empty origin from a non-app page): the list shows the six rows above; JHJ Finanse 22,250 „Zatwierdzona 24.10.2026 z PDF",
26,340; PDF tab „Inne" 0 → 500 saved, Finanse „PDF: 22 750 zł (+500 zł) · Odśwież", revenue unchanged; „Odśwież" →
22,750 / 26,840, „Cofnij" restored the record exactly; „Zmień" 23,000 → „Wpisana ręcznie", „PDF: 22 750 zł (−250 zł)";
the 4,090 extra edited to a new category „licencja" + „po projekcie" (amount unchanged); a payment 27,000 on 10.09 →
„z wpłat" 27,000, „Wpłynęło o 660 zł więcej…", saved as an extra sale → still 27,000; company Finanse EBBT tile with „pole
do optymalizacji 62 227 zł", Dosprzedaż panel by category and phase; Raport rows „w tym dosprzedaż" and „EBBT"; Marketing
B2B „3 zlecenia" from the loop; Morris rolki PDF tab on B → the variant note, Finanse „oglądasz wariant B — Finanse liczą
wariant A"; CIONET Gala → W realizacji froze 7,840 (`revenueSource: approved`). Phone width: Finanse tab wraps, no element
wider than the screen (the page is 29 px wider only because of the known top bar). No console errors besides the missing
Vercel analytics script. The browser pane was shared with U2 (its own tab on port 3015) — nothing of it was touched.

**Desktop-only checks for the main session** (installed app, after the patch):
1. JHJ → PDF tab: change a row, close the window right away (red button) — after restart the PDF has the edit, Finanse shows
   „PDF: X zł · Odśwież" and the list still 26,340.
2. „Pobierz PDF" from the new PDF tab on Morris rolki B: native dialog „… (wariant B).pdf", then „Wycena wysłana" with version B.
3. „+ Wpłata" in Finanse writes an `invoice_paid` with `data.amount` into `events.json`; filling an amount-less payment
   changes that event only.
4. A quote set to W realizacji gets `quote.data.approvedPrice` in `projects.json` (and survives a restart).

**Known limits / next:**
- A retro project without a quote cannot get a typed price (there is no quote to hold it); its invoices decide anyway.
- Moving an accepted project back to Wycena keeps its frozen price (shown with „Za PDF" to follow the PDF again).
- The category list has no rename / delete (a category is text on each event; edit the sales to rename one).
- Payment amounts are net by decision; a VAT-invoiced job is entered net like its invoice.

## 20. U2 as built

*(2026-10-24, branch `claude/u2-realizacja-sprzet`: built on `v3/project-hub` `ff6289b`, then merged with U1 at
`a9aa3f4`.)*

**Decided with M.J. (2026-10-24), after the phase-1 report:**
1. Gear earned may be **negative**. When rentals exceed the PDF „Sprzęt" row (rolki: 600 − 700 = −100), the amount is
   split the same way, lowers the items' „Zarobił" and payoff, and is shown plainly as „wynajem > Sprzęt o 100 zł".
2. The reconciliation reads the „Zatwierdzona cena" through ONE helper, `quotedPrice` (`lib/realization-summary.ts`),
   which calls U1's `snapshotPlanRevenue` (typed transfer → approved price → PDF → calculator). There is a second line
   „z dosprzedażą / przelewem", based on the Finance revenue.
3. Listed rental items fill the typed rental total („bez szczegółów") first, then raise it.
4. No new category. `wynajem` is gear only; its label is now „Wynajem sprzętu" (key unchanged, no line moves).
5. No data patch. M.J. reviews the projects himself, e.g. M&L Broker's „Rental" 950 zł in „inne".

**Why „Zarobił" was wrong** (old `lib/gear-revenue.ts`, removed):
- It took the calculator's gear amount × (typed transfer / calculator total) instead of the PDF row: JHJ 5 300 vs PDF
  3 900; S-AI 7 539 vs 2 600; CIONET wywiady 800 → 1 043.
- It subtracted the quote's plan rentals, not Realizacja's (rolki: plan 540, actual 700).
- It paid catalogue gear priced in the quote „exactly", whatever went on set (rolki's drone got 100 without being on the
  grid; gratis items on set got 0).

**Gear earned** (`lib/gear-earnings.ts`, pure):
- `pdfGearRow(snapshot)`: the chosen variant's „Sprzęt" row in zł, with the same currency rule as the PDF total
  (EUR quote: € × the quote's rate; a pre-S3 EUR draft: × the draft rate). Without a PDF draft it is the calculator's
  gear row (what the PDF would print).
- `gearEarnings({ quote, costs, gearDays, catalog, override })`:
  - earned = override (`Project.gearEarnedOverride`, may be negative), else PDF row − Realizacja rental total;
  - split by catalogue day price × unit-days: grid lines, or the quote's catalogue gear when the grid is empty (gratis
    lines count, they were on set);
  - items without a price are listed `noRate` and get nothing; zaplecze and deleted items never count;
  - nobody to split to → `unassigned`.
- `equipment-roi` reads it: `ProjectGearSummary.earnings` replaces `revenue` / `clientPaidExact`;
  `MissingGearProject.earnings`; the report's `unassignedClientPaid` sums `earnings.unassigned`. „Odpracował" is
  untouched.

**Rentals as one number** (`lib/rentals.ts`, pure):
- The rental total = counted (ticked, external, live) `wynajem` lines: project-wide and in days.
- If Realizacja has no saved lines yet (draft), the plan's lines count (`realizationLines`), as in Finance.
- `rentalBlock` (the fixed „Wynajem sprzętu" block at the top of Koszty projektu):
  - the „bez szczegółów" line is a project-wide `wynajem` line without a dictionary item that has a typed total, is the
    plan's „Rental sprzętu", or is labelled „Wynajem sprzętu" / blank; a line with its own label is an item;
  - the typed total sits on that line (`ProjectCost.rentalTotal`), so the costs are still exactly the sum of the lines;
  - `setTypedRental` and `rebalanceRental` keep the rest = typed − items (≥ 0). The typed total is the one before the
    edit, so a typo („4000" fixed to „400") can't raise it. Edits that don't change amounts don't touch the rest, so a
    plan line is not marked `edited`.
- Rental dictionary: `rental-items.json` (`lib/rental-types.ts`, `rental-items-store.ts`, `use-rental-items.ts`; in
  `data.mts` and the start-up backup). It holds only names; the same name (case and diacritics ignored) is the same item;
  soft delete.
- `rentedGearReport` feeds the Sprzęt tab: per item — times, days (`rentalDays`; a day line = 1, a project line without
  days = unknown), spent, last rental (the day's calendar date, else the project date), per year; plus „bez pozycji" so
  the totals add up. Counts won/done projects.
- `periodRentals` gives company Finanse and the S5 row: the rentals of projects anchored in the period, on the same
  basis as their direct costs in the margin ledger (Realizacja; plan where Finance counts the plan).

**Data (additive, optional, no version bump):**
- `ProjectCost.rentalItemId`, `rentalDays`, `vendor`, `rentalTotal`;
- `Project.gearEarnedOverride`;
- the `rental-items.json` collection.

Garbage drops to `undefined`; unknown fields survive. No existing record changes until M.J. edits it.

**Screens:**
- **Realizacja:**
  - Summary card on top: „Realizacja razem" (external and own work apart), „Zatwierdzona cena" (its source, € × rate,
    „PDF X zł" when it differs), „Sprzęt
    zarobił" (with „Zmień": a typed amount, „= cały wiersz Sprzęt — wynajem w osobnym wierszu PDF", „Licz z PDF"), and
    „Bilans wyceny" with sign and wording, plus the second line „z dosprzedażą / przelewem (X zł): ±Y".
  - Koszty projektu starts with the „Wynajem sprzętu" block: „Za cały projekt" amount, items, „+ Pozycja z wynajmu"
    (picker with „Dodaj „X" do wynajmowanego sprzętu"), and the sum of day rentals.
  - Day rental rows use the same `RentalRow`: picker, amount, a second line with days and rental house. Picking an item
    keeps the line's description.
  - Dojazd is one amount: an old km × rate line shows its total, with „z wyceny: 2 500 km × 0,52 zł" on hover; an edit
    writes 1 × amount.
  - The gear grid's „Zarobił" tile uses the live quote and costs.
- **Sprzęt:**
  - A third tab, „Wynajmowany".
  - „Zarobił" drops the „~" (it is a defined split now); negative shares show in red.
  - The payoff bar never draws backwards.
  - The missing-gear banner shows the waiting „zarobił".
- **Finanse (company, Projekty tab):** a „Wynajem sprzętu" panel (period figure, % of direct costs, projects, most rented
  items).
- **S5 report:** the `metrics[]` row `rentals` „w tym wynajem sprzętu" after „Koszty bezpośrednie", plus a definition.

**Real-life cases → behaviour** (tests in `gear-earnings`, `rentals`, `realization-summary`, `equipment-roi`,
`period-report`, `quote-currency*`, `quote-margin-line`):

| Case | Behaviour |
|---|---|
| Own gear only (CIONET TribesDay II) | PDF Sprzęt 1 350 − 0, split by price × days (RED 400 / 2 030 × 1 350 = 266) |
| Rentals in the days (rolki, CamCam 700) | one rental total; gear 600 − 700 = −100 split over the grid; „wynajem > Sprzęt o 100 zł"; reconciliation +2 730 |
| Rental billed as a separate PDF line | „Zmień" → „= cały wiersz Sprzęt" (override); „Licz z PDF" brings back the computed value |
| Items differ per day (JHJ) | Σ per day of qty × price (Halo 2 × 170 on day 1 only) |
| Item without a day price | „bez stawki", 0; if every item lacks a price → not assigned |
| Zaplecze / item deleted from the catalogue | never counts; its share goes to the others |
| No grid | the quote's catalogue gear (qty × price per quote day); none → not assigned (S-AI 2 600, CIONET wywiady 800) |
| No PDF draft | calculator gear row (Zabudowy 2 850) |
| EUR PDF (Tchibo Event) | 260 € × 4,3661 = 1 135 zł; price 1 460 € × 4,3661 = 6 375 zł |
| Variant swap | follows the chosen variant (`Project.quote`); the override stays, marked „kwota wpisana w projekcie" |
| Pre-R2 project (JHJ) | rentals = lines as entered (1 500); missing plan lines don't count |
| Realizacja not started (S-AI) | rentals and totals from the plan (48 480 zł), the same as Finance |
| Dojazd km × rate (JHJ 2 500 × 0,52) | shows 1 300 zł; untouched lines stay as stored, no banner; an edit writes 1 × amount |
| Typed total + items | items fill „bez szczegółów" first, then raise the total; deleting an item gives its amount back to the rest |
| Rented item created on the spot, then picked again | „Sony FX6" created in JHJ, picked on rolki's day line; the Sprzęt tab shows it with the day's calendar date |
| Rental line unticked / „Moja praca" | not in the rental total |
| Lost / quote project | shown in Realizacja; not in the Sprzęt stats or Finance |

**Real data (read-only):**
- The hub folder was read at 14:00 and again at 18:55 (`projects.json` unchanged since 13:37, hash `d66ba159`; nothing
  was written there).
- `real-data-check.mts` now also prints gear „Zarobił" / „Odpracował" per item, the rental totals per project and year,
  and the Realizacja totals. Base `ff6289b` vs this branch: quotes, years, per-project money and Ja lines identical.
- „Odpracował" identical (26 345).
- „Zarobił": total 12 767 → 9 895; not assigned 8 583 → 3 400. Per item: RED 2 495 → 2 062, Dron 1 682 → 1 292, Ronin
  1 620 → 1 268, Halo 1 279 → 790, A7S III 1 176 → 991, Leica 588 → 372, 28-135 547 → 483, NanLite 467 → 251, Sigma
  464 → 325, Sachtler 350 → 307, Tokina 339 → 253, 60x 314 → 208, 200x 208 → 110, Rode 125 → 80, Viltrox 62 → 58,
  85mm 47 → 42.
- Unchanged items: 16-35, Shinobi, A7 III, Tamron, 100-400, Manfrotto, 135GM.
- Rentals: JHJ 1 500, rolki 700 → 2026: 2 200 zł.
- Reconciliation: JHJ −2 675 (with extras +1 415), S-AI +29 360 (its typed transfer 80 440 is the price; PDF
  67 800), rolki +2 730, M&L Broker +1 670 (+4 690), Tchibo Event +1 841. U1's approved-price patch is not applied
  yet; once prices freeze, the reconciliation follows them.
- After the U1 merge: the check against `a9aa3f4` (fresh read 19:09, data unchanged since 13:37) again shows quotes,
  years (with U1's ledger EBBT and extra-sale stats), per-project money and Ja lines identical; only gear moves.

**Tests:** 830 on `ff6289b` (810 before; −10 with `gear-revenue.test.ts`, +30 new); 868 after the U1 merge
(`quotedPrice` tests now cover the typed transfer and a frozen approved price). `quote-currency-legacy`'s golden replaces
`gearRevenue` with the PDF gear row explicitly: `split.sprzetNetto` of the same golden, the EUR draft 260 € × 4,3699.
45 deliberate mutations across gear-earnings, rentals, realization-summary, realization-costs, equipment-roi and
period-report: 41 caught at first; the 4 survivors got tests (rest preference, a non-negative rest, ticking the rest,
the override in the catalogue report) — 45 / 45. `npx tsc --noEmit` clean; `npm run build` passes.

**Verified on the production export:**
- Setup: `npm run build`, `node scripts/serve-export.mjs 3015`, opened by URL; the served chunk contains „Pozycja z
  wynajmu". Real data was copied into the empty origin's localStorage from a non-app page and cleared afterwards; the
  server was stopped.
- After the merge, rebuilt and checked again: JHJ „Zatwierdzona cena 22 250", S-AI „80 440 · kwota przelewu wpisana
  ręcznie · PDF 67 800" → +29 360, Tchibo Event 6 375 („1460 € × 4,3661"), rolki +2 730. Company Finanse shows
  Płatności, Dosprzedaż (U1), Wynajem sprzętu, Sprzęt w kosztach firmy; EBBT present.
- JHJ: card 22 525 (12 425 + 10 100) / 22 250 / 2 400 („Sprzęt 3 900 − wynajem 1 500") / −2 675 („z dosprzedażą /
  przelewem (26 340 zł): +1 415").
  - „Sony FX6" created on the spot; 4000 → 400: the total stayed 1 500 (rest 1 100, `rentalTotal` 1 500); Finance costs
    unchanged.
  - Override „= cały wiersz Sprzęt" → 3 900 (grid tile too) → „Licz z PDF" removed it.
  - Dojazd 1 300 with the hint → 1 400 saved as 1 × 1 400.
- Rolki: −100 „wynajem > Sprzęt o 100 zł", +2 730; FX6 picked on the day line, description kept.
- S-AI (before the merge, PDF price): 2 600 „czeka: zaznacz sprzęt ze stawką", +16 720 / +29 360.
- M&L Broker: +1 670 / +4 690.
- Tchibo Event: 6 375 („1460 € × 4,3661"), 1 135, +1 841.
- Sprzęt → Na plan: Zarobił 9 895, „+3 400 zł nieprzypisane", RED 2 062. Sprzęt → Wynajmowany: 2 200, FX6 1× 1 dzień
  22.10.2026, bez pozycji 1 500.
- Finanse 2026: revenue 203 978 (= check), panel „Wynajem sprzętu · 2 200 zł (3 %)"; Raport row „w tym wynajem
  sprzętu 2 200 zł".
- Phone width: the card and block fit (343 px). The page is 29 px wider only because of the known top bar. No console
  errors besides the missing Vercel analytics script.
- Fixed during the check: picking an item no longer replaces the line's description with the search text.

**Desktop-only checks for the main session** (installed app):
1. Adding a rented item creates `rental-items.json` in the data folder (with `fs` scope `$APPDATA/**`), and the next
   start-up backup copies it.
2. „+ Pozycja z wynajmu" → create „X" → close the window right away: after a restart the line and the dictionary
   entry are there.
3. A typed „Sprzęt zarobił" survives a restart (`gearEarnedOverride` in `projects.json`).
4. `npm run data -- apply --dry-run` accepts a patch touching `rental-items.json` (schema registered).

**Known limits / next:**
- Merged with U1: `quotedPrice` → `snapshotPlanRevenue`; the „z dosprzedażą / przelewem" line reads
  `projectMoney().revenue`. Company Finanse keeps U1's Dosprzedaż panel and EBBT; the S5 report keeps U1's rows (`w tym
  dosprzedaż`, EBBT) next to `w tym wynajem sprzętu`, and both definitions.
- Typing in an item-less rental line edits its description (like a free-text person); searching then leaving without
  a pick keeps the typed text.
- Rental days are optional; „Wynajmowany" shows „N× bez dni" for lines without them.
- `docs/PLAN-GEAR.md` still describes `gear-revenue.ts` (historical).
