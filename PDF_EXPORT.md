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
- Draft persistence key: `nonoise-pdf-draft` (localStorage)

### Draft hydration rules (why we changed them)

Historically the draft stored `issueDateIso` and `validUntilIso` and kept restoring them forever, which made the PDF date “stale”.

Fix (June 2026):
- `coerceLocalPdfDraft()` recomputes dates from `new Date()` on every hydration/restore, formatted per active language.

Reference: `HANDOFF.md` and `components/tabs/podglad-pdf.tsx` (`coerceLocalPdfDraft`).

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

## “Road we took” (what’s legacy)

### Legacy: react-pdf renderer (not used for current export)

There are legacy files using `@react-pdf/renderer`:
- `components/pdf/quote-pdf-document.tsx`
- `components/quote-pdf-document.tsx`

They are **not the active export path** anymore.
They also carry a known TS error (see `HANDOFF.md`) and are treated as legacy/unused.

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
- **Saved quote JSON doesn’t restore PDF draft**: ensure the PDF draft snapshot is preserved even when the PDF tab is unmounted (context holds last snapshot; pending snapshot applies on mount).

