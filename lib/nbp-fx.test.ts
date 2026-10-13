import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nbpRangeUrl, pickNbpRate, todayIso } from './nbp-fx'

const TODAY = new Date(2026, 9, 13) // wtorek 13.10.2026

test('kurs z wybranego dnia: dziesięć dni do tego dnia, nigdy po dzisiejszym', () => {
  assert.equal(
    nbpRangeUrl('2026-10-10', TODAY),
    'https://api.nbp.pl/api/exchangerates/rates/A/EUR/2026-09-30/2026-10-10/?format=json'
  )
  assert.equal(
    nbpRangeUrl('2026-12-24', TODAY),
    'https://api.nbp.pl/api/exchangerates/rates/A/EUR/2026-10-03/2026-10-13/?format=json'
  )
  assert.equal(nbpRangeUrl('nie-data', TODAY), nbpRangeUrl('2026-10-13', TODAY))
  assert.equal(nbpRangeUrl('2026-03-02', TODAY).includes('/2026-02-20/2026-03-02/'), true, 'przez koniec lutego')
})

test('weekend i święto: ostatnia tabela opublikowana w dniu albo przed nim', () => {
  const rates = [
    { effectiveDate: '2026-10-07', mid: 4.2711 },
    { effectiveDate: '2026-10-08', mid: 4.2654 },
    { effectiveDate: '2026-10-09', mid: 4.2735 },
    { effectiveDate: '2026-10-12', mid: 4.2801 },
  ]
  assert.deepEqual(pickNbpRate(rates, '2026-10-11'), { rate: 4.2735, effectiveDate: '2026-10-09' }) // niedziela
  assert.deepEqual(pickNbpRate(rates, '2026-10-12'), { rate: 4.2801, effectiveDate: '2026-10-12' })
  assert.deepEqual(pickNbpRate(rates, '2026-12-31'), { rate: 4.2801, effectiveDate: '2026-10-12' })
  assert.equal(pickNbpRate(rates, '2026-10-01'), null)
})

test('błędne pozycje odpowiedzi NBP są pomijane', () => {
  const rates = [
    { effectiveDate: '2026-10-09', mid: 4.2735 },
    { effectiveDate: '2026-10-10', mid: 0 },
    { effectiveDate: '2026-10-10' },
    { mid: 4.9 },
  ]
  assert.deepEqual(pickNbpRate(rates, '2026-10-13'), { rate: 4.2735, effectiveDate: '2026-10-09' })
  assert.equal(pickNbpRate(undefined, '2026-10-13'), null)
  assert.equal(todayIso(TODAY), '2026-10-13')
})
