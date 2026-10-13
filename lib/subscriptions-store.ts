'use client'

/**
 * Zapis subskrypcji (S1): `subscriptions.json` w AppData (Tauri) albo
 * localStorage (web), przez ten sam `createCollectionStore` co reszta huba.
 *
 * Nie usuwa się na twardo: `deletedAt`, a „Cofnij" go zdejmuje. Raty w
 * miesiącach nie są tu zapisywane — liczy je `subscriptions.ts`.
 */

import { createCollectionStore } from './v3-store'
import { subscriptionSchema, type Subscription } from './subscription-types'

export const SUBSCRIPTIONS_FILE = 'subscriptions.json'
export const WEB_SUBSCRIPTIONS_KEY = 'nonoise-subscriptions-v1'

const store = createCollectionStore<Subscription>({
  fileName: SUBSCRIPTIONS_FILE,
  webKey: WEB_SUBSCRIPTIONS_KEY,
  schema: subscriptionSchema,
  getId: (s) => s.id,
  sort: (a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id),
})

/** Wszystkie subskrypcje, z usuniętymi. */
export const listAllSubscriptions = store.list
export const upsertSubscription = store.upsert

export function softDeleteSubscription(id: string, deletedAt: string): Promise<Subscription[]> {
  return store.mutate((all) => all.map((s) => (s.id === id ? { ...s, deletedAt, updatedAt: deletedAt } : s)))
}

export function restoreSubscription(id: string): Promise<Subscription[]> {
  const updatedAt = new Date().toISOString()
  return store.mutate((all) =>
    all.map((s) => {
      if (s.id !== id) return s
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { deletedAt, ...rest } = s
      return { ...rest, updatedAt }
    })
  )
}
