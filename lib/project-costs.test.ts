import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  actualCostsByCategory,
  addCost,
  copyCrewToDays,
  costAmount,
  costsOfDay,
  crewSuggestions,
  personKey,
  projectLevelCosts,
  restoreCosts,
  softDeleteCost,
  softDeleteDayCosts,
  totalActualCosts,
  updateCost,
} from './project-costs'
import { projectCostSchema, projectSchema, type Project, type ProjectCost } from './project-types'

const NOW = new Date('2026-10-09T12:00:00.000Z')

function cost(id: string, extra: Partial<ProjectCost> = {}): ProjectCost {
  return { id, category: 'inne', unitCost: 0, ...extra }
}

function crew(id: string, person: string, unitCost: number, dayId?: string, role = ''): ProjectCost {
  return cost(id, { category: 'ekipa', person, role, quantity: 1, unitCost, dayId })
}

test('kwota = ilość × stawka; brak ilości = 1, śmieci = 0', () => {
  assert.equal(costAmount({ quantity: 3, unitCost: 250 }), 750)
  assert.equal(costAmount({ unitCost: 400 }), 400)
  assert.equal(costAmount({ quantity: Number.NaN, unitCost: 100 }), 100)
  assert.equal(costAmount({ quantity: 2, unitCost: -5 }), 0)
})

test('suma i podział na kategorie pomijają usunięte pozycje', () => {
  const costs = [
    crew('a', 'Ola', 800, 'd1'),
    crew('b', 'Kuba', 600, 'd1'),
    cost('c', { category: 'dojazd', unitCost: 120 }),
    cost('d', { category: 'wynajem', unitCost: 1000, deletedAt: 'T1' }),
    cost('e', { category: 'własna', unitCost: 50 }),
  ]
  assert.equal(totalActualCosts(costs), 1570)
  assert.deepEqual([...actualCostsByCategory(costs).entries()], [
    ['ekipa', 1400],
    ['dojazd', 120],
    ['własna', 50],
  ])
  assert.equal(totalActualCosts(undefined), 0)
})

test('koszty dnia i koszty całego projektu (także z dniem, którego już nie ma)', () => {
  const costs = [crew('a', 'Ola', 800, 'd1'), cost('b', { unitCost: 10 }), cost('c', { unitCost: 5, dayId: 'gone' })]
  assert.deepEqual(costsOfDay(costs, 'd1').map((c) => c.id), ['a'])
  assert.deepEqual(projectLevelCosts(costs, ['d1']).map((c) => c.id), ['b', 'c'])
})

test('dodawanie i zmiana pozycji bez mutowania wejścia', () => {
  const start: ProjectCost[] = []
  const added = addCost(start, { category: 'catering', label: 'Obiad', unitCost: 300, dayId: 'd1' }, NOW)
  assert.equal(start.length, 0)
  assert.equal(added[0].quantity, 1)
  assert.equal(added[0].createdAt, NOW.toISOString())
  assert.match(added[0].id, /^pc-/)
  const changed = updateCost(added, added[0].id, { unitCost: 350 })
  assert.equal(added[0].unitCost, 300)
  assert.equal(changed[0].unitCost, 350)
})

test('usunięcie dnia oznacza jego koszty, „Cofnij" przywraca tylko te z tym znacznikiem', () => {
  const costs = [crew('a', 'Ola', 800, 'd1'), crew('b', 'Kuba', 600, 'd1'), cost('c', { dayId: 'd1', deletedAt: 'T0' })]
  const deleted = softDeleteDayCosts(costs, 'd1', 'T1')
  assert.deepEqual(deleted.map((c) => c.deletedAt), ['T1', 'T1', 'T0'], 'wcześniej usunięta zachowuje swój znacznik')
  const back = restoreCosts(deleted, 'T1')
  assert.deepEqual(back.map((c) => c.deletedAt), [undefined, undefined, 'T0'])
  assert.equal('deletedAt' in back[0], false)

  const one = softDeleteCost(costs, 'b', 'T2')
  assert.deepEqual(one.map((c) => c.deletedAt), [undefined, 'T2', 'T0'])
})

test('ta sama ekipa we wszystkich dniach: dopisuje brakujące osoby, nikogo nie dubluje', () => {
  const costs = [
    crew('a', 'Ola', 800, 'd1', 'Operator'),
    crew('b', 'Kuba', 600, 'd1', 'Gafer'),
    crew('c', 'ola ', 900, 'd2', 'operator'),
  ]
  const { costs: next, added } = copyCrewToDays(costs, 'd1', ['d1', 'd2', 'd3'], NOW)
  assert.equal(added, 3, 'd2: Kuba; d3: Ola i Kuba')
  assert.deepEqual(
    costsOfDay(next, 'd2').map((c) => [c.person, c.unitCost]),
    [
      ['ola ', 900],
      ['Kuba', 600],
    ],
    'Ola z d2 zachowuje swoją stawkę'
  )
  assert.deepEqual(costsOfDay(next, 'd3').map((c) => c.person), ['Ola', 'Kuba'])
})

test('podpowiedzi ekipy: ostatnia rola i stawka osoby, tylko z projektów w realizacji', () => {
  const p = (id: string, date: string, status: Project['status'], costs: ProjectCost[]) => ({ id, date, status, costs })
  const suggestions = crewSuggestions(
    [
      p('old', '2026-03-01', 'done', [crew('a', 'Ola Nowak', 700, 'd', 'Operator')]),
      p('new', '2026-09-01', 'won', [crew('b', 'ola nowak', 900, 'd', 'Operator B'), cost('x', { person: 'Nie ekipa' })]),
      p('lost', '2026-10-01', 'lost', [crew('c', 'Ola Nowak', 100, 'd')]),
      p('self', '2026-10-05', 'won', [crew('d', 'Kuba', 500, 'd')]),
    ],
    'self'
  )
  assert.deepEqual(suggestions, [{ person: 'ola nowak', role: 'Operator B', unitCost: 900 }])
  assert.equal(personKey(' Łukasz  Żak '), 'lukasz zak')
})

test('schemat kosztu: brakujące pola zostają brakujące, zły wpis znika, reszta listy zostaje', () => {
  const minimal = { id: 'c1', category: 'dojazd', unitCost: 120 }
  assert.deepEqual(projectCostSchema.parse(minimal), minimal, '`npm run data` nie uzna rekordu za poprawiony')

  const parsed = projectSchema.parse({
    id: 'p1',
    name: 'p',
    date: '2026-10-01',
    costs: [
      { id: 'ok', category: 'ekipa', unitCost: 800, person: 'Ola', dayId: 'd1', future: { x: 1 } },
      { category: 'bez id', unitCost: 1 },
      { id: 'bad', category: 'inne', unitCost: 'dużo' },
    ],
  })
  assert.equal(parsed.costs!.length, 2)
  assert.deepEqual(parsed.costs![0], { id: 'ok', category: 'ekipa', unitCost: 800, person: 'Ola', dayId: 'd1', future: { x: 1 } })
  assert.equal(parsed.costs![1].unitCost, 0)
  assert.equal(projectSchema.parse({ id: 'p', date: '2026-10-01' }).costs, undefined, 'brak pola = nic nie wpisano')
})
