/**
 * Zakładka „Finanse" projektu — R2 (cena z PDF, dosprzedaż, faktury) i U1
 * (zatwierdzona cena: zamrożona / wpisana / „Odśwież"; „Do zapłaty"; „Wpłynęło na konto").
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MoneyEvent } from './money-loop'
import {
  gapAsExtraSale,
  projectFinanceView,
  projectPayments,
  refreshedPrice,
  revenueSourceText,
  typedPrice,
  type LiveQuote,
} from './project-finance'
import type { Project, ProjectCost } from './project-types'
import { createQuoteCrewLine } from './quote-crew'
import { createDefaultShootingDay, type ApprovedPriceRecord, type QuoteData } from './quote-types'

const TODAY = '2026-10-18'
const AT = '2026-10-24T10:00:00.000Z'
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

const frozen = (pln: number, source: ApprovedPriceRecord['source'] = 'pdf'): ApprovedPriceRecord => ({ pln, source, at: AT })

const project = (extra: Partial<Project> = {}) =>
  ({ id: 'p', status: 'won', date: '2026-10-01', quote: { version: 2 }, financials: null, costs: [], ...extra }) as Pick<
    Project,
    'id' | 'status' | 'date' | 'quote' | 'financials' | 'costs'
  >

let seq = 0
const ev = (kind: string, start: string, data: Record<string, unknown> = {}): MoneyEvent => ({ id: `e${++seq}`, kind, start, projectId: 'p', data })

// ── R2 (bez zmian w liczbach) ────────────────────────────────────────────────

test('C1: cena z PDF (wycena — idzie za PDF); „Do zapłaty" = cena + dosprzedaż', () => {
  const view = projectFinanceView(project({ status: 'quote' }), live({}, pdf({ ekipa: 2000, sprzet: 1000 })), [ev('extra_sale', '2026-10-10', { what: 'surówka', amountNetto: 500 })], TODAY)
  assert.deepEqual([view.price!.state, view.price!.pln, view.price!.live.source, view.price!.live.calculatorPln], ['live', 3000, 'pdf', 2700])
  assert.equal(view.price!.pdfDiff, null)
  assert.equal(view.accepted, false)
  assert.equal(view.due, 3500)
  assert.equal(view.transfer, null)
  assert.equal(view.money.revenue, 3500)
  assert.equal(revenueSourceText(view), 'z PDF + dosprzedaż')
})

test('kwota przelewu wpisana przed U1 (S-AI 80 440 przy PDF 67 800) — dalej się liczy; różnica do zapisania jako dosprzedaż', () => {
  const typed = live({ profitTransferAmount: 80440 }, pdf({ ekipa: 43500, postprodukcja: 24300 }))
  const view = projectFinanceView(project({ status: 'done' }), typed, [], TODAY)
  assert.deepEqual(view.transfer, { typed: 80440, expected: 67800, gap: 12640 })
  assert.equal(view.money.revenue, 80440)
  assert.equal(revenueSourceText(view), 'kwota przelewu wpisana ręcznie')
  const extra = gapAsExtraSale(view.transfer!.gap)!
  assert.deepEqual(extra, { amountNetto: 12640, what: 'Różnica w kwocie przelewu' })
  // Po zapisie: dosprzedaż w wątku, kwota wpisana usunięta — przychód bez zmian.
  const after = projectFinanceView(project({ status: 'done' }), { ...typed, data: { ...typed.data, profitTransferAmount: null } }, [ev('extra_sale', TODAY, extra)], TODAY)
  assert.equal(after.money.revenue, 80440)
  assert.equal(after.transfer, null)
  assert.equal(after.due, 80440)
})

test('kwota wpisana równa cenie (CIONET wywiady 3 260) — bez różnicy; niższa — bez przycisku (to rabat)', () => {
  const same = projectFinanceView(project(), live({ profitTransferAmount: 3000 }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(same.transfer!.gap, null)
  const lower = projectFinanceView(project(), live({ profitTransferAmount: 2500 }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(lower.transfer!.gap, -500)
  assert.equal(gapAsExtraSale(lower.transfer!.gap), null)
  assert.equal(gapAsExtraSale(0.001), null, 'grosz to nie dosprzedaż')
})

test('bez szkicu PDF — kalkulator; EUR — € × kurs wyceny', () => {
  const calc = projectFinanceView(project({ status: 'quote' }), live(), [], TODAY)
  assert.deepEqual([calc.price!.live.source, calc.price!.pln], ['calculator', 2700])
  assert.equal(revenueSourceText(calc), 'z kalkulatora, bez szkicu PDF')
  const eur = projectFinanceView(project({ status: 'quote' }), live({ currency: 'EUR', exchangeRate: 4.3661 }, pdf({ ekipa: 1460 }, { currency: 'EUR' }), []), [], TODAY)
  assert.deepEqual([eur.price!.live.currency, eur.price!.live.amount, eur.price!.live.rate], ['EUR', 1460, 4.3661])
  assert.equal(eur.money.revenue, 1460 * 4.3661)
})

test('faktura wygrywa z kwotą przelewu i ceną', () => {
  const view = projectFinanceView(project({ status: 'done' }), live({ profitTransferAmount: 3000 }), [ev('invoice_sent', '2026-10-05', { amountNetto: 3200 })], TODAY)
  assert.equal(view.money.revenue, 3200)
  assert.equal(revenueSourceText(view), 'z faktur')
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

test('retro-import bez wyceny: przychód i koszty z importu, bez ceny do edycji; „Do zapłaty" = import + dosprzedaż', () => {
  const financials = { sumaNetto: 9180, koszty: 0, podatek: 780.3, zysk: 8399.7, marzaPct: 91.5, computedAt: '' }
  const view = projectFinanceView(project({ quote: null, financials, status: 'done' }), { data: {}, marginMultiplier: 1 }, [ev('invoice_sent', '2026-03-26', { amountNetto: 9180 })], TODAY)
  assert.deepEqual([view.hasQuote, view.price, view.transfer, view.imported, view.due], [false, null, null, 9180, 9180])
  assert.equal(view.money.profit, 9180 - 780.3)
  assert.equal(view.money.producerMargin, view.money.profit)
  assert.equal(view.received.invoiceDecides, true)
})

// ── U1: zatwierdzona cena ────────────────────────────────────────────────────

test('U1 PDF zmieniony po przyjęciu (JHJ): cena zostaje 22 250, „PDF: 22 750 · Odśwież" — przychód rusza dopiero po „Odśwież"', () => {
  const pdfAfter = pdf({ ekipa: 9500, preprodukcja: 2400, sprzet: 3900, logistyka: 2800, postprodukcja: 3650, inne: 500 })
  const extra = ev('extra_sale', '2026-10-23', { what: 'Różnica w kwocie przelewu', amountNetto: 4090 })
  const before = projectFinanceView(project({ status: 'done' }), live({ approvedPrice: frozen(22250) }, pdfAfter), [extra], TODAY)
  assert.deepEqual([before.price!.state, before.price!.pln, before.price!.live.pln, before.price!.pdfDiff], ['frozen', 22250, 22750, 500])
  assert.equal(before.money.revenue, 26340)
  assert.equal(before.due, 26340)
  assert.equal(revenueSourceText(before), 'zatwierdzona cena + dosprzedaż')
  const record = refreshedPrice(before.price!.live, true, AT)!
  assert.deepEqual(record, { pln: 22750, source: 'pdf', at: AT })
  const after = projectFinanceView(project({ status: 'done' }), live({ approvedPrice: record }, pdfAfter), [extra], TODAY)
  assert.equal(after.price!.pdfDiff, null)
  assert.equal(after.money.revenue, 26840)
})

test('U1 cena wpisana ręcznie (Morris 12 500 przy PDF 11 980): liczy się wpisana, „PDF · Odśwież" wraca do PDF', () => {
  const draft = pdf({ ekipa: 11980 })
  const view0 = projectFinanceView(project(), live({ approvedPrice: frozen(11980) }, draft), [], TODAY)
  const typed = typedPrice(12500, view0.price!.live, true, AT)
  assert.deepEqual(typed, { pln: 12500, source: 'typed', at: AT })
  const view = projectFinanceView(project(), live({ approvedPrice: typed }, draft), [], TODAY)
  assert.deepEqual([view.price!.state, view.price!.pln, view.price!.pdfDiff], ['typed', 12500, -520])
  assert.equal(view.money.revenue, 12500)
  assert.equal(revenueSourceText(view), 'cena wpisana ręcznie')
  assert.deepEqual(refreshedPrice(view.price!.live, true, AT), { pln: 11980, source: 'pdf', at: AT })
})

test('U1 cena wpisana równa PDF: w przyjętym zleceniu zamrożenie PDF, w wycenie — znowu za PDF; „Odśwież" w wycenie czyści', () => {
  const view = projectFinanceView(project({ status: 'quote' }), live({}, pdf({ ekipa: 3000 })), [], TODAY)
  assert.deepEqual(typedPrice(3000, view.price!.live, true, AT), { pln: 3000, source: 'pdf', at: AT })
  assert.equal(typedPrice(3000.001, view.price!.live, false, AT), null)
  assert.deepEqual(typedPrice(3100.555, view.price!.live, false, AT), { pln: 3100.56, source: 'typed', at: AT })
  assert.equal(refreshedPrice(view.price!.live, false, AT), null)
})

test('U1 różnica poniżej 0,50 zł nie pokazuje „Odśwież" (zaokrąglenia EUR × kurs)', () => {
  const view = projectFinanceView(project(), live({ approvedPrice: frozen(2999.6) }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(view.price!.pdfDiff, null)
  const off = projectFinanceView(project(), live({ approvedPrice: frozen(2999.5) }, pdf({ ekipa: 3000 })), [], TODAY)
  assert.equal(off.price!.pdfDiff, 0.5)
})

test('U1 EUR (Tchibo Event): cena zamrożona w zł z kwotą i kursem; zmiana kursu → „PDF: X zł · Odśwież"', () => {
  const draft = pdf({ ekipa: 1460 }, { currency: 'EUR' })
  const base = projectFinanceView(project(), live({ currency: 'EUR', exchangeRate: 4.3661 }, draft, []), [], TODAY)
  const record = refreshedPrice(base.price!.live, true, AT)!
  assert.deepEqual([record.currency, record.amount, record.rate, record.pln], ['EUR', 1460, 4.3661, 1460 * 4.3661])
  const moved = projectFinanceView(project(), live({ currency: 'EUR', exchangeRate: 4.4, approvedPrice: record }, draft, []), [], TODAY)
  assert.equal(moved.price!.pln, 1460 * 4.3661)
  assert.ok(Math.abs(moved.price!.pdfDiff! - 1460 * (4.4 - 4.3661)) < 0.001)
  assert.equal(moved.money.revenue, 1460 * 4.3661, 'przychód z zatwierdzonej ceny, nie z nowego kursu')
})

test('U1 kwota przelewu wpisana przed U1 wygrywa z zatwierdzoną ceną (S-AI zamrożone 67 800)', () => {
  const view = projectFinanceView(project({ status: 'done' }), live({ profitTransferAmount: 80440, approvedPrice: frozen(67800) }, pdf({ ekipa: 43500, postprodukcja: 24300 })), [], TODAY)
  assert.equal(view.money.revenue, 80440)
  assert.equal(view.price!.pln, 67800)
  assert.equal(view.transfer!.gap, 12640)
})

// ── U1: wpłynęło na konto ────────────────────────────────────────────────────

test('U1 wpłata bez faktury wyższa niż cena + dosprzedaż → „Zapisz różnicę jako dosprzedaż"; po zapisie ta sama liczba', () => {
  const quote = live({ approvedPrice: frozen(22250) }, pdf({ ekipa: 22250 }))
  const pay = ev('invoice_paid', '2026-09-10', { amount: 26340 })
  const view = projectFinanceView(project({ status: 'done' }), quote, [pay], TODAY)
  assert.deepEqual([view.received.total, view.received.base, view.received.gap, view.received.invoiceDecides], [26340, 22250, 4090, false])
  assert.equal(view.money.revenue, 26340, 'T6: wpłata bez faktury to przychód')
  assert.equal(view.money.anchor, '2026-09-10', 'T6: kotwica w dniu wpłaty')
  assert.equal(revenueSourceText(view), 'z wpłat')
  const extra = gapAsExtraSale(view.received.gap)!
  const after = projectFinanceView(project({ status: 'done' }), quote, [pay, ev('extra_sale', TODAY, extra)], TODAY)
  assert.equal(after.money.revenue, 26340)
  assert.equal(after.received.gap, null)
})

test('U1 wpłata niższa — „mniej"; wpłata przy fakturze z kwotą — decyduje faktura, bez propozycji', () => {
  const quote = live({ approvedPrice: frozen(10000) }, pdf({ ekipa: 10000 }))
  const lower = projectFinanceView(project({ status: 'done' }), quote, [ev('invoice_paid', '2026-09-10', { amount: 9000 })], TODAY)
  assert.deepEqual([lower.received.gap, lower.received.short], [null, 1000])
  assert.equal(lower.money.revenue, 9000, 'zrealizowany: wpłata to przychód')
  const invoiced = projectFinanceView(
    project({ status: 'done' }),
    quote,
    [ev('invoice_sent', '2026-09-01', { amountNetto: 10000 }), ev('invoice_paid', '2026-09-10', { amount: 12000 })],
    TODAY
  )
  assert.deepEqual([invoiced.received.invoiceDecides, invoiced.received.gap, invoiced.received.short], [true, null, null])
  assert.equal(invoiced.money.revenue, 10000)
})

test('U1 faktura bez kwoty (S-AI) bierze kwotę wpłaty; porównanie z kwotą wpisaną przed U1', () => {
  const quote = live({ profitTransferAmount: 80440, approvedPrice: frozen(67800) }, pdf({ ekipa: 43500, postprodukcja: 24300 }))
  const events = [ev('invoice_sent', '2026-06-24', {}), ev('invoice_paid', '2026-07-17', {})]
  const before = projectFinanceView(project({ status: 'done' }), quote, events, TODAY)
  assert.deepEqual([before.received.withoutAmount, before.received.total, before.received.gap], [1, 0, null])
  assert.equal(before.money.revenueNote, 'missing_amount')
  const filled = [events[0], { ...events[1], data: { amount: 80440 } }]
  const after = projectFinanceView(project({ status: 'done' }), quote, filled, TODAY)
  assert.deepEqual([after.money.revenue, after.money.revenueBasis, after.received.base, after.received.gap], [80440, 'invoices', 80440, null])
  assert.equal(after.money.anchor, '2026-06-24', 'kotwica dalej w dacie faktury')
})

test('U1 W realizacji: zaliczka niższa niż cena zostawia plan („wpłynęło X z Y")', () => {
  const quote = live({ approvedPrice: frozen(10000) }, pdf({ ekipa: 10000 }))
  const view = projectFinanceView(project({ status: 'won' }), quote, [ev('invoice_paid', '2026-09-10', { amount: 4000 })], TODAY)
  assert.equal(view.money.revenue, 10000)
  assert.equal(view.money.revenueNote, 'partial')
  assert.equal(view.received.short, 6000)
})

test('U1 lista wpłat projektu: od najstarszej, bez usuniętych i cudzych, kwota albo brak', () => {
  const rows = projectPayments(
    [
      ev('invoice_paid', '2026-10-09', { amount: 1075, number: 'FV 3' }),
      ev('invoice_paid', '2026-09-01', {}),
      { ...ev('invoice_paid', '2026-09-02', { amount: 5 }), deletedAt: AT },
      { ...ev('invoice_paid', '2026-09-03', { amount: 5 }), projectId: 'other' },
      ev('invoice_sent', '2026-09-01', { amountNetto: 1075 }),
    ],
    'p'
  )
  assert.deepEqual(
    rows.map(({ id: _id, ...r }) => r),
    [
      { day: '2026-09-01', amount: null },
      { day: '2026-10-09', amount: 1075, number: 'FV 3' },
    ]
  )
})
