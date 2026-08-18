'use client'

/**
 * Katalog sprzętu — cena zakupu i średnia stawka rentalowa per pozycja.
 *
 * Katalog jest ŹRÓDŁEM DANYCH, nie częścią wyceny: zaznaczenie sprzętu na
 * projekcie nie zmienia kwot w ofercie (wymóg z notatek). Służy do listy
 * pakowania i do liczenia ROI w `equipment-roi.ts`.
 */

import { createCollectionStore } from './v3-store'
import {
  createEquipmentId,
  equipmentItemSchema,
  type EquipmentCategory,
  type EquipmentItem,
} from './project-types'

export const EQUIPMENT_FILE = 'equipment.json'
export const WEB_EQUIPMENT_KEY = 'nonoise-equipment-v1'

function byCategoryThenName(a: EquipmentItem, b: EquipmentItem): number {
  const byCategory = a.category.localeCompare(b.category, 'pl')
  return byCategory !== 0 ? byCategory : a.name.localeCompare(b.name, 'pl')
}

const store = createCollectionStore<EquipmentItem>({
  fileName: EQUIPMENT_FILE,
  webKey: WEB_EQUIPMENT_KEY,
  schema: equipmentItemSchema,
  getId: (i) => i.id,
  sort: byCategoryThenName,
})

export const listEquipment = store.list
export const upsertEquipment = store.upsert
export const deleteEquipment = store.remove
export const replaceAllEquipment = store.replaceAll

export function createEquipmentItem(params: {
  name: string
  category: EquipmentCategory
  purchasePrice?: number
  rentalDayRate?: number
  purchaseDate?: string
  notes?: string
}): EquipmentItem {
  return {
    id: createEquipmentId(),
    name: params.name,
    category: params.category,
    purchasePrice: params.purchasePrice ?? 0,
    rentalDayRate: params.rentalDayRate ?? 0,
    purchaseDate: params.purchaseDate ?? '',
    notes: params.notes ?? '',
  }
}

/** Pozycje pogrupowane po kategorii — pod rozwijaną listę w zakładce Produkcja. */
export function groupByCategory(items: EquipmentItem[]): Map<EquipmentCategory, EquipmentItem[]> {
  const map = new Map<EquipmentCategory, EquipmentItem[]>()
  items.forEach((item) => {
    const bucket = map.get(item.category) ?? []
    bucket.push(item)
    map.set(item.category, bucket)
  })
  return map
}
