/**
 * W1: przekazanie praw i surowego materiału. Tabela z planu (baza 10 000 zł,
 * prawa 30%, surowy 20%) w PLN i w wycenie w EUR, podstawa bez obu pozycji,
 * własna kwota, stare wyceny bez nowych pól, linijki „Opcje dodatkowe" w PDF.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getBreakdownWithPricing, getExtrasBase } from './quote-calc'
import { buildInitialPdfState } from './pdf-draft'
import { buildQuoteBreakdown, computeQuoteTotals, mergeQuoteDataPartial, quoteViews } from './quote-financials'
import { buildOptionLines, joinOptionText, newQuoteExtras, resolveExtra } from './quote-extras'
import { switchQuoteCurrency } from './quote-currency'
import { buildTermsAndConditions, DEFAULT_PDF_TEXTS } from './pdf-texts-config'
import { DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import { blankQuoteSnapshot, isBlankQuoteData } from './project-save'
import { buildDerivedCostLines } from './profit-calc'
import type { ExtraMode, QuoteData } from './quote-types'
import type { PdfLang } from './pdf-i18n'

/** Baza dokładnie 10 000: jeden dzień dokumentacji po 10 000 zł, reszta zero. */
const PRICING: PricingConfigShape = {
  ...DEFAULT_PRICING,
  preprodukcja: { ...DEFAULT_PRICING.preprodukcja, dzienDokumentacji: 10000 },
}
const BASE_PL: Partial<QuoteData> = {
  dniDokumentacji: 1,
  dniZdjeciowe: 0,
  crudeEditCount: 0,
  kosztDojazduKm: 0,
}

function quote(rights: ExtraMode, raw: ExtraMode, extra: Partial<QuoteData> = {}): QuoteData {
  return mergeQuoteDataPartial({ ...BASE_PL, rightsMode: rights, rawMode: raw, ...extra })
}

function total(data: QuoteData, pricing = PRICING): number {
  return computeQuoteTotals(data, 1, pricing).sumaNetto
}

const ISSUE = new Date(2026, 10, 5)

function pdfFor(data: QuoteData, lang: PdfLang = 'pl') {
  const { client, money } = quoteViews(data, PRICING)
  const base = getExtrasBase(client.data, 1, client.pricing)
  const state = buildInitialPdfState({
    data: client.data,
    breakdown: buildQuoteBreakdown(client.data, 1, client.pricing),
    sumaNetto: computeQuoteTotals(client.data, 1, client.pricing).sumaNetto,
    marginMultiplier: 1,
    pricing: client.pricing,
    lang,
    currency: money.currency,
    exchangeRate: money.rate,
    terms: buildTermsAndConditions(client.data, DEFAULT_PDF_TEXTS, lang, { currency: money.currency }),
    issueDate: ISSUE,
    validUntilDate: ISSUE,
  })
  const lines = buildOptionLines(client.data, client.pricing, base, lang, money.currency).map((l) => l.replace(/[\u00a0\u202f]/g, ' '))
  return { state, lines, rowsTotal: Object.values(state.rows).reduce((s, r) => s + r.cenaNetto, 0) }
}

const TABLE: { rights: ExtraMode; raw: ExtraMode; sum: number; lines: string[] }[] = [
  { rights: 'w-cenie', raw: 'opcja', sum: 13000, lines: ['Przekazanie surowego materiału: +2 000 zł netto'] },
  {
    rights: 'opcja',
    raw: 'opcja',
    sum: 10000,
    lines: ['Przekazanie praw autorskich: +3 000 zł netto', 'Przekazanie surowego materiału: +2 000 zł netto'],
  },
  { rights: 'w-cenie', raw: 'w-cenie', sum: 15000, lines: [] },
  { rights: 'ukryj', raw: 'ukryj', sum: 10000, lines: [] },
]

for (const row of TABLE) {
  test(`tabela z planu (PLN): prawa ${row.rights}, surowy ${row.raw} = ${row.sum}`, () => {
    const data = quote(row.rights, row.raw)
    assert.equal(getExtrasBase(data, 1, PRICING), 10000)
    assert.equal(total(data), row.sum)
    const { state, lines, rowsTotal } = pdfFor(data)
    assert.equal(rowsTotal, row.sum, 'suma wierszy PDF = suma wyceny')
    assert.deepEqual(lines, row.lines)
    if (row.rights === 'w-cenie' && row.raw === 'w-cenie') {
      assert.equal(state.rows.inne.cenaNetto, 5000)
    }
  })
}

test('tabela z planu w wycenie w EUR: te same wiersze, kwoty w euro', () => {
  // Kurs 4: 10 000 zł = 2 500 €. Baza w EUR 2 500, prawa 750, surowy 500.
  const pln = quote('w-cenie', 'opcja')
  const eur = switchQuoteCurrency(pln, 'EUR', { rate: 4 })
  const { client } = quoteViews(eur, PRICING)
  assert.equal(getExtrasBase(client.data, 1, client.pricing), 2500)
  assert.equal(computeQuoteTotals(client.data, 1, client.pricing).sumaNetto, 3250)
  const out = pdfFor(eur, 'en')
  assert.deepEqual(out.lines, ['Raw footage handover: +500 € net'])
  assert.equal(out.rowsTotal, 3250)
  assert.equal(pdfFor(eur, 'pl').lines[0], 'Przekazanie surowego materiału: +500 € netto')

  const both = switchQuoteCurrency(quote('opcja', 'opcja'), 'EUR', { rate: 4 })
  assert.deepEqual(pdfFor(both).lines, ['Przekazanie praw autorskich: +750 € netto', 'Przekazanie surowego materiału: +500 € netto'])
  assert.equal(pdfFor(quote('w-cenie', 'w-cenie')).rowsTotal, 15000)
  const bothIn = switchQuoteCurrency(quote('w-cenie', 'w-cenie'), 'EUR', { rate: 4 })
  assert.equal(pdfFor(bothIn).rowsTotal, 3750)
  assert.equal(pdfFor(switchQuoteCurrency(quote('ukryj', 'ukryj'), 'EUR', { rate: 4 })).rowsTotal, 2500)
})

test('podstawa % bez obu pozycji: surowy nie liczy się od praw ani odwrotnie', () => {
  const data = quote('w-cenie', 'w-cenie')
  const items = getBreakdownWithPricing(data, 1, PRICING).find((p) => p.category === 'Dodatkowe')!.items
  assert.equal(items.find((i) => i.label === 'Pełne przekazanie praw')!.lineNetto, 3000)
  assert.equal(items.find((i) => i.label === 'Przekazanie surowego materiału')!.lineNetto, 2000)
  // Ta sama podstawa także gdy jedna jest tylko opcją.
  assert.equal(getExtrasBase(quote('opcja', 'w-cenie'), 1, PRICING), 10000)
})

test('własna kwota ignoruje podstawę; wpisana w walucie wyceny', () => {
  const fixed = quote('w-cenie', 'opcja', { rightsAmountKind: 'fixed', rightsFixedAmount: 1234, rawAmountKind: 'fixed', rawFixedAmount: 777 })
  assert.equal(total(fixed), 11234)
  assert.deepEqual(pdfFor(fixed).lines, ['Przekazanie surowego materiału: +777 zł netto'])
  const bigger = { ...fixed, dniDokumentacji: 2 }
  assert.equal(total(bigger), 21234)
  // EUR: kwota własna zmienia się raz przy zmianie waluty, nie z kursem.
  const eur = switchQuoteCurrency(fixed, 'EUR', { rate: 4 })
  assert.equal(eur.rightsFixedAmount, 309)
  assert.equal(switchQuoteCurrency(eur, 'EUR', { rate: 5 }).rightsFixedAmount, 309)
})

test('marża w podstawie (marginAsLine): % liczy się od ceny z marżą', () => {
  const data = quote('w-cenie', 'ukryj', { marginAsLine: true })
  assert.equal(computeQuoteTotals(data, 1.1, PRICING).sumaNetto, 11000 + 3300)
})

test('stare dane: przekazanie bez nowych pól = prawa W cenie z dotychczasowym procentem, cena jak dawniej', () => {
  const legacy = mergeQuoteDataPartial({ ...BASE_PL, copyrightType: 'przekazanie' })
  assert.equal(resolveExtra(legacy, PRICING, 'rights').mode, 'w-cenie')
  assert.equal(total(legacy), 13000)
  assert.equal(total(legacy, { ...PRICING, dodatkowe: { ...PRICING.dodatkowe, pelnePrzekazaniePrawProcent: 25 } }), 12500)
  assert.deepEqual(pdfFor(legacy).lines, [])
  // Cennik zapisany przed W1 nie ma pola surowego materiału.
  const oldPricing = { ...PRICING, dodatkowe: { kosztDojazduKm: 2.5, pelnePrzekazaniePrawProcent: 30 } } as PricingConfigShape
  assert.equal(total(legacy, oldPricing), 13000)
  assert.match(pdfFor(legacy).state.rows.inne.opis, /pełne przekazanie praw/)
})

test('stare dane: licencja i brak pól surowego materiału nic nie pokazują', () => {
  const lic = mergeQuoteDataPartial({ ...BASE_PL, copyrightType: 'licencja' })
  assert.equal(resolveExtra(lic, PRICING, 'rights').mode, 'ukryj')
  assert.equal(resolveExtra(lic, PRICING, 'raw').mode, 'ukryj')
  assert.equal(total(lic), 10000)
  assert.deepEqual(pdfFor(lic).lines, [])
  assert.equal('rawMode' in lic, false)
  assert.equal('rightsMode' in lic, false)
})

test('nowe wyceny: tryb startowy „Jako opcja", procenty 30 i 20 z Cennika', () => {
  const ex = newQuoteExtras()
  assert.equal(ex.rightsMode, 'opcja')
  assert.equal(ex.rawMode, 'opcja')
  assert.equal(DEFAULT_PRICING.dodatkowe.pelnePrzekazaniePrawProcent, 30)
  assert.equal(DEFAULT_PRICING.dodatkowe.surowyMaterialProcent, 20)
  const blank = blankQuoteSnapshot('Klient')
  assert.equal(blank.data.rightsMode, 'opcja')
  assert.equal(blank.data.rawMode, 'opcja')
  // Sama zmiana trybu nie jest budowaniem wyceny.
  assert.equal(isBlankQuoteData({ ...blank.data, rawMode: 'w-cenie' }), true)
  assert.equal(isBlankQuoteData({}), true)
})

test('„W cenie" wymienione w opisie Inne koszty; opis ręczny zostaje po stronie szkicu', () => {
  const only = pdfFor(quote('ukryj', 'w-cenie')).state.rows.inne.opis
  assert.match(only, /Przekazanie surowego materiału: w cenie\./)
  const pl = pdfFor(quote('w-cenie', 'w-cenie')).state.rows.inne.opis
  assert.match(pl, /Prawa autorskie: pełne przekazanie praw\./)
  assert.match(pl, /Przekazanie surowego materiału: w cenie\./)
  const en = pdfFor(quote('w-cenie', 'w-cenie'), 'en').state.rows.inne.opis
  assert.match(en, /Raw footage handover: included\./)
  // Jako opcja nie trafia do opisu wiersza.
  assert.doesNotMatch(pdfFor(quote('opcja', 'opcja')).state.rows.inne.opis, /surowego|Raw/)
})

test('linijki opcji stoją nad ręcznym tekstem i go nie zmieniają', () => {
  const lines = pdfFor(quote('opcja', 'opcja')).lines
  const manual = 'Dron: +500 zł netto za dzień'
  const text = joinOptionText(lines, manual)
  assert.equal(text.split('\n').at(-1), manual)
  assert.equal(text.split('\n').length, 3)
  assert.equal(joinOptionText([], '  '), '')
  assert.equal(joinOptionText(lines, ''), lines.join('\n'))
  // Ręczny tekst w szkicu nie zawiera linijek automatycznych.
  assert.equal(pdfFor(quote('opcja', 'opcja')).state.opcjeDodatkowe, '')
})

test('Uwagi: prawa W cenie to przekazanie także w warunkach; stare wyceny jak dawniej', () => {
  const terms = (d: QuoteData) => buildTermsAndConditions(d, DEFAULT_PDF_TEXTS, 'pl', { currency: 'PLN' })
  const legacyLic = terms(mergeQuoteDataPartial({ copyrightType: 'licencja' }))
  const legacyTr = terms(mergeQuoteDataPartial({ copyrightType: 'przekazanie' }))
  assert.equal(terms(quote('w-cenie', 'ukryj'))[0], legacyTr[0])
  assert.equal(terms(quote('opcja', 'ukryj'))[0], legacyLic[0])
})

test('Realizacja: żadna z dwóch pozycji nie jest wierszem kosztów; honorarium aktorów zostaje', () => {
  const costKeys = (d: QuoteData) => buildDerivedCostLines(d, PRICING, 1).map((l) => `${l.key}|${l.label}`).join('\n')
  const base = costKeys(quote('ukryj', 'ukryj'))
  assert.equal(costKeys(quote('w-cenie', 'w-cenie')), base)
  assert.doesNotMatch(costKeys(quote('w-cenie', 'w-cenie')), /surowego|Pełne przekazanie praw/)
  const actors = quote('w-cenie', 'w-cenie', { copyrightType: 'przekazanie', liczbaAktorow: 2, actorRightsTransferAmount: 500 })
  assert.match(costKeys(actors), /pro:aktorzyPrawa/)
})

test('warianty: każdy ma własne ustawienia (dane wariantu)', () => {
  const a = quote('w-cenie', 'opcja')
  const b = quote('ukryj', 'w-cenie')
  assert.equal(total(a), 13000)
  assert.equal(total(b), 12000)
})
