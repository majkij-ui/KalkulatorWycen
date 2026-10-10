# Plan: Calendar & Project Threads

> Follows [PLAN-V3-PROJECT-HUB.md](PLAN-V3-PROJECT-HUB.md) (phases 0–3 done, phase 4 Finance in progress
> by a separate agent). Source: M.J. brainstorm, 2026-10-08.
> Track numbers here are **T1–T8** so they don't collide with the v3 phase numbers.

---

## 1. The idea in one paragraph

Every job is a **thread**: lead email → reply → quote sent → accepted → shoot days → post-production
→ deadline → invoice sent → invoice paid. Each step is a **dated event**. The **Calendar** is the
place where you see and add those events across all projects. Every other part of the app (project
page, Finance, Gear, marketing stats) **reads the same events** instead of keeping its own dates.
Store dated facts once. Every statistic ("how fast did I reply", "how long until I got paid", "how
many post days did this take", "how much gear did I buy this month") is *computed* from them, never
stored.

---

## 2. What you described, sorted

| Area | Wants | Lands in |
|---|---|---|
| Calendar | Separate tab, full month view, click a day → add typed event (iOS-style), easy editing, retrofill all of 2026 | T2 |
| Event types | Lead in, reply, quote sent, won/lost, shoot days, post-production days, deadlines, invoice sent, invoice paid, gear purchase | T1 |
| Colour | Tile colour = project; small marker + short label = event type (e.g. Tchibo: yellow tile, pink "mail" marker on 9 Oct, orange "zdjęcia" marker on 28 Oct) | T2 + design pass |
| Lead tracking | Source, response time, lead progression (new → advanced → won/lost), editable later | T3 |
| Thread → quote | Quote picks up the thread; client details from the lead prefill the quote | T3 |
| Gmail | Pull dates/details from emails, ideally AI-filled | T4 (import) → T8 (in-app) |
| Shoot / Realizacja | Own project tab: crew, gear, actual costs per shoot day; Profit tab moves here out of the calculator; call sheet planner attaches here | T5 |
| Money loop | Quote = planned revenue; real costs + invoice = actual; days-to-payment stat | T6 |
| Insights | Response time, conversion, effort per project for future estimating, gear spend per month, marketing / Google Ads performance | T7 |
| Design | Proper palette from a design pass, readable in dense month view | before T2 |

---

## 3. Data architecture (most of the work is here)

### 3.1 Entities

```mermaid
erDiagram
    PROJECT ||--o{ EVENT : "thread"
    PROJECT ||--o| QUOTE_SNAPSHOT : "quote (optional now)"
    EVENT ||--o{ PROJECT_COST : "costs on a shoot day"
    PROJECT ||--o{ PROJECT_COST : "costs"
    EQUIPMENT_ITEM ||..o{ EVENT : "purchaseDate projected onto calendar"

    PROJECT {
        string id
        string client "a field on the project, picked from existing names"
        object contact "name, email, phone (copied from previous job of same client)"
        string leadSource "google_ads | referral | instagram | returning | other"
        string status "lead | quote | won | done | lost"
        string colorKey "palette slot, NOT a hex"
    }
    EVENT {
        string id
        string kind "registry key, free string"
        string projectId "null = business-level (gear, marketing)"
        string start "YYYY-MM-DD or YYYY-MM-DDTHH:mm"
        string end "optional, inclusive, for multi-day"
        object data "kind-specific payload"
        object source "manual | gmail | import + ref"
        string deletedAt "soft delete"
    }
    PROJECT_COST {
        string id
        string projectId
        string eventId "optional: which shoot day"
        string category "crew | rental | travel | gear | other"
        number amount
    }
```

### 3.2 The event record

```ts
// lib/event-types.ts (sketch)
eventSchema = z.object({
  id:        z.string().min(1),
  kind:      z.string(),                 // NOT z.enum: unknown kinds must survive
  projectId: z.string().nullable().catch(null),
  start:     z.string(),                 // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (time optional)
  end:       z.string().optional(),      // inclusive; shoot/post ranges
  title:     z.string().catch(''),
  notes:     z.string().catch(''),
  data:      z.record(z.unknown()).catch({}),   // validated per kind, never stripped
  source:    z.object({ type: z.string(), ref: z.string().optional() }).passthrough()
               .catch({ type: 'manual' }),      // gmail → ref = message/thread id (dedupe)
  createdAt: z.string().catch(''),
  updatedAt: z.string().catch(''),
  deletedAt: z.string().optional(),
}).passthrough()
```

Stored in `events.json` through the existing `createCollectionStore` (Tauri AppData / localStorage).

### 3.2a Client is a field on the project, not a separate record *(decided 2026-10-08)*

There is no clients file. The client is a property of the project, like the status. To avoid the
usual problem with free text ("Tchibo" / "Tchibo Polska" / "tchibo" counting as three clients):

- The client input is a **picker over names already used**, with free typing for a new client.
- Grouping uses a normalised key (trimmed, case- and diacritic-insensitive), so small spelling
  differences still group together. A "merge names" action in Settings fixes real duplicates by
  rewriting the field on the affected projects.
- Picking an existing client **copies contact details** from that client's most recent project, so
  repeat clients still prefill the lead and the quote.
- "How much did this client bring in" = filter the projects by client and sum their financials. That
  is a pure function, like every other stat.
- If we ever need real client records, they can be built from these names in one pass without
  losing anything.

### 3.3 Kind registry (code, not data)

`lib/event-kinds.ts`: one entry per kind:

| key | group | range? | payload (`data`) | side effect |
|---|---|---|---|---|
| `lead_in` | sprzedaż | no | channel, contact, first message summary | creates project as `lead` |
| `reply_sent` | sprzedaż | no | — | (feeds response-time stat) |
| `quote_sent` | sprzedaż | no | amount netto snapshot, quote version | suggests status `quote` |
| `follow_up` | sprzedaż | no | — | |
| `won` / `lost` | sprzedaż | no | reason (lost) | suggests status `won` / `lost` |
| `prep_day` | produkcja | yes | recce / meeting | |
| `shoot_day` | produkcja | yes | call sheet id, location | anchors crew/gear/costs |
| `post_day` | postprodukcja | yes | hours (optional) | effort stat |
| `deadline` | postprodukcja | no | what is due | |
| `invoice_sent` | pieniądze | no | number, amount netto, due date | |
| `invoice_paid` | pieniądze | no | amount received | suggests status `done` |
| `gear_purchase` | firma | no | (projected from catalogue `purchaseDate`) | |
| `marketing` | firma | yes | campaign, spend | |
| `note` | inne | yes | — | |

Each kind has: label, group, colour **token**, which fields its add-form shows, a Zod schema for
`data` (all `.catch()`), and an optional "suggest status" effect. Suggestions are always confirmed by
you; the app never changes a project status silently.

### 3.4 Rules that make it safe to change our minds

These rules let us use it for a few weeks, decide it's wrong, and change it without losing data.

1. **Facts stored, stats derived.** "Days to payment" is never saved; it's `invoice_paid − invoice_sent`
   computed by a pure function. New or changed stats never need a data migration.
2. **Every date lives in exactly one place.** Gear purchases stay on the catalogue item
   (`purchaseDate`) and are *projected* onto the calendar. They are not copied into events.
3. **Kind keys are permanent; everything about them is cosmetic.** Labels, colours, groups and form
   fields can change freely. A key is never renamed. If two kinds merge, add an alias map in the
   registry and leave the data alone.
4. **Unknown is kept, not dropped.** `kind` is a free string, `data` is an open record, schemas use
   `.passthrough()`. An older build opening newer data shows an unknown kind as a grey "inne" tile
   and writes it back untouched. (We already got bitten by `z.object` stripping keys:
   `migratedFromQuoteId`. New schemas must default to passthrough.)
5. **Additive changes only by default.** New field = optional + `.catch(default)`. No version bump.
   A real breaking change bumps `version` and gets a migrator with backup-or-abort, using the
   pattern that already exists in `project-migration.ts`.
6. **Soft delete.** `deletedAt` instead of removing. Gmail re-imports stay idempotent (a deleted
   suggestion doesn't come back) and mistakes can be undone.
7. **Colours are palette slots, not hex.** `Project.colorKey = 'amber'`. The palette can be
   redesigned at any time without touching data.
8. **Imports go through review.** Gmail/AI produce *proposed* events; nothing lands without your
   accept. `source.ref` (Gmail message id) dedupes.

### 3.5 Changes to existing models (all additive)

- ~~`Project.status` gains `lead`~~ — **reverted 2026-10-08**: a lead is the `lead_in` *event*, not a
  project status. A project without a quote has status `quote` and shows „brak wyceny"; the funnel
  (inquiries → quotes → jobs) is derived from events. A stored `lead` reads as `quote` via `.catch`.
- `Project.quote` becomes **optional**: a lead has no quote yet. The calculator bridge
  (`project-hub-context.tsx`) opens an empty calculator when there's none. ⚠️ This touches the bridge.
- `Project.client` stays a string (now with a picker); new optional `Project.contact` and
  `Project.leadSource`. No clients file (§3.2a).
- `Project.colorKey`, auto-assigned round-robin from the palette, changeable.
- `Project.date` (ledger date) stays manual for now. Later it can default from events (e.g. first
  shoot day or invoice date).

---

## 4. Screens

**Navigation:** **Kalendarz** (new landing tab) · Projekty · Finanse · Sprzęt · Ustawienia.
Projects stays a clean list for when you only want to look at jobs.

**Kalendarz**
- Full month grid, week rows. Multi-day events (shoot, post) render as bars across days.
- Each item: **tile tinted with the project colour**, plus a **small solid marker in the event-type
  colour with a 1–2 word label** ("mail", "zdjęcia", "FV"). The type is also written as text, so you
  don't have to rely on colour alone.
- Business-level items (gear purchase, marketing) use a neutral tile with only the type marker.
- Click a day → sheet: pick type → type-specific fields → pick project (or "nowy lead" creates one).
  Click an item → edit. Drag to move/resize (later).
- Layer toggles per type group (sprzedaż / produkcja / post / pieniądze / firma) and a project
  filter, so a busy month can be thinned out.
- Month summary strip: leads in, shoot days, post days, invoiced, paid, gear spend.

**Projekty (list)** *(revised with M.J. 2026-10-08)*:
- Filters stay **Wszystko / Tylko projekty / Tylko wyceny**, plus a **„Ukryj nieprzyjęte"** checkbox,
  on by default and remembered; it shows how many are hidden. ✅
- When lost quotes are shown, their amounts are grey — they don't count toward results. ✅
- „Projekty" in the sidebar always returns to the list, also from an open project. ✅
- Client filter (picker) with that client's revenue, and a year filter; both remembered. ✅ (T3)

**Project page tabs**: `Oś czasu · Klient/Lead · Wycena · Realizacja · Notatki`
- *Oś czasu*: the thread as a vertical timeline, with derived numbers inline ("odpowiedź po 6 h",
  "zapłacono po 23 dniach").
- *Wycena*: today's calculator, prefilled with client data from the lead.
- *Realizacja*: shoot days from events; per day: crew, gear (today's Sprzęt tab moves in here),
  actual costs. The current **Profit** tab moves out of the calculator to here as "planned vs actual".
  The call sheet planner (old phase 5) attaches to a shoot day here.

---

## 5. Gmail + AI: is it doable?

Yes, and there are two ways. Start with the cheap one; the second reuses all of it.

**A. Now: Claude Code session as the importer (no new infrastructure).**
This session already has a working Gmail connection. I search your mail for client threads, extract
dates and details (lead received, your reply time, quote sent, acceptance, invoice mails), and write
a `proposed-events.json` file in an agreed format. The app gets a **review queue**: accept / edit /
reject each proposed event, matched to a project or creating one. This is how we retrofill 2026.
Afterwards you can say "sync my mail" every week or two.

**B. Later: in the app itself.**
Google OAuth from the Tauri app (a Google Cloud project you own, `gmail.readonly`, fine for personal
use with some one-off setup friction), plus a Claude API call that turns a thread into the same
proposed-event format. Needs an Anthropic API key stored in the macOS keychain. The cost per thread
is negligible.

The **import format + review queue** is the shared part, so A isn't throwaway work. It is also why
rule 8 exists: the AI suggests, you confirm.

Google Ads works the same way: start with manual monthly spend (already exists as a `FixedCost` of
type `marketing`) plus `lead source`. That alone gives cost per lead and cost per won job. API import
can come later.

---

## 5a. Claude ↔ desktop app data bridge *(decided 2026-10-08)*

Gmail work and data cleanup stay **in the chat with Claude Code**. There's no AI inside the app.
Claude writes to the **same local files the desktop app reads**, so when you open the app from the
Dock the data is already there. You don't need to look at the preview for this.

- **Where:** `~/Library/Application Support/com.michal.quotegen/` (today: `quotes.json`,
  `settings.json`; v3 adds `projects.json`, `equipment.json`, `finances.json`, `events.json`).
  The browser preview uses separate localStorage and is only for testing the UI, never real data.
- **Lane 1 — inbox (anything Gmail-derived):** Claude writes `inbox/*.json` with *proposed* events and
  project changes. The app shows them in the review queue; accepting writes them into the real files.
  You stay the one who confirms. Built in T4, see §5d.
- **Lane 2 — direct edits (only when you ask in chat):** cleanups like "merge these client names" or
  "fix the 2026 shoot dates". Claude edits the real files directly, making a timestamped backup first.
- **No hand-written JSON.** Claude writes through a repo script (`npm run data -- …`) that uses the
  app's own Zod schemas, so a malformed record is rejected loudly instead of silently skipped by the
  app's defensive parser.
- **App picks up changes:** reload collections when the window regains focus (small addition). Saving a
  single record already re-reads the file before writing, so it won't overwrite what Claude added.
  Bulk writes (`replaceAll`, e.g. migration) must do the same before T4 ships.
- **Prerequisite:** a desktop build of the new app (see §5b).

## 5b. New app alongside the old one *(decided 2026-10-08)*

The hub ships as a **separate desktop app**, not an update of QuoteGen. The old QuoteGen
(`com.michal.quotegen`, "NonoiseMedia QG") stays installed and working for real-life quoting until
the hub has earned its place.

- **Own identity:** new Tauri `identifier` (e.g. `com.michal.nonoise-hub`) and `productName`, which
  gives it its **own data folder** and its own Dock icon. The two apps never write to each other's files.
- **Quotes come in read-only:** the hub's migration *reads* the old app's
  `~/Library/Application Support/com.michal.quotegen/quotes.json` and never writes there. This needs
  a read-only filesystem permission for that one path in the hub's Tauri capabilities. The existing
  backup-before-migrate rule stays.
- **Re-import is safe:** quotes you keep making in the old app can be pulled in again later.
  `migratedFromQuoteId` already makes this idempotent, so nothing gets duplicated.
- **Same repo for now:** both apps build from this codebase (the old one from `master`, the hub from
  `v3/project-hub`). Whether the hub gets its own repo or app folder can be decided when it ships;
  it isn't needed to keep developing.
- The Claude bridge (§5a) targets the **hub's** folder only.

**Done 2026-10-08:** "NonoiseMedia Hub", identifier `com.michal.nonoisehub`, v0.3.0, own icon (logo on a
dark tile, source `src-tauri/app-icon-hub.png`). Capabilities allow reading exactly
`$DATA/com.michal.quotegen/quotes.json` and **deny** every write/mkdir under `$DATA/com.michal.quotegen`
(also via the broad `$HOME/**` PDF-export permission). `listImportableQuotes()` (`lib/legacy-app.ts`)
merges the old library with the hub's own (`mergeQuoteSources`, newer copy wins), so the migration
banner can be re-run any time. Settings the old app kept only in WebView storage (portfolio catalogue,
"my default" pricing, current pricing) were carried over once: Claude read them from the old app's
WebKit LocalStorage (a copy) and wrote `carryover-from-quotegen.json` to the hub folder, plus a copy of
`settings.json`; `applyCarryOver()` applies known keys once at start-up and never overwrites.

## 5d. Skrzynka — proposals from mail *(T4, built 2026-10-09)*

Everything that comes from mail enters the app as a **proposal** you accept. Nothing Gmail-derived
is written straight into the data files.

**Format** (`lib/inbox-types.ts`, `format: "nonoise-hub-inbox"`, `version: 1`, passthrough everywhere).
One file per sync in `<hub folder>/inbox/`, named `<local time>-<slug>.json` so name order = time order.
Three proposal types:

| `type` | Means | Accepting does |
|---|---|---|
| `event` | a new thread event (lead, reply, quote sent, won, shoot day, invoice sent/paid…) with `kind`, `start`, `end?`, `title`, `notes`, `data` | `saveEvent` with `source: { type: 'gmail', ref, threadId, inboxFile }` |
| `project_update` | fill `contact` / `leadSource` / `client` on a project; `ifMissing` (default) fills only empty fields, contact field by field | `updateProject` (a no-op is still recorded as accepted) |
| `project_new` | a new quote-less project (`name`, `client`, `date`, `leadSource`, `contact`) | `createProjectWithoutQuote`; with an existing project chosen instead it fills that project's empty fields |

Every proposal has a `ref` = **dedupe key**: `gmail:<message id>`, with a `#fact` suffix when one message
gives several facts (`#contact`, `#project`, `#shoot`). Hints for grouping and matching: `threadId`,
`client`, `email`; `reason` (one sentence, why) and `evidence` (`from`, `to`, `subject`, `date` with the
local offset, `snippet`) for the preview. Events may point at `projectId` (existing), `null` (deliberately
no project, e.g. a fake lead) or `newProject` (a `project_new` in the same file). **Status is never part of
a proposal**: the script rejects it; status changes stay the confirm-first suggestion (`statusAfter`, the
furthest forward step over all accepted kinds).

**When a proposal stops coming back** (`pendingProposals`): its `ref` is in `source.ref` of any event —
**including soft-deleted ones** — or it has a final decision in `inbox-decisions.json` (`accepted` /
`rejected`; `reopened` = rejection undone). The app writes only that decisions file; it never edits or
deletes anything in `inbox/`, so Claude can write a new file while the hub is open. The same `ref` in two
files counts once (earlier file wins).

**`npm run data -- inbox <draft.json> [--name <slug>] [--dir] [--dry-run]`** (`scripts/data.mts`, rules in
`lib/inbox-validate.ts`): strict — a schema error or any field a `.catch` would rewrite stops the write;
unknown kinds, `gear_purchase` (lives in the catalogue), time on a non-timed kind, `end` on a one-day kind,
missing project / campaign / `newProject` target, `status` anywhere → error. Known refs (events incl.
deleted, decisions, other inbox files) are skipped, so re-running a sync is a no-op. Warnings (don't block):
likely duplicates (`similarEvents`: same kind + project + day, same invoice number, same lead e-mail within
7 days), sales/money dates in the future, proposals without any hint. Writes `.tmp` then renames, so the app
never reads half a file.

**Screen „Skrzynka"** (`components/inbox/`, sidebar badge = pending count): groups by Gmail thread (a
`newProject` reference joins its project's group), newest activity first. Per group one **target**: an
existing project (suggestions in order: named by Claude → same thread → same e-mail → same company domain
→ same client; free-mail domains never count), **+ Nowy projekt…** (prefilled from `project_new` or the
lead), or *Bez projektu*. Default target only when it's unambiguous (one project from the thread or
e-mail); a returning client with several projects asks. Per proposal: preview of the mail, edit (same draft
as the calendar form: `draftFromProposal` / `proposalWithDraft`; lead quality picker), duplicate warning,
accept / reject; per group „Zaakceptuj wszystkie z wątku" (accepts what has no problems) and „Odrzuć
wszystkie". A new project is created once, on the first accept; its `project_new` is marked accepted even if
you accept only one event. „Rozpatrzone" lists decisions with „Przywróć" for rejections. Reloads on window
focus.

**Known limits / next:**
- No proposal type changes an **existing event** (e.g. link the S&A lead to its new project, add the time
  to the UAM lead). Do it in Marketing / the calendar, or add an `event_update` type later.
- Edits made in the screen live in memory until accepted.
- Undoing an accepted proposal = delete the event in the calendar; by design it won't come back.
- Amounts are PLN netto; a quote in EUR keeps the amount in notes.
- The group target applies to every proposal in the group — keep a contact update for a *different*
  project out of the thread (no `threadId`).
- `readDir` on `$APPDATA/inbox` relies on `fs:default` (`read-app-specific-dirs-recursive`); check on the
  production build.

## 5c. Calendar design system *(design pass, 2026-10-08)*

The mockup (`/design-lab`, variants A–D on example data) lived in commit `ab9c69d` and was removed in
T2 once the real calendar shipped. Check out that commit to see the variants again.

**Two colour channels, separated by form, not just hue** (`lib/calendar-palette.ts`):
- **Project = tile.** Dark tint (OKLCH L 0.30) + 3 px edge in the bright hue (L 0.74) + light text.
  12 slots, ~30° apart. Stored as a key (`'lemon'`), never a hex.
- **Event type = chip.** Small solid chip (L 0.81) with dark text and a 1–2 word label. 5 groups:
  Sprzedaż = pink (mails), Produkcja = brand orange (shoot is the key day), Postprodukcja = violet,
  Pieniądze = green, Firma = cyan, plus grey "inne".
- Because the chip is light and solid and the tile is dark and muted, even same-hue pairs (orange shoot
  chip on an orange project) stay readable. The label means the meaning never depends on colour alone,
  which also covers colour blindness.
- Events without a project (gear, marketing, notes) get a neutral grey tile.

**Measured:** every colour is inside sRGB (chroma tuned per hue so browsers don't clip and shift it).
Contrast: tile text ≥ 11:1, chip text ≥ 9.6:1, chip against tile ≥ 7:1 (WCAG AA needs 4.5:1).

**Known limits:**
- Neighbours in the 12-slot ring are close at dark tints: coral/rose/orange, lemon/amber/lime,
  teal/cyan. The assignment order (step 5 around the ring) gives consecutive new projects distant hues,
  and thread focus resolves any doubt.
- Dark yellow reads slightly olive. That's a physical property of yellow on dark backgrounds; the
  bright edge carries the "yellow".

**Interaction rules:**
- Click a tile → **thread focus**: that project's events stay lit, everything else drops to 18 %
  opacity, and the side panel shows the thread as a timeline with derived numbers ("Odpowiedź po
  4 h 26 min", "Zapłacono po 23 dniach"). Esc or "Pokaż wszystkie projekty" exits.
- Click a day → side panel lists that day's events + "Dodaj" (event types grouped like the layers).
- Layer chips above the grid are both the legend and the on/off toggles.
- Max 3 lanes per week row; overflow shows "+N więcej" per day. Multi-day events are bars that
  continue across week rows (flat edge where they continue).
- Brand typefaces: Archivo for the month title and panel headings, JetBrains Mono for day numbers,
  dates and counts (timecode feel). Inter for everything else, matching the app.
- Phone width: tiles collapse to colour bars and the day panel carries the details.

**Variants to compare (2026-10-08).** `/design-lab#a` … `#d` switch between four ways of showing the
same month. Everything else (header, layers, day/thread panel, thread focus) is shared, and each variant
has its own pair matrix at the bottom:

| | Project shown by | Type shown by | Multi-day | Strength | Cost |
|---|---|---|---|---|---|
| **A Kafle** | dark tile + left edge | light chip + label | spanning tile | balanced, compact | rounded "app" look |
| **B Montażówka** | solid mid-tone clip fill, square | 3 px band on the **top** edge + label | spanning clip, open edge when it continues | most colour at a glance; editing-timeline language; playhead for today | busiest; fills compete with each other |
| **C Nici** | coloured line across the week, one lane per project | bead (pill) on the line | line thickens | the thread is literally visible; focus reads as one line | tallest (≈2× A on phone); quiet projects still draw lines |
| **D Agenda** | colour of the project name only | **shape** + colour (● ■ ▲ ◆ ✚) + muted label | thin rule above the day's list | calmest; type readable without colour; big Archivo numerals | least colour at a glance; long names truncate first |

**Decision 2026-10-08: A (Kafle) is the chosen direction** and is what T2 shipped. `lib/oklch.ts` now
guards the palette: tests fail if any tile/chip colour leaves sRGB or drops below 7:1 text contrast,
or if a type chip stops standing out (≥ 4.5:1) against any project tile.

**Code ready for T2:** `calendar-layout.ts` (month grid, lane packing, overflow; DST-safe, 9 tests),
`calendar-palette.ts`, `event-kinds.ts` (first draft of the registry from §3.3).

## 6. Tracks, in order

| Track | What | Depends on |
|---|---|---|
| **Design pass** | Palette: ~12 project hues + 5 type-group accents that stay distinct when combined, dark theme, small sizes. Month-view mockup. | — |
| **T1a Event foundation** ✅ | `event-types.ts` (lenient schema: only a missing `id` drops a record), `event-kinds.ts` (per-kind `data` schemas read without rewriting storage, forward-only `statusSuggestion`), `events-store.ts` (`events.json`, soft delete/restore), `thread-stats.ts` (numbers + Polish sentences; invoices paired by number, then by date; paid/open/planned). 37 tests incl. a newer-version round trip; 8/8 deliberate mutations caught. | — |
| **T1b Project additions** ✅ | ~~Status `lead`~~ (reverted 2026-10-08: a lead is the `lead_in` event; quote-less projects are `quote`, see §3.5). Optional `colorKey` (new projects get the least-used slot; older ones a stable slot hashed from id, frozen by their first save; reading never writes), `contact`, `leadSource` (`LEAD_SOURCES` as suggestions; the message channel stays on the `lead_in` event, so contact and source live only on the project). `quote` nullable: opening a lead loads a clean calculator with the client prefilled; backfill and the "missing financials" banner ignore leads. `projectSchema` is now `.passthrough()`. 9 new tests; 8/8 mutations caught. | — |
| **T2 Calendar tab** ✅ | `components/calendar/`: landing section „Kalendarz"; month grid (variant A), month summary incl. gear spend, layer toggles, thread focus with derived numbers, day panel. Add/edit form with per-kind fields, time for sales events, ranges, „+ Nowy projekt…" (creates a quote-less project), forward-only status suggestion with confirm, soft delete with „Cofnij". Gear purchases are written to the **catalogue** (purchase date) and projected, never stored as events. `EventsProvider` reloads on window focus (bridge-ready, §5a). Pure: `calendar-entries.ts`, `event-draft.ts` (edits keep unknown fields, `data` keys and import source). 11 + palette tests; 8/8 mutations caught; full flow verified in the browser. | — |
| **T3 Project thread** ✅ (2026-10-09, §6b) | Project header + tabs (Oś czasu · Wycena · Sprzęt · Notatki) replacing the crowded project bar; client picker with contact copy; client and year filters on the list; deleting a project soft-deletes it together with its thread, with undo. Pure: `clients.ts`, `project-list.ts`, `project-deletion.ts`, header client rule in `project-save.ts`; collection writes are serialized. 27 new tests; 18/18 mutations caught; flows verified in the browser. | T1 |
| **T4 Gmail import v0** ✅ (2026-10-09, §5d) | ✅ data script (`npm run data`), ✅ refresh-on-focus, ✅ 2026 retrofill (from the spreadsheet, not Gmail: 13 projects, 24 invoice events, 42 fixed costs, spring Google Ads). ✅ Inbox format (`inbox-types.ts`), `npm run data -- inbox`, „Skrzynka" screen with sidebar counter, Gmail pilot 1.09–9.10. 22 tests (+1 extended payments test); 19/19 mutations caught. Next: a recurring "sync my mail" from chat. | T1, T3 |
| **T5a Realizacja tab** ✅ (2026-10-09, §6c) | The project's Sprzęt tab became Realizacja: shoot/prep days whose date lives in the calendar (variant A), gear per day (G3 grid), crew and other actual costs (`Project.costs`), Profit moved out of the calculator as the plan, planned vs actual margin. Pure: `realization-days.ts`, `project-costs.ts`, `realization-plan.ts`. 37 new tests; 20/20 mutations caught; flows verified in the browser and on the production export. | T1 |
| **T5b Call sheet planner** | CallSheetWiz attached to a shoot day (`shoot_day.data.callSheetId`), crew from the day's `Project.costs`, phone numbers from the crew database (T9a). | T5a, T9a |
| **T6 Money loop** | Invoice events → actual revenue, planned vs actual in Finance (actual costs: `totalActualCosts` / `actualCostsByCategory` on `Project.costs`, §6c), days-to-payment, overdue list. | T5a, phase 4 |
| **T7a Marketing tab** ✅ (installed 2026-10-09) | See §6a. Campaigns, lead quality, cost per lead/won job, ROAS, client origin on every project. First half of T7. `npm run data` (the T4 data script) exists now. | T1 |
| **T7 Insights** | Response time, conversion by source, effort (post days) vs quoted, gear spend/month, cost per lead. | T4, T6 |
| **T8 In-app Gmail + AI** | OAuth + Claude API producing the T4 format. Optional. | T4 |
| **T9a Ekipa: people + Realizacja** (idea, §6d) | `crew-roles.json` (seeded from the 8 roles), `crew.json` (people, contact, rate), screen „Ekipa" with derived stats (days together, paid, last time), person picker with **+** in Realizacja crew rows (`ProjectCost.personId`), "Dodaj do bazy" for names already used. | T5a |
| **T9b Ekipa in the quote** (idea, §6d) | Per-day crew lines: role placeholder or person, **+** new role, rates frozen; old counters under "Stare pozycje ekipy"; plan cost from person or role; "Przepisz ekipę z planu" carries the person; crew kits. | T9a, G5 |
| **T9c Retire the old rows** (idea, §6d) | New quotes stop offering fixed crew counters and old gear fields; quick-mode packages become kits. Old quotes unchanged. | T9b, use in practice |
| **T10 Klienci** (idea, §6d) | Sidebar list + page per client, all derived: revenue (total, per year, share), return rhythm, size trend, win rate, first lead source, merge spellings. Days to payment after T6, crew after T9. | T3 |

The first usable milestone is **T1 + T2 + T3**: a calendar you can fill by hand and project threads
that start at the lead. T4 then fills in 2026 for you.

**Suggested order from 2026-10-10:** T10 Klienci can run any time in parallel: it adds a screen and
only reads data, so it touches little besides the sidebar. T9a goes before T5b (the call sheet wants
the phone numbers). T9b edits the calculator (`produkcja.tsx`, `profit-calc.ts`, `quote-calc.ts`), so
no other calculator work should run in parallel with it. T6 lives in Finance and doesn't collide
with T9 or T10.

## 6b. T3 spec *(agreed with M.J. 2026-10-09)*

**Header** (replaces `components/projects/project-bar.tsx`): back to the list, project name at full
width, client (picker, see below), ledger date, status switch, client origin, the "Zapłacone"
checkbox (only for `won`/`done`, same `PaidToggle`), "Zapisz" with the existing replace-financials
confirmation (`lib/project-save.ts`). Name must never be squeezed again; wrap onto two rows by design.

**Tabs:** `Oś czasu · Wycena · Sprzęt · Notatki`.
- **Default tab: Oś czasu for `won`/`done`, Wycena for `quote`/`lost`** (decided).
- *Oś czasu*: the project's thread from `events.json` (reuse `thread-stats` + the calendar's thread
  panel pieces): derived numbers on top, timeline below, lead details (quality, campaign, channel,
  summary from `lead_in` data), "add event" with the project preselected (reuse `EventForm`), edit
  and soft delete with undo.
- *Wycena*: today's calculator, unchanged; client/contact from the project prefill a blank quote.
- *Sprzęt*: unchanged (becomes Realizacja in T5).
- *Notatki*: `Project.notes` (lessons learned), autosaved.

**Client = a field, not a record** (§3.2a): the client input suggests names already used, grouped by
a normalised key (trim, case- and diacritic-insensitive); picking an existing client copies
`contact` from that client's latest project when the current one has none. Optional "merge client
names" can wait.

**List:** client filter (shows that client's revenue — same rule as Finance) and year filter, next
to the existing filters + "Ukryj nieprzyjęte"; remember the last choice.

**Deleting a project soft-deletes its events too** (decided): the confirmation says how many
("usunie też 6 wydarzeń"); events get `deletedAt`, nothing is hard-deleted. Projected gear purchases
are not project events and stay.

**As built (2026-10-09):**
- **Project deletion is soft too** (`Project.deletedAt`), so "nothing is hard-deleted" holds for the
  project as well. The project and its thread get the *same* `deletedAt`; "Cofnij" on the list
  restores exactly those events (an event deleted separately before stays deleted). Migration and the
  financials backfill read the full file (`listAllProjects`), so a deleted migrated quote does not come
  back and a whole-collection write does not drop deleted records.
- **Leads go with the project.** A `lead_in` linked to the deleted project is soft-deleted with it and
  leaves the Marketing stats; the confirmation says so ("w tym 1 lead"). If leads should rather stay
  as project-less leads, that is a one-line change in `planProjectDeletion`.
- **Header client wins.** The client set in the header is the project's client (grouping, client
  revenue). The "Nazwa klienta" field in the PDF tab is only the printed label (e.g. the full company
  name) and fills the project's client only when it is empty (`clientAfterSave`). A blank quote picks
  up a newly chosen client only while nothing would be lost: no saved quote, nothing built in the
  calculator, PDF tab not opened yet (`canReprefillBlankQuote`).
- **Client picker:** suggestions by normalised key (`clientKey`: trim, case, Polish letters incl. "ł"),
  most frequent spelling shown. Typed text is kept as typed; picking from the list uses the shown
  spelling. Contact is copied from the client's most recent project that has one, only when the
  current project has none ("Kontakt (…) skopiowany z projektu „…""). The timeline tab shows and edits
  the contact; "Przepisz z leada" fills it from the lead's contact fields.
- **Timeline tab:** numbers on top, thread below (shared `ThreadStatsList` / `ThreadTimeline` with the
  calendar's thread panel), lead card with one-click quality, campaign/origin, channel, request,
  contact; add/edit through the calendar's `EventForm`; the shared `EventNotice` gives "Cofnij" after a
  delete and the confirm-first status suggestion after a save.
- **Notes tab:** autosave ~0.7 s after typing, on blur and when leaving the tab. Hub writes go through
  `patchProject` on the latest in-memory project, and the collection store queues writes, so a notes
  save never reverts a status change made a moment before (and vice versa).
- **List:** client filter shows the client's revenue (same rule as Finance: W realizacji +
  Zrealizowane, `sumaNetto`), for the selected year if one is chosen; filter, client and year are
  remembered (`nonoise-projects-list-v1`); search ignores case and Polish letters.

## 6c. T5a Realizacja *(agreed with M.J. 2026-10-09)*

**Decision: one source of a "shoot day" — variant A, the calendar.** Before T5a there were two:
`shoot_day` / `prep_day` events and `Project.gearDays` (with an optional date). Now a dated day *is*
its calendar event; gear, crew and costs hang on the day record in the project, and the day record
points at its event:

```
ProjectCost.dayId → Project.gearDays[].id → (eventId, eventDay) → events.json shoot_day / prep_day
```

`eventDay` says which day of a multi-day event it is (an event 28–30.10 is three days with their own
crew). Considered and rejected: B (days live in the project and the calendar only projects them — would
have changed the T4 inbox format, the month summary, thread stats and dropped multi-day bars) and C
(keep both — dates drift). At decision time the hub data had no shoot/prep events and no `gearDays`, so
nothing had to be matched or migrated. Also decided: undated days are allowed (they stay out of the
calendar until they get a date), crew is per day with "same crew on every day" and "copy crew from the
plan", and the actual margin uses the plan's revenue (transfer amount) until T6 brings invoices.

**Data (all additive, passthrough, no version bump):**
- `GearDay.eventId?`, `eventDay?`, `kind?` (`shoot_day` / `prep_day` for days without an event),
  `deletedAt?`. `date` is only the last known date: for undated days, for older builds and when there is
  no event record at all.
- `Project.costs?: ProjectCost[]` — `{ id, category, unitCost, quantity?, label?, person?, role?, dayId?,
  source?, createdAt?, deletedAt? }`, amount = quantity (default 1) × unitCost, PLN netto. Categories
  are a free string with known keys `ekipa, wynajem, dojazd, catering, nocleg, sprzet, preprodukcja,
  postprodukcja, inne`. Optional fields have no defaults, so `npm run data` accepts a minimal record
  without "fixing" it. Costs never touch `financials` or Finance.

**As built (2026-10-09):**
- **Days** (`resolveRealizationDays`): every day of the project's shoot/prep events, plus stored days.
  Stored links win; an unlinked stored day with a date takes a free event of that date (same kind
  first); events without a stored day show up as days "from the calendar". Reading never writes: links
  and calendar days are saved with the first change in the tab, like G3's suggestions. A day whose
  event was deleted, shortened, moved to another project or turned into another kind keeps its gear,
  crew and costs and takes its date from the event record (soft-deleted events stay in the file), with
  "Przywróć w kalendarzu" / "Dodaj do kalendarza". Two days pointing at the same event day: the first
  wins.
- **Tab** (`components/realization/`): plan vs actual tiles (costs, profit, margin; delta vs plan with
  a sign) and a per-category table; day cards (date and place from the calendar, "Edytuj w kalendarzu"
  opens the calendar's event form in a side sheet, crew rows with name suggestions and the person's
  last rate from won/done projects, day costs); the G3 grid unchanged in behaviour (its day popover
  shows the calendar controls instead of a date field); project-level costs; "Plan z wyceny" = the
  former Profit tab, open by default for quotes, folded for won/done, with a "zmieniony — kliknij
  Zapisz" chip when the calculator differs from the saved quote.
- **+ Dzień** with a date writes a `shoot_day` / `prep_day` event (the day appears from the calendar);
  without a date it adds an undated day to the project. Removing a day soft-deletes it with its costs
  and — for a one-day event — the event; "Cofnij" restores exactly those. A day of a multi-day event is
  shortened in the calendar instead.
- **Plan** (`realization-plan.ts`): from the live calculator for a project with a quote (or one being
  built), otherwise the imported `financials` (retro imports: read-only, revenue and costs as imported).
  Same numbers as `computeSnapshotFinancials`. Plan lines map onto cost categories (crew roles → ekipa,
  "Rental sprzętu" → wynajem, fuel → dojazd, …) for the comparison. Copy crew from the plan: day N of
  the quote → the N-th shoot day; roles marked "nie mój koszt" are skipped; days that already have crew
  are left alone.
- **Calculator**: the Profit tab is gone; its data still lives in the quote and "Zapisz" saves it.
- **Gear stats** (Sprzęt screen, item history) take day dates from the calendar; soft-deleted days do
  not count anywhere.

**For T6:** actual costs of a project = `totalActualCosts(project.costs)`, split =
`actualCostsByCategory(project.costs)` (both skip soft-deleted lines). Per day: `costsOfDay`. Planned
costs stay in `financials.koszty`.

**Known limits / follow-ups:**
- An older hub build shows soft-deleted days as normal days (it does not know `deletedAt` on days).
  The installed app is replaced by this build, so this only matters if an old build is opened again.
- The event form opened from Realizacja still offers every kind; changing a shoot day into another
  kind leaves the day "outside its event" (nothing is lost).
- Crew suggestions come only from won/done projects (quote rates are hypotheses).
- Day labels default to "Dzień N" over all days (prep included); an event title is used when set.

## 6d. Ideas: crew database and client pages *(M.J. 2026-10-10, not started)*

### Ekipa — a database of people, picked like gear (T9)

**Asked for:** a "Crew" panel with contacts for crew members and contractors; pick them from a
dropdown when building a quote and when filling in Realizacja. In the quote a slot can be a
**placeholder role** ("asystent", "operator", "gaffer") picked from a dropdown with **+** for a new
role; a real person can be chosen later. Same mechanics as gear (G5). Later, retire the old way
(fixed role rows per day with an arbitrary count, labels renamed and prices edited by hand, used as
generic slots). Later stats: how often I worked with Łukasz or Piotrek.

**What exists today:** the quote has fixed counters per day (`ShootingDay.rezOp … statysta`, labels
overridable in `crewNames`, prices from the pricing config). Realizacja crew rows are
`Project.costs` with free-text `person` / `role` and a rate; `crewSuggestions` already derives names
and last rates from won/done projects; "Przepisz ekipę z planu" copies roles with an empty person.

**Proposed shape (mirrors the G series, all additive):**
- **Role list** (`crew-roles.json`): `{ id, name, clientRate, costRate?, group: ekipa | obsada | post,
  order, retiredAt? }`. Seeded once from the 8 current roles and their pricing-config rates; **+** in
  any picker adds a role. A role is what the client pays for.
- **People** (`crew.json`): `{ id, name, roles: roleId[], rate? (what they charge me per day),
  contact { phone, email }, city?, notes?, retiredAt?, deletedAt? }`. A person is what I pay.
- **Quote** (`ShootingDay.crew?: QuoteCrewLine[]`): `{ id, roleId, roleName, personId?, personName?,
  clientRate, costRate, qty }`, names and rates **frozen** when added (like `QuoteGearLine`). A line
  without `personId` is a placeholder. Old counters stay readable under "Stare pozycje ekipy" and
  price exactly as before. Header margin applies as it does to crew today. Crew kits ("Wywiad:
  operator + dźwięk") reuse the G6 idea.
- **Plan (former Profit):** one cost line per crew line, cost = the person's rate if assigned, else
  the role's `costRate`, else the client rate (today's behaviour).
- **Realizacja:** crew rows get the same picker (+ new person inline); `ProjectCost.personId?` next
  to the frozen `person` name. "Przepisz ekipę z planu" carries the person when the quote had one;
  placeholders stay to be filled in. Older free-text names: "Dodaj do bazy" offers the names
  already used in `Project.costs` (reading never writes).
- **Screen "Ekipa"** (sidebar, like Sprzęt): list with search and role filter, side panel to edit,
  contact copy, retire / restore. Derived stats from **actual** crew costs of won/done projects
  (quote placeholders don't count): days worked together, projects, last time, paid this year and
  in total, average day rate, roles played, project history (click opens the project), ranking
  "najczęściej pracuję z…".
- **Retiring the old way (later, T9c):** new quotes stop offering the fixed counters and the gear
  fields G5 folded away; quotes that use them still show and price them. Quick-mode crew size and
  gear packages could become kits then (G6 decision 10). Nothing is deleted (§3.4).
- **Link to T5b:** a call sheet needs phone numbers, so the people database should come first.

### Klienci — a page per client (T10)

**Asked for:** a section where a repeat client has its own page: how often they come back, whether
projects grow or shrink, revenue brought in by that client.

**Proposed:** keep §3.2a. Everything is **derived** from projects grouped by `clientKey`;
`clientDirectory` and `clientRevenue` already exist. No clients file is needed for the stats.
- **List "Klienci"** (sidebar): name, projects, revenue, last project, a "wraca" mark for repeat
  clients (≥ 2 won/done projects); sort by revenue, recency, number of projects.
- **Client page:**
  - revenue total and per year, share of my revenue, profit and margin from `financials`;
  - how often they come back: median gap between projects, "ostatni projekt N mies. temu", a nudge
    when the gap is well past their usual;
  - size trend: project values in date order as small bars, with "rośnie / maleje / stabilnie" once
    there are 3+ projects;
  - win rate: quotes vs won vs lost;
  - days to payment (from invoice events, T6), how they first came (`leadSource` of the first
    project), crew used on their jobs (after T9);
  - project list (click opens the project) and latest contact.
- **"Scal nazwy"** (merge spellings, planned for Settings in §3.2a) lives on this page instead.
- **Only if needed later:** a small `clients.json` keyed by `clientKey` for facts that can't be
  derived (NIP and address for invoices, notes). That would revisit decision 3 in §7.

### Open questions for M.J.
1. Client price in the quote comes from the **role** and the person only changes my cost
   (recommended), or each person has their own client price?
2. Contractors who aren't on set (editor, colourist, motion designer): same database with a `post`
   role group (recommended), or a separate list?
3. Klienci and Ekipa as two new sidebar sections (9 items), or Ekipa and Sprzęt grouped as "Zasoby"?

## 6a. Marketing tab *(built 2026-10-08)*

**Asked for:** campaign start and daily budget from Google Ads; leads rated fake / good / very good;
cost per lead and the rest of the search-ads arithmetic; leads linked to projects; client origin
(repeat client, word of mouth, face-to-face networking, Google Ads) visible on every project.

**Where each fact lives** (no new copy of anything; `lib/marketing-types.ts`):

| Fact | Stored as | Also read by |
|---|---|---|
| Campaign: name, platform, start/end, daily budget with changes | `campaigns.json` (`campaignSchema`, passthrough) | — |
| Monthly spend, clicks, impressions from the ad panel | `finances.json`: a `marketing` fixed cost with `campaignId`, `clicks`, `impressions` | Finance (same złoty, no bridge, nothing counted twice) |
| A lead | `lead_in` event; `data.quality`, `data.campaignId`, `data.origin` (outside a campaign), contact fields | Calendar, project thread |
| Client origin | `Project.leadSource` (`LEAD_SOURCES`: `powracajacy`, `polecenie`, `networking`, `google_ads`, `inne`) | project bar dropdown, project list, origins table |

- `lead_in` is now `scope: 'either'`: a fake lead (job seeker) is a lead without a project.
- Starting a project from a lead creates a quote-less project with client, date, contact and origin
  (from a campaign → `google_ads`). Linking a lead to an existing project fills its origin only if empty.
- Month without a panel reading → spend estimated from the daily budget and marked "~" / "szac.";
  Google's monthly cap is daily × 30.4.
- `lib/marketing-calc.ts` (pure, 13 tests): window, budget per day, months, CTR, CPC, click→lead,
  cost per inquiry / real lead / very good lead, fake share, funnel (inquiries → real → quoted → won),
  revenue, profit after ads, ROAS, ROI, "one job pays N months of ads", origin breakdown.
  `lib/marketing-leads.ts` (pure, 8 tests): lead ⇄ event, edits keep unknown keys. 9/9 mutations caught.
- Screen: `components/marketing/`. KPI tiles, funnel, traffic + derived hints, editable months table,
  leads list with one-click rating, origins table with inline "set origin" for projects missing one.

**`npm run data -- apply <patch.json> [--dir] [--dry-run]`** (`scripts/data.mts`): writes to the hub
folder through the app's Zod schemas, refuses records a schema would silently "fix", upserts by id
(re-running is a no-op), backs up every touched file to `backups/` first. Don't run it while the hub
app is open: projects are held in memory and the next save would overwrite the patch.

**First import** (staged in `imports/2026-10-08-google-ads-kwi-lip-2026.json` in the hub folder): the
Apr 9–Jul 7 Google Ads campaign, monthly spend/clicks/impressions split from the report totals by days
(6,798 zł, 438 clicks, ~5,959 impressions), 22 leads from the spreadsheet + 2 job applications (fake)
+ the S-AI lead (phone, ~29.04, not in the sheet), and `leadSource: google_ads` on Morris & Lloyd,
JHJ and S-AI.

**Second import (2026-10-09, applied):** `imports/2026-10-09-google-ads-relaunch-jesien-2026.json`, the
ongoing relaunch from 24.09.2026 (from `Nonoise_Kampania_Google_Ads_jesien_2026.xlsx` + panel screenshots).
Panel reading for 1.09–7.10: 184 clicks, ~3,060 impressions, CPC 7.26 zł → 1,335.84 zł. September is
776.90 zł from billing, October is the remainder up to 7.10 (558.94 zł). Clicks and impressions are split
by spend share. Billing already showed 671.03 zł for October on 9.10; enter it together with the next
click reading. Leads: Poznań university → "Uniwersytet Medyczny w Poznaniu", Tchibo → "Tchibo Event",
S&A jewellery design and XL (no projects yet), 2 freelancer offers (fake), and `reply_sent` events for
the university and Tchibo threads. The daily budget is unknown, so the campaign has `budgets: []`: the
header asks for it, and months without a reading count as 0 zł (no estimate).

**Known limits / next:**
- "Quoted" counts only leads with a project; leads that got a quote outside the hub (most of the
  spring campaign) aren't in that step. Start projects for them if the funnel should show it.
- Campaign start/end are not projected onto the calendar yet (the `marketing` event kind still exists
  for one-off spend; consider projecting campaigns like gear purchases).
- An older build strips `campaignId`/`clicks`/`impressions` from fixed costs when it saves
  `finances.json`; re-running the import restores them.

---

### Done after T2 (2026-10-09)

- Project list: "Ukryj nieprzyjęte" (default on), grey amounts for anything that doesn't count, paid
  checkbox ("Zapłacone", stored as `invoice_paid` events; `lib/payments.ts`).
- "Nowy projekt" always starts blank; quotes without their own PDF draft reset the PDF tab (this was
  how S-AI inherited Morris & Lloyd as client).
- PDF tab: the saved-draft prompt is replaced by a notice only when PDF prices differ from the
  calculator, with "update prices" / "keep".
- Finance: revenue split into paid / waiting; fixed-cost tile lists "inne"; 2026 fixed costs applied.
- Quote-less projects keep imported financials on save (`lib/project-save.ts`).

### Follow-ups noticed during T1–T2

- The Sprzęt screen has no field for `purchaseDate`; the calendar form is currently the only way to
  set it. Add a date column/field there (T5 touches the gear tab anyway).
- ~~Deleting a project leaves its events behind~~ — done in T3: the thread is soft-deleted with the
  project (§6b). Events deleted by older builds' hard project deletes still show as „Usunięty projekt".
- Layer toggles and the viewed month are not remembered between launches.

- `Project.date` still has no `.catch`, so a project with a malformed date is dropped on read and
  lost on the next collection write (pre-existing; an existing test asserts it). Worth relaxing
  the same way events were, once the finance views handle an undated project.
- ~~The project bar is overcrowded~~ — replaced by the T3 project header (name on its own row).

### Follow-ups noticed during T3

- "Merge client names" in Settings (rewrite `client` on the affected projects) is still open; grouping
  already treats spelling variants as one client.
- The financials backfill and the quote migration read and write the whole project file outside the
  write queue. Both are rare manual actions; move them onto `store.mutate` if that ever matters.
- The event form opened from a project still offers business kinds (gear purchase, marketing) and
  "+ Nowy projekt…"; picking them moves the entry out of this thread. Consider a project-only mode.
- Equipment, fixed costs and campaigns are still hard-deleted (pre-existing).
- ~~Opening a project without its own `pdfDraft` keeps the previous project's PDF draft~~ — fixed
  2026-10-09.

## 7. Decisions

Confirmed 2026-10-08:
1. **Landing tab:** Kalendarz is the default screen.
2. **No `lead` status** (revised 2026-10-08): a lead is the `lead_in` event; projects without a quote
   are `quote` / „brak wyceny". The list hides **lost** quotes by default (§4).
3. **Client is a field on the project**, not a separate record (§3.2a).
4. **Status changes** are suggestions you confirm.
5. **Profit tab:** only the screen moves to Realizacja. The data stays where it is (planned costs
   inside the project's quote) and Realizacja adds actual costs next to it. One set of data, several
   views of it.

6. **Gmail and AI stay in the chat** (route A). Claude writes to the app's local files through the
   bridge in §5a; no in-app Gmail login or API key. T8 is dropped unless that changes.

## 8. Coordination with the phase-4 agent

- Phase 4 owns `finance-calc.ts`, `finances-store.ts` and the financials backfill. T1 should start
  **after phase 4 is merged** into `v3/project-hub`, or on a branch rebased onto it, because both
  edit `project-types.ts`.
- T6 extends phase 4's dashboard (planned vs actual) rather than building a second one.
