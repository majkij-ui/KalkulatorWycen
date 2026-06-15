# Project Progress & Roadmap

## Completed ✅
- [x] Global Pricing Engine (Cennik) with Export/Import JSON.
- [x] Dynamic Template System (Save/Load/Delete).
- [x] "Bipolar" Margin/Discount Slider in Header.
- [x] Logistics Module (Dojazd, Catering, Nocleg) with Osobodni logic.
- [x] Detailed Postproduction with dynamic Format Manager.
- [x] Code Hardening (NaN protection, array safety).
- [x] PDF Generation: wstępny generator PDF (rework v0.8) i pobieranie z „Podgląd”.
- [x] Logic for "Uwagi" (T&Cs) text generation based on toggles.
- [x] "Opcje Dodatkowe" (Upsell) text area in Dodatkowe tab.
- [x] **PDF Texts Editor:** modal in Settings sheet for editing company info (4 fields) + 5 Uwagi templates with `{tokens}` substitution. Persists to `localStorage` (`quote-gen-pdf-texts`).
- [x] **Tauri PDF Export:** `html2canvas-pro` (CSS Color 4 / oklch support on WKWebView) + `jsPDF` + Tauri `writeFile` to `$DOWNLOAD/`. Multi-page A4 paging. Web fallback uses `react-to-print`.
- [x] **PDF Layout:** 6-category summary, detailed breakdown, legal clauses, and branding.
- [x] **Portfolio Catalogue (Przykładowe realizacje):** app-level library of reusable video references managed under the cog (Settings → „Katalog realizacji", `components/portfolio-catalogue-modal.tsx`, persisted in `localStorage` `quote-gen-portfolio-catalogue`). In the PDF tab the portfolio section is now structured rows (`LocalPdfState.portfolioRows`): each row picks a link from the catalogue dropdown **or** accepts a manually typed URL, plus an optional description. Starts with 2 rows, „+ Dodaj realizację" adds more, trash removes. PDF prints visible URL + „— opis". Legacy `portfolioLinksText` drafts auto-migrate.

## PDF Internationalisation 🌍 (shipped Apr 2026)
- [x] **Language toggle (PL / EN)** on the PDF preview tab. Affects only the PDF preview block + exported PDF; the calculator UI, editor labels, and settings sheet stay in Polish.
- [x] **Currency toggle (PLN / EUR)** with **EUR-native editing**: switching the toggle performs a one-shot conversion of all stored row amounts using the current exchange rate, then edits and totals happen directly in the active currency (no live PLN↔EUR recalculation).
- [x] **NBP rate fetcher** — editable rate input + „Pobierz z NBP” button hitting `https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json` (table A, no auth, daily mid-rate). Loading + error states surfaced inline.
- [x] **PdfTextsConfig EN twins** — every user-editable field now has a `_en` sibling (`companyName_en`, `producerName_en`, `documentTitle_en`, `contactEmail_en`, plus all 5 term templates). Edited side-by-side in the modal with PL/EN pill labels. Migration-safe: `getPdfTextsConfig()` sanitises old saves (strips non-string values) and merges with `DEFAULT_PDF_TEXTS` so legacy configs upgrade cleanly.
- [x] **Localised static labels** — new `lib/pdf-i18n.ts` dictionary (`PDF_LABELS.pl` / `PDF_LABELS.en`) covers every non-user-editable string in the PDF: header (Wykonawca/Contractor, Producent/Producer, …), table columns (KATEGORIA / CATEGORY, …), totals row (SUMA BRUTTO / TOTAL GROSS), section titles (Materiały Końcowe / Final Deliverables, Uwagi / Notes), validity note, fallback dash, „Do ustalenia / TBD”, and the netto/VAT disclaimer swap text.
- [x] **Localised auto-generated `opis` text** — `getOpisInitial()` in `podglad-pdf.tsx` emits PL or EN templates per row, including all enums (Tak/Nie, scenario, equipment class min/std/cinematic, copyright transfer/licence, edit unit dni/godz.). Touched flags reset on language toggle so auto-text regenerates.
- [x] **Localised T&Cs** — `getTermsAndConditions(lang)` in `quote-context.tsx` is parameterised. Falls back EN→PL→empty per template if a saved config is missing the EN twin. Token substitution preserved (`{hours}`, `{rate}`, `{count}`, `{price}`).
- [x] **Localised row category titles** — both the in-page preview (`podglad-pdf.tsx`) and the printable doc (`printable-quote.tsx`) derive titles from `PdfRowKey + lang` at render time via `rowTitleForLang`, so toggling EN immediately renames Preprodukcja→Pre-production, Ekipa filmowa→Film crew, Sprzęt filmowy→Equipment, Logistyka→Logistics, Postprodukcja→Post-production, Inne koszty→Other costs (works in draft mode too).
- [x] **Date format aware** — `dd.MM.yyyy` in PL vs `dd/MM/yyyy` in EN.
- [x] **Currency formatter** — `lib/pdf-currency.ts::formatPdfAmount(amount, currency)` keeps Polish-style number formatting (space thousands, comma decimal) in both currencies; only the suffix swaps (` zł` ↔ ` €`).
- [x] **Persistence** — `LocalPdfState` extended with `pdfLanguage`, `currency`, `exchangeRate`. `coerceLocalPdfDraft()` provides safe defaults (`'pl'`, `'PLN'`, `4.30`).

### Hardening (post-ship fixes — Apr 2026)
- [x] Fixed `template.replace is undefined` crash that surfaced when toggling EN with an old `quote-gen-pdf-texts` payload missing the `_en` keys. Three layers of defence:
  - `getPdfTextsConfig()` sanitises non-string values from the parsed payload.
  - `renderTermOvertime` / `renderTermRevisions` fall back to defaults if passed a non-string.
  - `getTermsAndConditions(lang)` falls back EN→PL→empty per template and skips empty entries.

## Next Up 🎯

### Currently in scope
- See `mid-apr-plan.md` — PDF values-only sync („Pobierz nowe dane z kalkulatora”), hard reset bug, Casio-style total animations, save/PDF dialogs with overwrite protection.

### PDF i18n / currency — possible follow-ups
- [ ] Extend i18n to auto-generated `opis` text templates user-editable side (current static dictionary covers all phrasing, but users can't customise EN auto-opis — only the 5 Uwagi templates and 4 company fields are editable).
- [ ] Optionally re-convert existing row amounts when the exchange rate is edited *while* in EUR mode (today: edits to the rate after toggling do not re-apply; user must toggle PLN→EUR again).
- [ ] Consider currency-aware VAT rate (today: 23% Polish rate kept regardless of language, matching real-world invoicing where the document is still PL-issued).
