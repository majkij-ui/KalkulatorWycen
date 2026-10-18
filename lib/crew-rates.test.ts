import { test } from 'node:test'
import assert from 'node:assert/strict'

import { costRowPersonPatch, costRowRolePatch } from './crew-rates'
import {
  createCrewMember,
  crewMemberById,
  crewMemberSchema,
  crewPickerOptions,
  normalizeRoleRates,
  personRateFor,
  personRoleRate,
  rolesForPerson,
  type CrewMember,
  type CrewRole,
} from './crew-types'
import {
  addKitCrewToQuote,
  createQuoteCrewLine,
  crewCostRate,
  kitCrewDayCosts,
  refreshCrewLines,
  staleCrewLines,
  withCrewPerson,
} from './quote-crew'

const OPERATOR: CrewRole = { id: 'cr-op', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1100, order: 10 }
const GAFFER: CrewRole = { id: 'gafer', name: 'Gafer', group: 'ekipa', clientRate: 1400, order: 30 }
const SOUND: CrewRole = { id: 'dzwiekowiec', name: 'Dźwiękowiec', group: 'ekipa', clientRate: 1300, costRate: 900, order: 40 }
const OLD: CrewRole = { id: 'cr-old', name: 'Steadicam', group: 'ekipa', clientRate: 2000, order: 50, retiredAt: '2026-01-01' }
const ROLES = [OPERATOR, GAFFER, SOUND, OLD]

function person(extra: Partial<CrewMember> = {}): CrewMember {
  return { id: 'cm-l', name: 'Łukasz', roleIds: ['cr-op', 'gafer'], contact: {}, createdAt: '', updatedAt: '', ...extra }
}

// Łukasz: jako operator 1 500 (z własnym sprzętem), ogólnie 1 200.
const LUKASZ = person({ rate: 1200, roleRates: [{ roleId: 'cr-op', rate: 1500, note: 'z własnym sprzętem' }] })

// ── Dane ─────────────────────────────────────────────────────────────────────

test('roleRates: dopisane pole, zły wpis znika, brak pola zostaje brakiem', () => {
  const parsed = crewMemberSchema.parse({
    id: 'cm-1',
    name: 'A',
    roleIds: [],
    roleRates: [{ roleId: 'cr-op', rate: 1500, note: 'x', extra: 1 }, { roleId: '', rate: 1 }, { roleId: 'g', rate: -5 }, 'śmieć'],
  })
  assert.deepEqual(parsed.roleRates, [{ roleId: 'cr-op', rate: 1500, note: 'x', extra: 1 }])
  const minimal = crewMemberSchema.parse({ id: 'cm-2', name: 'B', roleIds: [] })
  assert.equal('roleRates' in minimal, false, 'brak pola nie staje się pustą listą (npm run data)')
  assert.equal(crewMemberSchema.parse({ id: 'cm-3', roleRates: 'zle' }).roleRates?.length, 0)
})

test('normalizeRoleRates: jedna stawka na rolę (ostatnia wygrywa), 0 kasuje, notatka przycięta', () => {
  assert.deepEqual(
    normalizeRoleRates([
      { roleId: 'a', rate: 100, note: '  ze sprzętem ' },
      { roleId: 'b', rate: 200 },
      { roleId: 'a', rate: 150, note: '' },
      { roleId: 'b', rate: 0 },
      { roleId: 'c', rate: Number.NaN },
    ]),
    [{ roleId: 'a', rate: 150 }]
  )
  const created = createCrewMember({ name: 'X', roleRates: [{ roleId: 'a', rate: 0 }] })
  assert.equal('roleRates' in created, false)
  assert.deepEqual(createCrewMember({ name: 'X', roleRates: [{ roleId: 'a', rate: 90 }] }).roleRates, [{ roleId: 'a', rate: 90 }])
})

// ── Kolejność stawek ─────────────────────────────────────────────────────────

test('stawka osoby w roli → jej stawka ogólna → koszt roli → stawka roli', () => {
  assert.equal(personRoleRate(LUKASZ, 'cr-op'), 1500)
  assert.equal(personRoleRate(LUKASZ, 'gafer'), null)
  assert.equal(personRateFor(LUKASZ, 'cr-op'), 1500)
  assert.equal(personRateFor(LUKASZ, 'gafer'), 1200)
  assert.equal(personRateFor(person(), 'gafer'), null)
  assert.equal(personRateFor(person({ roleRates: [{ roleId: 'gafer', rate: 0 }] }), 'gafer'), null, 'stawka 0 = nieznana')

  assert.equal(crewCostRate(OPERATOR, LUKASZ), 1500)
  assert.equal(crewCostRate(GAFFER, LUKASZ), 1200)
  assert.equal(crewCostRate(SOUND, person()), 900, 'osoba bez stawek: koszt roli')
  assert.equal(crewCostRate(GAFFER, person()), 1400, 'rola bez kosztu: stawka roli')
  // Rola spoza bazy (zamrożona pozycja) — id z pozycji wciąż znajduje stawkę osoby.
  assert.equal(crewCostRate(null, LUKASZ, 999, 'cr-op'), 1500)
  assert.equal(crewCostRate(null, person(), 999, 'cr-op'), 999)
})

// ── Wycena ───────────────────────────────────────────────────────────────────

test('wycena: osoba w pozycji bierze swoją stawkę w tej roli — w „Koszt" i „Klient" (R1, A3)', () => {
  const op = createQuoteCrewLine(OPERATOR, LUKASZ)
  assert.equal(op.costRate, 1500)
  assert.equal(op.clientRate, 1500)
  // Gafer bez własnej stawki: stawka ogólna osoby w obie kwoty (dawniej klient = rola 1 400).
  const gaffer = withCrewPerson(createQuoteCrewLine(GAFFER), LUKASZ, GAFFER)
  assert.equal(gaffer.costRate, 1200)
  assert.equal(gaffer.clientRate, 1200)
  // Rola usunięta z bazy: osoba i tak liczy się po `roleId` pozycji.
  assert.equal(withCrewPerson(createQuoteCrewLine(OPERATOR), LUKASZ, null).costRate, 1500)
  // Zdjęcie osoby: koszt i cena roli.
  assert.equal(withCrewPerson(op, null, OPERATOR).costRate, 1100)
  assert.equal(withCrewPerson(op, null, OPERATOR).clientRate, 1500)
})

test('wycena: zmiana stawki w roli w bazie = pozycja nieaktualna; „zaktualizuj" bierze nową', () => {
  const line = createQuoteCrewLine(OPERATOR, LUKASZ)
  const raised = { ...LUKASZ, roleRates: [{ roleId: 'cr-op', rate: 1700 }] }
  assert.equal(staleCrewLines([{ crew: [line] }], ROLES, [LUKASZ]), 0)
  assert.equal(staleCrewLines([{ crew: [line] }], ROLES, [raised]), 1)
  assert.equal(refreshCrewLines([line], ROLES, [raised])![0].costRate, 1700)
})

test('zestawy: ekipa z zestawu po stawce osoby w roli — w wycenie i w Realizacji', () => {
  const kit = [
    { roleId: 'cr-op', personId: 'cm-l', qty: 1 },
    { roleId: 'gafer', personId: 'cm-l', qty: 1 },
  ]
  const lines = addKitCrewToQuote([], kit, ROLES, [LUKASZ])
  assert.deepEqual(
    lines.map((l) => [l.roleId, l.costRate]),
    [
      ['cr-op', 1500],
      ['gafer', 1200],
    ]
  )
  const rows = kitCrewDayCosts([{ roleId: 'cr-op', personId: 'cm-l', qty: 1 }], 'd1', [], ROLES, [LUKASZ])
  assert.equal(rows[0].unitCost, 1500)
})

// ── Realizacja ───────────────────────────────────────────────────────────────

test('Realizacja: wybór osoby — stawka w roli wiersza, potem ogólna, potem rola (gdy wiersz pusty)', () => {
  assert.deepEqual(costRowPersonPatch({ role: 'Operator', unitCost: 1100 }, LUKASZ, ROLES), {
    personId: 'cm-l',
    person: 'Łukasz',
    unitCost: 1500,
  })
  assert.equal(costRowPersonPatch({ role: 'gafer', unitCost: 0 }, LUKASZ, ROLES).unitCost, 1200)
  // Osoba bez stawek: pusty wiersz dostaje koszt roli, wpisana kwota zostaje.
  assert.equal(costRowPersonPatch({ role: 'Dźwiękowiec', unitCost: 0 }, person(), ROLES).unitCost, 900)
  assert.equal('unitCost' in costRowPersonPatch({ role: 'Dźwiękowiec', unitCost: 750 }, person(), ROLES), false)
  // Rola spoza bazy: stawka ogólna osoby albo bez zmiany.
  assert.equal(costRowPersonPatch({ role: 'Operator B', unitCost: 0 }, LUKASZ, ROLES).unitCost, 1200)
  assert.equal('unitCost' in costRowPersonPatch({ role: 'Operator B', unitCost: 0 }, person(), ROLES), false)
})

test('Realizacja: wiersz bez roli bierze pierwszą rolę osoby i jej stawkę w tej roli', () => {
  const patch = costRowPersonPatch({ role: '', unitCost: 0 }, LUKASZ, ROLES)
  assert.equal(patch.role, 'Operator')
  assert.equal(patch.unitCost, 1500)
  assert.equal(costRowPersonPatch({ role: '  ', unitCost: 0 }, LUKASZ, ROLES).role, 'Operator', 'same spacje = brak roli')
  const noRoles = costRowPersonPatch({ role: '  ', unitCost: 0 }, person({ roleIds: [], rate: 800 }), ROLES)
  assert.equal('role' in noRoles, false)
  assert.equal(noRoles.unitCost, 800)
})

test('Realizacja: zmiana roli przy osobie z bazy przenosi stawkę; ta sama rola inną pisownią i osoba spoza bazy — nie', () => {
  assert.deepEqual(costRowRolePatch({ role: 'Operator', unitCost: 1500 }, 'Gafer', LUKASZ, ROLES), {
    role: 'Gafer',
    unitCost: 1200,
  })
  assert.deepEqual(costRowRolePatch({ role: 'Operator', unitCost: 1650 }, 'operator ', LUKASZ, ROLES), { role: 'operator ' })
  assert.deepEqual(costRowRolePatch({ role: 'Gafer', unitCost: 1200 }, 'Gaf', LUKASZ, ROLES), { role: 'Gaf' })
  assert.deepEqual(costRowRolePatch({ role: '', unitCost: 0 }, 'Dźwiękowiec', null, ROLES), { role: 'Dźwiękowiec' })
  assert.equal(costRowRolePatch({ role: '', unitCost: 0 }, 'Dźwiękowiec', person(), ROLES).unitCost, 900)
})

test('listy wyboru: najpierw role osoby (także ze stawką bez roli na liście), osoby ze stawką w roli wśród „z rolą"', () => {
  const p = person({ roleIds: ['gafer', 'cr-old'], roleRates: [{ roleId: 'dzwiekowiec', rate: 1000 }] })
  const { own, others } = rolesForPerson(p, ROLES)
  assert.deepEqual(own.map((r) => r.id), ['gafer', 'cr-old', 'dzwiekowiec'])
  assert.deepEqual(others.map((r) => r.id), ['cr-op'], 'wycofana rola nie jest do wyboru dla innych')
  const { withRole, others: rest } = crewPickerOptions([p, person({ id: 'cm-2', name: 'Ola', roleIds: [] })], 'dzwiekowiec')
  assert.deepEqual(withRole.map((m) => m.id), ['cm-l'])
  assert.deepEqual(rest.map((m) => m.id), ['cm-2'])
})

test('crewMemberById: scalony duplikat prowadzi do osoby, która została; zwykłe usunięcie i pętla = brak', () => {
  const members: CrewMember[] = [
    person({ id: 'a' }),
    person({ id: 'b', deletedAt: 'x', mergedInto: 'a' }),
    person({ id: 'c', deletedAt: 'x', mergedInto: 'b' }),
    person({ id: 'd', deletedAt: 'x' }),
    person({ id: 'e', deletedAt: 'x', mergedInto: 'f' }),
    person({ id: 'f', deletedAt: 'x', mergedInto: 'e' }),
    // Żywa karta ze starym wskazaniem (np. po „Cofnij" w innej wersji) jest sobą.
    person({ id: 'g', mergedInto: 'a' }),
  ]
  assert.equal(crewMemberById(members, 'a')?.id, 'a')
  assert.equal(crewMemberById(members, 'b')?.id, 'a')
  assert.equal(crewMemberById(members, 'c')?.id, 'a')
  assert.equal(crewMemberById(members, 'd'), null)
  assert.equal(crewMemberById(members, 'e'), null)
  assert.equal(crewMemberById(members, 'g')?.id, 'g')
  assert.equal(crewMemberById(members, 'zz'), null)
  assert.equal(crewMemberById(members, undefined), null)
})
