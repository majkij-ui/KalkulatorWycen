import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ledgerDateFor, pendingQuotes, quoteToProject, readMigratedIds, mergeQuoteSources } from './project-migration-core'
import type { SavedQuoteRecord } from './quote-library'
import type { Project } from './project-types'

function quote(overrides: Partial<SavedQuoteRecord> = {}): SavedQuoteRecord {
  return {
    id: 'q-1',
    name: 'Kampania wiosenna',
    createdAt: '2026-03-14T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    snapshot: {
      version: 2,
      savedAt: '2026-03-14T10:00:00.000Z',
      data: { clientName: 'ACME' },
      pricingConfig: { anything: true },
      marginMultiplier: 1.2,
      pdfDraft: null,
    },
    ...overrides,
  } as SavedQuoteRecord
}

const NOW = new Date('2026-08-18T12:00:00.000Z')

test('wycena staje się projektem o statusie quote', () => {
  const p = quoteToProject(quote(), NOW)
  assert.equal(p.status, 'quote', 'migracja nie zgaduje, co weszło w życie')
  assert.equal(p.name, 'Kampania wiosenna')
  assert.equal(p.client, 'ACME', 'nazwa klienta przepisana z migawki')
  assert.equal(p.migratedFromQuoteId, 'q-1')
  assert.equal(p.financials, null)
  assert.deepEqual(p.equipment, [])
})

test('migawka wyceny wędruje w całości, bez gubienia pól', () => {
  const source = quote()
  const p = quoteToProject(source, NOW)
  assert.deepEqual(p.quote, source.snapshot, 'żadne pole wyceny nie może zniknąć')
})

test('data księgowa to dzień zapisania wyceny, nie dzień migracji', () => {
  const p = quoteToProject(quote(), NOW)
  assert.equal(p.date, '2026-03-14', 'inaczej cała historia wpadłaby w sierpień')
})

test('brak daty utworzenia — schodzimy na savedAt, potem na updatedAt', () => {
  const noCreated = quote({ createdAt: '' })
  assert.equal(ledgerDateFor(noCreated, NOW), '2026-03-14', 'savedAt z migawki')

  const noneAtAll = quote({ createdAt: '', updatedAt: '' })
  noneAtAll.snapshot = { ...noneAtAll.snapshot, savedAt: '' }
  assert.equal(ledgerDateFor(noneAtAll, NOW), '2026-08-18', 'ostatecznie dzień migracji')
})

test('niepoprawna data nie wywraca migracji', () => {
  const broken = quote({ createdAt: 'zupelnie-nie-data' })
  broken.snapshot = { ...broken.snapshot, savedAt: '' }
  broken.updatedAt = ''
  assert.equal(ledgerDateFor(broken, NOW), '2026-08-18')
})

test('wycena bez nazwy dostaje wartość zastępczą', () => {
  const p = quoteToProject(quote({ name: '' }), NOW)
  assert.equal(p.name, 'Bez nazwy')
})

test('migawka bez clientName daje pusty string zamiast undefined', () => {
  const q = quote()
  q.snapshot = { ...q.snapshot, data: {} as never }
  assert.equal(quoteToProject(q, NOW).client, '')
})

test('readMigratedIds zbiera tylko realne identyfikatory pochodzenia', () => {
  const projects = [
    { migratedFromQuoteId: 'q-1' },
    { migratedFromQuoteId: '' },
    {},
    { migratedFromQuoteId: 'q-2' },
  ] as Project[]
  const ids = readMigratedIds(projects)
  assert.deepEqual([...ids].sort(), ['q-1', 'q-2'])
})

test('migracja jest idempotentna — druga próba nie ma czego przenosić', () => {
  const quotes = [quote({ id: 'q-1' }), quote({ id: 'q-2' })]

  const firstRun = pendingQuotes(quotes, [])
  assert.equal(firstRun.length, 2)

  const migrated = firstRun.map((q) => quoteToProject(q, NOW)) as Project[]
  const secondRun = pendingQuotes(quotes, migrated)
  assert.equal(secondRun.length, 0, 'ponowne uruchomienie nie duplikuje projektów')
})

test('nowa wycena dodana po migracji zostaje wykryta', () => {
  const first = quote({ id: 'q-1' })
  const migrated = [quoteToProject(first, NOW)] as Project[]
  const withNew = pendingQuotes([first, quote({ id: 'q-3' })], migrated)

  assert.equal(withNew.length, 1)
  assert.equal(withNew[0].id, 'q-3')
})

test('wyceny ze starej aplikacji i z huba łączą się bez duplikatów — wygrywa nowsza', () => {
  const quote = (id: string, updatedAt: string, name = id) =>
    ({ id, name, createdAt: updatedAt, updatedAt, snapshot: { version: 2, savedAt: updatedAt, data: {} } }) as never
  const legacy = [quote('q-1', '2026-09-01T10:00:00Z', 'stara wersja'), quote('q-2', '2026-08-01T10:00:00Z')]
  const own = [quote('q-1', '2026-10-01T10:00:00Z', 'poprawiona'), quote('q-3', '2026-10-05T10:00:00Z')]
  const merged = mergeQuoteSources(legacy, own) as { id: string; name: string }[]
  assert.deepEqual(merged.map((q) => q.id), ['q-3', 'q-1', 'q-2'], 'najnowsze u góry')
  assert.equal(merged.find((q) => q.id === 'q-1')!.name, 'poprawiona')
  assert.deepEqual(mergeQuoteSources([], []), [])
})
