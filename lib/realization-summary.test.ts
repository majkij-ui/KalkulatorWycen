import { test } from 'node:test'
import assert from 'node:assert/strict'

import { differsFromPrice, parseSignedAmount, quotedPrice, realizationTotals, reconcile } from './realization-summary'
import { isPlainAmount, plainAmountPatch } from './realization-costs'
import { costAmount } from './project-costs'
import { projectSchema, type ProjectCost } from './project-types'
import type { FinancialsSource } from './quote-financials'

let n = 0
function cost(category: string, amount: number, extra: Partial<ProjectCost> = {}): ProjectCost {
  n += 1
  return { id: `c${n}`, category, quantity: 1, unitCost: amount, ...extra }
}

const QUICK = { dniZdjeciowe: 2, wielkoscEkipy: 1, klasaSprzetu: 'standard' }

test('cena do bilansu: suma PDF wybranego wariantu, bez szkicu — kalkulator, EUR × kurs wyceny', () => {
  const pdf = quotedPrice({
    data: QUICK,
    marginMultiplier: 1,
    pdfDraft: { currency: 'PLN', rows: { ekipa: { cenaNetto: 20000 }, sprzet: { cenaNetto: 2250 } } },
  } as FinancialsSource)!
  assert.equal(pdf.source, 'pdf')
  assert.equal(pdf.pln, 22250)
  const calc = quotedPrice({ data: QUICK, marginMultiplier: 1 } as FinancialsSource)!
  assert.equal(calc.source, 'calculator')
  assert.equal(calc.pln, calc.calculatorPln)
  const eur = quotedPrice({
    data: { ...QUICK, currency: 'EUR', exchangeRate: 4.3661 },
    marginMultiplier: 1,
    pdfDraft: { currency: 'EUR', exchangeRate: 4.3, rows: { ekipa: { cenaNetto: 1460 } } },
  } as FinancialsSource)!
  assert.ok(Math.abs(eur.pln - 1460 * 4.3661) < 1e-9)
  assert.equal(quotedPrice(null), null)
  assert.equal(quotedPrice({}), null)
})

test('Realizacja razem: wszystkie kategorie i dni, koszty zewnętrzne i moja praca osobno', () => {
  const totals = realizationTotals([
    cost('ekipa', 1500, { dayId: 'd1' }),
    cost('ekipa', 1500, { dayId: 'd1', ownWork: true }),
    cost('wynajem', 1500),
    cost('dojazd', 1300, { quantity: 2500, unitCost: 0.52 }),
    cost('postprodukcja', 3200, { ownWork: true }),
    cost('inne', 999, { skipped: true }),
    cost('inne', 999, { deletedAt: 'x' }),
  ])
  assert.ok(Math.abs(totals.external - (1500 + 1500 + 1300)) < 1e-9)
  assert.equal(totals.own, 4700)
  assert.ok(Math.abs(totals.total - (4300 + 4700)) < 1e-9)
})

test('bilans = cena − (zewnętrzne + moja praca + sprzęt), przed podatkiem (JHJ, 24.10)', () => {
  const jhj = reconcile(22250, { external: 12425, own: 10100 }, 3900 - 1500)
  assert.equal(jhj.gearEarned, 2400)
  assert.equal(jhj.balance, -2675, 'na niekorzyść')
  assert.equal(reconcile(26340, { external: 12425, own: 10100 }, 2400).balance, 1415, 'z dosprzedażą: na korzyść')
  assert.equal(reconcile(11980, { external: 6050, own: 3300 }, -100).balance, 2730, 'ujemny sprzęt podnosi bilans')
  assert.equal(reconcile(1000, { external: 0, own: 0 }, null).gearEarned, 0)
})

test('kwota „Sprzęt zarobił" wpisana ręcznie: po polsku, także ujemna', () => {
  assert.equal(parseSignedAmount('1 200,50'), 1200.5)
  assert.equal(parseSignedAmount('−100'), -100)
  assert.equal(parseSignedAmount('-100 zł'), -100)
  assert.equal(parseSignedAmount(''), null)
  assert.equal(parseSignedAmount('-'), null)
  assert.equal(parseSignedAmount('abc'), null)
})

test('druga linia tylko, gdy kwota z Finansów różni się od ceny', () => {
  assert.equal(differsFromPrice(22250, 26340), true)
  assert.equal(differsFromPrice(22250, 22250.2), false)
  assert.equal(differsFromPrice(22250, null), false)
  assert.equal(differsFromPrice(22250, Number.NaN), false)
})

test('dojazd jedną kwotą: stary wiersz km × zł/km pokazuje swoją kwotę, poprawka zapisuje 1 × kwota', () => {
  const old = cost('dojazd', 0, { quantity: 2500, unitCost: 0.52 })
  assert.equal(isPlainAmount(old), true)
  assert.equal(isPlainAmount(cost('wynajem', 1)), false)
  assert.ok(Math.abs(costAmount(old) - 1300) < 1e-9)
  assert.deepEqual(plainAmountPatch(1400), { quantity: 1, unitCost: 1400 })
  assert.deepEqual(plainAmountPatch(-5), { quantity: 1, unitCost: 0 })
  assert.equal(costAmount({ ...old, ...plainAmountPatch(costAmount(old)) }), costAmount(old), 'ta sama kwota = ta sama liczba')
})

test('projekt: wpisana kwota „Sprzęt zarobił" jest opcjonalna, może być ujemna, śmieci znikają', () => {
  const base = { id: 'p', date: '2026-10-24' }
  assert.equal(projectSchema.parse({ ...base, gearEarnedOverride: -100 }).gearEarnedOverride, -100)
  assert.equal(projectSchema.parse({ ...base, gearEarnedOverride: 'x' }).gearEarnedOverride, undefined)
  assert.equal(projectSchema.parse(base).gearEarnedOverride, undefined)
})
