'use client'

/**
 * Kontekst katalogu sprzętu.
 *
 * Osobny od `project-hub-context`, bo katalog jest niezależny od wyceny i od
 * otwartego projektu — to słownik firmy, nie dane pojedynczego zlecenia.
 * Użycie sprzętu W projekcie zapisujemy przez `updateActiveProject`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  createEquipmentItem,
  deleteEquipment,
  listEquipment,
  upsertEquipment,
} from './equipment-catalog'
import { isOnSet } from './gear-backstage'
import { createGearKit, deleteGearKit, listGearKits, updateGearKits, upsertGearKit } from './gear-kits'
import type { EquipmentItem, GearKit } from './project-types'

interface EquipmentContextValue {
  /**
   * Sprzęt NA PLAN: to z niego korzystają listy wyboru (wycena, zestawy,
   * Realizacja, listy pakowania, karta dnia) i statystyki. Zaplecze i
   * drobiazgi (`onSet === false`) są odfiltrowane tutaj, przy źródle, żeby
   * żaden nowy odbiorca nie musiał o tym pamiętać.
   */
  items: EquipmentItem[]
  /** Cały katalog: na plan + zaplecze. Dla ekranu Sprzęt i kalendarza zakupów. */
  allItems: EquipmentItem[]
  isLoading: boolean
  addItem: (params: {
    name: string
    category: string
    purchasePrice?: number
    rentalDayRate?: number
    quantity?: number
    /** `YYYY-MM-DD` — zakup pokazuje się wtedy w kalendarzu. */
    purchaseDate?: string
    notes?: string
    /** `false` = zaplecze i drobiazgi (nie jedzie na plan). */
    onSet?: boolean
  }) => Promise<EquipmentItem | null>
  updateItem: (item: EquipmentItem) => Promise<void>
  removeItem: (id: string) => Promise<void>
  /** Zestawy sprzętu (G6), alfabetycznie. */
  kits: GearKit[]
  /** Zapisuje nowy zestaw z pozycji dnia; pusta nazwa albo brak pozycji = nic. */
  /** Zestaw z dnia: sprzęt i (T9b) ekipa; wystarczy jedno z dwojga. */
  addKit: (
    name: string,
    lines: { itemId: string; qty: number }[],
    crew?: { roleId: string; personId?: string; qty: number }[]
  ) => Promise<GearKit | null>
  updateKit: (kit: GearKit) => Promise<void>
  /** Kilka zestawów jednym zapisem (np. „Scal osoby"). */
  updateKits: (kits: GearKit[]) => Promise<void>
  removeKit: (id: string) => Promise<void>
}

const EquipmentContext = createContext<EquipmentContextValue | null>(null)

export function EquipmentProvider({ children }: { children: React.ReactNode }) {
  const [allItems, setItems] = useState<EquipmentItem[]>([])
  const items = useMemo(() => allItems.filter(isOnSet), [allItems])
  const [kits, setKits] = useState<GearKit[]>([])

  useEffect(() => {
    let cancelled = false
    void listGearKits().then((loaded) => {
      if (!cancelled) setKits(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const addKit = useCallback<EquipmentContextValue['addKit']>(async (name, lines, crew) => {
    const kit = createGearKit(name, lines, crew)
    if (!kit.name || (kit.lines.length === 0 && !kit.crew?.length)) return null
    setKits(await upsertGearKit(kit))
    return kit
  }, [])

  const updateKit = useCallback(async (kit: GearKit) => {
    setKits(await upsertGearKit(kit))
  }, [])

  const updateKits = useCallback(async (next: GearKit[]) => {
    if (next.length > 0) setKits(await updateGearKits(next))
  }, [])

  const removeKit = useCallback(async (id: string) => {
    setKits(await deleteGearKit(id))
  }, [])
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
    <EquipmentContext.Provider
      value={{ items, allItems, isLoading, addItem, updateItem, removeItem, kits, addKit, updateKit, updateKits, removeKit }}
    >
      {children}
    </EquipmentContext.Provider>
  )
}

export function useEquipment(): EquipmentContextValue {
  const ctx = useContext(EquipmentContext)
  if (!ctx) throw new Error('useEquipment musi być użyty wewnątrz EquipmentProvider')
  return ctx
}
