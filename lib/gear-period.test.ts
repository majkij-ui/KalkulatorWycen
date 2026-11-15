import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeGearReport, itemYearlyUse, summarizeProjectGear, visibleInPeriod } from './equipment-roi'
import type { Period } from './finance-calc'
import { gearCapital } from './gear-capital'
import { investedInPeriod, ownedInPeriod } from './gear-period'
import type { EquipmentItem, GearDay, Project } from './project-types'

const NOW = new Date(2026, 10, 15, 12)

function item(id: string, price: number, rate: number, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name: id, category: 'kamery', purchasePrice: price, rentalDayRate: rate, purchaseDate: '', notes: '', ...extra }
}

function gearDay(id: string, date: string, lines: { itemId: string; qty: number; dayRate?: number }[]): GearDay {
  return { id, label: '', date, lines }
}

function project(id: string, gearDays: GearDay[], extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-01-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    gearDays,
    notes: '',
    ...extra,
  }
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`)
const y = (year: number): Period => ({ kind: 'year', year })
const h = (year: number, index: number): Period => ({ kind: 'half', year, index })
const q = (year: number, index: number): Period => ({ kind: 'quarter', year, index })

// Projekt Alfa: dwa dni w 2025 (grudzień), jeden w 2026 (styczeń); zarobił 900 zł.
const lamp = item('lamp', 3000, 100, { purchaseDate: '2025-05-10' })
const alfa = project(
  'alfa',
  [
    gearDay('a1', '2025-12-30', [{ itemId: 'lamp', qty: 2 }]), // 200
    gearDay('a2', '2025-12-31', [{ itemId: 'lamp', qty: 1, dayRate: 300 }]), // 300
    gearDay('a3', '2026-01-02', [{ itemId: 'lamp', qty: 1 }]), // 100
  ],
  { date: '2026-02-15', gearEarnedOverride: 900 }
)

test('Odpracował w okresie: dokładnie z dnia (ilość × stawka dnia), bez równego podziału', () => {
  const r2025 = computeGearReport([lamp], [alfa], { now: NOW, period: y(2025) }).items[0]
  near(r2025.inPeriod.rentValue, 500)
  assert.equal(r2025.inPeriod.daysUsed, 2)
  assert.equal(r2025.inPeriod.unitDays, 3)
  const r2026 = computeGearReport([lamp], [alfa], { now: NOW, period: y(2026) }).items[0]
  near(r2026.inPeriod.rentValue, 100)
  assert.equal(r2026.inPeriod.daysUsed, 1)
})

test('Zarobił rozdzielone na dni wg wartości dnia — projekt na dwa lata dzieli się między nie', () => {
  // 900 zł × (200, 300, 100) / 600
  const r2025 = computeGearReport([lamp], [alfa], { now: NOW, period: y(2025) }).items[0]
  const r2026 = computeGearReport([lamp], [alfa], { now: NOW, period: y(2026) }).items[0]
  near(r2025.inPeriod.clientPaid, 750)
  near(r2026.inPeriod.clientPaid, 150)
  near(r2025.inPeriod.clientPaid + r2026.inPeriod.clientPaid, 900)
  assert.equal(r2025.inPeriod.projectsUsed, 1)
  assert.equal(r2026.inPeriod.projectsUsed, 1)
})

test('Zarobił: udziały dni zawsze sumują się do „zarobił" pozycji (też przy wartości dni = 0)', () => {
  const rate = item('rate', 0, 50)
  const p = project('p', [gearDay('d1', '2025-03-01', [{ itemId: 'rate', qty: 1, dayRate: 0 }]), gearDay('d2', '2025-03-02', [{ itemId: 'rate', qty: 1, dayRate: 0 }])], {
    gearEarnedOverride: 100,
  })
  const summary = summarizeProjectGear(p, [rate])
  summary.items.forEach((u) => near(u.days.reduce((s, d) => s + d.clientPaid, 0), u.clientPaid))
  const withValue = summarizeProjectGear(alfa, [lamp]).items[0]
  near(withValue.days.reduce((s, d) => s + d.clientPaid, 0), withValue.clientPaid)
})

test('Całość = dzisiejszy raport: wartości „w okresie" równe sumom od początku', () => {
  const report = computeGearReport([lamp], [alfa], { now: NOW })
  const row = report.items[0]
  near(row.inPeriod.rentValue, row.rentValue)
  near(row.inPeriod.clientPaid, row.clientPaid)
  assert.equal(row.inPeriod.daysUsed, row.daysUsed)
  assert.equal(row.inPeriod.projectsUsed, row.projectsUsed)
  near(row.rentValue, 600)
  near(row.clientPaid, 900)
  near(report.totals.period.rentValue, report.totals.rentValue)
  near(report.totals.period.clientPaid, report.totals.clientPaid)
  assert.equal(report.totals.period.unusedCount, report.totals.unusedCount)
})

test('Po latach: lata malejąco, suma lat = sumy od początku', () => {
  const rows = itemYearlyUse('lamp', [alfa], [lamp])
  assert.deepEqual(rows.map((r) => r.year), [2026, 2025])
  assert.equal(rows[1].days, 2)
  assert.equal(rows[1].projects, 1)
  near(rows[1].rentValue, 500)
  near(rows[1].clientPaid, 750)
  const all = computeGearReport([lamp], [alfa], { now: NOW }).items[0]
  near(rows.reduce((s, r) => s + r.rentValue, 0), all.rentValue)
  near(rows.reduce((s, r) => s + r.clientPaid, 0), all.clientPaid)
  assert.equal(rows.reduce((s, r) => s + r.days, 0), all.daysUsed)
})

test('Podział roku na H1+H2 i Q1–Q4 daje sumy roku', () => {
  const cam = item('cam', 9000, 400, { purchaseDate: '2026-01-05' })
  const projects = [
    project('p1', [gearDay('x', '2026-02-10', [{ itemId: 'cam', qty: 1 }]), gearDay('y', '2026-03-31', [{ itemId: 'cam', qty: 2 }])], {
      date: '2026-04-01',
      gearEarnedOverride: 700,
    }),
    project('p2', [gearDay('z', '2026-06-30', [{ itemId: 'cam', qty: 1, dayRate: 250 }]), gearDay('w', '2026-07-01', [{ itemId: 'cam', qty: 1 }])], {
      date: '2026-07-02',
      gearEarnedOverride: 410,
    }),
    project('p3', [gearDay('v', '2026-11-11', [{ itemId: 'cam', qty: 1 }])], { date: '2026-11-12', gearEarnedOverride: -60 }),
  ]
  const sum = (periods: Period[], key: 'rentValue' | 'clientPaid' | 'daysUsed') =>
    periods.reduce((s, period) => s + computeGearReport([cam], projects, { now: NOW, period }).items[0].inPeriod[key], 0)
  for (const key of ['rentValue', 'clientPaid', 'daysUsed'] as const) {
    const year = sum([y(2026)], key)
    near(sum([h(2026, 1), h(2026, 2)], key), year)
    near(sum([q(2026, 1), q(2026, 2), q(2026, 3), q(2026, 4)], key), year)
  }
  near(sum([y(2026)], 'clientPaid'), 700 + 410 - 60)
})

test('Widoczność w okresie: użyta, kupiona albo sprzedana w okresie', () => {
  const used = item('used', 1000, 100, { purchaseDate: '2020-01-01' })
  const bought = item('bought', 1000, 100, { purchaseDate: '2026-04-10' })
  const sold = item('sold', 1000, 100, { purchaseDate: '2020-01-01', soldDate: '2026-05-05', soldPrice: 500 })
  const other = item('other', 1000, 100, { purchaseDate: '2020-01-01' })
  const p = project('p', [gearDay('d', '2026-04-20', [{ itemId: 'used', qty: 1 }])])
  const report = computeGearReport([used, bought, sold, other], [p], { now: NOW, period: q(2026, 2) })
  const names = report.items.filter((r) => visibleInPeriod(r, q(2026, 2))).map((r) => r.item.id).sort()
  assert.deepEqual(names, ['bought', 'sold', 'used'])
  const q3 = computeGearReport([used, bought, sold, other], [p], { now: NOW, period: q(2026, 3) })
  assert.deepEqual(q3.items.filter((r) => visibleInPeriod(r, q(2026, 3))).map((r) => r.item.id), [])
  assert.equal(report.items.filter((r) => visibleInPeriod(r, null)).length, 4)
})

test('Nieużywane w okresie: kupione po końcu okresu i sprzedane przed początkiem nie liczą się', () => {
  const idle = item('idle', 100, 10, { purchaseDate: '2020-01-01' })
  const noDate = item('nodate', 100, 10)
  const later = item('later', 100, 10, { purchaseDate: '2026-08-01' })
  const soldBefore = item('soldBefore', 100, 10, { purchaseDate: '2020-01-01', soldDate: '2026-03-31' })
  const soldIn = item('soldIn', 100, 10, { purchaseDate: '2020-01-01', soldDate: '2026-04-01' })
  const used = item('used', 100, 10, { purchaseDate: '2020-01-01' })
  const p = project('p', [gearDay('d', '2026-05-01', [{ itemId: 'used', qty: 1 }])])
  const report = computeGearReport([idle, noDate, later, soldBefore, soldIn, used], [p], { now: NOW, period: q(2026, 2) })
  assert.equal(report.totals.period.unusedCount, 3, 'idle, bez daty zakupu, sprzedany w okresie')
  assert.equal(ownedInPeriod(later, q(2026, 2)), false)
  assert.equal(ownedInPeriod(soldBefore, q(2026, 2)), false)
  assert.equal(ownedInPeriod({ purchaseDate: '', retiredAt: '2026-03-01' }, q(2026, 2)), false)
})

test('Zainwestowane w okresie: zakupy × sztuki z podziałem na plan i zaplecze oraz liczba', () => {
  const items = [
    item('a', 1000, 0, { purchaseDate: '2026-02-01', quantity: 2 }),
    item('b', 400, 0, { purchaseDate: '2026-03-15' }),
    item('c', 250, 0, { purchaseDate: '2026-04-01', onSet: false }),
    item('d', 999, 0, { purchaseDate: '2025-12-31' }),
    item('e', 999, 0),
  ]
  const q1 = investedInPeriod(items, q(2026, 1))
  assert.equal(q1.onSetCount, 2)
  assert.equal(q1.backstageCount, 0)
  near(q1.onSet, 2400)
  const q2 = investedInPeriod(items, q(2026, 2))
  near(q2.backstage, 250)
  assert.equal(q2.backstageCount, 1)
  near(investedInPeriod(items, y(2026)).total, 2650)
})

test('gearCapital w półroczu: zakupy − sprzedaże tylko z okresu', () => {
  const items = [
    item('a', 1000, 0, { purchaseDate: '2026-02-01' }),
    item('b', 500, 0, { purchaseDate: '2026-08-01' }),
    item('c', 800, 0, { purchaseDate: '2024-01-01', soldDate: '2026-06-30', soldPrice: 300 }),
    item('d', 700, 0, { purchaseDate: '2024-01-01', soldDate: '2026-07-01', soldPrice: 200 }),
  ]
  const h1 = gearCapital(items, h(2026, 1))
  near(h1.purchasesInYear, 1000)
  near(h1.salesInYear, 300)
  near(h1.netInYear, 700)
  const h2 = gearCapital(items, h(2026, 2))
  near(h2.netInYear, 500 - 200)
  near(h1.netInYear + h2.netInYear, gearCapital(items, 2026).netInYear)
  near(h1.netTotal, gearCapital(items, 2026).netTotal)
})
