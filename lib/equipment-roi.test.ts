import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeGearReport, itemUsageHistory, summarizeProjectGear } from './equipment-roi'
import type { EquipmentItem, GearDay, Project, ProjectStatus } from './project-types'

const NOW = new Date(2026, 6, 1, 12) // 1 lipca 2026, czas lokalny

function item(
  id: string,
  name: string,
  purchasePrice: number,
  rentalDayRate: number,
  extra: Partial<EquipmentItem> = {}
): EquipmentItem {
  return {
    id,
    name,
    category: 'kamery',
    purchasePrice,
    rentalDayRate,
    purchaseDate: '',
    notes: '',
    ...extra,
  }
}

function day(id: string, lines: [string, number][], date = ''): GearDay {
  return { id, label: '', date, lines: lines.map(([itemId, qty]) => ({ itemId, qty })) }
}

function project(
  id: string,
  status: ProjectStatus,
  options: {
    equipment?: { itemId: string; days: number }[]
    gearDays?: GearDay[]
    quote?: Project['quote']
    date?: string
  } = {}
): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date: options.date ?? '2026-01-01',
    createdAt: '',
    updatedAt: '',
    quote: options.quote ?? null,
    financials: null,
    equipment: options.equipment ?? [],
    gearDays: options.gearDays,
    notes: '',
  }
}

/** Szybka wycena: 2 dni, pakiet „standard" (1500 zł/dzień) → 3000 zł za sprzęt. */
function quickQuote(extra: Record<string, unknown> = {}): Project['quote'] {
  return {
    data: { dniZdjeciowe: 2, wielkoscEkipy: 1, klasaSprzetu: 'standard', ...extra },
    marginMultiplier: 1,
  } as unknown as Project['quote']
}

function roiOf(report: ReturnType<typeof computeGearReport>, id: string) {
  const found = report.items.find((r) => r.item.id === id)
  assert.ok(found, `brak pozycji ${id} w raporcie`)
  return found
}

test('stary kształt (pozycja × dni) wciąż liczy się do odpracowania', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const report = computeGearReport(
    [camera],
    [
      project('p1', 'done', { equipment: [{ itemId: 'c1', days: 3 }] }),
      project('p2', 'won', { equipment: [{ itemId: 'c1', days: 2 }] }),
    ],
    { now: NOW }
  )
  const roi = roiOf(report, 'c1')

  assert.equal(roi.projectsUsed, 2)
  assert.equal(roi.daysUsed, 5)
  assert.equal(roi.rentValue, 2500)
  assert.equal(roi.rentValuePct, 12.5)
  assert.equal(roi.paidOffByRent, false)
})

test('dni z liczbą sztuk: sztuko-dni × stawka, zainwestowane = cena × sztuki', () => {
  const light = item('l1', 'Aputure 300d', 3000, 150, { category: 'swiatlo', quantity: 2 })
  const p = project('p1', 'done', {
    gearDays: [day('d1', [['l1', 2]]), day('d2', [['l1', 1]])],
  })
  const roi = roiOf(computeGearReport([light], [p], { now: NOW }), 'l1')

  assert.equal(roi.units, 2)
  assert.equal(roi.invested, 6000, 'dwie sztuki to dwie ceny zakupu')
  assert.equal(roi.daysUsed, 2, 'dni na planie, nie sztuko-dni')
  assert.equal(roi.unitDays, 3)
  assert.equal(roi.rentValue, 450)
  assert.equal(roi.rentValuePct, 7.5)
})

test('gearDays wygrywa ze starym kształtem, także gdy jest pusta', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const withDays = project('p1', 'done', {
    equipment: [{ itemId: 'c1', days: 10 }],
    gearDays: [day('d1', [['c1', 1]])],
  })
  const emptied = project('p2', 'done', { equipment: [{ itemId: 'c1', days: 10 }], gearDays: [] })
  const roi = roiOf(computeGearReport([camera], [withDays, emptied], { now: NOW }), 'c1')

  assert.equal(roi.daysUsed, 1, 'stare 10 dni nie liczy się drugi raz')
  assert.equal(roi.projectsUsed, 1, 'pusta lista dni = świadomie bez sprzętu')
})

test('wyceny i przegrane nie odpracowują ani nie zarabiają', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const report = computeGearReport(
    [camera],
    [
      project('p1', 'quote', { gearDays: [day('d1', [['c1', 1]])], quote: quickQuote() }),
      project('p2', 'lost', { gearDays: [day('d1', [['c1', 1]])], quote: quickQuote() }),
    ],
    { now: NOW }
  )
  const roi = roiOf(report, 'c1')

  assert.equal(roi.projectsUsed, 0)
  assert.equal(roi.rentValue, 0)
  assert.equal(roi.clientPaid, 0)
  assert.equal(report.totals.unassignedClientPaid, 0)
  assert.equal(report.missingGear.length, 0, 'lista do uzupełnienia to tylko zrealizowane projekty')
})

test('spłacony sprzęt jest oznaczony i nie dostaje prognozy', () => {
  const light = item('l1', 'Aputure 600d', 5000, 300, { purchaseDate: '2026-01-01' })
  const projects = Array.from({ length: 4 }, (_, i) =>
    project(`p${i}`, 'done', { equipment: [{ itemId: 'l1', days: 5 }] })
  )
  const roi = roiOf(computeGearReport([light], projects, { now: NOW }), 'l1')

  assert.equal(roi.rentValue, 6000)
  assert.equal(roi.paidOffByRent, true)
  assert.equal(roi.rentValuePct, 120)
  assert.equal(roi.rentPayoffMonth, null, 'spłacony nie ma daty spłaty w przyszłości')
})

test('brak ceny zakupu: procent i prognoza null zamiast dzielenia przez zero', () => {
  const rented = item('r1', 'Wózek', 0, 400)
  const roi = roiOf(
    computeGearReport([rented], [project('p1', 'done', { equipment: [{ itemId: 'r1', days: 2 }] })], { now: NOW }),
    'r1'
  )
  assert.equal(roi.rentValue, 800)
  assert.equal(roi.rentValuePct, null)
  assert.equal(roi.clientPaidPct, null)
  assert.equal(roi.paidOffByRent, false)
  assert.equal(roi.rentPayoffMonth, null)
})

test('zapłata klienta za sprzęt rozkłada się proporcjonalnie do wartości rentalowej', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const light = item('l1', 'Aputure', 3000, 250, { category: 'swiatlo' })
  const p = project('p1', 'won', {
    quote: quickQuote(),
    gearDays: [day('d1', [['c1', 1], ['l1', 1]]), day('d2', [['c1', 1], ['l1', 1]])],
  })
  const report = computeGearReport([camera, light], [p], { now: NOW })

  // 3000 zł za sprzęt; wartości rentalowe 1000 i 500 → 2:1
  assert.equal(roiOf(report, 'c1').clientPaid, 2000)
  assert.equal(roiOf(report, 'l1').clientPaid, 1000)
  assert.equal(report.totals.clientPaid, 3000)
  assert.equal(report.totals.unassignedClientPaid, 0)
  assert.equal(roiOf(report, 'c1').clientPaidPct, 10)
})

test('dorentalowany sprzęt (koszt w zakładce Profit) nie trafia do własnego', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const p = project('p1', 'done', {
    quote: quickQuote({ profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 1200 } } }),
    gearDays: [day('d1', [['c1', 1]])],
  })
  const roi = roiOf(computeGearReport([camera], [p], { now: NOW }), 'c1')
  assert.equal(roi.clientPaid, 1800, '3000 naliczone − 1200 zapłacone rentalowi')
})

test('bez stawek rentalowych zapłata dzieli się po sztuko-dniach', () => {
  const a = item('a', 'Statyw', 0, 0, { category: 'stabilizacja' })
  const b = item('b', 'Monitor', 0, 0, { category: 'podglad' })
  const p = project('p1', 'done', {
    quote: quickQuote(),
    gearDays: [day('d1', [['a', 2], ['b', 1]])],
  })
  const report = computeGearReport([a, b], [p], { now: NOW })
  assert.equal(roiOf(report, 'a').clientPaid, 2000)
  assert.equal(roiOf(report, 'b').clientPaid, 1000)
})

test('zapłata bez zaznaczonego sprzętu jest „nieprzypisana", a projekt trafia na listę do uzupełnienia', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const withQuote = project('p-q', 'done', { quote: quickQuote(), date: '2026-03-10' })
  const retro = project('p-retro', 'done', { date: '2026-05-02' })
  const report = computeGearReport([camera], [withQuote, retro], { now: NOW })

  assert.equal(report.totals.unassignedClientPaid, 3000)
  assert.deepEqual(
    report.missingGear.map((m) => m.project.id),
    ['p-retro', 'p-q'],
    'od najnowszego'
  )
  assert.equal(report.missingGear[0].revenue, null, 'retro bez wyceny: kwota nieznana')
  assert.equal(report.missingGear[1].revenue?.ownGear, 3000)
})

test('pozycja usunięta z katalogu nie zabiera zapłaty pozostałym', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const p = project('p1', 'done', {
    quote: quickQuote(),
    gearDays: [day('d1', [['c1', 1], ['usuniety', 1]])],
  })
  const summary = summarizeProjectGear(p, [camera])
  const ghost = summary.items.find((u) => u.itemId === 'usuniety')

  assert.equal(ghost?.item, null)
  assert.equal(ghost?.clientPaid, 0)
  assert.equal(summary.items.find((u) => u.itemId === 'c1')?.clientPaid, 3000)
})

test('tempo użycia i prognoza miesiąca spłaty', () => {
  // 181 dni posiadania ≈ 5,95 mies.; 3000 z 12000 → ~504 zł/mies. → 18 mies. od lipca 2026
  const camera = item('c1', 'FX3', 12000, 500, { purchaseDate: '2026-01-01' })
  const p = project('p1', 'done', {
    date: '2026-03-01',
    gearDays: [day('d1', [['c1', 1]], '2026-02-10'), day('d2', [['c1', 1]]), day('d3', [['c1', 1]], '2026-04-20'), day('d4', [['c1', 1]], '2026-04-21'), day('d5', [['c1', 1]], '2026-04-22'), day('d6', [['c1', 1]], '2026-04-23')],
  })
  const roi = roiOf(computeGearReport([camera], [p], { now: NOW }), 'c1')

  assert.equal(roi.rentValue, 3000)
  assert.equal(roi.firstUsed, '2026-02-10')
  assert.equal(roi.lastUsed, '2026-04-23')
  assert.ok(roi.monthsOwned && Math.abs(roi.monthsOwned - 181 / 30.4375) < 1e-9)
  assert.ok(roi.daysPerMonth && Math.abs(roi.daysPerMonth - 6 / (181 / 30.4375)) < 1e-9)
  assert.equal(roi.rentPayoffMonth, '2028-01')
  assert.equal(roi.clientPayoffMonth, null, 'bez zapłaty klientów nie ma tempa')
})

test('bez daty zakupu tempo liczy się od pierwszego użycia; świeży zakup to min. 1 miesiąc', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const p = project('p1', 'done', { gearDays: [day('d1', [['c1', 1]], '2026-06-25')] })
  const roi = roiOf(computeGearReport([camera], [p], { now: NOW }), 'c1')
  assert.equal(roi.monthsOwned, 1)
  assert.equal(roi.daysPerMonth, 1)
})

test('wycofany sprzęt zostaje w historii, ale nie jest „nieużywany" i nie ma prognozy', () => {
  const old = item('o1', 'GH5', 8000, 200, { purchaseDate: '2025-01-01', retiredAt: '2026-02-01' })
  const idle = item('i1', 'Mikrofon', 1000, 50, { category: 'dzwiek' })
  const p = project('p1', 'done', { gearDays: [day('d1', [['o1', 1]])] })
  const report = computeGearReport([old, idle], [p], { now: NOW })

  assert.equal(roiOf(report, 'o1').rentPayoffMonth, null)
  assert.equal(report.totals.retiredCount, 1)
  assert.equal(report.totals.activeCount, 1)
  assert.equal(report.totals.unusedCount, 1, 'tylko aktywny mikrofon')
})

test('raport sortuje malejąco po odpracowaniu, a sumy się zgadzają', () => {
  const items = [
    item('a', 'Tania lampa', 1000, 100, { category: 'swiatlo' }),
    item('b', 'Kamera', 20000, 500),
    item('c', 'Nieużywany mikrofon', 3000, 200, { category: 'dzwiek' }),
  ]
  const p = project('p1', 'done', { equipment: [{ itemId: 'a', days: 2 }, { itemId: 'b', days: 10 }] })
  const report = computeGearReport(items, [p], { now: NOW })

  assert.deepEqual(report.items.map((r) => r.item.id), ['b', 'a', 'c'])
  assert.equal(report.totals.invested, 24000)
  assert.equal(report.totals.rentValue, 5200)
  assert.equal(report.totals.unusedCount, 1)
  assert.equal(report.totals.paidOffByRentCount, 0)
})

test('podsumowanie projektu: wartość per dzień, także dla wyceny', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const light = item('l1', 'Aputure', 3000, 150, { quantity: 3 })
  const p = project('p1', 'quote', {
    gearDays: [day('d1', [['c1', 1], ['l1', 3]]), day('d2', [['c1', 1]])],
  })
  const summary = summarizeProjectGear(p, [camera, light])
  assert.deepEqual(summary.perDay, [
    { dayId: 'd1', rentValue: 950 },
    { dayId: 'd2', rentValue: 500 },
  ])
  assert.equal(summary.rentValue, 1450)
  assert.equal(summary.revenue, null, 'brak wyceny → nie wiadomo, ile zapłacono')
})

test('historia pozycji: tylko zrealizowane projekty, od najnowszego użycia', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const projects = [
    project('stary', 'done', { date: '2026-02-01', gearDays: [day('d1', [['c1', 1]])] }),
    project('nowy', 'won', { date: '2026-05-01', gearDays: [day('d1', [['c1', 1]])] }),
    project('wycena', 'quote', { date: '2026-06-01', gearDays: [day('d1', [['c1', 1]])] }),
    project('bez', 'done', { date: '2026-06-02' }),
  ]
  assert.deepEqual(
    itemUsageHistory('c1', projects, [camera]).map((h) => h.project.id),
    ['nowy', 'stary']
  )
})

test('z wydarzeniami data użycia pochodzi z kalendarza; usunięty dzień się nie liczy', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const p = project('p1', 'done', {
    gearDays: [
      { ...day('d1', [['c1', 1]], '2026-02-10'), eventId: 'ev1', eventDay: 1 },
      { ...day('d2', [['c1', 1]], '2026-03-01'), deletedAt: '2026-03-02T00:00:00Z' },
    ],
  })
  const moved = {
    id: 'ev1',
    kind: 'shoot_day',
    projectId: 'p1',
    start: '2026-05-04',
    end: '2026-05-05',
    deletedAt: undefined,
  }
  const withCalendar = roiOf(computeGearReport([camera], [p], { now: NOW, events: [moved] }), 'c1')
  assert.equal(withCalendar.firstUsed, '2026-05-05', 'drugi dzień przesuniętego wydarzenia')
  assert.equal(withCalendar.daysUsed, 1)

  const without = roiOf(computeGearReport([camera], [p], { now: NOW }), 'c1')
  assert.equal(without.firstUsed, '2026-02-10', 'bez wydarzeń — ostatnia znana data')
  assert.equal(itemUsageHistory('c1', [p], [camera], { events: [moved] })[0].use.dates[0], '2026-05-05')
})
