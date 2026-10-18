/**
 * R1 (A5): marża z nagłówka jako JEDNA osobna pozycja („Koordynacja i
 * produkcja" / „Rabat") w wycenach z `marginAsLine`; wyceny bez flagi liczą
 * się i drukują dokładnie jak dawniej. Przypadki z tabeli pokazanej M.J.
 * 2026-10-18 (Dräger 1,15: 1 400 / 5 400 / 1 500 / 3 600 + 1 785 = 13 685).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARGIN_PHASE,
  getBreakdownWithPricing,
  getProductionEkipaCastSprzetNetto,
  lineMarginMultiplier,
  marginLineAmount,
} from './quote-calc'
import {
  buildInitialPdfState,
  coerceLocalPdfDraft,
  flipPdfCurrency,
  pdfMarginRowTitle,
  pdfRowKeys,
  pdfRowsTotal,
  printsMarginRow,
  reconcilePdfCurrency,
  PDF_ROW_KEYS,
} from './pdf-draft'
import {
  buildQuoteBreakdown,
  computeQuoteTotals,
  computeSnapshotFinancials,
  mergeQuoteDataPartial,
  quotePlnPlan,
  quoteViews,
} from './quote-financials'
import { blankQuoteSnapshot, isBlankQuoteData } from './project-save'
import { addVariantPatch, withMarginLine } from './quote-variants'
import { snapshotGearRevenue } from './gear-revenue'
import { switchQuoteCurrency } from './quote-currency'
import { createQuoteCrewLine } from './quote-crew'
import { DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import { createDefaultDeliverable, createDefaultShootingDay, type LocalPdfState, type QuoteData } from './quote-types'
import type { QuoteSnapshot } from './quote-library'

const ISSUE = new Date(2026, 9, 18)
const VALID = new Date(2026, 10, 17)

// Cennik jak w wycenie Dräger: dzień dokumentacji 1 400, ReżOp 1 500, Asystent/Operator 1 200.
const PRICING: PricingConfigShape = {
  ...DEFAULT_PRICING,
  preprodukcja: { ...DEFAULT_PRICING.preprodukcja, dzienDokumentacji: 1400 },
  produkcja: { ...DEFAULT_PRICING.produkcja, rezOp: 1500, asystentOperator: 1200 },
}

const OPERATOR = { id: 'asystent', name: 'Operator', group: 'ekipa', clientRate: 1200, order: 20 }

/** Dräger: 1 dzień dokumentacji, 2 dni (ReżOp + Asystent/Operator), montaż 3 600, bez dojazdu. */
function drager(extra: Partial<QuoteData> = {}): QuoteData {
  const day = (id: string, rezOp: number, asystent: number) => ({ ...createDefaultShootingDay(), id, rezOp, asystent })
  return mergeQuoteDataPartial({
    dniDokumentacji: 1,
    isDetailedProdukcja: true,
    detailedShootingDays: [
      // dzień 1: 1 500 + 1 200 + operator z bazy 900 = 3 600; dzień 2: 1 500 + 1 200 + korekta 600 (bez marży)
      { ...day('d1', 1, 1), crew: [createQuoteCrewLine({ ...OPERATOR, clientRate: 900 })] },
      { ...day('d2', 1, 1), dayAdjustment: 600 },
    ],
    crudeEditCount: 2,
    ...extra,
  })
}

function pdf(data: QuoteData, margin: number, pricing = PRICING, lang: 'pl' | 'en' = 'pl'): LocalPdfState {
  const { client, money } = quoteViews(data, pricing)
  return buildInitialPdfState({
    data: client.data,
    breakdown: buildQuoteBreakdown(client.data, margin, client.pricing),
    sumaNetto: computeQuoteTotals(client.data, margin, client.pricing).sumaNetto,
    marginMultiplier: margin,
    pricing: client.pricing,
    lang,
    currency: money.currency,
    exchangeRate: money.rate,
    terms: [],
    issueDate: ISSUE,
    validUntilDate: VALID,
  })
}

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

test('stara wycena (bez flagi): marża rozciąga pozycje jak dotąd, bez fazy marży i bez wiersza w PDF', () => {
  const data = drager()
  assert.equal(data.marginAsLine, undefined, 'mergeQuoteDataPartial nie dopisuje flagi starym wycenom')
  const phases = getBreakdownWithPricing(data, 1.15, PRICING)
  assert.deepEqual(phases.map((p) => p.category), ['Preprodukcja', 'Produkcja', 'Postprodukcja', 'Dodatkowe'])
  near(phases[0].phaseNetto, 1400 * 1.15)
  assert.equal(lineMarginMultiplier(data, 1.15), 1.15)
  const state = pdf(data, 1.15)
  assert.deepEqual(Object.keys(state.rows), PDF_ROW_KEYS, 'dokładnie siedem wierszy jak dawniej')
  assert.deepEqual(pdfRowKeys(state.rows), PDF_ROW_KEYS)
})

test('nowa wycena 1,15: pozycje po własnych cenach + jedna pozycja marży; suma jak przy rozciąganiu', () => {
  const old = drager()
  const flagged = drager({ marginAsLine: true })
  const stretched = computeQuoteTotals(old, 1.15, PRICING).sumaNetto
  const lined = computeQuoteTotals(flagged, 1.15, PRICING).sumaNetto
  near(lined, stretched)

  const phases = getBreakdownWithPricing(flagged, 1.15, PRICING)
  const own = getBreakdownWithPricing(old, 1, PRICING)
  assert.deepEqual(phases.slice(0, 4), own, 'pozycje = wycena przy marży 0 %')
  assert.equal(phases[4].category, MARGIN_PHASE)
  // Marża z tego, co mnożnik rozciąga: 1 400 + (1 500 + 1 200 + 900) + (1 500 + 1 200) + 2 × 1 600 montaż; korekta dnia poza.
  const base = 1400 + 3600 + 2700 + 2 * DEFAULT_PRICING.postprodukcja.montazZaDzien
  near(marginLineAmount(phases), base * 0.15)
  assert.equal(phases[4].items[0].label, 'Koordynacja i produkcja')
  assert.equal(phases[4].items[0].value, '15%')
})

test('szczegółowa preprodukcja i postprodukcja: też bez marży w pozycjach, marża w jednej pozycji', () => {
  const detailed = drager({
    isDetailedPrepro: true,
    scenariusz: 'podstawowy',
    wizjaLokalna: true,
    kierownikProdukcji: true,
    isDetailedPostpro: true,
    detailedDeliverables: [{ ...createDefaultDeliverable(), ilosc: 3, korekcjaBarwna: 'podstawowa' }],
  })
  const flagged = { ...detailed, marginAsLine: true }
  const phases = getBreakdownWithPricing(flagged, 1.25, PRICING)
  const own = getBreakdownWithPricing(detailed, 1, PRICING)
  assert.deepEqual(phases.slice(0, 4), own)
  const margined = own[0].phaseNetto + own[2].phaseNetto + 3600 + 2700
  near(marginLineAmount(phases), margined * 0.25)
  near(computeQuoteTotals(flagged, 1.25, PRICING).sumaNetto, computeQuoteTotals(detailed, 1.25, PRICING).sumaNetto)
})

test('PDF nowej wyceny: wiersze bez marży, wiersz „Koordynacja i produkcja" na końcu, suma ta sama', () => {
  const old = pdf(drager(), 1.15)
  const state = pdf(drager({ marginAsLine: true }), 1.15)
  const own = pdf(drager(), 1)
  for (const key of PDF_ROW_KEYS) assert.equal(state.rows[key].cenaNetto, own.rows[key].cenaNetto, key)
  assert.deepEqual(pdfRowKeys(state.rows), [...PDF_ROW_KEYS, 'marza'])
  assert.equal(state.rows.marza!.title, 'Koordynacja i produkcja')
  assert.match(state.rows.marza!.opis, /Koordynacja projektu/)
  assert.ok(printsMarginRow(state.rows))
  assert.equal(pdfRowsTotal(state.rows), pdfRowsTotal(old.rows))
  assert.equal(pdfRowsTotal(state.rows), Math.round(computeQuoteTotals(drager(), 1.15, PRICING).sumaNetto))
  assert.equal(pdf(drager({ marginAsLine: true }), 1.15, PRICING, 'en').rows.marza!.title, 'Production & coordination')
})

test('marża 1,0 w nowej wycenie: brak pozycji; wiersz w szkicu z 0 się nie drukuje', () => {
  const flagged = drager({ marginAsLine: true })
  assert.deepEqual(getBreakdownWithPricing(flagged, 1, PRICING), getBreakdownWithPricing(drager(), 1, PRICING))
  const state = pdf(flagged, 1)
  assert.equal(state.rows.marza!.cenaNetto, 0)
  assert.equal(printsMarginRow(state.rows), false)
})

test('rabat −10 %: ujemna pozycja „Rabat" / „Discount", suma jak przy rozciąganiu', () => {
  const flagged = drager({ marginAsLine: true })
  near(computeQuoteTotals(flagged, 0.9, PRICING).sumaNetto, computeQuoteTotals(drager(), 0.9, PRICING).sumaNetto)
  const phases = getBreakdownWithPricing(flagged, 0.9, PRICING)
  assert.ok(marginLineAmount(phases) < 0)
  assert.equal(phases[4].items[0].label, 'Rabat')
  const state = pdf(flagged, 0.9)
  assert.ok(state.rows.marza!.cenaNetto < 0)
  assert.equal(state.rows.marza!.title, 'Rabat')
  assert.equal(state.rows.marza!.opis, 'Rabat od wyceny.')
  assert.equal(pdfMarginRowTitle(-5, 'en'), 'Discount')
  assert.equal(pdfRowsTotal(state.rows), pdfRowsTotal(pdf(drager(), 0.9).rows))
})

test('dopłata za przekazanie praw liczy się od sumy z pozycją marży — suma się nie zmienia', () => {
  const extra = { copyrightType: 'przekazanie' as const, liczbaAktorow: 1, actorRightsTransferAmount: 1000, kosztDojazduKm: 200 }
  near(
    computeQuoteTotals(drager({ ...extra, marginAsLine: true }), 1.2, PRICING).sumaNetto,
    computeQuoteTotals(drager(extra), 1.2, PRICING).sumaNetto
  )
})

test('szybka wycena z flagą: produkcja bez marży, marża w pozycji; podział PDF bez marży', () => {
  const quick = mergeQuoteDataPartial({ dniDokumentacji: 1, dniZdjeciowe: 2, wielkoscEkipy: 2, crudeEditCount: 1 })
  const flagged = { ...quick, marginAsLine: true }
  near(computeQuoteTotals(flagged, 1.3, PRICING).sumaNetto, computeQuoteTotals(quick, 1.3, PRICING).sumaNetto)
  assert.deepEqual(getProductionEkipaCastSprzetNetto(flagged, 1.3, PRICING), getProductionEkipaCastSprzetNetto(quick, 1, PRICING))
})

test('wycena w EUR z flagą: pozycja marży w euro, finanse w zł jak przy rozciąganiu', () => {
  const eurOld = switchQuoteCurrency(drager(), 'EUR', { rate: 4.3699 })
  const eurNew = { ...eurOld, marginAsLine: true }
  const a = computeSnapshotFinancials({ data: eurOld, pricingConfig: PRICING, marginMultiplier: 1.15 }, ISSUE)!
  const b = computeSnapshotFinancials({ data: eurNew, pricingConfig: PRICING, marginMultiplier: 1.15 }, ISSUE)!
  near(b.sumaNetto, a.sumaNetto)
  assert.equal(b.koszty, a.koszty)
  const { client } = quoteViews(eurNew, PRICING)
  const amount = marginLineAmount(buildQuoteBreakdown(client.data, 1.15, client.pricing))
  assert.ok(amount > 0 && amount < 2000, `marża w euro: ${amount}`)
  assert.equal(pdf(eurNew, 1.15).currency, 'EUR')
})

test('plan kosztów i finanse: flaga niczego nie zmienia poza wyglądem', () => {
  const old = quotePlnPlan(drager(), PRICING, 1.15)
  const lined = quotePlnPlan(drager({ marginAsLine: true }), PRICING, 1.15)
  assert.equal(lined.totalCost, old.totalCost)
  near(lined.summary.zysk, old.summary.zysk)
})

test('przychód ze sprzętu (stare pola) w nowej wycenie bez marży — marża nie jest sprzętem', () => {
  const day = { ...createDefaultShootingDay(), id: 'd1', kameraSony: 1 }
  const data = mergeQuoteDataPartial({ isDetailedProdukcja: true, detailedShootingDays: [day] })
  const old = snapshotGearRevenue({ data, pricingConfig: PRICING, marginMultiplier: 1.2 })!
  const lined = snapshotGearRevenue({ data: { ...data, marginAsLine: true }, pricingConfig: PRICING, marginMultiplier: 1.2 })!
  near(old.charged, PRICING.produkcja.kameraSonyMirrorless * 1.2)
  near(lined.charged, PRICING.produkcja.kameraSonyMirrorless)
})

// ── Szkice PDF ──────────────────────────────────────────────────────────────

test('szkic poprawiony ręcznie bez wiersza marży (np. kopia starej wyceny): marża 0, ceny jak wpisane', () => {
  const fallback = pdf(drager({ marginAsLine: true }), 1.15)
  const typed = pdf(drager(), 1.15)
  const draft = { ...typed, rows: { ...typed.rows, ekipa: { ...typed.rows.ekipa, cenaNetto: 4000 } } }
  const restored = coerceLocalPdfDraft(JSON.parse(JSON.stringify(draft)), fallback, ISSUE)
  assert.equal(restored.rows.marza!.cenaNetto, 0)
  for (const key of PDF_ROW_KEYS) assert.equal(restored.rows[key].cenaNetto, draft.rows[key].cenaNetto, key)
  assert.equal(pdfRowsTotal(restored.rows), pdfRowsTotal(draft.rows))
  // Stara wycena, stary szkic: bez wiersza marży, jak dawniej.
  assert.equal(coerceLocalPdfDraft(JSON.parse(JSON.stringify(draft)), typed, ISSUE).rows.marza, undefined)
})

test('szkic z wierszem marży wraca z kwotą i opisem (także ujemną), suma go liczy', () => {
  const fallback = pdf(drager({ marginAsLine: true }), 1.15)
  const draft = { ...fallback, rows: { ...fallback.rows, marza: { ...fallback.rows.marza!, cenaNetto: -300, opis: 'Rabat stały' } } }
  const restored = coerceLocalPdfDraft(JSON.parse(JSON.stringify(draft)), fallback, ISSUE)
  assert.deepEqual([restored.rows.marza!.cenaNetto, restored.rows.marza!.opis], [-300, 'Rabat stały'])
  assert.equal(pdfRowsTotal(restored.rows), pdfRowsTotal(fallback.rows) - fallback.rows.marza!.cenaNetto - 300)
})

test('zmiana waluty szkicu z wierszem marży: z kalkulatora idzie za nim, ręczny przelicza się po kursie', () => {
  const pln = drager({ marginAsLine: true })
  const eur = switchQuoteCurrency(pln, 'EUR', { rate: 4 })
  const before = pdf(pln, 1.15)
  const after = pdf(eur, 1.15)
  const same = reconcilePdfCurrency(before, before, after, 4)
  assert.equal(same.rows.marza!.cenaNetto, after.rows.marza!.cenaNetto)
  const typed = { ...before, rows: { ...before.rows, marza: { ...before.rows.marza!, cenaNetto: 2000 } } }
  assert.equal(reconcilePdfCurrency(typed, before, after, 4).rows.marza!.cenaNetto, 500)
  // Stary przełącznik waluty PDF nie gubi znaku rabatu.
  const discount = { ...before, exchangeRate: 4.3, rows: { ...before.rows, marza: { ...before.rows.marza!, cenaNetto: -400 } } }
  assert.equal(flipPdfCurrency(discount, 'EUR').rows.marza!.cenaNetto, -93)
})

// ── Które wyceny mają flagę ─────────────────────────────────────────────────

test('nowa wycena, lead i „Pusta wycena" mają flagę; pusta stara wycena dalej jest pusta', () => {
  assert.equal(blankQuoteSnapshot('Klient').data.marginAsLine, true)
  assert.equal(isBlankQuoteData(blankQuoteSnapshot('').data), true)
  assert.equal(isBlankQuoteData({ clientName: 'X' }), true, 'stara pusta wycena bez flagi')
  assert.equal(isBlankQuoteData({ dniDokumentacji: 1 }), false)
})

test('wariant: kopia starej wyceny i pusta wycena dostają flagę; szkic PDF kopii bez zmian', () => {
  const draft = { rows: { ekipa: { cenaNetto: 2400 } } }
  const source = { version: 2, savedAt: 'T', data: drager(), pricingConfig: PRICING, marginMultiplier: 1.15, pdfDraft: draft } as unknown as QuoteSnapshot
  const project = { id: 'p-1', quote: source, quoteVariants: [], quoteLabel: 'A' }
  const { variant } = addVariantPatch(project, { id: 'qv-b', snapshot: source, now: ISSUE })
  const copy = variant.snapshot as QuoteSnapshot
  assert.equal((copy.data as QuoteData).marginAsLine, true)
  assert.equal(copy.pdfDraft, draft, 'szkic tej samej treści')
  assert.equal((source.data as QuoteData).marginAsLine, undefined, 'źródło nietknięte')
  near(
    computeSnapshotFinancials(copy, ISSUE)!.sumaNetto,
    computeSnapshotFinancials(source, ISSUE)!.sumaNetto
  )
  assert.equal(withMarginLine(null), null)
  const already = { ...source, data: { ...source.data, marginAsLine: true } } as QuoteSnapshot
  assert.equal(withMarginLine(already), already)
})
