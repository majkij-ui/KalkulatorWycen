import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  draftFromLead,
  emptyLeadDraft,
  leadDraftProblems,
  leadEventFromDraft,
  leadsFromEvents,
  patchLeadEvent,
  readLead,
} from './marketing-leads'
import { eventSchema, type TimelineEvent } from './event-types'
import { eventKind } from './event-kinds'
import { draftProblems, emptyDraft } from './event-draft'

const NOW = new Date('2026-10-08T12:00:00Z')

const stored = (extra: Record<string, unknown> = {}): TimelineEvent =>
  eventSchema.parse({
    id: 'ev-1',
    kind: 'lead_in',
    projectId: null,
    start: '2026-06-24T09:30',
    title: 'Interprint Polska',
    notes: 'Wycena wysłana',
    data: {
      quality: 'good',
      campaignId: 'c1',
      channel: 'mail',
      contactName: 'Weronika',
      email: 'w@example.com',
      futureKey: { nested: true },
    },
    source: { type: 'import', ref: 'xlsx#2' },
    createdAt: '2026-07-01T00:00:00Z',
    importedBy: 'claude',
    ...extra,
  })

test('odczyt leada z wydarzenia', () => {
  const lead = readLead(stored())
  assert.equal(lead.date, '2026-06-24')
  assert.equal(lead.time, '09:30')
  assert.equal(lead.name, 'Interprint Polska')
  assert.equal(lead.quality, 'good')
  assert.equal(lead.campaignId, 'c1')
  assert.equal(lead.contactName, 'Weronika')
  assert.equal(lead.phone, '')
})

test('nieznana jakość czyta się jako „do oceny", a zapis jej nie kasuje', () => {
  const event = stored({ data: { quality: 'weak', campaignId: 'c1' } })
  const lead = readLead(event)
  assert.equal(lead.quality, null)
  const saved = leadEventFromDraft(draftFromLead(lead), event, NOW)
  assert.equal(saved.data.quality, 'weak')
})

test('lista leadów: tylko lead_in, bez usuniętych i bez daty, najnowsze u góry', () => {
  const events = [
    stored({ id: 'a', start: '2026-05-01' }),
    stored({ id: 'b', start: '2026-06-01' }),
    stored({ id: 'c', start: '2026-07-01', deletedAt: '2026-07-02' }),
    stored({ id: 'd', start: 'zła' }),
    stored({ id: 'e', kind: 'reply_sent', start: '2026-08-01' }),
  ]
  assert.deepEqual(leadsFromEvents(events).map((l) => l.id), ['b', 'a'])
})

test('edycja leada zachowuje nieznane pola, klucze data i źródło importu', () => {
  const original = stored()
  const draft = { ...draftFromLead(readLead(original)), quality: 'very_good' as const, email: '', phone: '600 100 200' }
  const saved = leadEventFromDraft(draft, original, NOW)
  assert.equal(saved.id, 'ev-1')
  assert.equal(saved.data.quality, 'very_good')
  assert.equal(saved.data.email, undefined, 'wyczyszczone pole znika z rekordu')
  assert.equal(saved.data.phone, '600 100 200')
  assert.deepEqual(saved.data.futureKey, { nested: true })
  assert.deepEqual(saved.source, { type: 'import', ref: 'xlsx#2' })
  assert.equal((saved as Record<string, unknown>).importedBy, 'claude')
  assert.equal(saved.createdAt, '2026-07-01T00:00:00Z')
  assert.equal(saved.updatedAt, NOW.toISOString())
  assert.ok(eventSchema.safeParse(saved).success)
})

test('nowy lead: z kampanią nie zapisuje pochodzenia, bez kampanii — tak', () => {
  const base = { ...emptyLeadDraft({ date: '2026-10-08', campaignId: 'c1' }), name: '  Tchibo  ', origin: 'polecenie' }
  const withCampaign = leadEventFromDraft(base, null, NOW)
  assert.equal(withCampaign.kind, 'lead_in')
  assert.equal(withCampaign.title, 'Tchibo')
  assert.equal(withCampaign.start, '2026-10-08')
  assert.equal(withCampaign.data.quality, 'good', 'nowy lead domyślnie dobry')
  assert.equal(withCampaign.data.origin, undefined)
  assert.deepEqual(withCampaign.source, { type: 'manual' })

  const noCampaign = leadEventFromDraft({ ...base, campaignId: null, time: '14:05' }, null, NOW)
  assert.equal(noCampaign.data.origin, 'polecenie')
  assert.equal(noCampaign.data.campaignId, undefined)
  assert.equal(noCampaign.start, '2026-10-08T14:05')
})

test('problemy formularza leada', () => {
  assert.deepEqual(leadDraftProblems(emptyLeadDraft({ date: '' })), ['date', 'name'])
  assert.deepEqual(leadDraftProblems({ ...emptyLeadDraft({ date: '2026-10-08' }), name: 'X', time: '9' }), ['time'])
})

test('szybka zmiana z listy dotyka tylko podanych kluczy', () => {
  const original = stored({ data: { quality: 'good', origin: 'polecenie', channel: 'mail', weird: 5 } })
  const rated = patchLeadEvent(original, { quality: 'fake' }, NOW)
  assert.deepEqual(rated.data, { quality: 'fake', origin: 'polecenie', channel: 'mail', weird: 5 })
  assert.equal(rated.projectId, null)

  const assigned = patchLeadEvent(original, { campaignId: 'c2', projectId: 'p-1' }, NOW)
  assert.equal(assigned.data.campaignId, 'c2')
  assert.equal(assigned.data.origin, undefined, 'kampania zastępuje pochodzenie spoza niej')
  assert.equal(assigned.projectId, 'p-1')

  const cleared = patchLeadEvent(original, { quality: null }, NOW)
  assert.equal(cleared.data.quality, undefined)
})

test('lead bez projektu jest poprawnym wpisem także w kalendarzu', () => {
  assert.equal(eventKind('lead_in').scope, 'either')
  assert.deepEqual(draftProblems(emptyDraft({ kind: 'lead_in', date: '2026-10-08', projectId: null })), [])
})
