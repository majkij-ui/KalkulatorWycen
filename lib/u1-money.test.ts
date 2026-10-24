/**
 * U1 — U-LISTA: każdy ekran z pieniędzmi projektu czyta pętlę pieniędzy, nie
 * zamrożony plan. JHJ (24.10): lista 22 250 / zysk 7 934, Finanse 26 340 /
 * 11 676. Też Marketing (ROAS, pochodzenie klientów) i wartość wycen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizePeriod } from './finance-calc'
import { readLead } from './marketing-leads'
import { campaignSchema } from './marketing-types'
import { eventSchema } from './event-types'
import { originBreakdown, summarizeCampaign } from './marketing-calc'
import { moneyLedger, type MoneyEvent } from './money-loop'
import { listMoney } from './project-list'
import type { Project, ProjectCost } from './project-types'

const TODAY = '2026-10-24'
const financials = (sumaNetto: number, koszty: number) => {
  const podatek = sumaNetto * 0.085
  return { sumaNetto, koszty, podatek, zysk: sumaNetto - podatek - koszty, marzaPct: 0, computedAt: '', revenueSource: 'pdf' as const }
}

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: '',
    status: 'done',
    date: '2026-07-28',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...extra,
  } as Project
}

let seq = 0
const ev = (projectId: string, kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({ id: `e${++seq}`, kind, start, projectId, data })
const cost = (unitCost: number, ownWork = false): ProjectCost => ({ id: `c${++seq}`, category: 'ekipa', unitCost, ...(ownWork ? { ownWork: true } : {}) }) as ProjectCost

// JHJ: plan 22 250 (koszty planu 12 425 bez własnej pracy → zysk 7 934), Realizacja 12 425 zewn. + 10 100 moja praca,
// dosprzedaż 4 090 („Różnica w kwocie przelewu").
const jhj = project('jhj', {
  quote: { version: 2 } as Project['quote'],
  financials: financials(22250, 22250 - 22250 * 0.085 - 7934.25),
  costs: [cost(12425), cost(10100, true)],
})
const jhjEvents = [ev('jhj', 'extra_sale', '2026-10-23', { what: 'Różnica w kwocie przelewu', amountNetto: 4090 })]

test('U-LISTA: wiersz listy JHJ = Finanse projektu (26 340 / zysk 11 676), nie plan 22 250 / 7 934', () => {
  const [money] = moneyLedger([jhj], jhjEvents, TODAY)
  const row = listMoney(jhj, money)
  assert.equal(Math.round(jhj.financials!.sumaNetto), 22250)
  assert.equal(Math.round(jhj.financials!.zysk), 7934)
  assert.equal(row.revenue, 26340)
  assert.equal(Math.round(row.profit!), 11676)
  assert.deepEqual([row.missing, row.fromInvoices], [null, false])
})

test('U-LISTA: bez kwoty — „nie policzono" (jest wycena) / „brak wyceny"; z faktur oznaczone', () => {
  const [lead] = moneyLedger([project('lead', { status: 'lost' })], [], TODAY)
  assert.deepEqual(listMoney(project('lead'), lead), { revenue: null, profit: null, missing: 'brak wyceny', fromInvoices: false })
  assert.deepEqual(listMoney({ quote: { version: 2 } as Project['quote'] }, null).missing, 'nie policzono')
  const retro = project('retro', { financials: financials(9180, 0) })
  const [money] = moneyLedger([retro], [ev('retro', 'invoice_sent', '2026-03-26', { amountNetto: 9180 })], TODAY)
  assert.deepEqual([listMoney(retro, money).revenue, listMoney(retro, money).fromInvoices], [9180, true])
  // Faktura wyższa niż plan (zrealizowany): lista pokazuje fakturę, nie plan.
  const higher = project('h', { financials: financials(10000, 0) })
  const [h] = moneyLedger([higher], [ev('h', 'invoice_sent', '2026-08-01', { amountNetto: 12000 })], TODAY)
  assert.equal(listMoney(higher, h).revenue, 12000)
  assert.equal(h.expected, 10000)
})

const campaign = campaignSchema.parse({ id: 'c1', name: 'B2B', platform: 'google_ads', startDate: '2026-04-09', endDate: '2026-07-07', budgets: [{ from: '2026-04-09', daily: 75 }] })
const lead = (projectId: string) =>
  readLead(eventSchema.parse({ id: `l-${projectId}`, kind: 'lead_in', start: '2026-05-10', title: 'Lead', projectId, data: { quality: 'good', campaignId: 'c1' } }))

test('Marketing: ROAS i zysk kampanii z pętli pieniędzy (JHJ +4 090 przychodu); bez mapy — plan jak dawniej', () => {
  const projects = [{ ...jhj, leadSource: 'google_ads' }]
  const money = new Map(moneyLedger(projects, jhjEvents, TODAY).map((m) => [m.id, m]))
  const params = { costs: [], leads: [lead('jhj')], projects, today: TODAY }
  const loop = summarizeCampaign(campaign, { ...params, money })
  const plan = summarizeCampaign(campaign, params)
  assert.equal(loop.revenue, 26340)
  assert.equal(Math.round(loop.profit), 11676)
  assert.equal(plan.revenue, 22250)
  const origins = originBreakdown(projects, 2026, money).find((r) => r.key === 'google_ads')!
  assert.deepEqual([origins.revenue, Math.round(origins.profit), origins.won], [26340, 11676, 1])
  assert.equal(originBreakdown(projects, 2026).find((r) => r.key === 'google_ads')!.revenue, 22250)
})

test('Marketing / Finanse: wartość otwartych wycen z pętli (plan + dosprzedaż)', () => {
  const quote = project('q', { status: 'quote', date: '2026-10-05', financials: financials(7840, 1500), leadSource: 'google_ads' })
  const events = [ev('q', 'extra_sale', '2026-10-06', { amountNetto: 160 })]
  const money = new Map(moneyLedger([quote], events, TODAY).map((m) => [m.id, m]))
  assert.equal(summarizePeriod([quote], [], { kind: 'year', year: 2026 }, money).pipelineValue, 8000)
  assert.equal(summarizePeriod([quote], [], { kind: 'year', year: 2026 }).pipelineValue, 7840, 'bez mapy — plan')
  assert.equal(originBreakdown([quote], null, money).find((r) => r.key === 'google_ads')!.pipeline, 8000)
  assert.equal(summarizeCampaign(campaign, { costs: [], leads: [lead('q')], projects: [quote], today: TODAY, money }).pipeline, 8000)
})
