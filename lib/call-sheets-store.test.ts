/**
 * Test integracyjny zapisu call sheetów na ścieżce webowej (localStorage):
 * odczyt niczego nie zapisuje, usuwanie jest miękkie, a pola z nowszej wersji
 * przeżywają zapis innego call sheetu.
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
  listAllCallSheets,
  restoreCallSheet,
  saveCallSheet,
  softDeleteCallSheet,
  WEB_CALL_SHEETS_KEY,
} from './call-sheets-store'
import { callSheetForDay, createCallSheet } from './call-sheet'

beforeEach(() => storage.clear())

test('bez pliku: pusta lista, a odczyt niczego nie zapisuje', async () => {
  assert.deepEqual(await listAllCallSheets(), [])
  assert.equal(storage.getItem(WEB_CALL_SHEETS_KEY), null)
})

test('zapis, miękkie usunięcie i „Cofnij"', async () => {
  const sheet = createCallSheet({ projectId: 'p1', dayId: 'd1' })
  await saveCallSheet(sheet)
  let all = await listAllCallSheets()
  assert.equal(callSheetForDay(all, 'p1', 'd1')?.id, sheet.id)

  all = await softDeleteCallSheet(sheet.id, '2026-10-10T12:00:00.000Z')
  assert.equal(all.length, 1, 'rekord zostaje w pliku')
  assert.equal(callSheetForDay(all, 'p1', 'd1'), null)

  all = await restoreCallSheet(sheet.id)
  assert.equal(callSheetForDay(all, 'p1', 'd1')?.id, sheet.id)
  assert.equal('deletedAt' in all[0], false)
})

test('pola z nowszej wersji przeżywają zapis innego call sheetu', async () => {
  const first = createCallSheet({ projectId: 'p1', dayId: 'd1' })
  storage.setItem(
    WEB_CALL_SHEETS_KEY,
    JSON.stringify({ version: 1, items: [{ ...first, weather: { forecast: 'deszcz' } }] })
  )
  await saveCallSheet(createCallSheet({ projectId: 'p1', dayId: 'd2' }))
  const raw = JSON.parse(storage.getItem(WEB_CALL_SHEETS_KEY)!) as { items: Record<string, unknown>[] }
  assert.equal(raw.items.length, 2)
  assert.deepEqual(raw.items.find((s) => s.id === first.id)?.weather, { forecast: 'deszcz' })
})
