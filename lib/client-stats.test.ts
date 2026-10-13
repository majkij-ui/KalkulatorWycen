import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clientListRows,
  clientOutcomes,
  clientPayments,
  clientRhythm,
  clientSize,
  clientStats,
  clientSummaries,
  describeGap,
  describeSince,
  groupStats,
  listClientRows,
  listClients,
  median,
  monthsBetween,
  totalRevenue,
  type ClientEvent,
} from './client-stats'
import { scopeRevenue } from './clients'
import type { ClientGroup } from './client-groups'
import { moneyLedger } from './money-loop'
import type { Project } from './project-types'

const TODAY = '2026-10-10'

let seq = 0
function project(overrides: Partial<Project> = {}): Project {
  seq += 1
  return {
    id: `p-${seq}`,
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
  }
}

const fin = (sumaNetto: number, zysk = sumaNetto / 2) => ({
  sumaNetto,
  koszty: 0,
  podatek: 0,
  zysk,
  marzaPct: 0,
  computedAt: '',
})

const ev = (kind: string, start: string, projectId: string, extra: Partial<ClientEvent> = {}): ClientEvent => ({
  kind,
  start,
  projectId,
  ...extra,
})

// ── Lista ────────────────────────────────────────────────────────────────────

test('clientSummaries: pisownie to jeden klient; przychód tylko ze zleceń; wraca od 2 zleceń', () => {
  const list = clientSummaries(
    [
      project({ client: 'Tchibo', status: 'done', date: '2026-02-01', financials: fin(10_000) }),
      project({ client: 'tchibo ', status: 'won', date: '2026-06-01', financials: fin(5_000) }),
      project({ client: 'TCHIBO', status: 'quote', date: '2026-09-01', financials: fin(99_000) }),
      project({ client: 'Kino Muza', status: 'done', date: '2026-03-01', financials: fin(4_000) }),
      project({ client: 'Kino Muza', status: 'lost', date: '2026-04-01', financials: fin(8_000) }),
      project({ client: '', status: 'done', financials: fin(1_000) }),
    ],
    TODAY
  )
  const byKey = Object.fromEntries(list.map((c) => [c.key, c]))
  assert.deepEqual(Object.keys(byKey).sort(), ['kino muza', 'tchibo'])
  assert.equal(byKey.tchibo.projectCount, 3)
  assert.equal(byKey.tchibo.jobCount, 2)
  assert.equal(byKey.tchibo.revenue, 15_000)
  assert.equal(byKey.tchibo.lastDate, '2026-09-01')
  assert.equal(byKey.tchibo.repeat, true)
  assert.equal(byKey['kino muza'].revenue, 4_000)
  assert.equal(byKey['kino muza'].jobCount, 1)
  assert.equal(byKey['kino muza'].repeat, false)
})

test('listClients: sortowanie po przychodzie, ostatnim projekcie i liczbie; szukanie bez wielkości liter i polskich znaków', () => {
  const summaries = clientSummaries(
    [
      project({ client: 'Łódź Film', date: '2026-01-10', financials: fin(9_000) }),
      project({ client: 'Ąbc', date: '2026-08-01', financials: fin(1_000) }),
      project({ client: 'Ąbc', date: '2026-07-01', financials: fin(1_000) }),
      project({ client: 'Ąbc', status: 'quote', date: '2026-07-02' }),
      project({ client: 'Zeta', date: '2026-09-01', financials: fin(5_000) }),
    ],
    TODAY
  )
  assert.deepEqual(listClients(summaries, 'przychod').map((c) => c.name), ['Łódź Film', 'Zeta', 'Ąbc'])
  assert.deepEqual(listClients(summaries, 'ostatnio').map((c) => c.name), ['Zeta', 'Ąbc', 'Łódź Film'])
  assert.deepEqual(listClients(summaries, 'liczba').map((c) => c.name), ['Ąbc', 'Łódź Film', 'Zeta'])
  assert.deepEqual(listClients(summaries, 'przychod', '  LODZ ').map((c) => c.name), ['Łódź Film'])
  assert.deepEqual(listClients(summaries, 'przychod', 'abc').map((c) => c.name), ['Ąbc'])
})

// ── Przychód ─────────────────────────────────────────────────────────────────

test('clientStats: przychód łącznie i w latach, udział (także w roku), zysk i marża z financials', () => {
  const projects = [
    project({ client: 'Tchibo', date: '2025-05-01', financials: fin(10_000, 4_000) }),
    project({ client: 'Tchibo', status: 'won', date: '2026-03-01', financials: fin(20_000, 6_000) }),
    project({ client: 'Tchibo', status: 'won', date: '2026-04-01' }), // bez finansów
    project({ client: 'Tchibo', status: 'quote', date: '2026-05-01', financials: fin(50_000) }),
    project({ client: 'Tchibo', status: 'lost', date: '2026-06-01', financials: fin(70_000) }),
    project({ client: 'Inny', date: '2026-02-01', financials: fin(30_000) }),
    // Projekt bez klienta też jest przychodem firmy — liczy się do mianownika udziału.
    project({ client: '', date: '2025-01-01', financials: fin(10_000) }),
  ]
  const s = clientStats(projects, [], 'tchibo', TODAY)!
  assert.equal(s.revenue, 30_000)
  assert.equal(s.sharePct, (30_000 / 70_000) * 100)
  assert.deepEqual(s.years, [
    { year: 2026, revenue: 20_000, jobs: 2, sharePct: 40 },
    { year: 2025, revenue: 10_000, jobs: 1, sharePct: 50 },
  ])
  assert.equal(s.profit, 10_000)
  assert.equal(s.marginPct, (10_000 / 30_000) * 100)
  assert.equal(s.missingFinancials, 1)
  assert.equal(s.repeat, true)
  assert.deepEqual(
    s.projects.map((p) => p.date),
    ['2026-06-01', '2026-05-01', '2026-04-01', '2026-03-01', '2025-05-01']
  )
})

test('clientStats: klient bez zleceń — zero przychodu, brak marży; nieznany klucz = null', () => {
  const projects = [project({ client: 'Nowy', status: 'quote', financials: fin(5_000) })]
  const s = clientStats(projects, [], 'nowy', TODAY)!
  assert.equal(s.revenue, 0)
  assert.equal(s.sharePct, null)
  assert.equal(s.marginPct, null)
  assert.deepEqual(s.years, [])
  assert.equal(s.repeat, false)
  assert.equal(clientStats(projects, [], 'brak', TODAY), null)
  // Jedno zlecenie i wycena to jeszcze nie powracający klient.
  const once = [...projects, project({ client: 'Nowy', status: 'done', financials: fin(2_000) })]
  assert.equal(clientStats(once, [], 'nowy', TODAY)!.repeat, false)
  assert.equal(clientStats(projects, [], '', TODAY), null)
})

test('clientStats: pisownie od najczęstszej, nazwa = najczęstsza', () => {
  const projects = [
    project({ client: 'Tchibo', date: '2026-01-01' }),
    project({ client: ' tchibo', date: '2026-02-01' }),
    project({ client: 'Tchibo', date: '2026-03-01' }),
  ]
  const s = clientStats(projects, [], 'tchibo', TODAY)!
  assert.equal(s.name, 'Tchibo')
  assert.deepEqual(s.spellings, [
    { name: 'Tchibo', count: 2 },
    { name: 'tchibo', count: 1 },
  ])
})

// ── Rytm powrotów ────────────────────────────────────────────────────────────

test('clientRhythm: mediana odstępów między zleceniami; wyceny i nieprzyjęte się nie liczą; ten sam dzień = jeden powrót', () => {
  const r = clientRhythm(
    [
      project({ date: '2026-01-01' }),
      project({ date: '2026-01-01' }),
      project({ date: '2026-01-31' }), // +30
      project({ status: 'lost', date: '2026-02-15' }),
      project({ date: '2026-04-01' }), // +60
      project({ status: 'won', date: '2026-04-11' }), // +10
    ],
    TODAY
  )
  assert.deepEqual(r.jobDates, ['2026-01-01', '2026-01-31', '2026-04-01', '2026-04-11'])
  assert.equal(r.medianGapDays, 30)
  assert.equal(r.lastJobDate, '2026-04-11')
  assert.equal(r.daysSinceLast, 182)
  assert.equal(r.monthsSinceLast, 5)
})

test('clientRhythm: przypomnienie dopiero, gdy przerwa > 1,5 × zwykła i > zwykła + 60 dni', () => {
  // Zwykle co 100 dni → próg max(150, 160) = 160 dni.
  const jobs = (last: string) => [project({ date: '2025-11-01' }), project({ date: '2026-02-09' }), project({ date: last })]
  // 2026-02-09 + 100 dni = 2026-05-20
  const at = (today: string) => clientRhythm(jobs('2026-05-20'), today)
  assert.equal(at('2026-10-27').daysSinceLast, 160)
  assert.equal(at('2026-10-27').nudge, false, 'równo na progu — jeszcze nie')
  assert.equal(at('2026-10-28').nudge, true)
  // Częsty klient (co 10 dni): próg max(15, 70) = 70 dni, nie 15.
  const often = [project({ date: '2026-07-01' }), project({ date: '2026-07-11' })]
  assert.equal(clientRhythm(often, '2026-09-19').nudge, false) // 70 dni
  assert.equal(clientRhythm(often, '2026-09-20').nudge, true)
})

test('clientRhythm: bez przypomnienia przy jednym zleceniu i gdy czeka nowsza wycena; data w przyszłości = 0', () => {
  assert.equal(clientRhythm([project({ date: '2020-01-01' })], TODAY).nudge, false)
  assert.equal(clientRhythm([project({ date: '2020-01-01' })], TODAY).medianGapDays, null)
  const withQuote = [
    project({ date: '2025-01-01' }),
    project({ date: '2025-02-01' }),
    project({ status: 'quote', date: '2026-09-01' }),
  ]
  const r = clientRhythm(withQuote, TODAY)
  assert.equal(r.openQuoteSinceLast, true)
  assert.equal(r.nudge, false)
  assert.equal(clientRhythm(withQuote.slice(0, 2), TODAY).nudge, true)
  const future = clientRhythm([project({ date: '2026-12-01' })], TODAY)
  assert.equal(future.daysSinceLast, 0)
  assert.equal(future.monthsSinceLast, 0)
})

test('monthsBetween: pełne miesiące kalendarzowe', () => {
  assert.equal(monthsBetween('2026-01-15', '2026-03-14'), 1)
  assert.equal(monthsBetween('2026-01-15', '2026-03-15'), 2)
  assert.equal(monthsBetween('2025-12-31', '2026-01-01'), 0)
  assert.equal(monthsBetween('2025-10-10', '2026-10-10'), 12)
})

test('median: nieparzysta i parzysta liczba wartości, pusta lista', () => {
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 10]), 3.5)
  assert.equal(median([]), null)
})

// ── Wielkość ─────────────────────────────────────────────────────────────────

test('clientSize: trend dopiero od 3 zleceń z kwotą, po dacie; wyceny i brak finansów pomijane', () => {
  const few = clientSize([
    project({ date: '2026-01-01', financials: fin(1_000) }),
    project({ date: '2026-02-01', financials: fin(9_000) }),
    project({ status: 'quote', date: '2026-03-01', financials: fin(50_000) }),
    project({ date: '2026-04-01' }),
  ])
  assert.deepEqual(few.points.map((p) => p.value), [1_000, 9_000])
  assert.equal(few.trend, null)
  assert.equal(few.ratio, null)
})

test('clientSize: rośnie / maleje / stabilnie z porównania połówek (środkowe przy nieparzystej liczbie pomijane)', () => {
  const series = (...values: number[]) =>
    values.map((v, i) => project({ date: `2026-0${i + 1}-01`, financials: fin(v) }))
  // Kolejność wejścia nie ma znaczenia — liczy się data.
  const rising = clientSize(series(10_000, 99_000, 12_000).reverse())
  assert.deepEqual(rising.points.map((p) => p.value), [10_000, 99_000, 12_000])
  assert.equal(rising.ratio, 1.2)
  assert.equal(rising.trend, 'rosnie')
  assert.equal(clientSize(series(10_000, 1, 11_900)).trend, 'stabilnie')
  assert.equal(clientSize(series(12_000, 10_000)).trend, null)
  assert.equal(clientSize(series(12_000, 12_000, 10_000, 10_000)).trend, 'maleje') // 10 000 / 12 000 = 1/1,2
  assert.equal(clientSize(series(12_000, 12_000, 10_001, 10_001)).trend, 'stabilnie')
})

// ── Decyzje, źródło, płatności, kontakt ──────────────────────────────────────

test('clientOutcomes: wyceny, przyjęte, nieprzyjęte i skuteczność z rozstrzygniętych', () => {
  const statuses = ['quote', 'won', 'done', 'done', 'lost'] as const
  const o = clientOutcomes(statuses.map((status) => ({ status })))
  assert.deepEqual(o, { total: 5, open: 1, won: 3, lost: 1, winRatePct: 75 })
  assert.equal(clientOutcomes([{ status: 'quote' }]).winRatePct, null)
})

test('pierwsze źródło = leadSource NAJSTARSZEGO projektu, także gdy go nie ma', () => {
  const projects = [
    project({ client: 'A', date: '2026-05-01', leadSource: 'powracajacy' }),
    project({ client: 'A', status: 'lost', date: '2025-03-01', leadSource: 'google_ads', name: 'Pierwszy' }),
  ]
  const s = clientStats(projects, [], 'a', TODAY)!
  assert.deepEqual(s.firstSource, {
    source: 'google_ads',
    projectId: projects[1].id,
    projectName: 'Pierwszy',
    date: '2025-03-01',
  })
  const unknown = clientStats([project({ client: 'B', date: '2025-01-01' }), project({ client: 'B', leadSource: 'polecenie', date: '2026-01-01' })], [], 'b', TODAY)!
  assert.equal(unknown.firstSource.source, '')
})

test('clientPayments: dni do zapłaty z par faktura → wpłata w wątkach klienta', () => {
  const events: ClientEvent[] = [
    ev('invoice_sent', '2026-01-10', 'a1'),
    ev('invoice_paid', '2026-01-24', 'a1'), // 14
    ev('invoice_sent', '2026-03-01', 'a2'),
    ev('invoice_paid', '2026-04-10', 'a2'), // 40
    ev('invoice_sent', '2026-05-01', 'a3'),
    ev('invoice_paid', '2026-05-21', 'a3'), // 20
    ev('invoice_sent', '2026-09-30', 'a4'), // otwarta od 10 dni
    ev('invoice_sent', '2026-11-01', 'a4'), // zaplanowana — nie czeka
    ev('invoice_sent', '2026-02-01', 'x'), // inny klient
    ev('invoice_paid', '2026-02-02', 'x'),
    ev('invoice_paid', '2026-01-11', 'a1', { deletedAt: '2026-01-12' }), // usunięta wpłata
  ]
  const p = clientPayments(['a1', 'a2', 'a3', 'a4'], events, TODAY)
  assert.deepEqual(p, {
    paidCount: 3,
    medianDays: 20,
    averageDays: (14 + 40 + 20) / 3,
    maxDays: 40,
    openCount: 1,
    oldestOpenDays: 10,
  })
  const none = clientPayments(['a9'], events, TODAY)
  assert.equal(none.paidCount, 0)
  assert.equal(none.medianDays, null)
  assert.equal(none.oldestOpenDays, null)
})

test('clientStats: płatności z wydarzeń projektów klienta, kontakt z najnowszego projektu z kontaktem', () => {
  const old = project({ client: 'C', date: '2025-01-01', contact: { name: 'Ola', email: 'ola@c.pl', phone: '' } })
  const recent = project({ client: 'C', date: '2026-01-01', contact: { name: 'Jan', email: 'jan@c.pl', phone: '600' } })
  const newest = project({ client: 'C', date: '2026-06-01' })
  const s = clientStats(
    [old, recent, newest],
    [ev('invoice_sent', '2026-01-02', recent.id), ev('invoice_paid', '2026-01-09', recent.id)],
    'c',
    TODAY
  )!
  assert.equal(s.payments.medianDays, 7)
  assert.equal(s.contact?.projectId, recent.id)
  assert.equal(s.contact?.contact.email, 'jan@c.pl')
})

// ── Zdania ───────────────────────────────────────────────────────────────────

test('describeGap / describeSince: dni, tygodnie, miesiące, lata z odmianą', () => {
  assert.equal(describeGap(1), 'co 1 dzień')
  assert.equal(describeGap(10), 'co 10 dni')
  assert.equal(describeGap(21), 'co ~3 tyg.')
  assert.equal(describeGap(40), 'co ~6 tyg.')
  assert.equal(describeGap(91), 'co ~3 mies.')
  assert.equal(describeGap(365), 'co ~12 mies.')
  assert.equal(describeGap(548), 'co ~1,5 roku')
  assert.equal(describeGap(730), 'co ~2 lata')
  assert.equal(describeGap(1826), 'co ~5 lat')
  assert.equal(describeSince(0), 'w tym miesiącu')
  assert.equal(describeSince(7), '7 mies. temu')
})

// ── Najlepsza wiedza z pętli pieniędzy (S2, glue po T6) ───────────────────────

/** Plan jak z wyceny: ryczałt 8,5 %, koszty z planu. */
const plan = (sumaNetto: number, koszty = 0) => {
  const podatek = sumaNetto * 0.085
  return { sumaNetto, koszty, podatek, zysk: sumaNetto - podatek - koszty, marzaPct: 0, computedAt: '' }
}

let evSeq = 0
const money = (kind: string, start: string, projectId: string, data: Record<string, unknown> = {}) => ({
  id: `m${++evSeq}`,
  kind,
  start,
  projectId,
  data,
})

const ledger = (projects: Project[], events: ReturnType<typeof money>[]) =>
  new Map(moneyLedger(projects, events, TODAY).map((m) => [m.id, m]))

test('pętla: przychód klienta = faktury (gdy pełne), rok po dacie faktury, zysk po kosztach z Realizacji', () => {
  const equal = project({ client: 'Tchibo', date: '2026-02-01', financials: plan(10_000) })
  // Koszty z Realizacji wyższe niż plan (6 000 > 5 000) — liczą się od razu.
  const lower = project({
    client: 'Tchibo',
    date: '2026-03-01',
    financials: plan(20_000, 5_000),
    costs: [{ id: 'c1', category: 'ekipa', unitCost: 6_000 }],
  })
  const extraLater = project({ client: 'Tchibo', date: '2025-11-20', financials: plan(8_000) })
  const advance = project({ client: 'Tchibo', status: 'won', date: '2026-06-01', financials: plan(30_000) })
  const nothing = project({ client: 'Tchibo', status: 'won', date: '2026-07-01' })
  // Bez planu, ale z fakturą — kwota jest (z faktury), więc to nie „brak kwoty".
  const invoicedOnly = project({ client: 'Tchibo', date: '2026-08-01' })
  const other = project({ client: 'Inny', date: '2026-04-01', financials: plan(40_000) })
  const projects = [equal, lower, extraLater, advance, nothing, invoicedOnly, other]
  const events = [
    money('invoice_sent', '2026-08-03', invoicedOnly.id, { amountNetto: 5_000 }),
    // Inny klient też z fakturą innej kwoty niż plan — udział w roku liczy się z najlepszej wiedzy firmy.
    money('invoice_sent', '2026-04-05', other.id, { amountNetto: 44_000 }),
    money('invoice_sent', '2026-02-05', equal.id, { amountNetto: 10_000 }),
    // Rabat po wycenie: zrealizowany, faktura niższa — liczy się faktura.
    money('invoice_sent', '2026-03-10', lower.id, { amountNetto: 18_000 }),
    // Dodatek zafakturowany w następnym roku: oba lata.
    money('invoice_sent', '2025-11-25', extraLater.id, { amountNetto: 8_000 }),
    money('extra_sale', '2026-01-15', extraLater.id, { what: 'surówka', amountNetto: 2_000 }),
    money('invoice_sent', '2026-01-20', extraLater.id, { amountNetto: 2_000 }),
    // Zaliczka w realizacji: plan, aż do Zrealizowanego.
    money('invoice_sent', '2026-06-05', advance.id, { amountNetto: 9_000 }),
  ]
  const m = ledger(projects, events)
  const s = clientStats(projects, [], 'tchibo', TODAY, m)!

  assert.equal(s.revenue, 10_000 + 18_000 + 10_000 + 30_000 + 5_000)
  assert.equal(s.missingFinancials, 1, 'zlecenie bez planu i faktur: brak kwoty, nie 0 zł z planu')
  assert.equal(s.invoicedJobs, 4)
  assert.deepEqual(
    s.years.map((y) => [y.year, y.revenue, y.jobs]),
    [
      [2026, 10_000 + 18_000 + 2_000 + 30_000 + 5_000, 6],
      [2025, 8_000, 1],
    ]
  )
  // Udział w roku liczony z przychodu firmy w tym roku (Inny z faktury: 44 000, nie plan 40 000).
  assert.equal(s.years[0].sharePct, (65_000 / (65_000 + 44_000)) * 100)
  assert.equal(totalRevenue(projects, 2025, m), 8_000)
  // Zysk = najlepsza wiedza: przychód − podatek − koszty (plan, bo brak kosztów w Realizacji).
  const expectedProfit = [equal, lower, extraLater, advance, invoicedOnly].reduce((sum, p) => sum + m.get(p.id)!.profit!, 0)
  assert.equal(s.profit, expectedProfit)
  assert.ok(Math.abs(m.get(lower.id)!.profit! - (18_000 - 18_000 * 0.085 - 6_000)) < 0.001)
  assert.ok(Math.abs(m.get(equal.id)!.profit! - (10_000 - 850)) < 0.001)
  // Słupki wielkości: wartości z najlepszej wiedzy.
  assert.deepEqual(
    s.size.points.map((point) => point.value),
    [10_000, 10_000, 18_000, 30_000, 5_000]
  )
  // Bez faktur wszystko jak dotąd (plan) — ta sama liczba, co bez mapy.
  const planOnly = clientStats(projects, [], 'tchibo', TODAY, ledger(projects, []))!
  const noMap = clientStats(projects, [], 'tchibo', TODAY)!
  assert.equal(planOnly.revenue, noMap.revenue)
  assert.deepEqual(planOnly.years, noMap.years)
})

test('pętla: filtr klienta w Projektach liczy najlepszą wiedzę, rok po kawałkach przychodu', () => {
  const a = project({ client: 'Tchibo', date: '2025-12-15', financials: plan(10_000) })
  const b = project({ client: 'Tchibo', status: 'won', date: '2026-02-01' })
  const m = ledger([a, b], [money('invoice_sent', '2026-01-10', a.id, { amountNetto: 11_000 })])
  assert.deepEqual(scopeRevenue([a, b], ['tchibo'], null, m), { revenue: 11_000, countedProjects: 2 })
  assert.deepEqual(scopeRevenue([a, b], ['tchibo'], 2026, m), { revenue: 11_000, countedProjects: 2 })
  assert.deepEqual(scopeRevenue([a, b], ['tchibo'], 2025, m), { revenue: 0, countedProjects: 0 })
  // Bez pętli — jak dawniej: plan po dacie księgowej.
  assert.deepEqual(scopeRevenue([a, b], ['tchibo'], 2025), { revenue: 10_000, countedProjects: 1 })
})

// ── Grupy klientów (S2) ──────────────────────────────────────────────────────

const GROUP: ClientGroup = {
  id: 'cg-1',
  name: 'CIONET + DE Group',
  members: ['cionet', 'de group sp. z o.o.', 'stara nazwa'],
  createdAt: '',
  updatedAt: '',
}

function groupProjects() {
  return [
    project({ client: 'CIONET', date: '2025-06-01', financials: plan(10_000), leadSource: 'polecenie', name: 'Pierwszy' }),
    project({ client: 'CIONET', status: 'lost', date: '2025-09-01', financials: plan(5_000) }),
    project({ client: 'DE Group Sp. z o.o.', date: '2026-01-10', financials: plan(20_000) }),
    project({
      client: 'DE Group Sp. z o.o.',
      date: '2026-04-10',
      financials: plan(30_000),
      contact: { name: 'Ewa', email: 'ewa@de.pl', phone: '' },
    }),
    project({ client: 'cionet', status: 'quote', date: '2026-09-01', financials: plan(9_000) }),
    project({ client: 'Tchibo', date: '2026-02-01', financials: plan(40_000) }),
  ]
}

test('strona grupy: liczby po wszystkich członkach — przychód, udział, powroty, trend, skuteczność, płatności, kontakt', () => {
  const projects = groupProjects()
  const events: ClientEvent[] = [
    ev('invoice_sent', '2026-01-12', projects[2].id),
    ev('invoice_paid', '2026-02-11', projects[2].id), // 30 dni
    ev('invoice_sent', '2025-06-03', projects[0].id),
    ev('invoice_paid', '2025-06-13', projects[0].id), // 10 dni
  ]
  const s = groupStats(projects, events, GROUP, TODAY)
  assert.equal(s.key, 'grupa:cg-1')
  assert.equal(s.name, 'CIONET + DE Group')
  assert.equal(s.revenue, 60_000)
  assert.equal(s.sharePct, 60)
  assert.deepEqual(s.outcomes, { total: 5, open: 1, won: 3, lost: 1, winRatePct: 75 })
  assert.deepEqual(s.rhythm.jobDates, ['2025-06-01', '2026-01-10', '2026-04-10'])
  assert.equal(s.rhythm.lastJobDate, '2026-04-10')
  assert.equal(s.rhythm.openQuoteSinceLast, true)
  assert.equal(s.size.trend, 'rosnie')
  assert.equal(s.payments.medianDays, 20)
  assert.equal(s.firstSource.projectName, 'Pierwszy')
  assert.equal(s.contact?.contact.name, 'Ewa')
  assert.equal(s.repeat, true)
  assert.deepEqual(
    s.members.map((m) => [m.key, m.name, m.projectCount, m.jobCount, m.revenue, m.empty]),
    [
      ['cionet', 'CIONET', 3, 1, 10_000, false],
      ['de group sp. z o.o.', 'DE Group Sp. z o.o.', 2, 2, 50_000, false],
      ['stara nazwa', 'stara nazwa', 0, 0, 0, true],
    ]
  )
  // Pojedynczy członek dalej ma swoją stronę z własnymi liczbami.
  assert.equal(clientStats(projects, events, 'cionet', TODAY)!.revenue, 10_000)
  // Grupa bez żadnego projektu też ma stronę.
  const empty = groupStats(projects, [], { ...GROUP, members: ['nikt'] }, TODAY)
  assert.equal(empty.revenue, 0)
  assert.deepEqual(empty.projects, [])
})

test('lista Klienci: grupa to jeden wiersz z członkami w środku; szukanie po członku; sortowanie po liczbach grupy', () => {
  const projects = groupProjects()
  const rows = clientListRows(projects, [GROUP, { ...GROUP, id: 'cg-old', deletedAt: 'x' }], TODAY)
  assert.deepEqual(
    rows.map((r) => [r.kind, r.summary.key, r.summary.revenue]),
    [
      ['group', 'grupa:cg-1', 60_000],
      ['client', 'tchibo', 40_000],
    ]
  )
  const group = rows[0]
  assert.equal(group.kind === 'group' && group.members.length, 3)
  assert.equal(group.summary.projectCount, 5)
  assert.equal(group.summary.jobCount, 3)
  assert.equal(group.summary.lastDate, '2026-09-01')
  assert.equal(group.summary.repeat, true)
  assert.deepEqual(listClientRows(rows, 'przychod', 'de grou').map((r) => r.summary.key), ['grupa:cg-1'])
  assert.deepEqual(listClientRows(rows, 'przychod', 'cionet + de').map((r) => r.summary.key), ['grupa:cg-1'])
  assert.deepEqual(listClientRows(rows, 'przychod', 'sp. z o').map((r) => r.summary.key), ['grupa:cg-1'], 'po nazwie członka')
  assert.deepEqual(listClientRows(rows, 'przychod', 'tchi').map((r) => r.summary.key), ['tchibo'])
  assert.deepEqual(listClientRows(rows, 'ostatnio').map((r) => r.summary.key), ['grupa:cg-1', 'tchibo'])
  // Bez grup lista jest taka jak dawniej.
  assert.deepEqual(
    clientListRows(projects, [], TODAY).map((r) => r.summary.key),
    clientSummaries(projects, TODAY).map((c) => c.key)
  )
})
