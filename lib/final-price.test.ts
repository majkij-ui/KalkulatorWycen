/**
 * Cena końcowa (decyzja M.J. 2026-11-05) — każdy przypadek z tabeli decyzji.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryFinalPrice, finalPrice, finalPriceStrip, invoiceSum, overrideFinalPrice, overrideWarning, quotePriceRecord, stampImportedPrice } from './final-price'
import { projectMoney, type MoneyEvent } from './money-loop'
import { projectFinanceView, type LiveQuote } from './project-finance'
import { planProjectSave } from './project-save'
import { quotedPrice } from './realization-summary'
import { computeSnapshotFinancials, snapshotPlanRevenue } from './quote-financials'
import { createQuoteCrewLine } from './quote-crew'
import { createDefaultShootingDay, type ApprovedPriceRecord, type QuoteData } from './quote-types'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'

const TODAY = '2026-11-05'
const AT = '2026-11-05T10:00:00.000Z'
const NOW = new Date(AT)
const ROLE = { id: 'asystent', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1200 }
const KAMIL = { id: 'cm-kamil', name: 'Kamil', rate: 1200, roleRates: [] }

const pdf = (total: number) => ({ currency: 'PLN', exchangeRate: 4.3, rows: { ekipa: { cenaNetto: total, opis: '' } } })

function quoteData(extra: Partial<QuoteData> = {}): Partial<QuoteData> {
  const day = { ...createDefaultShootingDay(), id: 'd1', crew: [createQuoteCrewLine(ROLE, KAMIL)] }
  return { isDetailedProdukcja: true, detailedShootingDays: [day], dniDokumentacji: 0, ...extra }
}
const snapshot = (pdfTotal: number, extra: Partial<QuoteData> = {}): QuoteSnapshot =>
  ({ version: 2, savedAt: AT, data: quoteData(extra), marginMultiplier: 1, pdfDraft: pdf(pdfTotal) }) as unknown as QuoteSnapshot

let seq = 0
const sent = (amountNetto: number | undefined, number: string | undefined, extra: Partial<MoneyEvent> = {}): MoneyEvent => ({
  id: `e${++seq}`,
  kind: 'invoice_sent',
  start: '2026-03-03',
  projectId: 'p',
  data: { ...(amountNetto !== undefined ? { amountNetto } : {}), ...(number ? { number } : {}) },
  ...extra,
})

const project = (extra: Partial<Project> = {}) =>
  ({ id: 'p', name: 'P', client: 'K', status: 'done', date: '2026-03-01', quote: null, financials: null, costs: [], ...extra }) as Project

const YOPRO = [sent(9180, '3/03/2026')]

test('(a) zrealizowany + faktura z kwotą: cena = suma faktur, z numerem (YoPro 9 180 zł, nie PDF 6 170 zł)', () => {
  const p = project({ quote: snapshot(6170) })
  const final = finalPrice(p, quotePriceRecord(p.quote), YOPRO, TODAY)
  assert.deepEqual(final, { pln: 9180, source: 'invoices', invoiceNumbers: ['3/03/2026'], label: 'faktura 3/03/2026' })
})

test('(a) kilka faktur: suma i numery; ta sama suma co pętla pieniędzy', () => {
  const events = [sent(1000, 'A/1'), sent(2500, 'A/2'), { ...sent(777, 'X'), projectId: 'inny' }]
  const p = project({ quote: snapshot(100) })
  const final = finalPrice(p, null, events, TODAY)!
  assert.equal(final.pln, 3500)
  assert.equal(final.label, 'faktury A/1, A/2')
  const money = projectMoney({ ...p, financials: computeSnapshotFinancials(p.quote as never, NOW) }, events, TODAY)
  assert.equal(money.invoiced, final.pln, 'ta sama suma co `projectMoney().invoiced`')
  assert.equal(invoiceSum(events, 'p', TODAY).total, money.invoiced)
})

test('(a) zaliczka w trwającym projekcie NIE blokuje ceny (stary tok: PDF / zatwierdzona)', () => {
  for (const status of ['quote', 'won'] as const) {
    const p = project({ status, quote: snapshot(6000) })
    assert.equal(finalPrice(p, null, [sent(3000, 'Z/1')], TODAY), null, status)
  }
})

test('usunięta faktura się nie liczy; faktura bez kwoty i zaplanowana też nie', () => {
  const p = project({ quote: snapshot(6000) })
  assert.equal(finalPrice(p, null, [sent(9180, '1', { deletedAt: '2026-04-01T00:00:00Z' })], TODAY), null)
  assert.equal(finalPrice(p, null, [sent(undefined, '2')], TODAY), null)
  assert.equal(finalPrice(p, null, [sent(9000, '3', { start: '2026-12-31' })], TODAY), null, 'zaplanowana (przyszła) faktura')
  const two = finalPrice(p, null, [sent(1000, 'a'), sent(5000, 'b', { deletedAt: '2026-04-01T00:00:00Z' })], TODAY)!
  assert.equal(two.pln, 1000)
})

test('faktury w EUR: liczy się kwota w zł, którą liczy pętla pieniędzy (amountNetto)', () => {
  const eur = [sent(2100, '5/2026', { data: { amountNetto: 2100, currency: 'EUR', amountEur: 480, number: '5/2026' } })]
  const p = project({ quote: snapshot(2196) })
  assert.equal(finalPrice(p, null, eur, TODAY)!.pln, 2100)
})

test('(b) import przy pierwszym zapisie wyceny: cena = przychód z importu (źródło `import`), edycje jej nie ruszają', () => {
  const imported: ProjectFinancials = { sumaNetto: 29724, koszty: 5000, podatek: 2000, zysk: 22724, marzaPct: 76, computedAt: AT }
  const p = project({ financials: imported, status: 'won' })
  const first = planProjectSave({ project: p, snapshot: snapshot(29450, { dniDokumentacji: 2 }), now: NOW })
  const q1 = first.project.quote as QuoteSnapshot
  assert.deepEqual(quotePriceRecord(q1), { pln: 29724, source: 'import', at: AT })
  assert.equal(first.project.financials?.sumaNetto, 29724)
  // Kolejna edycja (inna kwota PDF) — dokument niesie rekord, plan dalej 29 724.
  const edited = planProjectSave({ project: first.project, snapshot: { ...snapshot(31000, { dniDokumentacji: 3 }), data: { ...snapshot(31000).data, approvedPrice: quotePriceRecord(q1) } } as QuoteSnapshot, now: NOW })
  assert.equal(edited.project.financials?.sumaNetto, 29724)
  const final = finalPrice(edited.project, quotePriceRecord(edited.project.quote), [], TODAY)!
  assert.deepEqual([final.pln, final.source, final.label], [29724, 'import', 'import'])
})

test('(b) import bez przychodu (0) nie ustawia ceny końcowej', () => {
  const s = snapshot(1000)
  assert.equal(stampImportedPrice(s, { sumaNetto: 0 }, AT), s)
})

test('(c) „Ustaw cenę z wyceny": nadpisanie wygrywa z fakturami i importem; zapis w maszynerii U1', () => {
  const p = project({ quote: overrideFinalPrice(snapshot(6170), 6170.004, AT) })
  const record = quotePriceRecord(p.quote)!
  assert.deepEqual(record, { pln: 6170, source: 'override', at: AT })
  const final = finalPrice(p, record, YOPRO, TODAY)!
  assert.deepEqual([final.pln, final.source], [6170, 'override'])
  // planRevenue czyta ten sam rekord — jedna maszyneria, bez równoległej ceny.
  assert.equal(snapshotPlanRevenue(p.quote as never)!.pln, 6170)
})

test('ostrzeżenie nazywa źródło, kwotę i numery faktur; anulowanie niczego nie zmienia (czysta funkcja)', () => {
  const p = project({ quote: snapshot(6170) })
  const final = finalPrice(p, null, YOPRO, TODAY)!
  const text = overrideWarning(final, 6170)
  assert.match(text, /faktur/)
  assert.match(text, /3\/03\/2026/)
  assert.match(text, /9\s?180 zł/)
  assert.match(text, /6\s?170 zł/)
  assert.match(overrideWarning({ pln: 29724, source: 'import', invoiceNumbers: [], label: 'import' }, 29450), /importu/)
})

test('pasek nad wyceną: wycena X · cena końcowa Y · różnica Z — przelicza się przy każdej zmianie', () => {
  const final = finalPrice(project({ quote: snapshot(0) }), null, YOPRO, TODAY)!
  assert.deepEqual(finalPriceStrip(6170, final), { quotePln: 6170, finalPln: 9180, diff: -3010, label: 'faktura 3/03/2026' })
  assert.equal(finalPriceStrip(9200, final).diff, 20)
})

test('Realizacja: główna cena = cena końcowa, PDF obok; Finanse: bez luki i „dosprzedaży" od samej różnicy PDF', () => {
  // YoPro po „Zastąp": zamrożone PDF 6 170 zł w wycenie, faktura 9 180 zł.
  const q = snapshot(6170, { approvedPrice: { pln: 6170, source: 'pdf', at: AT } })
  const p = project({ quote: q, financials: computeSnapshotFinancials(q as never, NOW) })
  const events = [...YOPRO, { id: 'w', kind: 'invoice_paid', start: '2026-04-01', projectId: 'p', data: { amount: 9180 } } as MoneyEvent]
  const plan = quotedPrice(q as never)!
  assert.equal(plan.live.pln, 6170, 'PDF do porównania')
  const view = projectFinanceView(p, { data: q.data as never, marginMultiplier: 1, pdfDraft: q.pdfDraft } as LiveQuote, events, TODAY)
  assert.deepEqual([view.price!.state, view.price!.pln, view.price!.pdfDiff], ['final', 9180, -3010])
  assert.equal(view.due, 9180)
  assert.equal(view.received.gap, null)
  assert.equal(view.received.short, null)
  assert.equal(view.money.revenue, 9180)
})

test('Finanse: import jako cena końcowa — wpłata równa cenie nie daje luki, mimo innego PDF', () => {
  const q = snapshot(29450, { approvedPrice: { pln: 29724, source: 'import', at: AT } })
  const p = project({ status: 'won', quote: q, financials: computeSnapshotFinancials(q as never, NOW) })
  const paid = { id: 'w2', kind: 'invoice_paid', start: '2026-04-01', projectId: 'p', data: { amount: 29724 } } as MoneyEvent
  const view = projectFinanceView(p, { data: q.data as never, marginMultiplier: 1, pdfDraft: q.pdfDraft } as LiveQuote, [paid], TODAY)
  assert.deepEqual([view.price!.state, view.price!.pln, view.due], ['final', 29724, 29724])
  assert.equal(view.received.gap, null)
})

test('projekt bez ceny końcowej (normalny 2026: zaliczka, PDF, zatwierdzona) — bez zmian', () => {
  const q = snapshot(6000, { approvedPrice: { pln: 5800, source: 'pdf', at: AT } })
  const p = project({ status: 'won', quote: q, financials: computeSnapshotFinancials(q as never, NOW) })
  const view = projectFinanceView(p, { data: q.data as never, marginMultiplier: 1, pdfDraft: q.pdfDraft } as LiveQuote, [sent(3000, 'Z/1')], TODAY)
  assert.deepEqual([view.price!.state, view.price!.pln, view.price!.final, view.price!.pdfDiff], ['frozen', 5800, null, 200])
})

test('zmiana wariantu: cena końcowa (import / ręczna) przechodzi na nowy wariant; bez ceny — ta sama migawka', () => {
  const chosen = snapshot(5000)
  const withImport = stampImportedPrice(snapshot(100), { sumaNetto: 12000 }, AT)
  const keeps = carryFinalPrice(project({ quote: withImport }), chosen, AT)
  assert.deepEqual(quotePriceRecord(keeps), { pln: 12000, source: 'import', at: AT })
  const manual = overrideFinalPrice(snapshot(100), 7777, AT)
  assert.equal(quotePriceRecord(carryFinalPrice(project({ quote: manual }), chosen, AT))!.pln, 7777)
  assert.equal(carryFinalPrice(project({ quote: snapshot(100) }), chosen, AT), chosen)
  // Projekt z importem, jeszcze bez wyceny — jak pierwszy zapis.
  const noQuote = carryFinalPrice(project({ financials: { sumaNetto: 500, koszty: 0, podatek: 0, zysk: 0, marzaPct: 0, computedAt: AT } }), chosen, AT)
  assert.equal(quotePriceRecord(noQuote)!.source, 'import')
  // Cena z faktur (a) nie wymaga przenoszenia — liczy się przy odczycie niezależnie od wariantu.
  const rec: ApprovedPriceRecord | null = quotePriceRecord(chosen)
  assert.equal(finalPrice(project(), rec, YOPRO, TODAY)!.pln, 9180)
})
