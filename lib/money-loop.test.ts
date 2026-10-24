import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizePeriod, type Period } from './finance-calc'
import {
  DEFAULT_PAYMENT_TERM_DAYS,
  moneyLedger,
  moneyTrend,
  moneyYears,
  openInvoices,
  paymentDays,
  projectMoney,
  summarizeMoney,
  type MoneyEvent,
  type MoneyProject,
} from './money-loop'
import { paymentState } from './payments'
import type { FixedCost, Project, ProjectCost } from './project-types'

const TODAY = '2026-10-11'
const YEAR_2026: Period = { kind: 'year', year: 2026 }
const month = (year: number, index: number): Period => ({ kind: 'month', year, index })

let seq = 0
const ev = (kind: string, start: string, data: Record<string, unknown> = {}, extra: Partial<MoneyEvent> = {}): MoneyEvent => ({
  id: `e${++seq}`,
  kind,
  start,
  projectId: 'p-1',
  data,
  ...extra,
})

/** Plan jak z wyceny: ryczałt 8,5 % od przychodu. */
const financials = (sumaNetto: number, koszty = 0) => {
  const podatek = sumaNetto * 0.085
  const zysk = sumaNetto - podatek - koszty
  return { sumaNetto, koszty, podatek, zysk, marzaPct: sumaNetto ? (zysk / sumaNetto) * 100 : 0, computedAt: '' }
}

const project = (extra: Partial<MoneyProject> = {}): MoneyProject => ({
  id: 'p-1',
  status: 'done',
  date: '2026-09-16',
  financials: financials(10_000, 2_000),
  ...extra,
})

const cost = (unitCost: number, extra: Partial<ProjectCost> = {}): ProjectCost =>
  ({ id: `pc${++seq}`, category: 'ekipa', unitCost, ...extra }) as ProjectCost

const near = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.001, `${message ?? ''} ${actual} ≠ ${expected}`)

// ── Przychód: przypadki z życia ──────────────────────────────────────────────

test('1. jedna faktura równa wycenie: przychód z faktury w jej miesiącu, zapłacona po N dniach', () => {
  const m = projectMoney(
    project({ date: '2026-09-01' }),
    [
      ev('invoice_sent', '2026-09-16', { number: '3/09/2026', amountNetto: 10_000, dueDate: '2026-10-16' }),
      ev('invoice_paid', '2026-10-09', { number: '3/09/2026' }),
    ],
    TODAY
  )
  assert.equal(m.revenueBasis, 'invoices')
  assert.equal(m.revenueNote, null)
  assert.equal(m.revenue, 10_000)
  assert.equal(m.invoiced, 10_000)
  assert.equal(m.anchor, '2026-09-16', 'kotwica = pierwsza faktura, nie data księgowa')
  assert.deepEqual(m.pieces, [{ day: '2026-09-16', amount: 10_000, source: 'invoice', paid: true }])
  assert.equal(m.daysToPaid, 23)
  assert.equal(m.paid, true)
  near(m.tax, 850)
  near(m.profit, 10_000 - 850 - 2_000)
})

test('2. faktura inna niż wycena (zmiana zakresu, rabat): liczy się faktura, gdy projekt zrealizowany', () => {
  const higher = projectMoney(project(), [ev('invoice_sent', '2026-09-16', { amountNetto: 12_000 })], TODAY)
  assert.equal(higher.revenue, 12_000)
  assert.equal(higher.revenueBasis, 'invoices')
  const lower = projectMoney(project(), [ev('invoice_sent', '2026-09-16', { amountNetto: 9_000 })], TODAY)
  assert.equal(lower.revenue, 9_000, 'rabat po zrealizowaniu to fakt, nie zaliczka')
  assert.equal(lower.revenueBasis, 'invoices')
  // Wyższa faktura w realizacji też od razu wygrywa — więcej niż plan to nie zaliczka.
  const wonHigher = projectMoney(project({ status: 'won' }), [ev('invoice_sent', '2026-09-16', { amountNetto: 12_000 })], TODAY)
  assert.equal(wonHigher.revenue, 12_000)
})

test('3. dodatek na tej samej fakturze: oczekiwany = plan + dodatek, faktura go pokrywa', () => {
  const m = projectMoney(
    project(),
    [
      ev('extra_sale', '2026-09-10', { what: 'surówka (materiał źródłowy)', amountNetto: 1_500, number: '3/09' }),
      ev('invoice_sent', '2026-09-16', { number: '3/09', amountNetto: 11_500 }),
    ],
    TODAY
  )
  assert.equal(m.extrasTotal, 1_500)
  assert.equal(m.expected, 11_500)
  assert.equal(m.revenue, 11_500)
  assert.equal(m.revenueBasis, 'invoices')
  assert.deepEqual(
    m.extras.map(({ id: _id, ...x }) => x),
    [{ day: '2026-09-10', what: 'surówka (materiał źródłowy)', amount: 1_500, number: '3/09' }]
  )
  assert.ok(m.extras[0].id, 'U1: id wydarzenia do edycji w Finansach')
})

test('4. dodatek na osobnej, późniejszej fakturze: każda faktura w swoim miesiącu, koszty zostają w kotwicy', () => {
  const ledger = moneyLedger(
    [project({ costs: [cost(2_500)] })],
    [
      ev('invoice_sent', '2026-10-05', { amountNetto: 10_000 }),
      ev('extra_sale', '2027-01-12', { what: 'surówka', amountNetto: 1_500 }),
      ev('invoice_sent', '2027-01-15', { amountNetto: 1_500 }),
    ],
    TODAY
  )
  assert.equal(ledger[0].revenue, 11_500)
  const october = summarizeMoney(ledger, [], month(2026, 10))
  const january = summarizeMoney(ledger, [], month(2027, 1))
  assert.equal(october.revenue, 10_000, 'październik się nie zmienia, gdy w styczniu dochodzi faktura')
  assert.equal(october.costs, 2_500)
  assert.equal(january.revenue, 1_500)
  assert.equal(january.costs, 0, 'koszty nie wędrują za fakturą za dodatek')
  assert.equal(january.projects.length, 1)
  assert.equal(january.projects[0].anchored, false)
  assert.equal(january.coverage.projects, 0, 'pokrycie liczy projekty zakotwiczone w okresie')
  assert.equal(january.plan.revenue, 0, 'plan leży w kotwicy')
  near(october.profit + january.profit, ledger[0].profit!, 'suma miesięcy = wynik projektu')
})

test('5. dodatek uzgodniony, jeszcze bez faktury: w realizacji liczy się plan + dodatek, reszta czeka w kotwicy', () => {
  const events = [
    ev('invoice_sent', '2026-09-16', { amountNetto: 10_000 }),
    ev('extra_sale', '2026-10-01', { what: 'dodatkowa postprodukcja', amountNetto: 2_000 }),
  ]
  const won = projectMoney(project({ status: 'won' }), events, TODAY)
  assert.equal(won.revenue, 12_000)
  assert.equal(won.revenueBasis, 'plan')
  assert.equal(won.revenueNote, 'partial')
  assert.deepEqual(won.pieces, [
    { day: '2026-09-16', amount: 10_000, source: 'invoice', paid: false },
    { day: '2026-09-16', amount: 2_000, source: 'plan', paid: false },
  ])
  // Po oznaczeniu jako Zrealizowany faktury są ostateczne.
  const done = projectMoney(project({ status: 'done' }), events, TODAY)
  assert.equal(done.revenue, 10_000)
  assert.equal(done.revenueBasis, 'invoices')
  assert.equal(done.expected, 12_000, 'różnicę widać jako oczekiwany − faktury')
})

test('6. zaliczka w realizacji: plan do końca, potem faktury', () => {
  const advance = [
    ev('invoice_sent', '2026-09-01', { number: 'ZAL/1', amountNetto: 5_000 }),
    ev('invoice_paid', '2026-09-10', { number: 'ZAL/1' }),
  ]
  const won = projectMoney(project({ status: 'won', date: '2026-05-05' }), advance, TODAY)
  assert.equal(won.revenue, 10_000)
  assert.equal(won.revenueNote, 'partial')
  assert.equal(won.invoiced, 5_000)
  assert.equal(won.anchor, '2026-09-01', 'reszta planu leży w miesiącu pierwszej faktury, nie w dacie księgowej')
  assert.deepEqual(
    won.pieces.map((p) => [p.amount, p.source, p.paid]),
    [
      [5_000, 'invoice', true],
      [5_000, 'plan', false],
    ],
    'zaliczka wpłynęła, reszta jeszcze nie — nawet gdy odhaczenie mówi „zapłacone"'
  )
  assert.equal(won.paid, true)
  const september = summarizeMoney([won], [], month(2026, 9))
  assert.deepEqual([september.paid, september.awaiting], [
    { revenue: 5_000, count: 0 },
    { revenue: 5_000, count: 1 },
  ], 'projekt z częścią niezapłaconą liczy się jako czekający')
  const final = [...advance, ev('invoice_sent', '2026-10-08', { number: 'FV/2', amountNetto: 5_000 })]
  const done = projectMoney(project({ status: 'done', date: '2026-05-05' }), final, TODAY)
  assert.equal(done.revenue, 10_000)
  assert.equal(done.revenueBasis, 'invoices')
  assert.deepEqual(
    done.pieces.map((p) => [p.day, p.amount, p.source]),
    [
      ['2026-09-01', 5_000, 'invoice'],
      ['2026-10-08', 5_000, 'invoice'],
    ]
  )
})

test('7. zapłacone bez faktury (odhaczenie): plan z dopiskiem „brak faktur", w dacie księgowej, wpłynęło', () => {
  const m = projectMoney(project({ date: '2026-05-05' }), [ev('invoice_paid', '2026-07-17', {})], TODAY)
  assert.equal(m.revenue, 10_000)
  assert.equal(m.revenueBasis, 'plan')
  assert.equal(m.revenueNote, 'no_invoices')
  assert.equal(m.invoiced, null, 'brak faktur to nie „0 zł z faktur"')
  assert.equal(m.anchor, '2026-05-05')
  assert.deepEqual(m.pieces, [{ day: '2026-05-05', amount: 10_000, source: 'plan', paid: true }])
})

test('8. faktura bez kwoty: kwota ze sparowanej wpłaty, a bez niej — plan z dopiskiem', () => {
  const fromPayment = projectMoney(
    project(),
    [ev('invoice_sent', '2026-09-16', { number: '9/09' }), ev('invoice_paid', '2026-09-30', { number: '9/09', amount: 10_400 })],
    TODAY
  )
  assert.equal(fromPayment.revenue, 10_400)
  assert.equal(fromPayment.invoicesWithoutAmount, 0)

  const unknown = projectMoney(project(), [ev('invoice_sent', '2026-09-16', { number: '9/09' })], TODAY)
  assert.equal(unknown.revenue, 10_000)
  assert.equal(unknown.revenueBasis, 'plan')
  assert.equal(unknown.revenueNote, 'missing_amount')
  assert.equal(unknown.invoicesWithoutAmount, 1)
  assert.equal(unknown.anchor, '2026-09-16', 'faktura bez kwoty nadal wyznacza miesiąc')

  // Zrealizowany, druga faktura bez kwoty: znane kwoty poniżej planu → plan.
  const mixed = projectMoney(
    project(),
    [ev('invoice_sent', '2026-09-01', { amountNetto: 4_000 }), ev('invoice_sent', '2026-09-20', {})],
    TODAY
  )
  assert.equal(mixed.revenue, 10_000)
  assert.equal(mixed.revenueNote, 'missing_amount')
})

test('9. wpłata z kwotą bez faktury w hubie liczy się jako przychód w dniu wpłaty', () => {
  const m = projectMoney(project({ financials: null }), [ev('invoice_paid', '2026-08-03', { amount: 3_000 })], TODAY)
  assert.equal(m.revenue, 3_000)
  assert.equal(m.revenueBasis, 'invoices')
  assert.deepEqual(m.pieces, [{ day: '2026-08-03', amount: 3_000, source: 'payment', paid: true }])
  assert.equal(m.anchor, '2026-08-03')
})

test('projekt bez planu i bez faktur: przychód nieznany (nie 0), zysk nieznany', () => {
  const m = projectMoney(project({ financials: null }), [], TODAY)
  assert.equal(m.revenue, null)
  assert.equal(m.revenueBasis, 'none')
  assert.equal(m.profit, null)
  assert.equal(m.marginPct, null)
  assert.equal(m.taxRatePercent, 8.5)
  assert.deepEqual(m.pieces, [])
})

test('usunięte faktury, wpłaty i dodatki się nie liczą; dodatek bez kwoty jest na liście, ale nie w sumie', () => {
  const deleted = '2026-10-10T10:00:00Z'
  const m = projectMoney(
    project(),
    [
      ev('invoice_sent', '2026-09-16', { amountNetto: 99_000 }, { deletedAt: deleted }),
      ev('extra_sale', '2026-09-20', { amountNetto: 7_000 }, { deletedAt: deleted }),
      ev('extra_sale', '2026-09-21', { what: 'licencja' }),
      ev('invoice_paid', '2026-09-22', { amount: 50 }, { deletedAt: deleted }),
    ],
    TODAY
  )
  assert.equal(m.revenue, 10_000)
  assert.equal(m.revenueNote, 'no_invoices')
  assert.equal(m.extras.length, 1)
  assert.equal(m.extras[0].amount, null)
  assert.equal(m.extrasTotal, 0)
})

test('wydarzenia innych projektów nie mieszają się', () => {
  const m = projectMoney(project(), [ev('invoice_sent', '2026-09-16', { amountNetto: 1 }, { projectId: 'p-2' })], TODAY)
  assert.equal(m.revenueNote, 'no_invoices')
})

test('faktura zaplanowana (data w przyszłości) to jeszcze plan: wyznacza miesiąc, nie zamyka projektu', () => {
  const gala = projectMoney(
    project({ status: 'won', date: '2026-10-05', financials: financials(7_840, 1_500) }),
    [ev('invoice_sent', '2026-11-20', { amountNetto: 8_000 })],
    TODAY
  )
  assert.equal(gala.invoiced, null, 'nic jeszcze nie wystawiono')
  assert.equal(gala.revenue, 7_840, 'kwota zaplanowanej faktury nie zastępuje planu')
  assert.deepEqual([gala.revenueBasis, gala.revenueNote], ['plan', 'planned'])
  assert.equal(gala.nextPlannedInvoice, '2026-11-20')
  assert.deepEqual(gala.pieces, [{ day: '2026-11-20', amount: 7_840, source: 'plan', paid: false }])

  // Zaliczka wystawiona, faktura końcowa zaplanowana: projekt zrealizowany nadal czeka.
  const done = projectMoney(
    project({ status: 'done' }),
    [ev('invoice_sent', '2026-09-01', { amountNetto: 4_000 }), ev('invoice_sent', '2026-12-01', { amountNetto: 6_000 })],
    TODAY
  )
  assert.deepEqual([done.revenue, done.revenueNote, done.invoiced], [10_000, 'partial', 4_000])
  assert.deepEqual(
    done.pieces.map((p) => [p.day, p.amount, p.source]),
    [
      ['2026-09-01', 4_000, 'invoice'],
      ['2026-12-01', 6_000, 'plan'],
    ],
    'reszta ląduje w miesiącu zaplanowanej faktury'
  )

  // Bez planu: zaplanowana faktura jest planem.
  const noPlan = projectMoney(project({ financials: null }), [ev('invoice_sent', '2026-12-01', { amountNetto: 3_000 })], TODAY)
  assert.deepEqual([noPlan.revenue, noPlan.revenueBasis, noPlan.anchor], [3_000, 'plan', '2026-12-01'])
  // Zaplanowana bez kwoty to nie „faktura bez kwoty".
  assert.equal(projectMoney(project(), [ev('invoice_sent', '2026-12-01')], TODAY).revenueNote, 'planned')
})

// ── Koszty ───────────────────────────────────────────────────────────────────

test('koszty: brak wpisów → plan i „brak kosztów"; w realizacji mniej niż plan → plan; po zrealizowaniu → rzeczywiste', () => {
  const none = projectMoney(project(), [], TODAY)
  assert.equal(none.actualCosts, null, 'brak kosztów to nie 0 zł')
  assert.equal(none.costs, 2_000)
  assert.equal(none.costsBasis, 'plan')
  assert.equal(none.costsNote, 'no_costs')

  const partial = projectMoney(project({ status: 'won', costs: [cost(800)] }), [], TODAY)
  assert.equal(partial.actualCosts, 800)
  assert.equal(partial.costs, 2_000)
  assert.equal(partial.costsNote, 'partial')

  const over = projectMoney(project({ status: 'won', costs: [cost(1_500), cost(900)] }), [], TODAY)
  assert.equal(over.costs, 2_400, 'więcej niż plan liczy się od razu')
  assert.equal(over.costsBasis, 'actual')

  const done = projectMoney(project({ costs: [cost(800), cost(5_000, { deletedAt: '2026-10-01' })] }), [], TODAY)
  assert.equal(done.costs, 800, 'zrealizowany: rzeczywiste, bez usuniętych pozycji')
  assert.equal(done.costCount, 1)
  near(done.profit, 10_000 - 850 - 800)

  const noPlan = projectMoney(project({ financials: null, costs: [cost(300, { quantity: 2 })] }), [], TODAY)
  assert.equal(noPlan.costs, 600)
  assert.equal(noPlan.costsBasis, 'actual')
})

test('ryczałt projektu odtworzony z planu działa też na przychodzie z faktur', () => {
  const twelve = { ...financials(10_000), podatek: 1_200, zysk: 8_800 }
  const m = projectMoney(project({ financials: twelve }), [ev('invoice_sent', '2026-09-16', { amountNetto: 20_000 })], TODAY)
  near(m.taxRatePercent, 12)
  near(m.tax, 2_400)
  near(m.marginPct, 88)
})

test('flaga „zapłacone" to ta sama reguła co odhaczenie na liście projektów', () => {
  const cases: MoneyEvent[][] = [
    [],
    [ev('invoice_paid', '2026-10-01')],
    [ev('invoice_sent', '2026-09-01', { number: 'A' })],
    [ev('invoice_sent', '2026-09-01', { number: 'A' }), ev('invoice_paid', '2026-09-05', { number: 'A' })],
    [ev('invoice_sent', '2026-09-01'), ev('invoice_paid', '2026-09-05'), ev('invoice_sent', '2026-12-01')],
  ]
  cases.forEach((events, i) => {
    assert.equal(projectMoney(project(), events, TODAY).paid, paymentState(events, 'p-1', TODAY).paid, `przypadek ${i}`)
  })
})

// ── Okresy ───────────────────────────────────────────────────────────────────

test('kotwica przenosi projekt z miesiąca wyceny do miesiąca faktury (plan i koszty razem z nim)', () => {
  const ledger = moneyLedger(
    [project({ status: 'won', date: '2026-10-05', financials: financials(7_840, 1_500) })],
    [ev('invoice_sent', '2026-11-20', { amountNetto: 7_840 })],
    '2026-11-25'
  )
  assert.equal(ledger[0].revenueBasis, 'invoices', 'faktura równa planowi jest pełna także w realizacji')
  assert.equal(summarizeMoney(ledger, [], month(2026, 10)).projects.length, 0)
  const november = summarizeMoney(ledger, [], month(2026, 11))
  assert.equal(november.revenue, 7_840)
  assert.equal(november.plan.revenue, 7_840)
  assert.equal(november.costs, 1_500)
})

test('suma okresu: tylko projekty, które się liczą; pokrycie, wpłynęło / czeka, koszty stałe', () => {
  const projects: MoneyProject[] = [
    project({ id: 'a', date: '2026-03-03', financials: financials(1_000) }),
    project({ id: 'b', date: '2026-05-05', financials: financials(80_000, 48_000) }),
    project({ id: 'c', date: '2026-09-16', financials: financials(2_000), costs: [cost(300)] }),
    project({ id: 'q', status: 'quote', date: '2026-09-29', financials: financials(8_200, 1_500) }),
    project({ id: 'l', status: 'lost', date: '2026-07-27', financials: financials(13_000) }),
  ]
  const events = [
    ev('invoice_sent', '2026-03-03', { number: '2/03', amountNetto: 1_000 }, { projectId: 'a' }),
    ev('invoice_paid', '2026-03-16', { number: '2/03' }, { projectId: 'a' }),
    ev('invoice_paid', '2026-07-17', {}, { projectId: 'b' }),
    ev('invoice_sent', '2026-09-16', { number: '3/09', amountNetto: 2_000, dueDate: '2026-10-16' }, { projectId: 'c' }),
    ev('invoice_sent', '2026-09-30', { amountNetto: 13_000 }, { projectId: 'l' }),
  ]
  const fixed = [
    { id: 'f1', month: '2026-03', type: 'zus', amount: 1_600 },
    { id: 'f2', month: '2026-09', type: 'marketing', amount: 777 },
  ] as FixedCost[]
  const s = summarizeMoney(moneyLedger(projects, events, TODAY), fixed, YEAR_2026)
  assert.deepEqual(
    s.projects.map((p) => p.money.id),
    ['a', 'b', 'c']
  )
  assert.equal(s.revenue, 83_000)
  assert.equal(s.invoicedRevenue, 3_000)
  assert.deepEqual(s.coverage, { projects: 3, invoiced: 2, partial: 0, withCosts: 1, noFinancials: 0 })
  assert.equal(s.costs, 48_000 + 300, 'c ma koszty z Realizacji (zrealizowany)')
  near(s.tax, 83_000 * 0.085)
  near(s.profit, 83_000 * 0.915 - 48_300)
  assert.equal(s.plan.revenue, 83_000)
  assert.equal(s.plan.costs, 48_000)
  assert.deepEqual(s.paid, { revenue: 81_000, count: 2 })
  assert.deepEqual(s.awaiting, { revenue: 2_000, count: 1 })
  assert.equal(s.fixedCosts.total, 2_377)
  near(s.netResult, s.profit - 2_377)
  near(s.netMarginPct, (s.netResult / 83_000) * 100)
})

test('gdy faktury równe planowi, a kosztów nie wpisano — liczby jak dotąd (finance-calc)', () => {
  const projects = [
    project({ id: 'a', date: '2026-01-27', financials: financials(2_100.23) }),
    project({ id: 'b', date: '2026-05-05', financials: financials(80_440, 48_480) }),
    project({ id: 'c', date: '2026-07-28', financials: financials(7_810) }),
    project({ id: 'q', status: 'quote', date: '2026-10-05', financials: financials(7_840, 1_500) }),
  ]
  const events = [
    ev('invoice_sent', '2026-01-27', { amountNetto: 2_100.23 }, { projectId: 'a' }),
    ev('invoice_sent', '2026-07-28', { amountNetto: 7_810 }, { projectId: 'c' }),
  ]
  const fixed = [{ id: 'f1', month: '2026-03', type: 'zus', amount: 1_600 }] as FixedCost[]
  const ledger = moneyLedger(projects, events, TODAY)
  for (const period of [YEAR_2026, month(2026, 1), month(2026, 5), month(2026, 7), month(2026, 3)]) {
    const before = summarizePeriod(projects as unknown as Project[], fixed, period)
    const after = summarizeMoney(ledger, fixed, period)
    near(after.revenue, before.revenue, `przychód ${JSON.stringify(period)}`)
    near(after.profit, before.projectProfit, `zysk ${JSON.stringify(period)}`)
    near(after.netResult, before.netResult, `wynik ${JSON.stringify(period)}`)
  }
})

test('trend: dwanaście miesięcy sumuje się do roku; lata z przychodem i kotwic', () => {
  const ledger = moneyLedger(
    [project({ date: '2026-12-20' })],
    [ev('invoice_sent', '2026-12-28', { amountNetto: 6_000 }), ev('invoice_sent', '2027-01-04', { amountNetto: 4_000 })],
    TODAY
  )
  const trend = moneyTrend(ledger, [], 2026)
  assert.equal(trend.length, 12)
  assert.equal(trend[11].revenue, 6_000)
  assert.equal(trend.reduce((s, m) => s + m.revenue, 0), summarizeMoney(ledger, [], YEAR_2026).revenue)
  assert.deepEqual(moneyYears(ledger), [2027, 2026])
})

// ── Faktury po terminie i dni do zapłaty ─────────────────────────────────────

test('po terminie: z terminem z faktury albo przyjętym 30 dni; zaplanowane i opłacone pomijane', () => {
  const projects = [
    project({ id: 'a' }),
    project({ id: 'b', status: 'quote' }),
    project({ id: 'c' }),
  ]
  const events = [
    ev('invoice_sent', '2026-09-16', { number: '3/09', amountNetto: 2_000, dueDate: '2026-10-16' }, { projectId: 'a' }),
    ev('invoice_sent', '2026-08-01', { number: 'X/8' }, { projectId: 'b' }),
    ev('invoice_sent', '2026-07-01', { number: 'P/7', amountNetto: 900 }, { projectId: 'c' }),
    ev('invoice_paid', '2026-07-20', { number: 'P/7' }, { projectId: 'c' }),
    ev('invoice_sent', '2026-10-20', { amountNetto: 1 }, { projectId: 'c' }),
    ev('invoice_sent', '2026-09-01', { number: 'D/9', amountNetto: 500, dueDate: '2026-10-11' }, { projectId: 'c' }),
  ]
  const open = openInvoices(moneyLedger(projects, events, TODAY), TODAY)
  assert.deepEqual(
    open.map((i) => [i.projectId, i.number, i.dueDate, i.dueAssumed, i.daysOverdue, i.amount]),
    [
      ['b', 'X/8', '2026-08-31', true, 41, null],
      ['c', 'D/9', '2026-10-11', false, 0, 500],
      ['a', '3/09', '2026-10-16', false, -5, 2_000],
    ]
  )
  assert.equal(DEFAULT_PAYMENT_TERM_DAYS, 30)
  assert.equal(open[0].daysOpen, 71)
})

test('dni do zapłaty w okresie: mediana, najdłużej, ile po terminie (tylko projekty, które się liczą)', () => {
  const projects = [project({ id: 'a' }), project({ id: 'b' }), project({ id: 'l', status: 'lost' })]
  const events = [
    ev('invoice_sent', '2026-03-03', { number: '1', dueDate: '2026-04-02' }, { projectId: 'a' }),
    ev('invoice_paid', '2026-08-21', { number: '1' }, { projectId: 'a' }),
    ev('invoice_sent', '2026-03-26', { number: '2' }, { projectId: 'b' }),
    ev('invoice_paid', '2026-04-07', { number: '2' }, { projectId: 'b' }),
    ev('invoice_sent', '2026-05-05', { number: '3' }, { projectId: 'b' }),
    ev('invoice_paid', '2026-06-09', { number: '3' }, { projectId: 'b' }),
    ev('invoice_sent', '2026-02-18', { number: '5', dueDate: '2026-03-20' }, { projectId: 'b' }),
    ev('invoice_paid', '2026-03-20', { number: '5' }, { projectId: 'b' }),
    ev('invoice_sent', '2026-03-01', { number: '4' }, { projectId: 'l' }),
    ev('invoice_paid', '2026-03-02', { number: '4' }, { projectId: 'l' }),
  ]
  const ledger = moneyLedger(projects, events, TODAY)
  assert.deepEqual(
    paymentDays(ledger, YEAR_2026),
    { paidCount: 4, medianDays: 32.5, maxDays: 171, lateCount: 2 },
    'wpłata w dniu terminu nie jest spóźniona'
  )
  assert.deepEqual(paymentDays(ledger, month(2026, 3)), { paidCount: 2, medianDays: 91.5, maxDays: 171, lateCount: 1 })
  assert.deepEqual(paymentDays(ledger, month(2026, 12)), { paidCount: 0, medianDays: null, maxDays: null, lateCount: 0 })
  assert.equal(ledger[1].daysToPaid, 30, 'mediana na projekt (12, 30, 35)')
})
