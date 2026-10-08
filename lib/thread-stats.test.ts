import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeThreadStats, threadStats, type ThreadEventInput } from './thread-stats'

const TODAY = '2026-10-08'
const ev = (kind: string, start: string, extra: Partial<ThreadEventInput> = {}): ThreadEventInput => ({
  kind,
  start,
  ...extra,
})

const tchibo: ThreadEventInput[] = [
  ev('lead_in', '2026-10-02T09:14'),
  ev('reply_sent', '2026-10-02T13:40'),
  ev('quote_sent', '2026-10-06'),
  ev('won', '2026-10-09'),
  ev('prep_day', '2026-10-20'),
  ev('shoot_day', '2026-10-28', { end: '2026-10-29' }),
  ev('post_day', '2026-10-30', { end: '2026-11-05' }),
]

test('pełny wątek: czasy sprzedaży i dni pracy', () => {
  const s = threadStats(tchibo, TODAY)
  assert.equal(s.firstDate, '2026-10-02')
  assert.equal(s.lastDate, '2026-11-05')
  assert.equal(s.responseMinutes, 266)
  assert.equal(s.responseDays, 0)
  assert.equal(s.leadToQuoteDays, 4)
  assert.equal(s.decision, 'won')
  assert.equal(s.quoteToDecisionDays, 3)
  assert.equal(s.prepDays, 1)
  assert.equal(s.shootDays, 2)
  assert.equal(s.postDays, 7)
  assert.deepEqual(s.invoices, [])
})

test('zdania po polsku z poprawną odmianą', () => {
  assert.deepEqual(describeThreadStats(threadStats(tchibo, TODAY)), [
    'Odpowiedź po 4 h 26 min',
    'Wycena po 4 dniach od leada',
    'Decyzja klienta po 3 dniach',
    '1 dzień przygotowań',
    '2 dni zdjęciowe',
    '7 dni postprodukcji',
  ])
})

test('bez godzin czas odpowiedzi liczymy w dniach', () => {
  const same = threadStats([ev('lead_in', '2026-10-02'), ev('reply_sent', '2026-10-02')], TODAY)
  assert.equal(same.responseMinutes, null)
  assert.deepEqual(describeThreadStats(same), ['Odpowiedź tego samego dnia'])
  const later = threadStats([ev('lead_in', '2026-10-02T23:00'), ev('reply_sent', '2026-10-04T08:00')], TODAY)
  assert.deepEqual(describeThreadStats(later), ['Odpowiedź po 2 dniach'], 'ponad dobę → w dniach')
})

test('odpowiedź sprzed leada się nie liczy', () => {
  const s = threadStats([ev('reply_sent', '2026-10-01'), ev('lead_in', '2026-10-02')], TODAY)
  assert.equal(s.responseDays, null)
})

test('nakładające się dni tego samego typu liczą się raz', () => {
  const s = threadStats(
    [ev('shoot_day', '2026-10-05', { end: '2026-10-06' }), ev('shoot_day', '2026-10-06'), ev('shoot_day', '2026-10-10')],
    TODAY
  )
  assert.equal(s.shootDays, 3)
})

test('usunięte i bez daty są pomijane', () => {
  const s = threadStats(
    [ev('shoot_day', '2026-10-05', { deletedAt: '2026-10-07T10:00:00Z' }), ev('shoot_day', ''), ev('post_day', '2026-10-07')],
    TODAY
  )
  assert.equal(s.shootDays, 0)
  assert.equal(s.postDays, 1)
  assert.equal(s.firstDate, '2026-10-07')
})

test('faktura opłacona i faktura czekająca', () => {
  const paid = threadStats([ev('invoice_sent', '2026-09-10'), ev('invoice_paid', '2026-10-03')], TODAY)
  assert.equal(paid.invoices[0].daysToPaid, 23)
  assert.deepEqual(describeThreadStats(paid), ['Faktura zapłacona po 23 dniach'])

  const open = threadStats([ev('invoice_sent', '2026-10-06', { data: { number: '14/10' } })], TODAY)
  assert.equal(open.invoices[0].daysOpen, 2)
  assert.deepEqual(describeThreadStats(open), ['FV 14/10 czeka na wpłatę od 2 dni'])
})

test('faktura z datą w przyszłości jest zaplanowana, a nie „czeka od 0 dni"', () => {
  const s = threadStats([ev('invoice_sent', '2026-10-16')], TODAY)
  assert.equal(s.invoices[0].state, 'planned')
  assert.equal(s.invoices[0].daysOpen, null)
  assert.deepEqual(describeThreadStats(s), [])
  assert.equal(threadStats([ev('invoice_sent', TODAY)], TODAY).invoices[0].state, 'open', 'wysłana dziś już czeka')
})

test('zaliczka i faktura końcowa parują się po numerze, nawet gdy wpłaty przyszły w innej kolejności', () => {
  const s = threadStats(
    [
      ev('invoice_sent', '2026-09-01', { data: { number: 'ZAL/1' } }),
      ev('invoice_sent', '2026-10-01', { data: { number: 'FV/2' } }),
      ev('invoice_paid', '2026-10-05', { data: { number: 'FV/2' } }),
      ev('invoice_paid', '2026-10-06', { data: { number: 'ZAL/1' } }),
    ],
    TODAY
  )
  assert.deepEqual(
    s.invoices.map((i) => [i.number, i.daysToPaid]),
    [
      ['ZAL/1', 35],
      ['FV/2', 4],
    ]
  )
})

test('faktura bez numeru nie zabiera wpłaty przypisanej numerem do innej', () => {
  const s = threadStats(
    [
      ev('invoice_sent', '2026-09-01'),
      ev('invoice_sent', '2026-09-20', { data: { number: 'FV/2' } }),
      ev('invoice_paid', '2026-09-25', { data: { number: 'FV/2' } }),
    ],
    TODAY
  )
  assert.equal(s.invoices[0].paid, null, 'pierwsza (bez numeru) nadal czeka')
  assert.equal(s.invoices[1].daysToPaid, 5)
})

test('wpłata sprzed wysyłki nie paruje się chronologicznie', () => {
  const s = threadStats([ev('invoice_paid', '2026-09-01'), ev('invoice_sent', '2026-09-10')], TODAY)
  assert.equal(s.invoices[0].paid, null)
})

test('przegrany lead', () => {
  const s = threadStats([ev('lead_in', '2026-10-19'), ev('quote_sent', '2026-10-20'), ev('lost', '2026-10-23')], TODAY)
  assert.equal(s.decision, 'lost')
  assert.equal(s.quoteToDecisionDays, 3)
})

test('pusty wątek nie rzuca', () => {
  const s = threadStats([], TODAY)
  assert.equal(s.firstDate, null)
  assert.deepEqual(describeThreadStats(s), [])
})
