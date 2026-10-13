import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addGroupMembers,
  clientGroupSchema,
  clientScope,
  clientScopeOf,
  createClientGroup,
  dissolveClientGroup,
  groupDirectory,
  groupMemberKeys,
  groupOfClient,
  groupScopeValue,
  groupStrays,
  groupsAfterClientMerge,
  groupsAfterUndoMerge,
  inClientScope,
  isGroupScope,
  removeGroupMember,
  renameClientGroup,
  restoreClientGroup,
  scopeKeys,
  strayGroup,
  type ClientGroup,
} from './client-groups'
import { clientDirectory, suggestClients } from './clients'
import { planClientMerge } from './client-merge'

const NOW = '2026-10-13T12:00:00.000Z'

function group(id: string, name: string, members: string[], extra: Partial<ClientGroup> = {}): ClientGroup {
  return { id, name, members, createdAt: `2026-10-0${id.length}T00:00:00Z`, updatedAt: '', ...extra }
}

// Prawdziwe pisownie z projects.json (13.10.2026).
const CIONET = group('cg-1', 'CIONET + DE Group', ['cionet', 'de group sp. z o.o.'])
const PHH = group('cg-22', 'PHH + PHN + Interferie', [
  'polski holding hotelowy sp. z o.o.',
  'phn property management sp. z o.o.',
  'interferie s.a.',
])
const GROUPS = [CIONET, PHH]

const p = (id: string, client: string, date = '2026-01-01') => ({ id, name: `Projekt ${id}`, client, date, updatedAt: '' })

// ── Dane ─────────────────────────────────────────────────────────────────────

test('schemat: passthrough, zły członek znika, brak deletedAt zostaje brakiem (npm run data)', () => {
  const raw = { id: 'cg-x', name: 'A', members: ['cionet', 7, '', '  '], createdAt: NOW, updatedAt: NOW, color: 'amber' }
  const parsed = clientGroupSchema.parse(raw)
  assert.deepEqual(parsed.members, ['cionet'])
  assert.equal(parsed.color, 'amber')
  assert.equal('deletedAt' in parsed, false)
  assert.deepEqual(clientGroupSchema.parse({ id: 'cg-y', members: 'zle' }).members, [])
  assert.equal(clientGroupSchema.safeParse({ name: 'bez id' }).success, false)
})

// ── Wyszukiwanie (wspólne dla Projektów, Finansów i raportu) ─────────────────

test('groupOfClient: po kluczu albo nazwie, wielkość liter i polskie znaki bez znaczenia; rozwiązana się nie liczy', () => {
  assert.equal(groupOfClient(GROUPS, 'DE Group Sp. z o.o.')?.id, 'cg-1')
  assert.equal(groupOfClient(GROUPS, ' Interferie S.A. ')?.id, 'cg-22')
  assert.equal(groupOfClient(GROUPS, 'Tchibo'), null)
  assert.equal(groupOfClient([{ ...CIONET, deletedAt: NOW }], 'cionet'), null)
  // Członek wpisany nazwą (np. ręczny import) też pasuje; w dwóch grupach wygrywa starsza.
  const typed = group('cg-333', 'B', ['CIONET'])
  assert.equal(groupOfClient([typed], 'cionet')?.id, 'cg-333')
  assert.equal(groupOfClient([typed, CIONET], 'cionet')?.id, 'cg-1')
  assert.deepEqual(groupMemberKeys(group('g', 'x', ['A', 'a ', 'B'])), ['a', 'b'])
})

test('zakres filtra: klient albo grupa; grupa, której nie ma, to brak filtra', () => {
  assert.equal(isGroupScope('grupa:cg-1'), true)
  assert.equal(isGroupScope('cionet'), false)
  assert.deepEqual(clientScope('grupa:cg-1', GROUPS), {
    kind: 'group',
    value: 'grupa:cg-1',
    group: CIONET,
    keys: ['cionet', 'de group sp. z o.o.'],
  })
  assert.deepEqual(clientScope(' Tchibo ', GROUPS), { kind: 'client', value: 'tchibo', keys: ['tchibo'] })
  assert.equal(clientScope('grupa:nie-ma', GROUPS), null)
  assert.equal(clientScope('', GROUPS), null)
  const keys = scopeKeys(groupScopeValue('cg-22'), GROUPS)
  assert.equal(inClientScope({ client: 'Interferie S.A.' }, keys), true)
  assert.equal(inClientScope({ client: 'CIONET' }, keys), false)
  assert.equal(inClientScope({ client: 'cokolwiek' }, null), true)
})

test('clientScopeOf: projekt członka liczy się pod grupą, reszta pod swoim kluczem (zestawienia S4/S5)', () => {
  assert.equal(clientScopeOf(GROUPS, 'PHN Property Management Sp. z o.o.'), 'grupa:cg-22')
  assert.equal(clientScopeOf(GROUPS, 'Tchibo'), 'tchibo')
  assert.equal(clientScopeOf(GROUPS, '  '), '')
})

test('groupDirectory: grupa na liście wyboru klienta, szukana po nazwie i po członkach', () => {
  const directory = clientDirectory([
    p('1', 'CIONET', '2026-03-01'),
    p('2', 'CIONET', '2026-05-01'),
    p('3', 'DE Group Sp. z o.o.', '2026-06-01'),
    p('4', 'Tchibo', '2026-07-01'),
  ])
  const [cionet] = groupDirectory([CIONET], directory)
  assert.deepEqual(
    { ...cionet },
    { key: 'grupa:cg-1', name: 'CIONET + DE Group', projectCount: 3, lastDate: '2026-06-01', search: 'cionet + de group cionet de group sp. z o.o.' }
  )
  const all = [...directory, cionet]
  assert.deepEqual(suggestClients(all, 'de gr').map((c) => c.key), ['de group sp. z o.o.', 'grupa:cg-1'])
  assert.deepEqual(suggestClients(all, 'tchibo').map((c) => c.key), ['tchibo'])
  // Grupa bez nazwy nazywa się nazwami członków.
  assert.equal(groupDirectory([group('cg-9', ' ', ['cionet', 'nie-ma'])], directory)[0].name, 'CIONET')
})

// ── Edycja ───────────────────────────────────────────────────────────────────

test('nowa grupa i dodanie członka przenoszą klienta z innej grupy (klient jest w jednej grupie)', () => {
  const { groups, group: created } = createClientGroup(GROUPS, { name: ' Hotele ', members: ['Interferie S.A.', 'interferie s.a.', ''] }, NOW)
  assert.equal(created.name, 'Hotele')
  assert.deepEqual(created.members, ['interferie s.a.'])
  assert.deepEqual(groups.find((g) => g.id === 'cg-22')!.members, ['polski holding hotelowy sp. z o.o.', 'phn property management sp. z o.o.'])
  assert.equal(groups.find((g) => g.id === 'cg-1'), CIONET, 'nietknięta grupa to ten sam obiekt')

  const moved = addGroupMembers(GROUPS, 'cg-1', ['PHN Property Management Sp. z o.o.', 'cionet'], NOW)
  assert.deepEqual(moved.find((g) => g.id === 'cg-1')!.members, ['cionet', 'de group sp. z o.o.', 'phn property management sp. z o.o.'])
  assert.equal(moved.find((g) => g.id === 'cg-22')!.members.length, 2)
  assert.equal(moved.find((g) => g.id === 'cg-1')!.updatedAt, NOW)
  assert.equal(addGroupMembers(GROUPS, 'nie-ma', ['x'], NOW), GROUPS)
  // Rozwiązana grupa zostaje nietknięta — jej „Cofnij" przywraca pełny skład.
  const dissolved = { ...PHH, deletedAt: NOW }
  const withDissolved = addGroupMembers([CIONET, dissolved], 'cg-1', ['interferie s.a.'], NOW)
  assert.equal(withDissolved[1], dissolved)
  assert.deepEqual(withDissolved[0].members, [...CIONET.members, 'interferie s.a.'])
})

test('usunięcie członka, zmiana nazwy, rozwiązanie z „Cofnij" tylko tego rozwiązania', () => {
  const removed = removeGroupMember(GROUPS, 'cg-1', 'DE Group Sp. z o.o.', NOW)
  assert.deepEqual(removed.find((g) => g.id === 'cg-1')!.members, ['cionet'])
  assert.equal(removeGroupMember(GROUPS, 'cg-1', 'tchibo', NOW)[0], CIONET)
  assert.equal(renameClientGroup(GROUPS, 'cg-1', '  CIONET i DE  ', NOW)[0].name, 'CIONET i DE')
  const dissolved = dissolveClientGroup(GROUPS, 'cg-1', NOW)
  assert.equal(dissolved[0].deletedAt, NOW)
  assert.deepEqual(dissolved[0].members, CIONET.members, 'członkowie zostają w pliku')
  assert.equal(restoreClientGroup(dissolved, 'cg-1', 'inny znacznik', 'X')[0].deletedAt, NOW)
  const restored = restoreClientGroup(dissolved, 'cg-1', NOW, 'X')[0]
  assert.equal('deletedAt' in restored, false)
  assert.equal(restored.updatedAt, 'X')
})

// ── „Scal nazwy" i „poza grupą" ──────────────────────────────────────────────

test('Scal nazwy: pisownie członka scalone w nową nazwę — grupa idzie za nazwą, na tym samym miejscu', () => {
  const projects = [p('1', 'DE Group Sp. z o.o.'), p('2', 'DE Group')]
  const plan = planClientMerge(projects, ['de group sp. z o.o.', 'de group'], 'DE Group')!
  const { groups, changes } = groupsAfterClientMerge(GROUPS, plan, NOW)
  assert.deepEqual(groups[0].members, ['cionet', 'de group'])
  assert.deepEqual(changes, [{ id: 'cg-1', before: CIONET.members, after: ['cionet', 'de group'] }])
  assert.equal(groups[1], PHH)
  // „Cofnij" przywraca skład — chyba że ktoś go od tego czasu zmienił.
  assert.deepEqual(groupsAfterUndoMerge(groups, changes, 'X')[0].members, CIONET.members)
  const edited = addGroupMembers(groups, 'cg-1', ['tchibo'], 'Y')
  assert.deepEqual(groupsAfterUndoMerge(edited, changes, 'X')[0].members, ['cionet', 'de group', 'tchibo'])
})

test('Scal nazwy: klient spoza grupy wchłonięty przez członka zostaje w grupie; do klienta spoza grupy — grupa przechodzi na wynik', () => {
  // „CIONET Polska" (nowa pisownia, poza grupą) scalone w „CIONET" — nic się nie zmienia, CIONET już jest w grupie.
  const intoMember = groupsAfterClientMerge(GROUPS, { keys: ['cionet polska', 'cionet'], targetKey: 'cionet' }, NOW)
  assert.deepEqual(intoMember.changes, [])
  // Członek scalony w klienta spoza grup („CIONET" → „CIONET Polska"): grupa dostaje nowy klucz.
  const outward = groupsAfterClientMerge(GROUPS, { keys: ['cionet', 'cionet polska'], targetKey: 'cionet polska' }, NOW)
  assert.deepEqual(outward.groups[0].members, ['cionet polska', 'de group sp. z o.o.'])
  // Nic z grup — nic do zmiany.
  assert.deepEqual(groupsAfterClientMerge(GROUPS, { keys: ['tchibo', 'tchibo polska'], targetKey: 'tchibo' }, NOW).changes, [])
})

test('Scal nazwy: klienci z dwóch grup — wynik zostaje w grupie, w której już był; z drugiej wychodzą', () => {
  // Interferie (grupa PHH) scalone w CIONET (grupa CIONET): CIONET już ma grupę.
  const { groups, changes } = groupsAfterClientMerge(GROUPS, { keys: ['interferie s.a.', 'cionet'], targetKey: 'cionet' }, NOW)
  assert.deepEqual(groups[0].members, CIONET.members)
  assert.deepEqual(groups[1].members, ['polski holding hotelowy sp. z o.o.', 'phn property management sp. z o.o.'])
  assert.deepEqual(changes.map((c) => c.id), ['cg-22'])
  // Nowa nazwa spoza grup: dostaje ją pierwsza grupa ze scalanych (strona scalania), druga traci członka.
  const fresh = groupsAfterClientMerge(GROUPS, { keys: ['interferie s.a.', 'cionet'], targetKey: 'nowa marka' }, NOW)
  assert.deepEqual(fresh.groups[1].members, ['polski holding hotelowy sp. z o.o.', 'phn property management sp. z o.o.', 'nowa marka'])
  assert.deepEqual(fresh.groups[0].members, ['de group sp. z o.o.'])
})

test('poza grupą: nowa pisownia podobna do członka, spoza grup; klient w grupie i niepodobni — nie', () => {
  assert.equal(strayGroup(GROUPS, 'cionet polska')?.id, 'cg-1')
  assert.equal(strayGroup(GROUPS, 'interferie medical spa')?.id, 'cg-22')
  assert.equal(strayGroup(GROUPS, 'de group'), CIONET)
  assert.equal(strayGroup(GROUPS, 'cionet'), null, 'członek nie jest „poza"')
  // Członek jednej grupy podobny do członka innej — dalej nie jest „poza grupą".
  assert.equal(strayGroup([CIONET, group('cg-x', 'Inna', ['cionet polska'])], 'cionet'), null)
  assert.equal(strayGroup(GROUPS, 'tchibo'), null)
  assert.equal(strayGroup(GROUPS, 'polska akcja humanitarna'), null, '„Polska" i forma prawna nic nie znaczą')
  const directory = clientDirectory([p('1', 'CIONET'), p('2', 'CIONET Polska'), p('3', 'Tchibo'), p('4', 'Interferie Medical SPA')])
  assert.deepEqual(groupStrays(GROUPS, CIONET, directory).map((c) => c.key), ['cionet polska'])
})
