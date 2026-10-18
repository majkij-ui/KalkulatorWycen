/**
 * R2 — pieniądze projektu: zatwierdzona cena z PDF, kwota przelewu, moja
 * praca i marża producencka (plan §13.1 C1, C4, D1, D2; decyzje 13.2a).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GEAR_SPREAD } from './gear-costs'
import { marginSummary, type MarginInput } from './margin-ledger'
import { moneyLedger, projectMoney, type MoneyEvent, type MoneyProject } from './money-loop'
import { countedCosts, totalActualCosts, totalOwnWork, actualCostsByCategory } from './project-costs'
import { createQuoteCrewLine, refreshCrewLines, staleCrewLines, withCrewPerson, kitCrewDayCosts } from './quote-crew'
import { approvedPrice, computeSnapshotFinancials, mergeQuoteDataPartial, resolveSnapshot } from './quote-financials'
import { createDefaultShootingDay, type QuoteCrewLine, type QuoteData } from './quote-types'
import { projectSchema, type Project, type ProjectCost, type ProjectFinancials } from './project-types'
import { planFromQuote } from './realization-plan'
import { computeCrewStats } from './crew-stats'
import type { CrewMember } from './crew-types'

const NOW = new Date('2026-10-18T12:00:00.000Z')
const TODAY = '2026-10-18'

const ROLE = { id: 'rezOp', name: 'ReżOp', group: 'ekipa', clientRate: 1500, costRate: 1500 }
const ME = { id: 'cm-ja', name: 'Michał', self: true as const, rate: 1500, roleRates: [] }
const KAMIL = { id: 'cm-kamil', name: 'Kamil', rate: 1200, roleRates: [] }

/** Szczegółowa wycena z jednym dniem i podanymi pozycjami ekipy. */
function quoteWith(crew: QuoteCrewLine[], extra: Partial<QuoteData> = {}): { data: Partial<QuoteData>; marginMultiplier: number } {
  const day = { ...createDefaultShootingDay(), id: 'day-1', crew }
  return { data: { isDetailedProdukcja: true, detailedShootingDays: [day], dniDokumentacji: 0, ...extra }, marginMultiplier: 1 }
}

const pdf = (rows: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  currency: 'PLN',
  exchangeRate: 4.3,
  rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { cenaNetto: v, opis: '' }])),
  ...extra,
})

// ── C1: zatwierdzona cena ────────────────────────────────────────────────────

test('C1: szkic PDF wygrywa z kalkulatorem; bez szkicu — kalkulator; źródło zapisane w finansach', () => {
  const quote = quoteWith([createQuoteCrewLine(ROLE, KAMIL)])
  const calc = computeSnapshotFinancials(quote, NOW)!
  assert.equal(calc.revenueSource, 'calculator')
  assert.equal(calc.sumaNetto, 1200, 'Kamil po 1 200 w obu kwotach')

  const withPdf = computeSnapshotFinancials({ ...quote, pdfDraft: pdf({ ekipa: 1000, sprzet: 600 }) }, NOW)!
  assert.equal(withPdf.revenueSource, 'pdf')
  assert.equal(withPdf.sumaNetto, 1600, 'suma PDF, nie kalkulator')
  assert.equal(withPdf.koszty, calc.koszty, 'koszty zawsze z kalkulatora')
  assert.equal(withPdf.podatek, 1600 * 0.085)

  const d = mergeQuoteDataPartial(quote.data)
  const r = resolveSnapshot(quote)!
  const a = approvedPrice(d, r.pricing, 1, pdf({ ekipa: 1000, sprzet: 600 }))
  assert.deepEqual([a.source, a.pln, a.calculatorPln, a.currency, a.rate], ['pdf', 1600, 1200, 'PLN', null])
})

test('C1: kwota przelewu wpisana ręcznie wygrywa z PDF (S-AI 80 440 przy PDF 67 800)', () => {
  const quote = { ...quoteWith([], { profitTransferAmount: 80440 }), pdfDraft: pdf({ ekipa: 43500, postprodukcja: 24300 }) }
  const f = computeSnapshotFinancials(quote, NOW)!
  assert.equal(f.sumaNetto, 80440)
  assert.equal(f.revenueSource, 'transfer')
})

test('C1: EUR — PDF w euro × kurs zamrożony w wycenie; stary szkic EUR do wyceny w zł — × kurs szkicu', () => {
  const eur = quoteWith([], { currency: 'EUR', exchangeRate: 4.3661 })
  const f = computeSnapshotFinancials({ ...eur, pdfDraft: pdf({ ekipa: 1460 }, { currency: 'EUR', exchangeRate: 4.3699 }) }, NOW)!
  assert.equal(f.sumaNetto, 1460 * 4.3661, 'Tchibo Event: 1 460 € × 4,3661 = 6 374,51 zł')
  const legacy = quoteWith([createQuoteCrewLine(ROLE, KAMIL)])
  const g = computeSnapshotFinancials({ ...legacy, pdfDraft: pdf({ ekipa: 300 }, { currency: 'EUR', exchangeRate: 4.25 }) }, NOW)!
  assert.equal(g.sumaNetto, 300 * 4.25)
})

test('C1: szkic bez wierszy (uszkodzony) liczy się jak brak szkicu', () => {
  const quote = quoteWith([createQuoteCrewLine(ROLE, KAMIL)])
  assert.equal(computeSnapshotFinancials({ ...quote, pdfDraft: { rows: null } }, NOW)!.revenueSource, 'calculator')
  assert.equal(computeSnapshotFinancials({ ...quote, pdfDraft: 'x' }, NOW)!.sumaNetto, 1200)
})

// ── D1: „Ja" w wycenie ───────────────────────────────────────────────────────

test('D1: pozycja „Ja" w wycenie to moja praca — poza kosztami planu, w `ownWork`', () => {
  const line = createQuoteCrewLine(ROLE, ME)
  assert.equal(line.ownWork, true)
  const quote = quoteWith([line, createQuoteCrewLine(ROLE, KAMIL)])
  const f = computeSnapshotFinancials(quote, NOW)!
  assert.equal(f.koszty, 1200, 'tylko Kamil jest kosztem')
  assert.equal(f.ownWork, 1500)
  assert.equal(f.zysk, f.sumaNetto - f.podatek - 1200)
  const plan = planFromQuote(quote)!
  assert.equal(plan.ownWork, 1500)
  assert.deepEqual([...plan.byCategory!.entries()], [['ekipa', 1200]], 'podział kosztów bez mojej pracy')
})

test('D1: plan bez „Ja" — finanse jak przed R2 (bez `ownWork`)', () => {
  const f = computeSnapshotFinancials(quoteWith([createQuoteCrewLine(ROLE, KAMIL)]), NOW)!
  assert.equal(f.ownWork, undefined)
  assert.equal(f.koszty, 1200)
})

test('D1: zmiana osoby z „Ja" na kogoś innego zdejmuje „Moja praca"; z miejsca na „Ja" — zakłada', () => {
  const mine = createQuoteCrewLine(ROLE, ME)
  assert.equal(withCrewPerson(mine, KAMIL, ROLE).ownWork, undefined)
  assert.equal(withCrewPerson(mine, null, ROLE).ownWork, undefined)
  assert.equal(withCrewPerson(createQuoteCrewLine(ROLE, null), ME, ROLE).ownWork, true)
})

test('D1: pozycja „Ja" sprzed R2 (bez znacznika) — „zaktualizuj stawki" ją zgłasza i oznacza', () => {
  const old: QuoteCrewLine = { ...createQuoteCrewLine(ROLE, ME) }
  delete old.ownWork
  const people = [{ ...ME, deletedAt: undefined }]
  assert.equal(staleCrewLines([{ crew: [old] }], [ROLE], people), 1)
  assert.equal(refreshCrewLines([old], [ROLE], people)![0].ownWork, true)
  const moved = { ...ME, self: undefined }
  assert.equal(refreshCrewLines([createQuoteCrewLine(ROLE, ME)], [ROLE], [moved])![0].ownWork, undefined, '„To ja" przeniesione')
})

test('D1: ekipa z zestawu w Realizacji — wiersz „Ja" od razu „Moja praca"', () => {
  const rows = kitCrewDayCosts([{ roleId: 'rezOp', personId: 'cm-ja', qty: 1 }], 'd1', [], [ROLE], [ME as unknown as CrewMember])
  assert.equal(rows[0].ownWork, true)
})

// ── Wiersze Realizacji: zaznaczenie i „Moja praca" ───────────────────────────

const cost = (unitCost: number, extra: Partial<ProjectCost> = {}): ProjectCost =>
  ({ id: `c${unitCost}${Object.keys(extra).join('')}`, category: 'ekipa', unitCost, ...extra }) as ProjectCost

test('Realizacja: odznaczony wiersz nie liczy się nigdzie; „Moja praca" to nie koszt', () => {
  const costs = [cost(1200), cost(1500, { ownWork: true }), cost(800, { skipped: true }), cost(300, { category: 'dojazd' })]
  assert.equal(totalActualCosts(costs), 1500)
  assert.equal(totalOwnWork(costs), 1500)
  assert.equal(countedCosts(costs).length, 3)
  assert.deepEqual([...actualCostsByCategory(costs).entries()], [['ekipa', 1200], ['dojazd', 300]])
  assert.equal(totalOwnWork([cost(1500, { ownWork: true, skipped: true })]), 0, 'odznaczona moja praca też się nie liczy')
})

test('schemat: nowe pola wiersza i projektu są opcjonalne, śmieci znikają bez psucia rekordu', () => {
  const p = projectSchema.parse({
    id: 'p',
    date: '2026-10-01',
    costsFromQuoteAt: '2026-10-18T10:00:00Z',
    costs: [{ id: 'c', category: 'ekipa', unitCost: 1, planKey: 'pro:d:rezOp', skipped: true, ownWork: true, edited: true }, { id: 'd', category: 'x', unitCost: 1, skipped: 'tak', planKey: '' }],
    financials: { sumaNetto: 1, koszty: 0, podatek: 0, zysk: 1, marzaPct: 100, computedAt: '', ownWork: 5, revenueSource: 'pdf' },
  })
  assert.equal(p.costsFromQuoteAt, '2026-10-18T10:00:00Z')
  assert.deepEqual([p.costs![0].planKey, p.costs![0].skipped, p.costs![0].ownWork, p.costs![0].edited], ['pro:d:rezOp', true, true, true])
  assert.deepEqual([p.costs![1].skipped, p.costs![1].planKey], [undefined, undefined])
  assert.deepEqual([p.financials!.ownWork, p.financials!.revenueSource], [5, 'pdf'])
  const bad = projectSchema.parse({ id: 'p', date: '2026-10-01', financials: { sumaNetto: 1, revenueSource: 'cos', ownWork: -3 } })
  assert.deepEqual([bad.financials!.revenueSource, bad.financials!.ownWork, bad.financials!.sumaNetto], [undefined, undefined, 1])
})

// ── Pętla pieniędzy ──────────────────────────────────────────────────────────

let seq = 0
const ev = (kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({
  id: `e${++seq}`,
  kind,
  start,
  projectId: 'p-1',
  data,
})
const fin = (sumaNetto: number, koszty: number, extra: Partial<ProjectFinancials> = {}): ProjectFinancials => {
  const podatek = sumaNetto * 0.085
  return { sumaNetto, koszty, podatek, zysk: sumaNetto - podatek - koszty, marzaPct: 0, computedAt: '', ...extra }
}
const project = (extra: Partial<MoneyProject> = {}): MoneyProject => ({
  id: 'p-1',
  status: 'done',
  date: '2026-09-16',
  financials: fin(10_000, 2_000),
  ...extra,
})
const near = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.001, `${message ?? ''} ${actual} ≠ ${expected}`)

test('C1: dosprzedaż dolicza się do zatwierdzonej ceny; kwota przelewu wpisana ręcznie już ją zawiera', () => {
  const extra = ev('extra_sale', '2026-09-20', { what: 'surówka', amountNetto: 1_000 })
  near(projectMoney(project({ financials: fin(10_000, 0, { revenueSource: 'pdf' }) }), [extra], TODAY).expected, 11_000)
  near(projectMoney(project({ financials: fin(10_000, 0) }), [extra], TODAY).expected, 11_000, 'plan sprzed R2 — jak dotąd')
  near(projectMoney(project({ financials: fin(12_000, 0, { revenueSource: 'transfer' }) }), [extra], TODAY).expected, 12_000)
  // Finanse zapisane przed R2 (bez `revenueSource`): kwotę wpisaną ręcznie zna wycena.
  const legacyTyped = project({ financials: fin(12_000, 0), quote: { data: { profitTransferAmount: 12_000 } } as Project['quote'] })
  near(projectMoney(legacyTyped, [extra], TODAY).expected, 12_000)
  const legacyUntyped = project({ financials: fin(10_000, 0), quote: { data: { profitTransferAmount: null } } as Project['quote'] })
  near(projectMoney(legacyUntyped, [extra], TODAY).expected, 11_000)
})

test('C1: faktury wygrywają także z kwotą wpisaną ręcznie', () => {
  const m = projectMoney(project({ financials: fin(12_000, 0, { revenueSource: 'transfer' }) }), [ev('invoice_sent', '2026-09-30', { amountNetto: 12_500 })], TODAY)
  assert.equal(m.revenueBasis, 'invoices')
  near(m.revenue, 12_500)
})

test('C4: marża = zysk netto (po kosztach zewnętrznych i podatku); producencka = minus moja praca', () => {
  const plan = projectMoney(project({ financials: fin(10_000, 2_000, { ownWork: 3_000 }) }), [], TODAY)
  near(plan.profit, 10_000 - 850 - 2_000)
  near(plan.ownWork, 3_000)
  near(plan.producerMargin, 10_000 - 850 - 2_000 - 3_000)
  near(plan.producerMarginPct, 41.5)
  const none = projectMoney(project({ financials: null }), [], TODAY)
  assert.deepEqual([none.producerMargin, none.producerMarginPct, none.ownWork], [null, null, 0])
})

test('C4: Realizacja — moja praca z wierszy „Moja praca"; przełączenie pozycji nie zmienia podstawy (koszty + moja praca)', () => {
  const plan = fin(10_000, 3_000)
  // W realizacji: Kamil 1 500 i ja 1 500 jak w planie (3 000), ja przełączony na „Moja praca".
  const m = projectMoney(project({ status: 'won', financials: plan, costs: [cost(1500), cost(1500, { ownWork: true })] }), [], TODAY)
  assert.equal(m.costsBasis, 'actual')
  near(m.costs, 1_500)
  near(m.ownWork, 1_500)
  near(m.actualOwnWork, 1_500)
  near(m.producerMargin, 10_000 - 850 - 1_500 - 1_500)
})

test('T6 bez zmian: odznaczenie w trakcie realizacji to wpisywanie w toku — liczy się plan, po Zrealizowanym fakty', () => {
  const plan = fin(10_000, 3_000, { ownWork: 1_000 })
  const costs = [cost(1500), cost(1500, { skipped: true }), cost(1000, { ownWork: true })]
  const won = projectMoney(project({ status: 'won', financials: plan, costs }), [], TODAY)
  assert.deepEqual([won.costsBasis, won.costsNote], ['plan', 'partial'])
  near(won.costs, 3_000)
  near(won.ownWork, 1_000, 'moja praca też z planu')
  const done = projectMoney(project({ status: 'done', financials: plan, costs }), [], TODAY)
  assert.equal(done.costsBasis, 'actual')
  near(done.costs, 1_500)
  near(done.ownWork, 1_000)
})

test('koszty sprzed R2 (bez nowych pól) liczą się dokładnie jak dotąd', () => {
  const costs = [cost(1800), cost(700, { category: 'dojazd' }), cost(510, { category: 'wynajem' }), cost(2200, { category: 'postprodukcja' })]
  const m = projectMoney(project({ status: 'won', financials: fin(12_020, 5_300), costs }), [], TODAY)
  assert.deepEqual([m.costsBasis, m.costsNote, m.costs, m.ownWork], ['plan', 'partial', 5_300, 0], 'Morris: wpisano 5 210 z 5 300')
  near(m.producerMargin, m.profit!)
})

// ── D2: rejestr marży i raport ───────────────────────────────────────────────

test('D2: marża producencka firmy = suma projektów (po podatku); projekt spoza okresu nie wnosi mojej pracy', () => {
  const projects = [
    { ...project({ id: 'a', financials: fin(10_000, 2_000, { ownWork: 3_000 }), date: '2026-05-10' }), client: 'A' },
    { ...project({ id: 'b', financials: fin(5_000, 1_000), date: '2026-06-10' }), client: 'B' },
  ]
  const input: MarginInput = {
    ledger: moneyLedger(projects, [], TODAY),
    fixedCosts: [],
    equipment: [],
    spread: true,
    settings: DEFAULT_GEAR_SPREAD,
    today: TODAY,
  }
  const year = marginSummary(input, { kind: 'year', year: 2026 })
  near(year.totals.ownWork, 3_000)
  near(year.totals.producerMargin, 10_000 - 850 - 2_000 - 3_000 + (5_000 - 425 - 1_000))
  const a = year.projects.find((r) => r.money.id === 'a')!
  near(a.producerMargin, a.margin - a.tax - a.ownWork)
  const june = marginSummary(input, { kind: 'month', year: 2026, index: 6 })
  near(june.totals.ownWork, 0)
  const scoped = marginSummary({ ...input, scope: new Set(['a']) }, { kind: 'year', year: 2026 })
  near(scoped.scoped!.producerMargin, a.producerMargin)
})

// ── Ekipa: odznaczone wiersze ────────────────────────────────────────────────

test('Ekipa: odznaczony wiersz (tego nie było) nie liczy się w statystykach osoby', () => {
  const members = [{ id: 'cm-kamil', name: 'Kamil', roleIds: [], createdAt: '', updatedAt: '' } as unknown as CrewMember]
  const p = {
    id: 'p',
    name: 'p',
    client: '',
    date: '2026-09-01',
    status: 'done',
    equipment: [],
    costs: [cost(1200, { personId: 'cm-kamil', person: 'Kamil' }), { ...cost(900, { personId: 'cm-kamil', person: 'Kamil', skipped: true }), id: 'x' }],
  } as unknown as Project
  const stats = computeCrewStats(members, [p]).get('cm-kamil')!
  assert.equal(stats.paidTotal, 1200)
})
