# Plan: Gear that pays for itself (G-track)

> Follows [PLAN-V3-PROJECT-HUB.md](PLAN-V3-PROJECT-HUB.md) (phase 3 built the catalogue, the project
> Sprzęt tab and a first ROI) and runs alongside T3 in [PLAN-CALENDAR-AND-THREADS.md](PLAN-CALENDAR-AND-THREADS.md).
> Source: M.J., 2026-10-09. Track numbers are **G1–G7** so they don't collide with phases or T-tracks.

## 1. The problem

Gear has to pay for itself. For every item I own I want to see how often it goes on set and how
much money it brings in, so I know what is paid off, what is close and what is dead weight, and
buy better next time.

## 2. Decisions (2026-10-09)

1. **"Used on day X" lives on the project**, in the project's Sprzęt tab (next to Wycena; T5 later
   turns it into Realizacja together with Profit). It is what actually went on set. It never
   changes quote amounts and never touches `financials`, so 2026 projects can get their gear
   without rebuilding the quote.
2. **The sidebar Sprzęt screen is the gear list**: each item with its stats, clickable to edit
   purchase date, price, rental rate, quantity, retire.
3. **Two numbers per item, both tracked:**

   | Name (working) | Means | Computed as |
   |---|---|---|
   | **Odpracował** (`rentValue`) | What it would have cost me to rent it every time I took it | unit-days × rental day rate |
   | **Zarobił** (`clientPaid`) | What clients actually paid for it | the quote's gear amount, spread over the items used (§4) |

   Names confirmed by M.J. 2026-10-09.
4. **Identical items = one record with a quantity.** Purchase price and rental rate are per unit;
   invested = price × quantity. No per-unit tracking (serials, different purchase dates).
5. **Gear in the quote with a discount** (old decision E reversed): the quote's per-day gear
   becomes a picker over my own catalogue, priced from rental rates, with a gear discount slider
   and a per-item "gratis" switch (G5).

Confirmed 2026-10-10 (G5/G6, M.J. took the recommended option for each):

6. **Old per-day gear options stay readable, not offered.** New days use the picker; the old fields
   (Sony/RED counters, lenses/stabilisation/monitoring/light standard vs rental, drone) are folded
   under "Stare pozycje sprzętu", open automatically on days that use them, and price exactly as
   before. Rented-in gear is a free "Z wypożyczalni" line per day (label + amount): the client pays
   that amount and it is also my cost in the plan (category "wynajem").
7. **No margin on catalogue gear.** Price = rental rate × units × (1 − gear discount). The header
   margin slider still applies to everything else, old gear fields included.
8. **One gear discount per quote** (0–100 %) plus "gratis" per line.
9. **PDF shows value and discount** in the gear row's description ("Wartość rynkowa sprzętu: X,
   rabat: −Y"), switchable per quote, on by default.
10. **Quick-mode packages unchanged** for now (minimalistyczny / standard / kinowy).

## 3. Data (G1, done)

All additive, nothing to migrate. New schemas use `.passthrough()`.

- `EquipmentItem.category` is a **free string** with known keys in packing order:
  `kamery, obiektywy, stabilizacja, podglad, swiatlo, dzwiek, zasilanie, drony, inne`. Unknown keys
  show verbatim and sort last. (Before: a 4-value enum where anything else became "inne".)
- `EquipmentItem.quantity?` (missing = 1), `EquipmentItem.retiredAt?` (sold/broken: stays in
  history, hidden from pickers, no payoff forecast).
- `Project.gearDays?: { id, label, date, lines: { itemId, qty }[] }[]`. Missing = project still in
  the old shape `equipment: { itemId, days }[]`, which is still read (converted to days on read).
  An empty list means "deliberately no gear". A day's `date` is optional; stats fall back to the
  project's ledger date.
- One bad line or day is dropped on read, the rest survives (a plain `z.array().catch([])` would
  wipe the whole list).

Pure modules (tests + 8/8 mutations caught):
- `lib/gear-usage.ts`: read both shapes, per-day editing helpers, day suggestions (old shape →
  calendar `shoot_day` dates → quote day count → one day), packing list per project or per day.
- `lib/gear-revenue.ts`: what the client paid for gear on a project, from the quote snapshot.
- `lib/equipment-roi.ts`: `summarizeProjectGear` (one project, any status) and `computeGearReport`
  (catalogue: both numbers, %, paid-off flags, first/last use, days per month owned, projected
  payoff month for each number, totals, "projects without gear" list), `itemUsageHistory`.

## 4. How "Zarobił" is computed (exact since G5, estimated for older quotes)

Every quote already has a gear amount (`sprzetNetto` in `quote-calc.ts`: the package in quick mode,
cameras/lenses/light/… in detailed mode). For each won/done project:

```
scale      = actual transfer / quote netto              a discount on the whole job covers gear too
charged    = sprzetNetto × scale                         all gear in the quote, rentals included
itemized   = catalogue lines after discount × scale      EXACT, per item (G5)
rentedIn   = plan lines in "wynajem": manual "Rental sprzętu" + per-day "Z wypożyczalni", if costs
unitemized = max(0, charged − itemized − rentedIn)       old-style gear (package, standard/rental…)
ownGear    = itemized + unitemized
```

`itemized` goes to each catalogue item exactly, even if the item was not ticked in Realizacja
(the client paid for it). `unitemized` is spread over the items logged in Realizacja in proportion
to their Odpracował value (by unit-days when no item has a rate): an estimate, shown with "~".
Rented-in gear only reduces the unitemized part. Money with nowhere to go (old-style gear on a
project with no gear logged, or a catalogue line whose item was deleted) is **unassigned**;
projects without a quote (2026 retro imports) count as **unknown**. Both feed the retrofit list.

Neither number is company revenue: the gear payment is already inside the project's revenue in
Finance. They only answer "did this purchase pay off".

## 5. Tracks

| Track | What | Who / status |
|---|---|---|
| **G1 Data + logic** | §3, §4 | ✅ this session |
| **G2 Import my gear list** | First batch staged: `imports/2026-10-09-sprzet.json`, 15 items from M.J.'s "GEAR YOU OWN" screenshot, **without purchase prices and rental rates** (not in the screenshot). Apply per §5a. Later changes to existing items go in as `update` + `set` (an `upsert` replaces the whole record and would wipe what was typed in the app). | ✅ applied 2026-10-09 (15 items, 17 units); purchase prices, dates and rental rates still to fill in the app |
| **G3 Project Sprzęt tab** | Grid: rows = catalogue (search, "Na planie" filter, retired hidden unless used here), columns = days (popover: name, date, duplicate, delete). Click a name = all days, click a cell = one day; items with several units cycle all → one less → none. Odpracował per item, per day and total; Zarobił for the project (from the quote, "~"). Suggested days are shown but saved only on the first change. Local copy + 250 ms delayed save so fast clicking can't lose edits. Packing list for the whole project or one day, printable. | ✅ |
| **G4 Sprzęt screen** | Tiles (invested, Odpracował, Zarobił incl. unassigned, unused; warnings for missing price / rate), banner listing won/done projects without gear (click opens the project), search, sort (category, Odpracował, Zarobił, most used, closest to payoff, longest unused), retired toggle. Rows: units, prices, usage, both numbers, two-tone payoff bar + forecast. Click → side panel: edit everything incl. purchase date, quantity, custom category; stats; project history (click opens the project); retire / restore; delete with a warning. | ✅ |
| **G5 Gear in the quote** | `ShootingDay.gear` (catalogue lines: itemId, name and rate **frozen** when added, qty, gratis) and `ShootingDay.externalRentals` (label, amount); `QuoteData.gearDiscountPercent`, `gearValueInPdf`. Pure: `lib/quote-gear.ts`. Produkcja: per-day picker (search, grouped catalogue, click = all units, ± units, gratis, remove), "Z wypożyczalni" lines, "Mój sprzęt w wycenie" panel (value / discount and gratis / in quote, discount slider, PDF switch, "N positions have another rate than the catalogue · update", warning for items without a rate). Day totals and `sprzetNetto` include it; plan gets a "wynajem" cost line per rental. PDF gear row description lists gear, rentals and value with discount. Zarobił exact per item (§4). Realizacja: "Sprzęt z wyceny" = quote day N → N-th shoot day, days with gear left alone, "Cofnij". | ✅ 2026-10-10 |
| **G6 Kits** | `gear-kits.json` (`GearKit`: name + lines; prices always from the catalogue). Save a day as a kit in Produkcja ("Zapisz jako zestaw") or in Realizacja (day menu); apply in the Produkcja picker ("Zestawy") or the Realizacja day menu (missing items only, never more units than owned, retired skipped). Sprzęt screen: "Zestawy" list with value per day, rename, delete. Quick-mode packages unchanged (decision 10). | ✅ 2026-10-10 (quick mode not converted) |
| **G7 Retrofit 2026** | M.J. logs gear per project from the G4 checklist (route A: Sprzęt tab only, numbers untouched) or rebuilds the quote (route B, after G5; the existing replace-financials confirmation in `lib/project-save.ts` covers it). Adding shoot days in the calendar first lets the Sprzęt tab prefill dates. | M.J. |

## 5a. Applying an import (on the Mac)

1. The hub app installed on the Mac must include G1 (this branch merged into `v3/project-hub`, app rebuilt).
2. Quit the hub app (the script refuses to write while it runs).
3. `npm run data -- apply imports/2026-10-09-sprzet.json` (add `--dry-run` first to preview). It backs up
   `equipment.json` to `backups/` before writing; re-running is a no-op.
4. Open the app: Sprzęt shows the items; fill in purchase price, date and rental rate per item in its panel.

## 6. Coordination

- Built on `v3/project-hub` at the T3 spec commit, on its own branch; merged into v3 after T3 lands.
- Files outside the gear area touched by G1: `lib/quote-financials.ts` (extracted `resolveSnapshot`,
  behaviour unchanged) and two lines in `components/calendar/event-form.tsx` (category is a string).
- **T3: please keep `components/equipment/project-equipment.tsx` and its `ProjectEquipment` export**;
  G3 rewrote its body. `app-shell.tsx` got one line: `<EquipmentSection onOpenProject={goToProject} />`.
- After T3: let "open project" from the Sprzęt screen land directly on the project's Sprzęt tab (today it
  opens the project on its default tab).
- T5 (Realizacja) absorbs the Sprzęt tab as is; nothing in G changes that plan. **Done in T5a
  (2026-10-09):** the grid lives in the project's Realizacja tab (`GearGrid`, controlled by
  `ProjectRealization`); its columns are the realization days, whose dates come from the calendar
  (`realization-days.ts`, plan §6c). Click behaviour is unchanged; a day's date is edited in the
  calendar, and day removal is soft with "Cofnij".

Follow-ups from G5/G6:
- ~~`scripts/data.mts` does not list `gear-kits.json` yet~~ — added after the T4 merge (2026-10-10).
- Catalogue rental rates are still empty in the real data: until they are filled, catalogue gear
  prices at 0 zł in a quote (the panel warns about it).

## 7. Ideas, not planned

- Resale value: selling a camera returns money; a `salePrice` next to `retiredAt` would count it
  toward payoff.
- Manual "client paid for gear on this project" for retro projects that won't get a rebuilt quote.
