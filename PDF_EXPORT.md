# PDF export / printing — how it works (and why)

This project generates the PDF from **HTML (Tailwind)**, not from a “native PDF layout engine”.
There are **two runtime paths**:

- **Web (browser)**: `react-to-print` → user saves as PDF via the browser print dialog.
- **Desktop (Tauri / macOS WKWebView)**: `html2canvas-pro` → `jsPDF` → Tauri filesystem write (`@tauri-apps/plugin-fs`) after a native “Save as…” dialog (`@tauri-apps/plugin-dialog`).

The “desktop” path exists because WKWebView has constraints that make the pure browser download/print approach unreliable.

---

## The current “single source of truth”: HTML print sheet

We render a hidden, A4-sized HTML document using Tailwind classes:

- **Component**: `components/pdf/printable-quote.tsx` (`PrintableQuote`)
- It receives a snapshot-like state: `LocalPdfState` (`lib/quote-types.ts`)
- Page-break candidates are marked with `data-pdf-break="after"` on safe boundaries (table rows / cards / sections).

This HTML is what both export paths capture/print.

---

## Where the PDF UI lives

The user edits the PDF preview in:

- **Tab**: `components/tabs/podglad-pdf.tsx` (`PodgladPdfTab`)
- Local draft state is `localPdfState` (type `LocalPdfState`)
- Draft persistence (since Q1, October 2026): the draft is part of the project's quote document — `Project.quote.pdfDraft`
  (`LocalPdfState` plus the hand-typed „Uwagi” as `uwagiManualText`). Each project has its own draft; it survives tab
  switches, other projects and a restart. There is no global `nonoise-pdf-draft` key any more (an old one is ignored).
  - A quote without a draft: the PDF is built from the calculator and follows it; nothing is stored until the first
    hand edit in the PDF tab.
  - Hand edits save like any quote change (`setPdfDraft`, `lib/quote-documents.ts`). Automatic fixes of an existing
    draft (dates, currency reconcile, `followsQuote`) are kept in memory and saved with the next real change, so just
    looking at the PDF writes nothing.
  - „Wyczyść edytor” sets the draft back to none (the PDF follows the calculator again).

### Draft hydration rules (why we changed them)

Historically the draft stored `issueDateIso` and `validUntilIso` and kept restoring them forever, which made the PDF date “stale”.

Fix (June 2026):
- `coerceLocalPdfDraft()` recomputes dates from `new Date()` on every hydration/restore, formatted per active language.

Reference: `HANDOFF.md` and `lib/pdf-draft.ts` (`coerceLocalPdfDraft`).

---

## Export path A — Web (browser): react-to-print

Used when **not** running in Tauri.

Location:
- `components/tabs/podglad-pdf.tsx` → `handlePrint` via `useReactToPrint`

How it works:
- The hidden HTML sheet (`PrintableQuote`) is placed in the DOM (off-screen).
- `react-to-print` calls `window.print()` for that subtree.
- The user chooses “Save as PDF” in the browser dialog.

Important details:
- We override document title during printing (`onBeforePrint` / `onAfterPrint`) so the PDF file name suggestion is nice.
- Print CSS is injected via `pageStyle`:
  - `@page { size: A4; margin: ... }`
  - visibility rules to print only `#printable-quote`

Pros:
- Simple, high fidelity (because it’s the browser print engine).
- No canvas slicing, no image compression concerns.

Cons:
- User flow depends on browser print UI.
- Desktop app (WKWebView) doesn’t reliably support the same flow.

---

## Export path B — Desktop (Tauri): html2canvas-pro → jsPDF → writeFile

Used when running inside Tauri (macOS WKWebView).

Location:
- `components/tabs/podglad-pdf.tsx` → `handleTauriExport`

Steps:
1. Make the hidden print element visible off-screen temporarily so layout is stable.
2. `html2canvas-pro` renders the element into a high-resolution canvas (`scale: 2`).
3. We compute “safe break” Y-coordinates from elements marked `data-pdf-break="after"`.
4. We slice the big canvas into page-sized canvases.
5. Each slice is added into `jsPDF` as an image (JPEG, quality ~0.95).
6. We show a native save dialog (`@tauri-apps/plugin-dialog`) to choose path/name.
7. We write the bytes to disk via `@tauri-apps/plugin-fs` (`writeFile`).

### Why `html2canvas-pro` (not vanilla html2canvas)

Tailwind v4 emits **CSS Color 4 / OKLCH** color functions widely.
WKWebView’s `getComputedStyle()` returns colors in original color space; vanilla html2canvas historically struggles with these.

`html2canvas-pro` is used because it supports Color 4 (`oklch`, `lab`, etc.) reliably on WKWebView.

### Why Tauri writeFile (not jsPDF download)

WKWebView blocks jsPDF’s default `<a download>` mechanism and can throw `NSURLErrorCancelled (-999)`.
So we export bytes and save via native filesystem APIs.

### Blank trailing page (historical bug)

Symptom:
- A trailing blank page appeared at the end of every exported PDF.

Cause:
- The pager loop used `canvas.height`, which included the printable container’s bottom padding (`pb-8`).
  That whitespace was tall enough to become its own PDF page.

Fix (June 2026):
- Stop at `contentHeight = bottom of last data-pdf-break section`, not `canvas.height`.

Reference: `HANDOFF.md` + `handleTauriExport` (`contentHeight` logic).

---

## Currency on the PDF (S3, October 2026)

The currency belongs to the **quote** (`QuoteData.currency`, frozen `exchangeRate`), not to the PDF. Rules live in
`lib/quote-currency.ts`; the draft logic is pure in `lib/pdf-draft.ts` (tested, incl. golden tests for old quotes).

- The PDF rows are built from the calculator **in the quote's currency** (`buildInitialPdfState` gets the client view of
  the quote). There is no second conversion, so flipping currency no longer rounds twice.
- `LocalPdfState.currency` follows the quote; drafts built since S3 carry `followsQuote: true`.
- **Pre-S3 drafts** (`followsQuote` missing, `currency: 'EUR'`, quote in PLN) are the old "EUR only on the PDF" mode: they
  still convert PLN → EUR at the draft's own rate and print exactly as before. The PDF tab shows a banner to switch the
  whole quote to EUR at that rate or to go back to PLN on the PDF (the old one-shot flip, `flipPdfCurrency`).
- When the quote's currency changes (also while the PDF tab is closed), `reconcilePdfCurrency` takes row prices from the
  calculator in the new currency, converts hand-edited prices at the rate, and keeps hand-edited descriptions.
- Amounts inside texts follow the PDF currency: the actor-fee line, the gear value sentence, and the overtime / revision
  prices in the terms (`buildTermsAndConditions(..., money)`; a template's own `zł` / `PLN` after `{rate}` / `{price}` is
  replaced by the right label).
- Label convention: `zł` in Polish, `PLN` in English, `€` in both (`formatPdfAmount(amount, currency, lang)`).
- Totals: net leads (Ember, black weight); VAT and gross are a quiet secondary line, in the PDF and the in-app preview.

---

## Call sheet PDF (T5b)

The call sheet (`components/planner/printable-call-sheet.tsx`) uses **path B in both runtimes**:
`lib/print-call-sheet.ts` renders the hidden A4 sheet with `html2canvas-pro`, cuts pages with the same "last
`data-pdf-break` that fits" rule (pure, tested: `planPdfPages` in `lib/pdf-pages.ts`), adds `tel:` / `mailto:` link
annotations for elements marked `data-pdf-href`, then saves through the native dialog + `writeFile` in Tauri or a plain
download in the browser. No `window.print()` anywhere, no new Tauri permission.

---

## “Road we took” (what’s legacy)

### Legacy: react-pdf renderer (not used for current export)

There is a legacy file using `@react-pdf/renderer`: `components/quote-pdf-document.tsx`.
It is **not the active export path** anymore and is unused. (`components/pdf/quote-pdf-document.tsx`, which carried the
known TS error, was deleted in Q1; `next build` type-checks again.)

### Plan document: react-to-print first

`PDFgen-plan.md` documents the earlier “React-to-Print Edition” approach, which is still true for the web path.
The Tauri canvas path was added later to work around WKWebView limitations (download/print + OKLCH).

---

## When debugging PDF issues: checklist

- **Is it web or Tauri?** The code path is different.
- **Layout drift / missing styles**: check Tailwind classes on `PrintableQuote`; for Tauri ensure `html2canvas-pro` capture is happening after layout (we wait one animation frame).
- **Page breaks**: verify `data-pdf-break="after"` markers exist on intended boundaries in `PrintableQuote`.
- **Blank last page (Tauri only)**: verify `contentHeight` uses the last break point, not full canvas height.
- **Stale dates**: check `coerceLocalPdfDraft()` recomputes `issueDateIso` / `validUntilIso`.
- **Wrong currency / „zł" in an EUR PDF**: check `QuoteData.currency` + `exchangeRate` of the quote and the draft's
  `followsQuote` (missing = pre-S3 EUR-on-PDF mode, see "Currency on the PDF").
- **PDF draft of the wrong project / lost draft**: the draft lives in the project's quote document (`Project.quote.pdfDraft`);
  the PDF tab reads it on mount and remounts when the document is replaced (`docEpoch`: JSON import, change from outside).

