import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campaignSchema } from './marketing-types'
import { crewMemberSchema } from './crew-types'
import { clientGroupSchema } from './client-groups'
import { eventSchema } from './event-types'
import type { Period } from './finance-calc'
import { DEFAULT_GEAR_SPREAD } from './gear-costs'
import { marginSummary } from './margin-ledger'
import { moneyLedger } from './money-loop'
import { buildPeriodReport, previousPeriod, reportPeriod, type PeriodReport, type ReportInput } from './period-report'
import { markdownTable, reportFileName, reportToMarkdown } from './period-report-markdown'
import { noteLines, reportSections } from './period-report-sections'
import { equipmentItemSchema, fixedCostSchema, projectSchema } from './project-types'
import { effectiveFixedCosts } from './subscriptions'
import { subscriptionSchema } from './subscription-types'

const TODAY = '2026-10-18'
const Q = (year: number, index: number): Period => ({ kind: 'quarter', year, index })
const MONTH = (year: number, index: number): Period => ({ kind: 'month', year, index })
const YEAR = (year: number): Period => ({ kind: 'year', year })

const financials = (sumaNetto: number, koszty = 0, taxPct = 8.5) => {
  const podatek = (sumaNetto * taxPct) / 100
  return { sumaNetto, koszty, podatek, zysk: sumaNetto - podatek - koszty, marzaPct: 0, computedAt: '' }
}

let seq = 0
const project = (id: string, extra: Record<string, unknown> = {}) =>
  projectSchema.parse({
    id,
    name: `Projekt ${id}`,
    client: `Klient ${id}`,
    status: 'done',
    date: '2026-08-10',
    financials: financials(10_000, 2_000),
    ...extra,
  })

const event = (projectId: string | null, kind: string, start: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  eventSchema.parse({ id: `ev${++seq}`, kind, projectId, start, title: kind, data, ...extra })
const invoice = (projectId: string, start: string, amountNetto?: number, extra: Record<string, unknown> = {}) =>
  event(projectId, 'invoice_sent', start, amountNetto === undefined ? {} : { amountNetto }, extra)
const payment = (projectId: string, start: string, data: Record<string, unknown> = {}) => event(projectId, 'invoice_paid', start, data)

const fixed = (month: string, amount: number, extra: Record<string, unknown> = {}) =>
  fixedCostSchema.parse({ id: `f${++seq}`, month, type: 'other', label: `koszt ${month}`, amount, source: 'manual', ...extra })
const gearItem = (id: string, price: number, date: string, extra: Record<string, unknown> = {}) =>
  equipmentItemSchema.parse({ id, name: id, category: 'kamery', purchasePrice: price, rentalDayRate: 100, purchaseDate: date, notes: '', ...extra })
const crewCost = (personId: string, person: string, unitCost: number, dayId: string) => ({
  id: `c${++seq}`,
  category: 'ekipa',
  person,
  personId,
  role: 'Operator',
  unitCost,
  quantity: 1,
  dayId,
})

function input(extra: Partial<ReportInput> = {}): ReportInput {
  return {
    projects: [],
    events: [],
    fixedCosts: [],
    subscriptions: [],
    equipment: [],
    campaigns: [],
    crew: [],
    groups: [],
    spread: true,
    settings: DEFAULT_GEAR_SPREAD,
    today: TODAY,
    ...extra,
  }
}

const near = (actual: number | null | undefined, expected: number, message = '') =>
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 0.011, `${message} ${actual} ≠ ${expected}`)
const metric = (report: PeriodReport, key: string) => report.metrics.find((m) => m.key === key)!
const sectionText = (report: PeriodReport) =>
  reportSections(report)
    .map((s) => [s.title, ...s.lead, ...s.tables.flatMap((t) => [t.caption ?? '', t.head.join('|'), ...t.rows.map((r) => r.join('|'))]), ...s.after].join('\n'))
    .join('\n')

// Przykładowa firma: dwa zlecenia w III kwartale, jedno w II.
const base = () =>
  input({
    projects: [
      project('q2', { date: '2026-05-10', financials: financials(20_000, 5_000) }),
      project('a', { date: '2026-08-10', financials: financials(10_000, 2_000) }),
      project('b', { date: '2026-09-02', financials: financials(6_000, 0) }),
    ],
    events: [invoice('a', '2026-08-12', 10_000), payment('a', '2026-08-30')],
    fixedCosts: [fixed('2026-05', 1_000, { type: 'zus', category: 'zus' }), fixed('2026-08', 500), fixed('2026-09', 700, { type: 'zus', category: 'zus' })],
  })

// ── Jedno źródło pieniędzy ───────────────────────────────────────────────────

test('liczby raportu = rejestr marży dla tego samego okresu (nic nie jest liczone drugi raz)', () => {
  const data = base()
  const report = buildPeriodReport(data, Q(2026, 3))
  const ledger = moneyLedger(data.projects, data.events, TODAY)
  const s = marginSummary(
    {
      ledger,
      fixedCosts: effectiveFixedCosts(data.fixedCosts, [], '2026-01', '2026-12'),
      equipment: [],
      spread: true,
      settings: DEFAULT_GEAR_SPREAD,
      today: TODAY,
    },
    Q(2026, 3)
  )
  near(metric(report, 'revenue').value, s.totals.revenue)
  near(metric(report, 'directCosts').value, s.totals.costs)
  near(metric(report, 'margin').value, s.totals.margin)
  near(metric(report, 'companyCosts').value, s.company.total)
  near(metric(report, 'result').value, s.totals.result!)
  near(metric(report, 'paid').value, s.money.paid.revenue)
  near(metric(report, 'awaiting').value, s.money.awaiting.revenue)
  assert.equal(report.projects.length, s.projects.length)
  report.projects.forEach((row, i) => {
    near(row.revenue, s.projects[i].revenue)
    near(row.margin, s.projects[i].margin)
  })
  assert.equal(report.provisional, false)
})

test('porównanie: poprzedni kwartał z tego samego rejestru; zmiana = różnica, zmiana % względem poprzedniego', () => {
  const report = buildPeriodReport(base(), Q(2026, 3))
  const revenue = metric(report, 'revenue')
  assert.equal(report.previous.period.label, 'Q2 2026')
  assert.equal(report.previous.hasData, true)
  near(revenue.previous, 20_000)
  near(revenue.change, revenue.value - 20_000)
  near(revenue.changePct, ((revenue.value - 20_000) / 20_000) * 100)
  assert.equal(metric(report, 'projects').unit, 'count')
})

// ── Okresy: krawędzie ────────────────────────────────────────────────────────

test('poprzedni okres przechodzi przez granicę roku (Q1 → Q4, H1 → H2, styczeń → grudzień, rok → rok)', () => {
  assert.deepEqual(previousPeriod(Q(2026, 1)), { kind: 'quarter', year: 2025, index: 4 })
  assert.deepEqual(previousPeriod({ kind: 'half', year: 2026, index: 1 }), { kind: 'half', year: 2025, index: 2 })
  assert.deepEqual(previousPeriod(MONTH(2026, 1)), { kind: 'month', year: 2025, index: 12 })
  assert.deepEqual(previousPeriod(MONTH(2026, 5)), { kind: 'month', year: 2026, index: 4 })
  assert.deepEqual(previousPeriod(YEAR(2026)), { kind: 'year', year: 2025 })
  const p = reportPeriod(MONTH(2026, 2))
  assert.equal(p.from, '2026-02-01')
  assert.equal(p.to, '2026-02-28')
  assert.equal(reportPeriod(Q(2026, 3)).to, '2026-09-30')
  assert.equal(reportPeriod(YEAR(2024)).to, '2024-12-31')
  assert.equal(reportPeriod(MONTH(2024, 2)).to, '2024-02-29')
})

test('miesiąc bez zleceń: pusta lista projektów, W1 = 0, wynik = −koszty firmy; tabele się składają', () => {
  const data = base()
  const report = buildPeriodReport(data, MONTH(2026, 7))
  assert.equal(report.projects.length, 0)
  assert.equal(report.clients.length, 0)
  near(metric(report, 'revenue').value, 0)
  near(metric(report, 'margin').value, 0)
  near(metric(report, 'result').value, -metric(report, 'companyCosts').value)
  const text = sectionText(report)
  assert.match(text, /Brak projektów w okresie/)
  assert.match(reportToMarkdown(report), /## 2\. Projekty/)
  assert.equal(report.previous.period.label, '06.2026')
})

test('okres otwarty: „wstępnie" w tytule, definicjach i uwagach; raty subskrypcji do końca okresu liczą się z planu', () => {
  const sub = subscriptionSchema.parse({
    id: 'sub1',
    name: 'Chmura',
    category: 'software',
    amount: 100,
    currency: 'PLN',
    cadence: 'monthly',
    startDate: '2026-07-05',
  })
  const report = buildPeriodReport(input({ subscriptions: [sub] }), Q(2026, 4))
  assert.equal(report.provisional, true)
  near(report.companyCosts.subscriptionsTotal, 300, 'trzy raty IV kwartału, w tym dwie przyszłe')
  near(report.companyCosts.planned, 200, 'listopad i grudzień to plan')
  assert.ok(report.notes.some((n) => n.code === 'provisional'))
  assert.match(reportToMarkdown(report), /^# Raport okresowy — Q4 2026 \(wstępnie\)/)
  const closed = buildPeriodReport(input({ subscriptions: [sub] }), Q(2026, 3))
  assert.equal(closed.provisional, false)
  assert.ok(!closed.notes.some((n) => n.code === 'provisional'))
  assert.doesNotMatch(reportToMarkdown(closed), /wstępnie\)/)
})

test('poprzedni okres bez projektu i bez zapisanego kosztu stałego = „brak danych"; kolumny porównania puste', () => {
  const data = input({
    projects: [project('a', { date: '2026-02-10' })],
    equipment: [gearItem('kamera', 36_000, '2025-03-01')], // zakup sprzed książek, rozłożony na 2026 i 2025
    events: [invoice('a', '2026-02-12', 10_000)],
  })
  const report = buildPeriodReport(data, YEAR(2026))
  assert.equal(report.previous.hasData, false)
  assert.match(report.previous.reason ?? '', /Brak danych za 2025/)
  report.metrics.forEach((m) => {
    assert.equal(m.previous, null, m.key)
    assert.equal(m.change, null, m.key)
    assert.equal(m.changePct, null, m.key)
  })
  // Sam przeniesiony sprzęt nie jest „danymi": w 2025 raty rozkładania istnieją, a porównania nie ma.
  assert.ok(buildPeriodReport(data, YEAR(2025)).companyCosts.gear > 0, 'w 2025 raty sprzętu istnieją, a porównania z nimi nie ma')
  const row = reportSections(report)[0].tables[0].rows[1]
  assert.deepEqual(row.slice(2), ['—', '—', '—'])
  assert.ok(report.notes.some((n) => n.code === 'no_previous'))
  assert.match(reportToMarkdown(report), /Brak danych za 2025/)
})

test('poprzedni okres z samym kosztem stałym (bez projektu) ma dane', () => {
  const data = input({ fixedCosts: [fixed('2026-06', 50)], projects: [project('a', { date: '2026-08-10' })] })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.equal(report.previous.hasData, true)
  near(metric(report, 'fixed').previous, 50)
})

// ── Widok sprzętu ────────────────────────────────────────────────────────────

test('przełącznik sprzętu: rozłożony i w całości dają różne koszty firmy i W2, W1 bez zmian; raport mówi, którego widoku użył', () => {
  const data = input({
    projects: [project('a', { date: '2026-08-10' })],
    events: [invoice('a', '2026-08-12', 10_000)],
    equipment: [gearItem('kamera', 6_000, '2026-05-10')],
  })
  const spread = buildPeriodReport({ ...data, spread: true }, YEAR(2026))
  const full = buildPeriodReport({ ...data, spread: false }, YEAR(2026))
  assert.equal(spread.view.gear, 'spread')
  assert.equal(full.view.gear, 'full')
  near(spread.gear.total, (6_000 / 36) * 8, 'maj–grudzień 2026 po 166,67')
  near(full.gear.total, 6_000)
  near(metric(spread, 'margin').value, metric(full, 'margin').value)
  assert.notEqual(metric(spread, 'result').value, metric(full, 'result').value)
  // „W drugim widoku wynik = X" jest wynikiem drugiego raportu.
  near(spread.alternativeView.result, metric(full, 'result').value)
  near(full.alternativeView.result, metric(spread, 'result').value)
  assert.equal(spread.alternativeView.gear, 'full')
  assert.match(reportToMarkdown(spread), /Widok sprzętu: rozłożony — zakupy od 5 000 zł/)
  assert.match(reportToMarkdown(full), /Widok sprzętu: w całości/)
  assert.match(sectionText(spread), /W drugim widoku \(sprzęt w całości\) wynik po kosztach firmy = /)
  assert.match(sectionText(full), /W drugim widoku \(sprzęt rozłożony\)/)
  const json = JSON.parse(reportToMarkdown(spread).split('```json\n')[1].split('\n```')[0]) as PeriodReport
  near(json.alternativeView.result, metric(full, 'result').value)
  assert.equal(json.view.gear, 'spread')
})

test('zakupy sprzętu w okresie i sprzęt na planie: odpracował, % ceny, prognoza spłaty tylko do 10 lat', () => {
  const data = input({
    projects: [
      project('a', {
        date: '2026-08-10',
        gearDays: [{ id: 'd1', label: '', date: '2026-08-10', lines: [{ itemId: 'tani', qty: 1 }, { itemId: 'drogi', qty: 1 }] }],
      }),
    ],
    events: [invoice('a', '2026-08-12', 10_000)],
    equipment: [
      gearItem('tani', 1_000, '2026-07-01', { rentalDayRate: 400 }),
      gearItem('drogi', 100_000, '2024-01-01', { rentalDayRate: 100 }),
    ],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.deepEqual(report.gear.purchases.map((p) => p.name), ['tani'])
  const tani = report.gear.onSet.find((u) => u.name === 'tani')!
  const drogi = report.gear.onSet.find((u) => u.name === 'drogi')!
  near(tani.rentValue, 400)
  near(tani.rentValuePct, 40)
  assert.ok(tani.rentPayoffMonth !== null, 'bliska prognoza zostaje')
  assert.equal(drogi.rentPayoffMonth, null, 'dalej niż 10 lat — bez prognozy')
  assert.match(sectionText(report), /powyżej 10 lat/)
})

// ── Grupy klientów ───────────────────────────────────────────────────────────

const GROUP = clientGroupSchema.parse({ id: 'g1', name: 'CIONET + DE Group', members: ['cionet', 'de group sp. z o.o.'], createdAt: '2026-10-16', updatedAt: '' })

test('grupa klientów to jedna pozycja: suma członków, przychód i W1 jak w rejestrze; poza grupą klient osobno', () => {
  const data = input({
    groups: [GROUP],
    projects: [
      project('a', { client: 'CIONET', date: '2026-08-10', financials: financials(8_000, 1_000) }),
      project('b', { client: 'DE Group Sp. z o.o.', date: '2026-08-11', financials: financials(2_000, 0) }),
      project('c', { client: 'Inny', date: '2026-08-12', financials: financials(5_000, 500) }),
    ],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.equal(report.clients.length, 2)
  const group = report.clients.find((c) => c.isGroup)!
  assert.equal(group.name, 'CIONET + DE Group')
  assert.equal(group.projects, 2)
  near(group.revenue, 10_000)
  near(group.margin, 9_000)
  near(group.sharePct, (10_000 / 15_000) * 100)
  assert.deepEqual(group.members.sort(), ['CIONET', 'DE Group Sp. z o.o.'])
  assert.equal(group.result, null, 'W2 per grupa tylko w widoku roku (decyzja A)')
  const alone = report.clients.find((c) => !c.isGroup)!
  assert.equal(alone.name, 'Inny')
  // Wiersze projektów niosą nazwę grupy.
  assert.equal(report.projects.find((p) => p.id === 'a')!.group, 'CIONET + DE Group')
  assert.equal(report.projects.find((p) => p.id === 'c')!.group, null)
  assert.match(sectionText(report), /CIONET \+ DE Group \(grupa: /)
})

test('widok roku: W2 per projekt i per grupa (suma wierszy = wynik firmy); kwartał tylko W1', () => {
  const data = input({
    groups: [GROUP],
    projects: [
      project('a', { client: 'CIONET', date: '2026-02-10', financials: financials(8_000, 1_000) }),
      project('b', { client: 'DE Group Sp. z o.o.', date: '2026-08-11', financials: financials(2_000, 0) }),
      project('c', { client: 'Inny', date: '2026-08-12', financials: financials(5_000, 500) }),
    ],
    fixedCosts: [fixed('2026-03', 3_000, { type: 'zus', category: 'zus' })],
  })
  const year = buildPeriodReport(data, YEAR(2026))
  assert.equal(year.perProject, true)
  const resultSum = year.projects.reduce((total, p) => total + (p.result ?? 0), 0)
  near(resultSum, metric(year, 'result').value, 'suma wyników projektów = wynik firmy')
  const group = year.clients.find((c) => c.isGroup)!
  near(group.result, year.projects.filter((p) => p.group).reduce((total, p) => total + (p.result ?? 0), 0))
  assert.match(sectionText(year), /Wynik \(W2\)/)

  const quarter = buildPeriodReport(data, Q(2026, 3))
  assert.equal(quarter.perProject, false)
  quarter.projects.forEach((p) => assert.equal(p.result, null))
  assert.doesNotMatch(sectionText(quarter), /Wynik \(W2\)/)
  assert.ok(quarter.definitions.some((d) => d.key === 'decisionA'))
  assert.ok(!year.definitions.some((d) => d.key === 'decisionA'))
})

// ── Projekt w EUR ────────────────────────────────────────────────────────────

test('projekt w EUR: w zł po kursie z wyceny, oznaczony kursem w tabeli, w JSON i w uwagach', () => {
  // 1 500 € × 4,3661 = 6 549,15 zł — `financials` jest w złotych (S3).
  const eur = project('eur', {
    date: '2026-08-10',
    financials: financials(6_549.15, 0),
    quote: { data: { currency: 'EUR', exchangeRate: 4.3661 } },
  })
  const report = buildPeriodReport(input({ projects: [eur, project('pln', { date: '2026-08-11' })] }), Q(2026, 3))
  const row = report.projects.find((p) => p.id === 'eur')!
  assert.equal(row.currency, 'EUR')
  assert.equal(row.exchangeRate, 4.3661)
  near(row.revenue, 6_549.15)
  assert.equal(report.projects.find((p) => p.id === 'pln')!.currency, 'PLN')
  assert.equal(report.projects.find((p) => p.id === 'pln')!.exchangeRate, null)
  assert.match(sectionText(report), /Projekt eur \(EUR, kurs 4,3661\)/)
  assert.ok(report.notes.some((n) => n.code === 'eur_jobs' && n.projectIds?.includes('eur')))
  // Faktura w zł zastępuje plan z kursu.
  const invoiced = buildPeriodReport(
    input({ projects: [eur], events: [invoice('eur', '2026-08-20', 6_500)] }),
    Q(2026, 3)
  )
  near(invoiced.projects[0].revenue, 6_500)
  assert.equal(invoiced.projects[0].revenueBasis, 'invoices')
})

// ── Płatności ────────────────────────────────────────────────────────────────

test('płatności: faktury z okresu, otwarte na dzień raportu z oznaczeniem okresu, po terminie, bez kwoty', () => {
  const data = input({
    projects: [project('a', { date: '2026-08-10' }), project('b', { date: '2026-09-02', financials: financials(6_000, 0) }), project('old', { date: '2026-05-10' })],
    events: [
      invoice('a', '2026-08-12', 10_000),
      payment('a', '2026-08-30'),
      invoice('b', '2026-09-02', 6_000, { data: { amountNetto: 6_000, dueDate: '2026-10-20' } }),
      invoice('old', '2026-05-12'), // faktura bez kwoty, z innego kwartału
    ],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.equal(report.payments.issued.length, 2)
  assert.deepEqual(report.payments.issued.map((i) => i.state), ['paid', 'open'])
  assert.equal(report.payments.open.length, 2)
  const old = report.payments.open.find((i) => i.projectId === 'old')!
  assert.equal(old.issuedInPeriod, false)
  assert.equal(old.amount, null)
  assert.equal(old.dueAssumed, true)
  assert.ok(old.daysOverdue > 0)
  const b = report.payments.open.find((i) => i.projectId === 'b')!
  assert.equal(b.issuedInPeriod, true)
  assert.ok(b.daysOverdue < 0, 'termin 20.10 jeszcze nie minął')
  assert.equal(report.payments.openWithoutAmount, 1)
  near(report.payments.openTotal, 6_000)
  assert.equal(report.payments.overdueCount, 1)
  assert.equal(report.payments.paymentDays.paidCount, 1)
  assert.ok(report.notes.some((n) => n.code === 'open_without_amount'))
  const text = sectionText(report)
  assert.match(text, /Nieopłacone faktury na dzień 18\.10\.2026/)
  assert.match(text, /brak kwoty/)
})

// ── Marketing ────────────────────────────────────────────────────────────────

const campaign = (extra: Record<string, unknown> = {}) =>
  campaignSchema.parse({
    id: 'cmp1',
    name: 'Ads',
    platform: 'google_ads',
    startDate: '2026-06-10',
    budgets: [{ from: '2026-06-10', daily: 100 }],
    ...extra,
  })

test('marketing: wydatek i leady z okresu osobno, od startu do dziś osobno; zlecenie z leada dostaje ROAS', () => {
  const data = input({
    campaigns: [campaign({ endDate: '2026-08-31' })],
    projects: [project('won', { date: '2026-08-10', financials: financials(30_000, 0) })],
    events: [
      event('won', 'lead_in', '2026-07-20', { quality: 'very_good', campaignId: 'cmp1' }),
      event(null, 'lead_in', '2026-06-20', { quality: 'good', campaignId: 'cmp1' }),
      event(null, 'lead_in', '2026-07-21', { quality: 'fake', campaignId: 'cmp1' }),
      event(null, 'lead_in', '2026-07-22', { quality: 'good' }), // spoza kampanii
      invoice('won', '2026-08-12', 30_000),
    ],
    fixedCosts: [
      fixed('2026-06', 1_000, { type: 'marketing', category: 'marketing', campaignId: 'cmp1', clicks: 100 }),
      fixed('2026-07', 3_000, { type: 'marketing', category: 'marketing', campaignId: 'cmp1', clicks: 300 }),
      fixed('2026-08', 3_000, { type: 'marketing', category: 'marketing', campaignId: 'cmp1' }),
    ],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  const c = report.marketing.campaigns[0]
  near(c.inPeriod.spend, 6_000, 'lipiec + sierpień')
  assert.equal(c.inPeriod.leads.total, 2, 'lead z czerwca poza okresem')
  assert.equal(c.inPeriod.leads.fake, 1)
  assert.deepEqual(c.inPeriod.jobs, ['Projekt won'])
  near(c.inPeriod.roas, 30_000 / 6_000)
  near(c.inPeriod.costPerJob, 6_000)
  near(c.toDate.spend, 7_000, 'od startu: czerwiec + lipiec + sierpień')
  near(c.toDate.roas, 30_000 / 7_000)
  assert.equal(c.toDate.leads.total, 3)
  assert.equal(report.marketing.outsideLeads.total, 1)
  near(report.marketing.ledgerSpend, 6_000)
  near(report.marketing.campaignSpend, 6_000)
  assert.ok(!report.notes.some((n) => n.code === 'marketing_spend'), 'te same liczby — bez rozbieżności')
  assert.ok(!report.notes.some((n) => n.code === 'marketing_revenue'))
  // Nagłówek tabeli marketingu: najpierw „od startu do dziś".
  const marketing = reportSections(report).find((s) => s.id === 'marketing')!
  assert.match(marketing.tables[0].caption ?? '', /Od startu kampanii do dziś/)
  assert.match(marketing.tables[1].caption ?? '', /W okresie/)
})

test('marketing: szacunek z budżetu i przychód z planu ≠ faktura trafiają do „Do wyjaśnienia", nie są rozstrzygane', () => {
  const data = input({
    campaigns: [campaign()],
    projects: [project('won', { date: '2026-08-10', financials: financials(10_000, 0) })],
    events: [
      event('won', 'lead_in', '2026-08-01', { quality: 'good', campaignId: 'cmp1' }),
      invoice('won', '2026-08-12', 12_000), // faktura wyższa niż plan (dodatek)
    ],
    // Brak odczytu z panelu za lipiec–wrzesień: Marketing liczy budżet, rejestr 0 zł.
    fixedCosts: [],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.ok(report.marketing.campaigns[0].inPeriod.estimatedMonths.length > 0)
  near(report.marketing.ledgerSpend, 0)
  assert.ok(report.marketing.campaignSpend > 0)
  const spend = report.notes.find((n) => n.code === 'marketing_spend')!
  assert.equal(spend.kind, 'disagreement')
  const revenue = report.notes.find((n) => n.code === 'marketing_revenue')!
  assert.equal(revenue.kind, 'disagreement')
  assert.match(revenue.text, /plan 10 000 zł, pętla pieniędzy 12 000 zł/)
  // Raport pokazuje liczbę Marketingu (plan) bez poprawiania jej.
  near(report.marketing.campaigns[0].inPeriod.revenue, 10_000)
  assert.equal(noteLines(report)[0].kind, 'disagreement', 'rozjazdy modułów najpierw')
})

test('kampania bez okna w okresie, ale z odczytem z panelu, nadal się pojawia (wydatek bez emisji)', () => {
  const data = input({
    campaigns: [campaign({ startDate: '2026-04-01', endDate: '2026-06-30' })],
    fixedCosts: [fixed('2026-07', 200, { type: 'marketing', category: 'marketing', campaignId: 'cmp1' })],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.equal(report.marketing.campaigns.length, 1)
  near(report.marketing.campaigns[0].inPeriod.spend, 200)
})

// ── Ekipa: wg zleceń okresu ──────────────────────────────────────────────────

test('ekipa wg zleceń okresu: koszt leży w okresie projektu, nawet gdy dzień pracy jest w kalendarzu później; projekt spoza okresu nie wchodzi', () => {
  const lukasz = crewMemberSchema.parse({ id: 'cm1', name: 'Łukasz' })
  const inPeriod = project('cionet', {
    date: '2026-09-29',
    financials: financials(8_200, 1_500),
    gearDays: [{ id: 'd1', label: '', date: '2026-10-15', lines: [] }],
    costs: [crewCost('cm1', 'Łukasz', 1_500, 'd1')],
  })
  const outside = project('inne', {
    date: '2026-05-10',
    gearDays: [{ id: 'd2', label: '', date: '2026-05-10', lines: [] }],
    costs: [crewCost('cm1', 'Łukasz', 1_000, 'd2')],
  })
  const report = buildPeriodReport(input({ crew: [lukasz], projects: [inPeriod, outside] }), Q(2026, 3))
  assert.equal(report.crew.members.length, 1)
  assert.equal(report.crew.members[0].name, 'Łukasz')
  assert.equal(report.crew.members[0].days, 1)
  near(report.crew.members[0].paid, 1_500)
  assert.equal(report.crew.members[0].jobs[0].project, 'Projekt cionet')
  assert.equal(report.crew.members[0].jobs[0].lastDate, '2026-10-15')
  near(report.crew.paid, 1_500)
  // Rozjazd z kalendarzem jest wypisany, nie rozstrzygany.
  const dates = report.notes.find((n) => n.code === 'crew_dates')!
  assert.equal(dates.kind, 'disagreement')
  assert.match(dates.text, /15\.10\.2026/)
  const coverage = report.notes.find((n) => n.code === 'crew_coverage')!
  assert.match(coverage.text, /1 500 zł z 1 500 zł|1 500 zł z /)
  assert.match(sectionText(report), /Łukasz/)
})

test('ekipa: osoba spoza bazy i brak kosztów ekipy', () => {
  const stranger = project('x', {
    date: '2026-08-10',
    gearDays: [{ id: 'd1', label: '', date: '2026-08-10', lines: [] }],
    costs: [{ id: 'c1', category: 'ekipa', person: 'Nieznany', unitCost: 700, quantity: 1, dayId: 'd1' }],
  })
  const report = buildPeriodReport(input({ projects: [stranger] }), Q(2026, 3))
  assert.deepEqual(report.crew.outside, ['Nieznany'])
  assert.equal(report.crew.members.length, 0)
  assert.ok(report.notes.some((n) => n.code === 'crew_outside'))
  assert.match(sectionText(report), /Brak kosztów ekipy z Realizacji/)
})

// ── Uwagi i luki ─────────────────────────────────────────────────────────────

test('„Do wyjaśnienia": koszty z planu, faktura bez kwoty, zaliczka, brak kwoty, sprzęt bez daty', () => {
  const data = input({
    projects: [
      project('plan', { date: '2026-08-10' }),
      project('bezkwoty', { date: '2026-08-11', financials: null }),
      project('zaliczka', { date: '2026-08-12', status: 'won', financials: financials(10_000, 0) }),
    ],
    events: [invoice('plan', '2026-08-14'), invoice('zaliczka', '2026-08-15', 4_000)],
    equipment: [gearItem('bez-daty', 3_000, '')],
  })
  const report = buildPeriodReport(data, Q(2026, 3))
  const codes = report.notes.map((n) => n.code)
  assert.ok(codes.includes('plan_costs'))
  assert.ok(codes.includes('invoice_without_amount'))
  assert.ok(codes.includes('partial_invoicing'))
  assert.ok(codes.includes('no_amount'))
  assert.ok(codes.includes('gear_undated'))
  assert.equal(report.notes.find((n) => n.code === 'gear_undated')!.kind, 'disagreement')
  const flags = report.projects.find((p) => p.id === 'zaliczka')!.flags
  assert.match(flags.join(' '), /zafakturowano 4 000 zł z 10 000 zł/)
})

// ── Markdown, JSON, PDF ──────────────────────────────────────────────────────

test('Markdown: najpierw definicje i „Do wyjaśnienia", potem sekcje 1–8, na końcu blok JSON równy raportowi', () => {
  const report = buildPeriodReport(base(), Q(2026, 3))
  const md = reportToMarkdown(report)
  const at = (needle: string) => md.indexOf(needle)
  assert.ok(at('## Jak liczone (definicje)') > 0)
  assert.ok(at('## Jak liczone (definicje)') < at('## Do wyjaśnienia'))
  assert.ok(at('## Do wyjaśnienia') < at('## 1. Podsumowanie'))
  const order = ['## 1. ', '## 2. Projekty', '## 3. Klienci', '## 4. Płatności', '## 5. Subskrypcje', '## 6. Marketing', '## 7. Sprzęt', '## 8. Ekipa', '## Dane (JSON)']
  order.reduce((previous, needle) => {
    const index = at(needle)
    assert.ok(index > previous, `${needle} po poprzedniej sekcji`)
    return index
  }, -1)
  const json = md.split('```json\n')[1].split('\n```')[0]
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(report)))
  // Twarde spacje nie trafiają do pliku.
  assert.doesNotMatch(md.slice(0, md.indexOf('## Dane (JSON)')), / /)
})

test('Markdown i ekran biorą te same komórki: każda tabela sekcji jest w pliku dosłownie', () => {
  const report = buildPeriodReport(base(), Q(2026, 3))
  const md = reportToMarkdown(report)
  reportSections(report).forEach((section) =>
    section.tables.forEach((t) => {
      const rendered = markdownTable(t)
      assert.ok(md.includes(rendered), `tabela „${t.caption ?? section.title}" jest w pliku`)
    })
  )
})

test('Markdown: znak | w nazwie projektu nie rozbija tabeli, a blok JSON z ``` dostaje dłuższy płot', () => {
  const report = buildPeriodReport(
    input({ projects: [project('a', { name: 'Film | wersja ```B```', date: '2026-08-10' })] }),
    Q(2026, 3)
  )
  const md = reportToMarkdown(report)
  assert.ok(md.includes('Film \\| wersja'))
  assert.match(md, /\n````json\n/)
  const projectRow = md.split('\n').find((line) => line.includes('Film \\|'))!
  assert.equal(projectRow.replace(/\\\|/g, '').split('|').length, 9, 'siedem kolumn: osiem znaków | w wierszu')
})

test('nazwa pliku: okres, „wstępnie" przy otwartym, bez znaków zakazanych', () => {
  const closed = buildPeriodReport(input(), Q(2026, 3))
  const open = buildPeriodReport(input(), Q(2026, 4))
  assert.equal(reportFileName(closed, 'md'), 'Raport Q3 2026.md')
  assert.equal(reportFileName(open, 'pdf'), 'Raport Q4 2026 (wstępnie).pdf')
})

test('kształt otwarty pod R2: nowy wiersz nagłówka i klucz w `extra` pojawiają się w tabelach i pliku bez zmian w rendererach', () => {
  const report = buildPeriodReport(base(), Q(2026, 3))
  const marginIndex = report.metrics.findIndex((m) => m.key === 'margin')
  const withProducer: PeriodReport = {
    ...report,
    metrics: [
      ...report.metrics.slice(0, marginIndex + 1),
      { key: 'producerMargin', label: 'Marża producencka', unit: 'pln', group: 'layer1', value: 1_234, previous: 1_000, change: 234, changePct: 23.4, emphasis: false, pctOfRevenue: null },
      ...report.metrics.slice(marginIndex + 1),
    ],
    projects: report.projects.map((p) => ({ ...p, extra: { producerMargin: 100 } })),
  }
  const rows = reportSections(withProducer)[0].tables[0].rows
  assert.equal(rows[marginIndex + 1][0], 'Marża producencka')
  assert.match(reportToMarkdown(withProducer), /\| Marża producencka \| 1 234 zł \| 1 000 zł \| \+234 zł \| \+23% \|/)
  assert.equal(JSON.parse(reportToMarkdown(withProducer).split('```json\n')[1].split('\n```')[0]).projects[0].extra.producerMargin, 100)
})

// ── Odporność ────────────────────────────────────────────────────────────────

test('usunięte projekty i wydarzenia nie wchodzą do raportu; wejście nie jest zmieniane', () => {
  const data = base()
  data.projects.push(project('gone', { date: '2026-08-15', deletedAt: '2026-09-01T00:00:00Z' }))
  data.events.push(invoice('gone', '2026-08-16', 999_999, { deletedAt: '2026-09-01T00:00:00Z' }))
  const before = JSON.stringify(data)
  const report = buildPeriodReport(data, Q(2026, 3))
  assert.ok(!report.projects.some((p) => p.id === 'gone'))
  assert.ok(metric(report, 'revenue').value < 100_000)
  assert.equal(JSON.stringify(data), before, 'wejście bez zmian')
})

test('pusty hub: raport się buduje, tabele są puste, nic nie rzuca', () => {
  const report = buildPeriodReport(input(), YEAR(2026))
  assert.equal(report.projects.length, 0)
  assert.equal(report.previous.hasData, false)
  assert.doesNotThrow(() => reportToMarkdown(report))
  reportSections(report).forEach((s) => assert.ok(s.title))
})
