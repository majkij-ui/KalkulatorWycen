/**
 * Test integracyjny zapisu grup klientów (S2) na ścieżce webowej
 * (localStorage): odczyt niczego nie zapisuje, zmiana to jeden zapis na
 * świeżym pliku, rozwiązanie grupy jest miękkie, obce pola przeżywają.
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
import { listAllClientGroups, mutateClientGroups, WEB_CLIENT_GROUPS_KEY } from './client-groups-store'
import { addGroupMembers, createClientGroup, dissolveClientGroup, liveGroups, restoreClientGroup } from './client-groups'

beforeEach(() => storage.clear())

const NOW = '2026-10-13T12:00:00.000Z'

test('bez pliku: pusta lista, a odczyt niczego nie zapisuje', async () => {
  assert.deepEqual(await listAllClientGroups(), [])
  assert.equal(storage.getItem(WEB_CLIENT_GROUPS_KEY), null)
})

test('tworzenie, dodanie członka i rozwiązanie z „Cofnij" — każda zmiana jednym zapisem; obce pola przeżywają', async () => {
  storage.setItem(
    WEB_CLIENT_GROUPS_KEY,
    JSON.stringify({
      version: 1,
      items: [{ id: 'cg-old', name: 'Hotele', members: ['interferie s.a.'], createdAt: '', updatedAt: '', color: 'amber' }],
    })
  )
  let createdId = ''
  await mutateClientGroups((all) => {
    const result = createClientGroup(all, { name: 'CIONET + DE Group', members: ['CIONET'] }, NOW)
    createdId = result.group.id
    return result.groups
  })
  await mutateClientGroups((all) => addGroupMembers(all, createdId, ['DE Group Sp. z o.o.', 'Interferie S.A.'], NOW))
  const all = await listAllClientGroups()
  assert.deepEqual(all.find((g) => g.id === createdId)!.members, ['cionet', 'de group sp. z o.o.', 'interferie s.a.'])
  const old = all.find((g) => g.id === 'cg-old')!
  assert.deepEqual(old.members, [], 'Interferie przeniesione')
  assert.equal(old.color, 'amber')

  await mutateClientGroups((list) => dissolveClientGroup(list, createdId, NOW))
  assert.equal(liveGroups(await listAllClientGroups()).some((g) => g.id === createdId), false)
  const file = JSON.parse(storage.getItem(WEB_CLIENT_GROUPS_KEY)!)
  assert.equal(file.items.length, 2, 'rozwiązana grupa zostaje w pliku')
  await mutateClientGroups((list) => restoreClientGroup(list, createdId, NOW, 'X'))
  assert.equal(liveGroups(await listAllClientGroups()).length, 2)
})
