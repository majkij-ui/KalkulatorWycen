# Mid-April plan — QuoteGen

Short-term priorities and UX changes for the video quote calculator (Kalkulator Wyceny Wideo).

**Status:** Items 1, 2, 3, 4, 5, 6 are **done**. PDF texts editor shipped; bug fixes and animation polish queued below.

---

## ⚠️ Important follow-ups (priority)

1. **PDF tab — „Pobierz nowe dane z kalkulatora”** — On that action, **sync only values** (amounts, line totals, breakdown numbers from the calculator). **Do not replace or reset** user-edited PDF text (Uwagi, opisy, placeholders, draft field copy). Treat it as a **numeric refresh**, not a full draft rebuild from template strings.

2. **Hard reset** — **Still broken** in practice (custom / inline prices and related state not reliably reverting to saved or factory defaults). Needs another pass end-to-end; treat as **high priority** until verified with: custom prices → hard reset → orange dots gone + Cennik matches user default or factory default.

3. **Total amount animations** — Restore the **previous Casio-style rolling digit** treatment for **all** grand-total (and related total) displays. Current behaviour regressed to a **simple fade**; the old **per-digit counter / odometer** animation should drive **every** total-amount motion (including delta / temporary takeover flows once implemented). Audit `AnimatedCurrency` (and any replacements) in `sticky-header` and elsewhere.

4. **Save quote — broken; move to real save UI** — The current **save quote** flow does not work reliably. Move toward a **native / system save experience** (e.g. Tauri **`dialog::save`** or browser **Save As** with user-chosen path and filename). **Never silently overwrite** an existing file: if the chosen path already exists, show a **confirm replace** dialog (or force “Save as…” with a new name). Same pattern on web: download should not blindly reuse a fixed name without user intent where the platform allows it.

5. **Export PDF — same pattern as save** — PDF export today can **auto-overwrite** or feel opaque (fixed path / no confirmation). Add a **save / export dialog** so the user picks **location + filename**, with **overwrite protection** (confirm if file exists). Align desktop (Tauri) and web behaviour as far as each platform allows.

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

### 2. Hard reset — custom values don't revert (**STILL NOT FIXED**)

**Issue:** When user customizes prices and clicks hard reset, the amber-dot custom values **still** remain instead of reverting to defaults. Reported again after header / defaults work — treat as open until manually verified.

**Root cause:** Likely `hardReset()` in quote-context is not properly restoring `pricingConfig` to `getUserDefault()` or factory defaults. Or `setPricingConfig` is not being called, or the state update is not being applied. Possible race with persistence (Tauri / localStorage) re-applying old config after reset.

**Fix:** Trace hard reset flow: verify `hardReset()` calls `setPricingConfig(getUserDefault())` (or factory default if no user default). Verify state updates reach all subscribers. Confirm persist layer does not immediately overwrite with stale snapshot. Test with custom prices → hard reset → verify prices revert + orange dots disappear.

---

### 3. Total & delta animations — Casio-style digits everywhere

**Issue:** We used to have **rolling / odometer-style digit animations** (Casio machine feel) on totals; behaviour has regressed to a **plain fade**. Delta badge (if present) is also easy to miss.

**Product ask:** Restore the **previous per-digit counter animation** for **all** total-amount UI (main grand total and any variant that shows the same number). Deltas should use the same digit treatment, not only opacity fades.

**Enhancement (delta):** Optional temporary takeover: delta value appears **in place of** the total, with **rolling digits**, stays ~2s, then rolls to the new total. Green for positive delta, red for negative.

**Implementation sketch:**
- Audit `AnimatedCurrency` / Framer usage in `sticky-header.tsx` — ensure digit columns animate on value change like the old implementation; remove fade-only shortcuts.
- Align delta display with the same component or shared digit strip so **one** animation language for totals + deltas.
- Use same timer / colour rules as current delta badge if keeping a two-phase UX.

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

### 5. PDF preview sync + „Pobierz nowe dane” semantics

**Issue A (display):** When user clicks *"Pobierz nowe dane z kalkulatora"* on the draft prompt, the preview sometimes doesn't update visually (totals stay stale), but the exported PDF has correct values. Clicking on the preview text fixes the display glitch.

**Issue B (behaviour — critical):** That same action must **change only values** (numbers, line amounts, totals derived from the calculator). It must **not** overwrite user-edited **text** in the PDF draft (custom Uwagi, opisy, company fields, any typed copy). If the implementation currently rebuilds the whole draft from templates, split **numeric sync** from **text preservation**.

**Root cause:** Likely the preview state isn't being reset/recomputed when `handleRestoreFromCalculator()` fires, or `buildInitialState()` replaces more than numeric fields. Check `useEffect` deps and `touchedRowsRef`.

**Fix:** Trace `handleRestoreFromCalculator()` in `podglad-pdf.tsx` — merge calculator numbers into `localPdfState` without clobbering text keys; or re-run only the value pipeline. For the stale UI bug, ensure a full re-render / dependency fix or cache-bust key.

---

*Document status: Items 1–7 done. Queue: bugs 1–5 + PDF template expansion (§4). Priority follow-ups: § „Important follow-ups” (PDF values-only sync, hard reset, Casio-style totals, save/PDF dialogs & overwrite safety).*
