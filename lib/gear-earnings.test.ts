import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gearEarnings, pdfGearRow, type GearEarningsInput } from './gear-earnings'
import type { EquipmentItem, GearDay, ProjectCost } from './project-types'
import type { FinancialsSource } from './quote-financials'

// Szybka wycena: 2 dni, pakiet „standard" (1500 zł/dzień) → kalkulator drukuje 3000 zł za sprzęt.
const QUICK = { dniZdjeciowe: 2, wielkoscEkipy: 1, klasaSprzetu: 'standard' }

function quote(extra: Record<string, unknown> = {}, pdfDraft?: unknown): FinancialsSource {
  return { data: { ...QUICK, ...extra }, marginMultiplier: 1, ...(pdfDraft ? { pdfDraft } : {}) } as FinancialsSource
}

function draft(sprzet: number, currency: 'PLN' | 'EUR' = 'PLN', exchangeRate = 4.3) {
  return { currency, exchangeRate, rows: { ekipa: { cenaNetto: 5000 }, sprzet: { cenaNetto: sprzet } } }
}

function item(id: string, rentalDayRate: number, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name: id, category: 'kamery', purchasePrice: 10000, rentalDayRate, purchaseDate: '', notes: '', ...extra }
}

function day(id: string, lines: [string, number][]): GearDay {
  return { id, label: '', date: '', lines: lines.map(([itemId, qty]) => ({ itemId, qty })) }
}

let n = 0
function cost(category: string, amount: number, extra: Partial<ProjectCost> = {}): ProjectCost {
  n += 1
  return { id: `c${n}`, category, quantity: 1, unitCost: amount, ...extra }
}

const CATALOG = new Map(
  [item('cam', 400), item('lens', 100), item('light', 150), item('tripod', 0), item('laptop', 200, { onSet: false })].map((i) => [i.id, i])
)

function run(extra: Partial<GearEarningsInput>) {
  return gearEarnings({ quote: quote({}, draft(1200)), costs: [], gearDays: [], catalog: CATALOG, ...extra })
}

test('wiersz Sprzęt z PDF, nie kalkulator ani przelew', () => {
  const row = pdfGearRow(quote({ profitTransferAmount: 20000 }, draft(1200)))
  assert.deepEqual(row, { pln: 1200, amount: 1200, currency: 'PLN', rate: null, source: 'pdf' })
})

test('bez szkicu PDF: wiersz Sprzęt, który wydrukowałby kalkulator', () => {
  assert.deepEqual(pdfGearRow(quote()), { pln: 3000, amount: 3000, currency: 'PLN', rate: null, source: 'calculator' })
  assert.equal(pdfGearRow({ data: { ...QUICK }, marginMultiplier: 1.2 } as FinancialsSource)?.pln, 3600, 'marża z suwaka jak w PDF')
})

test('PDF w EUR: € × kurs wyceny; stary szkic EUR do wyceny w zł — × kurs szkicu', () => {
  const eur = pdfGearRow(quote({ currency: 'EUR', exchangeRate: 4.3661 }, draft(260, 'EUR', 4.3)))!
  assert.equal(eur.currency, 'EUR')
  assert.equal(eur.rate, 4.3661)
  assert.ok(Math.abs(eur.pln - 260 * 4.3661) < 1e-9)
  const legacy = pdfGearRow(quote({}, draft(100, 'EUR', 4.3)))!
  assert.ok(Math.abs(legacy.pln - 430) < 1e-9)
})

test('bez wyceny nie wiadomo, ile zarobił sprzęt', () => {
  assert.equal(pdfGearRow(null), null)
  const none = run({ quote: null, gearDays: [day('d1', [['cam', 1]])] })
  assert.equal(none.earned, null)
  assert.equal(none.assigned, 0)
  assert.equal(none.unassigned, 0)
  assert.equal(none.shares[0].earned, 0)
})

test('zarobił = Sprzęt − wynajem z Realizacji (zaznaczony, zewnętrzny)', () => {
  const costs = [
    cost('wynajem', 300),
    cost('wynajem', 100, { dayId: 'd1' }),
    cost('wynajem', 999, { skipped: true }),
    cost('wynajem', 999, { ownWork: true }),
    cost('wynajem', 999, { deletedAt: '2026-10-01T00:00:00.000Z' }),
    cost('inne', 950, { label: 'Rental' }),
  ]
  const e = run({ costs, gearDays: [day('d1', [['cam', 1]])] })
  assert.equal(e.rentals, 400)
  assert.equal(e.computed, 800)
  assert.equal(e.earned, 800)
  assert.equal(e.rentalsOver, 0)
})

test('wynajem większy niż wiersz Sprzęt: zarobił jest ujemny i tak samo się dzieli (decyzja 2026-10-24)', () => {
  const e = run({
    quote: quote({}, draft(600)),
    costs: [cost('wynajem', 700, { dayId: 'd1' })],
    gearDays: [day('d1', [['cam', 1], ['lens', 1]])],
  })
  assert.equal(e.earned, -100)
  assert.equal(e.rentalsOver, 100)
  assert.equal(e.shares.find((s) => s.itemId === 'cam')?.earned, -80)
  assert.equal(e.shares.find((s) => s.itemId === 'lens')?.earned, -20)
  assert.equal(e.assigned, -100)
  assert.equal(e.unassigned, 0)
})

test('kwota wpisana w projekcie wygrywa (np. wynajem w osobnym wierszu PDF), wyliczona zostaje widoczna', () => {
  const e = run({ costs: [cost('wynajem', 1000)], gearDays: [day('d1', [['cam', 1]])], override: 1200 })
  assert.equal(e.computed, 200)
  assert.equal(e.override, 1200)
  assert.equal(e.earned, 1200)
  assert.equal(e.shares[0].earned, 1200)
  assert.equal(run({ override: Number.NaN }).override, null, 'śmieci = brak wpisanej kwoty')
})

test('podział: stawka × dni na planie, dzień po dniu (pozycje różne w dniach)', () => {
  const e = run({
    gearDays: [day('d1', [['cam', 1], ['light', 2]]), day('d2', [['cam', 1]]), day('d3', [['cam', 1], ['lens', 1]])],
  })
  // wagi: cam 3 × 400 = 1200, light 2 × 150 = 300, lens 100 → 1600
  const share = (id: string) => e.shares.find((s) => s.itemId === id)!
  assert.equal(share('cam').earned, 900)
  assert.equal(share('light').earned, 225)
  assert.equal(share('lens').earned, 75)
  assert.equal(share('cam').unitDays, 3)
  assert.deepEqual(e.shares.map((s) => s.itemId), ['cam', 'light', 'lens'], 'malejąco po wadze')
  assert.equal(e.source, 'grid')
})

test('bez stawki — „bez stawki", nic nie dostaje; zaplecze i pozycje spoza katalogu nie liczą się nigdy', () => {
  const e = run({ gearDays: [day('d1', [['cam', 1], ['tripod', 1], ['laptop', 1], ['ghost', 1]])] })
  assert.deepEqual(e.shares.map((s) => s.itemId), ['cam'])
  assert.equal(e.shares[0].earned, 1200)
  assert.deepEqual(e.noRate.map((i) => i.id), ['tripod'])
  const only = run({ gearDays: [day('d1', [['tripod', 1]])] })
  assert.equal(only.assigned, 0)
  assert.equal(only.unassigned, 1200, 'same pozycje bez stawki: nie ma komu przypisać')
})

test('pusta siatka: sprzęt z dni wyceny; bez niego kwota czeka nieprzypisana', () => {
  const detailed = {
    isDetailedProdukcja: true,
    detailedShootingDays: [
      { id: 'q1', gear: [{ itemId: 'cam', name: 'cam', rate: 400, qty: 1 }, { itemId: 'lens', name: 'lens', rate: 100, qty: 1, gratis: true }] },
      { id: 'q2', gear: [{ itemId: 'cam', name: 'cam', rate: 400, qty: 1 }] },
    ],
  }
  const fromQuote = run({ quote: quote(detailed, draft(900)), gearDays: [day('d1', [])] })
  assert.equal(fromQuote.source, 'quote')
  assert.equal(fromQuote.shares.find((s) => s.itemId === 'cam')?.earned, 800)
  assert.equal(fromQuote.shares.find((s) => s.itemId === 'lens')?.earned, 100)

  const grid = run({ quote: quote(detailed, draft(900)), gearDays: [day('d1', [['light', 1]])] })
  assert.equal(grid.source, 'grid', 'siatka wygrywa')
  assert.deepEqual(grid.shares.map((s) => s.itemId), ['light'])

  const nothing = run({})
  assert.equal(nothing.source, 'none')
  assert.equal(nothing.unassigned, 1200)
})
