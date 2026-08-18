import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countsTowardRevenue,
  equipmentItemSchema,
  fixedCostSchema,
  matchesFilter,
  projectSchema,
  toDateKey,
  toMonthKey,
  toQuarter,
  toYear,
} from './project-types'

test('do wyników firmy wliczają się tylko projekty won/done', () => {
  assert.equal(countsTowardRevenue('won'), true)
  assert.equal(countsTowardRevenue('done'), true)
  assert.equal(countsTowardRevenue('quote'), false)
  assert.equal(countsTowardRevenue('lost'), false)
})

test('filtry listy odpowiadają trzem trybom z notatek', () => {
  assert.equal(matchesFilter('won', 'projects'), true)
  assert.equal(matchesFilter('done', 'projects'), true)
  assert.equal(matchesFilter('quote', 'projects'), false)

  assert.equal(matchesFilter('quote', 'quotes'), true)
  assert.equal(matchesFilter('lost', 'quotes'), true)
  assert.equal(matchesFilter('won', 'quotes'), false)

  assert.equal(matchesFilter('lost', 'all'), true)
})

test('toDateKey używa czasu lokalnego (toISOString cofa dobę w PL)', () => {
  // 00:30 czasu lokalnego — w UTC to jeszcze poprzedni dzień
  const local = new Date(2026, 0, 15, 0, 30)
  assert.equal(toDateKey(local), '2026-01-15')
})

test('pomocnicze na datach zwracają null zamiast rzucać', () => {
  assert.equal(toMonthKey('2026-05-14'), '2026-05')
  assert.equal(toMonthKey('bzdura'), '')
  assert.equal(toYear('2026-05-14'), 2026)
  assert.equal(toYear('bzdura'), null)
  assert.equal(toQuarter('2026-05-14'), 2)
  assert.equal(toQuarter('2026-12-31'), 4)
  assert.equal(toQuarter('2026-13-01'), null)
  assert.equal(toQuarter('bzdura'), null)
})

test('schemat sprzętu naprawia uszkodzone pola zamiast odrzucać rekord', () => {
  const parsed = equipmentItemSchema.parse({
    id: 'eq-1',
    name: 'FX3',
    category: 'nieistniejaca',
    purchasePrice: Number.NaN,
    rentalDayRate: -5,
  })
  assert.equal(parsed.category, 'inne', 'nieznana kategoria → inne')
  assert.equal(parsed.purchasePrice, 0, 'NaN → 0')
  assert.equal(parsed.rentalDayRate, 0, 'liczba ujemna → 0')
  assert.equal(parsed.notes, '')
})

test('koszt stały wymaga poprawnego miesiąca', () => {
  assert.equal(
    fixedCostSchema.safeParse({ id: 'c1', month: '2026-01', type: 'zus', amount: 1600 }).success,
    true
  )
  assert.equal(
    fixedCostSchema.safeParse({ id: 'c1', month: '2026', type: 'zus', amount: 1600 }).success,
    false,
    'sam rok to za mało — agregacja miesięczna by się rozjechała'
  )
  const unknownType = fixedCostSchema.parse({
    id: 'c1',
    month: '2026-01',
    type: 'kryptowaluty',
    amount: 100,
  })
  assert.equal(unknownType.type, 'other')
  assert.equal(unknownType.source, 'manual', 'domyślne źródło, pole gotowe pod KSeF')
})

test('projekt bez poprawnej daty jest odrzucany', () => {
  const base = {
    id: 'p-1',
    name: 'Test',
    quote: { version: 2 },
    date: '2026-05-14',
  }
  assert.equal(projectSchema.safeParse(base).success, true)
  assert.equal(
    projectSchema.safeParse({ ...base, date: '14.05.2026' }).success,
    false,
    'data jest kluczem agregacji — nie wolno jej zgadywać'
  )
})

test('nieznany status projektu schodzi do quote, nie wywala rekordu', () => {
  const parsed = projectSchema.parse({
    id: 'p-1',
    name: 'Test',
    date: '2026-05-14',
    quote: { version: 2 },
    status: 'zaakceptowany-kiedys',
  })
  assert.equal(parsed.status, 'quote')
})

test('migawka wyceny przechodzi walidację nietknięta', () => {
  const snapshot = { version: 2, data: { clientName: 'ACME' }, dziwnePole: [1, 2, 3] }
  const parsed = projectSchema.parse({
    id: 'p-1',
    name: 'Test',
    date: '2026-05-14',
    quote: snapshot,
  })
  assert.deepEqual(parsed.quote, snapshot, 'nieznane pola wyceny muszą przetrwać')
})

test('projekt bez migawki wyceny jest odrzucany', () => {
  assert.equal(
    projectSchema.safeParse({ id: 'p-1', name: 'Test', date: '2026-05-14', quote: null }).success,
    false
  )
})
