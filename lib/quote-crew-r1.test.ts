/**
 * R1 „Ekipa w wycenie" (plan po jeździe próbnej §13, A1–A4): przypadki z tabeli
 * pokazanej M.J. 2026-10-18, każdy z testem. Dane jak w prawdziwej Ekipie
 * (Kamil: ReżOp 1 500, Asystent/Operator 1 200, ogólnie 1 200).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addKitCrewToQuote,
  createQuoteCrewLine,
  crewClientRate,
  defaultFirstDayCrew,
  refreshCrewLines,
  resetCrewAmount,
  staffCrewLine,
  staleCrewLines,
  withCrewAmount,
  withCrewPerson,
  withCrewRole,
} from './quote-crew'
import {
  createCrewMember,
  crewMemberSchema,
  isSelfCrewMember,
  selfCrewMember,
  withSelfRule,
  type CrewMember,
  type CrewRole,
} from './crew-types'
import { crewAfterMerge, crewAfterUnmerge, planCrewMerge } from './crew-merge'
import { computeCrewStats, crewPaidThisYear, crewRanking } from './crew-stats'
import { clientQuoteData, quoteMoney, priceFromPln, priceToPln, switchQuoteCurrency } from './quote-currency'
import { mergeQuoteDataPartial } from './quote-financials'
import { createDefaultShootingDay, type QuoteCrewLine } from './quote-types'
import type { Project, ProjectCost } from './project-types'

const REZOP: CrewRole = { id: 'rezOp', name: 'ReżOp', group: 'ekipa', clientRate: 1500, order: 10 }
const OPERATOR: CrewRole = { id: 'asystent', name: 'Operator', group: 'ekipa', clientRate: 1500, order: 20 }
const ASYSTENT: CrewRole = { id: 'cr-r1-asystent', name: 'Asystent', group: 'ekipa', clientRate: 1500, order: 25 }
const SOUND: CrewRole = { id: 'dzwiekowiec', name: 'Dźwiękowiec', group: 'ekipa', clientRate: 1500, costRate: 1100, order: 40 }
const ROLES = [REZOP, OPERATOR, ASYSTENT, SOUND]

function person(id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember {
  return { id, name, roleIds: [], contact: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra }
}

const KAMIL = person('cm-kamil', 'Kamil', {
  rate: 1200,
  roleIds: ['rezOp', 'asystent', 'cr-r1-asystent'],
  roleRates: [
    { roleId: 'rezOp', rate: 1500, note: 'DOP' },
    { roleId: 'asystent', rate: 1200, note: 'Op' },
    { roleId: 'cr-r1-asystent', rate: 1000, note: 'Asystent' },
  ],
})
const ME = person('cm-r1-ja', 'Michał', {
  self: true,
  roleIds: ['rezOp', 'asystent', 'cr-r1-asystent'],
  roleRates: [
    { roleId: 'rezOp', rate: 1500 },
    { roleId: 'asystent', rate: 1500 },
    { roleId: 'cr-r1-asystent', rate: 1500 },
  ],
})
const NEWBIE = person('cm-new', 'Ola') // bez żadnych stawek

const placeholder = (role: CrewRole, qty = 1) => createQuoteCrewLine(role, null, qty)

// ── A3: dwie kwoty w wierszu ────────────────────────────────────────────────

test('Kamil jako Operator (rola 1 500): Koszt 1 200 i Klient 1 200', () => {
  const line = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  assert.equal(line.length, 1)
  assert.deepEqual([line[0].costRate, line[0].clientRate, line[0].qty], [1200, 1200, 1])
  assert.equal(line[0].clientFromPerson, true)
  // Ten sam wynik przy nowej pozycji od razu z osobą (zestaw, dzień 1).
  const direct = createQuoteCrewLine(OPERATOR, KAMIL)
  assert.deepEqual([direct.costRate, direct.clientRate], [1200, 1200])
})

test('osoba bez stawki w tej roli: jej stawka ogólna w obie kwoty; bez żadnych stawek — kwoty roli', () => {
  const sound = withCrewPerson(placeholder(SOUND), KAMIL, SOUND)
  assert.deepEqual([sound.costRate, sound.clientRate], [1200, 1200], 'Kamil jako Dźwiękowiec: 1 200 ogólnie')
  const fresh = withCrewPerson(placeholder(SOUND), NEWBIE, SOUND)
  assert.deepEqual([fresh.costRate, fresh.clientRate], [1100, 1500], 'koszt roli 1 100, klient rola 1 500')
  assert.equal(crewClientRate(null, NEWBIE, 900, 'x'), 900, 'bez roli i stawek: kwota z pozycji')
})

test('ręcznie tylko Klient, potem tylko Koszt: każda kwota osobno, druga nie idzie za nią', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const client = withCrewAmount(line, 'client', 1400)
  assert.deepEqual([client.clientRate, client.costRate, client.clientEdited, client.costEdited], [1400, 1200, true, undefined])
  const both = withCrewAmount(client, 'cost', 1000)
  assert.deepEqual([both.clientRate, both.costRate, both.clientEdited, both.costEdited], [1400, 1000, true, true])
  assert.equal(withCrewAmount(line, 'cost', -50).costRate, 0, 'kwota ujemna = 0')
})

test('zmiana roli po ręcznej zmianie: obie kwoty od nowa z nowej roli, osoba zostaje (M.J. 3)', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const edited = withCrewAmount(withCrewAmount(line, 'client', 1400), 'cost', 1000)
  const moved = withCrewRole(edited, REZOP, KAMIL)
  assert.deepEqual([moved.roleId, moved.roleName, moved.personId], ['rezOp', 'ReżOp', 'cm-kamil'])
  assert.deepEqual([moved.costRate, moved.clientRate], [1500, 1500])
  assert.equal('clientEdited' in moved || 'costEdited' in moved, false, 'znaczniki ręcznych kwot znikają')
  // Rola, w której Kamil nie ma własnej stawki: jego ogólna 1 200, nie stawka roli 1 500.
  const sound = withCrewRole(edited, SOUND, KAMIL)
  assert.deepEqual([sound.costRate, sound.clientRate], [1200, 1200])
  // Miejsce do obsadzenia: kwoty nowej roli.
  const seat = withCrewRole(withCrewAmount(placeholder(OPERATOR), 'client', 999), SOUND, null)
  assert.deepEqual([seat.clientRate, seat.costRate, seat.roleName], [1500, 1100, 'Dźwiękowiec'])
})

test('inna osoba po ręcznej zmianie: obie kwoty od nowa z jej stawki', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const edited = withCrewAmount(line, 'client', 1400)
  const [swapped] = staffCrewLine(edited, ME, OPERATOR)
  assert.deepEqual([swapped.personName, swapped.costRate, swapped.clientRate, swapped.clientEdited], ['Michał', 1500, 1500, undefined])
})

test('„zaktualizuj stawki" po ręcznej zmianie: wpisane kwoty zostają, reszta z bazy; licznik ich nie liczy', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const edited = withCrewAmount(line, 'client', 1400)
  const raised = { ...KAMIL, roleRates: KAMIL.roleRates!.map((r) => (r.roleId === 'asystent' ? { ...r, rate: 1300 } : r)) }
  assert.equal(staleCrewLines([{ crew: [edited] }], ROLES, [KAMIL]), 0, 'sama ręczna kwota to nie „inna stawka niż baza"')
  assert.equal(staleCrewLines([{ crew: [edited] }], ROLES, [raised]), 1, 'Koszt (nie ręczny) idzie za bazą')
  const [next] = refreshCrewLines([edited], ROLES, [raised])!
  assert.deepEqual([next.clientRate, next.costRate, next.clientEdited], [1400, 1300, true])
  // Bez ręcznej zmiany obie kwoty za stawką osoby.
  const [plain] = refreshCrewLines([line], ROLES, [raised])!
  assert.deepEqual([plain.clientRate, plain.costRate], [1300, 1300])
  // Ręczny Koszt też zostaje.
  const [cost] = refreshCrewLines([withCrewAmount(line, 'cost', 900)], ROLES, [raised])!
  assert.deepEqual([cost.clientRate, cost.costRate], [1300, 900])
})

test('↺ przy ręcznej kwocie: znowu z Ekipy (stawka osoby w roli, a miejsce — rola)', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const edited = withCrewAmount(withCrewAmount(line, 'client', 1400), 'cost', 900)
  const client = resetCrewAmount(edited, 'client', OPERATOR, KAMIL)
  assert.deepEqual([client.clientRate, client.costRate, 'clientEdited' in client, client.costEdited], [1200, 900, false, true])
  const cost = resetCrewAmount(client, 'cost', OPERATOR, KAMIL)
  assert.deepEqual([cost.costRate, 'costEdited' in cost], [1200, false])
  const seat = resetCrewAmount(withCrewAmount(placeholder(SOUND), 'cost', 50), 'cost', SOUND, null)
  assert.equal(seat.costRate, 1100)
  // Osoba usunięta z bazy: ↺ zostawia zamrożoną kwotę (zdejmuje tylko znacznik).
  const gone = resetCrewAmount(edited, 'client', OPERATOR, { ...KAMIL, deletedAt: '2026-10-10' })
  assert.deepEqual([gone.clientRate, 'clientEdited' in gone], [1400, false])
  // Pozycja sprzed R1 z ręcznym Klientem staje się pozycją R1 — ↺ bierze stawkę osoby.
  const legacy: QuoteCrewLine = { id: 'q', roleId: 'asystent', roleName: 'Asystent/Operator', personId: 'cm-kamil', personName: 'Kamil', clientRate: 1500, costRate: 1200, qty: 1 }
  const touched = withCrewAmount(legacy, 'client', 1450)
  assert.equal(touched.clientFromPerson, true)
  assert.equal(resetCrewAmount(touched, 'client', OPERATOR, KAMIL).clientRate, 1200)
})

test('liczba osób 2: kwoty za osobodzień; wybór osoby zostawia drugie miejsce do obsadzenia', () => {
  const seat = withCrewAmount(placeholder(OPERATOR, 2), 'client', 1600)
  const [staffed, rest] = staffCrewLine(seat, KAMIL, OPERATOR)
  assert.deepEqual([staffed.personName, staffed.qty, staffed.clientRate], ['Kamil', 1, 1200])
  assert.deepEqual([rest.personId, rest.qty, rest.clientRate, rest.clientEdited], [undefined, 1, 1600, true])
  assert.notEqual(rest.id, staffed.id)
  assert.equal(staffCrewLine(placeholder(OPERATOR, 3), KAMIL, OPERATOR)[1].qty, 2)
  assert.equal(staffCrewLine(staffed, ME, OPERATOR).length, 1, 'zamiana osoby nie dokłada miejsca')
  assert.equal(staffCrewLine(seat, null, OPERATOR).length, 1)
})

test('wycena w EUR: Klient w pełnych euro (zapis w zł jak S3), Koszt w zł', () => {
  const [line] = staffCrewLine(placeholder(OPERATOR), KAMIL, OPERATOR)
  const day = { ...createDefaultShootingDay(), id: 'd1', crew: [line] }
  const data = switchQuoteCurrency(mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: [day] }), 'EUR', { rate: 4.3699 })
  const money = quoteMoney(data)
  const shown = clientQuoteData(data, money).detailedShootingDays[0].crew![0]
  assert.equal(shown.clientRate, 275, '1 200 zł → 275 €')
  assert.equal(shown.costRate, 1200, 'koszt w zł')
  // Wpisane 300 € wraca jako dokładnie 300 €.
  const typed = withCrewAmount(line, 'client', priceToPln(300, money))
  assert.equal(priceFromPln(typed.clientRate, money), 300)
})

test('zestaw z osobą: pozycja po R1 (obie kwoty ze stawki osoby)', () => {
  const next = addKitCrewToQuote([], [{ roleId: 'asystent', personId: 'cm-kamil', qty: 1 }], ROLES, [KAMIL])
  assert.deepEqual([next[0].clientRate, next[0].costRate], [1200, 1200])
})

// ── A1: „Ja" w Ekipie ───────────────────────────────────────────────────────

test('„Ja": pole self przechodzi przez schemat; zły typ znika; najwyżej jeden żywy Ja', () => {
  assert.equal(crewMemberSchema.parse(ME).self, true)
  assert.equal('self' in crewMemberSchema.parse({ ...KAMIL, self: 'tak' }), true)
  assert.equal(crewMemberSchema.parse({ ...KAMIL, self: 'tak' }).self, undefined)
  assert.equal(selfCrewMember([KAMIL, ME])?.id, 'cm-r1-ja')
  assert.equal(selfCrewMember([KAMIL, { ...ME, deletedAt: 'T' }]), null, 'usunięty Ja się nie liczy')
  const older = { ...KAMIL, self: true, createdAt: '2025-01-01T00:00:00.000Z' }
  assert.equal(selfCrewMember([ME, older])?.id, 'cm-kamil', 'dwóch Ja (np. po „Cofnij"): najstarsza karta')
  assert.equal(isSelfCrewMember(ME) && !isSelfCrewMember(KAMIL), true)
  assert.equal(createCrewMember({ name: 'Ja', self: true }).self, true)
  assert.equal('self' in createCrewMember({ name: 'Ktoś' }), false)
})

test('„Ja" na drugiej karcie przenosi oznaczenie (jeden zapis); zapis bez self nikogo nie rusza', () => {
  const moved = withSelfRule([KAMIL, ME], { ...KAMIL, self: true }, 'NOW')
  assert.deepEqual(moved.map((m) => [m.id, m.self ?? false]), [['cm-kamil', true], ['cm-r1-ja', false]])
  assert.equal(moved[1].updatedAt, 'NOW')
  assert.equal('self' in moved[1], false)
  const plain = withSelfRule([KAMIL, ME], { ...KAMIL, notes: 'x' }, 'NOW')
  assert.equal(plain[1], ME, 'Ja nietknięty')
  const added = withSelfRule([KAMIL, ME], { ...NEWBIE, self: true }, 'NOW')
  assert.deepEqual(added.map((m) => m.self === true), [false, false, true])
})

test('„Scal osoby" z Ja: karta, która zostaje, jest Ja; „Cofnij" przywraca oba oznaczenia', () => {
  const dup = person('cm-dup', 'Michał J.', { self: true, createdAt: '2026-10-02T00:00:00.000Z' })
  const plain = { ...ME, self: undefined }
  delete plain.self
  const members = [plain, dup]
  const plan = planCrewMerge({ members, targetId: plain.id, sourceIds: [dup.id], projects: [], kits: [], at: '2026-10-18T10:00:00.000Z' })!
  assert.equal(plan.merged.self, true)
  const after = crewAfterMerge(members, plan)
  assert.equal(selfCrewMember(after)?.id, plain.id)
  const undone = crewAfterUnmerge(after, plan, '2026-10-18T11:00:00.000Z')
  assert.equal(selfCrewMember(undone)?.id, dup.id)
  assert.equal(undone.find((m) => m.id === plain.id)?.self, undefined)
  // Ja scala duplikat bez flagi: zostaje Ja.
  const keep = planCrewMerge({ members: [ME, person('cm-x', 'Michał')], targetId: ME.id, sourceIds: ['cm-x'], projects: [], kits: [], at: 'T' })!
  assert.equal(keep.merged.self, true)
})

// ── A2: dzień 1 nowej wyceny ────────────────────────────────────────────────

test('dzień 1 od zera: „ReżOp · Ja" po moich stawkach; bez Ja miejsce ReżOp; ReżOp wycofany — pusto', () => {
  const [mine] = defaultFirstDayCrew(ROLES, [KAMIL, ME])
  assert.deepEqual([mine.roleId, mine.roleName, mine.personId, mine.costRate, mine.clientRate, mine.qty], ['rezOp', 'ReżOp', 'cm-r1-ja', 1500, 1500, 1])
  const [seat] = defaultFirstDayCrew(ROLES, [KAMIL])
  assert.deepEqual([seat.roleId, seat.personId, seat.clientRate, seat.costRate], ['rezOp', undefined, 1500, 1500])
  assert.equal(defaultFirstDayCrew(ROLES, [{ ...ME, retiredAt: '2026-01-01' }])[0].personId, undefined, 'Ja wycofany = miejsce')
  assert.deepEqual(defaultFirstDayCrew([{ ...REZOP, retiredAt: '2026-01-01' }, OPERATOR], [ME]), [])
})

test('Ja wynajęty na cudzej produkcji jako Asystent: rola dnia 1 → Asystent, obie kwoty z mojej stawki', () => {
  const [mine] = defaultFirstDayCrew(ROLES, [ME])
  const hired = withCrewRole(mine, ASYSTENT, ME)
  assert.deepEqual([hired.roleName, hired.personName, hired.costRate, hired.clientRate], ['Asystent', 'Michał', 1500, 1500])
})

// ── Statystyki Ekipy z Ja ───────────────────────────────────────────────────

function project(id: string, costs: ProjectCost[]): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-10-05',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    gearDays: [{ id: 'd1', label: '', date: '2026-10-05', lines: [] }],
    costs,
  }
}

test('statystyki: Ja ma dni w rolach (także jako Asystent u kogoś), ale nie jest w rankingu ani w „wypłacone"', () => {
  const projects = [
    project('p-own', [
      { id: 'c1', category: 'ekipa', role: 'ReżOp', person: 'Michał', personId: ME.id, quantity: 1, unitCost: 1500, dayId: 'd1' },
      { id: 'c2', category: 'ekipa', role: 'Operator', person: 'Kamil', personId: KAMIL.id, quantity: 1, unitCost: 1200, dayId: 'd1' },
    ]),
    project('p-hired', [
      { id: 'c3', category: 'ekipa', role: 'Asystent', person: 'Michał', personId: ME.id, quantity: 1, unitCost: 1500, dayId: 'd1' },
    ]),
  ]
  const stats = computeCrewStats([KAMIL, ME], projects, { now: new Date(2026, 9, 18) })
  const mine = stats.get(ME.id)!
  assert.equal(mine.days, 2)
  assert.deepEqual(mine.roles.map((r) => [r.name, r.days]).sort(), [['Asystent', 1], ['ReżOp', 1]])
  assert.deepEqual(crewRanking([KAMIL, ME], stats).map((r) => r.member.id), ['cm-kamil'])
  assert.equal(crewPaidThisYear([KAMIL, ME], stats), 1200)
})
