import { test } from 'node:test'
import assert from 'node:assert/strict'

import { eventSchema, type TimelineEvent } from './event-types'
import { planGearRetro, type RetroSelection } from './gear-retro'
import { summarizeProjectGear } from './equipment-roi'
import { equipmentItemSchema, gearDaySchema, projectSchema, type Project } from './project-types'
import { resolveRealizationDays } from './realization-days'

const NOW = '2026-11-10T10:00:00.000Z'
const NOTE = 'Data umowna (import): 4 tygodnie przed fakturą.'

const equipment = [
  { id: 'cam', name: 'A7S III', purchasePrice: 12000, rentalDayRate: 200, purchaseDate: '2021-03-01' },
  { id: 'lens', name: '100-400', purchasePrice: 9000, rentalDayRate: 150, purchaseDate: '2021-06-01' },
  { id: 'tripod', name: 'Manfrotto', purchasePrice: 900, rentalDayRate: 50, purchaseDate: '' },
].map((i) => equipmentItemSchema.parse({ category: 'kamery', notes: '', ...i }))

function project(id: string, date: string, extra: Record<string, unknown> = {}): Project {
  return projectSchema.parse({ id, name: id, status: 'done', date, ...extra })
}

function shoot(id: string, projectId: string, start: string, extra: Record<string, unknown> = {}): TimelineEvent {
  return eventSchema.parse({ id, kind: 'shoot_day', projectId, start, notes: NOTE, ...extra })
}

const selection = (projects: RetroSelection['projects'], extra: Partial<RetroSelection> = {}): RetroSelection => ({
  kits: { kite: { name: 'Kite', price: 500, items: ['cam', 'lens', 'tripod'] } },
  projects,
  ...extra,
})

function run(sel: RetroSelection, projects: Project[], events: TimelineEvent[], revenue: [string, number | null][] = []) {
  return planGearRetro({ selection: sel, projects, events, equipment, revenue: new Map(revenue), now: NOW })
}

test('zestaw Kite 500: stawki 250 / 187,5 / 62,5; 3 dni, 25% z 6 354 zł → Odpracował 1 500, zarobił 1 588,5', () => {
  const p = project('p1', '2022-05-01')
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 3, percent: 25 }]), [p], [shoot('e1', 'p1', '2022-04-02')], [['p1', 6354]])
  const set = plan.projects[0].set
  const gearDays = (set.gearDays as unknown[]).map((d) => gearDaySchema.parse(d))
  assert.equal(gearDays.length, 3)
  assert.deepEqual(gearDays[0].lines.map((l) => l.dayRate), [250, 187.5, 62.5])
  assert.equal(set.gearEarnedOverride, 1588.5)

  const stats = summarizeProjectGear({ ...p, gearDays, gearEarnedOverride: 1588.5 }, equipment)
  assert.equal(stats.items.reduce((sum, u) => sum + u.rentValue, 0), 1500, 'Odpracował 3 × 500')
  assert.equal(stats.earnings.shares.reduce((sum, s) => sum + s.earned, 0), 1588.5)
  assert.equal(plan.report.perItem.get('cam')!.days, 3)
  assert.equal(plan.report.perItem.get('cam')!.worked, 750)
  assert.equal(plan.report.perItem.get('cam')!.earned, 794.25)
})

test('kalendarz: istniejące dni po kolei, brakujące wydłużają ostatni placeholder importowy', () => {
  const p = project('p1', '2022-05-01')
  const events = [shoot('e1', 'p1', '2022-04-02')]
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 3 }]), [p], events)
  assert.deepEqual(plan.eventUpdates, [{ id: 'e1', set: { end: '2022-04-04', updatedAt: NOW } }])
  assert.equal(plan.eventUpserts.length, 0)
  const days = (plan.projects[0].set.gearDays as unknown[]).map((d) => gearDaySchema.parse(d))
  assert.deepEqual(days.map((d) => [d.eventId, d.eventDay, d.date]), [
    ['e1', 0, '2022-04-02'],
    ['e1', 1, '2022-04-03'],
    ['e1', 2, '2022-04-04'],
  ])
  // Po zapisie patcha kalendarz rozpoznaje te dni jako powiązane z wydarzeniem.
  const saved = { ...p, gearDays: days }
  const extended = [{ ...events[0], end: '2022-04-04' }]
  const resolved = resolveRealizationDays(saved, extended)
  assert.deepEqual([...resolved.info.values()].map((i) => i.link), ['calendar', 'calendar', 'calendar'])
})

test('kalendarz: ostatnie wydarzenie „prawdziwe" → nowe jednodniowe wydarzenia w kolejnych dniach', () => {
  const p = project('p1', '2022-05-01')
  const events = [shoot('e1', 'p1', '2022-04-02', { notes: 'Plener' }), shoot('e2', 'p1', '2022-04-05', { notes: 'Plener 2' })]
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 4 }]), [p], events)
  assert.equal(plan.eventUpdates.length, 0)
  assert.deepEqual(plan.eventUpserts.map((e) => [e.id, e.start, e.kind]), [
    ['ev-retro-sprzet-p1-3', '2022-04-06', 'shoot_day'],
    ['ev-retro-sprzet-p1-4', '2022-04-07', 'shoot_day'],
  ])
  eventSchema.parse(plan.eventUpserts[0])
})

test('kalendarz: więcej dni zdjęciowych niż N → pierwsze N powiązane, reszta bez sprzętu', () => {
  const p = project('p1', '2022-05-01')
  const events = [shoot('e1', 'p1', '2022-04-02', { end: '2022-04-04' })]
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 2 }]), [p], events)
  assert.deepEqual(plan.eventUpdates, [])
  assert.deepEqual((plan.projects[0].set.gearDays as { eventDay: number }[]).map((d) => d.eventDay), [0, 1])
})

test('pozycja kupiona po dacie projektu odpada; cena zestawu spada razem z nią', () => {
  const p = project('p1', '2021-04-20')
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 2 }]), [p], [shoot('e1', 'p1', '2021-04-01')])
  const days = (plan.projects[0].set.gearDays as unknown[]).map((d) => gearDaySchema.parse(d))
  // lens kupiony 2021-06-01, projekt 2021-04-01
  assert.deepEqual(days[0].lines.map((l) => [l.itemId, l.dayRate]), [['cam', 250], ['tripod', 62.5]])
  assert.equal(plan.report.leftOut.length, 1)
  assert.match(plan.report.leftOut[0], /100-400/)
})

test('equipmentDates przesuwają datę zakupu i działają na wykluczanie', () => {
  const p = project('p1', '2021-04-20')
  const plan = run(
    selection([{ id: 'p1', kit: 'kite', days: 1 }], { equipmentDates: { tripod: '2023-01-01', cam: '2021-03-01' } }),
    [p],
    [shoot('e1', 'p1', '2021-04-01')]
  )
  assert.deepEqual(plan.equipment, [{ id: 'tripod', set: { purchaseDate: '2023-01-01' } }], 'cam bez zmiany nie trafia do patcha')
  const ids = (plan.projects[0].set.gearDays as { lines: { itemId: string }[] }[])[0].lines.map((l) => l.itemId)
  assert.deepEqual(ids, ['cam'])
})

test('postOnly: bez sprzętu i kwoty, miękko usuwa tylko importowe dni zdjęciowe', () => {
  const p = project('p1', '2022-05-01')
  const events = [shoot('e1', 'p1', '2022-04-02'), shoot('e2', 'p1', '2022-04-03', { notes: 'Ręczny' })]
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 2, percent: 25, postOnly: true }]), [p], events, [['p1', 1000]])
  assert.equal(plan.projects.length, 0)
  assert.deepEqual(plan.eventUpdates, [{ id: 'e1', set: { deletedAt: NOW, updatedAt: NOW } }])
})

test('zestaw null (bez postOnly) i projekt z gotowym sprzętem są nietknięte', () => {
  const p1 = project('p1', '2022-05-01')
  const p2 = project('p2', '2022-05-01', { gearDays: [{ id: 'd', lines: [{ itemId: 'cam', qty: 1 }] }] })
  const p3 = project('p3', '2022-05-01', { gearEarnedOverride: 100 })
  const plan = run(
    selection([
      { id: 'p1', kit: null, days: 2 },
      { id: 'p2', kit: 'kite', days: 2 },
      { id: 'p3', kit: 'kite', days: 2 },
    ]),
    [p1, p2, p3],
    []
  )
  assert.equal(plan.projects.length, 0)
  assert.equal(plan.report.skipped.length, 2, 'p2 i p3 wymienione; p1 po cichu')
  assert.equal(plan.eventUpserts.length + plan.eventUpdates.length, 0)
})

test('projekt bez wydarzeń: dni od daty projektu; brak przychodu → bez kwoty i ostrzeżenie', () => {
  const p = project('p1', '2022-05-01')
  const plan = run(selection([{ id: 'p1', kit: 'kite', days: 2, percent: 25 }]), [p], [], [['p1', null]])
  assert.deepEqual(plan.eventUpserts.map((e) => e.start), ['2022-05-01', '2022-05-02'])
  assert.equal(plan.projects[0].set.gearEarnedOverride, undefined)
  assert.equal(plan.report.warnings.length, 1)
})

test('błędny wybór (nieznany zestaw, projekt, pozycja) zatrzymuje generowanie', () => {
  const p = project('p1', '2022-05-01')
  assert.throws(() => run(selection([{ id: 'p1', kit: 'nie-ma', days: 1 }]), [p], []), /nieznany zestaw/)
  assert.throws(() => run(selection([{ id: 'x', kit: 'kite', days: 1 }]), [p], []), /nie ma projektu/)
  assert.throws(() => run(selection([], { equipmentDates: { nope: '2020-01-01' } }), [p], []), /nie ma pozycji/)
})
