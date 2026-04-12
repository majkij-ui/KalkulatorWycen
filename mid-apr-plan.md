# Mid-April plan — QuoteGen

Short-term priorities and UX changes for the video quote calculator (Kalkulator Wyceny Wideo).

Items 1, 3, 4, 5 are **done**. Item 2 is the active focus.

---

## 1. ✅ Bug fix — szczegółowa wycena (Postprodukcja)

**Done.** New deliverables now use the first available format; display price matches total calculation.

---

## 2. UI overhaul — inline price editing

**Problem:** Prices for every line item are buried in the Cennik settings modal. Users need to dive into it just to check or tweak a price while composing a specific quote. The goal is to make the calculator fully customizable with prices accessible on the spot.

### Design decisions (from interview)

**Scope:** Every line item across all tabs — Preprodukcja, Produkcja (crude & detailed), Postprodukcja (crude & detailed), Dodatkowe. Every item that has a backing price in Cennik should expose that price inline.

**What the box shows:** Always the **unit price** (not the line total). If a format costs 3 000 zł and qty = 2, the box shows `3 000`. Changing it to `2 500` makes the line `5 000 zł`.

**Override scope:** Changing an inline price updates the format/item price **globally** (same as editing it in Cennik). This keeps a single source of truth. If the user wants two similar items at different prices, they create two separate formats or line items.

**Interaction pattern:** Click-to-edit. Shows the value as styled text at rest; clicking turns it into a focused `<input>`. Commits on **Enter** or **blur**. Escape cancels.

**Persistence:** The edited value persists for the life of that item in the quote (i.e. it IS the global Cennik value now — it was changed). Removing and re-adding a line item falls back to whatever the current Cennik value is at that moment.

**Cog / Settings modal role:** Kept as-is — it is now explicitly the "Default values / Cennik" editor. Add a short subtitle: *"These are the default values the calculator falls back to when you reset."*

**Future addition to Settings modal (mark for later):** Add a section for editing all placeholder texts that appear in the PDF (client name placeholder, company details, notes/footers, etc.).

### Implementation sketch

- Create a small reusable `<InlinePrice value={n} onChange={fn} />` component — renders as `{n} zł` text, on click becomes a controlled `<input type="number">`, commits on blur/Enter, cancels on Escape, styled to match the glass dark theme.
- Wire it into every tab:
  - **Preprodukcja** — "Dzień dokumentacji" unit price; Scenariusz option prices (podstawowy / rozbudowany); Wizja lokalna price; Kierownik produkcji price.
  - **Produkcja crude** — operator day rate; ReżOp surcharge rate; drone surcharge rate; equipment package prices (minimalistyczny / standard / kinowy).
  - **Produkcja detailed** — per-role crew rates (ReżOp, asystent, gafer, dźwiękowiec, MUA, aktor, model, statysta) shown in each DayCard row; per-equipment-type rates.
  - **Postprodukcja crude** — editing day rate (montaż/dzień or montaż/godz).
  - **Postprodukcja detailed** — format unit price on each DeliverableCard (currently shown read-only as `displayPrice`). Secondary option prices: korekcja barwna, animacje, muzyka, sound design, master dźwięku, lektor.
  - **Dodatkowe** — cost per km; rights-transfer surcharge %.
- Each `onChange` calls `setPricingConfig` (or the equivalent context updater) to write the new value into the live Cennik — no separate per-item override layer needed.
- Visual indicator: when a price differs from `DEFAULT_PRICING`, show a small dot or subtle amber tint on the field so the user knows it's been customised.

**Outcome:** Users see and edit prices directly on each card/row without ever opening the settings modal for day-to-day quoting.

---

## 3. ✅ Animation — "delta over total" feedback

**Done.** Framer Motion floating badge (+/- amount, green/red) appears above the grand total for 2 seconds on every change.

---

## 4. ✅ Remove three pricing tiers

**Done.** Single flat rate table. Migration from old tani/standard/agresywny localStorage format handled transparently.

---

## 5. ✅ Minor — km slider cap (Dodatkowe)

**Done.** Raised from 500 to 1 000 km.

---

## 6. Header action bar rework (future / mark for later)

**Problem:** The current header has a reset icon and a cog icon. The reset is ambiguous (what does it reset exactly?) and there are missing actions users would need.

**New button layout (right side of header):**

| Button | Action |
|---|---|
| **Reset** | Zeroes all quantities / selections in the current quote. Prices (Cennik) untouched. |
| **Hard reset** | Zeroes everything AND restores all prices to DEFAULT_PRICING defaults. |
| **Save defaults** | Saves the current Cennik values as the new persistent defaults (writes to `settings.json` / localStorage). |
| **Save quote** | Exports the full current quote state to a `.json` file the user can reload later. |
| **Load quote** | Opens a file picker to load a previously saved quote `.json`. |
| **Cog (⚙)** | Opens the existing Settings / Cennik modal (default values editor). |

Implementation notes:
- "Reset" = `resetToZero()` (already exists, keep it).
- "Hard reset" = `resetToZero()` + `resetPricingToDefault()` (both already exist, just combine).
- "Save defaults" = persist current `pricingConfig` as the baseline (overwrite `DEFAULT_PRICING` stored copy in localStorage / `settings.json`).
- "Save quote" / "Load quote" = serialize / deserialize full `QuoteData` + `pricingConfig` snapshot. Tauri: use `fs.writeFile` / `fs.readFile`. Web: use download anchor / file input.

---

## Suggested order going forward

1. **Item 2 — Inline price editing** (the active task).
2. **Item 6 — Header action bar** (once inline editing is stable, the reset semantics become more important).
3. **Settings modal PDF placeholder texts** (minor polish, can be parallelised).

---

*Document status: Items 1, 3, 4, 5 done. Item 2 in design/implementation. Items 6+ queued.*
