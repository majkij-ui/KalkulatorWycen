import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeCrewStats, crewRanking, matchCrewMember, unknownCrewNames } from './crew-stats'
import { crewContactText, crewPickerOptions, type CrewMember } from './crew-types'
import type { Project, ProjectCost } from './project-types'

const NOW = new Date(2026, 9, 10, 12)

function member(id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { id, name, roleIds: [], contact: {}, createdAt: `2026-01-0${id.length}T00:00:00Z`, updatedAt: '', ...extra }
}

function crew(id: string, person: string, unitCost: number, extra: Partial<ProjectCost> = {}): ProjectCost {
  return { id, category: 'ekipa', person, role: '', quantity: 1, unitCost, dayId: 'd1', ...extra }
}

function project(id: string, status: Project['status'], date: string, costs: ProjectCost[], extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date,
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    gearDays: [
      { id: 'd1', label: '', date: `${date}`, lines: [] },
      { id: 'd2', label: '', date: '', lines: [] },
    ],
    costs,
    ...extra,
  }
}

test('dopasowanie: po personId, a bez niego po imieniu; usunięci i obcy id nie pasują', () => {
  const people = [member('a', 'Łukasz Nowak'), member('bb', 'Piotr'), member('ccc', 'Ola', { deletedAt: 'T' })]
  assert.equal(matchCrewMember({ personId: 'bb', person: 'Łukasz Nowak' }, people)?.id, 'bb', 'id wygrywa z imieniem')
  assert.equal(matchCrewMember({ person: ' lukasz  nowak ' }, people)?.id, 'a')
  assert.equal(matchCrewMember({ personId: 'zz', person: 'Piotr' }, people), null, 'nieznane id nie spada na imię')
  assert.equal(matchCrewMember({ personId: 'ccc', person: 'Ola' }, people), null)
  assert.equal(matchCrewMember({ person: '' }, people), null)
})

test('statystyki tylko z rzeczywistych kosztów projektów w realizacji i zrealizowanych', () => {
  const people = [member('a', 'Łukasz', { roleIds: ['gafer'] })]
  const projects = [
    project('p1', 'done', '2026-03-10', [
      crew('c1', 'Łukasz', 800, { role: 'Gafer' }),
      crew('c2', 'lukasz', 900, { role: 'Operator B', dayId: 'd2' }),
    ]),
    project('p2', 'won', '2025-11-02', [crew('c3', 'Łukasz', 700, { personId: 'a', role: 'gafer', quantity: 2 })]),
    project('p3', 'quote', '2026-05-01', [crew('c4', 'Łukasz', 5000)]),
    project('p4', 'lost', '2026-05-01', [crew('c5', 'Łukasz', 5000)]),
    project('p5', 'done', '2026-06-01', [crew('c6', 'Łukasz', 5000)], { deletedAt: 'T' }),
    project('p6', 'done', '2026-07-01', [crew('c7', 'Łukasz', 5000, { deletedAt: 'T' }), { id: 'x', category: 'catering', unitCost: 300, person: 'Łukasz' }]),
    project('p7', 'done', '2026-08-15', [crew('c8', 'Łukasz', 2000, { dayId: undefined, role: 'Montaż' })]),
  ]
  const s = computeCrewStats(people, projects, { now: NOW }).get('a')!

  assert.equal(s.days, 4, '1 + 1 + 2 dni; koszt projektu bez dnia się nie liczy do dni')
  assert.equal(s.projects, 3)
  assert.equal(s.paidTotal, 800 + 900 + 1400 + 2000)
  assert.equal(s.paidThisYear, 800 + 900 + 2000, 'listopad 2025 to zeszły rok')
  assert.equal(s.avgDayRate, (800 + 900 + 1400) / 4, 'średnia tylko z dni pracy')
  assert.equal(s.lastDate, '2026-08-15')
  assert.deepEqual(s.roles, [
    { name: 'Gafer', count: 2 },
    { name: 'Montaż', count: 1 },
    { name: 'Operator B', count: 1 },
  ])
  assert.deepEqual(
    s.history.map((h) => [h.project.id, h.days, h.paid, h.roles]),
    [
      ['p7', 0, 2000, ['Montaż']],
      ['p1', 2, 1700, ['Gafer', 'Operator B']],
      ['p2', 2, 1400, ['gafer']],
    ]
  )
})

test('data dnia pracy pochodzi z kalendarza, gdy dzień jest powiązany z wydarzeniem', () => {
  const people = [member('a', 'Ola')]
  const p = project('p1', 'done', '2026-03-10', [crew('c1', 'Ola', 800)], {
    gearDays: [{ id: 'd1', label: '', date: '2026-03-10', lines: [], eventId: 'ev1', eventDay: 0 }],
  })
  const moved = { id: 'ev1', kind: 'shoot_day', projectId: 'p1', start: '2025-12-30', deletedAt: undefined }
  const s = computeCrewStats(people, [p], { events: [moved], now: NOW }).get('a')!
  assert.equal(s.lastDate, '2025-12-30')
  assert.equal(s.paidThisYear, 0)
})

test('osoba bez pracy ma puste statystyki; ranking pomija ją i sortuje po dniach', () => {
  const people = [member('a', 'Ola'), member('bb', 'Piotr'), member('ccc', 'Kasia')]
  const projects = [
    project('p1', 'done', '2026-03-10', [crew('c1', 'Ola', 800), crew('c2', 'Piotr', 800), crew('c3', 'Piotr', 800, { dayId: 'd2' })]),
    project('p2', 'done', '2026-04-10', [crew('c4', 'Ola', 800)]),
  ]
  const stats = computeCrewStats(people, projects, { now: NOW })
  assert.equal(stats.get('ccc')!.projects, 0)
  assert.equal(stats.get('ccc')!.avgDayRate, null)
  const ranking = crewRanking(people, stats)
  assert.deepEqual(ranking.map((r) => r.member.id), ['a', 'bb'], 'remis dni (2): więcej projektów wygrywa')
})

test('„Dodaj do bazy": imiona spoza bazy, najnowsza pisownia i stawka, bez powiązanych wierszy', () => {
  const people = [member('a', 'Ola')]
  const projects = [
    project('p1', 'quote', '2026-02-01', [crew('c1', 'piotr', 700, { role: 'Gafer' }), crew('c2', 'Ola', 800)]),
    project('p2', 'done', '2026-05-01', [
      crew('c3', 'Piotr', 900, { role: 'gafer' }),
      crew('c4', 'Piotr', 900, { role: 'Operator' }),
      crew('c5', 'Zenek', 500, { personId: 'a' }),
      crew('c6', '', 500),
    ]),
    project('p3', 'done', '2026-06-01', [crew('c7', 'Kasia', 600)], { deletedAt: 'T' }),
  ]
  assert.deepEqual(unknownCrewNames(projects, people), [
    { name: 'Piotr', roles: ['Gafer', 'Operator'], lastRate: 900, uses: 3 },
  ])
})

test('wybór osoby: najpierw z tą rolą, potem reszta; bez wycofanych; filtr po imieniu', () => {
  const people = [
    member('a', 'Zosia', { roleIds: ['gafer'] }),
    member('bb', 'Adam'),
    member('ccc', 'Łukasz', { roleIds: ['gafer', 'asystent'] }),
    member('dddd', 'Ewa', { roleIds: ['gafer'], retiredAt: '2026-01-01' }),
  ]
  const { withRole, others } = crewPickerOptions(people, 'gafer')
  assert.deepEqual(withRole.map((m) => m.name), ['Łukasz', 'Zosia'])
  assert.deepEqual(others.map((m) => m.name), ['Adam'])
  assert.deepEqual(crewPickerOptions(people, null, 'luk').others.map((m) => m.name), ['Łukasz'])
  assert.equal(crewContactText({ name: 'Ola ', contact: { phone: '600 100 200', email: '' } }), 'Ola · 600 100 200')
})
