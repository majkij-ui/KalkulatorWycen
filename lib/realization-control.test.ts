import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costAmount, liveCosts, totalActualCosts } from './project-costs'
import type { ProjectCost } from './project-types'
import {
  applyPatch,
  applyQuoteChanges,
  editPatch,
  layoutRealization,
  quoteChanges,
  startFromQuote,
  type PlanRow,
} from './realization-costs'
import { canSplit, crewRowFromPerson, crewRowFromRole, quantityValue, splitCost, splitQuantities } from './realization-control'

const NOW = new Date('2026-11-05T10:00:00.000Z')
const row = (over: Partial<ProjectCost> = {}): ProjectCost => ({
  id: 'c1',
  createdAt: NOW.toISOString(),
  category: 'ekipa',
  person: 'Kamil',
  personId: 'cm-k',
  role: 'Operator',
  quantity: 10,
  unitCost: 1000,
  dayId: 'day-a',
  ...over,
})
const sum = (costs: ProjectCost[]) => costs.reduce((s, c) => s + costAmount(c), 0)

test('ilość: liczba ≥ 0 z ułamkiem, wiersz z planu liczy się jako edytowany, kwota idzie za ilością', () => {
  assert.equal(quantityValue(0.5), 0.5)
  assert.equal(quantityValue(-3), 0)
  assert.equal(quantityValue(NaN), 0)
  const c = row({ planKey: 'pro:quick:ekipa', quantity: 4 })
  const next = applyPatch(c, editPatch(c, { quantity: 0.5 }))
  assert.equal(next.edited, true)
  assert.equal(costAmount(next), 500)
})

test('Rozdziel: 10 × 1 000, 5 × 500, 2,5 × 400; suma stała, pola wierszy zachowane', () => {
  const a = splitCost([row()], 'c1', NOW)!
  assert.equal(a.length, 10)
  assert.ok(
    a.every(
      (c) =>
        c.quantity === 1 &&
        c.unitCost === 1000 &&
        c.role === 'Operator' &&
        c.person === 'Kamil' &&
        c.personId === 'cm-k' &&
        c.dayId === 'day-a' &&
        c.category === 'ekipa'
    )
  )
  assert.equal(new Set(a.map((c) => c.id)).size, 10)
  assert.equal(sum(a), 10000)
  assert.equal(splitCost([row({ quantity: 5, unitCost: 500, category: 'inne', label: 'Dopłata Reż-Op' })], 'c1', NOW)!.length, 5)
  const b = splitCost([row({ quantity: 2.5, unitCost: 400 })], 'c1', NOW)!
  assert.deepEqual(b.map((c) => c.quantity), [1, 1, 0.5])
  assert.equal(sum(b), 1000)
  assert.deepEqual(splitQuantities(3), [1, 1, 1])
})

test('Rozdziel jest ukryte dla ilości ≤ 1 i dla dojazdu', () => {
  assert.equal(canSplit(row({ quantity: 1 })), false)
  assert.equal(canSplit(row({ quantity: 0.5 })), false)
  assert.equal(canSplit(row({ category: 'dojazd', quantity: 2500, unitCost: 0.52 })), false)
  assert.equal(splitCost([row({ quantity: 1 })], 'c1', NOW), null)
})

test('wiersz startu od roli i od osoby (pierwsza rola i stawka; Ja = moja praca)', () => {
  const op = { id: 'op', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1200 }
  const sound = { id: 'snd', name: 'Dźwięk', group: 'ekipa', clientRate: 900, costRate: 800 }
  assert.deepEqual(crewRowFromRole(op as never), { category: 'ekipa', person: '', role: 'Operator', quantity: 1, unitCost: 1200 })
  const kamil = { id: 'cm-k', name: 'Kamil', rate: 1100, roleIds: ['snd', 'op'], roleRates: [{ roleId: 'snd', rate: 850 }] }
  const k = crewRowFromPerson(kamil as never, [op, sound] as never)
  assert.equal(k.role, 'Dźwięk')
  assert.equal(k.unitCost, 850)
  assert.equal(k.ownWork, undefined)
  const bare = { id: 'cm-b', name: 'Bez ról', rate: 700, roleIds: [], roleRates: [] }
  assert.equal(crewRowFromPerson(bare as never, [op] as never).unitCost, 700)
  const me = { id: 'cm-ja', name: 'Michał', self: true, rate: 1500, roleIds: ['op'], roleRates: [] }
  const m = crewRowFromPerson(me as never, [op] as never)
  assert.equal(m.ownWork, true)
  assert.equal(m.unitCost, 1500)
})

// Ekipa z szybkiej wyceny: 2 os. × 5 dni = 10 × 1 000 i dopłata Reż-Op 5 × 500.
const quick = (unitCost = 1000): PlanRow[] => [
  { planKey: 'pro:quick:ekipa', category: 'ekipa', role: 'Ekipa (szybka wycena)', person: '', quantity: 10, unitCost, quoteDay: null, block: 'days' },
  { planKey: 'pro:quick:rezop', category: 'ekipa', role: 'Dopłata Reż-Op', person: '', quantity: 5, unitCost: 500, quoteDay: null, block: 'days' },
]

test('baner: po rozdzieleniu i przeniesieniu „Uwzględnij" nie dokłada zbiorczej linii z wyceny', () => {
  const days = ['day-a', 'day-b']
  const started = startFromQuote([], quick(), days, NOW)
  const quickRow = liveCosts(started.costs).find((c) => c.planKey === 'pro:quick:ekipa')!
  let costs = splitCost(started.costs, quickRow.id, NOW)!
  assert.equal(totalActualCosts(costs), totalActualCosts(started.costs))
  // przeniesienie jednego wiersza do dnia (ręczna zmiana, jak `changeCost`)
  const moved = costs.find((c) => c.planKey?.endsWith('#3'))!
  costs = costs.map((c) => (c.id === moved.id ? applyPatch(c, editPatch(c, { dayId: 'day-b' })) : c))
  const layout = layoutRealization(costs, days, [])
  assert.equal(layout.byDay.get('day-b')!.length, 1)
  assert.ok(layout.unassigned[0].costs.length >= 9) // reszta nadal w grupie szybkiej wyceny
  // wycena się zmienia (stawka 1 000 → 1 200): rozdzielone wiersze są ręczne, nic nie wraca
  const changes = quoteChanges(costs, quick(1200), days)
  assert.equal(changes.added, 0)
  assert.equal(changes.changed, 0)
  assert.equal(changes.removed, 0)
  assert.equal(applyQuoteChanges(costs, changes.changes, days, NOW).length, costs.length)
})
