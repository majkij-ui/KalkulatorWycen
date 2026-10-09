import { test } from 'node:test'
import assert from 'node:assert/strict'

import { projectGearRevenue, snapshotGearRevenue } from './gear-revenue'
import { computeQuoteTotals, mergeQuoteDataPartial } from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import { createDefaultShootingDay, type QuoteData } from './quote-types'

/** Szybka wycena: 2 dni, pakiet „standard" (1500 zł/dzień) → 3000 zł za sprzęt. */
const QUICK: Partial<QuoteData> = { dniZdjeciowe: 2, wielkoscEkipy: 1, klasaSprzetu: 'standard' }

test('bez wyceny nie wiadomo, ile zapłacono za sprzęt', () => {
  assert.equal(snapshotGearRevenue(null), null)
  assert.equal(snapshotGearRevenue({}), null)
  assert.equal(projectGearRevenue({ quote: null }), null)
})

test('szybka wycena: pakiet × dni, plus dopłata za drona', () => {
  const quick = snapshotGearRevenue({ data: QUICK })
  assert.equal(quick?.charged, 3000)
  assert.equal(quick?.rentedIn, 0)
  assert.equal(quick?.ownGear, 3000)
  assert.equal(quick?.itemized, 0, 'pakiet to nie pozycje katalogu')
  assert.equal(quick?.unitemized, 3000)
  const withDrone = snapshotGearRevenue({ data: { ...QUICK, crudeDroneSurcharge: true } })
  assert.equal(withDrone?.charged, 2 * (1500 + 800))
})

test('marża z kalkulatora podnosi też kwotę za sprzęt', () => {
  assert.equal(snapshotGearRevenue({ data: QUICK, marginMultiplier: 1.2 })?.charged, 3600)
})

test('szczegółowa wycena: tylko sprzęt z dnia, bez ekipy', () => {
  const day = { ...createDefaultShootingDay(), rezOp: 1, kameraSony: 1, swiatlo: 'standard' as const }
  const revenue = snapshotGearRevenue({
    data: { isDetailedProdukcja: true, detailedShootingDays: [day] },
  })
  const pro = DEFAULT_PRICING.produkcja
  assert.equal(revenue?.charged, pro.kameraSonyMirrorless + pro.swiatloStandard)
})

test('przelew niższy niż wycena obniża proporcjonalnie także sprzęt', () => {
  const sumaNetto = computeQuoteTotals(mergeQuoteDataPartial(QUICK), 1, DEFAULT_PRICING).sumaNetto
  const revenue = snapshotGearRevenue({ data: { ...QUICK, profitTransferAmount: sumaNetto / 2 } })
  assert.equal(revenue?.charged, 1500)
})

test('„Rental sprzętu" zaznaczony jako koszt odejmuje się od własnego sprzętu, nie poniżej zera', () => {
  const partly = snapshotGearRevenue({
    data: { ...QUICK, profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 1000 } } },
  })
  assert.equal(partly?.charged, 3000)
  assert.equal(partly?.rentedIn, 1000)
  assert.equal(partly?.ownGear, 2000)

  const unticked = snapshotGearRevenue({
    data: { ...QUICK, profitOverrides: { 'pro:rentalSprzetu': { unitCost: 1000 } } },
  })
  assert.equal(unticked?.rentedIn, 0, 'niezaznaczona pozycja to nie koszt')

  const more = snapshotGearRevenue({
    data: { ...QUICK, profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 5000 } } },
  })
  assert.equal(more?.ownGear, 0)
})

// ── G5: pozycje z katalogu w wycenie ─────────────────────────────────────────

function detailedDay(extra: Record<string, unknown>) {
  return { ...createDefaultShootingDay(), ...extra }
}

test('pozycje z katalogu: zapłata dokładnie per pozycja, po rabacie, bez „gratis"', () => {
  const revenue = snapshotGearRevenue({
    data: {
      isDetailedProdukcja: true,
      gearDiscountPercent: 50,
      detailedShootingDays: [
        detailedDay({
          gear: [
            { itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 },
            { itemId: 'lampa', name: 'Amaran', rate: 60, qty: 2 },
            { itemId: 'dron', name: 'Mavic', rate: 300, qty: 1, gratis: true },
          ],
        }),
        detailedDay({ gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }] }),
      ],
    },
  })
  assert.equal(revenue?.byItem.get('fx3'), 400, '2 dni × 400 × 50%')
  assert.equal(revenue?.byItem.get('lampa'), 60)
  assert.equal(revenue?.byItem.has('dron'), false, 'gratis: klient nic nie zapłacił')
  assert.equal(revenue?.itemized, 460)
  assert.equal(revenue?.unitemized, 0)
  assert.equal(revenue?.ownGear, 460)
})

test('wypożyczalnia w dniu to koszt, nie zarobek mojego sprzętu', () => {
  const revenue = snapshotGearRevenue({
    data: {
      isDetailedProdukcja: true,
      detailedShootingDays: [
        detailedDay({
          gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }],
          externalRentals: [{ id: 'r1', label: 'Obiektywy Cooke', amount: 1200 }],
        }),
      ],
    },
  })
  assert.equal(revenue?.charged, 1600)
  assert.equal(revenue?.rentedIn, 1200)
  assert.equal(revenue?.ownGear, 400)
  assert.equal(revenue?.byItem.get('fx3'), 400)
})

test('koszt dorentalowania zmniejsza tylko resztę wycenioną po staremu', () => {
  const pro = DEFAULT_PRICING.produkcja
  const revenue = snapshotGearRevenue({
    data: {
      isDetailedProdukcja: true,
      detailedShootingDays: [
        detailedDay({ swiatlo: 'standard', gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }] }),
      ],
      profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 5000 } },
    },
  })
  assert.equal(revenue?.charged, pro.swiatloStandard + 400)
  assert.equal(revenue?.byItem.get('fx3'), 400, 'mój sprzęt z katalogu zostaje nietknięty')
  assert.equal(revenue?.unitemized, 0)
  assert.equal(revenue?.ownGear, 400)
})

test('rabat na całość (niższy przelew) obejmuje też pozycje z katalogu', () => {
  const data = {
    isDetailedProdukcja: true,
    detailedShootingDays: [detailedDay({ rezOp: 1, gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }] })],
  }
  const sumaNetto = computeQuoteTotals(mergeQuoteDataPartial(data), 1, DEFAULT_PRICING).sumaNetto
  const revenue = snapshotGearRevenue({ data: { ...data, profitTransferAmount: sumaNetto / 2 } })
  assert.equal(revenue?.byItem.get('fx3'), 200)
})
