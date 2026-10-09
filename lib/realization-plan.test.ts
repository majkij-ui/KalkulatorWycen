import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  actualFigures,
  compareByCategory,
  crewCostsFromPlan,
  isPlanUnsaved,
  planFromFinancials,
  planFromQuote,
  planLineCategory,
  plannedCrew,
  projectPlan,
} from './realization-plan'
import { computeSnapshotFinancials } from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import { createDefaultShootingDay, type QuoteData } from './quote-types'
import type { ProjectCost, ProjectFinancials } from './project-types'

const NOW = new Date('2026-10-09T12:00:00.000Z')

function detailedQuote(extra: Partial<QuoteData> = {}) {
  return {
    data: {
      isDetailedProdukcja: true,
      detailedShootingDays: [
        { ...createDefaultShootingDay(), id: 'q1', rezOp: 1, asystent: 2 },
        { ...createDefaultShootingDay(), id: 'q2', gafer: 1 },
      ],
      kosztDojazduKm: 100,
      includeCatering: true,
      ...extra,
    } as Partial<QuoteData>,
    pricingConfig: DEFAULT_PRICING,
    marginMultiplier: 1.5,
  }
}

const imported: ProjectFinancials = {
  sumaNetto: 2000,
  koszty: 0,
  podatek: 170,
  zysk: 1830,
  marzaPct: 91.5,
  computedAt: '',
}

test('plan z wyceny = te same liczby co Profit i finanse projektu', () => {
  const snapshot = detailedQuote({ profitTaxRatePercent: 12 })
  const plan = planFromQuote(snapshot)!
  const fin = computeSnapshotFinancials(snapshot, NOW)!
  assert.equal(plan.source, 'quote')
  assert.equal(plan.revenue, fin.sumaNetto)
  assert.equal(plan.costs, fin.koszty)
  assert.equal(plan.tax, fin.podatek)
  assert.equal(plan.profit, fin.zysk)
  assert.equal(plan.taxRatePercent, 12)
  const byCat = [...plan.byCategory!.values()].reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(byCat - plan.costs) < 1e-9, 'kategorie sumują się do kosztów planu')
  assert.equal(planFromQuote(null), null)
})

test('pozycje planu trafiają do kategorii kosztów rzeczywistych', () => {
  const cat = (key: string, section = 'produkcja', isCustom = false) =>
    planLineCategory({ key, section: section as never, isCustom })
  assert.equal(cat('pro:day-1:gafer'), 'ekipa')
  assert.equal(cat('pro:quick:ekipa'), 'ekipa')
  assert.equal(cat('pro:rentalSprzetu'), 'wynajem')
  assert.equal(cat('log:dojazd', 'logistyka'), 'dojazd')
  assert.equal(cat('log:catering', 'logistyka'), 'catering')
  assert.equal(cat('log:noclegi', 'logistyka'), 'nocleg')
  assert.equal(cat('pre:scenariusz', 'preprodukcja'), 'preprodukcja')
  assert.equal(cat('post:d1:format', 'postprodukcja'), 'postprodukcja')
  assert.equal(cat('custom:x', 'postprodukcja', true), 'postprodukcja')
  assert.equal(cat('custom:y', 'produkcja', true), 'inne')
})

test('retro-import bez wyceny: planem jest zaimportowany wynik, stawka ryczałtu z kwot', () => {
  const plan = planFromFinancials(imported)
  assert.equal(plan.source, 'import')
  assert.equal(plan.revenue, 2000)
  assert.equal(plan.taxRatePercent, 8.5)
  assert.equal(plan.byCategory, null)

  const blankLive = { data: { clientName: 'Tchibo' }, pricingConfig: DEFAULT_PRICING, marginMultiplier: 1 }
  assert.equal(projectPlan({ quote: null, financials: imported }, blankLive).source, 'import')
  assert.equal(projectPlan({ quote: null, financials: null }, blankLive).source, 'none')
  const building = { ...blankLive, data: { dniDokumentacji: 1 } }
  assert.equal(projectPlan({ quote: null, financials: imported }, building).source, 'quote', 'wycena w budowie')
})

test('plan liczy się z kalkulatora na żywo, a różnica od zapisu wymaga „Zapisz"', () => {
  const saved = detailedQuote()
  const project = { quote: saved as never, financials: null }
  assert.equal(isPlanUnsaved(project, saved), false)

  const edited = detailedQuote({ profitTransferAmount: 9999 })
  assert.equal(projectPlan(project, edited).revenue, 9999)
  assert.equal(isPlanUnsaved(project, edited), true)
  assert.equal(projectPlan(project, null).revenue, planFromQuote(saved)!.revenue, 'bez kalkulatora — z zapisu')

  const blank = { data: {}, pricingConfig: DEFAULT_PRICING, marginMultiplier: 1 }
  assert.equal(isPlanUnsaved({ quote: null }, blank), false)
  assert.equal(isPlanUnsaved({ quote: null }, { ...blank, data: { dniDokumentacji: 1 } }), true)
})

test('rzeczywistość: ten sam przychód i ryczałt, własne koszty', () => {
  const plan = planFromFinancials(imported)
  const costs: ProjectCost[] = [
    { id: 'a', category: 'ekipa', unitCost: 500, quantity: 1 },
    { id: 'b', category: 'dojazd', unitCost: 100 },
    { id: 'c', category: 'wynajem', unitCost: 999, deletedAt: 'T1' },
  ]
  const actual = actualFigures(plan, costs)
  assert.equal(actual.revenue, 2000)
  assert.equal(actual.tax, 170)
  assert.equal(actual.costs, 600)
  assert.equal(actual.profit, 1230)
  assert.equal(actual.marginPct, 61.5)
  assert.equal(actual.costCount, 2)
  assert.equal(actualFigures(plan, undefined).costCount, 0)
  assert.equal(actualFigures({ ...plan, revenue: 0, tax: 0 }, costs).marginPct, 0, 'bez przychodu nie dzielimy przez 0')

  assert.deepEqual(compareByCategory(plan, actual), [
    { category: 'ekipa', plan: null, actual: 500 },
    { category: 'dojazd', plan: null, actual: 100 },
  ])
})

test('porównanie w kategoriach łączy plan z wyceny i rzeczywiste koszty', () => {
  const plan = planFromQuote(detailedQuote())!
  const actual = actualFigures(plan, [{ id: 'x', category: 'sprzet', unitCost: 300 }])
  const rows = compareByCategory(plan, actual)
  assert.deepEqual(rows.map((r) => r.category), ['ekipa', 'dojazd', 'catering', 'sprzet'])
  assert.equal(rows.find((r) => r.category === 'sprzet')!.plan, 0)
  assert.equal(rows.find((r) => r.category === 'ekipa')!.actual, 0)
})

test('ekipa z planu: szczegółowa wycena, bez osób „robię sam"', () => {
  const snapshot = detailedQuote({ profitOverrides: { 'pro:q1:rezOp': { isCost: false } } })
  const crew = plannedCrew(snapshot)
  assert.deepEqual(
    crew.map((m) => [m.quoteDay, m.role, m.unitCost]),
    [
      [0, 'Asystent/Operator', DEFAULT_PRICING.produkcja.asystentOperator],
      [0, 'Asystent/Operator', DEFAULT_PRICING.produkcja.asystentOperator],
      [1, 'Gafer', DEFAULT_PRICING.produkcja.gafer],
    ]
  )
  const renamed = plannedCrew(
    detailedQuote({
      detailedShootingDays: [{ ...createDefaultShootingDay(), id: 'q1', gafer: 1, crewNames: { gafer: 'Oświetleniowiec' } }],
      profitOverrides: { 'pro:q1:gafer': { unitCost: 1234 } },
    })
  )
  assert.deepEqual(renamed, [{ quoteDay: 0, role: 'Oświetleniowiec', unitCost: 1234 }])
})

test('ekipa z planu: szybka wycena daje wielkość ekipy na każdy dzień', () => {
  const crew = plannedCrew({ data: { dniZdjeciowe: 2, wielkoscEkipy: 3 }, pricingConfig: DEFAULT_PRICING })
  assert.equal(crew.length, 3)
  assert.ok(crew.every((m) => m.quoteDay === null && m.unitCost === DEFAULT_PRICING.produkcja.stawkaOperatoraSzybkaWycena))
  assert.deepEqual(plannedCrew({ data: { dniZdjeciowe: 0 } }), [])
  assert.deepEqual(plannedCrew(null), [])
})

test('przepisz ekipę z planu: dzień N wyceny → N-ty dzień zdjęciowy, dni z ekipą nietknięte', () => {
  const plan = plannedCrew(detailedQuote())
  const days = [
    { id: 'prep', kind: 'prep_day' },
    { id: 'd1', kind: 'shoot_day' },
    { id: 'd2', kind: 'shoot_day' },
  ]
  const result = crewCostsFromPlan(plan, days, [], NOW)
  assert.equal(result.added, 4, 'ReżOp + 2 asystentów w d1, gafer w d2')
  assert.deepEqual(
    result.costs.map((c) => [c.dayId, c.role, c.category, c.source, c.person]),
    [
      ['d1', 'ReżOp', 'ekipa', 'plan', ''],
      ['d1', 'Asystent/Operator', 'ekipa', 'plan', ''],
      ['d1', 'Asystent/Operator', 'ekipa', 'plan', ''],
      ['d2', 'Gafer', 'ekipa', 'plan', ''],
    ]
  )

  const existing: ProjectCost[] = [{ id: 'ola', category: 'ekipa', person: 'Ola', unitCost: 800, dayId: 'd1' }]
  const second = crewCostsFromPlan(plan, days.slice(0, 2), existing, NOW)
  assert.equal(second.added, 0, 'd1 ma już ekipę')
  assert.equal(second.keptDays, 1)
  assert.equal(second.missingDays, 1, 'drugi dzień wyceny nie ma dnia zdjęciowego')
  assert.equal(second.costs.length, 1)
})
