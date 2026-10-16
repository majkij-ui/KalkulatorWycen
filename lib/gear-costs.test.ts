import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Period } from './finance-calc'
import {
  DEFAULT_GEAR_SPREAD,
  countedAmount,
  gearCostInPeriod,
  gearCostLines,
  gearSpreadSettings,
  lineAmountInMonths,
  linkedCost,
} from './gear-costs'
import { fixedCostSchema, type EquipmentItem, type FixedCost } from './project-types'

const S = DEFAULT_GEAR_SPREAD
const YEAR = (year: number): Period => ({ kind: 'year', year })
const MONTH = (year: number, index: number): Period => ({ kind: 'month', year, index })

const item = (id: string, purchasePrice: number, purchaseDate: string, extra: Partial<EquipmentItem> = {}): EquipmentItem => ({
  id,
  name: id,
  category: 'kamery',
  purchasePrice,
  rentalDayRate: 0,
  purchaseDate,
  notes: '',
  ...extra,
})

const fixed = (id: string, month: string, amount: number, extra: Partial<FixedCost> = {}): FixedCost => ({
  id,
  month,
  type: 'other',
  label: 'Sprzęt',
  amount,
  source: 'manual',
  ...extra,
})

const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${message ?? ''} ${actual} ≠ ${expected}`)

test('zakup 6 000 zł w maju: włączone — 166,67 zł przez 36 miesięcy, wyłączone — całość w maju', () => {
  const items = [item('kamera', 6000, '2026-05-12')]
  const on = gearCostInPeriod(items, [], YEAR(2026), true, S)
  near(on.total, (6000 / 36) * 8, 'maj–grudzień = 8 rat')
  assert.equal(on.lines[0].line.mode, 'spread')
  assert.equal(on.lines[0].line.firstMonth, '2026-05')
  assert.equal(on.lines[0].line.lastMonth, '2029-04')
  near(gearCostInPeriod(items, [], MONTH(2026, 5), true, S).total, 166.67)
  near(gearCostInPeriod(items, [], MONTH(2026, 4), true, S).total, 0)
  near(gearCostInPeriod(items, [], YEAR(2029), true, S).total, (6000 / 36) * 4)
  near(gearCostInPeriod(items, [], YEAR(2030), true, S).total, 0)

  const off = gearCostInPeriod(items, [], YEAR(2026), false, S)
  assert.equal(off.total, 6000)
  assert.equal(gearCostInPeriod(items, [], MONTH(2026, 5), false, S).total, 6000)
  assert.equal(gearCostInPeriod(items, [], MONTH(2026, 6), false, S).total, 0)
  assert.equal(gearCostInPeriod(items, [], YEAR(2027), false, S).total, 0)
})

test('rozłożony zakup sumuje się do pełnej ceny po 36 miesiącach', () => {
  const { lines } = gearCostLines([item('red', 57000, '2024-04-01')], true, S)
  near(lineAmountInMonths(lines[0], '2024-01', '2027-12'), 57000)
})

test('RED Komodo 57 000 zł z 04.2024: 2026 niesie 19 000 zł jako reszta wcześniejszych lat, koniec 03.2027', () => {
  const items = [item('red', 57000, '2024-04-01'), item('rode', 800, '2026-08-01', { quantity: 2 })]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  near(y.carried, 19000)
  near(y.catalogue, 19000 + 1600)
  assert.equal(y.lines[0].line.itemId, 'red', 'przeniesione na górze')
  assert.equal(y.lines[0].carried, true)
  assert.equal(y.lines[1].carried, false)
  assert.equal(y.lines[0].line.lastMonth, '2027-03')
  near(gearCostInPeriod(items, [], YEAR(2027), true, S).total, (57000 / 36) * 3)
  // Widok „w całości": 2026 to tylko zakupy z 2026.
  assert.equal(gearCostInPeriod(items, [], YEAR(2026), false, S).total, 1600)
})

test('laptop w zapleczu za 4 500 zł: poniżej progu — w całości w swoim miesiącu w obu widokach', () => {
  const items = [item('laptop', 4500, '2026-03-10', { onSet: false })]
  for (const spread of [true, false]) {
    const y = gearCostInPeriod(items, [], YEAR(2026), spread, S)
    assert.equal(y.total, 4500)
    assert.equal(y.lines[0].line.mode, 'full')
    assert.equal(y.lines[0].line.onSet, false)
    assert.equal(gearCostInPeriod(items, [], MONTH(2026, 3), spread, S).total, 4500)
  }
})

test('próg: od 5 000 zł włącznie, dla całej pozycji (cena × sztuki)', () => {
  const lines = gearCostLines(
    [
      item('rowno', 5000, '2026-01-01'),
      item('ponizej', 4999.99, '2026-01-01'),
      item('para', 3000, '2026-01-01', { quantity: 2 }),
      item('halo', 1820, '2026-01-01', { quantity: 2 }),
    ],
    true,
    S
  ).lines
  const mode = (id: string) => lines.find((l) => l.itemId === id)!.mode
  assert.equal(mode('rowno'), 'spread')
  assert.equal(mode('ponizej'), 'full')
  assert.equal(mode('para'), 'spread', '2 × 3 000 = 6 000')
  assert.equal(mode('halo'), 'full', '2 × 1 820 = 3 640')
})

test('wycofany sprzęt przestaje się rozkładać po miesiącu wycofania; reszta tylko pokazana', () => {
  const items = [item('a7', 36000, '2026-01-05', { retiredAt: '2026-06-15' })]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  near(y.total, 6000, 'styczeń–czerwiec')
  near(gearCostInPeriod(items, [], MONTH(2026, 6), true, S).total, 1000)
  near(gearCostInPeriod(items, [], MONTH(2026, 7), true, S).total, 0)
  assert.equal(y.retired.length, 1)
  near(y.retired[0].unspread, 30000)
  assert.equal(gearCostInPeriod(items, [], YEAR(2027), true, S).retired.length, 0, 'wycofany w innym okresie')
  // Widok „w całości": sprzedaż nie cofa wydatku.
  assert.equal(gearCostInPeriod(items, [], YEAR(2026), false, S).total, 36000)
  // Wycofany po końcu rozkładania: nic nie zostaje.
  const old = gearCostLines([item('old', 36000, '2020-01-01', { retiredAt: '2026-01-01' })], true, S).lines[0]
  assert.equal(old.unspread, 0)
  assert.equal(old.lastMonth, '2022-12')
})

test('bez daty zakupu albo bez ceny: nie liczy się w żadnym miesiącu, jest na liście do uzupełnienia', () => {
  const items = [item('sony85', 900, ''), item('zly', 900, '12.03.2025'), item('bezceny', 0, '2026-02-01')]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  assert.equal(y.total, 0)
  assert.deepEqual(
    y.undated.map((p) => p.itemId),
    ['sony85', 'zly']
  )
  assert.deepEqual(
    y.unpriced.map((p) => p.itemId),
    ['bezceny']
  )
})

test('ręczne „Sprzęt spoza katalogu": w całości w swoim miesiącu w obu widokach; usunięte pomijane', () => {
  const costs = [
    fixed('m1', '2026-03', 4274.23, { category: 'gear' }),
    fixed('m2', '2026-06', -577.99, { category: 'gear', label: 'Sprzęt (po odjęciu sprzedaży obiektywu)' }),
    fixed('m3', '2026-07', 2239, { category: 'gear', deletedAt: '2026-10-01T00:00:00Z' }),
    fixed('zus', '2026-03', 1000, { type: 'zus' }),
  ]
  for (const spread of [true, false]) {
    const y = gearCostInPeriod([], costs, YEAR(2026), spread, S)
    near(y.manual, 4274.23 - 577.99)
    assert.equal(y.manualCosts.length, 2)
  }
})

test('powiązanie z katalogiem: z „Sprzęt" za sierpień liczy się reszta, Rode — z katalogu; razem tyle, ile zapłacono', () => {
  const items = [item('rode', 800, '2026-08-01', { quantity: 2 })]
  const aug = fixed('fc-aug', '2026-08', 5156.73, { category: 'gear', catalogueItemIds: ['rode'] })
  const link = linkedCost(aug, items)!
  assert.equal(link.linkedTotal, 1600)
  near(link.remainder, 3556.73)
  near(countedAmount(aug, items), 3556.73)
  const y = gearCostInPeriod(items, [aug], MONTH(2026, 8), false, S)
  near(y.manual, 3556.73)
  near(y.total, 5156.73, 'bez podwójnego liczenia')
  // Bez powiązania Rode liczyłby się dwa razy.
  near(gearCostInPeriod(items, [{ ...aug, catalogueItemIds: undefined }], MONTH(2026, 8), false, S).total, 5156.73 + 1600)
})

test('powiązanie z nieistniejącą pozycją: nic nie odejmujemy, brak jest pokazany', () => {
  const link = linkedCost(fixed('x', '2026-09', 970.81, { catalogueItemIds: ['nie-ma', 'nie-ma'] }), [])!
  assert.deepEqual(link.missing, ['nie-ma'])
  assert.equal(link.remainder, 970.81)
  assert.equal(linkedCost(fixed('y', '2026-09', 10), []), null)
})

test('`catalogueItemIds` w schemacie: zostaje, zła wartość znika, nie psuje rekordu', () => {
  const ok = fixedCostSchema.parse({ ...fixed('a', '2026-08', 1), catalogueItemIds: ['rode'] })
  assert.deepEqual(ok.catalogueItemIds, ['rode'])
  const bad = fixedCostSchema.parse({ ...fixed('b', '2026-08', 1), catalogueItemIds: 'rode' })
  assert.equal(bad.catalogueItemIds, undefined)
  assert.equal(bad.amount, 1)
})

test('próg i miesiące z company.json; złe wartości = domyślne', () => {
  assert.deepEqual(gearSpreadSettings(null), { thresholdPln: 5000, months: 36 })
  assert.deepEqual(gearSpreadSettings({ gearSpreadThresholdPln: 3000, gearSpreadMonths: 24 }), { thresholdPln: 3000, months: 24 })
  assert.deepEqual(gearSpreadSettings({ gearSpreadThresholdPln: -1, gearSpreadMonths: 2.5 }), { thresholdPln: 5000, months: 36 })
  assert.deepEqual(gearSpreadSettings({ gearSpreadThresholdPln: '5000', gearSpreadMonths: 0 }), { thresholdPln: 5000, months: 36 })
  // Niższy próg: laptop 4 500 zł się rozkłada.
  const lines = gearCostLines([item('laptop', 4500, '2026-03-10')], true, gearSpreadSettings({ gearSpreadThresholdPln: 3000 })).lines
  assert.equal(lines[0].mode, 'spread')
})

test('zakup z pierwszego miesiąca okresu nie jest „przeniesiony"; próg 0 zł = rozkładaj wszystko', () => {
  const y = gearCostInPeriod([item('styczen', 36000, '2026-01-02'), item('grudzien', 36000, '2025-12-30')], [], YEAR(2026), true, S)
  assert.equal(y.lines.find((l) => l.line.itemId === 'styczen')!.carried, false)
  assert.equal(y.lines.find((l) => l.line.itemId === 'grudzien')!.carried, true)
  near(y.carried, 12000)
  assert.equal(gearSpreadSettings({ gearSpreadThresholdPln: 0 }).thresholdPln, 0)
})
