import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gearEarnings } from './gear-earnings'
import { summarizeProjectGear } from './equipment-roi'
import { setGearLine } from './gear-usage'
import { gearDaySchema, projectSchema, type EquipmentItem, type GearDay, type Project } from './project-types'

function item(id: string, rentalDayRate: number): EquipmentItem {
  return { id, name: id, category: 'kamery', purchasePrice: 10000, rentalDayRate, purchaseDate: '', notes: '' }
}

const CATALOG = new Map([item('cam', 400), item('lens', 100), item('tripod', 0)].map((i) => [i.id, i]))

function gearDay(id: string, lines: GearDay['lines']): GearDay {
  return { id, label: '', date: '', lines }
}

function project(gearDays: GearDay[]): Project {
  return projectSchema.parse({
    id: 'p1',
    name: 'p1',
    status: 'done',
    date: '2022-05-01',
    gearDays,
  })
}

test('dayRate pozycji w projekcie wygrywa ze stawką z katalogu (Odpracował)', () => {
  const p = project([
    gearDay('d1', [{ itemId: 'cam', qty: 1, dayRate: 250 }, { itemId: 'lens', qty: 1 }]),
    gearDay('d2', [{ itemId: 'cam', qty: 1, dayRate: 250 }, { itemId: 'lens', qty: 1 }]),
  ])
  const summary = summarizeProjectGear(p, [item('cam', 200), item('lens', 150)])
  assert.equal(summary.items.find((u) => u.itemId === 'cam')?.rentValue, 500, '2 dni × 250 (dayRate), nie 2 × 200')
  assert.equal(summary.items.find((u) => u.itemId === 'lens')?.rentValue, 300, 'bez dayRate: stawka z katalogu')
})

test('dayRate waży podział „zarobił" zamiast stawki z katalogu', () => {
  const run = (gearDays: GearDay[], override: number) =>
    gearEarnings({ quote: null, costs: [], gearDays, catalog: CATALOG, override })
  const withRate = run([gearDay('d1', [{ itemId: 'cam', qty: 1, dayRate: 300 }, { itemId: 'lens', qty: 1 }])], 1000)
  assert.equal(withRate.shares.find((s) => s.itemId === 'cam')?.earned, 750, '300 : 100')
  assert.equal(withRate.shares.find((s) => s.itemId === 'lens')?.earned, 250)
  const without = run([gearDay('d1', [{ itemId: 'cam', qty: 1 }, { itemId: 'lens', qty: 1 }])], 1000)
  assert.equal(without.shares.find((s) => s.itemId === 'cam')?.earned, 800, 'bez dayRate: 400 : 100 z katalogu')
  const noCatalogRate = run([gearDay('d1', [{ itemId: 'tripod', qty: 1, dayRate: 60 }])], 600)
  assert.equal(noCatalogRate.shares[0]?.earned, 600, 'dayRate daje stawkę pozycji bez stawki w katalogu')
  assert.equal(noCatalogRate.noRate.length, 0)
})

test('dayRate: zły zapis jest pomijany, zmiana liczby sztuk go zachowuje', () => {
  assert.equal(gearDaySchema.parse(gearDay('d', [{ itemId: 'cam', qty: 1, dayRate: 250 }])).lines[0].dayRate, 250)
  const bad = gearDaySchema.parse({ id: 'd', lines: [{ itemId: 'cam', qty: 1, dayRate: -5 }] })
  assert.equal(bad.lines[0].dayRate, undefined)
  const days = setGearLine([gearDay('d', [{ itemId: 'cam', qty: 1, dayRate: 250 }])], 'd', 'cam', 2)
  assert.deepEqual(days[0].lines[0], { itemId: 'cam', qty: 2, dayRate: 250 })
})
