'use client'

/**
 * Subskrypcje dla sekcji Finanse. `subscriptions` to nieusunięte; usunięcie
 * jest miękkie, „Cofnij" zdejmuje znacznik. Raty liczy `lib/subscriptions.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listAllSubscriptions,
  restoreSubscription,
  softDeleteSubscription,
  upsertSubscription,
} from '@/lib/subscriptions-store'
import type { Subscription } from '@/lib/subscription-types'

export function useSubscriptions() {
  const [all, setAll] = useState<Subscription[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await listAllSubscriptions()
      if (cancelled) return
      setAll(loaded)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const subscriptions = useMemo(() => all.filter((s) => !s.deletedAt), [all])

  const save = useCallback(async (sub: Subscription) => {
    setAll(await upsertSubscription({ ...sub, updatedAt: new Date().toISOString() }))
  }, [])

  const remove = useCallback(async (id: string) => {
    setAll(await softDeleteSubscription(id, new Date().toISOString()))
  }, [])

  const restore = useCallback(async (id: string) => {
    setAll(await restoreSubscription(id))
  }, [])

  return { subscriptions, isLoading, save, remove, restore }
}

export type SubscriptionsState = ReturnType<typeof useSubscriptions>
