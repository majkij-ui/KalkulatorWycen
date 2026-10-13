import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  crewAfterMerge,
  crewAfterUnmerge,
  crewDuplicateGroups,
  crewMergeKitUpdates,
  crewMergePatches,
  crewUnmergeKitUpdates,
  crewUnmergePatches,
  mergedCrewMember,
  planCrewMerge,
  retargetQuoteDays,
  type CrewMergePlan,
} from './crew-merge'
import { computeCrewStats, unknownCrewNames } from './crew-stats'
import type { CrewMember } from './crew-types'
import type { GearKit, Project, ProjectCost } from './project-types'
import type { QuoteCrewLine } from './quote-types'

const AT = '2026-10-13T10:00:00.000Z'

function member(id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { id, name, roleIds: [], contact: {}, createdAt: `2026-10-0${id.length}T00:00:00Z`, updatedAt: 'u0', ...extra }
}

// Jak u M.J.: ten sam Łukasz dwa razy (z własnym sprzętem i bez), plus trzeci wpisany samym imieniem.
const BEZ = member('cm-bez', 'Łukasz - op bez sprzętu', { roleIds: ['rezOp', 'asystent', 'gafer'], rate: 1200 })
const ZE = member('cm-ze', 'Łukasz - ze sprzętem', {
  roleIds: ['asystent', 'rezOp', 'gafer', 'cr-dron'],
  rate: 1500,
  contact: { phone: '600 100 200' },
  notes: 'ma Ronina',
})
const SAM = member('cm-sam', 'Łukasz', { city: 'Poznań', roleRates: [{ roleId: 'rezOp', rate: 1300 }, { roleId: 'cr-dron', rate: 1800 }] })
const OLA = member('cm-ola', 'Ola', { rate: 900 })
const PEOPLE = [BEZ, ZE, SAM, OLA]

const crew = (id: string, person: string, extra: Partial<ProjectCost> = {}): ProjectCost => ({
  id,
  category: 'ekipa',
  person,
  role: 'Operator',
  quantity: 1,
  unitCost: 1000,
  dayId: 'd1',
  ...extra,
})

const line = (id: string, personId: string | undefined, personName?: string): QuoteCrewLine => ({
  id,
  roleId: 'rezOp',
  roleName: 'ReżOp',
  ...(personId ? { personId } : {}),
  ...(personName ? { personName } : {}),
  clientRate: 2000,
  costRate: 1200,
  qty: 1,
})

function project(id: string, costs: ProjectCost[], lines: QuoteCrewLine[] = [], extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-09-01',
    createdAt: '',
    updatedAt: '',
    quote: lines.length
      ? ({
          version: 2,
          savedAt: '',
          data: { isDetailedProdukcja: true, detailedShootingDays: [{ id: 'q1', crew: lines, extra: 'x' }], other: 1 },
          pricingConfig: {},
          marginMultiplier: 1,
          pdfDraft: null,
        } as unknown as Project['quote'])
      : null,
    financials: null,
    equipment: [],
    notes: '',
    gearDays: [{ id: 'd1', label: '', date: '2026-09-01', lines: [] }],
    costs,
    ...extra,
  }
}

function plan(projects: Project[], kits: GearKit[] = [], targetId = 'cm-bez', sourceIds = ['cm-ze', 'cm-sam']): CrewMergePlan {
  return planCrewMerge({ members: PEOPLE, targetId, sourceIds, projects, kits, at: AT, roleName: (id) => id })!
}

test('crewDuplicateGroups: to samo pierwsze imię (bez polskich znaków i myślników), usunięci się nie liczą', () => {
  const groups = crewDuplicateGroups([...PEOPLE, member('cm-x', 'Lukasz', { deletedAt: 'x' }), member('cm-o2', 'ola')])
  // Kolejność w grupie: od najstarszej karty (createdAt), grupy od największej.
  assert.deepEqual(
    groups.map((g) => g.map((m) => m.id)),
    [
      ['cm-ze', 'cm-bez', 'cm-sam'],
      ['cm-o2', 'cm-ola'],
    ]
  )
  assert.deepEqual(crewDuplicateGroups([OLA]), [])
})

test('karta po scaleniu: pola docelowej wygrywają, braki uzupełnia pierwszy duplikat, stawki, które się nie mieszczą, idą do notatki', () => {
  const merged = mergedCrewMember(BEZ, [ZE, SAM], AT, (id) => (id === 'rezOp' ? 'ReżOp' : id))
  assert.equal(merged.id, 'cm-bez')
  assert.equal(merged.name, 'Łukasz - op bez sprzętu')
  assert.deepEqual(merged.roleIds, ['rezOp', 'asystent', 'gafer', 'cr-dron'])
  assert.equal(merged.rate, 1200)
  assert.deepEqual(merged.roleRates, [
    { roleId: 'rezOp', rate: 1300 },
    { roleId: 'cr-dron', rate: 1800 },
  ])
  assert.equal(merged.contact.phone, '600 100 200')
  assert.equal(merged.city, 'Poznań')
  assert.equal(merged.updatedAt, AT)
  assert.equal(merged.createdAt, BEZ.createdAt)
  assert.equal(
    merged.notes,
    'Scalono z „Łukasz - ze sprzętem" (13.10.2026): stawka 1500 zł · ma Ronina.\nScalono z „Łukasz" (13.10.2026).'
  )
  // Docelowa bez stawki bierze pierwszą stawkę duplikatu; ta sama stawka nie trafia do notatki.
  const noRate = mergedCrewMember(member('t', 'T'), [member('s', 'S', { rate: 700 })], AT)
  assert.equal(noRate.rate, 700)
  assert.equal(noRate.notes, 'Scalono z „S" (13.10.2026).')
  // Sprzeczna stawka w roli zostaje przy docelowej, duplikatu w notatce.
  const clash = mergedCrewMember(SAM, [member('s', 'S', { roleRates: [{ roleId: 'rezOp', rate: 1400 }] })], AT, () => 'ReżOp')
  assert.deepEqual(clash.roleRates?.[0], { roleId: 'rezOp', rate: 1300 })
  assert.match(clash.notes!, /ReżOp 1400 zł/)
})

test('planCrewMerge: brak docelowej, brak duplikatów albo duplikat usunięty → null; docelowa wśród duplikatów się nie liczy', () => {
  const base = { members: PEOPLE, projects: [], kits: [], at: AT }
  assert.equal(planCrewMerge({ ...base, targetId: 'nie-ma', sourceIds: ['cm-ze'] }), null)
  assert.equal(planCrewMerge({ ...base, targetId: 'cm-bez', sourceIds: ['cm-bez'] }), null)
  assert.equal(
    planCrewMerge({ ...base, members: [BEZ, { ...ZE, deletedAt: 'x' }], targetId: 'cm-bez', sourceIds: ['cm-ze'] }),
    null
  )
  assert.deepEqual(planCrewMerge({ ...base, targetId: 'cm-bez', sourceIds: ['cm-ze', 'cm-bez', 'cm-ze'] })!.sourceIds, ['cm-ze'])
})

test('scalenie przepina wiersze Realizacji (po id i po imieniu, także usunięte), zostawia imiona i obce wiersze', () => {
  const projects = [
    project('p1', [
      crew('c1', 'Łukasz - ze sprzętem', { personId: 'cm-ze' }),
      crew('c2', 'Łukasz', {}), // po imieniu → cm-sam
      crew('c3', 'Ola', { personId: 'cm-ola' }),
      crew('c4', 'Łukasz - op bez sprzętu', { personId: 'cm-bez' }),
      crew('c5', 'Łukasz - ze sprzętem', { personId: 'cm-ze', deletedAt: 'y' }),
      { id: 'c6', category: 'dojazd', label: 'Łukasz', unitCost: 50 }, // nie ekipa — imię nic nie znaczy
    ]),
    project('p2', [crew('c7', 'Ola', { personId: 'cm-ola' })]),
  ]
  const p = plan(projects)
  assert.deepEqual(
    p.refs.map((r) => [r.projectId, r.kind, r.id, r.from]),
    [
      ['p1', 'cost', 'c1', 'cm-ze'],
      ['p1', 'cost', 'c2', undefined],
      ['p1', 'cost', 'c5', 'cm-ze'],
    ]
  )
  const patches = crewMergePatches(projects, p)
  assert.equal(patches.length, 1, 'projekt bez odwołań nie jest zapisywany')
  const costs = patches[0].patch.costs!
  assert.deepEqual(
    costs.map((c) => [c.id, c.personId, c.person]),
    [
      ['c1', 'cm-bez', 'Łukasz - ze sprzętem'],
      ['c2', 'cm-bez', 'Łukasz'],
      ['c3', 'cm-ola', 'Ola'],
      ['c4', 'cm-bez', 'Łukasz - op bez sprzętu'],
      ['c5', 'cm-bez', 'Łukasz - ze sprzętem'],
      ['c6', undefined, undefined],
    ]
  )
  assert.equal(costs[4].deletedAt, 'y')
  assert.equal('quote' in patches[0].patch, false)
})

test('scalenie przepina pozycje ekipy w wycenach projektu, nie ruszając reszty migawki ani zamrożonych imion', () => {
  const projects = [
    project('p1', [], [line('l1', 'cm-ze', 'Łukasz - ze sprzętem'), line('l2', undefined), line('l3', 'cm-ola', 'Ola')]),
  ]
  const p = plan(projects)
  assert.deepEqual(p.refs, [{ projectId: 'p1', kind: 'quote', id: 'l1', dayId: 'q1', from: 'cm-ze' }])
  const [patch] = crewMergePatches(projects, p)
  const quote = patch.patch.quote as unknown as { data: { detailedShootingDays: { id: string; extra: string; crew: QuoteCrewLine[] }[]; other: number }; version: number }
  assert.equal(quote.version, 2)
  assert.equal(quote.data.other, 1)
  assert.equal(quote.data.detailedShootingDays[0].extra, 'x')
  assert.deepEqual(
    quote.data.detailedShootingDays[0].crew.map((l) => [l.id, l.personId, l.personName]),
    [
      ['l1', 'cm-bez', 'Łukasz - ze sprzętem'],
      ['l2', undefined, undefined],
      ['l3', 'cm-ola', 'Ola'],
    ]
  )
  // Oryginał nietknięty (funkcje są niemutujące).
  assert.equal((projects[0].quote as unknown as typeof quote).data.detailedShootingDays[0].crew[0].personId, 'cm-ze')
})

test('scalenie: wiersz zmieniony między podglądem a zapisem zostaje, jak jest', () => {
  const before = [project('p1', [crew('c1', 'Ł', { personId: 'cm-ze' }), crew('c2', 'Łukasz')])]
  const p = plan(before)
  const later = [project('p1', [crew('c1', 'Ola', { personId: 'cm-ola' }), crew('c2', 'Łukasz')])]
  const costs = crewMergePatches(later, p)[0].patch.costs!
  assert.deepEqual(
    costs.map((c) => c.personId),
    ['cm-ola', 'cm-bez']
  )
})

test('„Cofnij": poprzednie personId (albo brak) tylko tam, gdzie wiersz wciąż wskazuje osobę docelową', () => {
  const projects = [
    project('p1', [crew('c1', 'Ł', { personId: 'cm-ze' }), crew('c2', 'Łukasz'), crew('c3', 'Ł', { personId: 'cm-ze' })], [line('l1', 'cm-sam')]),
  ]
  const p = plan(projects)
  const merged = projects.map((pr) => {
    const patch = crewMergePatches(projects, p).find((x) => x.id === pr.id)
    return patch ? { ...pr, ...patch.patch } : pr
  })
  // Po scaleniu ktoś przepiął c3 na Olę — „Cofnij" go nie rusza.
  merged[0] = { ...merged[0], costs: merged[0].costs!.map((c) => (c.id === 'c3' ? { ...c, personId: 'cm-ola' } : c)) }
  const [undo] = crewUnmergePatches(merged, p)
  assert.deepEqual(
    undo.patch.costs!.map((c) => [c.id, c.personId]),
    [
      ['c1', 'cm-ze'],
      ['c2', undefined],
      ['c3', 'cm-ola'],
    ]
  )
  assert.equal('personId' in undo.patch.costs![1], false, 'wiersz po imieniu wraca bez pola')
  const quote = undo.patch.quote as unknown as { data: { detailedShootingDays: { crew: QuoteCrewLine[] }[] } }
  assert.equal(quote.data.detailedShootingDays[0].crew[0].personId, 'cm-sam')
  assert.deepEqual(crewUnmergePatches(projects, p), [], 'nic do cofnięcia, gdy nic nie wskazuje docelowej')
})

test('zestawy: ekipa przepięta, ta sama rola i osoba po scaleniu to jedna pozycja; „Cofnij" tylko, gdy nikt nie zmienił zestawu', () => {
  const kits: GearKit[] = [
    {
      id: 'k1',
      name: 'Wywiad',
      lines: [],
      createdAt: '',
      crew: [
        { roleId: 'rezOp', personId: 'cm-ze', qty: 1, note: 'x' },
        { roleId: 'rezOp', personId: 'cm-bez', qty: 1 },
        { roleId: 'gafer', qty: 2 },
        { roleId: 'gafer', personId: 'cm-sam', qty: 1 },
      ],
    },
    { id: 'k2', name: 'Bez Łukasza', lines: [], createdAt: '', crew: [{ roleId: 'gafer', personId: 'cm-ola', qty: 1 }] },
  ]
  const p = plan([], kits)
  assert.deepEqual(p.kits.map((k) => k.kitId), ['k1'])
  const [updated] = crewMergeKitUpdates(kits, p)
  assert.deepEqual(updated.crew, [
    { roleId: 'rezOp', personId: 'cm-bez', qty: 1, note: 'x' },
    { roleId: 'gafer', qty: 2 },
    { roleId: 'gafer', personId: 'cm-bez', qty: 1 },
  ])
  assert.deepEqual(crewUnmergeKitUpdates([updated, kits[1]], p).map((k) => k.crew), [kits[0].crew])
  const edited = { ...updated, crew: [...updated.crew!, { roleId: 'aktor', qty: 1 }] }
  assert.deepEqual(crewUnmergeKitUpdates([edited], p), [])
  assert.deepEqual(crewMergeKitUpdates([edited], p), [], 'zestaw zmieniony od podglądu zostaje')
})

test('ludzie: duplikaty usunięte miękko z mergedInto; „Cofnij" przywraca je i kartę sprzed scalenia (gdy nieedytowana)', () => {
  const p = plan([])
  const after = crewAfterMerge(PEOPLE, p)
  const byId = new Map(after.map((m) => [m.id, m]))
  assert.equal(byId.get('cm-bez'), p.merged)
  assert.equal(byId.get('cm-ze')!.deletedAt, AT)
  assert.equal(byId.get('cm-ze')!.mergedInto, 'cm-bez')
  assert.equal(byId.get('cm-sam')!.mergedInto, 'cm-bez')
  assert.equal(byId.get('cm-ola'), OLA)

  const undone = crewAfterUnmerge(after, p, 'NOW')
  const back = new Map(undone.map((m) => [m.id, m]))
  assert.equal(back.get('cm-bez'), BEZ)
  assert.deepEqual(back.get('cm-ze'), { ...ZE, updatedAt: 'NOW' })
  assert.equal('mergedInto' in back.get('cm-sam')!, false)

  // Karta edytowana po scaleniu zostaje; osoba usunięta wcześniej (inny znacznik) też.
  const edited = after.map((m) => (m.id === 'cm-bez' ? { ...m, updatedAt: 'później', city: 'Gniezno' } : m))
  assert.equal(crewAfterUnmerge(edited, p, 'NOW').find((m) => m.id === 'cm-bez')!.city, 'Gniezno')
  const otherDelete = after.map((m) => (m.id === 'cm-sam' ? { ...m, deletedAt: 'inny' } : m))
  assert.equal(crewAfterUnmerge(otherDelete, p, 'NOW').find((m) => m.id === 'cm-sam')!.deletedAt, 'inny')
})

test('po scaleniu statystyki liczą pracę duplikatów u osoby, która została — także z wierszy zapisanych starą kopią', () => {
  const projects = [
    project('p1', [crew('c1', 'Łukasz - ze sprzętem', { personId: 'cm-ze', unitCost: 1500 })]),
    project('p2', [crew('c2', 'Łukasz', { unitCost: 1300 })], [], { date: '2026-09-10', gearDays: [{ id: 'd1', label: '', date: '2026-09-10', lines: [] }] }),
  ]
  const p = plan(projects)
  const people = crewAfterMerge(PEOPLE, p)
  // p1 zapisany później starą kopią (bez przepięcia) — `mergedInto` i tak prowadzi do docelowej.
  const stale = projects[0]
  const fresh = { ...projects[1], ...crewMergePatches([projects[1]], p)[0].patch }
  const stats = computeCrewStats(people, [stale, fresh], { now: new Date(2026, 9, 13) })
  assert.equal(stats.get('cm-bez')!.days, 2)
  assert.equal(stats.get('cm-bez')!.paidTotal, 2800)
  assert.equal(stats.has('cm-ze'), false)
  assert.deepEqual(unknownCrewNames([stale, fresh], people), [], 'nic nie wypada „spoza bazy"')
})

test('retargetQuoteDays: dni kalkulatora z przepiętymi osobami, tylko zmienione dni', () => {
  const days = [
    { id: 'd1', crew: [line('a', 'cm-ze'), line('b', 'cm-ola')] },
    { id: 'd2', crew: [line('c', 'cm-ola')] },
    { id: 'd3' },
  ]
  const changed = retargetQuoteDays(days, new Map([['cm-ze', 'cm-bez']]))
  assert.deepEqual(changed.map((d) => [d.dayId, d.crew.map((l) => l.personId)]), [['d1', ['cm-bez', 'cm-ola']]])
})
