import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeCrewRoles,
  BUILT_IN_CREW_ROLES,
  builtInCrewRoles,
  createCrewMember,
  createCrewRole,
  crewMemberByName,
  crewMemberSchema,
  crewRoleByName,
  crewRoleSchema,
  isBuiltInCrewRole,
  pickableCrewMembers,
  resolveCrewRoles,
  type CrewMember,
  type CrewRole,
} from './crew-types'
import { DEFAULT_PRICING } from './pricing-config'
import { resolveProfitSections } from './profit-calc'
import { mergeQuoteDataPartial } from './quote-financials'
import { createDefaultShootingDay } from './quote-types'
import { projectCostSchema } from './project-types'

const NOW = new Date('2026-10-10T12:00:00.000Z')

function pricingWith(patch: Partial<typeof DEFAULT_PRICING.produkcja>) {
  const pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING))
  Object.assign(pricing.produkcja, patch)
  return pricing as typeof DEFAULT_PRICING
}

function member(id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { id, name, roleIds: [], contact: {}, createdAt: '2026-01-01T00:00:00Z', updatedAt: '', ...extra }
}

test('wbudowane role: id kalkulatora, nazwy jak w Profit, stawki z bieżącego cennika', () => {
  const pricing = pricingWith({ gafer: 1700 })
  const roles = builtInCrewRoles(pricing)
  assert.deepEqual(
    roles.map((r) => [r.id, r.group]),
    [
      ['rezOp', 'ekipa'],
      ['asystent', 'ekipa'],
      ['gafer', 'ekipa'],
      ['dzwiekowiec', 'ekipa'],
      ['mua', 'ekipa'],
      ['aktor', 'obsada'],
      ['model', 'obsada'],
      ['statysta', 'obsada'],
    ]
  )
  assert.equal(roles.find((r) => r.id === 'gafer')!.clientRate, 1700)
  assert.equal(roles.find((r) => r.id === 'statysta')!.clientRate, DEFAULT_PRICING.produkcja.statystaEpizodysta)

  // Nazwy i stawki = pozycje ekipy w zakładce Profit (CREW_ROLE_DEFS w profit-calc.ts).
  const day = { ...createDefaultShootingDay(), id: 'd1' } as Record<string, unknown>
  BUILT_IN_CREW_ROLES.forEach((r) => (day[r.id] = 1))
  const data = mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: [day as never] })
  const lines = resolveProfitSections(data, pricing, 0).sections.flatMap((s) => s.lines)
  roles.forEach((role) => {
    const line = lines.find((l) => l.key === `pro:d1:${role.id}`)
    assert.ok(line, `brak pozycji Profit dla ${role.id}`)
    assert.equal(line.label, role.name)
    assert.equal(line.unitCost, role.clientRate)
  })
  assert.equal(isBuiltInCrewRole('gafer'), true)
  assert.equal(isBuiltInCrewRole('cr-1'), false)
})

test('lista ról: bez pliku same wbudowane, zapis roli ją zastępuje, nowe role na końcu grupy', () => {
  assert.equal(resolveCrewRoles([], DEFAULT_PRICING).length, 8)

  const editedGafer: CrewRole = { id: 'gafer', name: 'Gaffer', clientRate: 1800, costRate: 1200, group: 'ekipa', order: 30 }
  const editor: CrewRole = { id: 'cr-1', name: 'Montażysta', clientRate: 1200, group: 'post', order: 10 }
  const drone: CrewRole = { id: 'cr-2', name: 'Operator drona', clientRate: 2000, group: 'ekipa', order: 35 }
  const weird: CrewRole = { id: 'cr-3', name: 'Coś', clientRate: 1, group: 'nowa-grupa', order: 0 }
  const roles = resolveCrewRoles([weird, editor, editedGafer, drone], pricingWith({ gafer: 9999 }))

  assert.equal(roles.length, 11, 'zapisany gafer nie dubluje wbudowanego')
  const gafer = roles.find((r) => r.id === 'gafer')!
  assert.equal(gafer.name, 'Gaffer')
  assert.equal(gafer.clientRate, 1800, 'edytowana rola nie idzie już za cennikiem')
  assert.deepEqual(
    roles.map((r) => r.id),
    ['rezOp', 'asystent', 'gafer', 'cr-2', 'dzwiekowiec', 'mua', 'aktor', 'model', 'statysta', 'cr-1', 'cr-3']
  )
})

test('wycofane role zostają na liście, ale nie w wyborze', () => {
  const retired: CrewRole = { id: 'mua', name: 'MUA', clientRate: 1200, group: 'ekipa', order: 50, retiredAt: '2026-10-01' }
  const roles = resolveCrewRoles([retired], DEFAULT_PRICING)
  assert.equal(roles.length, 8)
  assert.equal(activeCrewRoles(roles).some((r) => r.id === 'mua'), false)
})

test('nowa rola: na końcu swojej grupy, koszt opcjonalny', () => {
  const roles = resolveCrewRoles([], DEFAULT_PRICING)
  const post = createCrewRole({ name: ' Kolorysta ', group: 'post', clientRate: 1500 }, roles, NOW)
  assert.equal(post.name, 'Kolorysta')
  assert.equal(post.order, 10, 'pierwsza w pustej grupie')
  assert.equal('costRate' in post, false)
  assert.match(post.id, /^cr-/)
  const crew = createCrewRole({ name: 'Operator drona', clientRate: 2000, costRate: 1400 }, roles, NOW)
  assert.equal(crew.group, 'ekipa')
  assert.equal(crew.order, 60, 'za MUA (50)')
  assert.equal(crew.costRate, 1400)
})

test('rola po nazwie: bez wielkości liter, spacji i polskich znaków', () => {
  const roles = resolveCrewRoles([], DEFAULT_PRICING)
  assert.equal(crewRoleByName(roles, ' dzwiekowiec ')?.id, 'dzwiekowiec')
  assert.equal(crewRoleByName(roles, 'asystent/operator')?.id, 'asystent')
  assert.equal(crewRoleByName(roles, 'Nieznana'), null)
  assert.equal(crewRoleByName(roles, ''), null)
})

test('schemat roli: nieznana grupa i pola zostają, zła stawka → 0', () => {
  const raw = { id: 'cr-9', name: 'X', clientRate: 'dużo', group: 'vfx', order: 5, future: { a: 1 } }
  const parsed = crewRoleSchema.parse(raw)
  assert.equal(parsed.clientRate, 0)
  assert.equal(parsed.group, 'vfx')
  assert.deepEqual(parsed.future, { a: 1 })
  assert.equal('costRate' in parsed, false, 'brak kosztu zostaje brakiem')
})

test('schemat osoby: zły wpis roli znika, kontakt bez pól zostaje bez pól, nowsze pola przeżywają', () => {
  const complete = {
    id: 'cm-1',
    name: 'Łukasz',
    roleIds: ['gafer', 'cr-1'],
    rate: 900,
    contact: { phone: '+48 600 000 000', email: 'l@example.com', telegram: '@l' },
    city: 'Poznań',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    vat: true,
  }
  assert.deepEqual(crewMemberSchema.parse(complete), complete, 'pełny rekord przechodzi bez zmian')

  const messy = crewMemberSchema.parse({ id: 'cm-2', name: 'Piotr', roleIds: ['gafer', 7, '', null], rate: -5 })
  assert.deepEqual(messy.roleIds, ['gafer'])
  assert.equal(messy.rate, undefined)
  assert.deepEqual(messy.contact, {})
  assert.equal(crewMemberSchema.safeParse({ name: 'bez id' }).success, false)
})

test('osoba po imieniu: usunięci się nie liczą, najstarszy rekord wygrywa', () => {
  const people = [
    member('b', 'Piotr Kowalski', { createdAt: '2026-05-01T00:00:00Z' }),
    member('a', 'piotr kowalski', { createdAt: '2026-02-01T00:00:00Z' }),
    member('c', 'Ola', { deletedAt: 'T1' }),
  ]
  assert.equal(crewMemberByName(people, ' Piotr  Kowalski')?.id, 'a')
  assert.equal(crewMemberByName(people, 'Ola'), null)
  assert.equal(crewMemberByName(people, ''), null)
})

test('do wyboru tylko aktywni ludzie', () => {
  const people = [member('a', 'A'), member('b', 'B', { retiredAt: '2026-01-01' }), member('c', 'C', { deletedAt: 'T' })]
  assert.deepEqual(pickableCrewMembers(people).map((m) => m.id), ['a'])
})

test('nowa osoba: imię przycięte, role bez powtórzeń, zerowa stawka pominięta', () => {
  const m = createCrewMember({ name: ' Ola ', roleIds: ['gafer', 'gafer', 'mua'], rate: 0, city: '  ' }, NOW)
  assert.equal(m.name, 'Ola')
  assert.deepEqual(m.roleIds, ['gafer', 'mua'])
  assert.equal('rate' in m, false)
  assert.equal('city' in m, false)
  assert.deepEqual(m.contact, {})
  assert.equal(m.createdAt, NOW.toISOString())
  assert.match(m.id, /^cm-/)
  assert.equal(createCrewMember({ name: 'K', rate: 800 }, NOW).rate, 800)
})

test('koszt może wskazywać osobę z bazy; brak wskazania zostaje brakiem', () => {
  const linked = { id: 'pc-1', category: 'ekipa', unitCost: 800, person: 'Ola', personId: 'cm-1' }
  assert.deepEqual(projectCostSchema.parse(linked), linked)
  const free = { id: 'pc-2', category: 'ekipa', unitCost: 800, person: 'Ola' }
  assert.deepEqual(projectCostSchema.parse(free), free)
  assert.equal(projectCostSchema.parse({ ...free, personId: '' }).personId, undefined)
})
