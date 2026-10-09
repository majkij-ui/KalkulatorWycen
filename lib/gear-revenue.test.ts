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
  assert.deepEqual(snapshotGearRevenue({ data: QUICK }), { charged: 3000, rentedIn: 0, ownGear: 3000 })
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
  assert.deepEqual(partly, { charged: 3000, rentedIn: 1000, ownGear: 2000 })

  const unticked = snapshotGearRevenue({
    data: { ...QUICK, profitOverrides: { 'pro:rentalSprzetu': { unitCost: 1000 } } },
  })
  assert.equal(unticked?.rentedIn, 0, 'niezaznaczona pozycja to nie koszt')

  const more = snapshotGearRevenue({
    data: { ...QUICK, profitOverrides: { 'pro:rentalSprzetu': { isCost: true, unitCost: 5000 } } },
  })
  assert.equal(more?.ownGear, 0)
})
