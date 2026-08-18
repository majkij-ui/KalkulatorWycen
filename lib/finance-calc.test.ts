import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  availablePeriods,
  fixedCostsByMonth,
  isInPeriod,
  monthlyTrend,
  periodLabel,
  quarterlyTrend,
  summarizeFixedCosts,
  summarizePeriod,
  type Period,
} from './finance-calc'
import type { FixedCost, Project, ProjectStatus } from './project-types'

function project(
  id: string,
  date: string,
  status: ProjectStatus,
  financials: { sumaNetto: number; koszty: number; podatek: number; zysk: number } | null
): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date,
    createdAt: '',
    updatedAt: '',
    quote: {} as Project['quote'],
    financials: financials ? { ...financials, marzaPct: 0, computedAt: '' } : null,
    equipment: [],
    notes: '',
  }
}

function cost(id: string, month: string, type: FixedCost['type'], amount: number): FixedCost {
  return { id, month, type, label: '', amount, source: 'manual' }
}

test('isInPeriod dopasowuje rok, półrocze, kwartał i miesiąc', () => {
  const date = '2026-05-14'
  assert.equal(isInPeriod(date, { kind: 'year', year: 2026 }), true)
  assert.equal(isInPeriod(date, { kind: 'year', year: 2025 }), false)
  assert.equal(isInPeriod(date, { kind: 'half', year: 2026, index: 1 }), true)
  assert.equal(isInPeriod(date, { kind: 'half', year: 2026, index: 2 }), false)
  assert.equal(isInPeriod(date, { kind: 'quarter', year: 2026, index: 2 }), true)
  assert.equal(isInPeriod(date, { kind: 'quarter', year: 2026, index: 1 }), false)
  assert.equal(isInPeriod(date, { kind: 'month', year: 2026, index: 5 }), true)
  assert.equal(isInPeriod(date, { kind: 'month', year: 2026, index: 4 }), false)
})

test('isInPeriod obsługuje granice kwartałów i półroczy', () => {
  assert.equal(isInPeriod('2026-03-31', { kind: 'quarter', year: 2026, index: 1 }), true)
  assert.equal(isInPeriod('2026-04-01', { kind: 'quarter', year: 2026, index: 2 }), true)
  assert.equal(isInPeriod('2026-06-30', { kind: 'half', year: 2026, index: 1 }), true)
  assert.equal(isInPeriod('2026-07-01', { kind: 'half', year: 2026, index: 2 }), true)
  assert.equal(isInPeriod('2026-12-31', { kind: 'quarter', year: 2026, index: 4 }), true)
})

test('isInPeriod odrzuca śmieciowe daty zamiast rzucać', () => {
  const p: Period = { kind: 'quarter', year: 2026, index: 1 }
  assert.equal(isInPeriod('', p), false)
  assert.equal(isInPeriod('nie-data', p), false)
  assert.equal(isInPeriod('2026-13-01', p), false)
  assert.equal(isInPeriod('2026', p), false)
})

test('isInPeriod akceptuje klucz miesięczny YYYY-MM (koszty stałe)', () => {
  assert.equal(isInPeriod('2026-02', { kind: 'quarter', year: 2026, index: 1 }), true)
  assert.equal(isInPeriod('2026-02', { kind: 'month', year: 2026, index: 2 }), true)
})

test('summarizePeriod liczy tylko projekty zrealizowane, wyceny idą do pipeline', () => {
  const projects = [
    project('a', '2026-02-10', 'done', { sumaNetto: 20000, koszty: 6000, podatek: 1700, zysk: 12300 }),
    project('b', '2026-03-05', 'won', { sumaNetto: 10000, koszty: 3000, podatek: 850, zysk: 6150 }),
    project('c', '2026-03-20', 'quote', { sumaNetto: 50000, koszty: 0, podatek: 0, zysk: 0 }),
    project('d', '2026-03-25', 'lost', { sumaNetto: 99000, koszty: 0, podatek: 0, zysk: 0 }),
    // poza okresem
    project('e', '2026-07-01', 'done', { sumaNetto: 77000, koszty: 0, podatek: 0, zysk: 77000 }),
  ]
  const summary = summarizePeriod(projects, [], { kind: 'quarter', year: 2026, index: 1 })

  assert.equal(summary.projectCount, 2)
  assert.equal(summary.quoteCount, 1)
  assert.equal(summary.revenue, 30000)
  assert.equal(summary.productionCosts, 9000)
  assert.equal(summary.tax, 2550)
  assert.equal(summary.projectProfit, 18450)
  assert.equal(summary.pipelineValue, 50000, 'przegrana wycena nie wchodzi do pipeline')
})

test('summarizePeriod odejmuje koszty stałe od zysku projektów', () => {
  const projects = [
    project('a', '2026-01-10', 'done', { sumaNetto: 10000, koszty: 2000, podatek: 850, zysk: 7150 }),
  ]
  const costs = [
    cost('c1', '2026-01', 'zus', 1600),
    cost('c2', '2026-01', 'marketing', 500),
    cost('c3', '2026-01', 'other', 300),
    cost('c4', '2026-02', 'zus', 1600), // inny miesiąc — poza okresem
  ]
  const summary = summarizePeriod(projects, costs, { kind: 'month', year: 2026, index: 1 })

  assert.equal(summary.fixedCosts.zus, 1600)
  assert.equal(summary.fixedCosts.marketing, 500)
  assert.equal(summary.fixedCosts.other, 300)
  assert.equal(summary.fixedCosts.total, 2400)
  assert.equal(summary.netResult, 7150 - 2400)
})

test('summarizePeriod nie wywraca się na projekcie bez policzonych finansów', () => {
  const projects = [
    project('a', '2026-01-10', 'done', null),
    project('b', '2026-01-11', 'done', { sumaNetto: 5000, koszty: 1000, podatek: 425, zysk: 3575 }),
  ]
  const summary = summarizePeriod(projects, [], { kind: 'month', year: 2026, index: 1 })
  assert.equal(summary.projectCount, 2, 'projekt bez finansów nadal się liczy w sztukach')
  assert.equal(summary.revenue, 5000)
  assert.equal(summary.projectProfit, 3575)
})

test('marża jest zerowa przy zerowym przychodzie zamiast dzielić przez zero', () => {
  const summary = summarizePeriod([], [cost('c', '2026-01', 'zus', 1600)], {
    kind: 'month',
    year: 2026,
    index: 1,
  })
  assert.equal(summary.revenue, 0)
  assert.equal(summary.marginPct, 0)
  assert.equal(summary.netResult, -1600, 'sam ZUS bez projektów daje stratę')
})

test('summarizeFixedCosts sumuje wiele pozycji tego samego typu', () => {
  const costs = [
    cost('a', '2026-04', 'marketing', 1000),
    cost('b', '2026-04', 'marketing', 250),
    cost('c', '2026-04', 'zus', 1600),
  ]
  const out = summarizeFixedCosts(costs, { kind: 'month', year: 2026, index: 4 })
  assert.equal(out.marketing, 1250)
  assert.equal(out.total, 2850)
})

test('availablePeriods zwraca unikalne okresy malejąco', () => {
  const projects = [
    project('a', '2026-02-10', 'done', null),
    project('b', '2026-05-10', 'done', null),
    project('c', '2025-11-10', 'done', null),
  ]
  const costs = [cost('c1', '2026-02', 'zus', 1600)]

  const quarters = availablePeriods(projects, costs, 'quarter')
  assert.deepEqual(
    quarters.map((p) => periodLabel(p)),
    ['Q2 2026', 'Q1 2026', 'Q4 2025']
  )

  const years = availablePeriods(projects, costs, 'year')
  assert.deepEqual(years.map((p) => periodLabel(p)), ['2026', '2025'])
})

test('monthlyTrend i quarterlyTrend dają pełny, ciągły szereg', () => {
  const projects = [
    project('a', '2026-03-10', 'done', { sumaNetto: 1000, koszty: 0, podatek: 0, zysk: 1000 }),
  ]
  const months = monthlyTrend(projects, [], 2026)
  assert.equal(months.length, 12)
  assert.equal(months[2].revenue, 1000, 'marzec ma przychód')
  assert.equal(months[0].revenue, 0, 'styczeń jest pusty, ale obecny w szeregu')

  const quarters = quarterlyTrend(projects, [], 2026)
  assert.equal(quarters.length, 4)
  assert.equal(quarters[0].revenue, 1000)
})

test('fixedCostsByMonth grupuje po kluczu YYYY-MM', () => {
  const map = fixedCostsByMonth([
    cost('a', '2026-01', 'zus', 1600),
    cost('b', '2026-01', 'marketing', 400),
    cost('c', '2026-02', 'zus', 1600),
  ])
  assert.equal(map.get('2026-01')?.total, 2000)
  assert.equal(map.get('2026-02')?.total, 1600)
  assert.equal(map.size, 2)
})

test('periodLabel formatuje etykiety okresów', () => {
  assert.equal(periodLabel({ kind: 'year', year: 2026 }), '2026')
  assert.equal(periodLabel({ kind: 'half', year: 2026, index: 2 }), 'H2 2026')
  assert.equal(periodLabel({ kind: 'quarter', year: 2026, index: 3 }), 'Q3 2026')
  assert.equal(periodLabel({ kind: 'month', year: 2026, index: 7 }), '07.2026')
})
