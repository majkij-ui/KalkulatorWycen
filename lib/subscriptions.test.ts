/**
 * Raty subskrypcji (S1, decyzja C) — przypadki z życia, każdy osobno.
 * Tabela przypadków: docs/PLAN-AFTER-TEST-DRIVE.md §5.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixedCostsByMonth, summarizeFixedCosts, type Period } from './finance-calc'
import { moneyLedger, moneyTrend, summarizeMoney, type MoneyProject } from './money-loop'
import type { FixedCost } from './project-types'
import { subscriptionSchema, type Subscription } from './subscription-types'
import {
  addMonths,
  changesPrice,
  chargeInMonth,
  effectiveFixedCosts,
  fixedCostsInYear,
  monthlyValue,
  pastChargesToKeep,
  possibleDoubles,
  subscriptionCharges,
  subscriptionCorrection,
  subscriptionProblem,
  subscriptionStatus,
  totalsBySubscription,
  withoutSubscriptions,
  yearlyValue,
  type EffectiveFixedCost,
} from './subscriptions'

const YEAR_2026: Period = { kind: 'year', year: 2026 }

const sub = (extra: Record<string, unknown> = {}): Subscription =>
  subscriptionSchema.parse({
    id: 's-zus',
    name: 'ZUS',
    category: 'zus',
    amount: 1417.14,
    currency: 'PLN',
    cadence: 'monthly',
    startDate: '2026-01-01',
    ...extra,
  })

let seq = 0
const cost = (month: string, amount: number, extra: Partial<FixedCost> = {}): FixedCost => ({
  id: `f${++seq}`,
  month,
  type: 'other',
  label: '',
  amount,
  source: 'manual',
  ...extra,
})

const months = (costs: { month: string }[]) => costs.map((c) => c.month)
const near = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.001, `${message ?? ''} ${actual} ≠ ${expected}`)
const total = (costs: FixedCost[]) => costs.reduce((s, c) => s + c.amount, 0)
const inMonth = (costs: EffectiveFixedCost[], month: string) => costs.filter((c) => c.month === month)

// ── Raty ─────────────────────────────────────────────────────────────────────

test('1. co miesiąc w PLN: rata w każdym miesiącu od startu, tego samego dnia', () => {
  const zus = sub({ startDate: '2026-10-01' })
  const charges = subscriptionCharges(zus, '2026-01', '2026-12')
  assert.deepEqual(months(charges), ['2026-10', '2026-11', '2026-12'])
  assert.deepEqual(
    charges.map((c) => c.day),
    ['2026-10-01', '2026-11-01', '2026-12-01']
  )
  charges.forEach((c) => assert.equal(c.amount, 1417.14))
  assert.equal(subscriptionCharges(zus, '2027-01', '2027-12').length, 12, 'bez końca — trwa dalej')
})

test('2. co rok: jedna rata w miesiącu rocznicy', () => {
  const artlist = sub({ id: 's-artlist', name: 'Artlist', category: 'software', amount: 2611.51, cadence: 'yearly', startDate: '2026-06-15' })
  assert.deepEqual(
    subscriptionCharges(artlist, '2026-01', '2027-12').map((c) => c.day),
    ['2026-06-15', '2027-06-15']
  )
  assert.equal(chargeInMonth(artlist, '2026-07'), null)
})

test('3. co N miesięcy: kwartalnie od lutego; zakres w środku cyklu', () => {
  const insurance = sub({ cadence: 'custom', everyMonths: 3, startDate: '2026-02-10', amount: 600 })
  assert.deepEqual(months(subscriptionCharges(insurance, '2026-01', '2026-12')), ['2026-02', '2026-05', '2026-08', '2026-11'])
  assert.deepEqual(months(subscriptionCharges(insurance, '2026-06', '2026-12')), ['2026-08', '2026-11'])
  assert.deepEqual(months(subscriptionCharges(insurance, '2026-06', '2026-07')), [])
})

test('4. waluta obca: kwota × kurs subskrypcji, w groszach', () => {
  const claude = sub({ currency: 'USD', amount: 20, rate: 4.05, category: 'software' })
  const [charge] = subscriptionCharges(claude, '2026-03', '2026-03')
  assert.equal(charge.amount, 81)
  assert.equal(charge.originalAmount, 20)
  assert.equal(charge.currency, 'USD')
  assert.equal(subscriptionCharges(sub({ currency: 'EUR', amount: 12.99, rate: 4.0512 }), '2026-03', '2026-03')[0].amount, 52.63)
})

test('5. waluta bez kursu, nieznany cykl, brak startu: nie liczy się i mówi dlaczego (nigdy 0 zł)', () => {
  const noRate = sub({ currency: 'EUR', amount: 10 })
  assert.equal(subscriptionProblem(noRate), 'rate')
  assert.deepEqual(subscriptionCharges(noRate, '2026-01', '2026-12'), [])
  assert.equal(monthlyValue(noRate), null)
  assert.equal(subscriptionProblem(sub({ cadence: 'weekly' })), 'cadence', 'cykl z nowszej wersji')
  assert.equal(subscriptionProblem(sub({ cadence: 'custom' })), 'cadence', 'co N bez N')
  assert.equal(subscriptionProblem(sub({ startDate: '01.10.2026' })), 'start')
  assert.equal(subscriptionProblem({ ...sub(), startDate: '2026-10' }), 'start', 'szkic z formularza, bez schematu')
  assert.equal(subscriptionProblem(sub({ currency: 'GBP', rate: 5.2 })), null, 'inna waluta z kursem się liczy')
  assert.equal(subscriptionProblem(sub()), null)
})

test('6. start 31.: w krótszym miesiącu rata w jego ostatni dzień (luty, kwiecień, rok przestępny)', () => {
  const s = sub({ startDate: '2026-01-31' })
  assert.deepEqual(
    subscriptionCharges(s, '2026-01', '2026-04').map((c) => c.day),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']
  )
  assert.equal(chargeInMonth(s, '2028-02')?.day, '2028-02-29')
})

test('7. koniec (endDate): ostatnia rata to ta, której dzień ≤ końca', () => {
  const s = sub({ startDate: '2026-01-20' })
  assert.deepEqual(months(subscriptionCharges({ ...s, endDate: '2026-05-10' }, '2026-01', '2026-12')), [
    '2026-01', '2026-02', '2026-03', '2026-04',
  ])
  assert.equal(subscriptionCharges({ ...s, endDate: '2026-05-20' }, '2026-01', '2026-12').length, 5)
  assert.deepEqual(subscriptionCharges({ ...s, endDate: '2025-12-31' }, '2026-01', '2026-12'), [], 'koniec przed startem')
})

test('8. poprawiony miesiąc (zapłacono inaczej): liczy się tylko poprawka', () => {
  const zus = sub()
  const march = subscriptionCorrection(zus, '2026-03', 1312.39)
  const costs = fixedCostsInYear([march], [zus], 2026)
  assert.equal(inMonth(costs, '2026-03').length, 1)
  assert.equal(inMonth(costs, '2026-03')[0].amount, 1312.39)
  assert.equal(inMonth(costs, '2026-03')[0].derived, undefined)
  near(total(costs), 11 * 1417.14 + 1312.39)
})

test('9. pominięty miesiąc (pauza): poprawka 0 zł, reszta miesięcy automatycznie', () => {
  const zus = sub()
  const costs = fixedCostsInYear([subscriptionCorrection(zus, '2026-04', 0)], [zus], 2026)
  assert.equal(summarizeFixedCosts(costs, { kind: 'month', year: 2026, index: 4 }).total, 0)
  near(total(costs), 11 * 1417.14)
})

test('10. usunięta poprawka: wraca rata automatyczna', () => {
  const zus = sub()
  const removed = { ...subscriptionCorrection(zus, '2026-04', 0), deletedAt: '2026-10-13T10:00:00.000Z' }
  const april = inMonth(fixedCostsInYear([removed], [zus], 2026), '2026-04')
  assert.equal(april.length, 1)
  assert.equal(april[0].amount, 1417.14)
  assert.ok(april[0].derived)
})

test('11. dwie poprawki tego samego miesiąca: obie to fakty, rata wyliczona nie dochodzi', () => {
  const zus = sub()
  const costs = fixedCostsInYear(
    [subscriptionCorrection(zus, '2026-01', 1417.14), subscriptionCorrection(zus, '2026-01', 840.15)],
    [zus],
    2026
  )
  assert.equal(inMonth(costs, '2026-01').length, 2)
  near(summarizeFixedCosts(costs, { kind: 'month', year: 2026, index: 1 }).total, 2257.29)
})

test('12. poprawka poza miesiącem raty (dopłata do rocznej): liczy się sama, rata roczna zostaje', () => {
  const artlist = sub({ id: 's-artlist', name: 'Artlist', category: 'software', amount: 2611.51, cadence: 'yearly', startDate: '2026-06-15' })
  const extra = subscriptionCorrection(artlist, '2026-09', 120)
  const costs = fixedCostsInYear([extra], [artlist], 2026)
  assert.deepEqual(months(costs).sort(), ['2026-06', '2026-09'])
  near(total(costs), 2731.51)
})

test('13. usunięta subskrypcja: raty znikają, poprawki (prawdziwe płatności) zostają', () => {
  const zus = { ...sub(), deletedAt: '2026-10-13T10:00:00.000Z' }
  const costs = fixedCostsInYear([subscriptionCorrection(zus, '2026-02', 1417.14)], [zus], 2026)
  assert.deepEqual(months(costs), ['2026-02'])
  assert.deepEqual(subscriptionCharges(zus, '2026-01', '2026-12'), [], 'także poza Finansami (podpowiedzi, „auto")')
  assert.equal(chargeInMonth(zus, '2026-03'), null)
})

test('14. ręczne pozycje bez subskrypcji zostają; ostrzeżenie przed podwójnym liczeniem', () => {
  const adobe = sub({ id: 's-adobe', name: 'Adobe', category: 'software', amount: 250, startDate: '2026-08-05' })
  const sameCategory = cost('2026-08', 600, { category: 'software', label: 'Oprogramowanie' })
  const legacyBucket = cost('2026-09', 570, { label: 'Oprogramowanie (do 20.09)' })
  const byName = cost('2026-09', 250, { label: 'Adobe CC' })
  const beforeStart = cost('2026-07', 250, { label: 'Adobe CC' })
  const linked = subscriptionCorrection(adobe, '2026-09', 250)
  const deleted = { ...cost('2026-08', 250, { label: 'Adobe' }), deletedAt: 'x' }
  const all = [sameCategory, legacyBucket, byName, beforeStart, linked, deleted]

  assert.deepEqual(
    possibleDoubles(adobe, all).map((c) => c.id),
    [sameCategory.id, byName.id]
  )
  const effective = effectiveFixedCosts(all, [adobe], '2026-07', '2026-12')
  assert.equal(effective.filter((c) => !c.derived).length, 5, 'ręczne zostają, usunięta nie')
  assert.deepEqual(months(effective.filter((c) => c.derived)), ['2026-08', '2026-10', '2026-11', '2026-12'])
  assert.deepEqual(possibleDoubles(sub({ name: 'Bank', category: 'other' }), [cost('2026-02', 10, { label: 'Inne' })]), [])
  assert.deepEqual(
    possibleDoubles(sub({ name: 'TV', category: 'other' }), [cost('2026-02', 60, { label: 'Opłata za TVN Player' })]),
    [],
    'krótka nazwa nie łapie przypadkowych opisów'
  )
})

test('15. nowa cena od teraz: minione miesiące zostają po starej, od bieżącego nowa', () => {
  const before = sub({ id: 's-adobe', name: 'Adobe', category: 'software', amount: 100, startDate: '2026-07-05' })
  const august = subscriptionCorrection(before, '2026-08', 95)
  const keep = pastChargesToKeep(before, [august], '2026-10')
  assert.deepEqual(months(keep), ['2026-07', '2026-09'], 'sierpień już poprawiony, październik to bieżący')
  keep.forEach((c) => assert.equal(c.amount, 100))

  const after = { ...before, amount: 120 }
  assert.equal(changesPrice(before, after), true)
  const costs = fixedCostsInYear([august, ...keep], [after], 2026)
  assert.deepEqual(
    ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map((m) => inMonth(costs, m)[0].amount),
    [100, 95, 100, 120, 120, 120]
  )
  assert.deepEqual(pastChargesToKeep(sub({ startDate: '2026-10-01' }), [], '2026-10'), [], 'start w bieżącym miesiącu')
})

test('15b. zmiana nazwy, notatki, końca czy startu to nie nowa cena; poprawka ceny bez „od teraz" zmienia wszystkie miesiące', () => {
  const s = sub()
  assert.equal(changesPrice(s, { ...s, name: 'ZUS społeczny', notes: 'x' }), false)
  assert.equal(changesPrice(s, { ...s, endDate: '2026-12-31' }), false)
  assert.equal(changesPrice(s, { ...s, startDate: '2026-01-15' }), false, 'poprawka startu')
  assert.equal(changesPrice(s, { ...s, rate: 4 }), false, 'kurs nie dotyczy PLN')
  assert.equal(changesPrice(s, { ...s, currency: 'EUR', amount: 1417.14, rate: 1 }), false, 'ta sama kwota w złotych')
  assert.equal(changesPrice(s, { ...s, cadence: 'yearly' }), true)
  assert.equal(changesPrice(s, { ...s, amount: 1500 }), true)
  const fixed = { ...s, amount: 1500 }
  assert.ok(fixedCostsInYear([], [fixed], 2026).every((c) => c.amount === 1500))
})

test('16. „co jeśli": bez subskrypcji znikają jej raty i poprawki, reszta zostaje', () => {
  const zus = sub()
  const artlist = sub({ id: 's-artlist', name: 'Artlist', category: 'software', amount: 2611.51, cadence: 'yearly', startDate: '2026-06-15' })
  const other = cost('2026-03', 4274.23, { label: 'Sprzęt' })
  const costs = fixedCostsInYear([other, subscriptionCorrection(artlist, '2026-06', 2600)], [zus, artlist], 2026)
  const without = withoutSubscriptions(costs, new Set(['s-artlist']))
  near(total(costs) - total(without), 2600)
  assert.ok(without.includes(other))
  assert.equal(withoutSubscriptions(costs, new Set()), costs)
})

test('17. przełom roku: subskrypcja z 2025 liczy się w 2026', () => {
  assert.equal(fixedCostsInYear([], [sub({ startDate: '2025-12-15' })], 2026).length, 12)
  assert.deepEqual(months(fixedCostsInYear([], [sub({ cadence: 'yearly', startDate: '2025-11-03' })], 2026)), ['2026-11'])
  assert.deepEqual(fixedCostsInYear([], [sub({ startDate: '2027-01-01' })], 2026), [])
})

test('18. poprawka liczy się w kategorii swojej subskrypcji (zmiana kategorii nie zostawia starych miesięcy)', () => {
  const fpd = sub({ id: 's-fpd', name: 'FPD', category: 'office', amount: 455.1 })
  const stored = { ...subscriptionCorrection({ ...fpd, category: 'software' }, '2026-03', 910.2) }
  assert.equal(stored.category, 'software')
  const [march] = inMonth(fixedCostsInYear([stored], [fpd], 2026), '2026-03')
  assert.equal(march.category, 'office')
  assert.equal(march.type, 'other')
  assert.equal(summarizeFixedCosts(fixedCostsInYear([stored], [fpd], 2026), YEAR_2026).byCategory.software, undefined)
  const orphan = inMonth(fixedCostsInYear([stored], [], 2026), '2026-03')[0]
  assert.equal(orphan.category, 'software', 'bez subskrypcji — tak, jak zapisano')
  const deleted = { ...fpd, deletedAt: '2026-10-13T10:00:00.000Z' }
  assert.equal(inMonth(fixedCostsInYear([stored], [deleted], 2026), '2026-03')[0].category, 'software', 'usunięta też')
})

test('19. Finanse: wynik firmy, wykres i kafle liczą raty; miesiące sumują się do roku', () => {
  const projects: MoneyProject[] = [
    {
      id: 'p',
      status: 'done',
      date: '2026-05-05',
      financials: { sumaNetto: 20_000, koszty: 5_000, podatek: 1_700, zysk: 13_300, marzaPct: 66.5, computedAt: '' },
    },
  ]
  const ledger = moneyLedger(projects, [], '2026-10-13')
  const zus = sub()
  const artlist = sub({ id: 's-artlist', name: 'Artlist', category: 'software', amount: 2611.51, cadence: 'yearly', startDate: '2026-06-15' })
  const manual = [cost('2026-03', 4274.23, { label: 'Sprzęt' }), subscriptionCorrection(zus, '2026-01', 2257.29)]
  const fixed = fixedCostsInYear(manual, [zus, artlist], 2026)

  const year = summarizeMoney(ledger, fixed, YEAR_2026)
  const expected = 2257.29 + 11 * 1417.14 + 2611.51 + 4274.23
  near(year.fixedCosts.total, expected)
  near(year.fixedCosts.zus, 2257.29 + 11 * 1417.14)
  near(year.fixedCosts.byCategory.software ?? 0, 2611.51)
  near(year.fixedCosts.byCategory.other ?? 0, 4274.23)
  near(year.fixedCosts.subscriptions, expected - 4274.23)
  near(year.fixedCosts.derived, 11 * 1417.14 + 2611.51)
  near(year.netResult, 20_000 - 1_700 - 5_000 - expected)

  const trend = moneyTrend(ledger, fixed, 2026)
  near(trend.reduce((s, m) => s + m.fixedCosts.total, 0), expected)
  near(trend[5].fixedCosts.total, 1417.14 + 2611.51, 'czerwiec: ZUS + Artlist')
  near(fixedCostsByMonth(fixed).get('2026-06')?.total ?? 0, 1417.14 + 2611.51)
})

test('20. wartość na miesiąc i na rok — do porównań subskrypcji', () => {
  near(monthlyValue(sub()), 1417.14)
  near(yearlyValue(sub()), 17_005.68)
  near(monthlyValue(sub({ amount: 2611.51, cadence: 'yearly' })), 217.625833)
  near(yearlyValue(sub({ amount: 2611.51, cadence: 'yearly' })), 2611.51)
  near(yearlyValue(sub({ amount: 600, cadence: 'custom', everyMonths: 3 })), 2400)
  near(yearlyValue(sub({ currency: 'USD', amount: 20, rate: 4.05 })), 972)
})

test('21. stan: zaplanowana / trwa / zakończona', () => {
  assert.equal(subscriptionStatus(sub({ startDate: '2026-11-01' }), '2026-10-13'), 'planned')
  assert.equal(subscriptionStatus(sub(), '2026-10-13'), 'active')
  assert.equal(subscriptionStatus(sub({ endDate: '2026-10-13' }), '2026-10-13'), 'active', 'kończy się dziś')
  assert.equal(subscriptionStatus(sub({ endDate: '2026-09-30' }), '2026-10-13'), 'ended')
})

test('22. sumy po subskrypcjach (raty + poprawki); usunięte i ręczne bez subskrypcji pomija', () => {
  const zus = sub()
  const costs = [
    ...fixedCostsInYear([subscriptionCorrection(zus, '2026-01', 2257.29)], [zus], 2026),
    cost('2026-02', 99),
    { ...subscriptionCorrection(zus, '2026-02', 5), deletedAt: 'x' },
  ]
  near(totalsBySubscription(costs).get('s-zus') ?? 0, 2257.29 + 11 * 1417.14)
  assert.equal(totalsBySubscription(costs).size, 1)
})

test('23. zakres: ręczne spoza miesięcy nie wchodzą; usunięte nigdy', () => {
  const costs = effectiveFixedCosts(
    [cost('2025-12', 1), cost('2026-03', 2), cost('2027-01', 3), { ...cost('2026-04', 4), deletedAt: 'x' }],
    [],
    '2026-01',
    '2026-12'
  )
  assert.deepEqual(months(costs), ['2026-03'])
  assert.deepEqual(effectiveFixedCosts([], [sub()], '2026-05', '2026-02'), [], 'odwrócony zakres')
})

test('24. schemat subskrypcji: nieznane pola i wartości z nowszej wersji przeżywają; złe dane nie psują rekordu', () => {
  const raw = {
    id: 's-1',
    name: 'Frame.io',
    category: 'cloud',
    amount: 15,
    currency: 'GBP',
    rate: 5.3,
    cadence: 'weekly',
    startDate: '2026-01-01',
    futureField: { a: 1 },
  }
  assert.deepEqual(subscriptionSchema.parse(raw), raw)
  const broken = subscriptionSchema.parse({ id: 's-2', amount: -5, startDate: 'jutro', rate: 0, everyMonths: 2.5 })
  assert.equal(broken.amount, 0)
  assert.equal(broken.startDate, '')
  assert.equal(broken.rate, undefined)
  assert.equal(broken.everyMonths, undefined)
  assert.equal(broken.currency, 'PLN')
  assert.equal(broken.cadence, 'monthly')
  assert.equal(broken.category, 'other')
})

test('25. addMonths przez granicę roku', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.equal(addMonths('2026-10', -10), '2025-12')
  assert.equal(addMonths('zły', 1), 'zły')
})
