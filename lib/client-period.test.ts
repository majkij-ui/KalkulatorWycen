import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientListRows, clientPeriodYears, clientSummaries, groupMembers, listClientRows, totalRevenueInPeriod } from './client-stats'
import { profitInPeriod, revenueInPeriod, hasRevenueInPeriod } from './client-period'
import { planMoney, type ClientMoney } from './client-money'
import type { ClientGroup } from './client-groups'
import type { Period } from './finance-calc'
import { moneyLedger, summarizeMoney } from './money-loop'
import type { Project } from './project-types'

const TODAY = '2026-11-14'
const H1: Period = { kind: 'half', year: 2026, index: 1 }
const H2: Period = { kind: 'half', year: 2026, index: 2 }
const YEAR: Period = { kind: 'year', year: 2026 }

let seq = 0
function project(overrides: Partial<Project> = {}): Project {
  seq += 1
  return {
    id: `pp-${seq}`,
    name: `Projekt ${seq}`,
    client: '',
    status: 'done',
    date: '2026-01-01',
    createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}`,
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...overrides,
  } as Project
}

/** Plan jak z wyceny: ryczałt 8,5 %, koszty z planu. */
const plan = (sumaNetto: number, koszty = 0) => {
  const podatek = sumaNetto * 0.085
  return { sumaNetto, koszty, podatek, zysk: sumaNetto - podatek - koszty, marzaPct: 0, computedAt: '' }
}

let evSeq = 0
const invoice = (day: string, projectId: string, amountNetto: number) => ({
  id: `ev${++evSeq}`,
  kind: 'invoice_sent',
  start: day,
  projectId,
  data: { amountNetto },
})

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`)

const byId = (projects: Project[], events: ReturnType<typeof invoice>[]) =>
  new Map(moneyLedger(projects, events, TODAY).map((m) => [m.id, m]))

// Fikcyjny świat: Alfa ma jedno zlecenie z fakturami w H1 i H2, Beta tylko w H2,
// Gamma i Delta tworzą grupę (Gamma w H1, Delta w H2), Epsilon bez klienta w H1.
function world() {
  const alfa = project({ client: 'Alfa Film', date: '2026-02-01', financials: plan(20_000, 4_000) })
  const alfaOld = project({ client: 'Alfa Film', date: '2025-05-01', financials: plan(5_000) })
  const beta = project({ client: 'Beta Studio', status: 'won', date: '2026-09-01', financials: plan(9_000, 1_000) })
  const gamma = project({ client: 'Gamma', date: '2026-03-01', financials: plan(6_000) })
  const delta = project({ client: 'Delta', date: '2026-10-01', financials: plan(3_000) })
  const none = project({ client: '', date: '2026-04-01', financials: plan(2_000, 500) })
  const quote = project({ client: 'Beta Studio', status: 'quote', date: '2026-03-01', financials: plan(50_000) })
  const projects = [alfa, alfaOld, beta, gamma, delta, none, quote]
  const events = [
    invoice('2026-03-10', alfa.id, 12_000),
    invoice('2026-09-10', alfa.id, 8_000),
    invoice('2025-05-20', alfaOld.id, 5_000),
    invoice('2026-09-15', beta.id, 9_000),
    invoice('2026-03-20', gamma.id, 6_000),
    invoice('2026-10-12', delta.id, 3_000),
    invoice('2026-04-10', none.id, 2_000),
  ]
  const group: ClientGroup = { id: 'cg-1', name: 'Grupa GD', members: ['gamma', 'delta'], createdAt: '', updatedAt: '' }
  return { alfa, beta, projects, events, group, money: byId(projects, events) }
}

test('projekt z fakturami w H1 i H2 dzieli przychód i zysk (koszty wg udziału faktur)', () => {
  const { alfa, projects, money } = world()
  const m = money.get(alfa.id)!
  assert.equal(revenueInPeriod(m, H1), 12_000)
  assert.equal(revenueInPeriod(m, H2), 8_000)
  assert.equal(revenueInPeriod(m, null), 20_000)
  near(profitInPeriod(m, H1), 12_000 * 0.915 - 4_000 * 0.6)
  near(profitInPeriod(m, H2), 8_000 * 0.915 - 4_000 * 0.4)
  near(profitInPeriod(m, H1) + profitInPeriod(m, H2), profitInPeriod(m, null))
  near(profitInPeriod(m, null), 20_000 * 0.915 - 4_000)

  const h1 = clientSummaries(projects, TODAY, money, H1).find((c) => c.key === 'alfa film')!
  assert.equal(h1.revenue, 12_000)
  assert.equal(h1.jobCount, 1, 'w okresie liczą się zlecenia z przychodem w okresie')
  near(h1.profit, 12_000 * 0.915 - 2_400)
  // „wraca" zostaje z całej historii (2 zlecenia: 2025 i 2026), choć w H1 jest jedno.
  assert.equal(h1.repeat, true)
})

test('klient bez przychodu w okresie jest ukryty, a wyszukiwanie działa w okresie', () => {
  const { projects, money } = world()
  const keysH1 = clientSummaries(projects, TODAY, money, H1).map((c) => c.key).sort()
  assert.deepEqual(keysH1, ['alfa film', 'gamma'])
  const keysH2 = clientSummaries(projects, TODAY, money, H2).map((c) => c.key).sort()
  assert.deepEqual(keysH2, ['alfa film', 'beta studio', 'delta'])
  // Beta jest w H2, ale w H1 nie ma jej nawet przy szukaniu po nazwie.
  const rows = clientListRows(projects, [], TODAY, money, H1)
  assert.equal(listClientRows(rows, 'przychod', 'beta').length, 0)
  assert.equal(listClientRows(clientListRows(projects, [], TODAY, money, H2), 'przychod', 'beta').length, 1)
})

test('grupa: suma członków w okresie, członkowie bez przychodu znikają', () => {
  const { projects, money, group } = world()
  const h1 = clientListRows(projects, [group], TODAY, money, H1).find((r) => r.kind === 'group')!
  assert.equal(h1.summary.revenue, 6_000)
  assert.deepEqual(h1.kind === 'group' && h1.members.map((m) => m.key), ['gamma'])
  const h2 = clientListRows(projects, [group], TODAY, money, H2).find((r) => r.kind === 'group')!
  assert.equal(h2.summary.revenue, 3_000)
  assert.deepEqual(h2.kind === 'group' && h2.members.map((m) => [m.key, m.revenue]), [['delta', 3_000]])
  const year = clientListRows(projects, [group], TODAY, money, YEAR).find((r) => r.kind === 'group')!
  assert.equal(year.summary.revenue, 9_000)
  near(year.summary.profit, 9_000 * 0.915)
  assert.equal(year.kind === 'group' && year.members.length, 2)
  // Grupa bez przychodu w okresie nie ma wiersza.
  const q2: Period = { kind: 'quarter', year: 2026, index: 2 }
  assert.equal(clientListRows(projects, [group], TODAY, money, q2).some((r) => r.kind === 'group'), false)
  assert.deepEqual(groupMembers(projects, group, TODAY, money, H2).map((m) => m.key), ['delta'])
})

test('Całość = dzisiejsze liczby: przychód i zysk z całej historii, wszystkie członkowie grupy', () => {
  const { projects, money, group } = world()
  const rows = clientListRows(projects, [group], TODAY, money)
  assert.deepEqual(rows, clientListRows(projects, [group], TODAY, money, null))
  const alfa = rows.find((r) => r.summary.key === 'alfa film')!.summary
  assert.equal(alfa.revenue, 25_000)
  assert.equal(alfa.projectCount, 2)
  assert.equal(alfa.jobCount, 2)
  const beta = rows.find((r) => r.summary.key === 'beta studio')!.summary
  assert.equal(beta.projectCount, 2, 'Całość liczy też wyceny w liczbie projektów')
  assert.equal(beta.revenue, 9_000)
  const g = rows.find((r) => r.kind === 'group')!
  assert.equal(g.kind === 'group' && g.members.length, 2)
  // Zysk Całości = przychód − podatek − koszty (bez udziałów).
  near(alfa.profit, 25_000 * 0.915 - 4_000)
  assert.equal(totalRevenueInPeriod(projects, null, money), 25_000 + 9_000 + 6_000 + 3_000 + 2_000)
})

test('sortowanie „Największy zysk" i lista lat', () => {
  const { projects, money } = world()
  const rows = clientListRows(projects, [], TODAY, money, YEAR)
  const sorted = listClientRows(rows, 'zysk').map((r) => r.summary.key)
  // Alfa 2026: 20 000 × 0,915 − 4 000 = 14 300; Beta: 9 000 × 0,915 − 1 000 = 7 235.
  assert.deepEqual(sorted.slice(0, 2), ['alfa film', 'beta studio'])
  const profits = listClientRows(rows, 'zysk').map((r) => r.summary.profit)
  assert.deepEqual(profits, [...profits].sort((a, b) => b - a))
  assert.deepEqual(clientPeriodYears(projects, 2026, money), [2026, 2025])
  assert.deepEqual(clientPeriodYears([], 2026), [2026])
  assert.deepEqual(clientPeriodYears(projects, 2027, money), [2027, 2026, 2025])
})

test('liczba projektów w okresie liczy zlecenia z przychodem w okresie (sort „liczba")', () => {
  const a1 = project({ client: 'Zeta', date: '2026-02-01', financials: plan(1_000) })
  const a2 = project({ client: 'Zeta', date: '2026-08-01', financials: plan(1_000) })
  const b1 = project({ client: 'Eta', date: '2026-02-01', financials: plan(1_000) })
  const b2 = project({ client: 'Eta', date: '2026-02-02', financials: plan(1_000) })
  const rows = clientListRows([a1, a2, b1, b2], [], TODAY, null, H2)
  assert.deepEqual(rows.map((r) => [r.summary.key, r.summary.jobCount]), [['zeta', 1]])
  const h1 = listClientRows(clientListRows([a1, a2, b1, b2], [], TODAY, null, H1), 'liczba')
  assert.deepEqual(h1.map((r) => [r.summary.key, r.summary.jobCount]), [['eta', 2], ['zeta', 1]])
})

test('korekta ujemna odejmuje w swoim okresie; nieznany przychód daje 0', () => {
  const m: ClientMoney = {
    ...planMoney({ date: '2026-02-01', financials: null }),
    revenue: 9_000,
    pieces: [
      { day: '2026-02-01', amount: 10_000, source: 'invoice', paid: true },
      { day: '2026-08-01', amount: -1_000, source: 'invoice', paid: true },
    ],
    costs: 1_000,
    taxRatePercent: 10,
  }
  assert.equal(revenueInPeriod(m, H1), 10_000)
  assert.equal(revenueInPeriod(m, H2), -1_000)
  assert.equal(hasRevenueInPeriod(m, H2), true)
  // Udział kosztów: 10 000 / 9 000 > 1 ucinamy do 1 w H1; w H2 ujemny ucinamy do 0.
  near(profitInPeriod(m, H1), 10_000 - 1_000 - 1_000)
  near(profitInPeriod(m, H2), -1_000 + 100)
  assert.equal(profitInPeriod(planMoney({ date: '2026-02-01', financials: null }), null), 0)
  assert.equal(hasRevenueInPeriod(planMoney({ date: '2026-02-01', financials: null }), H1), false)
})

test('spójność z Finansami: klienci + zlecenia bez klienta = summarizeMoney (przychód i zysk)', () => {
  const { projects, events, money, group } = world()
  const ledger = moneyLedger(projects, events, TODAY)
  const periods: Period[] = [
    YEAR,
    H1,
    H2,
    { kind: 'quarter', year: 2026, index: 1 },
    { kind: 'quarter', year: 2026, index: 3 },
    { kind: 'quarter', year: 2026, index: 4 },
    { kind: 'year', year: 2025 },
  ]
  periods.forEach((period) => {
    const finance = summarizeMoney(ledger, [], period)
    const rows = clientListRows(projects, [group], TODAY, money, period)
    const noClient = projects
      .filter((p) => p.status !== 'quote' && !p.client)
      .map((p) => money.get(p.id)!)
    const revenue = rows.reduce((s, r) => s + r.summary.revenue, 0) + noClient.reduce((s, m) => s + revenueInPeriod(m, period), 0)
    const profit = rows.reduce((s, r) => s + r.summary.profit, 0) + noClient.reduce((s, m) => s + profitInPeriod(m, period), 0)
    near(revenue, finance.revenue)
    near(profit, finance.profit)
    near(totalRevenueInPeriod(projects, period, money), finance.revenue)
  })
})
