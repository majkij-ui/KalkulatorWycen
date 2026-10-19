/**
 * R2 — Realizacja: szkic z planu, pierwsza zmiana, zmiany wyceny, koszty sprzed
 * R2 i układ zakładki (plan §13.1 B2, B3, D1; decyzja Q2 wariant A).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectMoney } from './money-loop'
import { costAmount, totalActualCosts, totalOwnWork, liveCosts } from './project-costs'
import type { ProjectCost } from './project-types'
import { computeSnapshotFinancials } from './quote-financials'
import { createQuoteCrewLine, kitCrewFromDayCosts } from './quote-crew'
import { crewRoleByName } from './crew-types'
import { createDefaultShootingDay, type QuoteData } from './quote-types'
import {
  addPlanRow,
  applyQuoteChanges,
  draftCosts,
  editPatch,
  layoutRealization,
  missingFromQuote,
  planKeyDay,
  quoteChanges,
  quotePlanRows,
  realizationMode,
  restartFromQuote,
  startFromQuote,
  tickPatch,
  workPatch,
} from './realization-costs'

const NOW = new Date('2026-10-18T12:00:00.000Z')
const ROLE = { id: 'rezOp', name: 'ReżOp', group: 'ekipa', clientRate: 1500, costRate: 1500 }
const OPERATOR = { id: 'asystent', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1200 }
const ME = { id: 'cm-ja', name: 'Michał', self: true as const, rate: 1500, roleRates: [] }
const KAMIL = { id: 'cm-kamil', name: 'Kamil', rate: 1200, roleRates: [] }

/** Wycena jak u M.J.: dzień 1 — ReżOp · Ja, Kamil, 2 × Operator (miejsca), wypożyczalnia; dzień 2 — Kamil. */
function snapshot(extra: Partial<QuoteData> = {}) {
  const me = { ...createQuoteCrewLine(ROLE, ME), id: 'qc-me' }
  const kamil = { ...createQuoteCrewLine(OPERATOR, KAMIL), id: 'qc-kamil' }
  const seats = { ...createQuoteCrewLine(OPERATOR, null, 2), id: 'qc-seats' }
  const day1 = { ...createDefaultShootingDay(), id: 'd1', crew: [me, kamil, seats], externalRentals: [{ id: 'r1', label: 'Aputure 600', amount: 400 }] }
  const day2 = { ...createDefaultShootingDay(), id: 'd2', crew: [{ ...createQuoteCrewLine(OPERATOR, KAMIL), id: 'qc-k2' }] }
  return {
    data: {
      isDetailedProdukcja: true,
      detailedShootingDays: [day1, day2],
      dniDokumentacji: 1,
      kosztDojazduKm: 100,
      crudeEditCount: 2,
      profitOverrides: { 'pre:dokumentacja': { isCost: false } },
      ...extra,
    } as Partial<QuoteData>,
    marginMultiplier: 1,
  }
}

const sum = (costs: ProjectCost[]) => totalActualCosts(costs)

// ── Szkic z planu ────────────────────────────────────────────────────────────

test('szkic = plan: suma kosztów i mojej pracy jak w finansach, „× 2" to dwa miejsca, osoba z wyceny w wierszu', () => {
  const snap = snapshot()
  const f = computeSnapshotFinancials(snap, NOW)!
  const { rows, quoteDayIds } = quotePlanRows(snap)
  assert.deepEqual(quoteDayIds, ['d1', 'd2'])
  const draft = draftCosts(rows, ['day-a', 'day-b'])
  assert.equal(sum(draft), f.koszty)
  assert.equal(totalOwnWork(draft), f.ownWork)
  assert.equal(f.ownWork, 1500)
  const seats = draft.filter((c) => c.planKey?.startsWith('pro:d1:crew:qc-seats'))
  assert.deepEqual(seats.map((c) => [c.planKey, c.quantity, c.person, c.dayId]), [
    ['pro:d1:crew:qc-seats', 1, '', 'day-a'],
    ['pro:d1:crew:qc-seats#2', 1, '', 'day-a'],
  ])
  const me = draft.find((c) => c.planKey === 'pro:d1:crew:qc-me')!
  assert.deepEqual([me.person, me.personId, me.role, me.ownWork, me.category], ['Michał', 'cm-ja', 'ReżOp', true, 'ekipa'])
  const rental = draft.find((c) => c.planKey === 'pro:d1:rental:r1')!
  assert.deepEqual([rental.category, rental.dayId, rental.unitCost], ['wynajem', 'day-a', 400])
  assert.equal(draft.find((c) => c.planKey === 'pro:d2:crew:qc-k2')!.dayId, 'day-b')
  assert.equal(draft.find((c) => c.planKey === 'pre:dokumentacja')!.skipped, true, 'odznaczone w Profit = odznaczone')
  assert.equal(draft.some((c) => c.planKey === 'pro:rentalSprzetu'), false, 'pusty „Rental sprzętu" nie wchodzi')
  assert.ok(draft.every((c) => c.id.startsWith('draft:')))
})

test('osoba z wyceny przy pozycji „× 2" (ilość podniesiona w planie) siedzi tylko w pierwszym wierszu', () => {
  const kamil = { ...createQuoteCrewLine(OPERATOR, KAMIL), id: 'qc-k' }
  const day = { ...createDefaultShootingDay(), id: 'd1', crew: [kamil] }
  const snap = {
    data: { isDetailedProdukcja: true, detailedShootingDays: [day], profitOverrides: { 'pro:d1:crew:qc-k': { quantity: 2 } } } as Partial<QuoteData>,
    marginMultiplier: 1,
  }
  const rows = quotePlanRows(snap).rows.filter((r) => r.category === 'ekipa')
  assert.deepEqual(rows.map((r) => [r.planKey, r.person, r.personId ?? null]), [
    ['pro:d1:crew:qc-k', 'Kamil', 'cm-kamil'],
    ['pro:d1:crew:qc-k#2', '', null],
  ])
})

test('tryb: same usunięte wiersze = szkic (Finanse liczą wtedy plan)', () => {
  assert.equal(realizationMode({ costs: [{ id: 'x', category: 'inne', unitCost: 5, deletedAt: '2026-10-01' }], costsFromQuoteAt: '2026-10-01' }), 'draft')
})

test('zmiana wyceny przy odznaczonej mojej pracy: moja praca się nie zmienia', () => {
  const costs = started().map((c) => (c.planKey === 'pro:d1:crew:qc-me' ? { ...c, skipped: true as const } : c))
  const snap = snapshot()
  const me = (snap.data.detailedShootingDays as { crew: { id: string; costRate: number }[] }[])[0].crew.find((l) => l.id === 'qc-me')!
  me.costRate = 1800
  const diff = quoteChanges(costs, quotePlanRows(snap).rows, ['day-a', 'day-b'])
  assert.deepEqual([diff.changed, diff.ownDelta], [1, 1800])
})

test('układ: „Koszty projektu" na górze, dni — ekipa i wypożyczalnia; dzień wyceny bez dnia Realizacji osobno', () => {
  const { rows, quoteDayIds } = quotePlanRows(snapshot())
  const draft = draftCosts(rows, ['day-a'])
  const layout = layoutRealization(draft, ['day-a'], quoteDayIds)
  assert.deepEqual(layout.project.map((c) => c.category).sort(), ['dojazd', 'postprodukcja', 'preprodukcja'])
  assert.equal(layout.byDay.get('day-a')!.length, 5, 'dzień 1: ja, Kamil, 2 miejsca, wypożyczalnia')
  assert.deepEqual(layout.unassigned.map((g) => [g.quoteDay, g.costs.map((c) => c.planKey)]), [[1, ['pro:d2:crew:qc-k2']]])
})

test('szybka wycena: ekipa to jedna pozycja nad dniami (wszystkie dni), wynajem na całość w „Kosztach projektu"', () => {
  const snap = { data: { dniZdjeciowe: 2, wielkoscEkipy: 2, profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 540 } } }, marginMultiplier: 1 }
  const { rows } = quotePlanRows(snap)
  const draft = draftCosts(rows, ['day-a', 'day-b'])
  const layout = layoutRealization(draft, ['day-a', 'day-b'], [])
  assert.deepEqual(layout.unassigned.map((g) => [g.quoteDay, g.costs.map((c) => c.role)]), [[null, ['Ekipa (szybka wycena)']]])
  const rent = layout.project.find((c) => c.planKey === 'pro:rentalSprzetu')!
  assert.deepEqual([rent.category, rent.label, rent.unitCost], ['wynajem', 'Wynajem sprzętu', 540])
  assert.equal(sum(draft), computeSnapshotFinancials(snap, NOW)!.koszty)
})

test('planKeyDay: dzienne, szybka wycena, całość projektu, kopie', () => {
  assert.equal(planKeyDay('pro:d1:crew:qc-1#3'), 'd1')
  assert.equal(planKeyDay('pro:d1:rental:r1'), 'd1')
  assert.equal(planKeyDay('pro:d1:asystent'), 'd1')
  assert.equal(planKeyDay('pro:quick:ekipa'), 'quick')
  assert.equal(planKeyDay('pro:rentalSprzetu'), null)
  assert.equal(planKeyDay('log:dojazd'), null)
  assert.equal(planKeyDay(undefined), null)
})

// ── Pierwsza zmiana ──────────────────────────────────────────────────────────

test('pierwsza zmiana zapisuje cały szkic (klucze planu, źródło plan) — suma bez zmian, Finanse z Realizacji', () => {
  const snap = snapshot()
  const f = computeSnapshotFinancials(snap, NOW)!
  const { rows } = quotePlanRows(snap)
  assert.equal(realizationMode({ costs: [] }), 'draft')
  const started = startFromQuote([], rows, ['day-a', 'day-b'], NOW)
  assert.equal(started.costs.length, rows.length)
  assert.ok(started.costs.every((c) => c.planKey && c.source === 'plan' && !c.id.startsWith('draft:') && !c.edited))
  assert.equal(sum(started.costs), f.koszty)
  assert.equal(started.ids.get('pro:d1:crew:qc-me'), started.costs.find((c) => c.planKey === 'pro:d1:crew:qc-me')!.id)
  assert.equal(realizationMode({ costs: started.costs, costsFromQuoteAt: started.startedAt }), 'quote')
  const money = projectMoney({ id: 'p', status: 'won', date: '2026-10-01', financials: f, costs: started.costs }, [], '2026-10-18')
  assert.deepEqual([money.costsBasis, money.costs, money.ownWork], ['actual', f.koszty, 1500])
})

test('zaznaczenie, kwota i „Moja praca" na wierszu z planu oznaczają go jako zmieniony ręcznie', () => {
  const plan = { planKey: 'k' }
  assert.deepEqual(tickPatch(plan, false), { skipped: true, edited: true })
  assert.deepEqual(tickPatch(plan, true), { skipped: undefined, edited: true })
  assert.deepEqual(workPatch(plan, true), { ownWork: true, edited: true })
  assert.deepEqual(workPatch({}, false), { ownWork: undefined }, 'wiersz dopisany ręcznie nie potrzebuje znacznika')
  assert.deepEqual(editPatch(plan, { unitCost: 900 }), { unitCost: 900, edited: true })
})

// ── Zmiany wyceny po starcie ─────────────────────────────────────────────────

function started() {
  const { rows } = quotePlanRows(snapshot())
  return startFromQuote([], rows, ['day-a', 'day-b'], NOW).costs
}

test('wycena zmieniona po starcie: nowe, zmienione i usunięte pozycje — tylko wiersze nigdy nie zmienione ręcznie', () => {
  let costs = started()
  // Ręcznie: Kamil dnia 1 za 1 000 zł.
  const kamil = costs.find((c) => c.planKey === 'pro:d1:crew:qc-kamil')!
  costs = costs.map((c) => (c.id === kamil.id ? { ...c, unitCost: 1000, edited: true as const } : c))
  // Wycena teraz: bez wypożyczalni, 3 dni montażu zamiast 2, dzień 2 bez Kamila, za to Kamil dnia 1 droższy.
  const snap = snapshot()
  const day1 = (snap.data.detailedShootingDays as { id: string; crew: { id: string; costRate: number }[]; externalRentals?: unknown[] }[])[0]
  day1.externalRentals = []
  day1.crew = day1.crew.map((l) => (l.id === 'qc-kamil' ? { ...l, costRate: 1400 } : l))
  ;(snap.data.detailedShootingDays as { crew: unknown[] }[])[1].crew = []
  snap.data.crudeEditCount = 3
  snap.data.kosztDojazduKm = 100
  const { rows } = quotePlanRows({ ...snap, data: { ...snap.data, wizjaLokalna: true, isDetailedPrepro: false } })
  const diff = quoteChanges(costs, rows, ['day-a', 'day-b'])
  const types = diff.changes.map((c) => `${c.type}:${c.planKey}`).sort()
  assert.deepEqual(types, ['changed:post:montaz', 'removed:pro:d1:rental:r1', 'removed:pro:d2:crew:qc-k2'])
  assert.deepEqual([diff.added, diff.changed, diff.removed], [0, 1, 2])
  const before = sum(costs)
  const after = applyQuoteChanges(costs, diff.changes, ['day-a', 'day-b'], NOW)
  assert.equal(sum(after) - before, diff.delta)
  assert.equal(after.find((c) => c.id === kamil.id)!.unitCost, 1000, 'ręczna kwota przeżywa')
  assert.equal(after.filter((c) => c.deletedAt).length, 2, 'usunięte z wyceny — miękko')
  assert.equal(quoteChanges(after, rows, ['day-a', 'day-b']).changes.length, 0, 'po „Uwzględnij" nic nie zostaje')
})

test('nowa pozycja w wycenie → „dodana" w swoim dniu; usunięty ręcznie wiersz nie wraca jako nowy', () => {
  let costs = started()
  const removed = costs.find((c) => c.planKey === 'log:dojazd')!
  costs = costs.map((c) => (c.id === removed.id ? { ...c, deletedAt: NOW.toISOString() } : c))
  const snap = snapshot()
  ;(snap.data.detailedShootingDays as { crew: unknown[] }[])[1].crew.push({ ...createQuoteCrewLine(ROLE, null), id: 'qc-new' })
  const { rows } = quotePlanRows(snap)
  const diff = quoteChanges(costs, rows, ['day-a', 'day-b'])
  assert.deepEqual(diff.changes.map((c) => `${c.type}:${c.planKey}`), ['added:pro:d2:crew:qc-new'])
  assert.equal(diff.delta, 1500)
  const after = applyQuoteChanges(costs, diff.changes, ['day-a', 'day-b'], NOW)
  assert.equal(after.find((c) => c.planKey === 'pro:d2:crew:qc-new')!.dayId, 'day-b')
})

test('nowy dzień „ReżOp · Ja" w wycenie: koszty bez zmian, moja praca +1 500 zł', () => {
  const costs = started()
  const snap = snapshot()
  ;(snap.data.detailedShootingDays as { crew: unknown[] }[])[1].crew.push({ ...createQuoteCrewLine(ROLE, ME), id: 'qc-me2' })
  const diff = quoteChanges(costs, quotePlanRows(snap).rows, ['day-a', 'day-b'])
  assert.deepEqual([diff.added, diff.delta, diff.ownDelta], [1, 0, 1500])
  const dropped = snapshot()
  ;(dropped.data.detailedShootingDays as { crew: { id: string }[] }[])[0].crew = (dropped.data.detailedShootingDays as { crew: { id: string }[] }[])[0].crew.filter((l) => l.id !== 'qc-me')
  assert.equal(quoteChanges(costs, quotePlanRows(dropped).rows, ['day-a', 'day-b']).ownDelta, -1500)
})

test('„Ukryj" trzyma podpis listy: ten sam przy tej samej wycenie, inny po kolejnej zmianie', () => {
  const costs = started()
  const a = snapshot({ crudeEditCount: 3 })
  const b = snapshot({ crudeEditCount: 4 })
  const sigA = quoteChanges(costs, quotePlanRows(a).rows, ['day-a', 'day-b']).signature
  assert.equal(quoteChanges(costs, quotePlanRows(a).rows, ['day-a', 'day-b']).signature, sigA)
  assert.notEqual(quoteChanges(costs, quotePlanRows(b).rows, ['day-a', 'day-b']).signature, sigA)
  assert.equal(quoteChanges(costs, quotePlanRows(snapshot()).rows, ['day-a', 'day-b']).signature, '', 'bez zmian — pusty podpis')
})

test('inny wariant wybrany do rozliczeń (inne dni wyceny): jego pozycje to zmiany, nic nie wchodzi samo', () => {
  const costs = started()
  const other = snapshot()
  ;(other.data.detailedShootingDays as { id: string }[]).forEach((d, i) => (d.id = `v${i}`))
  const diff = quoteChanges(costs, quotePlanRows(other).rows, ['day-a', 'day-b'])
  assert.ok(diff.added > 0 && diff.removed > 0)
  assert.equal(liveCosts(costs).length, costs.length, 'wiersze bez zmian, dopóki nie klikniesz')
})

// ── Koszty sprzed R2 ─────────────────────────────────────────────────────────

const old = (id: string, category: string, unitCost: number, extra: Partial<ProjectCost> = {}): ProjectCost =>
  ({ id, category, unitCost, quantity: 1, createdAt: '2026-10-18T15:00:00Z', ...extra }) as ProjectCost

test('koszty sprzed R2: tryb legacy, liczą się jak dotąd; brakujące pozycje planu na liście (dzień z ekipą = jest)', () => {
  const costs = [old('a', 'ekipa', 1800, { dayId: 'day-a', person: 'Kamil' }), old('b', 'dojazd', 700, { dayId: 'day-a' })]
  assert.equal(realizationMode({ costs }), 'legacy')
  const { rows } = quotePlanRows(snapshot())
  const missing = missingFromQuote(costs, rows, ['day-a', 'day-b'])
  assert.deepEqual(missing.counted.map((r) => r.planKey).sort(), ['post:montaz', 'pro:d1:rental:r1', 'pro:d2:crew:qc-k2'])
  assert.deepEqual(missing.skipped.map((r) => r.planKey), ['pre:dokumentacja'], 'odznaczone w planie osobno')
  const montaz = rows.find((r) => r.planKey === 'post:montaz')!
  assert.equal(missing.total, montaz.quantity * montaz.unitCost + 400 + 1200)
  const added = addPlanRow(costs, missing.counted.find((r) => r.planKey === 'pro:d2:crew:qc-k2')!, ['day-a', 'day-b'], NOW)
  assert.equal(added[2].dayId, 'day-b')
  assert.equal(realizationMode({ costs: added }), 'legacy', 'dodanie z listy nie zmienia trybu')
  assert.equal(missingFromQuote(added, rows, ['day-a', 'day-b']).counted.length, 2)
})

test('„Zacznij od wyceny": wpisane miękko usunięte jednym znacznikiem, w ich miejsce plan; poprzednia lista = Cofnij', () => {
  const costs = [old('a', 'ekipa', 1800, { dayId: 'day-a' }), old('b', 'sprzet', 0), old('z', 'inne', 50, { deletedAt: '2026-10-01T00:00:00Z' })]
  const snap = snapshot()
  const { rows } = quotePlanRows(snap)
  const result = restartFromQuote(costs, rows, ['day-a', 'day-b'], NOW)
  assert.deepEqual(result.costs.filter((c) => c.deletedAt === result.stamp).map((c) => c.id), ['a', 'b'])
  assert.equal(result.costs.find((c) => c.id === 'z')!.deletedAt, '2026-10-01T00:00:00Z', 'wcześniej usunięte bez zmian')
  assert.equal(sum(result.costs), computeSnapshotFinancials(snap, NOW)!.koszty)
})

test('układ: ekipa sprzed R2 bez dnia zostaje w „Kosztach projektu"; wiersz dnia, którego nie ma — też', () => {
  const costs = [old('a', 'ekipa', 1000, { person: 'Montażysta' }), old('b', 'catering', 200, { dayId: 'gone' }), old('c', 'ekipa', 1500, { dayId: 'day-a' })]
  const layout = layoutRealization(costs, ['day-a'], [])
  assert.deepEqual(layout.project.map((c) => c.id), ['a', 'b'])
  assert.deepEqual(layout.byDay.get('day-a')!.map((c) => c.id), ['c'])
  assert.equal(layout.unassigned.length, 0)
})

test('kwoty szkicu = kwoty planu (ilość × stawka), także km × zł/km', () => {
  const { rows } = quotePlanRows(snapshot())
  const fuel = rows.find((r) => r.planKey === 'log:dojazd')!
  assert.equal(fuel.quantity, 100)
  assert.equal(fuel.unitLabel, 'km')
  assert.equal(costAmount(draftCosts([fuel], [])[0]), 100 * fuel.unitCost)
})

test('stare wiersze „Asystent/Operator" (Morris, CIONET, JHJ) trafiają w rolę `asystent`, dziś „Operator"', () => {
  const roles = [
    { id: 'asystent', name: 'Operator' },
    { id: 'cr-r1-asystent', name: 'Asystent' },
  ] as Parameters<typeof crewRoleByName>[0]
  assert.equal(crewRoleByName(roles, 'Asystent/Operator')?.id, 'asystent')
  assert.equal(crewRoleByName(roles, 'asystent / operator'), null, 'tylko dokładna dawna nazwa')
  assert.equal(crewRoleByName(roles, 'Asystent')?.id, 'cr-r1-asystent')
  assert.equal(crewRoleByName([{ id: 'x', name: 'Asystent/Operator' }] as typeof roles, 'Asystent/Operator')?.id, 'x', 'rola o tej nazwie wygrywa')
  assert.deepEqual(kitCrewFromDayCosts([{ category: 'ekipa', role: 'Asystent/Operator', personId: 'cm-kamil' }], roles), [
    { roleId: 'asystent', qty: 1, personId: 'cm-kamil' },
  ])
})
