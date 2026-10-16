import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createEquipmentItem } from './equipment-catalog'
import { computeGearReport, summarizeProjectGear } from './equipment-roi'
import {
  backstageItems,
  gearPurchases,
  investedSplit,
  isOnSet,
  onSetItems,
  parseBackstageRows,
  parseDateText,
  parseMoney,
  withOnSet,
} from './gear-backstage'
import { applyKitToGearDay, buildPackingList } from './gear-usage'
import { equipmentItemSchema, type EquipmentItem, type GearDay, type Project } from './project-types'

const NOW = new Date(2026, 6, 1, 12)

function item(id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    id,
    name,
    category: 'kamery',
    purchasePrice: 0,
    rentalDayRate: 0,
    purchaseDate: '',
    notes: '',
    ...extra,
  }
}

function day(id: string, lines: [string, number][], date = ''): GearDay {
  return { id, label: '', date, lines: lines.map(([itemId, qty]) => ({ itemId, qty })) }
}

function project(id: string, gearDays: GearDay[], extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-03-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    gearDays,
    notes: '',
    ...extra,
  }
}

const cam = item('cam', 'Sony FX3', { purchasePrice: 10000, rentalDayRate: 500 })
const laptop = item('laptop', 'Laptop', { onSet: false, purchasePrice: 9000, purchaseDate: '2025-03-12', category: 'inne' })
const cards = item('cards', 'Karty SD', {
  onSet: false,
  purchasePrice: 90,
  quantity: 6,
  purchaseDate: '2025-05-02',
  category: 'inne',
})

// ── Dane ─────────────────────────────────────────────────────────────────────

test('schema: onSet:false przechodzi tam i z powrotem, brak pola zostaje brakiem', () => {
  const backstage = equipmentItemSchema.parse({ id: 'a', name: 'Kabel', onSet: false })
  assert.equal(backstage.onSet, false)
  assert.equal(JSON.parse(JSON.stringify(backstage)).onSet, false)

  const legacy = equipmentItemSchema.parse({ id: 'b', name: 'FX3', category: 'kamery', purchasePrice: 100 })
  assert.equal('onSet' in legacy, false, 'stare pozycje nie dostają nowego pola')
  assert.equal(isOnSet(legacy), true)
})

test('schema: inne wartości onSet są ignorowane (tylko false ma znaczenie), reszta rekordu cała', () => {
  for (const bad of [true, 'false', 0, null, 'x']) {
    const parsed = equipmentItemSchema.parse({ id: 'a', name: 'FX3', purchasePrice: 5, onSet: bad, extra: 1 })
    assert.equal(isOnSet(parsed), true, `onSet=${JSON.stringify(bad)} nie ukrywa sprzętu`)
    assert.equal(parsed.onSet, undefined, `onSet=${JSON.stringify(bad)} nie jest zapisywane`)
    assert.equal(parsed.purchasePrice, 5)
    assert.equal((parsed as Record<string, unknown>).extra, 1, 'passthrough zachowuje nieznane pola')
  }
})

test('createEquipmentItem: onSet:false zapisuje znacznik, domyślnie pola nie ma', () => {
  assert.equal(createEquipmentItem({ name: 'Kabel', category: 'inne', onSet: false }).onSet, false)
  assert.equal('onSet' in createEquipmentItem({ name: 'FX3', category: 'kamery' }), false)
  assert.equal('onSet' in createEquipmentItem({ name: 'FX3', category: 'kamery', onSet: true }), false)
})

test('withOnSet: przeniesienie tam i z powrotem oddaje oryginał, reszta rekordu nietknięta', () => {
  const original = item('cam', 'Sony FX3', { purchasePrice: 10000, quantity: 2, notes: 'x', retiredAt: '2026-01-01' })
  const moved = withOnSet(original, false)
  assert.equal(moved.onSet, false)
  assert.deepEqual({ ...moved, onSet: undefined }, { ...original, onSet: undefined })
  const back = withOnSet(moved, true)
  assert.deepEqual(back, original)
  assert.equal('onSet' in back, false)
  assert.equal('onSet' in original, false, 'oryginał nie jest mutowany')
})

test('onSetItems / backstageItems dzielą katalog bez gubienia pozycji', () => {
  const all = [cam, laptop, cards]
  assert.deepEqual(onSetItems(all), [cam])
  assert.deepEqual(backstageItems(all), [laptop, cards])
})

// ── gearPurchases (dla S4) ───────────────────────────────────────────────────

test('gearPurchases: cena × sztuki, flaga bez daty, wszystkie rodzaje i wycofane', () => {
  const noDate = item('cable', 'Kabel HDMI', { onSet: false, purchasePrice: 40 })
  const retired = item('old', 'Stara lampa', { purchasePrice: 800, quantity: 2, purchaseDate: '2024-01-10', retiredAt: '2025-06-01' })
  const out = gearPurchases([cam, laptop, cards, noDate, retired])

  assert.deepEqual(
    out.map((p) => p.itemId),
    ['old', 'laptop', 'cards', 'cable', 'cam'],
    'po dacie rosnąco; bez daty na końcu, między sobą po nazwie (Kabel < Sony)'
  )
  const byId = Object.fromEntries(out.map((p) => [p.itemId, p]))
  assert.deepEqual(byId.cards, {
    itemId: 'cards',
    name: 'Karty SD',
    date: '2025-05-02',
    price: 540,
    quantity: 6,
    onSet: false,
    undated: false,
  })
  assert.equal(byId.old.price, 1600, 'wycofany nadal jest wydatkiem')
  assert.equal(byId.old.onSet, true)
  assert.equal(byId.cam.undated, true)
  assert.equal(byId.cam.date, null)
  assert.equal(byId.cable.undated, true)
  assert.equal(byId.cable.price, 40)
})

test('gearPurchases: zła data = bez daty, cena 0 zostaje na liście, wejście nietknięte', () => {
  const input = [item('x', 'X', { purchaseDate: '12.03.2025' }), item('y', 'Y', { purchaseDate: '2025-02-30x' })]
  const copy = JSON.parse(JSON.stringify(input))
  const out = gearPurchases(input)
  assert.equal(out.length, 2)
  assert.ok(out.every((p) => p.undated && p.date === null && p.price === 0))
  assert.deepEqual(input, copy)
  assert.deepEqual(gearPurchases([]), [])
})

test('investedSplit: plan i zaplecze osobno, razem = suma, brakujące ceny i daty zaplecza policzone', () => {
  const noPrice = item('cable', 'Kabel', { onSet: false })
  const split = investedSplit([cam, laptop, cards, noPrice])
  assert.equal(split.onSet, 10000)
  assert.equal(split.backstage, 9000 + 540)
  assert.equal(split.total, 10000 + 9540)
  assert.equal(split.backstageCount, 3)
  assert.equal(split.backstageUnpriced, 1)
  assert.equal(split.backstageUndated, 1)
})

// ── Wyłączenia ───────────────────────────────────────────────────────────────

test('statystyki: zaplecze nie wchodzi do raportu, nawet gdy wpadnie w gearDays', () => {
  const projects = [project('p1', [day('d1', [['cam', 1], ['laptop', 1]], '2026-03-01')])]
  const report = computeGearReport([cam, laptop, cards], projects, { now: NOW })
  assert.deepEqual(report.items.map((r) => r.item.id), ['cam'])
  assert.equal(report.totals.invested, 10000, 'zainwestowane w statystykach = tylko na plan')
  assert.equal(report.totals.activeCount, 1)
  assert.equal(report.totals.unusedCount, 0)
  assert.equal(report.totals.rentValue, 500, 'laptop (stawka 0 i tak) nie dolicza dni')
})

test('statystyki: zaplecze ze stawką rentalową nie dolicza „odpracował"', () => {
  const rented = item('rented', 'Dysk', { onSet: false, purchasePrice: 500, rentalDayRate: 100 })
  const projects = [project('p1', [day('d1', [['cam', 1], ['rented', 1]], '2026-03-01')])]
  const report = computeGearReport([cam, rented], projects, { now: NOW })
  assert.equal(report.totals.rentValue, 500)
  assert.equal(report.items.length, 1)
  const summary = summarizeProjectGear(projects[0], [cam, rented])
  assert.equal(summary.rentValue, 500)
  assert.equal(summary.items.find((u) => u.itemId === 'rented')?.item ?? null, null, 'jak pozycja spoza katalogu')
})

test('lista pakowania pomija zaplecze, ale zostawia sprzęt na plan', () => {
  const p = project('p1', [day('d1', [['cam', 1], ['laptop', 1], ['cards', 6]])])
  const groups = buildPackingList(p, [cam, laptop, cards])
  assert.deepEqual(groups.flatMap((g) => g.items.map((i) => i.item.id)), ['cam'])
  assert.deepEqual(buildPackingList(p, [cam, laptop, cards], 'd1').flatMap((g) => g.items.map((i) => i.item.id)), ['cam'])
})

test('zestaw w Realizacji nie dopisuje zaplecza', () => {
  const days = [day('d1', [])]
  const next = applyKitToGearDay(
    days,
    'd1',
    [
      { itemId: 'cam', qty: 1 },
      { itemId: 'laptop', qty: 1 },
    ],
    [cam, laptop]
  )
  assert.deepEqual(next[0].lines.map((l) => l.itemId), ['cam'])
})

// ── Szybkie wpisywanie ───────────────────────────────────────────────────────

test('parseMoney: spacje, przecinek, „zł"; śmieci i wartości ujemne → 0', () => {
  assert.equal(parseMoney('9 500'), 9500)
  assert.equal(parseMoney('1\u00a0234,50 zł'), 1234.5)
  assert.equal(parseMoney('89'), 89)
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney('abc'), 0)
  assert.equal(parseMoney('-5'), 0)
})

test('parseDateText: ISO i polski zapis; nieistniejące daty odrzucone', () => {
  assert.equal(parseDateText('2025-03-12'), '2025-03-12')
  assert.equal(parseDateText('12.03.2025'), '2025-03-12')
  assert.equal(parseDateText('2.3.2025'), '2025-03-02')
  assert.equal(parseDateText('12/03/2025'), '2025-03-12')
  assert.equal(parseDateText('31.02.2025'), '')
  assert.equal(parseDateText('2025-02-30'), '')
  assert.equal(parseDateText('wczoraj'), '')
  assert.equal(parseDateText(''), '')
})

test('parseBackstageRows: średnik i tabulator, pola opcjonalne, linie bez nazwy pominięte', () => {
  const text = [
    'Laptop MacBook Pro ; 9 500 ; 12.03.2025',
    '',
    'Karta SD 128 GB ; 89 ; 2025-05-02 ; 6 ; Sandisk',
    'Magic arm ; 140',
    '; 50 ; 2025-01-01',
    'Kabel\t15,5\t\t3\tUSB-C\tdługi',
  ].join('\n')
  const { rows, badDates } = parseBackstageRows(text)
  assert.deepEqual(rows, [
    { name: 'Laptop MacBook Pro', purchasePrice: 9500, purchaseDate: '2025-03-12', quantity: 1, notes: '' },
    { name: 'Karta SD 128 GB', purchasePrice: 89, purchaseDate: '2025-05-02', quantity: 6, notes: 'Sandisk' },
    { name: 'Magic arm', purchasePrice: 140, purchaseDate: '', quantity: 1, notes: '' },
    { name: 'Kabel', purchasePrice: 15.5, purchaseDate: '', quantity: 3, notes: 'USB-C długi' },
  ])
  assert.deepEqual(badDates, [])
})

test('parseBackstageRows: nieczytelna data zgłoszona z numerem linii, pozycja wchodzi bez daty', () => {
  const { rows, badDates } = parseBackstageRows('A ; 10 ; 2025-03-12\nB ; 20 ; marzec\nC ; 30 ; 31.02.2025')
  assert.equal(rows.length, 3)
  assert.deepEqual(badDates, [2, 3])
  assert.equal(rows[1].purchaseDate, '')
  assert.equal(rows[1].purchasePrice, 20)
})

test('parseBackstageRows: ułamkowa i zerowa liczba sztuk → 1, ułamek obcięty', () => {
  const { rows } = parseBackstageRows('A ; 1 ; ; 0\nB ; 1 ; ; 2,9\nC ; 1 ; ; x')
  assert.deepEqual(rows.map((r) => r.quantity), [1, 2, 1])
})
