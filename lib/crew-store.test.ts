/**
 * Test integracyjny zapisu Ekipy na ścieżce webowej (localStorage): odczyt
 * niczego nie zapisuje, usuwanie jest miękkie, a pola z nowszej wersji
 * przeżywają zapis innego rekordu.
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
  listAllCrewMembers,
  listStoredCrewRoles,
  restoreCrewMember,
  softDeleteCrewMember,
  upsertCrewMember,
  upsertCrewRole,
  WEB_CREW_KEY,
  WEB_CREW_ROLES_KEY,
} from './crew-store'
import { createCrewMember, resolveCrewRoles } from './crew-types'
import { DEFAULT_PRICING } from './pricing-config'

beforeEach(() => storage.clear())

test('bez plików: role wbudowane są, a odczyt niczego nie zapisuje', async () => {
  const stored = await listStoredCrewRoles()
  assert.deepEqual(stored, [])
  assert.equal(resolveCrewRoles(stored, DEFAULT_PRICING).length, 8)
  assert.deepEqual(await listAllCrewMembers(), [])
  assert.equal(storage.getItem(WEB_CREW_ROLES_KEY), null)
  assert.equal(storage.getItem(WEB_CREW_KEY), null)
})

test('pierwsza edycja wbudowanej roli zapisuje tylko ją', async () => {
  const gafer = resolveCrewRoles([], DEFAULT_PRICING).find((r) => r.id === 'gafer')!
  await upsertCrewRole({ ...gafer, clientRate: 1800 })
  const file = JSON.parse(storage.getItem(WEB_CREW_ROLES_KEY)!)
  assert.deepEqual(file.items.map((r: { id: string }) => r.id), ['gafer'])
  const roles = resolveCrewRoles(await listStoredCrewRoles(), DEFAULT_PRICING)
  assert.equal(roles.length, 8)
  assert.equal(roles.find((r) => r.id === 'gafer')!.clientRate, 1800)
})

test('usunięcie osoby jest miękkie i da się je cofnąć', async () => {
  const ola = createCrewMember({ name: 'Ola', roleIds: ['gafer'], rate: 900 })
  await upsertCrewMember(ola)
  await softDeleteCrewMember(ola.id, '2026-10-10T10:00:00.000Z')
  const deleted = (await listAllCrewMembers())[0]
  assert.equal(deleted.deletedAt, '2026-10-10T10:00:00.000Z')
  assert.equal(deleted.rate, 900, 'rekord zostaje w pliku')
  await restoreCrewMember(ola.id)
  const back = (await listAllCrewMembers())[0]
  assert.equal('deletedAt' in back, false)
})

test('pola z nowszej wersji przeżywają zapis innej osoby', async () => {
  storage.setItem(
    WEB_CREW_KEY,
    JSON.stringify({
      version: 1,
      items: [{ id: 'cm-old', name: 'Piotr', roleIds: [], contact: { phone: '1', signal: 'x' }, createdAt: '', updatedAt: '', nip: '123' }],
    })
  )
  await upsertCrewMember(createCrewMember({ name: 'Ola' }))
  const file = JSON.parse(storage.getItem(WEB_CREW_KEY)!)
  const piotr = file.items.find((m: { id: string }) => m.id === 'cm-old')
  assert.equal(piotr.nip, '123')
  assert.equal(piotr.contact.signal, 'x')
})
