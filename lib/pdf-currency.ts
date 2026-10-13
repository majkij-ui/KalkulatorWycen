/**
 * PDF currency formatter.
 *
 * Since S3 the currency belongs to the quote (`QuoteData.currency`): in an EUR
 * quote the PDF rows are built in euros directly. Only a draft from before S3
 * (a PLN quote with an EUR PDF) still converts at its own rate. Either way the
 * stored `cenaNetto` values are already in the PDF currency, so this formatter
 * does NOT convert. It formats a number in the Polish style and appends the
 * currency label.
 *
 * Label convention (M.J. 2026-10-13): „zł" in Polish, „PLN" in English, „€"
 * in both. Polish-style numbers (space thousand separator) are kept in both
 * languages so the layout stays the same across PL/EN renders.
 */

export type PdfCurrency = 'PLN' | 'EUR'

export function pdfCurrencyUnit(currency: PdfCurrency, lang: 'pl' | 'en' = 'pl'): string {
  if (currency === 'EUR') return '€'
  return lang === 'en' ? 'PLN' : 'zł'
}

export function formatPdfAmount(amount: number, currency: PdfCurrency, lang: 'pl' | 'en' = 'pl'): string {
  const safe = Number.isFinite(amount) ? amount : 0
  // 'always' — pl-PL defaults to min2 grouping, which would print "7291 zł"
  // next to "31 700 zł" in the same totals block.
  const formatted = safe.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: 'always',
  })
  return `${formatted} ${pdfCurrencyUnit(currency, lang)}`
}
