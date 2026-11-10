import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Period } from './finance-calc'
import { DEFAULT_GEAR_SPREAD, gearCostInPeriod } from './gear-costs'
import { fundedBySale, fundedBySaleText, fundingCandidates, gearCapital } from './gear-capital'
import { equipmentItemSchema, type EquipmentItem } from './project-types'

const S = DEFAULT_GEAR_SPREAD
const YEAR = (year: number): Period => ({ kind: 'year', year })
const MONTH = (year: number, index: number): Period => ({ kind: 'month', year, index })
const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${message ?? ''} ${actual} ≠ ${expected}`)

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

// RED 57 000 kupiony 2024-04-01, sprzedany 2027-01-15 za 30 000.
const red = () => [item('RED', 57000, '2024-04-01', { soldDate: '2027-01-15', soldPrice: 30000 })]
const total = (items: EquipmentItem[], period: Period, spread: boolean, through: string | null = null) =>
  gearCostInPeriod(items, [], period, spread, S, through).total

test('sprzedany rozłożony: rata do stycznia 2027 włącznie + wiersz sprzedaży −26 833,33', () => {
  const items = red()
  near(total(items, MONTH(2026, 12), true), 57000 / 36, 'grudzień 2026: rata')
  const jan = gearCostInPeriod(items, [], MONTH(2027, 1), true, S)
  assert.equal(jan.sales.length, 1)
  near(jan.sales[0].sale.unspread, 3166.67)
  near(jan.sales[0].amount, -26833.33, 'wiersz sprzedaży')
  near(jan.salesTotal, -26833.33)
  near(jan.total, -25250, 'styczeń 2027 razem (rata 1 583,33 − 26 833,33)')
  near(total(items, MONTH(2027, 2), true), 0, 'po sprzedaży nic')
  assert.equal(jan.retired.length, 0, 'sprzedaż z ceną nie jest „nierozłożoną resztą, która się nie liczy"')
})

test('sprzedany w widoku „w całości": zakup w miesiącu zakupu, −cena w miesiącu sprzedaży', () => {
  const items = red()
  near(total(items, MONTH(2024, 4), false), 57000)
  near(total(items, MONTH(2027, 1), false), -30000)
  const jan = gearCostInPeriod(items, [], MONTH(2027, 1), false, S)
  near(jan.sales[0].amount, -30000)
})

test('całe życie: widok rozłożony = widok „w całości" = cena − sprzedaż', () => {
  const items = red()
  const spreadSum = [2024, 2025, 2026, 2027, 2028].reduce((sum, y) => sum + total(items, YEAR(y), true), 0)
  const fullSum = [2024, 2025, 2026, 2027, 2028].reduce((sum, y) => sum + total(items, YEAR(y), false), 0)
  near(spreadSum, 27000, 'rozłożony')
  near(fullSum, 27000, 'w całości')
})

test('tańszy niż próg, sprzedany: w widoku rozłożonym też −cena w miesiącu sprzedaży', () => {
  const items = [item('obiektyw', 3000, '2026-02-10', { soldDate: '2026-09-01', soldPrice: 1800 })]
  near(total(items, YEAR(2026), true), 1200)
  near(total(items, MONTH(2026, 9), true), -1800)
})

test('sprzedaż po `through` (bieżący miesiąc) jeszcze się nie liczy', () => {
  const items = red()
  const cut = gearCostInPeriod(items, [], YEAR(2027), true, S, '2026-12')
  assert.equal(cut.sales.length, 0)
  near(cut.total, 0, 'rok 2027 przycięty do 2026-12: nic z 2027')
  const upto = gearCostInPeriod(items, [], YEAR(2027), true, S, '2027-01')
  near(upto.total, -25250)
  near(gearCostInPeriod(items, [], YEAR(2027), false, S, '2026-12').total, 0)
})

test('samo wycofanie bez sprzedaży: bez zmian — reszta pokazana, nie liczona', () => {
  const items = [item('a7', 36000, '2026-01-05', { retiredAt: '2026-06-15' })]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  near(y.total, 6000)
  assert.equal(y.sales.length, 0)
  assert.equal(y.retired.length, 1)
  near(y.retired[0].unspread, 30000)
})

test('soldDate bez soldPrice = wycofanie (bez wiersza sprzedaży)', () => {
  const items = [item('a7', 36000, '2026-01-05', { soldDate: '2026-06-15' })]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  near(y.total, 6000)
  assert.equal(y.sales.length, 0)
  assert.equal(y.retired.length, 1)
  near(gearCostInPeriod(items, [], MONTH(2026, 7), true, S).total, 0)
  near(gearCostInPeriod(items, [], YEAR(2026), false, S).total, 36000)
})

test('sprzedany za 0 zł: reszta zakupu zdjęta w miesiącu sprzedaży (odpis)', () => {
  const items = [item('x', 36000, '2026-01-05', { soldDate: '2026-06-15', soldPrice: 0 })]
  near(total(items, YEAR(2026), true), 36000)
})

test('sprzedaż po końcu rozkładania: wiersz = −cena sprzedaży, ujemny miesiąc dozwolony', () => {
  const items = [item('old', 36000, '2020-01-01', { soldDate: '2026-03-10', soldPrice: 5000 })]
  const mar = gearCostInPeriod(items, [], MONTH(2026, 3), true, S)
  near(mar.total, -5000)
  near([2020, 2021, 2022, 2023, 2024, 2025, 2026].reduce((s, y) => s + total(items, YEAR(y), true), 0), 31000)
})

test('sprzedaż pozycji bez ceny zakupu albo bez daty zakupu nie wchodzi do kosztów', () => {
  const items = [
    item('bezdaty', 5000, '', { soldDate: '2026-03-10', soldPrice: 2000 }),
    item('bezceny', 0, '2026-01-01', { soldDate: '2026-03-10', soldPrice: 2000 }),
  ]
  const y = gearCostInPeriod(items, [], YEAR(2026), true, S)
  assert.equal(y.sales.length, 0)
  assert.equal(y.total, 0)
})

test('schemat pozycji: fundedBySale zostaje, zły typ znika; pola sprzedaży przechodzą bez zmian', () => {
  const ok = equipmentItemSchema.parse({ id: 'a', name: 'A', category: 'k', fundedBySale: ['x', 'y'], soldDate: '2026-01-01', soldPrice: 5 })
  assert.deepEqual(ok.fundedBySale, ['x', 'y'])
  assert.equal(equipmentItemSchema.parse({ id: 'a', name: 'A', category: 'k', fundedBySale: 'x' }).fundedBySale, undefined)
})

// ── Kapitał w sprzęcie ───────────────────────────────────────────────────────

test('Kapitał w sprzęcie: zakupy − sprzedaże w roku i od początku', () => {
  const items = [
    ...red(),
    item('fx3', 15000, '2026-05-01', { quantity: 2 }),
    item('bezdaty', 1000, ''),
    item('skasowany', 9999, '2026-01-01', { deletedAt: '2026-02-01' } as Partial<EquipmentItem>),
  ]
  const c2024 = gearCapital(items, 2024)
  near(c2024.purchasesInYear, 57000)
  near(c2024.netInYear, 57000)
  const c2027 = gearCapital(items, 2027)
  near(c2027.salesInYear, 30000)
  near(c2027.netInYear, -30000)
  const c2026 = gearCapital(items, 2026)
  near(c2026.purchasesInYear, 30000, '15 000 × 2 sztuki')
  near(c2026.netTotal, 57000 + 30000 + 1000 - 30000, 'od początku, z pozycją bez daty')
  assert.equal(c2026.undatedCount, 1)
  near(c2026.purchasesTotal, 88000)
  near(c2026.salesTotal, 30000)
})

test('Kapitał w sprzęcie: bez sprzedaży = suma zakupów', () => {
  const c = gearCapital([item('a', 1000, '2025-01-01'), item('b', 500, '2026-01-01')], 2026)
  near(c.netTotal, 1500)
  near(c.netInYear, 500)
  near(c.salesTotal, 0)
})

// ── Sfinansowano sprzedażą ───────────────────────────────────────────────────

test('Sfinansowano sprzedażą: realny koszt = cena − sprzedaż, informacyjnie', () => {
  const sold = item('red', 57000, '2024-04-01', { name: 'RED', soldDate: '2027-01-15', soldPrice: 30000 })
  const buy = item('kamera', 40000, '2027-02-01', { fundedBySale: ['red'] })
  const info = fundedBySale(buy, [sold, buy])!
  near(info.realCost, 10000)
  near(info.surplus, 0)
  assert.match(fundedBySaleText(info, (n) => `${Math.round(n)} zł`), /^Sfinansowano sprzedażą: RED 30000 zł → realny koszt 10000 zł$/)
  // Cena pozycji (ROI itd.) nie jest ruszana.
  assert.equal(buy.purchasePrice, 40000)
})

test('Sfinansowano sprzedażą: sprzedaż większa niż cena = koszt 0 i nadwyżka', () => {
  const sold = item('red', 57000, '2024-04-01', { name: 'RED', soldDate: '2027-01-15', soldPrice: 30000 })
  const buy = item('kamera', 20000, '2027-02-01', { fundedBySale: ['red'] })
  const info = fundedBySale(buy, [sold, buy])!
  near(info.realCost, 0)
  near(info.surplus, 10000)
  assert.match(fundedBySaleText(info, (n) => `${Math.round(n)} zł`), /realny koszt 0 zł, nadwyżka 10000 zł$/)
})

test('Sfinansowano sprzedażą: lista wyboru = sprzedane z ceną; brakujące i niesprzedane źródła pomijane', () => {
  const sold = item('red', 57000, '2024-04-01', { soldDate: '2027-01-15', soldPrice: 30000 })
  const retiredOnly = item('stary', 100, '2020-01-01', { soldDate: '2026-01-01' })
  const live = item('zywy', 100, '2020-01-01')
  assert.deepEqual(fundingCandidates([sold, retiredOnly, live], null).map((i) => i.id), ['red'])
  assert.deepEqual(fundingCandidates([sold], 'red'), [])
  assert.equal(fundedBySale(item('k', 100, '', { fundedBySale: ['zywy', 'brak'] }), [live]), null)
  assert.equal(fundedBySale(item('k', 100, ''), [sold]), null)
})
