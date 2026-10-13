import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildInitialPdfState, coerceLocalPdfDraft, isLegacyEurDraft, reconcilePdfCurrency, PDF_ROW_KEYS } from './pdf-draft'
import { buildQuoteBreakdown, computeQuoteTotals, mergeQuoteDataPartial, quoteViews } from './quote-financials'
import { switchQuoteCurrency } from './quote-currency'
import { buildTermsAndConditions, DEFAULT_PDF_TEXTS, renderTermOvertime } from './pdf-texts-config'
import { formatPdfAmount } from './pdf-currency'
import { DEFAULT_PRICING } from './pricing-config'
import type { LocalPdfState, QuoteData } from './quote-types'
import type { PdfLang } from './pdf-i18n'

const ISSUE = new Date(2026, 9, 13)
const VALID = new Date(2026, 10, 12)

function pdf(data: QuoteData, lang: PdfLang = 'pl', currency?: 'PLN' | 'EUR', exchangeRate?: number): LocalPdfState {
  const { client, money } = quoteViews(data, DEFAULT_PRICING)
  return buildInitialPdfState({
    data: client.data,
    breakdown: buildQuoteBreakdown(client.data, 1, client.pricing),
    sumaNetto: computeQuoteTotals(client.data, 1, client.pricing).sumaNetto,
    marginMultiplier: 1,
    pricing: client.pricing,
    lang,
    currency: currency ?? money.currency,
    exchangeRate: exchangeRate ?? money.rate,
    terms: buildTermsAndConditions(data, DEFAULT_PDF_TEXTS, lang, { currency: money.currency }),
    issueDate: ISSUE,
    validUntilDate: VALID,
  })
}

const QUICK_PLN = mergeQuoteDataPartial({
  dniDokumentacji: 1,
  dniZdjeciowe: 2,
  wielkoscEkipy: 1,
  crudeEditCount: 1,
  copyrightType: 'przekazanie',
  liczbaAktorow: 1,
  actorRightsTransferAmount: 1500,
})

test('wycena w EUR: wiersze PDF w euro wprost z kalkulatora, bez drugiego przeliczenia', () => {
  const eur = switchQuoteCurrency(QUICK_PLN, 'EUR', { rate: 4.2735 })
  const state = pdf(eur)
  assert.equal(state.currency, 'EUR')
  assert.equal(state.followsQuote, true)
  // Dzień dokumentacji 1200 zł → 281 €; ekipa 2 × operator 1500 zł → 2 × 351 €.
  assert.equal(state.rows.preprodukcja.cenaNetto, 281)
  assert.equal(state.rows.ekipa.cenaNetto, 702)
  assert.equal(state.rows.postprodukcja.cenaNetto, 351)
  // Honorarium aktora (1500 zł → 351 € przy przełączeniu) w euro, bez „zł".
  assert.match(state.rows.obsada.opis, /1 aktor\(s\) × 351 €\.$/)
  assert.doesNotMatch(Object.values(state.rows).map((r) => r.opis).join('\n'), /zł|PLN/)
})

test('szkic sprzed S3 (wycena w PLN, PDF w EUR) dalej przelicza po kursie szkicu, także honorarium', () => {
  const state = pdf(QUICK_PLN, 'en', 'EUR', 4.3699)
  assert.equal(state.followsQuote, false)
  assert.equal(state.rows.preprodukcja.cenaNetto, Math.round(1200 / 4.3699))
  assert.match(state.rows.obsada.opis, /× 343 €\.$/)
  assert.equal(isLegacyEurDraft({ currency: 'EUR', followsQuote: false }, 'PLN'), true)
  assert.equal(isLegacyEurDraft({ currency: 'EUR', followsQuote: true }, 'PLN'), false)
  assert.equal(isLegacyEurDraft({ currency: 'EUR', followsQuote: false }, 'EUR'), false)
  assert.equal(isLegacyEurDraft({ currency: 'PLN', followsQuote: false }, 'PLN'), false)
})

test('szkic zapisany bez znacznika czyta się jako sprzed S3; ze znacznikiem — idzie za wyceną', () => {
  const fallback = pdf(QUICK_PLN)
  assert.equal(coerceLocalPdfDraft({ currency: 'EUR', exchangeRate: 4.37 }, fallback).followsQuote, false)
  assert.equal(coerceLocalPdfDraft({ currency: 'EUR', exchangeRate: 4.37, followsQuote: true }, fallback).followsQuote, true)
})

test('przełączenie wyceny PLN → EUR: ceny z kalkulatora w euro, ręczne ceny po kursie, ręczne opisy zostają', () => {
  const before = pdf(QUICK_PLN)
  const draft: LocalPdfState = {
    ...before,
    rows: {
      ...before.rows,
      ekipa: { ...before.rows.ekipa, cenaNetto: 3500 }, // poprawiona ręcznie
      postprodukcja: { ...before.rows.postprodukcja, opis: 'Montaż i kolor, 2 wersje.' },
    },
    materialyKoncowe: 'Plik 4K',
  }
  const eurData = switchQuoteCurrency(QUICK_PLN, 'EUR', { rate: 4.2735 })
  const after = pdf(eurData)
  const next = reconcilePdfCurrency(draft, before, after, 4.2735)
  assert.equal(next.currency, 'EUR')
  assert.equal(next.followsQuote, true)
  assert.equal(next.rows.preprodukcja.cenaNetto, after.rows.preprodukcja.cenaNetto)
  assert.equal(next.rows.ekipa.cenaNetto, Math.round(3500 / 4.2735))
  assert.equal(next.rows.obsada.opis, after.rows.obsada.opis, 'opis z kwotą w nowej walucie')
  assert.equal(next.rows.postprodukcja.opis, 'Montaż i kolor, 2 wersje.')
  assert.equal(next.materialyKoncowe, 'Plik 4K')
  for (const key of PDF_ROW_KEYS) assert.equal(next.rows[key].title, draft.rows[key].title)
})

test('powrót EUR → PLN: ceny z kalkulatora w zł, ręczne ceny × kurs', () => {
  const eurData = switchQuoteCurrency(QUICK_PLN, 'EUR', { rate: 4.2735 })
  const before = pdf(eurData)
  const draft = { ...before, rows: { ...before.rows, ekipa: { ...before.rows.ekipa, cenaNetto: 800 } } }
  const plnData = switchQuoteCurrency(eurData, 'PLN')
  const after = pdf(plnData)
  const next = reconcilePdfCurrency(draft, before, after, 4.2735)
  assert.equal(next.currency, 'PLN')
  assert.equal(next.rows.preprodukcja.cenaNetto, 1200)
  assert.equal(next.rows.ekipa.cenaNetto, Math.round(800 * 4.2735))
})

test('ta sama waluta: tylko kurs i znacznik, wiersze bez zmian', () => {
  const state = pdf(switchQuoteCurrency(QUICK_PLN, 'EUR', { rate: 4.2735 }))
  const next = reconcilePdfCurrency({ ...state, followsQuote: false }, state, { ...state, exchangeRate: 4.4 }, 4.2735)
  assert.equal(next.rows, state.rows)
  assert.equal(next.exchangeRate, 4.4)
  assert.equal(next.followsQuote, true)
})

test('uwagi: kwoty w walucie PDF, jedna konwencja etykiet; PLN po polsku jak dotąd', () => {
  const pl = buildTermsAndConditions(QUICK_PLN, DEFAULT_PDF_TEXTS, 'pl')
  assert.match(pl[1], /w kwocie 150 zł netto za członka ekipy/)
  assert.match(pl[2], /w kwocie 200 zł netto za rundę/)
  const eurData = switchQuoteCurrency(QUICK_PLN, 'EUR', { rate: 4.2735 })
  const en = buildTermsAndConditions(eurData, DEFAULT_PDF_TEXTS, 'en', { currency: 'EUR' })
  assert.match(en[1], /overtime at 35 € net per crew member/)
  assert.match(en[2], /billed at 47 € net per additional round/)
  // Szkic sprzed S3: kwoty z wyceny w PLN przeliczone na euro po kursie szkicu.
  const legacy = buildTermsAndConditions(QUICK_PLN, DEFAULT_PDF_TEXTS, 'en', {
    currency: 'EUR',
    convert: (pln) => Math.round(pln / 4.3699),
  })
  assert.match(legacy[1], /overtime at 34 € net/)
  assert.doesNotMatch(legacy.join(' '), /PLN|zł/)
})

test('uwagi z własnym szablonem: zła jednostka poprawiona, bez jednostki — w PLN sama liczba, w EUR z „€"', () => {
  assert.equal(renderTermOvertime('{hours} h, potem {rate} PLN/h.', 10, 150), '10 h, potem 150 zł/h.')
  assert.equal(renderTermOvertime('{hours} h, potem {rate}/h.', 10, 150), '10 h, potem 150/h.')
  assert.equal(renderTermOvertime('{hours} h, potem {rate}/h.', 10, 35, { currency: 'EUR' }), '10 h, potem 35 €/h.')
  assert.equal(renderTermOvertime('{rate} złotych', 10, 150), '150 złotych', '„złotych" to nie jednostka do podmiany')
  assert.equal(renderTermOvertime('{rate} zł', 10, 35, { currency: 'EUR' }, 'en'), '35 €')
})

test('kwoty w PDF: „zł" po polsku, „PLN" po angielsku, „€" w obu', () => {
  assert.equal(formatPdfAmount(31700, 'PLN'), '31 700 zł')
  assert.equal(formatPdfAmount(7291, 'PLN', 'en'), '7 291 PLN')
  assert.equal(formatPdfAmount(1460, 'EUR', 'en'), '1 460 €')
  assert.equal(formatPdfAmount(1460, 'EUR', 'pl'), '1 460 €')
})
