'use client'

/**
 * Zestawy sprzętu (G6) — słownik firmy obok katalogu, jak `equipment.json`.
 * Zestaw to tylko pozycje i sztuki; ceny zawsze z katalogu w chwili użycia.
 */

import { createCollectionStore } from './v3-store'
import { createGearKitId, gearKitSchema, type GearKit, type GearLine, type KitCrewLine } from './project-types'

export const GEAR_KITS_FILE = 'gear-kits.json'
export const WEB_GEAR_KITS_KEY = 'nonoise-gear-kits-v1'

const store = createCollectionStore<GearKit>({
  fileName: GEAR_KITS_FILE,
  webKey: WEB_GEAR_KITS_KEY,
  schema: gearKitSchema,
  getId: (kit) => kit.id,
  sort: (a, b) => a.name.localeCompare(b.name, 'pl'),
})

export const listGearKits = store.list
export const upsertGearKit = store.upsert
export const deleteGearKit = store.remove

/**
 * Nowy zestaw z pozycji dnia (sztuki sumowane, pozycje bez powtórzeń), z
 * ekipą dnia, gdy jest (T9b): ta sama rola i osoba sumuje liczbę osób.
 */
export function createGearKit(
  name: string,
  lines: { itemId: string; qty: number }[],
  crew: { roleId: string; personId?: string; qty: number }[] = []
): GearKit {
  const kit: GearKit = {
    id: createGearKitId(),
    name: name.trim(),
    lines: normalizeKitLines(lines),
    createdAt: new Date().toISOString(),
  }
  const kitCrew = normalizeKitCrew(crew)
  if (kitCrew.length > 0) kit.crew = kitCrew
  return kit
}

export function normalizeKitCrew(crew: { roleId: string; personId?: string; qty: number }[]): KitCrewLine[] {
  const merged = new Map<string, KitCrewLine>()
  crew.forEach((entry) => {
    const qty = Math.floor(entry.qty)
    if (!entry.roleId || qty <= 0) return
    const key = `${entry.roleId}|${entry.personId ?? ''}`
    const prev = merged.get(key)
    if (prev) {
      // Osoba to jedna osoba — powtórzenie nie podnosi liczby.
      if (!entry.personId) prev.qty += qty
      return
    }
    merged.set(key, entry.personId ? { roleId: entry.roleId, personId: entry.personId, qty: 1 } : { roleId: entry.roleId, qty })
  })
  return [...merged.values()]
}

export function normalizeKitLines(lines: { itemId: string; qty: number }[]): GearLine[] {
  const merged = new Map<string, number>()
  lines.forEach((line) => {
    const qty = Math.floor(line.qty)
    if (!line.itemId || qty <= 0) return
    merged.set(line.itemId, (merged.get(line.itemId) ?? 0) + qty)
  })
  return [...merged].map(([itemId, qty]) => ({ itemId, qty }))
}
