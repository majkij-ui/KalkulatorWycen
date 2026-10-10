import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addKitCrewToQuote,
  createQuoteCrewLine,
  crewCostRate,
  dayCrewFigures,
  hasLegacyCrew,
  kitCrewDayCosts,
  kitCrewFromDayCosts,
  kitCrewFromLines,
  pdfCrewSentences,
  refreshCrewLines,
  staleCrewLines,
  withCrewPerson,
} from './quote-crew'
import { getBreakdownWithPricing, getProductionEkipaCastSprzetNetto } from './quote-calc'
import { crewLineKey, resolveProfitSections } from './profit-calc'
import { computeTotalCrewDays, computeQuoteTotals, mergeQuoteDataPartial } from './quote-financials'
import { crewCostsFromPlan, planLineCategory, plannedCrew } from './realization-plan'
import { DEFAULT_PRICING } from './pricing-config'
import { createGearKit } from './gear-kits'
import { gearKitSchema } from './project-types'
import { cloneShootingDay, createDefaultShootingDay, type QuoteCrewLine, type QuoteData, type ShootingDay } from './quote-types'

const OPERATOR = { id: 'cr-op', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1200, order: 10 }
const GAFFER = { id: 'gafer', name: 'Gafer', group: 'ekipa', clientRate: 1500, order: 30 }
const ACTOR = { id: 'aktor', name: 'Aktor', group: 'obsada', clientRate: 2500, costRate: 2000, order: 60 }
const EDITOR = { id: 'cr-ed', name: 'Montażysta', group: 'post', clientRate: 1000, order: 10 }
const LUKASZ = { id: 'cm-l', name: 'Łukasz', rate: 1000 }
const PIOTR = { id: 'cm-p', name: 'Piotrek', rate: undefined }

function line(role: typeof OPERATOR | typeof GAFFER | typeof ACTOR | typeof EDITOR, extra: Partial<QuoteCrewLine> = {}): QuoteCrewLine {
  return { ...createQuoteCrewLine(role), ...extra }
}

function day(extra: Partial<ShootingDay> = {}): ShootingDay {
  return { ...createDefaultShootingDay(), ...extra }
}

function quote(days: ShootingDay[], extra: Partial<QuoteData> = {}): QuoteData {
  return mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: days, ...extra })
}

test('mój koszt: stawka osoby, potem koszt roli, potem stawka roli', () => {
  assert.equal(crewCostRate(OPERATOR, LUKASZ), 1000)
  assert.equal(crewCostRate(OPERATOR, { rate: 0 }), 1200, 'stawka 0 = nieznana')
  assert.equal(crewCostRate(OPERATOR, PIOTR), 1200)
  assert.equal(crewCostRate(GAFFER, null), 1500, 'rola bez kosztu: jak dziś, stawka dla klienta')
  assert.equal(crewCostRate(null, null, 900), 900)
})

test('nowa pozycja zamraża nazwę, grupę i stawki; osoba = jedna osoba', () => {
  const placeholder = createQuoteCrewLine(OPERATOR, null, 2.7)
  assert.equal(placeholder.roleName, 'Operator')
  assert.equal(placeholder.group, 'ekipa')
  assert.equal(placeholder.clientRate, 1500)
  assert.equal(placeholder.costRate, 1200)
  assert.equal(placeholder.qty, 2)
  assert.equal('personId' in placeholder, false, 'miejsce do obsadzenia')

  const staffed = createQuoteCrewLine(OPERATOR, LUKASZ, 3)
  assert.equal(staffed.personName, 'Łukasz')
  assert.equal(staffed.costRate, 1000)
  assert.equal(staffed.qty, 1)
})

test('decyzja 7: osoba zmienia tylko mój koszt, nigdy cenę dla klienta', () => {
  const placeholder = createQuoteCrewLine(OPERATOR, null, 2)
  const staffed = withCrewPerson(placeholder, LUKASZ, OPERATOR)
  assert.equal(staffed.clientRate, 1500)
  assert.equal(staffed.costRate, 1000)
  assert.equal(staffed.qty, 1)
  const freed = withCrewPerson(staffed, null, OPERATOR)
  assert.equal(freed.costRate, 1200)
  assert.equal(freed.clientRate, 1500)
  assert.equal('personName' in freed, false)
})

test('cena dnia: stawka roli × osoby × marża; obsada w swoim wierszu, post w ekipie', () => {
  const pro = DEFAULT_PRICING.produkcja
  const d = day({
    rezOp: 1,
    crew: [line(OPERATOR, { qty: 2 }), line(ACTOR), line(EDITOR), line(GAFFER, { qty: 0 })],
  })
  const data = quote([d])
  const [, production] = getBreakdownWithPricing(data, 1.2, DEFAULT_PRICING)
  assert.equal(production.items[0].lineNetto, pro.rezOp * 1.2 + (3000 + 1000) * 1.2 + 2500 * 1.2)

  const split = getProductionEkipaCastSprzetNetto(data, 1.2, DEFAULT_PRICING)
  assert.equal(split.ekipaNetto, pro.rezOp * 1.2 + 4000 * 1.2)
  assert.equal(split.castNetto, 2500 * 1.2)
  assert.equal(split.ekipaNetto + split.castNetto + split.sprzetNetto, production.phaseNetto)
})

test('szybka wycena ignoruje ekipę z dni szczegółowych', () => {
  const data = quote([day({ crew: [line(OPERATOR)] })], { isDetailedProdukcja: false, dniZdjeciowe: 0 })
  const [, production] = getBreakdownWithPricing(data, 1, DEFAULT_PRICING)
  assert.equal(production.phaseNetto, 0)
})

test('osobodni z ekipy z bazy liczą się do cateringu jak liczniki', () => {
  const data = quote([day({ asystent: 1, crew: [line(OPERATOR, { qty: 2 }), line(ACTOR)] })], {
    includeCatering: true,
    cateringRate: 100,
  })
  assert.equal(computeTotalCrewDays(data), 4)
  assert.equal(computeQuoteTotals(data, 1, DEFAULT_PRICING).cateringCost, 400)
  assert.equal(dayCrewFigures(data.detailedShootingDays[0]).cost, 2400 + 2000)
})

test('plan: jedna pozycja kosztowa na pozycję ekipy, po moim koszcie, w kategorii „ekipa"', () => {
  const op = line(OPERATOR, { qty: 2 })
  const staffed = createQuoteCrewLine(GAFFER, LUKASZ)
  const d = day({ crew: [op, staffed] })
  const data = quote([d])
  const lines = resolveProfitSections(data, DEFAULT_PRICING, computeTotalCrewDays(data)).sections.flatMap((s) => s.lines)
  const crew = lines.filter((l) => l.key.includes(':crew:'))
  assert.deepEqual(
    crew.map((l) => [l.key, l.label, l.quantity, l.unitCost, l.isCost]),
    [
      [crewLineKey(d.id, op.id), 'Operator', 2, 1200, true],
      [crewLineKey(d.id, staffed.id), 'Gafer · Łukasz', 1, 1000, true],
    ]
  )
  assert.equal(planLineCategory(crew[0]), 'ekipa')
})

test('„Przepisz ekipę z planu" niesie osobę; miejsca do obsadzenia zostają puste', () => {
  const op = line(OPERATOR, { qty: 2 })
  const staffed = createQuoteCrewLine(GAFFER, LUKASZ)
  const skipped = line(ACTOR)
  const d1 = day({ id: 'qd-1', crew: [op, staffed, skipped] } as Partial<ShootingDay>)
  const d2 = day({ id: 'qd-2', rezOp: 1 } as Partial<ShootingDay>)
  const snapshot = {
    data: {
      ...quote([d1, d2]),
      profitOverrides: {
        [crewLineKey('qd-1', skipped.id)]: { isCost: false },
        [crewLineKey('qd-1', staffed.id)]: { unitCost: 1100 },
      },
    },
  }
  const plan = plannedCrew(snapshot)
  assert.deepEqual(
    plan.map((m) => [m.quoteDay, m.role, m.unitCost, m.personId ?? null, m.person ?? null]),
    [
      [0, 'Operator', 1200, null, null],
      [0, 'Operator', 1200, null, null],
      [0, 'Gafer', 1100, 'cm-l', 'Łukasz'],
      [1, 'ReżOp', DEFAULT_PRICING.produkcja.rezOp, null, null],
    ],
    'odznaczona obsada („nie mój koszt") nie trafia do ekipy; nadpisana stawka planu wygrywa'
  )

  const result = crewCostsFromPlan(
    plan,
    [
      { id: 'day-a', kind: 'shoot_day' },
      { id: 'day-b', kind: 'shoot_day' },
    ],
    [],
    new Date(0)
  )
  const rows = result.costs.map((c) => [c.dayId, c.role, c.person, c.personId ?? null, c.unitCost])
  assert.deepEqual(rows, [
    ['day-a', 'Operator', '', null, 1200],
    ['day-a', 'Operator', '', null, 1200],
    ['day-a', 'Gafer', 'Łukasz', 'cm-l', 1100],
    ['day-b', 'ReżOp', '', null, DEFAULT_PRICING.produkcja.rezOp],
  ])
})

test('zaktualizuj stawki: rola zmienia cenę i koszt, osoba tylko koszt, usunięta osoba zostaje zamrożona', () => {
  const placeholder = line(OPERATOR)
  const staffed = createQuoteCrewLine(GAFFER, LUKASZ)
  const gone = createQuoteCrewLine(GAFFER, { id: 'cm-x', name: 'Xavier', rate: 800 })
  const days = [day({ crew: [placeholder, staffed, gone] })]
  const roles = [{ ...OPERATOR, clientRate: 1800, costRate: 1300 }, GAFFER]
  const people = [{ ...LUKASZ, rate: 1100 }, { id: 'cm-x', name: 'Xavier', rate: 900, deletedAt: '2026-10-01' }]

  assert.equal(staleCrewLines(days, roles, people), 2)
  const refreshed = refreshCrewLines(days[0].crew, roles, people)!
  assert.deepEqual([refreshed[0].clientRate, refreshed[0].costRate], [1800, 1300])
  assert.deepEqual([refreshed[1].clientRate, refreshed[1].costRate], [1500, 1100])
  assert.deepEqual([refreshed[2].costRate, refreshed[2].personName], [800, 'Xavier'])
  assert.equal(staleCrewLines([{ crew: refreshed }], roles, people), 0)
  assert.equal(refreshCrewLines(undefined, roles, people), undefined)
})

test('zestaw z ekipą: dokłada brakujące role, osoba wycofana to miejsce do obsadzenia', () => {
  const roles = [OPERATOR, GAFFER, { ...EDITOR, retiredAt: '2026-01-01' }]
  const people = [LUKASZ, { id: 'cm-old', name: 'Stary', rate: 500, retiredAt: '2025-01-01' }]
  const existing = [createQuoteCrewLine(GAFFER, LUKASZ)]
  const next = addKitCrewToQuote(
    existing,
    [
      { roleId: 'gafer', personId: 'cm-l', qty: 1 },
      { roleId: 'cr-op', personId: 'cm-old', qty: 1 },
      { roleId: 'cr-op', qty: 2 },
      { roleId: 'cr-ed', qty: 1 },
      { roleId: 'nieznana', qty: 1 },
    ],
    roles,
    people
  )
  assert.deepEqual(
    next.map((l) => `${l.roleName}|${l.personName ?? '-'}|${l.qty}`),
    ['Gafer|Łukasz|1', 'Operator|-|1'],
    'Gafer z Łukaszem już był; drugi wpis operatora bez osoby to ta sama pozycja'
  )
  assert.deepEqual(kitCrewFromLines(next), [
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
    { roleId: 'cr-op', qty: 1 },
  ])
})

test('PDF: role z osobodniami, domyślnie bez imion', () => {
  const data = quote([
    day({ crew: [createQuoteCrewLine(OPERATOR, LUKASZ), line(OPERATOR), line(ACTOR, { qty: 2 })] }),
    day({ crew: [line(OPERATOR)] }),
  ])
  const labels = { opisPersonDays: 'osobodni' }
  assert.deepEqual(pdfCrewSentences(data, 'ekipa', labels), ['Operator: 3 osobodni.'])
  assert.deepEqual(pdfCrewSentences(data, 'obsada', labels), ['Aktor: 2 osobodni.'])
  assert.deepEqual(pdfCrewSentences(data, 'ekipa', labels, true), ['Operator: 3 osobodni (Łukasz).'])
  assert.deepEqual(pdfCrewSentences({ ...data, isDetailedProdukcja: false }, 'ekipa', labels), [])
})

test('stare liczniki wykrywane po liczbach; kopia dnia ma własne pozycje ekipy', () => {
  assert.equal(hasLegacyCrew(day()), false)
  assert.equal(hasLegacyCrew(day({ statysta: 2 })), true)
  assert.equal(hasLegacyCrew(day({ crew: [line(OPERATOR)], crewNames: { rezOp: 'Ja' } })), false)

  const source = day({ crew: [line(OPERATOR)] })
  const copy = cloneShootingDay(source)
  assert.notEqual(copy.crew![0].id, source.crew![0].id)
  copy.crew![0].qty = 9
  assert.equal(source.crew![0].qty, 1)
  assert.equal(mergeQuoteDataPartial({}).crewPeopleInPdf, false)
})

test('zestaw zapisuje ekipę dnia: ta sama rola sumuje osoby, osoba to jedna osoba', () => {
  const kit = createGearKit('Wywiad', [{ itemId: 'fx3', qty: 1 }], [
    { roleId: 'cr-op', qty: 1 },
    { roleId: 'cr-op', qty: 1 },
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
    { roleId: '', qty: 1 },
  ])
  assert.deepEqual(kit.crew, [
    { roleId: 'cr-op', qty: 2 },
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
  ])
  assert.equal('crew' in createGearKit('Sam sprzęt', [{ itemId: 'fx3', qty: 1 }]), false)
  const parsed = gearKitSchema.parse({ id: 'k', name: 'Stary', lines: [], createdAt: '' })
  assert.equal(parsed.crew, undefined, 'zestaw sprzed T9b czyta się bez ekipy')
  const lenient = gearKitSchema.parse({ id: 'k', name: 'x', lines: [], crew: [{ roleId: 'a', qty: 2 }, { qty: 1 }] })
  assert.deepEqual(lenient.crew, [{ roleId: 'a', qty: 2 }])
})

test('zestaw w Realizacji: wiersze ekipy dnia po moim koszcie, bez dublowania osoby', () => {
  const roles = [OPERATOR, GAFFER, { ...EDITOR, retiredAt: '2026-01-01' }]
  const people = [LUKASZ, { id: 'cm-gone', name: 'Usunięty', rate: 700, deletedAt: '2026-02-01' }]
  const dayCosts = [{ category: 'ekipa', role: 'Gafer', person: 'Łukasz', personId: 'cm-l' }]
  const rows = kitCrewDayCosts(
    [
      { roleId: 'gafer', personId: 'cm-l', qty: 1 },
      { roleId: 'cr-op', qty: 2 },
      { roleId: 'cr-op', personId: 'cm-gone', qty: 1 },
      { roleId: 'cr-ed', qty: 1 },
    ],
    'day-1',
    dayCosts,
    roles,
    people
  )
  assert.deepEqual(
    rows.map((r) => [r.role, r.person, r.personId ?? null, r.unitCost, r.dayId]),
    [
      ['Operator', '', null, 1200, 'day-1'],
      ['Operator', '', null, 1200, 'day-1'],
      ['Operator', '', null, 1200, 'day-1'],
    ],
    'Łukasz już jest; usunięty to miejsce do obsadzenia; wycofana rola pominięta'
  )

  const back = kitCrewFromDayCosts(
    [
      { category: 'ekipa', role: 'gafer', person: 'Łukasz', personId: 'cm-l' },
      { category: 'ekipa', role: 'Operator', person: '' },
      { category: 'ekipa', role: 'Kierowca', person: 'Ktoś' },
      { category: 'catering', role: undefined, person: undefined },
      { category: 'ekipa', role: 'Operator', person: '', deletedAt: '2026-01-01' },
    ],
    roles
  )
  assert.deepEqual(back, [
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
    { roleId: 'cr-op', qty: 1 },
  ])
})

test('plan podniósł liczbę obsadzonej pozycji: osoba tylko w pierwszej kopii', () => {
  const staffed = createQuoteCrewLine(GAFFER, LUKASZ)
  const d = day({ id: 'qd-1', crew: [staffed] } as Partial<ShootingDay>)
  const plan = plannedCrew({
    data: { ...quote([d]), profitOverrides: { [crewLineKey('qd-1', staffed.id)]: { quantity: 2 } } },
  })
  assert.deepEqual(
    plan.map((m) => [m.role, m.person ?? null]),
    [
      ['Gafer', 'Łukasz'],
      ['Gafer', null],
    ]
  )
})
