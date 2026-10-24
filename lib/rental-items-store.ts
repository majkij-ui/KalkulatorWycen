'use client'

/**
 * Zapis słownika wynajmowanego sprzętu (U2): `rental-items.json` w AppData
 * (Tauri) albo localStorage (web), przez ten sam `createCollectionStore` co
 * reszta. Pozycji nie usuwa się na twardo — `deletedAt`.
 */

import { createCollectionStore } from './v3-store'
import { rentalItemSchema, type RentalItem } from './rental-types'

export const RENTAL_ITEMS_FILE = 'rental-items.json'
export const WEB_RENTAL_ITEMS_KEY = 'nonoise-rental-items-v1'

const store = createCollectionStore<RentalItem>({
  fileName: RENTAL_ITEMS_FILE,
  webKey: WEB_RENTAL_ITEMS_KEY,
  schema: rentalItemSchema,
  getId: (item) => item.id,
  sort: (a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id),
})

/** Wszystkie pozycje, z usuniętymi. */
export const listAllRentalItems = store.list
/** Odczyt–zmiana–zapis jednym ruchem w kolejce (funkcje z `rentals.ts`). */
export const mutateRentalItems = store.mutate
