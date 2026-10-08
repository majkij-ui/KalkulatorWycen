/**
 * Test integracyjny zapisu wydarzeń na ścieżce webowej (localStorage).
 *
 * Najważniejsze: dane zapisane przez NOWSZĄ wersję aplikacji (nieznany typ,
 * nieznane pola) muszą przeżyć zapis innego rekordu przez starszą wersję —
 * bo kolekcja jest zapisywana w całości.
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
  WEB_EVENTS_KEY,
  createEvent,
  listAllEvents,
  listEvents,
  listProjectEvents,
  restoreEvent,
  saveEvent,
  softDeleteEvent,
} from './events-store'

function seedRaw(items: unknown[]): void {
  storage.setItem(WEB_EVENTS_KEY, JSON.stringify({ version: 99, items }))
}

function rawItems(): Record<string, unknown>[] {
  return JSON.parse(storage.getItem(WEB_EVENTS_KEY) ?? '{"items":[]}').items
}

beforeEach(() => storage.clear())

test('zapis i odczyt, chronologicznie', async () => {
  await saveEvent(createEvent({ kind: 'shoot_day', projectId: 'p-1', start: '2026-10-28', end: '2026-10-29' }))
  await saveEvent(createEvent({ kind: 'lead_in', projectId: 'p-1', start: '2026-10-02T09:14' }))
  const events = await listEvents()
  assert.deepEqual(
    events.map((e) => e.kind),
    ['lead_in', 'shoot_day']
  )
  assert.equal(events[1].end, '2026-10-29')
})

test('createEvent: koniec równy początkowi = wydarzenie jednodniowe', () => {
  assert.equal(createEvent({ kind: 'shoot_day', start: '2026-10-14', end: '2026-10-14' }).end, undefined)
})

test('dane nowszej wersji przeżywają zapis innego rekordu', async () => {
  seedRaw([
    {
      id: 'ev-future',
      kind: 'ksef_invoice',
      projectId: 'p-1',
      start: '2026-10-01',
      data: { ksefId: 'X-1' },
      source: { type: 'ksef', ref: 'K-1', batch: 7 },
      futureField: { a: 1 },
    },
  ])
  await saveEvent(createEvent({ kind: 'note', start: '2026-10-02' }))

  const future = rawItems().find((e) => e.id === 'ev-future')!
  assert.equal(future.kind, 'ksef_invoice')
  assert.deepEqual(future.data, { ksefId: 'X-1' })
  assert.deepEqual(future.source, { type: 'ksef', ref: 'K-1', batch: 7 })
  assert.deepEqual(future.futureField, { a: 1 })
})

test('rekord z uszkodzoną datą zostaje w pliku po zapisie innego', async () => {
  seedRaw([{ id: 'ev-bad', kind: 'shoot_day', start: 'wczoraj', title: 'do poprawy' }])
  await saveEvent(createEvent({ kind: 'note', start: '2026-10-02' }))
  const bad = rawItems().find((e) => e.id === 'ev-bad')
  assert.ok(bad, 'nie zgubiony')
  assert.equal(bad!.title, 'do poprawy')
})

test('miękkie usuwanie: znika z widoków, zostaje w pliku, da się przywrócić', async () => {
  const event = createEvent({
    kind: 'lead_in',
    projectId: 'p-1',
    start: '2026-10-02',
    source: { type: 'gmail', ref: 'msg-123' },
  })
  await saveEvent(event)
  await softDeleteEvent(event.id)

  assert.equal((await listEvents()).length, 0)
  const all = await listAllEvents()
  assert.equal(all.length, 1, 'import widzi usunięte i ich nie wskrzesza')
  assert.equal(all[0].source.ref, 'msg-123')
  assert.ok(all[0].deletedAt)

  await restoreEvent(event.id)
  assert.equal((await listEvents()).length, 1)
  assert.equal('deletedAt' in rawItems()[0], false, 'przywrócenie czyści pole')
})

test('wydarzenia projektu bez firmowych i cudzych', async () => {
  await saveEvent(createEvent({ kind: 'won', projectId: 'p-1', start: '2026-10-09' }))
  await saveEvent(createEvent({ kind: 'won', projectId: 'p-2', start: '2026-10-09' }))
  await saveEvent(createEvent({ kind: 'gear_purchase', start: '2026-10-08' }))
  assert.equal((await listProjectEvents('p-1')).length, 1)
})

test('zapis odświeża updatedAt', async () => {
  const event = { ...createEvent({ kind: 'note', start: '2026-10-02' }), updatedAt: '2000-01-01T00:00:00.000Z' }
  await saveEvent(event)
  const [saved] = await listEvents()
  assert.notEqual(saved.updatedAt, '2000-01-01T00:00:00.000Z')
})
