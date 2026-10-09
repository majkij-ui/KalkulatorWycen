import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addKitToQuoteGear,
  clampDiscount,
  dayGearFigures,
  hasLegacyGear,
  pdfGearSentences,
  quoteGearFigures,
  refreshGearLines,
  setQuoteGearLine,
  staleGearLines,
} from './quote-gear'
import { computeShootingDayNet, getBreakdownWithPricing, getProductionEkipaCastSprzetNetto } from './quote-calc'
import { isRentalCostKey, rentalLineKey, resolveProfitSections } from './profit-calc'
import { planLineCategory } from './realization-plan'
import { mergeQuoteDataPartial, computeTotalCrewDays } from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import { cloneShootingDay, createDefaultShootingDay, type QuoteData, type ShootingDay } from './quote-types'

const FX3 = { itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }
const LIGHTS = { itemId: 'amaran', name: 'Amaran 60x', rate: 60, qty: 2 }

function day(extra: Partial<ShootingDay> = {}): ShootingDay {
  return { ...createDefaultShootingDay(), ...extra }
}

function quote(days: ShootingDay[], extra: Partial<QuoteData> = {}): QuoteData {
  return mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: days, ...extra })
}

test('dzień: wartość, cena po rabacie, gratis za 0, wypożyczalnia osobno', () => {
  const figures = dayGearFigures(
    day({
      gear: [FX3, LIGHTS, { itemId: 'dron', name: 'Mavic', rate: 300, qty: 1, gratis: true }],
      externalRentals: [
        { id: 'r1', label: 'Cooke', amount: 1200 },
        { id: 'r2', label: 'zły wpis', amount: -50 },
      ],
    }),
    25
  )
  assert.equal(figures.value, 400 + 120 + 300)
  assert.equal(figures.charged, (400 + 120) * 0.75)
  assert.equal(figures.byItem.get('dron'), 0)
  assert.equal(figures.external, 1200, 'ujemna kwota to 0')
})

test('rabat zawsze w 0–100 %', () => {
  assert.equal(clampDiscount(150), 100)
  assert.equal(clampDiscount(-5), 0)
  assert.equal(clampDiscount(Number.NaN), 0)
  assert.equal(clampDiscount('30'), 30)
  assert.equal(mergeQuoteDataPartial({ gearDiscountPercent: 140 }).gearDiscountPercent, 100)
  assert.equal(mergeQuoteDataPartial({}).gearDiscountPercent, 0, 'stara wycena = bez rabatu')
  assert.equal(mergeQuoteDataPartial({}).gearValueInPdf, true)
})

test('szybka wycena ignoruje sprzęt z dni szczegółowych (jak resztę dni)', () => {
  const data = quote([day({ gear: [FX3] })], { isDetailedProdukcja: false })
  assert.equal(quoteGearFigures(data).charged, 0)
  assert.equal(quoteGearFigures(data).hasCatalogGear, false)
})

test('cena dnia: stare pola z marżą jak dotąd, sprzęt z katalogu i wypożyczalnia bez marży', () => {
  const pro = DEFAULT_PRICING.produkcja
  const d = day({ rezOp: 1, swiatlo: 'standard', gear: [FX3], externalRentals: [{ id: 'r', label: 'x', amount: 500 }] })
  const data = quote([d], { gearDiscountPercent: 50 })
  const [, production] = getBreakdownWithPricing(data, 1.2, DEFAULT_PRICING)
  const line = production.items[0]
  assert.equal(line.lineNetto, (pro.rezOp + pro.swiatloStandard) * 1.2 + 200 + 500)

  const split = getProductionEkipaCastSprzetNetto(data, 1.2, DEFAULT_PRICING)
  assert.equal(split.sprzetNetto, pro.swiatloStandard * 1.2 + 200 + 500)
  assert.equal(
    split.ekipaNetto + split.castNetto + split.sprzetNetto,
    production.phaseNetto,
    'podział do PDF sumuje się do fazy Produkcja'
  )
})

test('dzień bez sprzętu z katalogu liczy się dokładnie jak przed G5', () => {
  const d = day({ rezOp: 2, kameraSony: 1, obiektywy: 'rental', dayAdjustment: -300 })
  const [, production] = getBreakdownWithPricing(quote([d]), 1.1, DEFAULT_PRICING)
  assert.equal(production.items[0].lineNetto, computeShootingDayNet(d, DEFAULT_PRICING.produkcja) * 1.1 - 300)
})

test('wypożyczalnia w dniu to pozycja kosztowa planu w kategorii „wynajem"', () => {
  const d = day({ externalRentals: [{ id: 'r1', label: 'Obiektywy Cooke', amount: 1200 }, { id: 'r0', label: '', amount: 0 }] })
  const data = quote([d])
  const lines = resolveProfitSections(data, DEFAULT_PRICING, computeTotalCrewDays(data)).sections.flatMap((s) => s.lines)
  const rental = lines.filter((l) => l.key.includes(':rental:'))
  assert.equal(rental.length, 1, 'pusta kwota nie tworzy pozycji')
  assert.equal(rental[0].key, rentalLineKey(d.id, 'r1'))
  assert.equal(rental[0].label, 'Obiektywy Cooke')
  assert.equal(rental[0].isCost, true)
  assert.equal(rental[0].total, 1200)
  assert.equal(planLineCategory(rental[0]), 'wynajem')
  assert.equal(isRentalCostKey('pro:rentalSprzetu'), true)
  assert.equal(isRentalCostKey(`pro:${d.id}:rezOp`), false)
})

test('dodanie pozycji zamraża stawkę i nazwę; zmiana sztuk ich nie rusza; 0 usuwa', () => {
  const item = { id: 'fx3', name: 'Sony FX3', rentalDayRate: 400 }
  let lines = setQuoteGearLine(undefined, item, 1)
  assert.deepEqual(lines, [{ itemId: 'fx3', name: 'Sony FX3', rate: 400, qty: 1 }])
  lines = setQuoteGearLine(lines, { ...item, rentalDayRate: 999 }, 2)
  assert.equal(lines[0].rate, 400, 'istniejąca pozycja trzyma swoją stawkę')
  assert.equal(lines[0].qty, 2)
  assert.deepEqual(setQuoteGearLine(lines, item, 0), [])
})

test('nieaktualne stawki: liczone i odświeżane z katalogu, usunięte pozycje bez zmian', () => {
  const days = [day({ gear: [FX3, LIGHTS, { itemId: 'stary', name: 'GH5', rate: 100, qty: 1 }] })]
  const catalog = [
    { id: 'fx3', name: 'FX3', rentalDayRate: 450 },
    { id: 'amaran', name: 'Amaran 60x', rentalDayRate: 60 },
  ]
  assert.equal(staleGearLines(days, catalog), 1)
  const refreshed = refreshGearLines(days[0].gear, catalog)
  assert.deepEqual(refreshed?.map((l) => l.rate), [450, 60, 100])
  assert.equal(refreshGearLines(undefined, catalog), undefined)
})

test('zestaw dochodzi do dnia bez dublowania i bez wycofanych', () => {
  const catalog = [
    { id: 'fx3', name: 'FX3', rentalDayRate: 400 },
    { id: 'amaran', name: 'Amaran 60x', rentalDayRate: 60 },
    { id: 'gh5', name: 'GH5', rentalDayRate: 100, retiredAt: '2025-01-01' },
  ]
  const lines = addKitToQuoteGear(
    [{ ...FX3, qty: 1 }],
    [
      { itemId: 'fx3', qty: 3 },
      { itemId: 'amaran', qty: 2 },
      { itemId: 'gh5', qty: 1 },
      { itemId: 'nieznany', qty: 1 },
    ],
    catalog
  )
  assert.deepEqual(
    lines.map((l) => `${l.itemId}×${l.qty}`),
    ['fx3×1', 'amaran×2']
  )
})

test('kopia dnia ma własne listy sprzętu i wypożyczalni', () => {
  const source = day({ gear: [{ ...FX3 }], externalRentals: [{ id: 'r1', label: 'Cooke', amount: 1200 }] })
  const copy = cloneShootingDay(source)
  copy.gear![0].qty = 5
  assert.equal(source.gear![0].qty, 1)
  assert.notEqual(copy.externalRentals![0].id, 'r1')
  assert.equal(copy.externalRentals![0].amount, 1200)
  const plain = cloneShootingDay(day())
  assert.equal('gear' in plain, false, 'dzień sprzed G5 nie dostaje pustych pól')
})

test('stare pola sprzętu wykrywane po wartościach, nie po obecności', () => {
  assert.equal(hasLegacyGear(day()), false)
  assert.equal(hasLegacyGear(day({ kameraRed: 1 })), true)
  assert.equal(hasLegacyGear(day({ podglad: 'rental' })), true)
  assert.equal(hasLegacyGear(day({ gear: [FX3] })), false)
})

test('opis sprzętu do PDF: lista, wypożyczalnia i wartość z rabatem tylko gdy włączone', () => {
  const labels = { opisOwnGear: 'Sprzęt', opisRentedGear: 'Z wypożyczalni', opisGearValue: 'Wartość rynkowa sprzętu', opisGearDiscount: 'rabat' }
  const money = (pln: number) => `${Math.round(pln)} zł`
  const days = [
    day({ gear: [FX3, { ...LIGHTS, qty: 1 }], externalRentals: [{ id: 'r', label: 'Cooke', amount: 900 }] }),
    day({ gear: [LIGHTS, { itemId: 'dron', name: 'Mavic', rate: 300, qty: 1, gratis: true }] }),
  ]
  const data = quote(days, { gearDiscountPercent: 50 })
  assert.deepEqual(pdfGearSentences(data, labels, money), [
    'Sprzęt: FX3, 2× Amaran 60x, Mavic.',
    'Z wypożyczalni: Cooke.',
    // wartość 400 + 60 + 120 + 300 = 880; w cenie (400 + 60 + 120) / 2 = 290; rabat i gratis 590
    'Wartość rynkowa sprzętu: 880 zł, rabat: −590 zł.',
  ])
  assert.equal(pdfGearSentences({ ...data, gearValueInPdf: false }, labels, money).length, 2)
  assert.equal(pdfGearSentences({ ...data, gearDiscountPercent: 0, detailedShootingDays: [day({ gear: [FX3] })] }, labels, money).length, 1, 'bez rabatu nie ma czego pokazywać')
  assert.deepEqual(pdfGearSentences({ ...data, isDetailedProdukcja: false }, labels, money), [])
})
