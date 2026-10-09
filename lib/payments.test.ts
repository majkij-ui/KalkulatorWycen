import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastPaymentDay, paymentSplit, paymentState, paymentsToAdd, type PaymentEvent } from './payments'

const TODAY = '2026-10-09'
let seq = 0
const ev = (kind: string, start: string, extra: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: `e${++seq}`,
  kind,
  start,
  projectId: 'p-1',
  ...extra,
})

test('projekt bez faktur i wpłat jest niezapłacony; odhaczenie dodaje jedną wpłatę z dzisiejszą datą', () => {
  assert.equal(paymentState([], 'p-1', TODAY).paid, false)
  assert.deepEqual(paymentsToAdd([], 'p-1', TODAY), [
    { kind: 'invoice_paid', projectId: 'p-1', start: TODAY, title: 'Wpłata', data: {} },
  ])
})

test('jedna wpłata bez faktur = zapłacony, a ponowne odhaczenie niczego nie dubluje', () => {
  const events = [ev('invoice_paid', '2026-10-01')]
  assert.equal(paymentState(events, 'p-1', TODAY).paid, true)
  assert.deepEqual(paymentsToAdd(events, 'p-1', TODAY), [])
})

test('retro-projekt z importu: faktura + wpłata = zapłacony, wpłata z importu liczona osobno', () => {
  const events = [
    ev('invoice_sent', '2026-07-03', { data: { number: '7/2026' }, source: { type: 'import' } }),
    ev('invoice_paid', '2026-07-20', { data: { number: '7/2026' }, source: { type: 'import' } }),
  ]
  const state = paymentState(events, 'p-1', TODAY)
  assert.equal(state.paid, true)
  assert.equal(state.importedPayments, 1)

  // Wpłata przyjęta ze skrzynki (z poczty) też nie jest wpisem ręcznym.
  const fromMail = [ev('invoice_paid', '2026-10-08', { source: { type: 'gmail' } })]
  assert.equal(paymentState(fromMail, 'p-1', TODAY).importedPayments, 1)
  assert.equal(paymentState([ev('invoice_paid', '2026-10-08')], 'p-1', TODAY).importedPayments, 0)
})

test('wysłana, nieopłacona faktura: niezapłacony; odhaczenie paruje wpłatę po numerze', () => {
  const events = [ev('invoice_sent', '2026-09-16', { data: { number: '14/09' } })]
  const state = paymentState(events, 'p-1', TODAY)
  assert.equal(state.paid, false)
  assert.equal(state.unpaidInvoices, 1)
  const toAdd = paymentsToAdd(events, 'p-1', TODAY)
  assert.deepEqual(toAdd, [
    { kind: 'invoice_paid', projectId: 'p-1', start: TODAY, title: 'Wpłata za FV 14/09', data: { number: '14/09' } },
  ])
  const after = [...events, ...toAdd.map((d, i) => ({ ...d, id: `new-${i}` }))]
  assert.equal(paymentState(after, 'p-1', TODAY).paid, true, 'po odhaczeniu wszystko sparowane')
})

test('dwie faktury, jedna opłacona: niezapłacony, odhaczenie dopisuje tylko brakującą', () => {
  const events = [
    ev('invoice_sent', '2026-08-01', { data: { number: 'ZAL/1' } }),
    ev('invoice_paid', '2026-08-10', { data: { number: 'ZAL/1' } }),
    ev('invoice_sent', '2026-09-20', { data: { number: 'FV/2' } }),
  ]
  assert.equal(paymentState(events, 'p-1', TODAY).paid, false)
  assert.deepEqual(
    paymentsToAdd(events, 'p-1', TODAY).map((d) => d.data),
    [{ number: 'FV/2' }]
  )
})

test('faktura z datą w przyszłości: wpłata nie może być wcześniejsza niż wysłanie', () => {
  const events = [ev('invoice_sent', '2026-10-20')]
  const [draft] = paymentsToAdd(events, 'p-1', TODAY)
  assert.equal(draft.start, '2026-10-20')
})

test('usunięte wpłaty i cudze projekty się nie liczą', () => {
  const events = [
    ev('invoice_paid', '2026-10-01', { deletedAt: '2026-10-02T10:00:00Z' }),
    ev('invoice_paid', '2026-10-01', { projectId: 'p-2' }),
  ]
  const state = paymentState(events, 'p-1', TODAY)
  assert.equal(state.paid, false)
  assert.deepEqual(state.paymentIds, [])
  assert.equal(lastPaymentDay(events, 'p-2'), '2026-10-01')
  assert.equal(lastPaymentDay(events, 'p-1'), null)
})

test('Finanse: przychód realizacji dzieli się na zapłacony i czekający; wyceny się nie liczą', () => {
  const fin = (n: number) => ({ sumaNetto: n, koszty: 0, podatek: 0, zysk: n, marzaPct: 100, computedAt: '' })
  const projects = [
    { id: 'p-paid', status: 'done' as const, financials: fin(10000) },
    { id: 'p-wait', status: 'won' as const, financials: fin(4000) },
    { id: 'p-nofin', status: 'done' as const, financials: null },
    { id: 'p-quote', status: 'quote' as const, financials: fin(99999) },
  ]
  const events = [
    ev('invoice_paid', '2026-09-01', { projectId: 'p-paid' }),
    ev('invoice_paid', '2026-09-01', { projectId: 'p-quote' }),
  ]
  assert.deepEqual(paymentSplit(projects, events, TODAY), {
    paid: { count: 1, revenue: 10000 },
    awaiting: { count: 2, revenue: 4000 },
  })
})

