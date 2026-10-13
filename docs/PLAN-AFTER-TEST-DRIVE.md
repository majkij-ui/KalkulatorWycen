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

*(2026-10-13, branch `claude/grupy-role-hub-8145ba` on top of `90e913a`; not merged.)*

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

## 7. S3 as built

*(not built yet — S3 writes here)*
