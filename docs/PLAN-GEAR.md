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

   Names are working titles until M.J. confirms them.
4. **Identical items = one record with a quantity.** Purchase price and rental rate are per unit;
   invested = price × quantity. No per-unit tracking (serials, different purchase dates).
5. **Gear in the quote with a discount** (old decision E reversed): the quote's per-day gear
   becomes a picker over my own catalogue, priced from rental rates, with a gear discount slider
   and a per-item "gratis" switch (G5).

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

## 4. How "Zarobił" is estimated until G5

Every quote already has a gear amount (`sprzetNetto` in `quote-calc.ts`: the package in quick mode,
cameras/lenses/light/… in detailed mode). For each won/done project:

```
charged  = sprzetNetto × (actual transfer / quote netto)   a discount on the whole job covers gear too
rentedIn = Profit tab "Rental sprzętu", if ticked as a cost
ownGear  = max(0, charged − rentedIn)
```

`ownGear` is spread over the items logged on that project in proportion to their Odpracował value
(by unit-days when no item has a rate). It is an estimate: show it as "szac." until G5 prices gear
item by item. Money from projects with no gear logged is reported as **unassigned**, and projects
without a quote (2026 retro imports) count as **unknown**; both feed the retrofit checklist.

Neither number is company revenue: the gear payment is already inside the project's revenue in
Finance. They only answer "did this purchase pay off".

## 5. Tracks

| Track | What | Who / status |
|---|---|---|
| **G1 Data + logic** | §3, §4 | ✅ this session |
| **G2 Import my gear list** | M.J. sends the list (any format). Claude turns it into `equipment.json` records, flags missing rental rates (can propose rates from Polish rental price lists to confirm), and hands over a patch for `npm run data -- apply` (backs up first). **Install a hub build that includes G1 before importing**, or an older build will rewrite new categories as "inne" and drop `quantity`. | waiting for the list |
| **G3 Project Sprzęt tab** | Days side by side (prefilled per §3), searchable catalogue grouped by category, click to add to the selected day or all days, quantity, copy day, Odpracował per day and total, Zarobił for the project, packing list per day or whole project (print). Retired items hidden. Body stays in `components/equipment/project-equipment.tsx` (T3 mounts it). | next, this session |
| **G4 Sprzęt screen** | Item list with both numbers and two-tone payoff bar, sort by Odpracował / Zarobił / most used / unused, click an item for details and editing (purchase date, quantity, retire) and its project history; totals incl. unassigned; "2026 projects without gear" checklist with links. | next, this session |
| **G5 Gear in the quote** | Produkcja detailed mode: replace guessed gear options per day with the G3 picker; price = rental rate × days; gear discount slider per quote + "gratis" per item; rate and discount frozen in the snapshot; old quotes calculate exactly as before; PDF optionally shows "wartość X, rabat Y". Then Zarobił stops being an estimate. "Take from quote" button in the Sprzęt tab. | separate session, after G3/G4 and the real catalogue |
| **G6 Kits** | Saved gear sets ("Wywiad", "Event") applied to a day in one click; quick-mode packages become kits. | with G5 |
| **G7 Retrofit 2026** | M.J. logs gear per project from the G4 checklist (route A: Sprzęt tab only, numbers untouched) or rebuilds the quote (route B, after G5; the existing replace-financials confirmation in `lib/project-save.ts` covers it). Adding shoot days in the calendar first lets the Sprzęt tab prefill dates. | M.J. |

## 6. Coordination

- Built on `v3/project-hub` at the T3 spec commit, on its own branch; merged into v3 after T3 lands.
- Files outside the gear area touched by G1: `lib/quote-financials.ts` (extracted `resolveSnapshot`,
  behaviour unchanged) and two lines in `components/calendar/event-form.tsx` (category is a string).
- **T3: please keep `components/equipment/project-equipment.tsx` and its `ProjectEquipment` export**;
  G3 rewrites its body.
- T5 (Realizacja) absorbs the Sprzęt tab as is; nothing in G changes that plan.

## 7. Ideas, not planned

- Resale value: selling a camera returns money; a `salePrice` next to `retiredAt` would count it
  toward payoff.
- Manual "client paid for gear on this project" for retro projects that won't get a rebuilt quote.
