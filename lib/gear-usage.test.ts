import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addGearDay,
  buildPackingList,
  duplicateGearDay,
  gearDayDate,
  gearDayLabel,
  hasGearLogged,
  legacyToGearDays,
  projectGearDays,
  projectShootDates,
  quoteShootDayCount,
  removeGearDay,
  setGearLine,
  setGearLineEverywhere,
  suggestGearDays,
  updateGearDay,
} from './gear-usage'
import type { EquipmentItem, GearDay, Project } from './project-types'

function item(id: string, name: string, category = 'kamery'): EquipmentItem {
  return { id, name, category, purchasePrice: 0, rentalDayRate: 0, purchaseDate: '', notes: '' }
}

function day(id: string, lines: [string, number][], date = ''): GearDay {
  return { id, label: '', date, lines: lines.map(([itemId, qty]) => ({ itemId, qty })) }
}

function project(options: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'p1',
    client: '',
    status: 'won',
    date: '2026-03-15',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...options,
  }
}

function shoot(start: string, end?: string, extra: Record<string, unknown> = {}) {
  return { kind: 'shoot_day', projectId: 'p1', start, end, deletedAt: undefined, ...extra }
}

test('stary kształt → dni: pozycja jedzie w pierwszych N dniach', () => {
  const days = legacyToGearDays([
    { itemId: 'fx3', days: 3 },
    { itemId: 'lampa', days: 1 },
    { itemId: 'zero', days: 0 },
  ])
  assert.deepEqual(days.map((d) => d.id), ['legacy-1', 'legacy-2', 'legacy-3'])
  assert.deepEqual(days.map((d) => d.lines.map((l) => l.itemId)), [['fx3', 'lampa'], ['fx3'], ['fx3']])
  assert.ok(days.every((d) => d.lines.every((l) => l.qty === 1)))
})

test('projectGearDays: nowy kształt wygrywa, nawet pusty', () => {
  const legacy = [{ itemId: 'fx3', days: 2 }]
  assert.equal(projectGearDays(project({ equipment: legacy })).length, 2)
  assert.deepEqual(projectGearDays(project({ equipment: legacy, gearDays: [] })), [])
  assert.equal(hasGearLogged(project({ equipment: legacy })), true)
  assert.equal(hasGearLogged(project({ gearDays: [day('d1', [])] })), false, 'dzień bez sprzętu to brak sprzętu')
})

test('setGearLine dodaje, zmienia i usuwa pozycję, bez mutowania wejścia', () => {
  const start = [day('d1', [['fx3', 1]]), day('d2', [])]
  const frozen = JSON.stringify(start)

  const added = setGearLine(start, 'd2', 'lampa', 2.7)
  assert.deepEqual(added[1].lines, [{ itemId: 'lampa', qty: 2 }], 'liczba sztuk zaokrąglona w dół')
  const changed = setGearLine(added, 'd1', 'fx3', 2)
  assert.deepEqual(changed[0].lines, [{ itemId: 'fx3', qty: 2 }])
  const removed = setGearLine(changed, 'd1', 'fx3', 0)
  assert.deepEqual(removed[0].lines, [])
  assert.equal(setGearLine(start, 'd2', 'nie-ma', 0)[1], start[1], 'usunięcie nieobecnej pozycji nic nie zmienia')

  assert.equal(JSON.stringify(start), frozen)
})

test('setGearLineEverywhere ustawia pozycję we wszystkich dniach', () => {
  const days = [day('d1', [['fx3', 1]]), day('d2', [])]
  const all = setGearLineEverywhere(days, 'lampa', 2)
  assert.ok(all.every((d) => d.lines.some((l) => l.itemId === 'lampa' && l.qty === 2)))
  const none = setGearLineEverywhere(all, 'lampa', 0)
  assert.ok(none.every((d) => !d.lines.some((l) => l.itemId === 'lampa')))
  assert.deepEqual(none[0].lines, [{ itemId: 'fx3', qty: 1 }])
})

test('kopia dnia ląduje zaraz za oryginałem, z własnymi pozycjami i bez daty', () => {
  const days = [day('d1', [['fx3', 1]], '2026-03-01'), day('d2', [['lampa', 1]])]
  const copied = duplicateGearDay(days, 'd1')

  assert.equal(copied.length, 3)
  assert.equal(copied[0].id, 'd1')
  assert.equal(copied[2].id, 'd2')
  assert.notEqual(copied[1].id, 'd1')
  assert.equal(copied[1].date, '')
  assert.deepEqual(copied[1].lines, [{ itemId: 'fx3', qty: 1 }])
  copied[1].lines[0].qty = 5
  assert.equal(days[0].lines[0].qty, 1, 'kopia nie dzieli pozycji z oryginałem')
  assert.equal(duplicateGearDay(days, 'brak'), days)
})

test('dodawanie, usuwanie i zmiana dnia', () => {
  let days = addGearDay([], { date: '2026-03-01' })
  days = addGearDay(days, { label: 'Backup' })
  assert.equal(days.length, 2)
  assert.notEqual(days[0].id, days[1].id)
  days = updateGearDay(days, days[1].id, { date: '2026-03-02' })
  assert.equal(days[1].date, '2026-03-02')
  assert.equal(days[1].label, 'Backup')
  days = removeGearDay(days, days[0].id)
  assert.deepEqual(days.map((d) => d.label), ['Backup'])
})

test('etykieta i data dnia mają sensowne zastępstwa', () => {
  assert.equal(gearDayLabel({ label: '' }, 1), 'Dzień 2')
  assert.equal(gearDayLabel({ label: '  Plener ' }, 0), 'Plener')
  assert.equal(gearDayDate({ date: '' }, { date: '2026-03-15' }), '2026-03-15')
  assert.equal(gearDayDate({ date: '2026-03-02' }, { date: '2026-03-15' }), '2026-03-02')
})

test('daty zdjęć z kalendarza: zakresy rozwinięte, cudze i usunięte pominięte', () => {
  const dates = projectShootDates('p1', [
    shoot('2026-03-02', '2026-03-04'),
    shoot('2026-03-04T08:00'),
    shoot('2026-03-10', undefined, { projectId: 'inny' }),
    shoot('2026-03-11', undefined, { deletedAt: '2026-03-01T00:00:00Z' }),
    shoot('2026-03-12', undefined, { kind: 'post_day' }),
    shoot('', undefined),
  ])
  assert.deepEqual(dates, ['2026-03-02', '2026-03-03', '2026-03-04'])
})

test('liczba dni z wyceny: szczegółowa liczy dni, szybka licznik', () => {
  assert.equal(quoteShootDayCount(null), 0)
  assert.equal(quoteShootDayCount({ data: { isDetailedProdukcja: true, detailedShootingDays: [{}, {}] } }), 2)
  assert.equal(quoteShootDayCount({ data: { dniZdjeciowe: 3.5 } }), 3)
  assert.equal(quoteShootDayCount({ data: { dniZdjeciowe: 'x' } }), 0)
})

test('podpowiedź dni: stary sprzęt > kalendarz > wycena > jeden dzień', () => {
  const events = [shoot('2026-03-02', '2026-03-03')]
  const quote = { data: { dniZdjeciowe: 4 } } as unknown as Project['quote']

  const fromLegacy = suggestGearDays(project({ equipment: [{ itemId: 'fx3', days: 2 }], quote }), events)
  assert.equal(fromLegacy.length, 2)
  assert.ok(fromLegacy.every((d) => d.lines[0]?.itemId === 'fx3'))
  assert.ok(fromLegacy.every((d) => d.id.startsWith('gd-')), 'zapisany dzień dostaje prawdziwe id')

  const fromCalendar = suggestGearDays(project({ quote }), events)
  assert.deepEqual(fromCalendar.map((d) => d.date), ['2026-03-02', '2026-03-03'])

  assert.equal(suggestGearDays(project({ quote }), []).length, 4)
  assert.equal(suggestGearDays(project(), []).length, 1)
})

test('lista pakowania projektu: najwięcej sztuk z jednego dnia i liczba dni', () => {
  const catalog = [item('fx3', 'FX3'), item('a7', 'A7S'), item('l1', 'Aputure', 'swiatlo')]
  const p = project({
    gearDays: [day('d1', [['l1', 3], ['fx3', 1]]), day('d2', [['l1', 1], ['a7', 1], ['usuniety', 1]])],
  })
  const list = buildPackingList(p, catalog)

  assert.deepEqual(list.map((g) => g.category), ['kamery', 'swiatlo'])
  assert.deepEqual(list[0].items.map((i) => i.item.name), ['A7S', 'FX3'], 'w kategorii alfabetycznie')
  assert.deepEqual(list[1].items.map(({ qty, days }) => ({ qty, days })), [{ qty: 3, days: 2 }])

  const dayTwo = buildPackingList(p, catalog, 'd2')
  assert.deepEqual(dayTwo.flatMap((g) => g.items.map((i) => `${i.item.id}×${i.qty}`)), ['a7×1', 'l1×1'])
})

test('lista pakowania: znane kategorie w kolejności wozu, własne na końcu', () => {
  const catalog = [
    item('g', 'C-stand', 'grip'),
    item('i', 'Torba', 'inne'),
    item('d', 'Rode', 'dzwiek'),
    item('o', '24-70', 'obiektywy'),
    item('a', 'Aku', 'akumulatory'),
    item('k', 'FX3', 'kamery'),
  ]
  const p = project({ gearDays: [day('d1', catalog.map((c) => [c.id, 1] as [string, number]))] })
  assert.deepEqual(
    buildPackingList(p, catalog).map((g) => g.category),
    ['kamery', 'obiektywy', 'dzwiek', 'inne', 'akumulatory', 'grip']
  )
})
