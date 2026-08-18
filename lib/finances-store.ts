'use client'

/**
 * Koszty stałe firmy — ZUS, marketing i dowolne „inne" pozycje per miesiąc.
 *
 * Celowo płaska lista rekordów zamiast mapy miesiąc→kwota: w jednym miesiącu
 * bywa kilka pozycji marketingowych, a „inne" z notatek ma być workiem na
 * koszty, których dziś nie przewidujemy.
 */

import { createCollectionStore } from './v3-store'
import {
  createFixedCostId,
  fixedCostSchema,
  toMonthKey,
  type FixedCost,
  type FixedCostType,
} from './project-types'

export const FINANCES_FILE = 'finances.json'
export const WEB_FINANCES_KEY = 'nonoise-finances-v1'

/** Najnowszy miesiąc u góry. */
function byMonthDesc(a: FixedCost, b: FixedCost): number {
  const byMonth = (b.month ?? '').localeCompare(a.month ?? '')
  return byMonth !== 0 ? byMonth : a.type.localeCompare(b.type)
}

const store = createCollectionStore<FixedCost>({
  fileName: FINANCES_FILE,
  webKey: WEB_FINANCES_KEY,
  schema: fixedCostSchema,
  getId: (c) => c.id,
  sort: byMonthDesc,
})

export const listFixedCosts = store.list
export const upsertFixedCost = store.upsert
export const deleteFixedCost = store.remove
export const replaceAllFixedCosts = store.replaceAll

export function createFixedCost(params: {
  month: string
  type: FixedCostType
  amount: number
  label?: string
}): FixedCost {
  return {
    id: createFixedCostId(),
    month: toMonthKey(params.month) || params.month,
    type: params.type,
    label: params.label ?? '',
    amount: params.amount,
    source: 'manual',
  }
}

/**
 * Powiela pozycję na kolejne miesiące — ZUS jest co miesiąc taki sam, więc
 * wpisywanie go dwanaście razy ręcznie byłoby absurdem.
 */
export function repeatMonthly(template: FixedCost, months: string[]): FixedCost[] {
  return months
    .map((month) => toMonthKey(month) || month)
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .map((month) => ({ ...template, id: createFixedCostId(), month }))
}

/** Lista kluczy `YYYY-MM` od `from` do `to` włącznie. */
export function monthRange(from: string, to: string): string[] {
  const start = toMonthKey(from)
  const end = toMonthKey(to)
  if (!start || !end || start > end) return []
  const out: string[] = []
  let [year, month] = start.split('-').map(Number)
  const [endYear, endMonth] = end.split('-').map(Number)
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return out
}
