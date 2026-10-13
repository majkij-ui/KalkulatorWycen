import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLN_MONEY,
  clientPricing,
  clientQuoteData,
  costQuoteData,
  currencyUnit,
  formatMoney,
  priceFromPln,
  priceToPln,
  quoteMoney,
  switchQuoteCurrency,
  toPln,
  withRate,
  type QuoteMoney,
} from './quote-currency'
import { computeSnapshotFinancials, computeQuoteTotals, mergeQuoteDataPartial, quoteViews } from './quote-financials'
import { planFromQuote, plannedCrew } from './realization-plan'
import { snapshotGearRevenue } from './gear-revenue'
import { DEFAULT_PRICING } from './pricing-config'
import { formatCurrency } from './quote-calc'
import type { QuoteData } from './quote-types'

const EUR: QuoteMoney = { currency: 'EUR', rate: 4.2735 }

function day(extra: Partial<QuoteData['detailedShootingDays'][number]> = {}) {
  return {
    id: 'd1', rezOp: 0, asystent: 0, gafer: 0, dzwiekowiec: 0, mua: 0, aktor: 0, model: 0, statysta: 0,
    kameraSony: 0, kameraRed: 0, obiektywy: 'brak', stabilizacja: 'brak', podglad: 'brak', swiatlo: 'brak', dron: 'brak',
    dayAdjustment: 0, crewNames: {}, ...extra,
  } as QuoteData['detailedShootingDays'][number]
}

test('waluta wyceny: brak pola, PLN, EUR bez kursu i nieznana waluta liczą się w PLN', () => {
  assert.deepEqual(quoteMoney(undefined), PLN_MONEY)
  assert.deepEqual(quoteMoney({}), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'PLN', exchangeRate: 4.3 }), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'EUR' }), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'EUR', exchangeRate: 0 }), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'EUR', exchangeRate: Number.NaN }), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'USD' as never, exchangeRate: 3.9 }), PLN_MONEY)
  assert.deepEqual(quoteMoney({ currency: 'EUR', exchangeRate: 4.3699 }), { currency: 'EUR', rate: 4.3699 })
})

test('cena z cennika: w PLN bez zmian, w EUR zł ÷ kurs do pełnych euro', () => {
  assert.equal(priceFromPln(1282.05, PLN_MONEY), 1282.05)
  assert.equal(priceFromPln(1500, EUR), 351) // 351,0003
  assert.equal(priceFromPln(2500, EUR), 585) // 585,0005
  assert.equal(priceFromPln(400, EUR), 94) // 93,60
  assert.equal(priceFromPln(0, EUR), 0)
  assert.equal(priceFromPln(-500, EUR), -117)
})

test('cena wpisana w EUR wraca z cennika dokładnie taka, jak ją wpisano', () => {
  for (const rate of [4.2735, 4.3699, 4.1, 4.56789]) {
    const money: QuoteMoney = { currency: 'EUR', rate }
    for (const typed of [0, 1, 47, 300, 351, 999, 12345]) {
      assert.equal(priceFromPln(priceToPln(typed, money), money), typed, `${typed} € przy kursie ${rate}`)
    }
  }
  assert.equal(priceToPln(300, PLN_MONEY), 300)
  assert.equal(toPln(1852.5, PLN_MONEY), 1852.5)
  assert.equal(toPln(100, EUR), 427.35)
})

test('cennik w EUR: każda cena w pełnych euro, procent za prawa bez zmian, formaty też', () => {
  assert.equal(clientPricing(DEFAULT_PRICING, PLN_MONEY), DEFAULT_PRICING)
  const eur = clientPricing(DEFAULT_PRICING, EUR)
  assert.equal(eur.preprodukcja.dzienDokumentacji, 281) // 1200 / 4,2735 = 280,8
  assert.equal(eur.produkcja.rezOp, 585)
  assert.equal(eur.postprodukcja['Format: Reportaż 1-3min'], 585)
  assert.equal(eur.postprodukcja.montazZaGodzine, 47) // 46,8
  assert.equal(eur.dodatkowe.pelnePrzekazaniePrawProcent, 30)
  assert.equal(DEFAULT_PRICING.produkcja.rezOp, 2500, 'cennik PLN nietknięty')
})

test('dane dla klienta w EUR: stawki sprzętu i ról w pełnych euro, mój koszt i kwoty wpisane bez zmian', () => {
  const data = mergeQuoteDataPartial({
    currency: 'EUR',
    exchangeRate: 4.2735,
    isDetailedProdukcja: true,
    cateringRate: 25,
    profitFuelPricePerLiter: 6.5,
    detailedShootingDays: [
      day({
        dayAdjustment: -100,
        gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 2 }],
        externalRentals: [{ id: 'r', label: 'Cooke', amount: 200 }],
        crew: [{ id: 'c', roleId: 'operator', roleName: 'Operator', clientRate: 1800, costRate: 1200, qty: 1 }],
      }),
    ],
  })
  assert.equal(clientQuoteData(data, PLN_MONEY), data)
  const client = clientQuoteData(data, EUR)
  const d = client.detailedShootingDays[0]
  assert.equal(d.gear![0].rate, 94)
  assert.equal(d.crew![0].clientRate, 421) // 1800 / 4,2735 = 421,2
  assert.equal(d.crew![0].costRate, 1200, 'mój koszt zostaje w zł')
  assert.equal(d.dayAdjustment, -100)
  assert.equal(d.externalRentals![0].amount, 200)
  assert.equal(client.cateringRate, 25)
  assert.equal(client.profitFuelPricePerLiter, 6.5 / 4.2735)
  assert.equal(data.detailedShootingDays[0].gear![0].rate, 400, 'dane wyceny nietknięte')
})

test('dane kosztowe w PLN: kwoty wpisane w EUR × kurs dokładnie, stawki z katalogu i koszt ról bez zmian', () => {
  const data = mergeQuoteDataPartial({
    currency: 'EUR',
    exchangeRate: 4.2735,
    cateringRate: 25,
    lodgingRate: 70,
    actorRightsTransferAmount: 300,
    extraRevisionPrice: 50,
    overtimeHourlyRate: 35,
    detailedShootingDays: [
      day({
        dayAdjustment: -100,
        gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 2 }],
        externalRentals: [{ id: 'r', label: 'Cooke', amount: 200 }],
        crew: [{ id: 'c', roleId: 'operator', roleName: 'Operator', clientRate: 1800, costRate: 1200, qty: 1 }],
      }),
    ],
  })
  assert.equal(costQuoteData(data, PLN_MONEY), data)
  const cost = costQuoteData(data, EUR)
  assert.equal(cost.cateringRate, 25 * 4.2735)
  assert.equal(cost.lodgingRate, 70 * 4.2735)
  assert.equal(cost.actorRightsTransferAmount, 300 * 4.2735)
  assert.equal(cost.detailedShootingDays[0].externalRentals![0].amount, 200 * 4.2735)
  assert.equal(cost.detailedShootingDays[0].dayAdjustment, -100 * 4.2735)
  assert.equal(cost.detailedShootingDays[0].gear![0].rate, 400)
  assert.equal(cost.detailedShootingDays[0].crew![0].costRate, 1200)
  assert.equal(cost.profitFuelPricePerLiter, data.profitFuelPricePerLiter)
})

test('przejście PLN → EUR: kwoty wpisane przeliczone raz do pełnych euro, cennik i katalog nietknięte', () => {
  const data = mergeQuoteDataPartial({
    cateringRate: 100,
    lodgingRate: 300,
    extraRevisionPrice: 200,
    overtimeHourlyRate: 150,
    actorRightsTransferAmount: 1500,
    detailedShootingDays: [
      day({ dayAdjustment: -500, gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }], externalRentals: [{ id: 'r', label: 'Cooke', amount: 900 }] }),
    ],
  })
  assert.throws(() => switchQuoteCurrency(data, 'EUR'))
  assert.throws(() => switchQuoteCurrency(data, 'EUR', { rate: 0 }))
  const eur = switchQuoteCurrency(data, 'EUR', { rate: 4.2735, date: '2026-10-13', source: 'nbp' })
  assert.equal(eur.currency, 'EUR')
  assert.equal(eur.exchangeRate, 4.2735)
  assert.equal(eur.exchangeRateDate, '2026-10-13')
  assert.equal(eur.exchangeRateSource, 'nbp')
  assert.equal(eur.cateringRate, 23) // 23,4
  assert.equal(eur.lodgingRate, 70) // 70,2
  assert.equal(eur.extraRevisionPrice, 47)
  assert.equal(eur.overtimeHourlyRate, 35)
  assert.equal(eur.actorRightsTransferAmount, 351)
  assert.equal(eur.detailedShootingDays[0].dayAdjustment, -117)
  assert.equal(eur.detailedShootingDays[0].externalRentals![0].amount, 211)
  assert.equal(eur.detailedShootingDays[0].gear![0].rate, 400, 'stawka z katalogu zostaje w zł')
  assert.equal(data.cateringRate, 100, 'wejście nietknięte')
})

test('powrót EUR → PLN: kwoty × kurs do pełnych złotych, kurs zostaje w danych, wycena liczy się w PLN', () => {
  const eur = mergeQuoteDataPartial({ currency: 'EUR', exchangeRate: 4.2735, exchangeRateSource: 'manual', cateringRate: 23, detailedShootingDays: [day({ dayAdjustment: -117 })] })
  const pln = switchQuoteCurrency(eur, 'PLN')
  assert.equal(pln.currency, 'PLN')
  assert.equal(pln.cateringRate, 98) // 23 × 4,2735 = 98,29
  assert.equal(pln.detailedShootingDays[0].dayAdjustment, -500) // −499,99
  assert.equal(pln.exchangeRate, 4.2735)
  assert.deepEqual(quoteMoney(pln), PLN_MONEY)
  const plain = mergeQuoteDataPartial({ cateringRate: 100 })
  assert.equal(switchQuoteCurrency(plain, 'PLN'), plain, 'PLN → PLN bez zmian')
})

test('nowy kurs w EUR: ceny z cennika idą za kursem, kwoty wpisane zostają', () => {
  const eur = mergeQuoteDataPartial({ currency: 'EUR', exchangeRate: 4.2735, exchangeRateDate: '2026-10-10', exchangeRateSource: 'nbp', cateringRate: 23 })
  const next = withRate(eur, { rate: 4.4 })
  assert.equal(next.exchangeRate, 4.4)
  assert.equal(next.exchangeRateSource, 'manual')
  assert.equal(next.exchangeRateDate, undefined)
  assert.equal(next.cateringRate, 23)
  assert.equal(withRate(eur, { rate: -1 }), eur)
  const pricing = clientPricing(DEFAULT_PRICING, quoteMoney(next))
  assert.equal(pricing.produkcja.rezOp, 568) // 2500 / 4,4
})

test('wycena w PLN: oba widoki to te same obiekty (stare wyceny liczą się bez zmian)', () => {
  const data = mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: [day({ rezOp: 1 })] })
  const views = quoteViews(data, DEFAULT_PRICING)
  assert.equal(views.client.data, data)
  assert.equal(views.client.pricing, DEFAULT_PRICING)
  assert.equal(views.cost, data)
})

/** Szybka wycena w EUR po kursie 4,3699 — liczby policzone ręcznie niżej. */
const EUR_QUICK = {
  data: {
    currency: 'EUR',
    exchangeRate: 4.3699,
    exchangeRateSource: 'nbp',
    exchangeRateDate: '2026-10-07',
    dniDokumentacji: 0.5,
    dniZdjeciowe: 2,
    wielkoscEkipy: 1,
    klasaSprzetu: 'standard',
    crudeEditCount: 1,
    includeCatering: true,
    cateringRate: 25,
  } as never,
  pricingConfig: DEFAULT_PRICING,
  marginMultiplier: 1,
}

test('wycena w EUR: suma w euro z cen w pełnych euro, finanse w zł po kursie, koszty planu w zł', () => {
  // Ceny: dzień dokumentacji 1200 zł → 275 €, operator 1500 → 343 €, pakiet standard 1500 → 343 €,
  // montaż 1500 → 343 €. Catering 25 € × 2 osobodni (wpisany w euro).
  const eurTotal = 0.5 * 275 + 2 * (343 + 343) + 343 + 2 * 25
  const { data, pricing } = { data: mergeQuoteDataPartial(EUR_QUICK.data), pricing: DEFAULT_PRICING }
  const views = quoteViews(data, pricing)
  assert.equal(computeQuoteTotals(views.client.data, 1, views.client.pricing).sumaNetto, eurTotal)

  const f = computeSnapshotFinancials(EUR_QUICK, new Date(0))!
  const revenue = eurTotal * 4.3699
  // Koszty planu w zł: 0,5 × 1200 + 2 × 1500 (osobodni) + 1500 + catering 2 × 25 € × kurs.
  const costs = 0.5 * 1200 + 2 * 1500 + 1500 + 2 * 25 * 4.3699
  assert.equal(f.sumaNetto, revenue)
  assert.equal(f.koszty, costs)
  assert.equal(f.podatek, revenue * 0.085)
  assert.equal(f.zysk, revenue - revenue * 0.085 - costs)

  const plan = planFromQuote(EUR_QUICK)!
  assert.equal(plan.revenue, revenue)
  assert.equal(plan.costs, costs)
  assert.deepEqual(plannedCrew(EUR_QUICK).map((m) => m.unitCost), [1500])
})

test('wycena w EUR z kwotą przelewu: przelew (zł) zastępuje sumę × kurs, jak w PLN', () => {
  const snapshot = { ...EUR_QUICK, data: { ...(EUR_QUICK.data as object), profitTransferAmount: 9000 } as never }
  const f = computeSnapshotFinancials(snapshot, new Date(0))!
  assert.equal(f.sumaNetto, 9000)
})

test('sprzęt w wycenie EUR: zapłata za pozycje z katalogu w zł po kursie, wypożyczalnia jako koszt w zł', () => {
  const snapshot = {
    data: {
      currency: 'EUR',
      exchangeRate: 4,
      isDetailedProdukcja: true,
      gearDiscountPercent: 50,
      detailedShootingDays: [
        day({ gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }], externalRentals: [{ id: 'r', label: 'Cooke', amount: 100 }] }),
      ],
    } as never,
    pricingConfig: DEFAULT_PRICING,
    marginMultiplier: 1,
  }
  const gear = snapshotGearRevenue(snapshot)!
  // FX3: 400 zł → 100 €, rabat 50 % → 50 € → 200 zł. Wypożyczalnia 100 € → koszt 400 zł.
  assert.equal(gear.byItem.get('fx3'), 200)
  assert.equal(gear.charged, (50 + 100) * 4)
  assert.equal(gear.rentedIn, 400)
  assert.equal(gear.unitemized, 0)
})

test('etykiety: „zł" po polsku, „PLN" po angielsku, „€" w obu; zapis jak dotychczasowy w zł', () => {
  assert.equal(currencyUnit('PLN'), 'zł')
  assert.equal(currencyUnit('PLN', 'en'), 'PLN')
  assert.equal(currencyUnit('EUR', 'pl'), '€')
  assert.equal(currencyUnit('EUR', 'en'), '€')
  for (const amount of [0, 1500, 1234567.891, -500.5]) {
    assert.equal(formatMoney(amount, 'PLN'), formatCurrency(amount))
  }
  assert.equal(formatMoney(351, 'EUR'), `351,00 €`)
  // pl-PL grupuje dopiero od 5 cyfr — tak jak dotychczasowe kwoty w zł w kalkulatorze.
  assert.equal(formatMoney(1852.5, 'EUR', { decimals: 0 }), '1853 €')
  assert.equal(formatMoney(12345, 'EUR', { decimals: 0 }), '12\u00a0345 €')
})
