'use client'

/**
 * Stan kosztów stałych dla sekcji Finanse.
 *
 * Zwykły hook zamiast kolejnego kontekstu: koszty stałe czyta i edytuje tylko
 * dashboard finansowy — nikt inny w apce ich nie potrzebuje.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  createFixedCost,
  deleteFixedCost,
  listFixedCosts,
  monthRange,
  repeatMonthly,
  replaceAllFixedCosts,
  upsertFixedCost,
} from '@/lib/finances-store'
import type { FixedCost, FixedCostType } from '@/lib/project-types'

export interface AddFixedCostParams {
  month: string
  type: FixedCostType
  amount: number
  label?: string
  /** `YYYY-MM` — gdy podane, pozycja powiela się na każdy miesiąc do tego włącznie. */
  repeatUntil?: string
}

export function useFixedCosts() {
  const [costs, setCosts] = useState<FixedCost[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await listFixedCosts()
      if (cancelled) return
      setCosts(loaded)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const addCost = useCallback(async (params: AddFixedCostParams) => {
    const template = createFixedCost(params)
    const months = params.repeatUntil ? monthRange(template.month, params.repeatUntil) : []
    if (months.length > 1) {
      const current = await listFixedCosts()
      setCosts(await replaceAllFixedCosts([...current, ...repeatMonthly(template, months)]))
    } else {
      setCosts(await upsertFixedCost(template))
    }
  }, [])

  const updateCost = useCallback(async (cost: FixedCost) => {
    setCosts(await upsertFixedCost(cost))
  }, [])

  const removeCost = useCallback(async (id: string) => {
    setCosts(await deleteFixedCost(id))
  }, [])

  return { costs, isLoading, addCost, updateCost, removeCost }
}
