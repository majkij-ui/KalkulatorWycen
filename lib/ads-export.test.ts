import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ADS_CSV_COLUMNS,
  buildAdsCsv,
  groupRejected,
  normalizeEmail,
  normalizeLocalTime,
  normalizePhone,
  pendingRecordsFor,
  planAdsExport,
  sha256Hex,
  type AdsExportPlan,
  type AdsRejectReason,
  type PlanAdsExportInput,
} from './ads-export'
import { ADS_EXPORT_CONFIG } from './ads-export-config'
import { adsExportRecordSchema, type AdsExportRecord } from './ads-export-types'
import { eventSchema, type TimelineEvent } from './event-types'
import type { ProjectStatus } from './project-types'

const TODAY = '2026-11-05'
const CLICK = 'Cj0KCQiAabcdefghij'

function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

interface LeadOptions {
  id?: string
  start?: string
  title?: string
  quality?: string | null
  projectId?: string | null
  email?: string
  phone?: string
  /** `null` = lead bez sekcji `ads`. */
  ads?: Record<string, unknown> | null
}

function lead(o: LeadOptions = {}): TimelineEvent {
  const data: Record<string, unknown> = {}
  if (o.quality !== null) data.quality = o.quality ?? 'good'
  if (o.email) data.email = o.email
  if (o.phone) data.phone = o.phone
  if (o.ads !== null) {
    data.ads = {
      leadId: 'LEAD0001',
      gclid: CLICK,
      fromAds: true,
      clickedAt: '2026-11-02T09:55:10',
      submittedAt: '2026-11-02T10:00:30',
      consent: 'unknown',
      ...o.ads,
    }
  }
  return eventSchema.parse({
    id: o.id ?? 'L1',
    kind: 'lead_in',
    projectId: o.projectId ?? null,
    start: o.start ?? '2026-11-02T10:00',
    title: o.title ?? 'Acme',
    data,
  })
}

const wonEvent = (id: string, projectId: string, start: string, extra: Record<string, unknown> = {}): TimelineEvent =>
  eventSchema.parse({ id, kind: 'won', projectId, start, title: 'Wygrane', ...extra })

const project = (id: string, status: ProjectStatus = 'won', name = `Projekt ${id}`) => ({ id, name, status })

function record(over: Partial<AdsExportRecord> = {}): AdsExportRecord {
  return adsExportRecordSchema.parse({
    id: 'r1',
    leadEventId: 'L1',
    leadId: 'LEAD0001',
    conversionKey: 'lead',
    conversionName: 'Lead realny (offline)',
    conversionTime: '2026-11-02T10:00:30',
    value: 300,
    status: 'pending',
    exportedAt: '2026-11-03T08:00:00.000Z',
    ...over,
  })
}

function plan(input: Partial<PlanAdsExportInput> = {}): AdsExportPlan {
  return planAdsExport({ events: [], projects: [], ledger: [], exports: [], today: TODAY, ...input })
}

const reasonsOf = (p: AdsExportPlan) => p.rejected.map((r) => `${r.conversionKey}:${r.reason}`)
const only = (p: AdsExportPlan, reason: AdsRejectReason) => p.rejected.filter((r) => r.reason === reason)

// ── Powody na poziomie leada ─────────────────────────────────────────────────

test('lead fake: powód fake, mimo click id', () => {
  const p = plan({ events: [lead({ quality: 'fake' })] })
  assert.deepEqual(reasonsOf(p), ['lead:fake'])
  assert.equal(p.rows.length, 0)
})

test('lead bez oceny: powód unrated (przed sprawdzaniem źródła)', () => {
  const p = plan({ events: [lead({ quality: null, ads: null })] })
  assert.deepEqual(reasonsOf(p), ['lead:unrated'])
})

test('lead bez ads: przed 1.11.2026 pre_tracking, później no_data', () => {
  const p = plan({
    events: [
      lead({ id: 'old', start: '2026-10-31T23:00', ads: null }),
      lead({ id: 'new', start: '2026-11-01T00:10', ads: null }),
    ],
  })
  assert.equal(only(p, 'pre_tracking')[0].leadEventId, 'old')
  assert.equal(only(p, 'no_data')[0].leadEventId, 'new')
  assert.equal(p.rows.length, 0)
})

test('fromAds nie true: powód not_ads', () => {
  for (const ads of [{ fromAds: false }, { fromAds: undefined }, { fromAds: 'tak' }]) {
    assert.deepEqual(reasonsOf(plan({ events: [lead({ ads })] })), ['lead:not_ads'], JSON.stringify(ads))
  }
})

test('zgoda denied: nic nie jedzie, nawet z click id', () => {
  const p = plan({ events: [lead({ ads: { consent: 'denied' }, email: 'a@b.pl' })] })
  assert.deepEqual(reasonsOf(p), ['lead:consent_denied'])
  assert.equal(p.rows.length, 0)
})

test('bez click id i bez zgody granted: no_consent_contact (unknown i brak zgody)', () => {
  const noClick = { gclid: undefined }
  assert.deepEqual(
    reasonsOf(plan({ events: [lead({ ads: { ...noClick, consent: 'unknown' }, email: 'a@b.pl' })] })),
    ['lead:no_consent_contact']
  )
  assert.deepEqual(
    reasonsOf(plan({ events: [lead({ ads: { ...noClick, consent: undefined }, phone: '600100200' })] })),
    ['lead:no_consent_contact']
  )
})

test('bez click id, zgoda granted, ale bez użytecznego kontaktu: no_identifier', () => {
  const ads = { gclid: undefined, consent: 'granted' }
  assert.deepEqual(reasonsOf(plan({ events: [lead({ ads })] })), ['lead:no_identifier'])
  // telefon w złym formacie i zepsuty e-mail = brak kontaktu
  assert.deepEqual(reasonsOf(plan({ events: [lead({ ads, phone: '12345', email: 'nie-mail' })] })), ['lead:no_identifier'])
})

test('kolejność powodów: fake przed unrated, denied przed brakiem identyfikatora', () => {
  const p = plan({ events: [lead({ quality: 'fake', ads: { consent: 'denied' } })] })
  assert.deepEqual(reasonsOf(p), ['lead:fake'])
  const q = plan({ events: [lead({ ads: { gclid: undefined, consent: 'denied' } })] })
  assert.deepEqual(reasonsOf(q), ['lead:consent_denied'])
})

// ── Tożsamość wiersza ────────────────────────────────────────────────────────

test('click id: dokładnie jedna kolumna, kolejność gclid, gbraid, wbraid', () => {
  const all = plan({ events: [lead({ ads: { gclid: CLICK, gbraid: 'GB-0123456789', wbraid: 'WB-0123456789' } })] })
  assert.deepEqual(
    [all.rows[0].gclid, all.rows[0].gbraid, all.rows[0].wbraid],
    [CLICK, '', '']
  )
  const gb = plan({ events: [lead({ ads: { gclid: undefined, gbraid: 'GB-0123456789', wbraid: 'WB-0123456789' } })] })
  assert.deepEqual([gb.rows[0].gclid, gb.rows[0].gbraid, gb.rows[0].wbraid], ['', 'GB-0123456789', ''])
  const wb = plan({ events: [lead({ ads: { gclid: undefined, wbraid: 'WB-0123456789' } })] })
  assert.deepEqual([wb.rows[0].gclid, wb.rows[0].gbraid, wb.rows[0].wbraid], ['', '', 'WB-0123456789'])
})

test('click id o złym formacie nie liczy się jako click id', () => {
  const p = plan({ events: [lead({ ads: { gclid: 'za krótki!' } })] })
  assert.deepEqual(reasonsOf(p), ['lead:no_consent_contact'])
})

test('click id + zgoda unknown: bez kontaktu, kolumny zgody puste', async () => {
  const p = plan({ events: [lead({ email: 'jan@firma.pl', phone: '600100200' })] })
  const row = p.rows[0]
  assert.equal(row.email, '')
  assert.equal(row.phone, '')
  assert.equal(row.consent, 'unknown')
  const cells = (await buildAdsCsv(p.rows)).split('\n')[1].split(',')
  assert.equal(cells[4], '')
  assert.equal(cells[5], '')
  assert.equal(cells[10], '')
  assert.equal(cells[11], '')
})

test('click id + zgoda granted: kontakt zahaszowany, Granted w obu kolumnach', async () => {
  const p = plan({ events: [lead({ ads: { consent: 'granted' }, email: ' Jan@Firma.PL ', phone: '600 100 200' })] })
  const cells = (await buildAdsCsv(p.rows)).split('\n')[1].split(',')
  assert.equal(cells[1], CLICK)
  assert.equal(cells[4], await sha256Hex('jan@firma.pl'))
  assert.equal(cells[5], await sha256Hex('+48600100200'))
  assert.equal(cells[10], 'Granted')
  assert.equal(cells[11], 'Granted')
})

test('sam kontakt przy granted: wiersz bez click id, telefon gdy e-mail zepsuty', async () => {
  const p = plan({ events: [lead({ ads: { gclid: undefined, consent: 'granted' }, email: 'zepsuty', phone: '+48 600 100 200' })] })
  assert.equal(p.rows.length, 1)
  const cells = (await buildAdsCsv(p.rows)).split('\n')[1].split(',')
  assert.deepEqual(cells.slice(1, 4), ['', '', ''])
  assert.equal(cells[4], '')
  assert.equal(cells[5], await sha256Hex('+48600100200'))
})

// ── Okno ─────────────────────────────────────────────────────────────────────

test('okno 90 dni z click id: 90 mieści się, 91 odpada', () => {
  const inside = plan({ events: [lead({ ads: { clickedAt: `${daysBefore(TODAY, 90)}T08:00:00` } })] })
  assert.equal(inside.rows.length, 1)
  const outside = plan({ events: [lead({ ads: { clickedAt: `${daysBefore(TODAY, 91)}T08:00:00` } })] })
  assert.deepEqual(reasonsOf(outside), ['lead:out_of_window'])
})

test('okno 63 dni po samym kontakcie: 63 mieści się, 64 odpada', () => {
  const ads = (n: number) => ({ gclid: undefined, consent: 'granted', clickedAt: `${daysBefore(TODAY, n)}T08:00:00` })
  assert.equal(plan({ events: [lead({ ads: ads(63), phone: '600100200' })] }).rows.length, 1)
  assert.deepEqual(reasonsOf(plan({ events: [lead({ ads: ads(64), phone: '600100200' })] })), ['lead:out_of_window'])
})

test('okno liczone do dnia eksportu, nie do czasu konwersji', () => {
  // lead i wygrana dwa dni po kliknięciu, ale eksport 95 dni po kliknięciu
  const click = '2026-08-01T10:00:00'
  const events = [
    lead({ projectId: 'P1', start: '2026-08-01T10:05', ads: { clickedAt: click, submittedAt: '2026-08-01T10:05:00' } }),
    wonEvent('W1', 'P1', '2026-08-03'),
  ]
  const p = plan({ events, projects: [project('P1')], ledger: [{ id: 'P1', revenue: 5000 }], today: '2026-11-04' })
  assert.deepEqual(reasonsOf(p).sort(), ['lead:out_of_window', 'won:out_of_window'])
  assert.equal(p.rows.length, 0)
})

test('początek okna: clickedAt, potem submittedAt, potem data leada', () => {
  const base = { gclid: CLICK, fromAds: true, consent: 'unknown' }
  const old = daysBefore(TODAY, 120)
  const fresh = daysBefore(TODAY, 3)
  // clickedAt stare wygrywa z nowym submittedAt
  assert.deepEqual(
    reasonsOf(plan({ events: [lead({ ads: { ...base, clickedAt: `${old}T10:00:00`, submittedAt: `${fresh}T10:00:00` } })] })),
    ['lead:out_of_window']
  )
  // brak clickedAt: liczy od submittedAt
  assert.deepEqual(
    reasonsOf(plan({ events: [lead({ ads: { ...base, clickedAt: undefined, submittedAt: `${old}T10:00:00` } })] })),
    ['lead:out_of_window']
  )
  // brak obu: z daty leada
  assert.deepEqual(
    reasonsOf(plan({ events: [lead({ start: `${old}T10:00`, ads: { ...base, clickedAt: undefined, submittedAt: undefined } })] })),
    ['lead:out_of_window']
  )
  // nieczytelny clickedAt jest pomijany
  assert.equal(
    plan({ events: [lead({ ads: { ...base, clickedAt: 'wczoraj', submittedAt: `${fresh}T10:00:00` } })] }).rows.length,
    1
  )
})

test('mniej niż 14 dni do końca okna: wiersz zostaje i jest ostrzeżenie', () => {
  const at = (n: number) => plan({ events: [lead({ ads: { clickedAt: `${daysBefore(TODAY, n)}T08:00:00` } })] })
  const near = at(77) // zostało 13
  assert.equal(near.rows.length, 1)
  assert.deepEqual(near.warnings.map((w) => [w.conversionKey, w.daysLeft]), [['lead', 13]])
  const fine = at(76) // zostało 14
  assert.equal(fine.rows.length, 1)
  assert.equal(fine.warnings.length, 0)
})

// ── Wiersz „Lead realny" ─────────────────────────────────────────────────────

test('wiersz lead: czas z submittedAt, wartość z oceny, nazwa akcji z konfiguracji', () => {
  const p = plan({
    events: [lead({ id: 'a', quality: 'good' }), lead({ id: 'b', quality: 'very_good', ads: { gclid: 'Zz9yyyyyyyyyy' } })],
  })
  const a = p.rows.find((r) => r.leadEventId === 'a')!
  const b = p.rows.find((r) => r.leadEventId === 'b')!
  assert.equal(a.conversionTime, '2026-11-02T10:00:30')
  assert.equal(a.value, 300)
  assert.equal(b.value, 600)
  assert.equal(a.conversionName, 'Lead realny (offline)')
  assert.equal(a.conversionKey, 'lead')
  assert.equal(a.currency, 'PLN')
})

test('wiersz lead bez submittedAt: czas z wydarzenia, sama data = 12:00:00', () => {
  const timed = plan({ events: [lead({ start: '2026-11-02T08:15', ads: { submittedAt: undefined } })] })
  assert.equal(timed.rows[0].conversionTime, '2026-11-02T08:15:00')
  const dateOnly = plan({ events: [lead({ start: '2026-11-02', ads: { submittedAt: undefined } })] })
  assert.equal(dateOnly.rows[0].conversionTime, '2026-11-02T12:00:00')
})

// ── Wiersz „Zlecenie wygrane" ────────────────────────────────────────────────

const wonSetup = (over: Partial<PlanAdsExportInput> = {}, leadOpts: LeadOptions = {}) =>
  plan({
    events: [lead({ projectId: 'P1', ...leadOpts }), wonEvent('W1', 'P1', '2026-11-04')],
    projects: [project('P1')],
    ledger: [{ id: 'P1', revenue: 18500 }],
    ...over,
  })

test('wygrana: czas z wydarzenia won (12:00 przy samej dacie), wartość z money.revenue', () => {
  const p = wonSetup()
  const won = p.rows.find((r) => r.conversionKey === 'won')!
  assert.equal(won.conversionTime, '2026-11-04T12:00:00')
  assert.equal(won.value, 18500)
  assert.equal(won.conversionName, 'Zlecenie wygrane (offline)')
  assert.equal(p.rows.length, 2)
  assert.equal(p.totals.leads, 1)
  assert.equal(p.totals.rows, 2)
  assert.equal(p.totals.value, 18800)
})

test('wygrana z godziną w wydarzeniu: czas z godziną', () => {
  const p = wonSetup({ events: [lead({ projectId: 'P1' }), wonEvent('W1', 'P1', '2026-11-04T16:30')] })
  assert.equal(p.rows.find((r) => r.conversionKey === 'won')!.conversionTime, '2026-11-04T16:30:00')
})

test('projekt done też daje wygraną; quote i lost nie dają nic', () => {
  assert.equal(wonSetup({ projects: [project('P1', 'done')] }).rows.length, 2)
  for (const status of ['quote', 'lost'] as const) {
    const p = wonSetup({ projects: [project('P1', status)] })
    assert.equal(p.rows.length, 1)
    assert.equal(p.rows[0].conversionKey, 'lead')
    assert.deepEqual(reasonsOf(p), [])
  }
  // lead bez projektu
  assert.deepEqual(reasonsOf(plan({ events: [lead()] })), [])
})

test('wygrana bierze najwcześniejsze nieusunięte wydarzenie won', () => {
  const p = wonSetup({
    events: [
      lead({ projectId: 'P1' }),
      wonEvent('W2', 'P1', '2026-11-04'),
      wonEvent('W0', 'P1', '2026-11-03', { deletedAt: '2026-11-04T00:00:00Z' }),
      wonEvent('W1', 'P1', '2026-11-03T09:00'),
    ],
  })
  assert.equal(p.rows.find((r) => r.conversionKey === 'won')!.conversionTime, '2026-11-03T09:00:00')
})

test('projekt won/done bez wydarzenia won: no_won_date z projektem', () => {
  const p = wonSetup({ events: [lead({ projectId: 'P1' })] })
  const r = only(p, 'no_won_date')
  assert.equal(r.length, 1)
  assert.equal(r[0].projectId, 'P1')
  assert.equal(r[0].projectName, 'Projekt P1')
  assert.equal(r[0].conversionKey, 'won')
  assert.equal(p.rows.length, 1)
})

test('brak kwoty albo 0 zł: no_amount', () => {
  for (const revenue of [null, 0]) {
    const p = wonSetup({ ledger: [{ id: 'P1', revenue }] })
    assert.deepEqual(reasonsOf(p), ['won:no_amount'])
    assert.equal(p.rows.length, 1)
  }
})

test('wygrana tego samego dnia co lead: submittedAt + 1 minuta', () => {
  const p = wonSetup({ events: [lead({ projectId: 'P1', ads: { submittedAt: '2026-11-02T23:59:30' } }), wonEvent('W1', 'P1', '2026-11-02')] })
  // 12:00 < 23:59:30, więc wygrana przesuwa się za lead, także przez północ
  assert.equal(p.rows.find((r) => r.conversionKey === 'won')!.conversionTime, '2026-11-03T00:00:30')
})

test('wygrana równa czasowi leada też dostaje +1 minutę', () => {
  const p = wonSetup({
    events: [lead({ projectId: 'P1', ads: { submittedAt: '2026-11-02T12:00:00' } }), wonEvent('W1', 'P1', '2026-11-02')],
  })
  assert.equal(p.rows.find((r) => r.conversionKey === 'won')!.conversionTime, '2026-11-02T12:01:00')
})

test('dwa leady na jednym projekcie: wygrana tylko z najwcześniejszego', () => {
  const p = plan({
    events: [
      lead({ id: 'late', projectId: 'P1', start: '2026-11-03T10:00', ads: { gclid: 'Late0000000000', submittedAt: '2026-11-03T10:00:00' } }),
      lead({ id: 'early', projectId: 'P1', start: '2026-11-02T10:00' }),
      wonEvent('W1', 'P1', '2026-11-04'),
    ],
    projects: [project('P1')],
    ledger: [{ id: 'P1', revenue: 1000 }],
  })
  assert.deepEqual(p.rows.filter((r) => r.conversionKey === 'won').map((r) => r.leadEventId), ['early'])
  assert.deepEqual(only(p, 'won_on_other_lead').map((r) => r.leadEventId), ['late'])
  assert.equal(p.rows.filter((r) => r.conversionKey === 'lead').length, 2)
})

test('najwcześniejszy lead, który odpadł, nie blokuje wygranej drugiego', () => {
  const p = plan({
    events: [
      lead({ id: 'fake1', projectId: 'P1', quality: 'fake', start: '2026-11-01T10:00' }),
      lead({ id: 'real', projectId: 'P1', start: '2026-11-02T10:00' }),
      wonEvent('W1', 'P1', '2026-11-04'),
    ],
    projects: [project('P1')],
    ledger: [{ id: 'P1', revenue: 1000 }],
  })
  assert.deepEqual(p.rows.filter((r) => r.conversionKey === 'won').map((r) => r.leadEventId), ['real'])
})

test('wygrana już wysłana z jednego leada nie jedzie drugi raz z innego', () => {
  const p = plan({
    events: [
      lead({ id: 'A', projectId: 'P1', start: '2026-11-01T10:00' }),
      lead({ id: 'B', projectId: 'P1', start: '2026-11-02T10:00', ads: { gclid: 'Bbbbbbbbbbbbbb' } }),
      wonEvent('W1', 'P1', '2026-11-04'),
    ],
    projects: [project('P1')],
    ledger: [{ id: 'P1', revenue: 1000 }],
    exports: [record({ id: 'rw', leadEventId: 'B', conversionKey: 'won', value: 1000 })],
  })
  assert.deepEqual(p.rows.filter((r) => r.conversionKey === 'won'), [])
  assert.deepEqual(only(p, 'won_on_other_lead').map((r) => r.leadEventId), ['A'])
  assert.deepEqual(only(p, 'already_sent').map((r) => `${r.leadEventId}:${r.conversionKey}`), ['B:won'])
})

test('wygrana leada fałszywego nie jedzie', () => {
  const p = wonSetup({}, { quality: 'fake' })
  assert.deepEqual(reasonsOf(p), ['lead:fake'])
  assert.equal(p.rows.length, 0)
})

// ── Zapis wysłanych ──────────────────────────────────────────────────────────

test('pending i confirmed: already_sent dla pary (osobno lead i won)', () => {
  for (const status of ['pending', 'confirmed'] as const) {
    const p = wonSetup({ exports: [record({ status })] })
    assert.deepEqual(reasonsOf(p), ['lead:already_sent'])
    assert.deepEqual(p.rows.map((r) => r.conversionKey), ['won'])
  }
})

test('already_sent bije okno: wysłane dawno temu nie wraca jako „poza oknem"', () => {
  const p = plan({
    events: [lead({ ads: { clickedAt: `${daysBefore(TODAY, 200)}T08:00:00` } })],
    exports: [record({ status: 'confirmed' })],
  })
  assert.deepEqual(reasonsOf(p), ['lead:already_sent'])
})

test('cancelled: wiersz wraca z zamrożonym czasem z ostatniego cofnięcia i świeżą wartością', () => {
  const p = plan({
    events: [lead({ quality: 'very_good', ads: { submittedAt: '2026-11-02T10:30:00' } })],
    exports: [
      record({ id: 'old', status: 'cancelled', conversionTime: '2026-11-02T10:00:30', exportedAt: '2026-11-03T08:00:00.000Z', value: 300 }),
      record({ id: 'newer', status: 'cancelled', conversionTime: '2026-11-02T10:15:00', exportedAt: '2026-11-04T08:00:00.000Z', value: 300 }),
    ],
  })
  assert.equal(p.rows.length, 1)
  assert.equal(p.rows[0].conversionTime, '2026-11-02T10:15:00')
  assert.equal(p.rows[0].value, 600)
  assert.deepEqual(reasonsOf(p), [])
})

test('cancelled po ponownym pending: liczy się aktywny wpis', () => {
  const p = plan({
    events: [lead()],
    exports: [record({ id: 'a', status: 'cancelled' }), record({ id: 'b', status: 'pending', exportedAt: '2026-11-04T08:00:00.000Z' })],
  })
  assert.deepEqual(reasonsOf(p), ['lead:already_sent'])
})

test('rekord innej pary nie blokuje: tylko lead wysłany, won jedzie', () => {
  const p = wonSetup({ exports: [record({ conversionKey: 'lead' })] })
  assert.equal(p.rows.some((r) => r.conversionKey === 'won'), true)
})

// ── Lista korekt ─────────────────────────────────────────────────────────────

test('korekty: lead teraz fałszywy', () => {
  const p = plan({ events: [lead({ quality: 'fake' })], exports: [record()] })
  assert.deepEqual(p.corrections.map((c) => c.kind), ['lead_fake'])
})

test('korekty: inna ocena = inna wartość leada niż wysłana', () => {
  const p = plan({ events: [lead({ quality: 'very_good' })], exports: [record({ status: 'confirmed', value: 300 })] })
  assert.deepEqual(p.corrections.map((c) => [c.kind, c.sent, c.current]), [['lead_value_changed', 300, 600]])
  assert.deepEqual(plan({ events: [lead()], exports: [record()] }).corrections, [])
})

test('korekty: projekt teraz przegrany', () => {
  const p = wonSetup(
    { projects: [project('P1', 'lost')], exports: [record({ id: 'w', conversionKey: 'won', value: 18500 })] }
  )
  assert.deepEqual(p.corrections.map((c) => [c.kind, c.conversionKey]), [['project_lost', 'won']])
})

test('korekty: kwota różni się od wysłanej o więcej niż 0,5 zł', () => {
  const sent = [record({ id: 'w', conversionKey: 'won', value: 18500 })]
  const small = wonSetup({ ledger: [{ id: 'P1', revenue: 18500.4 }], exports: sent })
  assert.deepEqual(small.corrections, [])
  const big = wonSetup({ ledger: [{ id: 'P1', revenue: 17000 }], exports: sent })
  assert.deepEqual(big.corrections.map((c) => [c.kind, c.sent, c.current]), [['revenue_changed', 18500, 17000]])
})

test('korekty: cofnięty rekord nie generuje korekt', () => {
  assert.deepEqual(plan({ events: [lead({ quality: 'fake' })], exports: [record({ status: 'cancelled' })] }).corrections, [])
})

// ── Formaty ──────────────────────────────────────────────────────────────────

test('SHA-256: znane wektory', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

test('normalizeEmail: małe litery, przycięcie, kropki tylko w gmail i googlemail', () => {
  assert.equal(normalizeEmail('  Jan.Kowalski@Firma.PL '), 'jan.kowalski@firma.pl')
  assert.equal(normalizeEmail('Jan.Kow.alski@Gmail.com'), 'jankowalski@gmail.com')
  assert.equal(normalizeEmail('a.b@googlemail.com'), 'ab@googlemail.com')
  for (const bad of ['', 'bez-malpy', '@x.pl', 'a@', 'a b@x.pl', 'a@x', '.@gmail.com', null, 5]) {
    assert.equal(normalizeEmail(bad), null, String(bad))
  }
})

test('normalizePhone: E.164, gołe 9 cyfr dostaje +48, reszta to brak telefonu', () => {
  assert.equal(normalizePhone('+48 600-100-200'), '+48600100200')
  assert.equal(normalizePhone('600 100 200'), '+48600100200')
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958')
  assert.equal(normalizePhone('+12345678'), '+12345678')
  for (const bad of ['', '12345', '0048600100200', '48600100200', '+123', '+1234567890123456', 'tel. 600100200', '6001002003', null]) {
    assert.equal(normalizePhone(bad), null, String(bad))
  }
})

test('normalizeLocalTime: uzupełnia sekundy, odrzuca nieczytelne', () => {
  assert.equal(normalizeLocalTime('2026-11-04T10:12'), '2026-11-04T10:12:00')
  assert.equal(normalizeLocalTime('2026-11-04T10:12:09'), '2026-11-04T10:12:09')
  for (const bad of ['2026-11-04', '2026-02-30T10:00:00', '2026-11-04T25:00:00', 'x', undefined]) {
    assert.equal(normalizeLocalTime(bad), null, String(bad))
  }
})

test('CSV: nagłówek, kolejność kolumn, czas ze strefą, wartość, brak BOM', async () => {
  const p = plan({ events: [lead({ ads: { consent: 'granted' }, email: 'jan@firma.pl' })] })
  const csv = await buildAdsCsv(p.rows)
  assert.equal(csv.charCodeAt(0), 'l'.charCodeAt(0))
  const [header, row] = csv.split('\n')
  assert.equal(
    header,
    'leadId,gclid,gbraid,wbraid,email_sha256,phone_sha256,conversion_name,conversion_time,value,currency,ad_user_data,ad_personalization'
  )
  assert.equal(header, ADS_CSV_COLUMNS.join(','))
  const cells = row.split(',')
  assert.equal(cells.length, 12)
  assert.equal(cells[0], 'LEAD0001')
  assert.equal(cells[6], 'Lead realny (offline)')
  assert.equal(cells[7], '2026-11-02T10:00:30 Europe/Warsaw')
  assert.equal(cells[8], '300')
  assert.equal(cells[9], 'PLN')
  assert.ok(csv.endsWith('\n'))
})

test('CSV: cudzysłowy tam, gdzie trzeba, a wartość z groszami z kropką', async () => {
  const p = plan({ events: [lead({ ads: { leadId: 'a,"b"' } })] })
  const row = { ...p.rows[0], value: 1234.5 }
  const line = (await buildAdsCsv([row])).split('\n')[1]
  assert.ok(line.startsWith('"a,""b""",'))
  assert.ok(line.includes(',1234.5,PLN,'))
})

test('CSV: w pliku nie ma jawnego e-maila ani telefonu', async () => {
  const p = plan({
    events: [
      lead({ id: 'x', ads: { consent: 'granted' }, email: 'Tajny.Adres@firma.pl', phone: '601 202 303' }),
      lead({ id: 'y', ads: { gclid: undefined, consent: 'granted' }, email: 'inny@firma.pl' }),
    ],
  })
  const csv = await buildAdsCsv(p.rows)
  for (const secret of ['tajny.adres', 'tajnyadres', 'firma.pl', 'inny@', '601 202 303', '601202303', '@']) {
    assert.equal(csv.toLowerCase().includes(secret.toLowerCase()), false, secret)
  }
  assert.equal(p.rows.length, 2)
})

test('rekordy pending zamrażają czas i wartość wiersza', () => {
  const p = plan({ events: [lead()] })
  const records = pendingRecordsFor(p.rows, '2026-11-05T09:00:00.000Z', () => 'id-1')
  assert.deepEqual(
    records.map((r) => [r.id, r.leadEventId, r.conversionKey, r.conversionTime, r.value, r.status, r.exportedAt]),
    [['id-1', 'L1', 'lead', '2026-11-02T10:00:30', 300, 'pending', '2026-11-05T09:00:00.000Z']]
  )
  // po zapisie ta sama para odpada jako już wysłana
  assert.deepEqual(reasonsOf(plan({ events: [lead()], exports: records })), ['lead:already_sent'])
})

test('groupRejected: kolejność powodów z planu, bez pustych grup', () => {
  const p = plan({
    events: [lead({ id: 'a', quality: 'fake' }), lead({ id: 'b', quality: null, ads: null }), lead({ id: 'c', quality: 'fake' })],
  })
  assert.deepEqual(
    groupRejected(p.rejected).map((g) => [g.reason, g.items.length]),
    [['fake', 2], ['unrated', 1]]
  )
})

test('rekord z pliku: schemat zachowuje nieznane pola, zły status czyta się jako pending', () => {
  const r = adsExportRecordSchema.parse({ id: 'r', status: 'dziwny', value: 'x', future: { a: 1 }, conversionKey: 'qualified' })
  assert.equal(r.status, 'pending')
  assert.equal(r.value, 0)
  assert.equal(r.conversionKey, 'qualified')
  assert.deepEqual(r.future, { a: 1 })
})

test('konfiguracja: nazwy akcji, wartości, okna i start śledzenia', () => {
  assert.deepEqual(ADS_EXPORT_CONFIG.actionNames, { lead: 'Lead realny (offline)', won: 'Zlecenie wygrane (offline)' })
  assert.deepEqual(ADS_EXPORT_CONFIG.leadValues, { good: 300, very_good: 600 })
  assert.equal(ADS_EXPORT_CONFIG.currency, 'PLN')
  assert.equal(ADS_EXPORT_CONFIG.windowDaysClickId, 90)
  assert.equal(ADS_EXPORT_CONFIG.windowDaysContact, 63)
  assert.equal(ADS_EXPORT_CONFIG.warnDaysLeft, 14)
  assert.equal(ADS_EXPORT_CONFIG.trackingStart, '2026-11-01')
})
