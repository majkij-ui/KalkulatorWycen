/**
 * Sprzęt: „Bez sprzętu" (missingGear), „Na plusie" / wynik końcowy
 * (gearBalance) i sprzedaż (filtr list wyboru). Tabele przypadków z
 * docs/PLAN-W-WYCENA-REALIZACJA.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeGearReport, formatGearBalance, gearBalance } from './equipment-roi'
import { addKitToQuoteGear } from './quote-gear'
import { applyKitToGearDay, soldBeforeDay, toggleGearItemAllDays } from './gear-usage'
import type { EquipmentItem, GearDay, Project } from './project-types'

const NOW = new Date(2026, 10, 10, 12)

function item(id: string, purchasePrice: number, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name: id, category: 'kamery', purchasePrice, rentalDayRate: 100, purchaseDate: '', notes: '', ...extra }
}

function project(id: string, extra: Partial<Project> & { gearDays?: GearDay[] } = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-05-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...extra,
  } as Project
}

const gearDay = (itemId: string, date = '2026-05-01'): GearDay => ({
  id: `d-${itemId}`,
  label: '',
  date,
  lines: [{ itemId, qty: 1 }],
})

// ── „Bez sprzętu" ────────────────────────────────────────────────────────────

test('missingGear: oznaczony noGear nie jest w ostrzeżeniu, ale jest w reviewedNoGear', () => {
  const report = computeGearReport([item('a', 1000)], [project('p1', { noGear: true }), project('p2')], { now: NOW })
  assert.deepEqual(report.missingGear.map((m) => m.project.id), ['p2'])
  assert.deepEqual(report.reviewedNoGear.map((m) => m.project.id), ['p1'])
})

test('missingGear: nowy zrealizowany projekt bez sprzętu i bez flagi jest w ostrzeżeniu', () => {
  const report = computeGearReport([item('a', 1000)], [project('nowy')], { now: NOW })
  assert.equal(report.missingGear.length, 1)
  assert.equal(report.reviewedNoGear.length, 0)
})

test('missingGear: projekt z flagą, który dostał sprzęt, liczy się normalnie', () => {
  const p = project('p1', { noGear: true, gearDays: [gearDay('a')] })
  const report = computeGearReport([item('a', 1000)], [p], { now: NOW })
  assert.equal(report.missingGear.length, 0)
  assert.equal(report.reviewedNoGear.length, 0)
  assert.equal(report.items[0].projectsUsed, 1)
})

// ── gearBalance ──────────────────────────────────────────────────────────────

test('gearBalance: Zarobił − zainwestowane, bez ceny zakupu null', () => {
  assert.deepEqual(gearBalance({ invested: 8500, clientPaid: 11871 }, item('a', 8500)), { balance: 3371, final: false })
  assert.deepEqual(gearBalance({ invested: 1500, clientPaid: 13 }, item('b', 1500)), { balance: -1487, final: false })
  assert.equal(gearBalance({ invested: 0, clientPaid: 500 }, item('c', 0)), null)
})

test('gearBalance: A7 III zarobił 11 871, sprzedany za 3 000, zainwestowane 8 500 → +6 371', () => {
  const sold = item('a7', 8500, { soldDate: '2026-09-01', soldPrice: 3000 })
  assert.deepEqual(gearBalance({ invested: 8500, clientPaid: 11871 }, sold), { balance: 6371, final: true })
})

test('gearBalance: RED zarobił 6 733, sprzedany za 30 000, zainwestowane 57 000 → −20 267', () => {
  const sold = item('red', 57000, { soldDate: '2026-09-01', soldPrice: 30000 })
  const b = gearBalance({ invested: 57000, clientPaid: 6733 }, sold)
  assert.deepEqual(b, { balance: -20267, final: true })
})

test('gearBalance: cofnięta sprzedaż wraca do „Na plusie"', () => {
  const cleared = item('a7', 8500)
  assert.deepEqual(gearBalance({ invested: 8500, clientPaid: 11871 }, cleared), { balance: 3371, final: false })
})

test('gearBalance: 2 szt. → zainwestowane = 2 × cena (z raportu)', () => {
  const report = computeGearReport([item('lampa', 1000, { quantity: 2 })], [], { now: NOW })
  const roi = report.items[0]
  assert.equal(roi.invested, 2000)
  assert.deepEqual(gearBalance(roi, roi.item), { balance: -2000, final: false })
})

test('formatGearBalance: plus, do spłaty, wynik końcowy', () => {
  assert.match(formatGearBalance({ balance: 1764, final: false }), /^\+1.764 zł$/)
  assert.match(formatGearBalance({ balance: -1487, final: false }), /^Do spłaty 1.487 zł$/)
  assert.match(formatGearBalance({ balance: -20267, final: true }), /^−20.267 zł$/)
})

test('sprzedaż nie zmienia statystyk użycia (Odpracował/Zarobił liczą przeszłość)', () => {
  const p = project('p1', { gearDays: [gearDay('a')] })
  const before = computeGearReport([item('a', 1000)], [p], { now: NOW }).items[0]
  const after = computeGearReport([item('a', 1000, { soldDate: '2026-06-01', soldPrice: 500 })], [p], { now: NOW }).items[0]
  assert.equal(after.projectsUsed, before.projectsUsed)
  assert.equal(after.rentValue, before.rentValue)
  assert.equal(after.clientPaid, before.clientPaid)
})

// ── filtr list wyboru ────────────────────────────────────────────────────────

test('soldBeforeDay: sprzedany przed dniem tak, w dniu sprzedaży i wcześniej nie, brak daty dnia = dziś', () => {
  const sold = { soldDate: '2026-09-01' }
  assert.equal(soldBeforeDay(sold, '2026-09-02'), true)
  assert.equal(soldBeforeDay(sold, '2026-09-01'), false)
  assert.equal(soldBeforeDay(sold, '2026-08-31'), false)
  assert.equal(soldBeforeDay(sold, undefined, '2026-11-10'), true)
  assert.equal(soldBeforeDay(sold, '', '2026-08-01'), false)
  assert.equal(soldBeforeDay({}, '2030-01-01'), false)
})

test('toggleGearItemAllDays: pomija dni po sprzedaży, istniejące wpisy zostają', () => {
  const days: GearDay[] = [
    { id: 'd1', label: '', date: '2026-08-01', lines: [] },
    { id: 'd2', label: '', date: '2026-10-01', lines: [] },
    { id: 'd3', label: '', date: '2026-10-02', lines: [{ itemId: 'a', qty: 1 }] },
  ]
  const blocked = (d: GearDay) => soldBeforeDay({ soldDate: '2026-09-01' }, d.date)
  const next = toggleGearItemAllDays(days, 'a', 1, blocked)
  assert.equal(next[0].lines.length, 1)
  assert.equal(next[1].lines.length, 0)
  assert.equal(next[2].lines.length, 1)
})

test('applyKitToGearDay: sprzedany przed dniem nie wchodzi z zestawem', () => {
  const days: GearDay[] = [{ id: 'd1', label: '', date: '2026-10-01', lines: [] }]
  const catalog = [item('a', 100, { soldDate: '2026-09-01' }), item('b', 100)]
  const next = applyKitToGearDay(days, 'd1', [{ itemId: 'a', qty: 1 }, { itemId: 'b', qty: 1 }], catalog)
  assert.deepEqual(next[0].lines.map((l) => l.itemId), ['b'])
})

test('addKitToQuoteGear: sprzedany przed „dziś" nie wchodzi do wyceny, istniejące linie zostają', () => {
  const catalog = [
    { id: 'a', name: 'a', rentalDayRate: 100, soldDate: '2026-09-01' },
    { id: 'b', name: 'b', rentalDayRate: 100 },
  ]
  const lines = addKitToQuoteGear(undefined, [{ itemId: 'a', qty: 1 }, { itemId: 'b', qty: 1 }], catalog, '2026-11-10')
  assert.deepEqual(lines.map((l) => l.itemId), ['b'])
})
