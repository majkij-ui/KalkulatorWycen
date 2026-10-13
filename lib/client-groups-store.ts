'use client'

/**
 * Zapis grup klientów (S2): `client-groups.json` w AppData (Tauri) albo
 * localStorage (web), przez ten sam `createCollectionStore` co reszta.
 * Grup nie usuwa się na twardo — `deletedAt` (`dissolveClientGroup`).
 */

import { createCollectionStore } from './v3-store'
import { clientGroupSchema, type ClientGroup } from './client-groups'

export const CLIENT_GROUPS_FILE = 'client-groups.json'
export const WEB_CLIENT_GROUPS_KEY = 'nonoise-client-groups-v1'

const store = createCollectionStore<ClientGroup>({
  fileName: CLIENT_GROUPS_FILE,
  webKey: WEB_CLIENT_GROUPS_KEY,
  schema: clientGroupSchema,
  getId: (group) => group.id,
  sort: (a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id),
})

/** Wszystkie grupy, z rozwiązanymi. */
export const listAllClientGroups = store.list
/** Odczyt–zmiana–zapis jednym ruchem w kolejce (funkcje z `client-groups.ts`). */
export const mutateClientGroups = store.mutate
