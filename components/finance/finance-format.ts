/**
 * Zapis kwot i miesięcy w zakładce „Koszty stałe i subskrypcje".
 * Sumy jak w reszcie Finansów (pełne złote, `pln`); pojedyncze raty z groszami,
 * bo 10,30 zł opłaty bankowej to nie „10 zł".
 */

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

/** `2026-10` → „Październik 2026". */
export function monthName(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`
}

const MONTH_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

/** `2026-11` → „listopada 2026" (po „od", „do"). */
export function monthFrom(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${MONTH_GENITIVE[Number(m) - 1] ?? m} ${y}`
}

/** `2026-10` → „10.2026". */
export function monthShort(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${m}.${y}`
}

/** `2026-10-05` → „05.10.2026". */
export function dateShort(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return d ? `${d}.${m}.${y}` : dateKey
}

/** Kwota z groszami, gdy je ma: „1 417,14", „250", „0,99". */
export function exact(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  return rounded.toLocaleString('pl-PL', {
    useGrouping: 'always',
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** „1 417,14 zł", „20 USD". */
export function money(amount: number, currency = 'PLN'): string {
  return `${exact(amount)} ${currency === 'PLN' ? 'zł' : currency}`
}

/** Kurs: „4,0512". */
export function rateText(rate: number): string {
  return rate.toLocaleString('pl-PL', { maximumFractionDigits: 4 })
}

/** Tekst z pola kwoty do edycji: „1417,14". */
export function amountDraft(amount: number): string {
  return String(Math.round(amount * 100) / 100).replace('.', ',')
}
