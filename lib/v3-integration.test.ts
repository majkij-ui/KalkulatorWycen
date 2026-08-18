/**
 * Test integracyjny warstwy zapisu v3 na ścieżce webowej (localStorage).
 *
 * Testy jednostkowe pokrywają czyste funkcje; tutaj sprawdzamy to, czego one
 * nie dotykają: realny zapis i odczyt z magazynu, filtrowanie, oraz migrację
 * wycen do projektów wraz z kopią zapasową i idempotencją.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Polyfill przeglądarki (moduły wykrywają brak Tauri i schodzą na localStorage)
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
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
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  get length(): number {
    return this.map.size
  }
  /** Podgląd surowych kluczy — do sprawdzania kopii zapasowej. */
  keys(): string[] {
    return [...this.map.keys()]
  }
}

const storage = new MemoryStorage()
const globals = globalThis as Record<string, unknown>
globals.localStorage = storage
globals.window = globals

// Importy ESM są hoistowane, więc wykonają się PRZED polyfillem powyżej.
// To bezpieczne, bo moduły sprawdzają `window` i Tauri dopiero w ciele funkcji,
// a nie przy ładowaniu — do czasu pierwszego wywołania polyfill już stoi.
import {
  createProject,
  deleteProject,
  filterProjects,
  listProjects,
  setProjectStatus,
  upsertProject,
  WEB_PROJECTS_KEY,
} from './project-library'
import { createEquipmentItem, listEquipment, upsertEquipment } from './equipment-catalog'
import {
  createFixedCost,
  listFixedCosts,
  monthRange,
  repeatMonthly,
  upsertFixedCost,
} from './finances-store'
import { isMigrationDone, migrateQuotesToProjects } from './project-migration'

const WEB_QUOTES_KEY = 'nonoise-quotes-library-v1'

function seedQuotes(count: number): void {
  const quotes = Array.from({ length: count }, (_, i) => ({
    id: `q-${i + 1}`,
    name: `Wycena ${i + 1}`,
    createdAt: `2026-0${i + 1}-10T09:00:00.000Z`,
    updatedAt: `2026-0${i + 1}-12T09:00:00.000Z`,
    snapshot: {
      version: 2,
      savedAt: `2026-0${i + 1}-10T09:00:00.000Z`,
      data: { clientName: `Klient ${i + 1}`, projectName: `Projekt ${i + 1}` },
      pricingConfig: { stawka: 1000 },
      marginMultiplier: 1.1,
      pdfDraft: null,
    },
  }))
  storage.setItem(WEB_QUOTES_KEY, JSON.stringify({ version: 1, quotes }))
}

beforeEach(() => {
  storage.clear()
})

test('projekt przechodzi pełny obieg: zapis, odczyt, zmiana statusu, usunięcie', async () => {
  const snapshot = { version: 2, savedAt: '', data: {}, pricingConfig: {}, marginMultiplier: 1, pdfDraft: null }
  const project = createProject({ name: 'Reklama TV', quote: snapshot as never, client: 'ACME' })

  await upsertProject(project)
  let all = await listProjects()
  assert.equal(all.length, 1)
  assert.equal(all[0].name, 'Reklama TV')
  assert.equal(all[0].status, 'quote', 'nowy projekt startuje jako wycena')

  await setProjectStatus(project.id, 'won')
  all = await listProjects()
  assert.equal(all[0].status, 'won')
  assert.ok(all[0].updatedAt, 'zmiana statusu stempluje czas')

  await deleteProject(project.id)
  assert.equal((await listProjects()).length, 0)
})

test('upsert nadpisuje po id, nie tworzy duplikatu', async () => {
  const snapshot = { version: 2 } as never
  const p = createProject({ name: 'Pierwsza nazwa', quote: snapshot })
  await upsertProject(p)
  await upsertProject({ ...p, name: 'Poprawiona nazwa' })

  const all = await listProjects()
  assert.equal(all.length, 1)
  assert.equal(all[0].name, 'Poprawiona nazwa')
})

test('lista projektów jest chronologiczna, najnowsze u góry', async () => {
  const snapshot = { version: 2 } as never
  await upsertProject(createProject({ name: 'Stary', quote: snapshot, date: '2026-01-05' }))
  await upsertProject(createProject({ name: 'Nowy', quote: snapshot, date: '2026-07-05' }))
  await upsertProject(createProject({ name: 'Środkowy', quote: snapshot, date: '2026-04-05' }))

  const names = (await listProjects()).map((p) => p.name)
  assert.deepEqual(names, ['Nowy', 'Środkowy', 'Stary'])
})

test('filtr rozdziela projekty od wycen', async () => {
  const snapshot = { version: 2 } as never
  await upsertProject(createProject({ name: 'Zrealizowany', quote: snapshot, status: 'done' }))
  await upsertProject(createProject({ name: 'W realizacji', quote: snapshot, status: 'won' }))
  await upsertProject(createProject({ name: 'Wycena', quote: snapshot, status: 'quote' }))
  await upsertProject(createProject({ name: 'Odrzucona', quote: snapshot, status: 'lost' }))

  const all = await listProjects()
  assert.equal(filterProjects(all, 'all').length, 4)
  assert.equal(filterProjects(all, 'projects').length, 2)
  assert.equal(filterProjects(all, 'quotes').length, 2)
})

test('uszkodzony rekord jest pomijany, reszta kolekcji ocalona', async () => {
  storage.setItem(
    WEB_PROJECTS_KEY,
    JSON.stringify({
      version: 1,
      items: [
        { id: 'p-ok', name: 'Dobry', date: '2026-05-01', quote: { version: 2 } },
        { id: 'p-zly', name: 'Zła data', date: '01.05.2026', quote: { version: 2 } },
        { nonsens: true },
      ],
    })
  )
  const all = await listProjects()
  assert.equal(all.length, 1, 'jeden uszkodzony rekord nie kasuje całej biblioteki')
  assert.equal(all[0].id, 'p-ok')
})

test('pusty lub uszkodzony magazyn daje pustą listę zamiast wyjątku', async () => {
  assert.deepEqual(await listProjects(), [])
  storage.setItem(WEB_PROJECTS_KEY, 'to nie jest JSON')
  assert.deepEqual(await listProjects(), [])
})

test('katalog sprzętu zapisuje i sortuje po kategorii, potem nazwie', async () => {
  await upsertEquipment(createEquipmentItem({ name: 'Zoom H6', category: 'dzwiek', rentalDayRate: 80 }))
  await upsertEquipment(createEquipmentItem({ name: 'FX3', category: 'kamery', purchasePrice: 20000, rentalDayRate: 500 }))
  await upsertEquipment(createEquipmentItem({ name: 'Aputure', category: 'swiatlo', rentalDayRate: 200 }))

  const items = await listEquipment()
  assert.deepEqual(items.map((i) => i.category), ['dzwiek', 'kamery', 'swiatlo'])
  assert.equal(items[1].purchasePrice, 20000)
})

test('koszty stałe zapisują się i dają się powielić na cały rok', async () => {
  const zus = createFixedCost({ month: '2026-01', type: 'zus', amount: 1600 })
  await upsertFixedCost(zus)

  const months = monthRange('2026-01', '2026-12')
  assert.equal(months.length, 12)
  assert.equal(months[0], '2026-01')
  assert.equal(months[11], '2026-12')

  for (const cost of repeatMonthly(zus, months.slice(1))) {
    await upsertFixedCost(cost)
  }
  const all = await listFixedCosts()
  assert.equal(all.length, 12, 'ZUS za każdy miesiąc, bez wpisywania ręcznie')
  assert.equal(all[0].month, '2026-12', 'najnowszy miesiąc u góry')
})

test('monthRange przez granicę roku i przy odwróconym zakresie', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(monthRange('2026-05', '2026-01'), [], 'odwrócony zakres nie zapętla się')
})

test('migracja przenosi wyceny, robi kopię i nie rusza oryginału', async () => {
  seedQuotes(3)
  const quotesBefore = storage.getItem(WEB_QUOTES_KEY)

  const result = await migrateQuotesToProjects()
  assert.equal(result.status, 'migrated')
  assert.equal(result.migratedCount, 3)
  assert.ok(result.backupLocation, 'kopia zapasowa musi powstać')

  const projects = await listProjects()
  assert.equal(projects.length, 3)
  assert.equal(projects.every((p) => p.status === 'quote'), true)
  assert.equal(projects.some((p) => p.client === 'Klient 1'), true, 'klient przepisany z migawki')

  assert.equal(
    storage.getItem(WEB_QUOTES_KEY),
    quotesBefore,
    'biblioteka wycen musi zostać nietknięta — powrót do starej wersji apki ma działać'
  )
  assert.ok(
    storage.keys().some((k) => k.startsWith('nonoise-quotes-backup-')),
    'kopia zapasowa zapisana pod własnym kluczem'
  )
  assert.equal(isMigrationDone(), true)
})

test('migracja jest idempotentna — drugie uruchomienie nic nie duplikuje', async () => {
  seedQuotes(2)
  await migrateQuotesToProjects()
  const afterFirst = await listProjects()

  const second = await migrateQuotesToProjects()
  assert.equal(second.status, 'skipped-already-done')
  assert.equal(second.migratedCount, 0)

  const afterSecond = await listProjects()
  assert.equal(afterSecond.length, afterFirst.length, 'liczba projektów bez zmian')
})

test('wycena dodana po migracji zostaje domigrowana', async () => {
  seedQuotes(2)
  await migrateQuotesToProjects()

  const raw = JSON.parse(storage.getItem(WEB_QUOTES_KEY) as string)
  raw.quotes.push({
    id: 'q-nowa',
    name: 'Dorzucona po migracji',
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
    snapshot: { version: 2, savedAt: '2026-06-01T09:00:00.000Z', data: {}, pricingConfig: {}, marginMultiplier: 1, pdfDraft: null },
  })
  storage.setItem(WEB_QUOTES_KEY, JSON.stringify(raw))

  const result = await migrateQuotesToProjects()
  assert.equal(result.status, 'migrated')
  assert.equal(result.migratedCount, 1, 'tylko nowa wycena')
  assert.equal((await listProjects()).length, 3)
})

test('brak wycen — migracja nie robi nic i nie zakłada kopii', async () => {
  const result = await migrateQuotesToProjects()
  assert.equal(result.status, 'skipped-empty')
  assert.equal(result.backupLocation, null)
  assert.equal((await listProjects()).length, 0)
})

test('migracja zachowuje pełną migawkę wyceny', async () => {
  seedQuotes(1)
  await migrateQuotesToProjects()
  const [project] = await listProjects()

  const snapshot = project.quote as unknown as Record<string, unknown>
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.marginMultiplier, 1.1)
  assert.deepEqual(snapshot.pricingConfig, { stawka: 1000 }, 'cennik z chwili zapisu ocalony')
})
