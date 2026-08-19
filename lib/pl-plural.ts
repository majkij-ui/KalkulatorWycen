/**
 * Odmiana rzeczowników przez liczbę (polski ma trzy formy, nie dwie).
 *
 *   1            → forma pojedyncza      „1 pozycja"
 *   2–4          → forma mnoga           „3 pozycje"
 *   5+, 12–14…   → forma dopełniaczowa   „7 pozycji", „13 pozycji"
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  if (n === 1) return one
  const lastTwo = n % 100
  // 12–14 zachowują się jak 5+, mimo końcówki 2–4
  if (lastTwo >= 12 && lastTwo <= 14) return many
  const last = n % 10
  return last >= 2 && last <= 4 ? few : many
}

/** „1 dzień" / „3 dni" — dla dni zdjęciowych. */
export function dayLabel(count: number): string {
  return plural(count, 'dzień', 'dni', 'dni')
}

/** „1 pozycja" / „3 pozycje" / „7 pozycji". */
export function itemLabel(count: number): string {
  return plural(count, 'pozycja', 'pozycje', 'pozycji')
}
