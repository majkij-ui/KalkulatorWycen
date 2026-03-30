# PDF Generation Plan: React-to-Print Edition

## 1. Technical Stack
- **Library:** `react-to-print` (Uses browser print engine to generate PDF from HTML/Tailwind).
- **Styling:** Tailwind CSS (Standard web-to-print classes).
- **Typography:** Inter (Google Fonts) for full Polish character support.

## 2. The "Live Editor" UI (Podgląd i PDF Tab)
- **Top Bar:** - Switch: "Pokaż VAT (23%)"
  - Button: "Pobierz PDF" (Triggers `useReactToPrint`).
- **Editable Preview:** A high-fidelity "Live Sheet" that looks like the final document.
- **Overrides:** - Clicking on a price or description allows manual typing.
  - State is managed locally in the tab (`localPdfState`) but initialized from `QuoteContext`.

## 3. Document Structure (The Hidden Print Page)
- **A4 Format:** Forced via CSS `@media print { @page { size: A4; margin: 20mm; } }`.
- **Header:** - Left: `logo.png` (scaled to max-h-16) + Nonoise Media contact info.
  - Right: Client/Project metadata (Editable: Klient, Projekt, Data, Termin).
- **The Core Table (3 Columns):**
  - Col 1: Kategoria (Preprodukcja, Ekipa, Sprzęt, Logistyka, Postprodukcja, Inne).
  - Col 2: Szacunkowo (Price in PLN).
  - Col 3: Opis (Multi-line text detailing what is included).
- **Summary Section:** - "Całkowity koszt netto" (Sum of Col 2).
  - "Materiały końcowe" box.
- **Dynamic Sections:**
  - "Opcje dodatkowe" (Textarea input).
  - "Uwagi" (List generated from 'Dodatkowe' tab).
  - "Portfolio" (List of links).

## 4. Implementation Steps
1. Create `components/tabs/podglad-pdf.tsx` with the Live Editor.
2. Create `components/pdf/printable-quote.tsx` (The hidden Tailwind-styled sheet).
3. Hook up `react-to-print` to bridge the two.