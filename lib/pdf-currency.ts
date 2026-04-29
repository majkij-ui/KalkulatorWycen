/**
 * PDF-only currency formatter.
 *
 * The rest of the app (calculator UI, breakdowns, sticky header) keeps using
 * `formatCurrency` from `lib/quote-calc.ts` — Polish locale, " zł" suffix.
 *
 * This helper is for the PDF flow, where the user can toggle between PLN and
 * EUR for the printed document only. After a one-shot conversion (done at the
 * moment the user flips the currency toggle in the PDF preview), the stored
 * `cenaNetto` values are already in the active currency — so this formatter
 * does NOT convert. It simply formats a number in the Polish style and appends
 * the right currency suffix.
 *
 * Polish-style formatting (space thousand separator, comma decimal) is kept in
 * both currencies so visual layout is consistent across PL/EN renders — only
 * the trailing currency symbol changes.
 */

export type PdfCurrency = 'PLN' | 'EUR'

export function formatPdfAmount(amount: number, currency: PdfCurrency): string {
  const safe = Number.isFinite(amount) ? amount : 0
  const formatted = safe.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return currency === 'EUR' ? `${formatted} €` : `${formatted} zł`
}
