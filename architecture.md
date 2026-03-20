# Technical Architecture

## State Management
- **Provider:** `QuoteProvider` in `lib/quote-context.tsx`.
- **Hardening:** Uses `lib/safe-numbers.ts` (`safeNum`, `safeArray`) to prevent NaN crashes and ensure data integrity during calculations.
- **Persistence:** State is synced to `localStorage` ('nonoise-quote-state').
- **Templates:** Dynamic template system allows saving/loading `Partial<QuoteState>` with deep merging to prevent breaking on schema updates.

## Calculation Engine
- **Logic:** Located in `lib/quote-calc.ts`.
- **Phases:** Preprodukcja, Produkcja, Postprodukcja, Dodatkowe.
- **Formula (Produkcja Crude):** `Days * ((Crew * Rate) + Gear + ReżOp + Drone)`.
- **Logistics Engine:** Automatically calculates "Osobodni" (Man-days) by summing crew/cast arrays in Detailed mode, with manual override toggles.

## Custom Components
- `BipolarSlider`: Fills from center (1.0) outwards (Red < 1.0 < Orange).
- `FormatManager`: Custom popup in Postprodukcja to manage `pricingConfig` keys prefixed with "Format: ".
