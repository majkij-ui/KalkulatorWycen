'use client'

/**
 * Stan kosztów stałych dla sekcji Finanse (i odczytów z panelu w Marketingu).
 *
 * Zwykły hook zamiast kolejnego kontekstu: koszty stałe czyta i edytuje tylko
 * dashboard finansowy i zakładka Marketing. `costs` to pozycje nieusunięte;
 * usuwanie jest miękkie (`deletedAt`), a „Cofnij" przywraca po znaczniku.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addFixedCosts,
  createFixedCost,
  listFixedCosts,
  restoreFixedCosts,
  softDeleteFixedCosts,
  upsertFixedCost,
} from '@/lib/finances-store'
import { categoryFields, type CostCategory } from '@/lib/fixed-cost-categories'
import { isLiveFixedCost, type FixedCost } from '@/lib/project-types'

export interface AddFixedCostParams {
  month: string
  category: CostCategory
  amount: number
  label?: string
}

export function useFixedCosts() {
  const [all, setAll] = useState<FixedCost[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await listFixedCosts()
      if (cancelled) return
      setAll(loaded)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const costs = useMemo(() => all.filter(isLiveFixedCost), [all])

  const addCost = useCallback(async (params: AddFixedCostParams) => {
    const { type, category } = categoryFields(params.category)
    setAll(await upsertFixedCost(createFixedCost({ ...params, type, category })))
  }, [])

  /** Kilka gotowych pozycji jednym zapisem (poprawki rat). */
  const addCosts = useCallback(async (items: FixedCost[]) => {
    if (items.length) setAll(await addFixedCosts(items))
  }, [])

  const updateCost = useCallback(async (cost: FixedCost) => {
    setAll(await upsertFixedCost(cost))
  }, [])

  /** Miękko usuwa pozycje; zwraca znacznik do „Cofnij". */
  const removeCosts = useCallback(async (ids: string[]) => {
    const stamp = new Date().toISOString()
    setAll(await softDeleteFixedCosts(ids, stamp))
    return stamp
  }, [])

  const removeCost = useCallback((id: string) => removeCosts([id]), [removeCosts])

  const restoreCosts = useCallback(async (stamp: string) => {
    setAll(await restoreFixedCosts(stamp))
  }, [])

  return { costs, isLoading, addCost, addCosts, updateCost, removeCost, removeCosts, restoreCosts }
}

export type FixedCostsState = ReturnType<typeof useFixedCosts>
