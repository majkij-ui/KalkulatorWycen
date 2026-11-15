/**
 * Filtr okresu na ekranie „Sprzęt" (15.11.2026) — czyste pomocnicze funkcje.
 *
 * Sprzęt wpada w okres wg DATY DNIA NA PLANIE, nigdy wg faktury. Zakup i
 * sprzedaż — wg `purchaseDate` / `soldDate`. `null` = „Całość".
 */

import { isInPeriod, periodMonths, type Period } from './finance-calc'
import { isOnSet } from './gear-backstage'
import { unitsOwned, type EquipmentItem } from './project-types'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Pierwszy i ostatni dzień okresu jako `YYYY-MM-DD` (koniec to „31", wystarcza do porównań tekstowych). */
export function periodBounds(period: Period): { start: string; end: string } {
  const months = periodMonths(period)
  return { start: `${months[0]}-01`, end: `${months[months.length - 1]}-31` }
}

const alive = (items: EquipmentItem[]) => items.filter((item) => !(item as { deletedAt?: unknown }).deletedAt)

export const boughtInPeriod = (item: Pick<EquipmentItem, 'purchaseDate'>, period: Period) =>
  DATE_KEY.test(item.purchaseDate) && isInPeriod(item.purchaseDate, period)

export const soldInPeriod = (item: Pick<EquipmentItem, 'soldDate'>, period: Period) =>
  !!item.soldDate && isInPeriod(item.soldDate, period)

/**
 * Pozycja należała do mnie w okresie: kupiona najpóźniej w ostatnim dniu okresu
 * (albo bez daty zakupu) i nie sprzedana ani nie wycofana przed jego początkiem.
 */
export function ownedInPeriod(
  item: Pick<EquipmentItem, 'purchaseDate' | 'soldDate' | 'retiredAt'>,
  period: Period
): boolean {
  const { start, end } = periodBounds(period)
  if (DATE_KEY.test(item.purchaseDate) && item.purchaseDate > end) return false
  if (item.soldDate && item.soldDate < start) return false
  if (item.retiredAt && item.retiredAt < start) return false
  return true
}

export interface PeriodInvested {
  onSet: number
  backstage: number
  total: number
  onSetCount: number
  backstageCount: number
}

/** Kafelek „Zainwestowane" w okresie: zakupy z `purchaseDate` w okresie (cena × sztuki), plan i zaplecze osobno. */
export function investedInPeriod(items: EquipmentItem[], period: Period): PeriodInvested {
  const out: PeriodInvested = { onSet: 0, backstage: 0, total: 0, onSetCount: 0, backstageCount: 0 }
  alive(items).forEach((item) => {
    if (!boughtInPeriod(item, period)) return
    const amount = item.purchasePrice * unitsOwned(item)
    if (isOnSet(item)) {
      out.onSet += amount
      out.onSetCount += 1
    } else {
      out.backstage += amount
      out.backstageCount += 1
    }
  })
  out.total = out.onSet + out.backstage
  return out
}
