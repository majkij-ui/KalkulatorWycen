import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ClientGroup } from './client-groups'
import { scopeKeys } from './client-groups'
import type { Period } from './finance-calc'
import { DEFAULT_GEAR_SPREAD } from './gear-costs'
import { companyTaxRate, marginSummary, marginTrend, projectIdsInScope, type MarginInput } from './margin-ledger'
import { costsText } from './money-loop-labels'
import { moneyLedger, summarizeMoney, type MoneyEvent, type MoneyProject } from './money-loop'
import type { EquipmentItem, FixedCost, Project, ProjectCost } from './project-types'
import { fixedCostsInYear } from './subscriptions'
import type { Subscription } from './subscription-types'

const TODAY = '2026-10-16'
const YEAR = (year: number): Period => ({ kind: 'year', year })
const MONTH = (year: number, index: number): Period => ({ kind: 'month', year, index })

const financials = (sumaNetto: number, koszty = 0) => {
  const podatek = sumaNetto * 0.085
  const zysk = sumaNetto - podatek - koszty
  return { sumaNetto, koszty, podatek, zysk, marzaPct: 0, computedAt: '' }
}

type P = MoneyProject & Pick<Project, 'client'>
const project = (id: string, extra: Partial<P> = {}): P => ({
  id,
  status: 'done',
  date: '2026-05-10',
  client: 'Klient',
  financials: financials(10_000, 2_000),
  ...extra,
})

let seq = 0
const ev = (projectId: string, kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({
  id: `e${++seq}`,
  kind,
  start,
  projectId,
  data,
})
const cost = (unitCost: number): ProjectCost => ({ id: `c${++seq}`, category: 'ekipa', unitCost }) as ProjectCost
const fixed = (id: string, month: string, amount: number, extra: Partial<FixedCost> = {}): FixedCost => ({
  id,
  month,
  type: 'other',
  label: id,
  amount,
  source: 'manual',
  ...extra,
})
const gear = (id: string, purchasePrice: number, purchaseDate: string, extra: Partial<EquipmentItem> = {}): EquipmentItem => ({
  id,
  name: id,
  category: 'kamery',
  purchasePrice,
  rentalDayRate: 0,
  purchaseDate,
  notes: '',
  ...extra,
})

const near = (actual: number | null | undefined, expected: number, message?: string) =>
  assert.ok(
    actual !== null && actual !== undefined && Math.abs(actual - expected) < 0.01,
    `${message ?? ''} ${actual} ≠ ${expected}`
  )

function input(
  projects: P[],
  extra: Partial<MarginInput> & { events?: MoneyEvent[] } = {}
): MarginInput {
  const { events = [], ...rest } = extra
  return {
    ledger: moneyLedger(projects, events, TODAY),
    fixedCosts: [],
    equipment: [],
    spread: true,
    settings: DEFAULT_GEAR_SPREAD,
    today: TODAY,
    ...rest,
  }
}

const row = (s: ReturnType<typeof marginSummary>, id: string) => s.projects.find((r) => r.money.id === id)!

// ── Warstwa 1 ────────────────────────────────────────────────────────────────

test('projekt z kosztami w Realizacji: warstwa 1 = przychód − koszty z Realizacji, przed podatkiem', () => {
  const s = marginSummary(input([project('a', { costs: [cost(3_000)] })]), YEAR(2026))
  const r = row(s, 'a')
  assert.equal(r.money.costsBasis, 'actual')
  assert.equal(r.margin, 7_000)
  near(r.tax, 850)
  assert.equal(r.known, true)
})

test('projekt bez kosztów w Realizacji: koszty z planu, oznaczone; plan 0 zł to „brak kosztów", nie 0', () => {
  const s = marginSummary(input([project('a'), project('retro', { financials: financials(1_075, 0) })]), YEAR(2026))
  assert.equal(row(s, 'a').money.costsBasis, 'plan')
  assert.equal(row(s, 'a').margin, 8_000)
  const retro = row(s, 'retro')
  assert.equal(retro.margin, 1_075)
  const text = costsText(retro.money)
  assert.equal(text.value, 'brak kosztów')
  assert.equal(text.note, 'w planie 0 zł')
  assert.equal(text.muted, true)
})

test('retro import z samą fakturą i finansami: faktura zastępuje plan, warstwa 1 z planu kosztów', () => {
  const s = marginSummary(
    input([project('tchibo', { financials: financials(1_075, 0) })], {
      events: [ev('tchibo', 'invoice_sent', '2026-09-16', { amountNetto: 1_075 })],
    }),
    YEAR(2026)
  )
  const r = row(s, 'tchibo')
  assert.equal(r.money.revenueBasis, 'invoices')
  assert.equal(r.margin, 1_075)
})

test('projekt bez planu i bez faktur: „brak kwoty" — bez warstwy 1 i bez udziału w kosztach firmy', () => {
  const s = marginSummary(
    input([project('a'), project('nic', { financials: undefined })], { fixedCosts: [fixed('zus', '2026-05', 1_000, { type: 'zus' })] }),
    YEAR(2026)
  )
  const r = row(s, 'nic')
  assert.equal(r.known, false)
  assert.equal(r.margin, 0)
  assert.equal(r.share, 0)
  assert.equal(r.overhead, 0)
  near(row(s, 'a').overhead, 1_000, 'całość na jedyny projekt z przychodem')
})

test('projekt w EUR: liczy się w złotych — plan z kursu wyceny, potem faktura w zł', () => {
  // 1 281 € × 4,3699 = 5 597,84 zł w `financials` (S3); faktura wpisana w zł.
  const plan = marginSummary(input([project('eur', { financials: financials(5_597.84, 1_000) })]), YEAR(2026))
  near(row(plan, 'eur').margin, 4_597.84)
  const invoiced = marginSummary(
    input([project('eur', { financials: financials(5_597.84, 1_000) })], {
      events: [ev('eur', 'invoice_sent', '2026-05-20', { amountNetto: 5_640 })],
    }),
    YEAR(2026)
  )
  near(row(invoiced, 'eur').margin, 4_640)
})

test('sprzedaż dodatkowa: podnosi przychód, warstwę 1 i udział w kosztach firmy', () => {
  const base = [project('a'), project('b')]
  const extra = [ev('a', 'extra_sale', '2026-05-12', { what: 'surówka', amountNetto: 10_000 })]
  const fixedCosts = [fixed('zus', '2026-05', 3_000, { type: 'zus' })]
  const before = marginSummary(input(base, { fixedCosts }), YEAR(2026))
  const after = marginSummary(input(base, { fixedCosts, events: extra }), YEAR(2026))
  assert.equal(row(after, 'a').margin, row(before, 'a').margin + 10_000)
  near(row(before, 'a').share, 0.5)
  near(row(after, 'a').share, 20_000 / 30_000)
})

test('przegrana wycena: nigdzie się nie liczy', () => {
  const s = marginSummary(input([project('a'), project('lost', { status: 'lost' })]), YEAR(2026))
  assert.equal(s.projects.length, 1)
  assert.equal(s.totals.revenue, 10_000)
})

// ── Koszty firmy i warstwa 2 ─────────────────────────────────────────────────

test('zakup 6 000 zł w maju: przełącznik zmienia sprzęt, wynik roku i wynik każdego projektu; wiersze sumują się do wyniku', () => {
  const projects = [project('a'), project('b', { financials: financials(30_000, 10_000) })]
  const equipment = [gear('kamera', 6_000, '2026-05-03')]
  const on = marginSummary(input(projects, { equipment, spread: true }), YEAR(2026))
  const off = marginSummary(input(projects, { equipment, spread: false }), YEAR(2026))
  near(on.company.gear, (6_000 / 36) * 6, 'maj–październik: raty tylko do bieżącego miesiąca')
  assert.equal(off.company.gear, 6_000)
  near((on.totals.result ?? 0) - (off.totals.result ?? 0), 6_000 - (6_000 / 36) * 6)
  for (const s of [on, off]) {
    near(s.projects.reduce((sum, r) => sum + (r.result ?? 0), 0), s.totals.result ?? NaN, 'suma wierszy = wynik')
  }
  near(row(on, 'b').overhead, 0.75 * on.company.overhead)
  assert.ok((row(on, 'b').result ?? 0) > (row(off, 'b').result ?? 0))
})

test('laptop z zaplecza 4 500 zł: koszt firmy w całości w swoim miesiącu, w obu widokach tak samo', () => {
  const equipment = [gear('laptop', 4_500, '2026-03-10', { onSet: false })]
  for (const spread of [true, false]) {
    const s = marginSummary(input([project('a')], { equipment, spread }), MONTH(2026, 3))
    assert.equal(s.company.gear, 4_500)
  }
})

test('subskrypcja roczna: cała kwota w miesiącu płatności, przełącznik sprzętu jej nie dotyka', () => {
  const artlist: Subscription = {
    id: 'artlist',
    name: 'Artlist',
    category: 'software',
    amount: 2_611.51,
    currency: 'PLN',
    cadence: 'yearly',
    startDate: '2026-06-01',
    createdAt: '',
    updatedAt: '',
  } as Subscription
  const fixedCosts = fixedCostsInYear([], [artlist], 2026)
  for (const spread of [true, false]) {
    near(marginSummary(input([], { fixedCosts, spread }), MONTH(2026, 6)).company.fixed, 2_611.51)
    assert.equal(marginSummary(input([], { fixedCosts, spread }), MONTH(2026, 7)).company.fixed, 0)
    near(marginSummary(input([], { fixedCosts, spread }), YEAR(2026)).company.fixed, 2_611.51)
  }
})

test('miesiąc bez projektów: brak wierszy, warstwa 1 = 0, wynik = −koszty firmy', () => {
  const s = marginSummary(
    input([project('a')], { fixedCosts: [fixed('zus', '2026-04', 1_417.14, { type: 'zus' }), fixed('fpd', '2026-04', 455.1, { category: 'office' })] }),
    MONTH(2026, 4)
  )
  assert.equal(s.projects.length, 0)
  assert.equal(s.totals.margin, 0)
  near(s.company.total, 1_872.24)
  near(s.totals.result, -1_872.24)
  assert.equal(s.perProject, false)
})

test('koszty firmy po kategoriach: podatek, ZUS, stałe, marketing, sprzęt (katalog + spoza katalogu)', () => {
  const s = marginSummary(
    input([project('a')], {
      fixedCosts: [
        fixed('zus', '2026-05', 1_000, { type: 'zus' }),
        fixed('soft', '2026-05', 200, { category: 'software' }),
        fixed('wyn', '2026-05', 100),
        fixed('ads', '2026-05', 300, { type: 'marketing' }),
        fixed('sprzet', '2026-05', 88.31, { category: 'gear' }),
      ],
      equipment: [gear('lampa', 1_000, '2026-05-02')],
    }),
    MONTH(2026, 5)
  )
  near(s.company.tax, 850)
  near(s.company.zus, 1_000)
  near(s.company.fixed, 300)
  near(s.company.marketing, 300)
  near(s.company.gear, 1_088.31)
  near(s.company.overhead, 2_688.31)
  near(s.company.total, 3_538.31)
  near(s.totals.result, 8_000 - 3_538.31)
})

test('ręczny „Sprzęt" bez kategorii, powiązany z katalogiem: reszta w „inne", zakup w sprzęcie — nic dwa razy', () => {
  const s = marginSummary(
    input([], {
      fixedCosts: [fixed('sprzet', '2026-09', 970.81, { catalogueItemIds: ['viltrox'] })],
      equipment: [gear('viltrox', 800, '2026-09-14')],
      spread: false,
    }),
    MONTH(2026, 9)
  )
  near(s.company.fixed, 170.81)
  near(s.company.gear, 800)
  near(s.company.overhead, 970.81)
})

test('widok miesiąca / kwartału: warstwa 1 per projekt, warstwa 2 tylko w sumie', () => {
  const s = marginSummary(input([project('a')], { fixedCosts: [fixed('zus', '2026-05', 1_000, { type: 'zus' })] }), {
    kind: 'quarter',
    year: 2026,
    index: 2,
  })
  assert.equal(s.perProject, false)
  assert.equal(row(s, 'a').result, null)
  assert.equal(row(s, 'a').share, null)
  near(s.totals.result, 8_000 - 850 - 1_000)
})

test('bieżący rok i bieżący kwartał są „wstępnie"; zamknięte okresy nie', () => {
  const s = (period: Period) => marginSummary(input([]), period).provisional
  assert.equal(s(YEAR(2026)), true)
  assert.equal(s(YEAR(2025)), false)
  assert.equal(s({ kind: 'quarter', year: 2026, index: 3 }), false)
  assert.equal(s({ kind: 'quarter', year: 2026, index: 4 }), true)
  assert.equal(s(MONTH(2026, 10)), true)
  assert.equal(s(YEAR(2027)), true)
})

test('bieżący rok: koszty firmy tylko do bieżącego miesiąca (raty subskrypcji, rozłożony sprzęt)', () => {
  const zus: Subscription = {
    id: 'zus',
    name: 'ZUS',
    category: 'zus',
    amount: 1_417.14,
    currency: 'PLN',
    cadence: 'monthly',
    startDate: '2026-09-20',
    createdAt: '',
    updatedAt: '',
  } as Subscription
  const s = marginSummary(
    input([project('a')], { fixedCosts: fixedCostsInYear([], [zus], 2026), equipment: [gear('red', 57_000, '2024-04-01')] }),
    YEAR(2026)
  )
  near(s.company.zus, 2 * 1_417.14, 'wrzesień–październik; listopad i grudzień jeszcze nie są kosztem')
  near(s.company.gear, 10 * (57_000 / 36), 'styczeń–październik: 10 rat po 1 583,33')
  assert.equal(s.provisional, true)
})

test('koszty firmy do bieżącego miesiąca: przeszły okres w całości, przyszły okres w całości (planowane koszty), miesiące bez zmian', () => {
  const zus: Subscription = {
    id: 'zus',
    name: 'ZUS',
    category: 'zus',
    amount: 1_000,
    currency: 'PLN',
    cadence: 'monthly',
    startDate: '2025-01-05',
    createdAt: '',
    updatedAt: '',
  } as Subscription
  const make = (year: number) =>
    input([project('a')], {
      fixedCosts: fixedCostsInYear([], [zus], year),
      equipment: [gear('red', 36_000, '2026-01-10')],
    })
  const zusOf = (year: number, period: Period) => marginSummary(make(year), period).company.zus
  // TODAY = 2026-10-16
  assert.equal(zusOf(2026, YEAR(2026)), 10_000, 'rok z dziś: do października włącznie')
  assert.equal(zusOf(2026, { kind: 'quarter', year: 2026, index: 4 }), 1_000, 'IV kwartał: tylko październik')
  assert.equal(zusOf(2026, { kind: 'quarter', year: 2026, index: 3 }), 3_000, 'III kwartał zamknięty: w całości')
  assert.equal(zusOf(2026, { kind: 'half', year: 2026, index: 2 }), 4_000, 'II półrocze: lipiec–październik')
  assert.equal(zusOf(2026, MONTH(2026, 10)), 1_000, 'bieżący miesiąc: bez zmian')
  assert.equal(zusOf(2026, MONTH(2026, 12)), 1_000, 'przyszły miesiąc pokazuje planowany koszt')
  assert.equal(zusOf(2025, YEAR(2025)), 12_000, 'rok przeszły: w całości')
  assert.equal(zusOf(2027, YEAR(2027)), 12_000, 'rok przyszły: w całości, jako plan')
  near(marginSummary(make(2026), YEAR(2026)).company.gear, 1_000 * 10, 'sprzęt tak samo: 10 rat po 1 000')
  near(marginSummary(make(2026), YEAR(2026)).money.fixedCosts.total, 10_000, 'ta sama lista kosztów w pieniądzach okresu')
  // Wykres: miesiące po bieżącym nadal mają swój planowany koszt firmy.
  const trend = marginTrend(make(2026), 2026)
  near(trend[11].companyCosts, 2_000, 'grudzień: ZUS 1 000 + rata sprzętu 1 000, bez podatku (brak przychodu)')
  near(trend[9].companyCosts, 2_000, 'październik tak samo')
})

test('koszty firmy do bieżącego miesiąca: udziały projektów nadal sumują się do kosztów firmy i do wyniku roku', () => {
  const zus: Subscription = {
    id: 'zus',
    name: 'ZUS',
    category: 'zus',
    amount: 1_000,
    currency: 'PLN',
    cadence: 'monthly',
    startDate: '2026-01-05',
    createdAt: '',
    updatedAt: '',
  } as Subscription
  const s = marginSummary(
    input([project('a'), project('b', { financials: financials(30_000, 10_000) })], {
      fixedCosts: fixedCostsInYear([], [zus], 2026),
      equipment: [gear('kamera', 6_000, '2026-05-03')],
    }),
    YEAR(2026)
  )
  near(s.company.overhead, 10_000 + 1_000, 'ZUS do października + 6 rat sprzętu')
  near(s.projects.reduce((total, r) => total + (r.overhead ?? 0), 0), s.company.overhead, 'suma udziałów = koszty firmy')
  near(s.projects.reduce((total, r) => total + (r.result ?? 0), 0), s.totals.result ?? NaN, 'suma wierszy = wynik')
  near(row(s, 'b').overhead, 0.75 * s.company.overhead)
  assert.equal(s.unallocated, 0)
})

test('grupa klientów: wiersze członków, suma ich warstw; udział liczony ze wszystkich projektów', () => {
  const groups: ClientGroup[] = [
    { id: 'cg', name: 'CIONET + DE Group', members: ['cionet', 'de group sp. z o.o.'], createdAt: '', updatedAt: '' },
  ]
  const projects = [
    project('c1', { client: 'CIONET' }),
    project('c2', { client: 'DE Group Sp. z o.o.', financials: financials(20_000, 5_000) }),
    project('x', { client: 'Inny', financials: financials(70_000, 30_000) }),
  ]
  const scope = projectIdsInScope(projects, scopeKeys('grupa:cg', groups))
  assert.deepEqual([...scope!].sort(), ['c1', 'c2'])
  const fixedCosts = [fixed('zus', '2026-05', 10_000, { type: 'zus' })]
  const s = marginSummary(input(projects, { fixedCosts, scope }), YEAR(2026))
  assert.deepEqual(
    s.projects.map((r) => r.money.id).sort(),
    ['c1', 'c2']
  )
  assert.equal(s.scoped!.revenue, 30_000)
  assert.equal(s.scoped!.margin, 8_000 + 15_000)
  near(s.scoped!.overhead, 3_000, '30 % przychodu firmy → 30 % kosztów')
  near(s.scoped!.result, 23_000 - 2_550 - 3_000)
  // Cała firma bez zmian.
  assert.equal(s.totals.revenue, 100_000)
  // Kwartał: grupa ma tylko warstwę 1.
  const q = marginSummary(input(projects, { fixedCosts, scope }), { kind: 'quarter', year: 2026, index: 2 })
  assert.equal(q.scoped!.result, null)
  assert.equal(q.scoped!.margin, 23_000)
})

test('rok bez przychodu: kosztów firmy nie ma na kogo podzielić', () => {
  const s = marginSummary(input([], { equipment: [gear('red', 57_000, '2024-04-01')] }), YEAR(2025))
  near(s.unallocated, 19_000)
  near(s.totals.result, -19_000)
})

test('bez sprzętu z katalogu i z wyłączonym rozkładaniem wynik = dotychczasowy wynik firmy (Finanse bez zmian)', () => {
  const projects = [project('a', { costs: [cost(1_000)] }), project('b', { date: '2026-08-01' })]
  const events = [ev('a', 'invoice_sent', '2026-05-20', { amountNetto: 11_000 })]
  const fixedCosts = [fixed('zus', '2026-05', 1_417.14, { type: 'zus' }), fixed('sprzet', '2026-08', 350, { category: 'gear' })]
  const i = input(projects, { events, fixedCosts, spread: false })
  const old = summarizeMoney(i.ledger, fixedCosts, YEAR(2026))
  const s = marginSummary(i, YEAR(2026))
  near(s.totals.revenue, old.revenue)
  near(s.totals.margin, old.revenue - old.costs)
  near(s.totals.margin - s.company.tax, old.profit, 'zysk z projektów (po podatku) jak dotąd')
  near(s.totals.result, old.netResult)
})

test('wykres: 12 miesięcy, warstwa 1 w zakresie filtra, wynik całej firmy', () => {
  const projects = [project('a'), project('b', { client: 'Inny', date: '2026-07-01' })]
  const trend = marginTrend(input(projects, { scope: new Set(['a']) }), 2026)
  assert.equal(trend.length, 12)
  assert.equal(trend[4].margin, 8_000)
  assert.equal(trend[6].margin, 0, 'b poza filtrem')
  near(trend[6].result, 8_000 - 850)
})

test('domyślny ryczałt z company.json dla projektu bez planu', () => {
  assert.equal(companyTaxRate(null), 8.5)
  assert.equal(companyTaxRate({ defaultTaxRatePercent: 12 }), 12)
  assert.equal(companyTaxRate({ defaultTaxRatePercent: 'x' }), 8.5)
  assert.equal(companyTaxRate({ defaultTaxRatePercent: -3 }), 8.5)
  const ledger = moneyLedger(
    [project('a', { financials: undefined })],
    [ev('a', 'invoice_sent', '2026-05-20', { amountNetto: 1_000 })],
    TODAY,
    12
  )
  near(ledger[0].tax, 120)
  // Projekt z planem trzyma swoją stawkę.
  near(moneyLedger([project('b')], [], TODAY, 12)[0].taxRatePercent, 8.5)
})

test('„Sprzęt spoza katalogu" powiązany z katalogiem: stałe bez zmian, sprzęt = zapłacona kwota', () => {
  const s = marginSummary(
    input([], {
      fixedCosts: [
        fixed('aug', '2026-08', 5_156.73, { category: 'gear', catalogueItemIds: ['rode'] }),
        fixed('soft', '2026-08', 100, { category: 'software' }),
      ],
      equipment: [gear('rode', 800, '2026-08-01', { quantity: 2 })],
      spread: false,
    }),
    MONTH(2026, 8)
  )
  near(s.company.fixed, 100)
  near(s.company.gear, 5_156.73)
})

test('dodatkowa faktura w następnym roku: przychód w tym roku, koszty zostają w roku kotwicy', () => {
  const projects = [project('a', { date: '2026-11-10', costs: [cost(2_000)] })]
  const events = [
    ev('a', 'invoice_sent', '2026-11-20', { amountNetto: 10_000 }),
    ev('a', 'extra_sale', '2027-01-10', { what: 'surówka', amountNetto: 1_000 }),
    ev('a', 'invoice_sent', '2027-01-15', { amountNetto: 1_000 }),
  ]
  const next = marginSummary(input(projects, { events }), YEAR(2027))
  const r = row(next, 'a')
  assert.equal(r.anchored, false)
  assert.equal(r.revenue, 1_000)
  assert.equal(r.costs, 0)
  assert.equal(r.margin, 1_000)
  assert.equal(row(marginSummary(input(projects, { events }), YEAR(2026)), 'a').margin, 8_000)
})

// ── U1: EBBT (plan §17.2) ────────────────────────────────────────────────────

test('U1 EBBT = W1 − ryczałt − ZUS; taki sam w obu widokach sprzętu; EBBT − wynik = sprzęt + stałe + marketing', () => {
  const projects = [project('a'), project('b', { date: '2026-08-01', financials: financials(30_000, 5_000) })]
  const fixedCosts = [
    fixed('zus', '2026-03', 1_600, { type: 'zus', category: 'zus' }),
    fixed('adobe', '2026-04', 300, { category: 'software' }),
    fixed('ads', '2026-05', 700, { type: 'marketing', category: 'marketing' }),
  ]
  const equipment = [gear('komodo', 36_000, '2026-01-15')]
  const spread = marginSummary(input(projects, { fixedCosts, equipment, spread: true }), YEAR(2026))
  const cash = marginSummary(input(projects, { fixedCosts, equipment, spread: false }), YEAR(2026))
  const w1 = 40_000 - 7_000
  const tax = 40_000 * 0.085
  near(spread.totals.ebbt, w1 - tax - 1_600)
  near(cash.totals.ebbt, spread.totals.ebbt!, 'ten sam w obu widokach')
  near(spread.totals.ebbt! - spread.totals.result!, 300 + 700 + spread.company.gear, 'pole do optymalizacji (rozłożony)')
  near(cash.totals.ebbt! - cash.totals.result!, 300 + 700 + 36_000, 'pole do optymalizacji (w całości)')
  assert.ok(spread.company.gear < 36_000, 'rozłożony sprzęt jest mniejszy, a EBBT ten sam')
})

test('U1 EBBT z filtrem klienta: w roku = W1 − podatek − udział w ZUS; poza rokiem — tylko cała firma', () => {
  const projects = [project('a', { client: 'A' }), project('b', { client: 'B', financials: financials(30_000, 5_000) })]
  const fixedCosts = [fixed('zus', '2026-05', 2_000, { type: 'zus', category: 'zus' })]
  const year = marginSummary(input(projects, { fixedCosts, scope: new Set(['a']) }), YEAR(2026))
  near(year.scoped!.ebbt, 10_000 - 2_000 - 850 - 0.25 * 2_000)
  near(row(year, 'a').ebbt, 10_000 - 2_000 - 850 - 0.25 * 2_000)
  near(year.totals.ebbt, 40_000 - 7_000 - 3_400 - 2_000)
  const month = marginSummary(input(projects, { fixedCosts, scope: new Set(['a']) }), MONTH(2026, 5))
  assert.equal(month.scoped!.ebbt, null)
  near(month.totals.ebbt, 40_000 - 7_000 - 3_400 - 2_000)
  assert.equal(row(month, 'a').ebbt, null)
})

test('U1 EBBT roku bez przychodu: −ZUS; projekty bez przychodu nie niosą udziału', () => {
  const s = marginSummary(input([], { fixedCosts: [fixed('zus', '2026-05', 1_000, { type: 'zus', category: 'zus' })] }), YEAR(2026))
  near(s.totals.ebbt, -1_000)
  const zero = marginSummary(
    input([project('a', { financials: financials(0, 500) })], { fixedCosts: [fixed('zus', '2026-05', 1_000, { type: 'zus', category: 'zus' })] }),
    YEAR(2026)
  )
  near(row(zero, 'a').ebbt, -500, 'bez przychodu: W1 − podatek, bez udziału w ZUS')
  near(zero.totals.ebbt, -1_500)
})
