/** R2 — zakładka „Finanse" projektu: zatwierdzona cena, kwota przelewu, dosprzedaż, faktury. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MoneyEvent } from './money-loop'
import { gapAsExtraSale, projectFinanceView, revenueSourceText, type LiveQuote } from './project-finance'
import type { Project, ProjectCost } from './project-types'
import { createQuoteCrewLine } from './quote-crew'
import { createDefaultShootingDay, type QuoteData } from './quote-types'

const TODAY = '2026-10-18'
const KAMIL = { id: 'cm-kamil', name: 'Kamil', rate: 1200, roleRates: [] }
const ME = { id: 'cm-ja', name: 'Michał', self: true as const, rate: 1500, roleRates: [] }
const ROLE = { id: 'asystent', name: 'Operator', group: 'ekipa', clientRate: 1500, costRate: 1200 }

const pdf = (rows: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  currency: 'PLN',
  exchangeRate: 4.3,
  rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { cenaNetto: v, opis: '' }])),
  ...extra,
})

function live(extra: Partial<QuoteData> = {}, pdfDraft: unknown = null, crew = [createQuoteCrewLine(ROLE, KAMIL), createQuoteCrewLine(ROLE, ME)]): LiveQuote {
  const day = { ...createDefaultShootingDay(), id: 'd1', crew }
  return { data: { isDetailedProdukcja: true, detailedShootingDays: [day], dniDokumentacji: 0, ...extra }, marginMultiplier: 1, pdfDraft }
}

const project = (extra: Partial<Project> = {}) =>
  ({ id: 'p', status: 'won', date: '2026-10-01', quote: { version: 2 }, financials: null, costs: [], ...extra }) as Pick<
    Project,
    'id' | 'status' | 'date' | 'quote' | 'financials' | 'costs'
  >

let seq = 0
const ev = (kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({ id: `e${++seq}`, kind, start, projectId: 'p', data })

test('C1: zatwierdzona cena z PDF; pole przelewu = cena + dosprzedaż, bez różnicy', () => {
  const view = projectFinanceView(project(), live({}, pdf({ ekipa: 2000, sprzet: 1000 })), [ev('extra_sale', '2026-10-10', { what: 'surówka', amountNetto: 500 })], TODAY)
  assert.deepEqual([view.approved!.source, view.approved!.pln, view.approved!.calculatorPln], ['pdf', 3000, 2700])
  assert.deepEqual(view.transfer, { typed: null, shown: 3500, expected: 3500, gap: null })
  assert.equal(view.money.revenue, 3500)
  assert.equal(revenueSourceText(view), 'z PDF + dosprzedaż')
})

test('C1: kwota wpisana ręcznie (S-AI 80 440 przy PDF 67 800) — różnica do zapisania jako dosprzedaż, liczba ta sama', () => {
  const typed = live({ profitTransferAmount: 80440 }, pdf({ ekipa: 43500, postprodukcja: 24300 }))
  const view = projectFinanceView(project({ status: 'done' }), typed, [], TODAY)
  assert.equal(view.transfer!.gap, 12640)
  assert.equal(view.money.revenue, 80440)
  assert.equal(revenueSourceText(view), 'kwota przelewu wpisana ręcznie')
  const extra = gapAsExtraSale(view.transfer)!
  assert.deepEqual(extra, { amountNetto: 12640, what: 'Różnica w kwocie przelewu' })
  // Po zapisie: dosprzedaż w wątku, pole znowu „z ceny" — przychód bez zmian.
  const after = projectFinanceView(project({ status: 'done' }), { ...typed, data: { ...typed.data, profitTransferAmount: null } }, [ev('extra_sale', TODAY, extra)], TODAY)
  assert.equal(after.money.revenue, 80440)
  assert.equal(after.transfer!.gap, null)
})

test('C1: wpisana kwota równa cenie (Morris 12 020) — bez różnicy; niższa — bez przycisku (to rabat)', () => {
  const same = projectFinanceView(project(), live({ profitTransferAmount: 3000 }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(same.transfer!.gap, null)
  const lower = projectFinanceView(project(), live({ profitTransferAmount: 2500 }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(lower.transfer!.gap, -500)
  assert.equal(gapAsExtraSale(lower.transfer), null)
})

test('C1: bez szkicu PDF — kalkulator; EUR — € × kurs wyceny', () => {
  const calc = projectFinanceView(project(), live(), [], TODAY)
  assert.deepEqual([calc.approved!.source, calc.approved!.pln], ['calculator', 2700])
  assert.equal(revenueSourceText(calc), 'z kalkulatora (bez szkicu PDF)')
  const eur = projectFinanceView(project(), live({ currency: 'EUR', exchangeRate: 4.3661 }, pdf({ ekipa: 1460 }, { currency: 'EUR' }), []), [], TODAY)
  assert.deepEqual([eur.approved!.currency, eur.approved!.amount, eur.approved!.rate], ['EUR', 1460, 4.3661])
  assert.equal(eur.money.revenue, 1460 * 4.3661)
})

test('faktura wygrywa z kwotą przelewu', () => {
  const view = projectFinanceView(project({ status: 'done' }), live({ profitTransferAmount: 3000 }), [ev('invoice_sent', '2026-10-05', { amountNetto: 3200 })], TODAY)
  assert.equal(view.money.revenue, 3200)
  assert.equal(revenueSourceText(view), 'z faktur')
  assert.equal(view.transfer!.shown, 3000)
})

test('C2 / C4: zysk netto po kosztach zewnętrznych i ryczałcie, marża producencka minus moja praca („Ja" 1 500)', () => {
  const view = projectFinanceView(project(), live({}, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(view.money.costs, 1200)
  assert.equal(view.money.ownWork, 1500)
  assert.equal(view.money.profit, 3000 - 255 - 1200)
  assert.equal(view.money.producerMargin, 3000 - 255 - 1200 - 1500)
  assert.equal(view.actual, null, 'Realizacja jeszcze nie ruszona')
  assert.deepEqual(view.categories, [])
})

test('C3: plan a Realizacja wg kategorii, gdy Realizacja ma wiersze', () => {
  const costs = [{ id: 'c', category: 'ekipa', unitCost: 1000 }, { id: 'd', category: 'dojazd', unitCost: 300 }] as ProjectCost[]
  const view = projectFinanceView(project({ costs }), live(), [], TODAY)
  assert.deepEqual(view.categories, [
    { category: 'ekipa', plan: 1200, actual: 1000 },
    { category: 'dojazd', plan: 0, actual: 300 },
  ])
})

test('retro-import bez wyceny: przychód i koszty z importu, bez pól do edycji', () => {
  const financials = { sumaNetto: 9180, koszty: 0, podatek: 780.3, zysk: 8399.7, marzaPct: 91.5, computedAt: '' }
  const view = projectFinanceView(project({ quote: null, financials, status: 'done' }), { data: {}, marginMultiplier: 1 }, [ev('invoice_sent', '2026-03-26', { amountNetto: 9180 })], TODAY)
  assert.deepEqual([view.hasQuote, view.approved, view.transfer, view.imported], [false, null, null, 9180])
  assert.equal(view.money.profit, 9180 - 780.3)
  assert.equal(view.money.producerMargin, view.money.profit)
})
