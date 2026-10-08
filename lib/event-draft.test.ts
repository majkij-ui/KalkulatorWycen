import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftFromEvent, draftProblems, emptyDraft, eventFromDraft, parseAmount } from './event-draft'
import { eventSchema } from './event-types'

const NOW = new Date('2026-10-08T12:00:00.000Z')

test('nowe wydarzenie z godziną i polami typu', () => {
  const draft = {
    ...emptyDraft({ kind: 'lead_in', date: '2026-10-02', projectId: 'p-1' }),
    time: '09:14',
    title: '  Zapytanie o spot  ',
    fields: { channel: 'mail', summary: '' },
  }
  const event = eventFromDraft(draft, null, NOW)
  assert.equal(event.start, '2026-10-02T09:14')
  assert.equal(event.title, 'Zapytanie o spot')
  assert.deepEqual(event.data, { channel: 'mail' }, 'puste pole nie zostawia pustego klucza')
  assert.deepEqual(event.source, { type: 'manual' })
  assert.equal(event.createdAt, NOW.toISOString())
  assert.ok(eventSchema.safeParse(event).success)
})

test('godzina tylko dla typów, które jej używają; koniec tylko dla zakresów', () => {
  const deadline = eventFromDraft(
    { ...emptyDraft({ kind: 'deadline', date: '2026-10-15', projectId: 'p-1' }), time: '10:00', endDate: '2026-10-20' },
    null,
    NOW
  )
  assert.equal(deadline.start, '2026-10-15')
  assert.equal(deadline.end, undefined)

  const shoot = eventFromDraft(
    { ...emptyDraft({ kind: 'shoot_day', date: '2026-10-28', projectId: 'p-1' }), endDate: '2026-10-29' },
    null,
    NOW
  )
  assert.equal(shoot.end, '2026-10-29')
  const sameDay = eventFromDraft(
    { ...emptyDraft({ kind: 'shoot_day', date: '2026-10-28', projectId: 'p-1' }), endDate: '2026-10-28' },
    null,
    NOW
  )
  assert.equal(sameDay.end, undefined, 'koniec = początek → jednodniowe')
})

test('kwoty: przecinek, spacje, śmieci', () => {
  assert.equal(parseAmount('38 400,50'), 38400.5)
  assert.equal(parseAmount(''), undefined)
  assert.equal(parseAmount('abc'), undefined)
  assert.equal(parseAmount('-5'), undefined)
  const quote = eventFromDraft(
    { ...emptyDraft({ kind: 'quote_sent', date: '2026-10-06', projectId: 'p-1' }), fields: { amountNetto: '38 400' } },
    null,
    NOW
  )
  assert.equal(quote.data.amountNetto, 38400)
})

test('edycja zachowuje nieznane pola rekordu i nieznane klucze data', () => {
  const original = eventSchema.parse({
    id: 'ev-1',
    kind: 'invoice_sent',
    projectId: 'p-1',
    start: '2026-10-16',
    data: { number: 'FV 14/10', amountNetto: 22000, ksefId: 'K-77' },
    source: { type: 'gmail', ref: 'msg-9' },
    createdAt: '2026-10-16T08:00:00.000Z',
    importBatch: 3,
  })
  const draft = draftFromEvent(original)
  assert.deepEqual(draft.fields, { number: 'FV 14/10', amountNetto: '22000' })

  const edited = eventFromDraft({ ...draft, fields: { ...draft.fields, amountNetto: '23000', number: '' } }, original, NOW)
  assert.equal(edited.id, 'ev-1')
  assert.equal(edited.data.amountNetto, 23000)
  assert.equal('number' in edited.data, false, 'wyczyszczone pole znika')
  assert.equal(edited.data.ksefId, 'K-77', 'klucz spoza formularza zostaje')
  assert.deepEqual(edited.source, { type: 'gmail', ref: 'msg-9' }, 'źródło importu zostaje')
  assert.equal(edited.createdAt, '2026-10-16T08:00:00.000Z')
  assert.equal((edited as Record<string, unknown>).importBatch, 3)
})

test('draftFromEvent rozkłada datę z godziną i zakres', () => {
  const draft = draftFromEvent(
    eventSchema.parse({ id: 'e', kind: 'post_day', projectId: 'p', start: '2026-10-30', end: '2026-11-05' })
  )
  assert.equal(draft.date, '2026-10-30')
  assert.equal(draft.endDate, '2026-11-05')
  const timed = draftFromEvent(eventSchema.parse({ id: 'e', kind: 'lead_in', projectId: 'p', start: '2026-10-02T09:14' }))
  assert.deepEqual([timed.date, timed.time], ['2026-10-02', '09:14'])
})

test('wydarzenie firmowe nigdy nie trafia do projektu', () => {
  const ads = eventFromDraft(
    { ...emptyDraft({ kind: 'marketing', date: '2026-10-01', projectId: 'p-1' }) },
    null,
    NOW
  )
  assert.equal(ads.projectId, null)
})

test('walidacja: data, koniec przed początkiem, projekt wymagany dla wątku', () => {
  assert.deepEqual(draftProblems(emptyDraft({ kind: 'shoot_day', date: '', projectId: 'p' })), ['date'])
  assert.deepEqual(
    draftProblems({ ...emptyDraft({ kind: 'shoot_day', date: '2026-10-28', projectId: 'p' }), endDate: '2026-10-27' }),
    ['endDate']
  )
  assert.deepEqual(draftProblems(emptyDraft({ kind: 'won', date: '2026-10-09' })), ['project'])
  assert.deepEqual(draftProblems(emptyDraft({ kind: 'won', date: '2026-10-09' }), { newProject: true }), [])
  assert.deepEqual(draftProblems(emptyDraft({ kind: 'note', date: '2026-10-09' })), [], 'notatka bez projektu OK')
  assert.deepEqual(draftProblems({ ...emptyDraft({ kind: 'lead_in', date: '2026-10-02', projectId: 'p' }), time: '9' }), ['time'])
})
