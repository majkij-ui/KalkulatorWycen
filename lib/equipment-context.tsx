'use client'

/**
 * Kontekst katalogu sprzętu.
 *
 * Osobny od `project-hub-context`, bo katalog jest niezależny od wyceny i od
 * otwartego projektu — to słownik firmy, nie dane pojedynczego zlecenia.
 * Użycie sprzętu W projekcie zapisujemy przez `updateActiveProject`.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  createEquipmentItem,
  deleteEquipment,
  listEquipment,
  upsertEquipment,
} from './equipment-catalog'
import type { EquipmentCategory, EquipmentItem } from './project-types'

interface EquipmentContextValue {
  items: EquipmentItem[]
  isLoading: boolean
  addItem: (params: {
    name: string
    category: EquipmentCategory
    purchasePrice?: number
    rentalDayRate?: number
  }) => Promise<EquipmentItem | null>
  updateItem: (item: EquipmentItem) => Promise<void>
  removeItem: (id: string) => Promise<void>
}

const EquipmentContext = createContext<EquipmentContextValue | null>(null)

export function EquipmentProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<EquipmentItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await listEquipment()
      if (cancelled) return
      setItems(loaded)
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const addItem = useCallback<EquipmentContextValue['addItem']>(async (params) => {
    const name = params.name.trim()
    if (!name) return null
    const item = createEquipmentItem({ ...params, name })
    setItems(await upsertEquipment(item))
    return item
  }, [])

  const updateItem = useCallback(async (item: EquipmentItem) => {
    setItems(await upsertEquipment(item))
  }, [])

  const removeItem = useCallback(async (id: string) => {
    setItems(await deleteEquipment(id))
  }, [])

  return (
    <EquipmentContext.Provider value={{ items, isLoading, addItem, updateItem, removeItem }}>
      {children}
    </EquipmentContext.Provider>
  )
}

export function useEquipment(): EquipmentContextValue {
  const ctx = useContext(EquipmentContext)
  if (!ctx) throw new Error('useEquipment musi być użyty wewnątrz EquipmentProvider')
  return ctx
}
