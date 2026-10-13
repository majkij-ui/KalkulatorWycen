/**
 * Zapis subskrypcji i kosztów stałych na ścieżce webowej (localStorage):
 * usuwanie jest miękkie, „Cofnij" przywraca dokładnie usunięte, a pola z
 * nowszej wersji przeżywają zapis innego rekordu.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

const storage = new MemoryStorage()
const globals = globalThis as Record<string, unknown>
globals.localStorage = storage
globals.window = globals

// Importy są hoistowane, ale moduły sięgają po `window` dopiero w ciele funkcji.
import {
  listAllSubscriptions,
  restoreSubscription,
  softDeleteSubscription,
  upsertSubscription,
  WEB_SUBSCRIPTIONS_KEY,
} from './subscriptions-store'
import {
  addFixedCosts,
  createFixedCost,
  listFixedCosts,
  restoreFixedCosts,
  softDeleteFixedCosts,
  upsertFixedCost,
  WEB_FINANCES_KEY,
} from './finances-store'
import { createSubscription } from './subscription-types'
import { fixedCostsInYear } from './subscriptions'

beforeEach(() => storage.clear())

test('subskrypcja: zapis, miękkie usunięcie i Cofnij', async () => {
  const artlist = createSubscription({ name: 'Artlist', startDate: '2026-06-15', amount: 2611.51, cadence: 'yearly' })
  await upsertSubscription(artlist)
  await upsertSubscription(createSubscription({ name: 'Adobe', startDate: '2026-10-01', amount: 250 }))

  const afterDelete = await softDeleteSubscription(artlist.id, '2026-10-13T10:00:00.000Z')
  assert.equal(afterDelete.length, 2, 'nic nie znika z pliku')
  assert.equal(afterDelete.find((s) => s.id === artlist.id)?.deletedAt, '2026-10-13T10:00:00.000Z')
  assert.equal(fixedCostsInYear([], afterDelete, 2026).filter((c) => c.subscriptionId === artlist.id).length, 0)

  const restored = await restoreSubscription(artlist.id)
  assert.equal(restored.find((s) => s.id === artlist.id)?.deletedAt, undefined)
  assert.deepEqual(
    (await listAllSubscriptions()).map((s) => s.name),
    ['Adobe', 'Artlist'],
    'po nazwie'
  )
})

test('subskrypcja: pola z nowszej wersji przeżywają zapis innego rekordu', async () => {
  storage.setItem(
    WEB_SUBSCRIPTIONS_KEY,
    JSON.stringify({
      version: 1,
      items: [{ id: 's-new', name: 'Z przyszłości', category: 'cloud', amount: 9, currency: 'GBP', cadence: 'weekly', startDate: '2026-01-01', extra: [1] }],
    })
  )
  await upsertSubscription(createSubscription({ name: 'Bank', startDate: '2026-10-01', amount: 10.3 }))
  const raw = JSON.parse(storage.getItem(WEB_SUBSCRIPTIONS_KEY)!) as { items: Record<string, unknown>[] }
  const kept = raw.items.find((i) => i.id === 's-new')!
  assert.equal(kept.currency, 'GBP')
  assert.equal(kept.cadence, 'weekly')
  assert.equal(kept.category, 'cloud')
  assert.deepEqual(kept.extra, [1])
})

test('koszty stałe: miękkie usunięcie kilku pozycji jednym znacznikiem i Cofnij tylko ich', async () => {
  const a = createFixedCost({ month: '2026-09', type: 'other', amount: 100, label: 'A', category: 'software' })
  const b = createFixedCost({ month: '2026-09', type: 'other', amount: 200, label: 'B' })
  const c = createFixedCost({ month: '2026-08', type: 'zus', amount: 1417.14 })
  await addFixedCosts([a, b, c])
  await softDeleteFixedCosts([c.id], '2026-10-12T08:00:00.000Z')
  await softDeleteFixedCosts([a.id, b.id], '2026-10-13T10:00:00.000Z')

  const deleted = await listFixedCosts()
  assert.equal(deleted.length, 3)
  assert.equal(fixedCostsInYear(deleted, [], 2026).length, 0, 'usunięte nie liczą się')

  const restored = await restoreFixedCosts('2026-10-13T10:00:00.000Z')
  assert.deepEqual(
    restored.filter((x) => !x.deletedAt).map((x) => x.label).sort(),
    ['A', 'B']
  )
  assert.equal(restored.find((x) => x.id === c.id)?.deletedAt, '2026-10-12T08:00:00.000Z', 'inne usunięcie zostaje')
  assert.equal(restored.find((x) => x.id === a.id)?.category, 'software')
  assert.equal('deletedAt' in restored.find((x) => x.id === a.id)!, false, 'znacznik zdjęty, nie pusty')
})

test('koszty stałe: stary plik bez nowych pól czyta się i zapisuje bez zmian', async () => {
  const old = { id: 'fc-retro2026-2026-01-zus', month: '2026-01', type: 'zus', label: 'ZUS', amount: 2257.29, source: 'manual' }
  storage.setItem(WEB_FINANCES_KEY, JSON.stringify({ version: 1, items: [old] }))
  await upsertFixedCost(createFixedCost({ month: '2026-02', type: 'zus', amount: 1417.14 }))
  const raw = JSON.parse(storage.getItem(WEB_FINANCES_KEY)!) as { items: Record<string, unknown>[] }
  assert.deepEqual(
    raw.items.find((i) => i.id === old.id),
    old
  )
})
