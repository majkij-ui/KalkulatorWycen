import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  backfillMissingFinancials,
  computeQuoteTotals,
  computeSnapshotFinancials,
  computeTotalCrewDays,
  mergeQuoteDataPartial,
} from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import type { ProjectFinancials } from './project-types'

const NOW = new Date('2026-10-08T12:00:00.000Z')

function pricingWith(dzienDokumentacji: number) {
  const pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING))
  pricing.preprodukcja.dzienDokumentacji = dzienDokumentacji
  return pricing
}

test('computeSnapshotFinancials: brak danych wyceny → null', () => {
  assert.equal(computeSnapshotFinancials(null, NOW), null)
  assert.equal(computeSnapshotFinancials(undefined, NOW), null)
  assert.equal(computeSnapshotFinancials({}, NOW), null)
})

test('computeSnapshotFinancials: zysk = netto − podatek − koszty', () => {
  const f = computeSnapshotFinancials(
    { data: { dniDokumentacji: 2 }, pricingConfig: pricingWith(1000), marginMultiplier: 1 },
    NOW
  )
  assert.ok(f)
  assert.ok(f.sumaNetto > 0)
  assert.equal(f.podatek, f.sumaNetto * 0.085)
  assert.equal(f.zysk, f.sumaNetto - f.podatek - f.koszty)
  assert.equal(f.computedAt, NOW.toISOString())
})

test('computeSnapshotFinancials: liczy z cennika ZAPISANEGO w migawce', () => {
  const cheap = computeSnapshotFinancials({ data: { dniDokumentacji: 2 }, pricingConfig: pricingWith(500) }, NOW)
  const pricey = computeSnapshotFinancials({ data: { dniDokumentacji: 2 }, pricingConfig: pricingWith(1500) }, NOW)
  assert.ok(cheap && pricey)
  assert.ok(pricey.sumaNetto > cheap.sumaNetto)
})

test('computeSnapshotFinancials: kwota przelewu z zakładki Profit wygrywa z sumą wyceny', () => {
  const f = computeSnapshotFinancials(
    { data: { dniDokumentacji: 2, profitTransferAmount: 12345, profitTaxRatePercent: 10 } },
    NOW
  )
  assert.ok(f)
  assert.equal(f.sumaNetto, 12345)
  assert.equal(f.podatek, 1234.5)
})

test('computeSnapshotFinancials: zgodne z sumami kalkulatora (catering wliczony)', () => {
  const partial = { dniZdjeciowe: 2, wielkoscEkipy: 3, includeCatering: true, cateringRate: 100 }
  const data = mergeQuoteDataPartial(partial)
  const totals = computeQuoteTotals(data, 1, DEFAULT_PRICING)
  assert.equal(computeTotalCrewDays(data), 6)
  assert.equal(totals.cateringCost, 600)
  const f = computeSnapshotFinancials({ data: partial, pricingConfig: DEFAULT_PRICING, marginMultiplier: 1 }, NOW)
  assert.ok(f)
  assert.equal(f.sumaNetto, totals.sumaNetto)
})

test('backfillMissingFinancials: uzupełnia tylko brakujące, nie rusza zamrożonych', () => {
  const frozen: ProjectFinancials = {
    sumaNetto: 1,
    koszty: 0,
    podatek: 0,
    zysk: 1,
    marzaPct: 100,
    computedAt: '2026-01-01T00:00:00.000Z',
  }
  const projects = [
    { id: 'a', financials: frozen, quote: { data: { dniDokumentacji: 5 } } },
    { id: 'b', financials: null, quote: { data: { dniDokumentacji: 1 } } },
    { id: 'c', financials: null, quote: {} },
  ]
  const result = backfillMissingFinancials(projects, NOW)
  assert.equal(result.filledCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.equal(result.projects[0], projects[0], 'zamrożony projekt zwrócony bez zmian')
  assert.ok(result.projects[1].financials)
  assert.equal(result.projects[2].financials, null)
  assert.equal(projects[1].financials, null, 'wejście nie jest mutowane')
})
