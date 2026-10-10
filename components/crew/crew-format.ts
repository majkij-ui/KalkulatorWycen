/** Formatowanie kwot i dat w ekranie Ekipa (jak w sekcji Sprzęt). */

export function pln(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} zł`
}

/** `YYYY-MM-DD` (albo ISO) → `DD.MM.YYYY`; pusty → „—". */
export function formatDate(dateKey: string | null | undefined): string {
  if (!dateKey) return '—'
  const [y, m, d] = dateKey.slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : dateKey
}
