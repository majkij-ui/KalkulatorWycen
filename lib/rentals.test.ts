import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addRentalItem,
  findRentalItemByName,
  periodRentals,
  projectRentalTotal,
  realizationLines,
  rebalanceRental,
  removeRentalItem,
  renameRentalItem,
  rentalBlock,
  rentalTotal,
  rentedGearReport,
  restoreRentalItem,
  setTypedRental,
  RENTAL_LINE_LABEL,
} from './rentals'
import { costAmount, totalActualCosts } from './project-costs'
import { projectCostSchema, type Project, type ProjectCost, type ProjectStatus } from './project-types'
import { rentalItemSchema, type RentalItem } from './rental-types'

let n = 0
function cost(category: string, amount: number, extra: Partial<ProjectCost> = {}): ProjectCost {
  n += 1
  return { id: `c${n}`, category, quantity: 1, unitCost: amount, ...extra }
}

const DAYS = ['d1', 'd2']
const sum = (costs: ProjectCost[]) => totalActualCosts(costs)

/** Szybka wycena z „Rentalem sprzętu" w planie (1200 zł, koszt). */
const QUOTE_WITH_RENTAL = {
  data: { dniZdjeciowe: 1, wielkoscEkipy: 1, profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 1200 } } },
  marginMultiplier: 1,
}

test('jedna liczba: zaznaczone, zewnętrzne wiersze wynajmu — projekt i dni', () => {
  const costs = [
    cost('wynajem', 1500, { label: 'Wynajem sprzętu' }),
    cost('wynajem', 700, { dayId: 'd1', label: 'CamCam' }),
    cost('wynajem', 50, { skipped: true }),
    cost('wynajem', 60, { ownWork: true }),
    cost('wynajem', 70, { deletedAt: '2026-10-24T10:00:00.000Z' }),
    cost('dojazd', 1300),
  ]
  assert.equal(rentalTotal(costs), 2200)
  assert.equal(rentalTotal(undefined), 0)
})

test('projekt bez zapisanej Realizacji liczy wynajem z planu (jak Finanse); zapisane wiersze wygrywają', () => {
  assert.equal(projectRentalTotal({ costs: undefined, quote: QUOTE_WITH_RENTAL }), 1200)
  assert.equal(projectRentalTotal({ costs: [cost('wynajem', 500)], quote: QUOTE_WITH_RENTAL }), 500)
  assert.equal(projectRentalTotal({ costs: [], quote: null }), 0)
  const planLines = realizationLines({ costs: [], quote: QUOTE_WITH_RENTAL })
  assert.ok(planLines.some((c) => c.category === 'wynajem' && c.label === RENTAL_LINE_LABEL && costAmount(c) === 1200))
})

test('blok „Wynajem sprzętu": wiersz bez pozycji to wpisana kwota, pozycje pod nim, wynajem w dniach osobno', () => {
  const rest = cost('wynajem', 1100, { label: 'Wynajem sprzętu', rentalTotal: 1500 })
  const fx6 = cost('wynajem', 400, { rentalItemId: 'ri-fx6' })
  const inDay = cost('wynajem', 700, { dayId: 'd1' })
  const fromQuoteDay = cost('wynajem', 200, { planKey: 'pro:qd-9:rental:r1' })
  const block = rentalBlock([fx6, rest, inDay, fromQuoteDay, cost('inne', 100)], DAYS)
  assert.equal(block.rest?.id, rest.id, 'wiersz z wpisaną kwotą, nawet gdy nie jest pierwszy')
  assert.deepEqual(block.items.map((c) => c.id), [fx6.id])
  assert.deepEqual(block.days.map((c) => c.id), [inDay.id, fromQuoteDay.id], 'dzień wyceny bez odpowiednika to też dzień')
  assert.equal(block.typed, 1500)
  assert.equal(block.restAmount, 1100)
  assert.equal(block.projectTotal, 1500)
  assert.equal(block.daysTotal, 900)
  assert.equal(block.total, 2400)
  assert.equal(block.overTyped, 0)

  const empty = rentalBlock([cost('inne', 100)], DAYS)
  assert.equal(empty.rest, null, 'brak wiersza → pole 0 zł')
  assert.equal(empty.typed, 0)
  assert.equal(empty.total, 0)

  const legacy = rentalBlock([cost('wynajem', 1500, { planKey: 'pro:rentalSprzetu' }), cost('wynajem', 300, { label: 'Prompter' })], DAYS)
  assert.equal(legacy.typed, 1800, 'bez wpisanej kwoty: reszta + pozycje — nic się nie zmienia')
  assert.equal(legacy.total, 1800)
})

test('wpisana kwota: tworzy „Wynajem sprzętu", a przy pozycjach trzyma resztę', () => {
  const now = new Date('2026-10-24T12:00:00Z')
  const fresh = setTypedRental([cost('inne', 100)], 1500, DAYS, now)
  const line = fresh.find((c) => c.category === 'wynajem')!
  assert.equal(line.label, RENTAL_LINE_LABEL)
  assert.equal(costAmount(line), 1500)
  assert.equal(line.rentalTotal, undefined, 'bez pozycji wiersz = kwota')

  const fx6 = cost('wynajem', 400, { rentalItemId: 'ri-fx6' })
  const withItem = setTypedRental([fx6], 1500, DAYS, now)
  const rest = withItem.find((c) => c.id !== fx6.id)!
  assert.equal(rest.rentalTotal, 1500)
  assert.equal(costAmount(rest), 1100)
  assert.equal(rentalBlock(withItem, DAYS).projectTotal, 1500)

  const planRest = cost('wynajem', 1500, { planKey: 'pro:rentalSprzetu', quantity: 2, unitCost: 750 })
  const edited = setTypedRental([planRest], 1600, DAYS, now)[0]
  assert.equal(edited.quantity, 1)
  assert.equal(edited.unitCost, 1600)
  assert.equal(edited.edited, true, 'wiersz z planu zmieniony ręcznie — zmiany wyceny go nie ruszą')

  const unticked = cost('wynajem', 500, { skipped: true })
  const plain = setTypedRental([unticked, fx6], 900, DAYS, now)
  assert.equal(plain[0].unitCost, 900, 'odznaczony wiersz nie jest resztą — po prostu kwota')
  assert.equal(plain[0].rentalTotal, undefined)
})

test('pozycje najpierw wypełniają wpisaną kwotę, potem ją podnoszą (decyzja 2026-10-24)', () => {
  const rest = cost('wynajem', 1500, { label: 'Wynajem sprzętu' })
  const prompter = cost('wynajem', 0, { rentalItemId: 'ri-prompter' })
  let costs = [rest, prompter]
  const edit = (id: string, amount: number) => {
    const before = costs
    costs = rebalanceRental(before, before.map((c) => (c.id === id ? { ...c, unitCost: amount } : c)), DAYS)
  }
  // pisanie „400" znak po znaku — suma stoi
  edit(prompter.id, 4)
  edit(prompter.id, 40)
  edit(prompter.id, 400)
  assert.equal(rentalBlock(costs, DAYS).restAmount, 1100)
  assert.equal(rentalBlock(costs, DAYS).total, 1500)
  assert.equal(costs[0].rentalTotal, 1500)
  // literówka „4000" i poprawka — wpisana kwota nie rośnie
  edit(prompter.id, 4000)
  assert.equal(rentalBlock(costs, DAYS).total, 4000, 'pozycje ponad kwotę podnoszą sumę')
  assert.equal(rentalBlock(costs, DAYS).overTyped, 2500)
  edit(prompter.id, 400)
  assert.equal(rentalBlock(costs, DAYS).total, 1500)
  // usunięcie pozycji: kwota wraca do „bez szczegółów"
  const before = costs
  costs = rebalanceRental(before, before.map((c) => (c.id === prompter.id ? { ...c, deletedAt: 'x' } : c)), DAYS)
  assert.equal(rentalBlock(costs, DAYS).restAmount, 1500)
  assert.equal(costs[0].rentalTotal, undefined, 'bez pozycji wiersz znowu = kwota')
  assert.equal(sum(costs), 1500)
})

test('bez wiersza „bez szczegółów" (albo odznaczonego) pozycje po prostu się sumują', () => {
  const a = cost('wynajem', 300, { rentalItemId: 'ri-a' })
  const b = cost('wynajem', 0, { rentalItemId: 'ri-b' })
  const after = rebalanceRental([a, b], [a, { ...b, unitCost: 200 }], DAYS)
  assert.equal(rentalBlock(after, DAYS).total, 500)

  const off = cost('wynajem', 1000, { skipped: true })
  const kept = rebalanceRental([off, a], [off, { ...a, unitCost: 600 }], DAYS)
  assert.equal(kept[0].unitCost, 1000, 'odznaczona reszta zostaje nietknięta')

  const day = cost('wynajem', 0, { dayId: 'd1' })
  const rest = cost('wynajem', 1000)
  const dayEdit = rebalanceRental([rest, day], [rest, { ...day, unitCost: 300 }], DAYS)
  assert.equal(dayEdit[0].unitCost, 1000, 'wynajem w dniu nie wypełnia kwoty za projekt')
})

test('istniejące wiersze wynajmu: suma kosztów projektu bez zmian (JHJ 1 500, rolki 700 w dniu)', () => {
  const jhj = [cost('wynajem', 1500, { planKey: 'pro:rentalSprzetu', label: 'Wynajem sprzętu' }), cost('dojazd', 1300)]
  const block = rentalBlock(jhj, DAYS)
  assert.equal(block.total, 1500)
  assert.equal(block.typed, 1500)
  assert.equal(sum(jhj), 2800)
  const rolki = [cost('wynajem', 700, { dayId: 'd1', label: 'CamCam: prompter, 2x tła' })]
  assert.equal(rentalBlock(rolki, DAYS).rest, null)
  assert.equal(rentalBlock(rolki, DAYS).total, 700)
})

test('słownik: pozycja „na miejscu", ta sama nazwa = ta sama pozycja; zmiana nazwy; miękkie usunięcie', () => {
  const now = '2026-10-24T12:00:00.000Z'
  const first = addRentalItem([], '  Sony   FX6 ', now)
  assert.equal(first.item?.name, 'Sony FX6')
  const again = addRentalItem(first.items, 'sony fx6', now)
  assert.equal(again.item?.id, first.item?.id)
  assert.equal(again.items.length, 1)
  assert.equal(addRentalItem([], '   ', now).item, null)
  assert.equal(findRentalItemByName(first.items, 'SONY FX6')?.id, first.item?.id)

  const renamed = renameRentalItem(first.items, first.item!.id, 'Sony FX6 + V-mount', now)
  assert.equal(renamed[0].name, 'Sony FX6 + V-mount')
  const removed = removeRentalItem(renamed, first.item!.id, 'del')
  assert.equal(findRentalItemByName(removed, 'Sony FX6 + V-mount'), null)
  assert.equal(addRentalItem(removed, 'Sony FX6 + V-mount', now).items.length, 2, 'usunięta nie wraca sama')
  assert.equal(restoreRentalItem(removed, first.item!.id, 'del')[0].deletedAt, undefined)
})

function project(id: string, status: ProjectStatus, costs: ProjectCost[], extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date: '2026-03-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    costs,
    ...extra,
  }
}

test('„Wynajmowany sprzęt": ile razy, dni, wydane, ostatni wynajem, na rok; reszta „bez pozycji"', () => {
  const dictionary: RentalItem[] = [{ id: 'ri-fx6', name: 'Sony FX6', createdAt: '' }]
  const projects = [
    project('A', 'done', [cost('wynajem', 800, { rentalItemId: 'ri-fx6', rentalDays: 2, vendor: 'CamCam' })], { date: '2025-11-03' }),
    project('B', 'won', [
      cost('wynajem', 450, { rentalItemId: 'ri-fx6', dayId: 'd1' }),
      cost('wynajem', 300, { rentalItemId: 'ri-fx6' }),
      cost('wynajem', 1500, { label: 'Wynajem sprzętu' }),
      cost('wynajem', 90, { rentalItemId: 'ri-gone' }),
    ], { date: '2026-02-01', gearDays: [{ id: 'd1', label: '', date: '2026-02-10', lines: [] }] }),
    project('C', 'lost', [cost('wynajem', 999, { rentalItemId: 'ri-fx6' })]),
    project('D', 'done', [], { quote: QUOTE_WITH_RENTAL as unknown as Project['quote'], date: '2026-04-01' }),
  ]
  const report = rentedGearReport(projects, dictionary)
  const fx6 = report.items.find((i) => i.itemId === 'ri-fx6')!
  assert.equal(fx6.times, 3)
  assert.equal(fx6.days, 3, '2 wpisane + 1 (wiersz dnia)')
  assert.equal(fx6.daysUnknown, 1)
  assert.equal(fx6.total, 1550)
  assert.equal(fx6.last?.date, '2026-02-10', 'data dnia')
  assert.deepEqual([...fx6.byYear.entries()], [[2025, 800], [2026, 750]])
  assert.equal(fx6.uses[fx6.uses.length - 1].vendor, 'CamCam')
  const gone = report.items.find((i) => i.itemId === 'ri-gone')!
  assert.equal(gone.item, null)
  assert.equal(gone.name, 'pozycja usunięta')
  assert.equal(report.unitemized.total, 2700, 'wpisana kwota B + plan D (projekt bez Realizacji)')
  assert.equal(report.unitemized.projects, 2)
  assert.equal(report.total, 800 + 450 + 300 + 1500 + 90 + 1200, 'przegrany projekt się nie liczy')
  assert.deepEqual(report.years, [2025, 2026])
})

test('wynajem w okresie: projekty zakotwiczone, na podstawie kosztów z rejestru (Realizacja albo plan)', () => {
  const dictionary: RentalItem[] = [{ id: 'ri-fx6', name: 'Sony FX6', createdAt: '' }]
  const actual = project('A', 'done', [cost('wynajem', 1500), cost('wynajem', 400, { rentalItemId: 'ri-fx6' })])
  const partial = project('B', 'won', [cost('wynajem', 100)], { quote: QUOTE_WITH_RENTAL as unknown as Project['quote'] })
  const outside = project('C', 'done', [cost('wynajem', 999)])
  const lost = project('D', 'lost', [cost('wynajem', 999)])
  const byId = new Map([actual, partial, outside, lost].map((p) => [p.id, p]))
  const result = periodRentals(
    [
      { money: { id: 'A', counts: true, costsBasis: 'actual' }, anchored: true },
      { money: { id: 'B', counts: true, costsBasis: 'plan' }, anchored: true },
      { money: { id: 'C', counts: true, costsBasis: 'actual' }, anchored: false },
      { money: { id: 'D', counts: false, costsBasis: 'actual' }, anchored: true },
    ],
    byId,
    dictionary
  )
  assert.equal(result.total, 1900 + 1200, 'B: Finanse liczą plan, więc wynajem z planu')
  assert.deepEqual(result.projects.map((p) => [p.id, p.amount]), [['A', 1900], ['B', 1200]])
  assert.deepEqual(result.top, [{ itemId: 'ri-fx6', name: 'Sony FX6', times: 1, amount: 400 }])
})

test('schematy: nowe pola wiersza są opcjonalne, śmieci znikają, nieznane pola zostają', () => {
  const parsed = projectCostSchema.parse({
    id: 'c', category: 'wynajem', unitCost: 1, rentalItemId: '', rentalDays: -1, vendor: 3, rentalTotal: -5, future: 1,
  })
  assert.equal(parsed.rentalItemId, undefined)
  assert.equal(parsed.rentalDays, undefined)
  assert.equal(parsed.vendor, undefined)
  assert.equal(parsed.rentalTotal, undefined)
  assert.equal((parsed as Record<string, unknown>).future, 1)
  const ok = projectCostSchema.parse({ id: 'c', category: 'wynajem', unitCost: 1, rentalItemId: 'ri-1', rentalDays: 2, vendor: 'CamCam', rentalTotal: 1500 })
  assert.deepEqual([ok.rentalItemId, ok.rentalDays, ok.vendor, ok.rentalTotal], ['ri-1', 2, 'CamCam', 1500])

  const item = rentalItemSchema.parse({ id: 'ri', name: 'Prompter', createdAt: '', extra: true })
  assert.equal((item as Record<string, unknown>).extra, true)
  assert.equal(rentalItemSchema.parse({ id: 'ri', name: 5 }).name, '')
})
