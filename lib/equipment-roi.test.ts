import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPackingList,
  computeCatalogRoi,
  computeCatalogTotals,
  computeEquipmentRoi,
} from './equipment-roi'
import type { EquipmentCategory, EquipmentItem, Project, ProjectStatus } from './project-types'

function item(
  id: string,
  name: string,
  purchasePrice: number,
  rentalDayRate: number,
  category: EquipmentCategory = 'kamery'
): EquipmentItem {
  return { id, name, category, purchasePrice, rentalDayRate, purchaseDate: '', notes: '' }
}

function project(
  id: string,
  status: ProjectStatus,
  equipment: { itemId: string; days: number }[]
): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date: '2026-01-01',
    createdAt: '',
    updatedAt: '',
    quote: {} as Project['quote'],
    financials: null,
    equipment,
    notes: '',
  }
}

test('ROI sumuje dni i mnoży przez stawkę rentalową', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const projects = [
    project('p1', 'done', [{ itemId: 'c1', days: 3 }]),
    project('p2', 'won', [{ itemId: 'c1', days: 2 }]),
  ]
  const roi = computeEquipmentRoi(camera, projects)

  assert.equal(roi.timesUsed, 2)
  assert.equal(roi.totalDays, 5)
  assert.equal(roi.earned, 2500)
  assert.equal(roi.roiPct, 12.5)
  assert.equal(roi.remainingToBreakEven, 17500)
  assert.equal(roi.isPaidOff, false)
})

test('wyceny i przegrane nie generują ROI', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const projects = [
    project('p1', 'quote', [{ itemId: 'c1', days: 10 }]),
    project('p2', 'lost', [{ itemId: 'c1', days: 10 }]),
  ]
  const roi = computeEquipmentRoi(camera, projects)

  assert.equal(roi.timesUsed, 0, 'sama wycena niczego nie zarobiła')
  assert.equal(roi.totalDays, 0)
  assert.equal(roi.earned, 0)
})

test('sprzęt spłacony jest oznaczony, a reszta do spłaty nie schodzi poniżej zera', () => {
  const light = item('l1', 'Aputure 600d', 5000, 300, 'swiatlo')
  const projects = Array.from({ length: 4 }, (_, i) =>
    project(`p${i}`, 'done', [{ itemId: 'l1', days: 5 }])
  )
  const roi = computeEquipmentRoi(light, projects)

  assert.equal(roi.totalDays, 20)
  assert.equal(roi.earned, 6000)
  assert.equal(roi.isPaidOff, true)
  assert.equal(roi.remainingToBreakEven, 0, 'po spłacie zostaje 0, nie liczba ujemna')
  assert.equal(roi.roiPct, 120)
})

test('brak ceny zakupu daje ROI null zamiast dzielenia przez zero', () => {
  const rented = item('r1', 'Wynajmowany wózek', 0, 400, 'inne')
  const roi = computeEquipmentRoi(rented, [project('p1', 'done', [{ itemId: 'r1', days: 2 }])])

  assert.equal(roi.earned, 800)
  assert.equal(roi.roiPct, null)
  assert.equal(roi.remainingToBreakEven, null)
  assert.equal(roi.isPaidOff, false)
})

test('pozycje z zerową liczbą dni nie liczą się jako użycie', () => {
  const camera = item('c1', 'FX3', 20000, 500)
  const roi = computeEquipmentRoi(camera, [project('p1', 'done', [{ itemId: 'c1', days: 0 }])])
  assert.equal(roi.timesUsed, 0)
  assert.equal(roi.earned, 0)
})

test('katalog jest sortowany malejąco po zarobku, a sumy się zgadzają', () => {
  const items = [
    item('a', 'Tania lampa', 1000, 100, 'swiatlo'),
    item('b', 'Kamera', 20000, 500),
    item('c', 'Nieużywany mikrofon', 3000, 200, 'dzwiek'),
  ]
  const projects = [
    project('p1', 'done', [
      { itemId: 'a', days: 2 },
      { itemId: 'b', days: 10 },
    ]),
  ]
  const roi = computeCatalogRoi(items, projects)
  assert.deepEqual(roi.map((r) => r.item.id), ['b', 'a', 'c'])

  const totals = computeCatalogTotals(roi)
  assert.equal(totals.totalInvested, 24000)
  assert.equal(totals.totalEarned, 5000 + 200)
  assert.equal(totals.unusedCount, 1, 'mikrofon ani razu nieużyty')
  assert.equal(totals.paidOffCount, 0)
})

test('lista pakowania grupuje po kategorii i pomija sprzęt spoza katalogu', () => {
  const catalog = [
    item('c1', 'FX3', 0, 0, 'kamery'),
    item('c2', 'A7S', 0, 0, 'kamery'),
    item('l1', 'Aputure', 0, 0, 'swiatlo'),
  ]
  const p = project('p1', 'won', [
    { itemId: 'c2', days: 1 },
    { itemId: 'c1', days: 1 },
    { itemId: 'l1', days: 1 },
    { itemId: 'usuniety', days: 1 },
    { itemId: 'c1-zero', days: 0 },
  ])

  const list = buildPackingList(p, catalog)
  assert.deepEqual(list.map((g) => g.category), ['kamery', 'swiatlo'])
  assert.deepEqual(
    list[0].items.map((i) => i.item.name),
    ['A7S', 'FX3'],
    'w obrębie kategorii alfabetycznie'
  )
  assert.equal(list.length, 2, 'pozycja spoza katalogu nie tworzy grupy')
})

test('lista pakowania trzyma kolejność katalogu, nie alfabetyczną', () => {
  const catalog = [
    item('d1', 'Rode NTG5', 0, 0, 'dzwiek'),
    item('i1', 'Statyw', 0, 0, 'inne'),
    item('c1', 'FX3', 0, 0, 'kamery'),
    item('s1', 'Aputure', 0, 0, 'swiatlo'),
  ]
  const p = project('p1', 'won', [
    { itemId: 'd1', days: 1 },
    { itemId: 'i1', days: 1 },
    { itemId: 'c1', days: 1 },
    { itemId: 's1', days: 1 },
  ])
  assert.deepEqual(
    buildPackingList(p, catalog).map((g) => g.category),
    ['kamery', 'swiatlo', 'dzwiek', 'inne'],
    'alfabetycznie byłoby dzwiek, inne, kamery, swiatlo'
  )
})
