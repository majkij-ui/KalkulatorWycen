import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  budgetBetween,
  campaignActiveOn,
  campaignMonths,
  campaignWindow,
  countLeads,
  dailyBudgetOn,
  leadOrigin,
  originBreakdown,
  summarizeCampaign,
  summarizeCampaigns,
} from './marketing-calc'
import { readLead, type Lead } from './marketing-leads'
import { campaignSchema, type Campaign } from './marketing-types'
import { eventSchema } from './event-types'
import { fixedCostSchema, type FixedCost, type Project, type ProjectStatus } from './project-types'

const TODAY = '2026-10-08'

const campaign = (extra: Partial<Campaign> = {}): Campaign =>
  campaignSchema.parse({
    id: 'c1',
    name: 'B2B',
    platform: 'google_ads',
    startDate: '2026-04-09',
    endDate: '2026-07-07',
    budgets: [{ from: '2026-04-09', daily: 75 }],
    ...extra,
  })

let leadSeq = 0
const lead = (date: string, quality: string | undefined, extra: Record<string, unknown> = {}): Lead =>
  readLead(
    eventSchema.parse({
      id: `l${++leadSeq}`,
      kind: 'lead_in',
      start: date,
      title: `Lead ${leadSeq}`,
      projectId: (extra.projectId as string) ?? null,
      data: { quality, campaignId: 'c1', ...extra },
    })
  )

const cost = (month: string, amount: number, extra: Partial<FixedCost> = {}): FixedCost =>
  fixedCostSchema.parse({ id: `fc-${month}`, month, type: 'marketing', amount, campaignId: 'c1', ...extra })

function project(id: string, status: ProjectStatus, sumaNetto: number, zysk: number, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status,
    date: '2026-06-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: { sumaNetto, koszty: 0, podatek: 0, zysk, marzaPct: 0, computedAt: '' },
    equipment: [],
    notes: '',
    ...extra,
  }
}

test('okno kampanii: zakończona, trwająca i przyszła', () => {
  const ended = campaignWindow(campaign(), TODAY)!
  assert.equal(ended.days, 90, '9.04–7.07 to 90 dni')
  assert.equal(ended.ended, true)
  assert.equal(ended.running, false)

  const running = campaignWindow(campaign({ startDate: '2026-10-01', endDate: undefined }), TODAY)!
  assert.equal(running.end, TODAY)
  assert.equal(running.days, 8)
  assert.equal(running.running, true)

  const scheduledEnd = campaignWindow(campaign({ startDate: '2026-10-01', endDate: '2026-12-31' }), TODAY)!
  assert.equal(scheduledEnd.end, TODAY, 'zaplanowany koniec w przyszłości liczy się do dziś')
  assert.equal(scheduledEnd.running, true)

  const upcoming = campaignWindow(campaign({ startDate: '2026-11-01', endDate: undefined }), TODAY)!
  assert.equal(upcoming.days, 0)
  assert.equal(upcoming.upcoming, true)

  assert.equal(campaignWindow(campaign({ startDate: 'zła data' }), TODAY), null)
})

test('budżet dzienny ze zmianami: pierwsza pozycja obowiązuje od startu', () => {
  const c = campaign({
    budgets: [
      { from: '2026-05-01', daily: 100 },
      { from: '2026-04-20', daily: 75 },
    ],
  })
  assert.equal(dailyBudgetOn(c, '2026-04-09'), 75, 'przed pierwszą datą — pierwsza (posortowana) pozycja')
  assert.equal(dailyBudgetOn(c, '2026-04-30'), 75)
  assert.equal(dailyBudgetOn(c, '2026-05-01'), 100)
  assert.equal(budgetBetween(c, '2026-04-29', '2026-05-02'), 75 + 75 + 100 + 100)
  assert.equal(dailyBudgetOn(campaign({ budgets: [] }), '2026-05-01'), 0)
})

test('uszkodzona zmiana budżetu odpada sama, reszta zostaje', () => {
  const c = campaignSchema.parse({
    id: 'c',
    startDate: '2026-01-01',
    budgets: [{ from: '2026-01-01', daily: 50 }, { from: 'kiedyś', daily: 80 }, { from: '2026-02-01', daily: -5 }],
  })
  assert.deepEqual(c.budgets, [{ from: '2026-01-01', daily: 50 }])
})

test('miesiące: odczyt z panelu wygrywa, brak odczytu = szacunek z budżetu', () => {
  const months = campaignMonths(
    campaign(),
    [cost('2026-05', 2300, { clicks: 150, impressions: 2000 }), cost('2026-06', 2266)],
    [lead('2026-05-12', 'good'), lead('2026-07-20', 'very_good')],
    TODAY
  )
  assert.deepEqual(
    months.map((m) => m.month),
    ['2026-04', '2026-05', '2026-06', '2026-07'],
    'lead po końcu kampanii nadal należy do lipca'
  )
  const [apr, may, jun, jul] = months
  assert.equal(apr.activeDays, 22)
  assert.equal(apr.budget, 22 * 75)
  assert.equal(apr.spend, null)
  assert.equal(apr.estimated, true)
  assert.equal(apr.effectiveSpend, 1650)
  assert.equal(may.spend, 2300)
  assert.equal(may.clicks, 150)
  assert.equal(may.estimated, false)
  assert.equal(may.leads.good, 1)
  assert.equal(jun.clicks, null, 'wydatek bez kliknięć to nie zero kliknięć')
  assert.equal(jul.activeDays, 7)
  assert.equal(jul.leads.veryGood, 1)
})

test('koszty innych kampanii i bez kampanii nie wchodzą do tej', () => {
  const months = campaignMonths(
    campaign(),
    [cost('2026-05', 1000), cost('2026-05', 999, { id: 'x', campaignId: 'c2' }), cost('2026-05', 50, { id: 'y', campaignId: undefined })],
    [],
    TODAY
  )
  assert.equal(months.find((m) => m.month === '2026-05')?.spend, 1000)
})

test('usunięty odczyt z panelu (miękko) nie liczy się: miesiąc wraca do szacunku z budżetu', () => {
  const months = campaignMonths(campaign(), [cost('2026-05', 2300, { deletedAt: '2026-10-13T10:00:00.000Z' })], [], TODAY)
  const may = months.find((m) => m.month === '2026-05')!
  assert.equal(may.spend, null)
  assert.equal(may.estimated, true)
})

test('liczenie leadów: realne = dobre + bardzo dobre, nieocenione osobno', () => {
  const counts = countLeads([lead('2026-05-01', 'fake'), lead('2026-05-02', 'good'), lead('2026-05-03', 'very_good'), lead('2026-05-04', undefined), lead('2026-05-05', 'coś nowego')])
  assert.deepEqual(counts, { total: 5, fake: 1, good: 1, veryGood: 1, unrated: 2, real: 2 })
})

test('podsumowanie: koszty leadów, lejek i zwrot z kampanii', () => {
  const projects = [
    project('p-won', 'done', 16200, 7900),
    project('p-won2', 'won', 25800, 11100),
    project('p-lost', 'lost', 9000, 3000, { quote: {} as never }),
    project('p-open', 'quote', 5000, 2000),
  ]
  const leads = [
    lead('2026-04-20', 'good', { projectId: 'p-won' }),
    lead('2026-04-21', 'very_good', { projectId: 'p-won2' }),
    lead('2026-04-22', 'very_good', { projectId: 'p-won2' }),
    lead('2026-05-10', 'good', { projectId: 'p-lost' }),
    lead('2026-05-11', 'good', { projectId: 'p-open' }),
    lead('2026-05-12', 'fake'),
    lead('2026-05-13', 'good', { campaignId: 'inna' }),
  ]
  const s = summarizeCampaign(campaign(), {
    costs: [cost('2026-04', 1600, { clicks: 100, impressions: 1500 }), cost('2026-05', 2400, { clicks: 150, impressions: 2000 }), cost('2026-06', 2300), cost('2026-07', 500)],
    leads,
    projects,
    quoteSentProjectIds: new Set(['p-open']),
    today: TODAY,
  })

  assert.equal(s.spend, 6800)
  assert.equal(s.spendFromPanel, 6800)
  assert.deepEqual(s.estimatedMonths, [])
  assert.equal(s.leads.total, 6, 'lead innej kampanii nie liczy się tutaj')
  assert.equal(s.leads.real, 5)
  assert.equal(s.costPerLead, 6800 / 6)
  assert.equal(s.costPerRealLead, 6800 / 5)
  assert.equal(s.costPerVeryGoodLead, 3400)
  assert.equal(s.fakeShare, 1 / 6)

  assert.equal(s.clicks, 250)
  assert.equal(s.impressions, 3500)
  assert.equal(s.ctr, 250 / 3500)
  assert.equal(s.cpc, 4000 / 250, 'CPC tylko z miesięcy z kliknięciami')
  assert.equal(s.clickToLead, 5 / 250, 'konwersja: realne zapytania z miesięcy z kliknięciami, bez fałszywych')

  assert.equal(s.projects.linked.length, 4, 'dwa leady do jednego projektu liczą się raz')
  assert.equal(s.projects.quoted, 4)
  assert.deepEqual(s.projects.won.map((p) => p.id), ['p-won', 'p-won2'])
  assert.equal(s.projects.lost, 1)
  assert.equal(s.revenue, 42000)
  assert.equal(s.profit, 19000)
  assert.equal(s.pipeline, 5000)
  assert.equal(s.costPerWon, 3400)
  assert.equal(s.roas, 42000 / 6800)
  assert.equal(s.profitAfterAds, 12200)
  assert.equal(s.dailyAverage, 6800 / 90)
  assert.ok(Math.abs((s.monthsFundedPerWon ?? 0) - 9500 / ((6800 / 90) * 30.4)) < 1e-9)
})

test('podsumowanie bez danych nie dzieli przez zero', () => {
  const s = summarizeCampaign(campaign({ startDate: '2026-11-01', endDate: undefined }), {
    costs: [],
    leads: [],
    projects: [],
    today: TODAY,
  })
  assert.equal(s.spend, 0)
  assert.equal(s.costPerLead, null)
  assert.equal(s.roas, null)
  assert.equal(s.ctr, null)
  assert.equal(s.dailyAverage, null)
  assert.equal(s.monthsFundedPerWon, null)
})

test('trwająca kampania bez odczytu z panelu: wydatek szacowany z budżetu do dziś', () => {
  const s = summarizeCampaign(campaign({ startDate: '2026-10-01', endDate: undefined, budgets: [{ from: '2026-10-01', daily: 80 }] }), {
    costs: [],
    leads: [lead('2026-10-03', 'good')],
    projects: [],
    today: TODAY,
  })
  assert.equal(s.spend, 8 * 80)
  assert.deepEqual(s.estimatedMonths, ['2026-10'])
  assert.equal(s.costPerRealLead, 640)
})

test('kampania bez znanego budżetu: miesiąc bez odczytu to 0 zł, nie szacunek', () => {
  const c = campaign({ startDate: '2026-09-24', endDate: undefined, budgets: [] })
  const s = summarizeCampaign(c, { costs: [cost('2026-09', 776.9, { clicks: 107, impressions: 1780 })], leads: [], projects: [], today: TODAY })
  assert.equal(s.spend, 776.9, 'październik bez odczytu i bez budżetu nic nie dokłada')
  assert.deepEqual(s.estimatedMonths, [])
  assert.equal(s.budget, 0)
  assert.equal(s.months.length, 2)
})

test('kampania aktywna w dniu: najnowsza pasująca', () => {
  const old = campaign()
  const current = campaign({ id: 'c2', startDate: '2026-10-01', endDate: undefined })
  assert.equal(campaignActiveOn([old, current], '2026-05-05')?.id, 'c1')
  assert.equal(campaignActiveOn([old, current], '2026-10-05')?.id, 'c2')
  assert.equal(campaignActiveOn([old, current], '2026-08-01'), null)
})

test('pochodzenie klientów: wiersze z listy zawsze, „nie ustalono" na końcu', () => {
  const rows = originBreakdown(
    [
      project('a', 'done', 10000, 4000, { leadSource: 'google_ads' }),
      project('b', 'quote', 3000, 1000, { leadSource: 'google_ads' }),
      project('c', 'won', 8000, 3000, { leadSource: 'polecenie' }),
      project('d', 'lost', 5000, 1000, { leadSource: 'tiktok' }),
      project('e', 'done', 2000, 500),
      project('f', 'done', 9999, 9999, { leadSource: 'google_ads', date: '2025-12-01' }),
    ],
    2026
  )
  assert.deepEqual(
    rows.map((r) => r.key),
    ['powracajacy', 'polecenie', 'networking', 'google_ads', 'inne', 'tiktok', '']
  )
  const ads = rows.find((r) => r.key === 'google_ads')!
  assert.equal(ads.projects, 2, 'projekt z 2025 odpada przy filtrze roku')
  assert.equal(ads.won, 1)
  assert.equal(ads.revenue, 10000)
  assert.equal(ads.pipeline, 3000)
  assert.equal(rows.find((r) => r.key === 'tiktok')?.label, 'tiktok', 'nieznany klucz pokazuje się dosłownie')
  assert.equal(rows.at(-1)?.label, 'Nie ustalono')
  assert.equal(originBreakdown([], null).some((r) => r.key === ''), false)
})

test('pochodzenie leada: kampania > pole leada > projekt', () => {
  const campaigns = new Map([['c1', { platform: 'google_ads' }], ['m', { platform: 'meta_ads' }]])
  const projects = new Map([['p', { leadSource: 'powracajacy' }]])
  assert.equal(leadOrigin({ campaignId: 'c1', origin: 'polecenie', projectId: 'p' }, campaigns, projects), 'google_ads')
  assert.equal(leadOrigin({ campaignId: 'm', origin: '', projectId: null }, campaigns, projects), 'inne')
  assert.equal(leadOrigin({ campaignId: null, origin: 'networking', projectId: 'p' }, campaigns, projects), 'networking')
  assert.equal(leadOrigin({ campaignId: null, origin: '', projectId: 'p' }, campaigns, projects), 'powracajacy')
  assert.equal(leadOrigin({ campaignId: 'usunięta', origin: '', projectId: null }, campaigns, projects), '')
})

// ── „Wszystkie kampanie" ─────────────────────────────────────────────────────

const c2 = () =>
  campaign({ id: 'c2', name: 'Autumn', startDate: '2026-06-01', endDate: undefined, budgets: [{ from: '2026-06-01', daily: 100 }] })
const cost2 = (month: string, amount: number, extra: Partial<FixedCost> = {}) =>
  cost(month, amount, { id: `fc2-${month}`, campaignId: 'c2', ...extra })
const both = () => [campaign(), c2()]
const baseParams = (extra: Record<string, unknown> = {}) => ({ costs: [], leads: [], projects: [], today: TODAY, ...extra })

test('wszystkie: wskaźniki z sum, nie ze średniej wskaźników kampanii', () => {
  const costs = [
    cost('2026-05', 1000, { clicks: 100, impressions: 1000 }),
    cost2('2026-06', 3000, { clicks: 200, impressions: 9000 }),
  ]
  const leads = [
    lead('2026-05-12', 'good'),
    lead('2026-05-13', 'fake'),
    lead('2026-06-12', 'very_good', { campaignId: 'c2' }),
    lead('2026-06-13', 'good', { campaignId: 'c2' }),
    lead('2026-06-14', 'good', { campaignId: 'c2' }),
  ]
  const s = summarizeCampaigns(both(), baseParams({ costs, leads }))
  assert.equal(s.clicks, 300)
  assert.equal(s.impressions, 10000)
  assert.equal(s.ctr, 300 / 10000, 'CTR 3%, a średnia z 10% i 2,2% dałaby 6,1%')
  assert.equal(s.cpc, 4000 / 300, 'CPC 13,33, a średnia z 10 i 15 dałaby 12,5')
  assert.deepEqual(s.leads, { total: 5, fake: 1, good: 3, veryGood: 1, unrated: 0, real: 4 })
  assert.equal(s.costPerLead, s.spend / 5)
  assert.equal(s.costPerRealLead, s.spend / 4)
  assert.equal(s.costPerVeryGoodLead, s.spend / 1)
  assert.equal(s.fakeShare, 1 / 5)
  assert.equal(s.spendFromPanel, 4000)
  assert.ok(s.clickToLead !== null && s.clickToLead > 0 && s.clickToLead < 1)
})

test('wszystkie: miesiąc bez odczytu liczy się z budżetu i jest oznaczony', () => {
  const costs = [cost('2026-05', 2300)]
  const s = summarizeCampaigns(both(), baseParams({ costs }))
  const one = summarizeCampaign(campaign(), baseParams({ costs }))
  const two = summarizeCampaign(c2(), baseParams())
  assert.equal(s.spend, one.spend + two.spend)
  assert.ok(s.estimatedMonths.includes('2026-04'))
  assert.ok(!s.estimatedMonths.includes('2026-05'), 'maj ma odczyt z panelu')
  assert.equal(s.spendFromPanel, 2300)
  assert.equal(s.clicks, null, 'wydatek bez kliknięć to nie zero kliknięć')
  assert.equal(s.cpc, null)
  assert.equal(s.ctr, null)
})

test('wszystkie: projekt z leadów dwóch kampanii liczy się raz', () => {
  const projects = [
    project('p-won', 'done', 10000, 4000),
    project('p-open', 'quote', 3000, 0),
    project('p-lost', 'lost', 5000, 0),
    project('p-only2', 'won', 8000, 2000),
  ]
  const leads = [
    lead('2026-05-01', 'good', { projectId: 'p-won' }),
    lead('2026-06-20', 'good', { campaignId: 'c2', projectId: 'p-won' }),
    lead('2026-05-02', 'good', { projectId: 'p-open' }),
    lead('2026-06-21', 'good', { campaignId: 'c2', projectId: 'p-open' }),
    lead('2026-05-03', 'good', { projectId: 'p-lost' }),
    lead('2026-06-22', 'good', { campaignId: 'c2', projectId: 'p-only2' }),
  ]
  const s = summarizeCampaigns(both(), baseParams({ projects, leads }))
  assert.equal(s.projects.linked.length, 4, 'p-won i p-open tylko raz')
  assert.equal(s.projects.quoted, 3, 'p-open bez wyceny się nie liczy, reszta po wycenie')
  assert.deepEqual(s.projects.won.map((p) => p.id).sort(), ['p-only2', 'p-won'])
  assert.equal(s.projects.lost, 1)
  assert.equal(s.revenue, 18000)
  assert.equal(s.profit, 6000)
  assert.equal(s.pipeline, 3000)
  assert.equal(s.costPerWon, s.spend / 2)
  assert.equal(s.roas, 18000 / s.spend)
  assert.equal(s.roi, (6000 - s.spend) / s.spend)
  assert.equal(s.profitAfterAds, 6000 - s.spend)
  assert.equal(s.leads.total, 6, 'leady się nie dedupują, tylko projekty')
})

test('wszystkie: leady spoza kampanii nie wchodzą', () => {
  const leads = [
    lead('2026-05-01', 'good'),
    lead('2026-05-02', 'good', { campaignId: undefined }),
    lead('2026-05-03', 'good', { campaignId: 'usunięta' }),
  ]
  const s = summarizeCampaigns(both(), baseParams({ leads }))
  assert.equal(s.leads.total, 1)
  assert.equal(s.months.reduce((n, m) => n + m.leads.total, 0), 1)
})

test('wszystkie: okno od pierwszego startu do ostatniego końca, dni emisji sumą', () => {
  const running = summarizeCampaigns(both(), baseParams()).window!
  assert.equal(running.start, '2026-04-09')
  assert.equal(running.end, TODAY, 'jedna trwa, więc okno otwarte do dziś')
  assert.equal(running.running, true)
  assert.equal(running.days, 90 + 130, 'B2B 90 dni + Autumn 1.06–8.10 = 130 dni')

  const old = campaign({ id: 'c3', startDate: '2026-02-01', endDate: '2026-03-01' })
  const ended = summarizeCampaigns([campaign(), old], baseParams())
  assert.equal(ended.window!.start, '2026-02-01')
  assert.equal(ended.window!.end, '2026-07-07')
  assert.equal(ended.window!.running, false)
  assert.equal(ended.window!.days, 90 + 29)
  assert.equal(ended.dailyAverage, ended.spend / 119)

  const none = summarizeCampaigns([], baseParams())
  assert.equal(none.window, null)
  assert.equal(none.spend, 0)
  assert.equal(none.roas, null)
})

test('wszystkie: tabela miesięcy — wiersz na kampanię i miesiąc, z nazwą, po miesiącu', () => {
  const s = summarizeCampaigns(both(), baseParams({ costs: [cost('2026-06', 2000), cost2('2026-06', 3000)] }))
  const order = s.months.map((m) => m.month)
  assert.deepEqual(order, [...order].sort())
  const june = s.months.filter((m) => m.month === '2026-06')
  assert.deepEqual(june.map((m) => m.campaignName), ['Autumn', 'B2B'])
  assert.deepEqual(june.map((m) => m.campaignId), ['c2', 'c1'])
  assert.deepEqual(june.map((m) => m.spend), [3000, 2000])
  assert.equal(s.months.filter((m) => m.campaignName === 'Autumn').at(-1)!.month, '2026-10')
})

test('wszystkie: jedna kampania daje te same liczby co widok pojedynczy', () => {
  const costs = [cost('2026-05', 2300, { clicks: 150, impressions: 2000 })]
  const leads = [lead('2026-05-12', 'good'), lead('2026-05-13', 'very_good', { projectId: 'p' })]
  const params = baseParams({ costs, leads, projects: [project('p', 'done', 10000, 4000)] })
  const one = summarizeCampaign(campaign(), params)
  const all = summarizeCampaigns([campaign()], params)
  const { months: m1, ...rest1 } = one
  const { months: m2, ...rest2 } = all
  assert.deepEqual(rest2, rest1)
  assert.deepEqual(m2.map(({ campaignId: _id, campaignName: _n, ...m }) => m), m1)
})
