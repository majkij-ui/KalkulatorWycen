# NonoiseMedia Hub — architecture

A map for future sessions. The plans and their „as built" sections are the history and the decisions:
`docs/PLAN-CALENDAR-AND-THREADS.md` (data model, kinds, §3.4 rules, mail bridge) and
`docs/PLAN-AFTER-TEST-DRIVE.md` (S1–S3, Q1, F1). UI is Polish, docs are English.

**Stack.** Next.js static export (`output: 'export'`, no routing — sections are client state in
`components/app-shell.tsx`) inside Tauri v2 (`src-tauri/`, identifier `com.michal.nonoisehub`, app
„NonoiseMedia Hub"). Desktop only: decide with `isTauriRuntime()` (`lib/storage.ts`), never
`'__TAURI__' in window`. The browser (`npm run dev`) uses localStorage instead of files and is only for
testing the UI, never real data. The old QuoteGen app (`com.michal.quotegen`) stays installed and
untouched; the hub may only read its `quotes.json` (capabilities deny writes to its folder).

## Data files

Folder: `~/Library/Application Support/com.michal.nonoisehub/`. Every collection is
`{ "version": 1, "items": [...] }`, written whole by `createCollectionStore` (`lib/v3-store.ts`: a
read–change–write queue per file, defensive parsing — an unreadable record is skipped, never a crash).

| File | Schema (lib/) | What |
|---|---|---|
| `projects.json` | `projectSchema` (project-types) | project = client field, status, `quote` (QuoteSnapshot v2, optional), frozen `financials`, gear usage, `gearDays`, `costs` (+ `costsFromQuoteAt`, R2), notes, soft delete |
| `events.json` | `eventSchema` (event-types) | the project thread and business events: `kind`, `projectId` or null, `start`/`end`, open `data`, `source.ref` |
| `finances.json` | `fixedCostSchema` (project-types) | fixed costs and monthly corrections (`subscriptionId`) |
| `subscriptions.json` | `subscriptionSchema` (subscription-types) | subscriptions; instalments derived on read (`subscriptions.ts`) |
| `campaigns.json` | `campaignSchema` (marketing-types) | Google Ads campaigns and budget steps |
| `equipment.json` | `equipmentItemSchema` (project-types) | gear catalogue, purchase price and date (projected onto the calendar) |
| `gear-kits.json` | `gearKitSchema` (project-types) | gear kits |
| `crew.json`, `crew-roles.json` | `crewMemberSchema`, `crewRoleSchema` (crew-types) | people (what I pay) and roles (what the client pays) |
| `client-groups.json` | `clientGroupSchema` (client-groups) | groups of client keys, counted as one client |
| `rental-items.json` | `rentalItemSchema` (rental-types) | names of rented gear (U2); amounts live on the `wynajem` cost lines |
| `call-sheets.json` | `callSheetSchema` (call-sheet-types) | call sheet per realisation day (`dayId`) |
| `inbox-decisions.json` | `inboxDecisionSchema` (inbox-types) | what was accepted/rejected in Skrzynka |
| `company.json` | `companySchema` (company-settings-core) | one record `id: "company"`: PDF texts, portfolio catalogue, default price list; reserved `name`, `contact`, `defaultTaxRatePercent`, `defaultCurrency` (F1) |
| `inbox/*.json` | `inboxFileSchema` | proposals written by Claude; the app only reads them |
| `backups/` | — | `*.json` from `npm run data` (never touched by the app) and `auto-YYYY-MM-DD-HHmm/` start-up copies (F1) |

Legacy, read but no longer written: `quotes.json`, `settings.json`, `quotes.backup-*.json`,
`carryover-from-quotegen.json`. UI-only preferences (list filters, calendar layers, „Pomiń" in the
import) stay in localStorage; business data never does.

**Start-up order** (`components/app-root.tsx`, before any provider mounts): carry-over from the old app →
automatic backup (waits at most 3 s, never blocks; failure = notice at the bottom of the window) →
`company.json` into memory (created once from the old localStorage keys, which are kept and still
mirrored). That is why `getPdfTextsConfig()`, `getPortfolioCatalogue()`, `getSavedUserDefault()` stay
synchronous. Providers: `ProjectHubProvider` → `QuoteProvider` → equipment, events, crew, inbox.

## The §3.4 rules (non-negotiable)

1. Facts stored, stats derived — no stored totals except the frozen `Project.financials` plan.
2. Every date lives in one place (gear purchase dates stay on the catalogue item).
3. Kind keys are permanent; labels, colours, groups and fields are cosmetic.
4. Unknown is kept: free `kind`, open `data`, `.passthrough()` everywhere; an older build writes newer data
   back untouched.
5. Additive by default: new field = optional + `.catch(default)`, no version bump. A breaking change bumps
   `version` and gets a migrator with backup-or-abort (`project-migration.ts`).
6. Soft delete (`deletedAt`), never remove.
7. Colours are palette slots (`colorKey`), not hex.
8. Imports go through review (Skrzynka); `source.ref` dedupes.

## Where logic lives

- **Pure modules in `lib/`** (no React, no Tauri, tested with `node --test`): schemas (`*-types.ts`),
  calculations (`quote-calc`, `quote-financials`, `profit-calc`, `finance-calc`, `money-loop`, `margin-ledger`,
  `gear-costs`, `gear-earnings`, `rentals`, `realization-summary`,
  `subscriptions`, `client-money`, `client-stats`, `crew-rates`, `gear-usage`, `equipment-roi`,
  `thread-stats`, `realization-plan`, `realization-costs`, `project-finance`, `period-report`, `extra-sales`), decisions (`project-save`, `approved-price`, `quote-documents`, `inbox`,
  `inbox-validate`, `auto-backup`, `company-settings-core`). Put every rule here, with a test.
- **Stores** (`*-store.ts`, `project-library.ts`, `equipment-catalog.ts`, `company-settings.ts`):
  file/localStorage IO through `createCollectionStore` only.
- **Contexts** (`*-context.tsx`): load stores, reload on window focus, expose actions.
- **Screens** (`components/<section>/`): layout and wiring; no money rules in components.

## Quotes (Q1)

Each project's quote is its own document `{ data, pricingConfig, marginMultiplier, pdfDraft }` in
`Project.quote`. `lib/quote-documents.ts` keeps the documents being edited and saves them ~0.6 s after a
change, on project switch, blur/hide and window close; each save recomputes `financials`
(`planProjectSave`). A project with imported financials and no quote asks before the first save replaces
them. `useQuoteDocState`/`useQuote()` bind the calculator tabs to the open project. Q2 (variants A/B/C)
keeps `Project.quote` as the chosen variant (plan §8). The default price list for new quotes, PDF texts and
the portfolio come from `company.json`.

R1 (plan §14): a crew line has two amounts, „Koszt" (`costRate`, plan) and „Klient" (`clientRate`, before margin);
picking a person fills both from their rate in the role, hand edits are marked and survive „zaktualizuj stawki"
(`quote-crew.ts`). `CrewMember.self` is „Ja". Quotes with `QuoteData.marginAsLine` (every quote created since R1)
show items at their own prices and the header margin as ONE line (`MARGIN_PHASE`, PDF row `marza`, „Koordynacja i
produkcja" / „Rabat"); quotes without it stretch every margined item as before. Totals are the same either way.

## Events and kinds

`lib/event-kinds.ts` is the registry (code, not data): sprzedaż (`lead_in`, `reply_sent`, `quote_sent`,
`follow_up`, `won`, `lost`), produkcja (`prep_day`, `shoot_day`), post (`post_day`, `deadline`), pieniądze
(`invoice_sent`, `invoice_paid`, `extra_sale`), firma (`gear_purchase` projected from the catalogue,
`marketing`), inne (`note`; unknown kinds render as „inne"). Status suggestions are always confirmed by
the user; the app never changes a status silently. A lead is a `lead_in` event, not a status.

## Money pipeline

**Four layers of a job's money (M.J., 2026-10-18 — keep this direction in all code):**
1. **Kalkulator** — estimating: what the job needs and roughly costs. The margin multiplier is a tool for
   arriving at client prices, nothing more.
2. **PDF** — presenting the estimate to the client in an attractive shape. **The PDF is the price.** It may
   differ from the calculator by design (lines moved, people shown cheaper, gear dearer); nothing ever flows
   back from the PDF into the calculator, and the difference is never an error.
3. **Realizacja** — how the money is actually deployed: costs start from the calculator's plan and are
   adjusted by hand (usually they are), each counted line either an external cost or M.J.'s own work.
4. **Finanse (project tab)** — the final word: derived from the PDF by default, overridable (final transfer
   incl. extra sales), and invoices win once issued.

Revenue therefore follows PDF → Finanse → invoices; costs follow calculator → Realizacja. Never change a
number of an existing project silently: list what moves and let M.J. confirm.

- **Plan** = `Project.financials`, frozen from the quote on save: revenue = typed transfer, else the chosen
  variant's PDF total, else the calculator (`approvedPrice`, `revenueSource`); costs from the price list without
  margin with the old Profit overrides (no editor since R2); „Ja" lines are `ownWork`, not `koszty`; flat tax 8.5 %
  by default.
- **R2 (plan §16) — Realizacja and the project's Finanse tab.** One cost list, `Project.costs`
  (`realization-costs.ts`): before the first change the tab shows the plan as a draft and Finance counts the plan;
  the first change writes the whole draft (`planKey`, `costsFromQuoteAt`); later quote edits only through the
  „Wycena zmieniła się" banner (never-edited lines); costs entered before R2 count as entered, with the plan lines
  they lack listed. Every line is ticked („było"; `skipped` counts nowhere) and external or „Moja praca" (`ownWork`,
  not a cost). Per project: Marża = zysk netto (after external costs and tax), Marża producencka = Marża − own work;
  company-wide it is the sum of the projects' (ledger `producerMargin`, Finance tile, S5 metric). The project tab
  „Finanse" (`project-finance.ts`) shows the approved price, the final transfer (price + extra sales; a typed number
  is the override; a gap can be saved as an extra sale) and these margins.
- **Money loop** (`money-loop.ts`, T6): actual revenue = issued invoices (`invoice_sent.amountNetto`, net)
  + payments without an invoice; expected = plan + `extra_sale`; costs = `Project.costs` from Realizacja,
  else the plan's. A future-dated invoice is still plan. Pairs invoice → payment: `thread-stats`.
- **Subscriptions** (S1): instalments derived on read; a correction is a fixed cost with
  `subscriptionId`. Company result = project profit − fixed costs of the period (`finance-calc`).
- **Client money** (`client-money.ts`, S2): Klienci and the Projekty client filter use the same best
  knowledge as Finance, per revenue piece date; client groups count as one client.
- **Margin ledger** (`margin-ledger.ts`, S4) — the one place money screens read the two layers from.
  Facts in: the money loop, fixed costs with subscription charges, the gear catalogue (`gear-costs.ts`),
  marketing. Layer 1 „Marża na realizacji" = revenue − direct costs, before tax (`ProjectMoney.margin`,
  also what Klienci shows). Layer 2 „Wynik po kosztach firmy" = layer 1 − tax − ZUS − fixed − gear −
  marketing; per project only in a year view (company costs split by revenue share). Gear purchases come
  from the catalogue only: spread over 36 months from 5,000 zł (company.json) or in full; manual
  „Sprzęt spoza katalogu" (`category: 'gear'`) counts in full, minus `catalogueItemIds` it covered.
  The S5 period report (`period-report.ts`, Finanse → „Raport") calls `marginSummary` for every money number and
  re-adds nothing; where two modules disagree it lists the difference in „Do wyjaśnienia".
- **U1 (plan §19) — approved price, extra sales, EBBT, one money source for every screen.**
  - Plan revenue has ONE order, in ONE function: `planRevenue` / `snapshotPlanRevenue` (`quote-financials.ts`) —
    typed transfer → approved price → the chosen variant's PDF → calculator. Anything that needs „the price" calls it.
  - The approved price (`QuoteData.approvedPrice`, read via `approvedPriceRecord`) follows the PDF while the project is
    a quote and freezes on acceptance (status → won / done, `statusChangePatch` in `approved-price.ts`) and when a
    variant is chosen on an accepted project; after that a PDF change only shows „PDF: X zł · Odśwież". It can be typed
    in the project Finanse tab. `financials.revenueSource` = `approved`.
  - Extra sales are `extra_sale` events with `category` (free text: seeds + used, no file) and `phase`
    (`extra-sales.ts`, stats per period by anchor). Money received = `invoice_paid` with a NET `amount` (invoices with
    an amount still decide; without an invoice T6 anchors the project on the payment day).
  - EBBT = W1 − ryczałt − ZUS (`MarginTotals.ebbt`), the same in both gear views; EBBT − result = room to optimise.
  - **Every screen that shows a project's money reads the money loop** (`useProjectMoney` / `moneyLedger` → `listMoney`,
    `moneyOf`), never `Project.financials` directly: the project list, Klienci, Finance quotes, Marketing ROAS and
    origins, the pipeline. `financials` is read directly only as the plan itself (variant comparison, import question).
  - The PDF editor is the project tab „PDF" (`QuotePdfView`), not a calculator sub-tab.
- **U2 (plan §20) — Realizacja total, gear earnings, rentals as one number.**
  - The **rental total** of a project = its counted external `wynajem` lines in Realizacja (project-wide and in
    days; the plan's lines while Realizacja is unsaved) — `rentals.ts`. Gear earnings, the Sprzęt „Wynajmowany" tab,
    company Finanse and the S5 row all read it. A typed „Wynajem sprzętu" total sits on its line (`rentalTotal`);
    listed items fill it first, then raise it, so the costs stay the sum of the lines.
  - **Gear earned** (`gear-earnings.ts`) = the chosen variant's PDF „Sprzęt" row in zł (calculator row without a
    draft) − the rental total, or `Project.gearEarnedOverride`; it may be negative. It is split by day price ×
    unit-days over the Realizacja grid (else the quote's catalogue gear); zaplecze and unpriced items get nothing.
    This is „Zarobił" and the payoff in `equipment-roi`; „Odpracował" is separate.
  - The Realizacja reconciliation (`realization-summary.ts`) = `quotedPrice` (→ `snapshotPlanRevenue`) − (external
    costs + own work + gear earned), before tax; a second line compares the money loop's revenue.

## Adding a collection

1. Schema in `lib/<name>-types.ts`: `.passthrough()`, every field `.catch()`/optional, `id`, timestamps,
   `deletedAt`. Test that unknown fields survive.
2. Store: `createCollectionStore({ fileName: '<name>.json', webKey: 'nonoise-<name>-v1', schema, getId })`.
3. Add the file to `SCHEMAS` in `scripts/data.mts` and to `AUTO_BACKUP_FILES` in `lib/auto-backup.ts`
   (a test fails if a known file is missing from the backup list).
4. Context/hook that reloads on focus; pure stats in their own module with tests.
5. Capabilities already cover `$APPDATA/**` for read/write/mkdir/read-dir; anything else needs an entry
   in `src-tauri/capabilities/default.json`.

## How Claude writes data

No AI inside the app; Claude works in the chat and writes the same files.
- **Lane 1 — mail** (`.claude/skills/przejrzyj-poczte`): `npm run data -- inbox <proposals.json>` writes a
  new `inbox/` file (tmp + rename), safe while the hub is open; M.J. accepts in Skrzynka.
  `npm run data -- inbox-status` shows the last sync window.
- **Lane 2 — cleanup on request**: `npm run data -- apply <patch.json> [--dry-run]` with `upsert`/`update`
  per file. Strict: a record the schema would reject or silently „fix" stops the write. Backs every
  changed file up to `backups/<file>.<time>.json` first, and refuses while the hub runs (it keeps data
  in memory and would overwrite the patch). `company.json` is changed with
  `update: { "company.json": [{ "id": "company", "set": { … } }] }`.
- Never hand-edit the JSON; never write the data folder from a feature session — the main session
  releases (`.claude/skills/wydanie`).

## What only the desktop app can prove

Browser preview cannot exercise Tauri fs/dialog/window paths: start-up backups being written and pruned
(and the scoped `fs:allow-remove`), `company.json` created on first start and read after a restart,
reading `inbox/` (`fs:allow-read-dir`), native save dialogs (PDF, JSON export), the close-window save
(`core:window:allow-destroy`), Cmd+Q right after an edit, reading the old app's `quotes.json`. Check these
in the installed app with real data, read-only where possible, and list them in the plan's „as built".
React StrictMode in `npm run dev` runs effects twice; verify effect-order-sensitive flows on the export
(`npm run build`, launch config „export").
