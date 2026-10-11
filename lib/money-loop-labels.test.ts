import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moneyLedger, openInvoices, projectMoney, type MoneyEvent, type MoneyProject } from './money-loop'
import { costsText, dueText, paymentText, profitText, revenueText, signedPln } from './money-loop-labels'
import type { ProjectCost } from './project-types'

const TODAY = '2026-10-11'
let seq = 0
const ev = (kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({
  id: `e${++seq}`,
  kind,
  start,
  projectId: 'p-1',
  data,
})

const financials = (sumaNetto: number, koszty = 0) => {
  const podatek = sumaNetto * 0.085
  const zysk = sumaNetto - podatek - koszty
  return { sumaNetto, koszty, podatek, zysk, marzaPct: (zysk / sumaNetto) * 100, computedAt: '' }
}
const project = (extra: Partial<MoneyProject> = {}): MoneyProject => ({
  id: 'p-1',
  status: 'done',
  date: '2026-09-16',
  financials: financials(10_000, 2_000),
  ...extra,
})
const cost = (unitCost: number): ProjectCost => ({ id: `pc${++seq}`, category: 'ekipa', unitCost }) as ProjectCost
const money = (p: Partial<MoneyProject>, events: MoneyEvent[] = []) => projectMoney(project(p), events, TODAY)
// Spacje w kwotach z `toLocaleString('pl-PL')` to twarde spacje — porównujemy po normalizacji.
const plain = (text: string | null) => (text ?? '').replace(/\s/g, ' ')

test('retro-projekt: faktura = plan, kosztów nie wpisano — nigdzie „0 zł" jako liczba', () => {
  const retro = money({ financials: financials(2_300) }, [
    ev('invoice_sent', '2026-01-30', { number: '2/01', amountNetto: 2_300 }),
    ev('invoice_paid', '2026-02-27', { number: '2/01' }),
  ])
  const revenue = revenueText(retro)
  assert.equal(plain(revenue.value), '2 300 zł')
  assert.equal(revenue.basis, 'fv')
  assert.equal(revenue.note, 'zgodnie z planem')
  const costs = costsText(retro)
  assert.equal(costs.value, 'brak kosztów')
  assert.equal(costs.muted, true)
  assert.equal(costs.note, 'w planie 0 zł', 'zero planu jest opisane, nie podane jako koszt')
  assert.equal(profitText(retro).basis, null, 'przychód z faktur — zysk nie jest „planem"')
  assert.deepEqual([paymentText(retro, []).value, paymentText(retro, []).note], ['po 28 dniach', 'zapłacono'])
})

test('przychód: dodatek ponad plan, zaliczka, faktura bez kwoty, brak faktur, brak planu', () => {
  const extra = money({}, [
    ev('extra_sale', '2026-09-10', { what: 'surówka', amountNetto: 1_500 }),
    ev('invoice_sent', '2026-09-16', { amountNetto: 11_500 }),
  ])
  assert.equal(plain(revenueText(extra).note), 'plan 10 000 zł · +1 500 zł · w tym dodatki 1 500 zł')

  const advance = money({ status: 'won' }, [ev('invoice_sent', '2026-09-01', { amountNetto: 4_000 })])
  assert.equal(revenueText(advance).basis, 'plan')
  assert.equal(plain(revenueText(advance).note), 'zafakturowano 4 000 zł z 10 000 zł')
  const advanceExtra = money({ status: 'won' }, [
    ev('invoice_sent', '2026-09-01', { amountNetto: 4_000 }),
    ev('extra_sale', '2026-10-11', { amountNetto: 5_000 }),
  ])
  assert.equal(plain(revenueText(advanceExtra).note), 'zafakturowano 4 000 zł z 15 000 zł · w tym dodatki 5 000 zł')

  const noAmount = revenueText(money({}, [ev('invoice_sent', '2026-09-16')]))
  assert.equal(noAmount.warn, true)
  assert.match(noAmount.note ?? '', /faktura bez kwoty/)

  const planned = revenueText(money({ status: 'won' }, [ev('invoice_sent', '2026-11-20', { amountNetto: 10_000 })]))
  assert.deepEqual([planned.basis, planned.note], ['plan', 'faktura zaplanowana na 20.11'])
  const rest = revenueText(
    money({ status: 'won' }, [
      ev('invoice_sent', '2026-09-01', { amountNetto: 4_000 }),
      ev('invoice_sent', '2026-12-01', { amountNetto: 6_000 }),
    ])
  )
  assert.equal(plain(rest.note), 'zafakturowano 4 000 zł z 10 000 zł · reszta 01.12')

  const none = revenueText(money({}))
  assert.deepEqual([none.basis, none.note], ['plan', 'brak faktur'])

  const unknown = revenueText(money({ financials: null }))
  assert.deepEqual([unknown.value, unknown.muted], ['brak planu', true])
  assert.equal(profitText(money({ financials: null })).value, '—')
})

test('koszty: plan bez wpisów, wpisywanie w toku, rzeczywiste z różnicą', () => {
  const planned = costsText(money({}))
  assert.deepEqual([plain(planned.value), planned.basis, planned.note], ['2 000 zł', 'plan', 'brak kosztów w Realizacji'])
  const partial = costsText(money({ status: 'won', costs: [cost(800)] }))
  assert.equal(plain(partial.note), 'wpisano 800 zł z 2 000 zł')
  const actual = costsText(money({ costs: [cost(2_450)] }))
  assert.deepEqual([actual.basis, plain(actual.note)], ['rzecz', 'plan 2 000 zł · +450 zł'])
  const exact = costsText(money({ costs: [cost(2_000)] }))
  assert.equal(exact.note, 'zgodnie z planem')
})

test('zysk: cały z planu ma znacznik planu; z faktur i kosztów — różnica do planu', () => {
  assert.equal(profitText(money({})).basis, 'plan')
  const real = profitText(money({ costs: [cost(2_500)] }, [ev('invoice_sent', '2026-09-16', { amountNetto: 10_000 })]))
  assert.equal(real.basis, null)
  assert.equal(plain(real.note), 'marża 67% · plan 7 150 zł · −500 zł')
  // Przychód z planu, ale koszty już z Realizacji: zysk nie jest „planem".
  const mixed = profitText(money({ costs: [cost(2_500)] }))
  assert.equal(mixed.basis, null)
  assert.equal(plain(mixed.note), 'marża 67% · plan 7 150 zł · −500 zł')
})

test('zapłata: po terminie, czeka, zapłacone bez faktury, zaplanowana, brak faktur', () => {
  const events = [ev('invoice_sent', '2026-08-01', { number: '7/08', amountNetto: 900 })]
  const ledger = moneyLedger([project()], events, TODAY)
  const open = openInvoices(ledger, TODAY)
  const late = paymentText(ledger[0], open)
  assert.deepEqual([late.value, late.alert], ['41 dni po terminie', true])
  assert.equal(plain(dueText(open[0])), 'termin 31.08 (przyjęto 30 dni) · 41 dni po terminie')

  const fresh = [ev('invoice_sent', '2026-10-09', { amountNetto: 900, dueDate: '2026-10-11' })]
  const freshLedger = moneyLedger([project()], fresh, TODAY)
  const freshOpen = openInvoices(freshLedger, TODAY)
  assert.equal(paymentText(freshLedger[0], freshOpen).value, 'czeka 2 dni')
  assert.equal(dueText(freshOpen[0]), 'termin 11.10 · termin dziś')
  const soon = openInvoices(moneyLedger([project()], fresh, '2026-10-10'), '2026-10-10')
  assert.equal(dueText(soon[0]), 'termin 11.10 · zostało 1 dzień')

  const tick = money({}, [ev('invoice_paid', '2026-07-17')])
  assert.deepEqual([paymentText(tick, []).value, paymentText(tick, []).note], ['zapłacone', 'bez faktury w hubie'])
  assert.equal(paymentText(money({}, [ev('invoice_sent', '2026-11-02')]), []).value, 'faktura zaplanowana')
  assert.deepEqual([paymentText(money({}), []).value, paymentText(money({}), []).note], ['—', 'brak faktur'])
})

test('różnica ze znakiem: zaokrąglenie symetryczne, zero to brak różnicy', () => {
  assert.equal(plain(signedPln(882.5)), '+883 zł')
  assert.equal(plain(signedPln(-882.5)), '−883 zł')
  assert.equal(signedPln(0.4), null)
})
