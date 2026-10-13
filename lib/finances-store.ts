'use client'

/**
 * Koszty stałe firmy — ZUS, marketing i dowolne „inne" pozycje per miesiąc.
 *
 * Celowo płaska lista rekordów zamiast mapy miesiąc→kwota: w jednym miesiącu
 * bywa kilka pozycji marketingowych, a „inne" z notatek ma być workiem na
 * koszty, których dziś nie przewidujemy. Od S1 pozycja może mieć kategorię
 * (`category`) i być poprawką raty subskrypcji (`subscriptionId`); raty same
 * nie są tu zapisywane (`subscriptions.ts`). Usuwanie jest miękkie.
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

/** Wszystkie pozycje, z usuniętymi (`deletedAt`) — liczby filtrują je same. */
export const listFixedCosts = store.list
export const upsertFixedCost = store.upsert
export const replaceAllFixedCosts = store.replaceAll
/** @deprecated twarde usunięcie — znika razem ze starym panelem (S1). */
export const deleteFixedCost = store.remove

/** Dopisuje kilka pozycji jednym zapisem (np. minione raty przy zmianie ceny). */
export function addFixedCosts(costs: FixedCost[]): Promise<FixedCost[]> {
  return store.mutate((all) => [...all, ...costs])
}

/**
 * Miękkie usunięcie: pozycje dostają ten sam `deletedAt`, więc „Cofnij"
 * przywraca dokładnie je (`restoreFixedCosts`). Nic nie znika z pliku.
 */
export function softDeleteFixedCosts(ids: string[], deletedAt: string): Promise<FixedCost[]> {
  const set = new Set(ids)
  return store.mutate((all) => all.map((c) => (set.has(c.id) ? { ...c, deletedAt } : c)))
}

export function restoreFixedCosts(deletedAt: string): Promise<FixedCost[]> {
  return store.mutate((all) =>
    all.map((c) => {
      if (c.deletedAt !== deletedAt) return c
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt: removed, ...rest } = c
      return rest
    })
  )
}

export function createFixedCost(params: {
  month: string
  type: FixedCostType
  amount: number
  label?: string
  category?: string
}): FixedCost {
  return {
    id: createFixedCostId(),
    month: toMonthKey(params.month) || params.month,
    type: params.type,
    label: params.label ?? '',
    amount: params.amount,
    source: 'manual',
    ...(params.category ? { category: params.category } : {}),
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
