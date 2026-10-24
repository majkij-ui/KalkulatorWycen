'use client'

/**
 * Słownik wynajmowanego sprzętu dla ekranów (Realizacja, Sprzęt, Finanse).
 * Zwykły hook jak `useClientGroups`: przeładowanie, gdy okno wraca na pierwszy
 * plan. Każda zmiana to jeden zapis na świeżo odczytanym pliku
 * (`mutateRentalItems` + czysta funkcja z `rentals.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { addRentalItem, liveRentalItems, removeRentalItem, renameRentalItem, restoreRentalItem } from './rentals'
import { listAllRentalItems, mutateRentalItems } from './rental-items-store'
import type { RentalItem } from './rental-types'

export function useRentalItems() {
  const [allItems, setAllItems] = useState<RentalItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setAllItems(await listAllRentalItems())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  const items = useMemo(() => liveRentalItems(allItems), [allItems])
  const now = () => new Date().toISOString()

  /** Nowa pozycja „na miejscu" (albo istniejąca o tej samej nazwie). */
  const addItem = useCallback(async (name: string) => {
    let created: RentalItem | null = null
    setAllItems(
      await mutateRentalItems((all) => {
        const result = addRentalItem(all, name, now())
        created = result.item
        return result.items
      })
    )
    return created as RentalItem | null
  }, [])

  const renameItem = useCallback(async (id: string, name: string) => {
    setAllItems(await mutateRentalItems((all) => renameRentalItem(all, id, name, now())))
  }, [])

  /** Zwraca znacznik — „Cofnij" go potrzebuje. */
  const removeItem = useCallback(async (id: string) => {
    const at = now()
    setAllItems(await mutateRentalItems((all) => removeRentalItem(all, id, at)))
    return at
  }, [])

  const restoreItem = useCallback(async (id: string, at: string) => {
    setAllItems(await mutateRentalItems((all) => restoreRentalItem(all, id, at)))
  }, [])

  return { items, allItems, isLoading, addItem, renameItem, removeItem, restoreItem }
}
