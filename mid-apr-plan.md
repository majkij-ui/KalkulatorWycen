# Mid-April plan — QuoteGen

Short-term priorities and UX changes for the video quote calculator (Kalkulator Wyceny Wideo).

**Status:** Items 1, 2, 3, 4, 5, 6 are **done**. PDF texts editor and bug fixes queued below.

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

## 6. ✅ Header action bar rework

**Done.** Six-button action bar implemented:
- **Load quote** (FolderOpen) — file input → `loadQuoteSnapshot`
- **Save quote** (FileDown) — exports JSON with version/data/pricing/margin; Tauri `writeFile` to Downloads; web uses blob anchor; green success flash
- **Save defaults** (Save) — calls `saveAsDefaults()` with amber success flash
- **Reset** (RotateCcw) — calls `resetToZero()`
- **Hard reset** (Eraser) — 2-click confirmation (3s window); red glow; calls `hardReset()` which restores user-saved defaults or factory defaults
- **Settings** (Settings) — opens SettingsSheet

Separated into 3 groups with visual dividers. `migratePricingConfig()` helper extracts legacy tier pricing on load.

---

## 7. ✅ PDF texts editor (Edytuj treści PDF)

**Done.** New modal in Settings sheet allows user to customize all PDF-facing texts:

**Dane firmy (4 fields):**
- Document title (default: "WYCENA PRODUKCJI WIDEO")
- Company name (default: "Nonoise Media")
- Producer name (default: "Michał Jagniątkowski")
- Contact email (default: "contact@nonoise.media")

**Szablony uwag (5 textareas):**
- Term — niewyłączna licencja (Uwagi when copyright type = "licencja")
- Term — pełne przekazanie praw (Uwagi when copyright type = "przekazanie")
- Term — nadgodziny (Uwagi when overtime toggle on; supports `{hours}` and `{rate}` tokens)
- Term — poprawki montażowe (Uwagi when revisions toggle on; supports `{count}` and `{price}` tokens)
- Term — netto disclaimer (always appended to Uwagi; used to swap text when VAT mode toggled)

Stored in localStorage (`quote-gen-pdf-texts`). Token replacement via `renderTermOvertime()` and `renderTermRevisions()` helpers. Integrated into `getTermsAndConditions()` in quote-context.

---

## 🐛 Bug fixes & enhancements queue

### 1. Initial load — "[object object]" and NaN total

**Issue:** On first app load, line items show "[object object]" in orange text instead of actual default prices. Grand total shows NaN instead of 0.

**Root cause:** TBD — likely `pricingConfig` not initialized before first render, or missing fallback in price getters.

**Fix:** Ensure `pricingConfig` is hydrated from localStorage before any component mounts. Add safe guards in price calculation (return 0 if price is undefined). Test on fresh browser.

---

### 2. Hard reset — custom values don't revert

**Issue:** When user customizes prices and clicks hard reset, the amber-dot custom values remain instead of reverting to defaults.

**Root cause:** Likely `hardReset()` in quote-context is not properly restoring `pricingConfig` to `getUserDefault()` or factory defaults. Or `setPricingConfig` is not being called, or the state update is not being applied.

**Fix:** Trace hard reset flow: verify `hardReset()` calls `setPricingConfig(getUserDefault())` (or factory default if no user default). Verify state updates reach all subscribers. Test with custom prices → hard reset → verify prices revert + orange dots disappear.

---

### 3. Delta animation — low readability

**Issue:** Current delta badge (green/red floating text) above total is hard to read and easy to miss.

**Enhancement:** Replace the floating badge with a temporary takeover: delta value appears **in place of** the total amount, animated in with spinning digits effect (same as `AnimatedCurrency`), stays for 2s, then animates out to reveal the updated total. Use green for positive delta, red for negative.

**Implementation sketch:**
- Modify `sticky-header.tsx` — instead of `AnimatePresence` badge overlay, switch the `AnimatedCurrency` display to show delta + apply `delta > 0 ? 'text-emerald-400' : 'text-red-400'` while delta is active.
- Use same 2s timer. Ensure spinning digits animation is synchronized.

---

### 4. PDF text templates — expand to auto-generated descriptions

**Issue:** Current `termLicencja`, `termPrzekazanie`, etc. only cover header/footer terms. But PDF also contains auto-generated descriptions like:
- Production (ekipa): *"Tryb szybkiej wyceny: 0 dni × 1 os. Dopłata Reż-Op: Nie."* (from `getOpisInitial()` in `podglad-pdf.tsx`)
- Other phase descriptions (preprodukcja, sprzet, logistyka, postprodukcja, inne) also have templates

**Enhancement:** Extend `PdfTextsConfig` with templates for these auto-generated descriptions (one per phase):
- `opisPreprodukcja` — templates for "Dokumentacja: N dni. Scenariusz: X."
- `opisEkipa` — template for "Tryb szybkiej wyceny: N dni × M os..."
- `opisSprzet` — template for "Klasa sprzętu: X..."
- `opisLogistyka` — template for "Dojazd: N km..."
- `opisPostprodukcja` — template for "Montaż w trybie szybkiej wyceny: N dni/godz."
- `opisInne` — template for "Lektor: Tak/Nie..."

Each template should use `{tokens}` for dynamic values (dni, osoby, klasa, km, etc.) and be substituted in `getOpisInitial()`.

**Benefit:** Users can customize how the PDF describes each phase, not just the boilerplate terms.

---

### 5. PDF preview sync bug

**Issue:** When user clicks *"Pobierz nowe dane z kalkulatora"* on the draft prompt, the preview doesn't update visually (totals stay stale), but the exported PDF has correct values. Clicking on the preview text fixes the display glitch.

**Root cause:** Likely the preview state isn't being reset/recomputed when `handleRestoreFromCalculator()` fires, or the `useEffect` deps don't trigger a refresh.

**Fix:** Trace `handleRestoreFromCalculator()` in `podglad-pdf.tsx` — ensure it resets `localPdfState` by calling `buildInitialState()` and triggering a full re-render. Check `useEffect` dependencies and `touchedRowsRef` state. May need to force a recalculation or add a cache-bust key.

---

*Document status: Items 1, 2, 3, 4, 5, 6, 7 done. Bugs 1-5 and enhancement 4 queued for next session.*
