import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventSchema, isPlaceable } from './event-types'
import { EVENT_KINDS, eventData, eventKind, isKnownKind, statusSuggestion } from './event-kinds'
import { EVENT_GROUPS } from './calendar-palette'

const base = { id: 'ev-1', kind: 'shoot_day', projectId: 'p-1', start: '2026-10-28' }

test('poprawny rekord przechodzi bez zmian, braki dostają wartości domyślne', () => {
  const parsed = eventSchema.parse(base)
  assert.equal(parsed.kind, 'shoot_day')
  assert.equal(parsed.end, undefined)
  assert.deepEqual(parsed.data, {})
  assert.deepEqual(parsed.source, { type: 'manual' })
  assert.equal(parsed.deletedAt, undefined)
})

test('nieznany typ i nieznane pola przeżywają odczyt (dane z nowszej wersji)', () => {
  const parsed = eventSchema.parse({
    ...base,
    kind: 'ksef_invoice',
    data: { ksefId: 'X-1', nested: { a: 1 } },
    source: { type: 'gmail', ref: 'msg-1', threadId: 't-9' },
    futureField: 'zostaje',
  })
  assert.equal(parsed.kind, 'ksef_invoice')
  assert.deepEqual(parsed.data, { ksefId: 'X-1', nested: { a: 1 } })
  assert.equal((parsed.source as Record<string, unknown>).threadId, 't-9')
  assert.equal((parsed as Record<string, unknown>).futureField, 'zostaje')
})

test('uszkodzone pola są naprawiane, a rekord zostaje', () => {
  const parsed = eventSchema.parse({
    ...base,
    projectId: 42,
    start: 'wczoraj',
    end: '2026-13',
    data: 'nie-obiekt',
    source: null,
  })
  assert.equal(parsed.projectId, null)
  assert.equal(parsed.start, '', 'zła data → pusta, rekord nie ginie')
  assert.equal(parsed.end, undefined)
  assert.deepEqual(parsed.data, {})
  assert.deepEqual(parsed.source, { type: 'manual' })
  assert.equal(isPlaceable(parsed), false, 'bez daty nie trafia do kalendarza')
})

test('jedynym powodem odrzucenia jest brak id', () => {
  assert.equal(eventSchema.safeParse({ ...base, id: '' }).success, false)
  assert.equal(eventSchema.safeParse({ kind: 'note', start: '2026-10-01' }).success, false)
})

test('daty z godziną są akceptowane, usunięte nie trafiają do kalendarza', () => {
  assert.equal(eventSchema.parse({ ...base, start: '2026-10-02T09:14' }).start, '2026-10-02T09:14')
  assert.equal(isPlaceable({ start: '2026-10-02', deletedAt: '2026-10-08T10:00:00Z' }), false)
})

test('rejestr: unikalne klucze, znane grupy, skróty mieszczą się na chipie', () => {
  const keys = EVENT_KINDS.map((k) => k.key)
  assert.equal(new Set(keys).size, keys.length)
  EVENT_KINDS.forEach((k) => {
    assert.ok(EVENT_GROUPS.includes(k.group), k.key)
    assert.ok(k.short.length <= 10, `${k.key}: „${k.short}" za długi na chip`)
  })
  assert.equal(isKnownKind('ksef_invoice'), false)
  assert.equal(eventKind('ksef_invoice').group, 'inne')
})

test('eventData czyta pola typu, naprawia złe i zachowuje nieznane', () => {
  const data = eventData({
    kind: 'invoice_sent',
    data: { number: 'FV 14/10/2026', amountNetto: -5, dueDate: '2026-11-01', bankRef: 'abc' },
  })
  assert.equal(data.number, 'FV 14/10/2026')
  assert.equal(data.amountNetto, undefined, 'ujemna kwota → brak, nie błąd')
  assert.equal(data.dueDate, '2026-11-01')
  assert.equal(data.bankRef, 'abc')
  assert.deepEqual(eventData({ kind: 'nieznany', data: { x: 1 } }), { x: 1 })
})

test('podpowiedzi statusu idą tylko naprzód', () => {
  assert.equal(statusSuggestion('lead', 'quote_sent'), 'quote')
  assert.equal(statusSuggestion('quote', 'won'), 'won')
  assert.equal(statusSuggestion('won', 'invoice_paid'), 'done')
  assert.equal(statusSuggestion('quote', 'lost'), 'lost')
  assert.equal(statusSuggestion('lost', 'won'), 'won', 'klient wrócił')

  assert.equal(statusSuggestion('won', 'quote_sent'), null, 'poprawiona wycena nie cofa realizacji')
  assert.equal(statusSuggestion('won', 'lost'), null, 'realizacji nie zamykamy podpowiedzią')
  assert.equal(statusSuggestion('done', 'lead_in'), null)
  assert.equal(statusSuggestion('quote', 'shoot_day'), null, 'typ bez podpowiedzi')
  assert.equal(statusSuggestion('quote', 'quote_sent'), null, 'już ten status')
})
