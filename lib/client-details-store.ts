'use client'

/**
 * Zapis danych klientów z faktur: `client-details.json` w AppData (Tauri) albo
 * localStorage (web), przez ten sam `createCollectionStore` co reszta.
 */

import { createCollectionStore } from './v3-store'
import { clientDetailsSchema, type ClientDetails } from './client-details'

export const CLIENT_DETAILS_FILE = 'client-details.json'
export const WEB_CLIENT_DETAILS_KEY = 'nonoise-client-details-v1'

const store = createCollectionStore<ClientDetails>({
  fileName: CLIENT_DETAILS_FILE,
  webKey: WEB_CLIENT_DETAILS_KEY,
  schema: clientDetailsSchema,
  getId: (details) => details.id,
  sort: (a, b) => a.client.localeCompare(b.client, 'pl') || a.id.localeCompare(b.id),
})

export const listClientDetails = store.list
/** Odczyt–zmiana–zapis jednym ruchem w kolejce. */
export const mutateClientDetails = store.mutate
