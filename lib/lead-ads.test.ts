import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyLeadSource,
  draftFromLead,
  emptyLeadDraft,
  leadEventFromDraft,
  patchLeadEvent,
  readLead,
  setLeadFromAds,
} from './marketing-leads'
import { eventSchema, type TimelineEvent } from './event-types'
import { eventData } from './event-kinds'
import { parseLeadSource } from './lead-source-parse'
import { adsProblems, hasAds } from './marketing-types'

const NOW = new Date('2026-11-01T12:00:00Z')

const stored = (data: Record<string, unknown>): TimelineEvent =>
  eventSchema.parse({
    id: 'ev-1',
    kind: 'lead_in',
    projectId: null,
    start: '2026-06-24T09:30',
    title: 'Interprint Polska',
    notes: '',
    data,
    source: { type: 'import', ref: 'xlsx#2' },
    createdAt: '2026-07-01T00:00:00Z',
  })

const ADS = {
  leadId: 'K7Q2M9XA',
  fromAds: true,
  gclid: 'Cj0KCQjwxNmfBhDBARIsAHxDqqAcPz1Q-7a9XkLm2_Zt',
  clickedAt: '2026-10-31T14:02:11',
  submittedAt: '2026-10-31T14:22:19',
  consent: 'granted',
  utmSource: 'google',
  landingPath: '/oferta',
  futureAdsKey: { nested: [1, 2] },
}

test('ads: stary lead bez ads czyta się i zapisuje bez zmian', () => {
  const original = stored({ quality: 'good', email: 'w@example.com', futureKey: { nested: true } })
  const lead = readLead(original)
  assert.deepEqual(lead.ads, {})
  assert.equal(hasAds(lead.ads), false)
  const saved = leadEventFromDraft(draftFromLead(lead), original, NOW)
  assert.deepEqual(saved.data, original.data)
  assert.equal('ads' in saved.data, false)
})

test('ads: odczyt przez eventData i formularz zachowuje cały blok, także nieznane klucze', () => {
  const original = stored({ quality: 'good', email: 'w@example.com', ads: ADS })
  assert.deepEqual(eventData(original).ads, ADS)
  const lead = readLead(original)
  assert.equal(lead.ads.fromAds, true)
  assert.equal(lead.ads.gclid, ADS.gclid)

  const draft = { ...draftFromLead(lead), quality: 'very_good' as const, phone: '600 100 200' }
  const saved = leadEventFromDraft(draft, original, NOW)
  assert.deepEqual(saved.data.ads, ADS)
  assert.ok(eventSchema.safeParse(saved).success)
  assert.deepEqual(eventData(saved).ads, ADS)

  // szkic zbudowany od zera, bez nieznanego klucza, też go nie gubi
  const bare = { ...draft, ads: { leadId: 'K7Q2M9XA', fromAds: true } }
  const rebuilt = leadEventFromDraft(bare, original, NOW).data.ads as Record<string, unknown>
  assert.deepEqual(rebuilt.futureAdsKey, { nested: [1, 2] })
})

test('ads: formularz zmienia znane pola, wyczyszczenie ich usuwa, pusty blok znika', () => {
  const original = stored({ ads: { leadId: 'K7Q2M9XA', gclid: 'x'.repeat(12), futureAdsKey: 1 } })
  const cleared = leadEventFromDraft(
    { ...draftFromLead(readLead(original)), ads: { leadId: 'K7Q2M9XA', gclid: '  ' } },
    original,
    NOW
  )
  assert.deepEqual(cleared.data.ads, { leadId: 'K7Q2M9XA', futureAdsKey: 1 })

  const only = stored({ ads: { leadId: 'K7Q2M9XA' } })
  const empty = leadEventFromDraft({ ...draftFromLead(readLead(only)), ads: {} }, only, NOW)
  assert.equal('ads' in empty.data, false)
})

test('ads: wartość, której formularz nie umie pokazać, zostaje (ads jako tekst, gclid jako liczba)', () => {
  const weird = stored({ ads: 'tekst zamiast obiektu' })
  assert.deepEqual(readLead(weird).ads, {})
  assert.equal(leadEventFromDraft(draftFromLead(readLead(weird)), weird, NOW).data.ads, 'tekst zamiast obiektu')

  const typed = stored({ ads: { gclid: 123, consent: 'maybe', leadId: 'AB12CD34' } })
  const saved = leadEventFromDraft(draftFromLead(readLead(typed)), typed, NOW)
  assert.deepEqual(saved.data.ads, { gclid: 123, consent: 'maybe', leadId: 'AB12CD34' })
})

test('ads: nowy lead z wklejonego Źródła', () => {
  const parsed = parseLeadSource(`ŹRÓDŁO
Lead ID\tK7Q2M9XA
Z reklamy\ttak
gclid\t${ADS.gclid}
E-mail\tanna@interprint.pl
Telefon\t+48600100200
Wysłano\t2026-10-31 14:22:19 Europe/Warsaw
Zgoda ad_storage\tgranted`)
  assert.ok(parsed)
  const base = { ...emptyLeadDraft({ date: '2026-11-01' }), name: 'Interprint' }
  const filled = applyLeadSource(base, parsed, { fillDate: true })
  assert.equal(filled.date, '2026-10-31')
  assert.equal(filled.time, '14:22')
  assert.equal(filled.email, 'anna@interprint.pl')
  assert.equal(filled.phone, '+48600100200')
  assert.equal(filled.ads.leadId, 'K7Q2M9XA')
  assert.equal('email' in filled.ads, false, 'e-mail i telefon nie wchodzą do ads')
  assert.equal('problems' in filled.ads, false)

  const saved = leadEventFromDraft(filled, null, NOW)
  assert.equal(saved.start, '2026-10-31T14:22')
  assert.equal(saved.data.email, 'anna@interprint.pl')
  assert.deepEqual(saved.data.ads, {
    leadId: 'K7Q2M9XA',
    fromAds: true,
    gclid: ADS.gclid,
    submittedAt: '2026-10-31T14:22:19',
    consent: 'granted',
  })
  assert.ok(eventSchema.safeParse(saved).success)
})

test('ads: wklejka nigdy nie nadpisuje wpisanych e-maila, telefonu, godziny ani (przy edycji) daty', () => {
  const parsed = parseLeadSource(
    'ŹRÓDŁO\nE-mail\tz-wklejki@x.pl\nTelefon\t+48111222333\nWysłano\t2026-10-31 14:22:19 Europe/Warsaw'
  )
  assert.ok(parsed)
  const typed = { ...emptyLeadDraft({ date: '2026-10-20' }), email: 'wpisany@x.pl', phone: '600 000 000', time: '08:00' }
  const out = applyLeadSource(typed, parsed)
  assert.equal(out.email, 'wpisany@x.pl')
  assert.equal(out.phone, '600 000 000')
  assert.equal(out.time, '08:00')
  assert.equal(out.date, '2026-10-20')
  // godzina z wklejki pasuje tylko do dnia z wklejki
  assert.equal(applyLeadSource({ ...typed, time: '' }, parsed).time, '')
  assert.equal(applyLeadSource({ ...typed, time: '', date: '2026-10-31' }, parsed).time, '14:22')
  // pusta data zawsze się uzupełnia
  assert.equal(applyLeadSource({ ...typed, date: '', time: '' }, parsed).date, '2026-10-31')
  // pola ads należą do wklejki
  const older = { ...typed, ads: { leadId: 'STARYSTA' } }
  assert.equal(applyLeadSource(older, { ...parsed, leadId: 'K7Q2M9XA' }).ads.leadId, 'K7Q2M9XA')
})

test('ads: przełącznik „z reklamy" generuje lead id w alfabecie strony i niczego nie nadpisuje', () => {
  const base = emptyLeadDraft({ date: '2026-11-01' })
  const on = setLeadFromAds(base, true)
  assert.equal(on.ads.fromAds, true)
  assert.match(on.ads.leadId ?? '', /^[0-9A-Z]{8}$/)
  assert.equal(setLeadFromAds(on, true).ads.leadId, on.ads.leadId, 'drugie włączenie nie zmienia id')
  assert.equal(setLeadFromAds({ ...base, ads: { leadId: 'K7Q2M9XA' } }, true).ads.leadId, 'K7Q2M9XA')
  assert.equal(setLeadFromAds(base, true, () => 0).ads.leadId, '00000000')
  assert.equal(setLeadFromAds(base, true, () => 0.999999).ads.leadId, 'ZZZZZZZZ')
  // wyłączenie: jawne „nie", gdy jest inna wiedza o źródle, inaczej brak klucza
  assert.equal(setLeadFromAds(on, false).ads.fromAds, false)
  assert.equal('fromAds' in setLeadFromAds({ ...base, ads: { fromAds: true } }, false).ads, false)
})

test('ads: szybka zmiana z listy (patchLeadEvent) nie rusza ads', () => {
  const original = stored({ ads: ADS })
  assert.deepEqual(patchLeadEvent(original, { quality: 'very_good' }, NOW).data.ads, ADS)
})

test('ads: adsProblems — obiekt i format click id', () => {
  assert.deepEqual(adsProblems(undefined), [])
  assert.deepEqual(adsProblems({ leadId: 'K7Q2M9XA', gclid: ADS.gclid, utmTerm: 'cokolwiek', nieznany: 1 }), [])
  assert.match(adsProblems('tekst')[0], /oczekiwano obiektu/)
  assert.match(adsProblems(null)[0], /oczekiwano obiektu/)
  assert.match(adsProblems([ADS])[0], /oczekiwano obiektu/)
  assert.match(adsProblems({ gbraid: 'ab cd' }, 'event.data.ads')[0], /^event\.data\.ads\.gbraid: nieprawidłowy click id/)
  assert.equal(adsProblems({ gclid: 'a', wbraid: 42 }).length, 2)
})
