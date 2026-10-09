import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countsTowardRevenue,
  defaultProjectTab,
  equipmentCategoryLabel,
  equipmentItemSchema,
  fixedCostSchema,
  matchesFilter,
  projectSchema,
  toDateKey,
  toMonthKey,
  toQuarter,
  toYear,
  unitsOwned,
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
    category: 42,
    purchasePrice: Number.NaN,
    rentalDayRate: -5,
  })
  assert.equal(parsed.category, 'inne', 'kategoria, która nie jest tekstem → inne')
  assert.equal(parsed.purchasePrice, 0, 'NaN → 0')
  assert.equal(parsed.rentalDayRate, 0, 'liczba ujemna → 0')
  assert.equal(parsed.notes, '')
})

test('nieznana kategoria i pola z nowszej wersji przeżywają odczyt (zasada 4)', () => {
  const parsed = equipmentItemSchema.parse({
    id: 'eq-1',
    name: 'C-stand',
    category: 'grip',
    purchasePrice: 400,
    rentalDayRate: 30,
    serial: 'AB-123',
  })
  assert.equal(parsed.category, 'grip')
  assert.equal((parsed as Record<string, unknown>).serial, 'AB-123')
  assert.equal(equipmentCategoryLabel('grip'), 'grip', 'nieznana kategoria pokazuje się dosłownie')
  assert.equal(equipmentCategoryLabel('podglad'), 'Podgląd')
})

test('sztuki: brak albo bzdura = 1 sztuka, wycofanie tylko z poprawną datą', () => {
  const base = { id: 'eq-1', name: 'Aputure', category: 'swiatlo' }
  assert.equal(equipmentItemSchema.parse(base).quantity, undefined)
  assert.equal(unitsOwned(equipmentItemSchema.parse(base)), 1)
  assert.equal(unitsOwned(equipmentItemSchema.parse({ ...base, quantity: 3 })), 3)
  for (const bad of [0, -2, 1.5, 'dwie']) {
    assert.equal(equipmentItemSchema.parse({ ...base, quantity: bad }).quantity, undefined, String(bad))
  }
  assert.equal(equipmentItemSchema.parse({ ...base, retiredAt: '2026-02-01' }).retiredAt, '2026-02-01')
  assert.equal(equipmentItemSchema.parse({ ...base, retiredAt: 'wczoraj' }).retiredAt, undefined)
})

test('dni sprzętu w projekcie: zły wpis znika, reszta zostaje', () => {
  const base = { id: 'p-1', name: 'X', date: '2026-03-01' }
  assert.equal(projectSchema.parse(base).gearDays, undefined, 'brak pola = stary kształt')
  assert.deepEqual(projectSchema.parse({ ...base, gearDays: 'bzdura' }).gearDays, [])

  const parsed = projectSchema.parse({
    ...base,
    gearDays: [
      {
        id: 'gd-1',
        date: '2026-03-02',
        lines: [{ itemId: 'fx3', qty: 2 }, { qty: 1 }, { itemId: 'lampa' }, 'x'],
        weather: 'deszcz',
      },
      { label: 'bez id' },
      { id: 'gd-2', date: 'jutro', lines: 'nic' },
    ],
  })
  assert.deepEqual(parsed.gearDays, [
    {
      id: 'gd-1',
      label: '',
      date: '2026-03-02',
      lines: [
        { itemId: 'fx3', qty: 2 },
        { itemId: 'lampa', qty: 1 },
      ],
      weather: 'deszcz',
    },
    { id: 'gd-2', label: '', date: '', lines: [] },
  ])
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

test('projekt bez wyceny jest poprawny (quote: null)', () => {
  const inquiry = projectSchema.parse({ id: 'p-1', name: 'Zapytanie', date: '2026-10-02', quote: null })
  assert.equal(inquiry.status, 'quote')
  assert.equal(inquiry.quote, null)
  assert.equal(projectSchema.parse({ id: 'p-2', date: '2026-10-02' }).quote, null, 'brak pola = null')
  assert.equal(
    projectSchema.parse({ id: 'p-3', date: '2026-10-02', quote: 'śmieci' }).quote,
    null,
    'uszkodzona wycena nie odrzuca całego projektu'
  )
})

test('rekord sprzed T1b czyta się bez zmian, nowe pola są opcjonalne', () => {
  const old = projectSchema.parse({
    id: 'p-old',
    name: 'Stary',
    client: 'Tchibo',
    status: 'won',
    date: '2026-05-14',
    quote: { data: {} },
    financials: null,
    equipment: [],
    notes: '',
  })
  assert.equal(old.status, 'won')
  assert.equal(old.colorKey, undefined)
  assert.equal(old.contact, undefined)
  assert.equal(old.leadSource, undefined)
})

test('pola z nowszej wersji przeżywają odczyt projektu (passthrough)', () => {
  const parsed = projectSchema.parse({
    id: 'p-1',
    date: '2026-10-02',
    quote: null,
    colorKey: 'amber',
    leadSource: 'google_ads',
    contact: { name: 'Anna', email: 'anna@example.com', phone: 123, role: 'brand manager' },
    futureField: { a: 1 },
  }) as Record<string, unknown>
  assert.equal(parsed.colorKey, 'amber')
  assert.equal(parsed.leadSource, 'google_ads')
  assert.deepEqual(parsed.contact, { name: 'Anna', email: 'anna@example.com', phone: '', role: 'brand manager' })
  assert.deepEqual(parsed.futureField, { a: 1 })
})

test('status „lead" z krótko istniejącej wersji czyta się jako wycena', () => {
  const old = projectSchema.parse({ id: 'p-1', date: '2026-10-02', status: 'lead', quote: null })
  assert.equal(old.status, 'quote')
})

test('„Ukryj nieprzyjęte" chowa odrzucone wyceny w każdym filtrze', () => {
  assert.equal(matchesFilter('lost', 'all', { hideLost: true }), false)
  assert.equal(matchesFilter('lost', 'quotes', { hideLost: true }), false)
  assert.equal(matchesFilter('quote', 'quotes', { hideLost: true }), true)
  assert.equal(matchesFilter('won', 'all', { hideLost: true }), true)
  assert.equal(matchesFilter('lost', 'all'), true, 'bez przełącznika widać wszystko')
})

test('domyślna zakładka: oś czasu dla W realizacji i Zrealizowanych, wycena dla reszty', () => {
  assert.equal(defaultProjectTab('won'), 'os')
  assert.equal(defaultProjectTab('done'), 'os')
  assert.equal(defaultProjectTab('quote'), 'wycena')
  assert.equal(defaultProjectTab('lost'), 'wycena')
})

test('deletedAt przechodzi przez schemat; zepsuta wartość nie odrzuca projektu', () => {
  const base = { id: 'p-1', date: '2026-10-09' }
  assert.equal(projectSchema.parse({ ...base, deletedAt: '2026-10-09T10:00:00.000Z' }).deletedAt, '2026-10-09T10:00:00.000Z')
  const broken = projectSchema.safeParse({ ...base, deletedAt: 42 })
  assert.equal(broken.success, true)
  assert.equal(broken.success && broken.data.deletedAt, undefined)
})
