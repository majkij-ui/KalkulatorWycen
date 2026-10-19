/**
 * Wynik finansowy wyceny liczony z SAMEJ migawki — bez Reacta i bez kalkulatora.
 *
 * Do tej pory finanse projektu umiał policzyć tylko `project-hub-context`, bo
 * potrzebował stanu z `QuoteProvider` (dane, cennik, sumy z cateringiem).
 * Przez to zmigrowane projekty miały `financials: null`, dopóki ktoś ich nie
 * otworzył i nie zapisał. Ten moduł robi dokładnie to samo, co kalkulator po
 * `loadQuoteSnapshot`, więc migawka liczona tu i na żywo daje identyczny wynik
 * — i da się to pokryć testami.
 */

import { defaultQuoteData, type LocalPdfState, type QuoteData, type ShootingDay } from './quote-types'
import { DEFAULT_EXCHANGE_RATE, pdfRowsTotal } from './pdf-draft'
import { migratePricingConfig, DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import { getBreakdownWithPricing, getTotals, type LineItemRow, type PhaseBreakdown } from './quote-calc'
import { dayCrewFigures } from './quote-crew'
import { computeProfitSummary, resolveProfitSections } from './profit-calc'
import { safeArray, safeNum } from './safe-numbers'
import type { ProjectFinancials } from './project-types'
import { clientPricing, clientQuoteData, costQuoteData, quoteMoney, toPln, type QuoteMoney } from './quote-currency'

const VAT_RATE = 0.23

/** Uzupełnia częściowe / stare dane wyceny domyślnymi (ten sam merge co przy wczytaniu). */
export function mergeQuoteDataPartial(partial: Partial<QuoteData>): QuoteData {
  const merged: QuoteData = { ...defaultQuoteData, ...partial }
  merged.detailedShootingDays = Array.isArray(merged.detailedShootingDays) ? merged.detailedShootingDays : []
  merged.detailedDeliverables = Array.isArray(merged.detailedDeliverables) ? merged.detailedDeliverables : []
  merged.profitOverrides =
    merged.profitOverrides != null && typeof merged.profitOverrides === 'object' && !Array.isArray(merged.profitOverrides)
      ? merged.profitOverrides
      : {}
  merged.profitCustomItems = Array.isArray(merged.profitCustomItems) ? merged.profitCustomItems : []
  if (!Number.isFinite(merged.profitTaxRatePercent)) merged.profitTaxRatePercent = defaultQuoteData.profitTaxRatePercent
  merged.profitTransferAmount =
    typeof merged.profitTransferAmount === 'number' && Number.isFinite(merged.profitTransferAmount)
      ? merged.profitTransferAmount
      : null
  if (!Number.isFinite(merged.profitFuelPricePerLiter)) merged.profitFuelPricePerLiter = defaultQuoteData.profitFuelPricePerLiter
  if (!Number.isFinite(merged.profitFuelConsumption)) merged.profitFuelConsumption = defaultQuoteData.profitFuelConsumption
  merged.gearDiscountPercent = Number.isFinite(merged.gearDiscountPercent)
    ? Math.min(100, Math.max(0, merged.gearDiscountPercent))
    : defaultQuoteData.gearDiscountPercent
  if (typeof merged.gearValueInPdf !== 'boolean') merged.gearValueInPdf = defaultQuoteData.gearValueInPdf
  if (typeof merged.crewPeopleInPdf !== 'boolean') merged.crewPeopleInPdf = defaultQuoteData.crewPeopleInPdf
  // Legacy snapshots (pre-crudeEditCount) only carried dniMontazu; the check must
  // look at the raw partial — after the spread, crudeEditCount is never undefined.
  if (partial.crudeEditCount === undefined && typeof partial.dniMontazu === 'number' && partial.dniMontazu > 0) {
    merged.crudeEditCount = partial.dniMontazu
  }
  return merged
}

/** Osobodni ekipy — podstawa cateringu, noclegów i kosztów logistyki. */
export function computeTotalCrewDays(data: QuoteData): number {
  if (!data.isDetailedProdukcja) {
    return safeNum(data.dniZdjeciowe, 0, 0) * safeNum(data.wielkoscEkipy, 1, 1)
  }
  return safeArray<ShootingDay>(data.detailedShootingDays).reduce(
    (acc, day) =>
      acc +
      day.rezOp +
      day.asystent +
      day.gafer +
      day.dzwiekowiec +
      day.mua +
      day.aktor +
      day.model +
      day.statysta +
      // Ekipa z bazy (T9b): każda osoba-dzień je i śpi jak licznik.
      dayCrewFigures(day).personDays,
    0
  )
}

export interface QuoteTotalsWithLogistics {
  sumaNetto: number
  vat: number
  sumaBrutto: number
  cateringCost: number
  lodgingCost: number
}

/** Sumy oferty RAZEM z cateringiem i noclegami (tak jak w nagłówku kalkulatora). */
export function computeQuoteTotals(
  data: QuoteData,
  marginMultiplier: number,
  pricing: PricingConfigShape
): QuoteTotalsWithLogistics {
  const base = getTotals(data, marginMultiplier, pricing)
  const crewDays = computeTotalCrewDays(data)
  const cateringCost = data.includeCatering
    ? (data.cateringOverride ? safeNum(data.cateringCustomDays, 1, 1) : crewDays) * safeNum(data.cateringRate, 100, 0)
    : 0
  const lodgingCost = data.includeLodging
    ? (data.lodgingOverride ? safeNum(data.lodgingCustomDays, 1, 1) : crewDays) * safeNum(data.lodgingRate, 300, 0)
    : 0
  const sumaNetto = base.sumaNetto + cateringCost + lodgingCost
  return {
    sumaNetto,
    vat: sumaNetto * VAT_RATE,
    sumaBrutto: sumaNetto * (1 + VAT_RATE),
    cateringCost,
    lodgingCost,
  }
}

/**
 * Fazy wyceny z cateringiem i noclegami dopisanymi do „Dodatkowe" — to, co
 * pokazują zakładki kalkulatora i z czego powstają wiersze PDF.
 */
export function buildQuoteBreakdown(
  data: QuoteData,
  marginMultiplier: number,
  pricing: PricingConfigShape
): PhaseBreakdown[] {
  const { cateringCost, lodgingCost } = computeQuoteTotals(data, marginMultiplier, pricing)
  const baseBreakdown = getBreakdownWithPricing(data, marginMultiplier, pricing)
  if (!(cateringCost > 0 || lodgingCost > 0)) return baseBreakdown
  const autoCrewDays = computeTotalCrewDays(data)
  const phases = baseBreakdown.map((p) => ({ ...p, items: [...(p.items ?? [])] }))
  const dodIndex = phases.findIndex((p) => p.category === 'Dodatkowe')
  if (dodIndex === -1) return baseBreakdown
  const dod = phases[dodIndex]
  const extraItems: LineItemRow[] = []
  if (cateringCost > 0) {
    const qty = data.cateringOverride ? safeNum(data.cateringCustomDays, 1, 1) : autoCrewDays
    extraItems.push({
      label: 'Catering',
      value: `${qty} osobodni`,
      quantity: qty,
      unitPriceNet: data.cateringRate,
      lineNetto: cateringCost,
    })
  }
  if (lodgingCost > 0) {
    const qty = data.lodgingOverride ? safeNum(data.lodgingCustomDays, 1, 1) : autoCrewDays
    extraItems.push({
      label: 'Noclegi',
      value: `${qty} osobodni`,
      quantity: qty,
      unitPriceNet: data.lodgingRate,
      lineNetto: lodgingCost,
    })
  }
  const newItems = [...dod.items, ...extraItems]
  phases[dodIndex] = {
    ...dod,
    items: newItems,
    phaseNetto: newItems.reduce((s, i) => s + i.lineNetto, 0),
  }
  return phases
}

/** Minimalny kształt migawki potrzebny do policzenia finansów (jak `loadQuoteSnapshot`). */
export interface FinancialsSource {
  data?: Partial<QuoteData>
  pricingConfig?: unknown
  marginMultiplier?: number
  /** Szkic PDF wyceny (R2: suma PDF to zatwierdzona cena); brak / `null` = PDF idzie za kalkulatorem. */
  pdfDraft?: unknown
}

/**
 * Migawka finansowa projektu — liczona tak samo jak zakładka Profit.
 * Zwraca `null`, gdy migawka nie zawiera danych wyceny (nie ma czego liczyć).
 */
/**
 * Dane, cennik i marża migawki — dokładnie tak, jak wczytuje je kalkulator.
 * Każda migawka liczy się z WŁASNEGO cennika. `null` = brak danych wyceny.
 */
export function resolveSnapshot(
  snapshot: FinancialsSource | null | undefined
): { data: QuoteData; pricing: PricingConfigShape; margin: number } | null {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.data || typeof snapshot.data !== 'object') {
    return null
  }
  const data = mergeQuoteDataPartial(snapshot.data)
  const pricing =
    snapshot.pricingConfig && typeof snapshot.pricingConfig === 'object'
      ? migratePricingConfig(snapshot.pricingConfig as Record<string, Record<string, unknown>>)
      : DEFAULT_PRICING
  const margin =
    typeof snapshot.marginMultiplier === 'number' && Number.isFinite(snapshot.marginMultiplier)
      ? snapshot.marginMultiplier
      : 1
  return { data, pricing, margin }
}

/**
 * Dwa widoki wyceny (S3): `client` w walucie wyceny (ceny dla klienta,
 * kalkulator, PDF) i `cost` w PLN (plan kosztów, finanse). Wycena w PLN ma
 * oba widoki identyczne z danymi — te same obiekty.
 */
export interface QuoteViews {
  money: QuoteMoney
  client: { data: QuoteData; pricing: PricingConfigShape }
  cost: QuoteData
}

export function quoteViews(data: QuoteData, pricing: PricingConfigShape): QuoteViews {
  const money = quoteMoney(data)
  return {
    money,
    client: { data: clientQuoteData(data, money), pricing: clientPricing(pricing, money) },
    cost: costQuoteData(data, money),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Zatwierdzona cena (R2, C1): to, co pokazał PDF wybranego wariantu — w zł i w walucie dokumentu. */
export interface ApprovedPrice {
  /** W zł (EUR × kurs). */
  pln: number
  /** W walucie PDF (albo kalkulatora, gdy nie ma szkicu PDF). */
  amount: number
  currency: 'PLN' | 'EUR'
  /** Kurs, po którym policzono złotówki; `null` dla PLN. */
  rate: number | null
  /** `pdf` = suma szkicu PDF, `calculator` = wycena bez szkicu (PDF idzie za kalkulatorem). */
  source: 'pdf' | 'calculator'
  /** Netto kalkulatora w zł — do porównania („PDF różni się od kalkulatora" to normalne). */
  calculatorPln: number
}

/**
 * Suma szkicu PDF w zł. Wycena w EUR (S3): € × kurs zamrożony w wycenie (jak
 * każdy plan w EUR). Stary szkic EUR do wyceny w złotych (sprzed S3, przeliczany
 * tylko w PDF): € × kurs szkicu. `null` = nie ma szkicu PDF.
 */
export function pdfDraftTotalPln(
  pdfDraft: unknown,
  money: QuoteMoney
): { amount: number; currency: 'PLN' | 'EUR'; rate: number | null; pln: number } | null {
  if (!isRecord(pdfDraft) || !isRecord(pdfDraft.rows)) return null
  const amount = pdfRowsTotal(pdfDraft.rows as LocalPdfState['rows'])
  if (pdfDraft.currency !== 'EUR') return { amount, currency: 'PLN', rate: null, pln: amount }
  const draftRate = typeof pdfDraft.exchangeRate === 'number' && pdfDraft.exchangeRate > 0 ? pdfDraft.exchangeRate : DEFAULT_EXCHANGE_RATE
  const rate = money.currency === 'EUR' ? money.rate : draftRate
  return { amount, currency: 'EUR', rate, pln: amount * rate }
}

/** Zatwierdzona cena wyceny: suma PDF, a bez szkicu PDF — kalkulator (decyzja M.J. 13.2a/5). */
export function approvedPrice(data: QuoteData, pricing: PricingConfigShape, margin: number, pdfDraft?: unknown): ApprovedPrice {
  const views = quoteViews(data, pricing)
  const totals = computeQuoteTotals(views.client.data, margin, views.client.pricing)
  const calculatorPln = toPln(totals.sumaNetto, views.money)
  const pdf = pdfDraftTotalPln(pdfDraft, views.money)
  if (pdf) return { ...pdf, source: 'pdf', calculatorPln }
  const foreign = views.money.currency === 'EUR'
  return {
    pln: calculatorPln,
    amount: totals.sumaNetto,
    currency: foreign ? 'EUR' : 'PLN',
    rate: foreign ? views.money.rate : null,
    source: 'calculator',
    calculatorPln,
  }
}

/**
 * Plan wyceny w PLN: przychód, koszty, moja praca, zysk. Przychód (R2, C1) =
 * kwota przelewu wpisana ręcznie, a bez niej zatwierdzona cena — suma PDF albo
 * kalkulator. `sumaNettoPln` zostaje netto KALKULATORA (sprzęt, porównania).
 */
export function quotePlnPlan(data: QuoteData, pricing: PricingConfigShape, margin: number, pdfDraft?: unknown) {
  const views = quoteViews(data, pricing)
  const totals = computeQuoteTotals(views.client.data, margin, views.client.pricing)
  const sumaNettoPln = toPln(totals.sumaNetto, views.money)
  const approved = approvedPrice(data, pricing, margin, pdfDraft)
  const profit = resolveProfitSections(views.cost, pricing, computeTotalCrewDays(data))
  const typed = data.profitTransferAmount
  const revenueSource: 'transfer' | 'pdf' | 'calculator' = typed != null ? 'transfer' : approved.source
  const summary = computeProfitSummary(typed ?? approved.pln, data.profitTaxRatePercent, profit.totalCost)
  return {
    views,
    totals,
    sumaNettoPln,
    approved,
    revenueSource,
    sections: profit.sections,
    totalCost: profit.totalCost,
    ownWork: profit.ownWork,
    summary,
  }
}

export function computeSnapshotFinancials(
  snapshot: FinancialsSource | null | undefined,
  now: Date = new Date()
): ProjectFinancials | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved
  const { summary, ownWork, revenueSource } = quotePlnPlan(data, pricing, margin, snapshot?.pdfDraft)

  return {
    sumaNetto: summary.sumaNetto,
    koszty: summary.koszty,
    podatek: summary.podatek,
    zysk: summary.zysk,
    marzaPct: summary.marzaPct,
    computedAt: now.toISOString(),
    ...(ownWork > 0 ? { ownWork } : {}),
    revenueSource,
  }
}

export interface BackfillResult<P> {
  projects: P[]
  /** Ile projektów dostało policzone finanse. */
  filledCount: number
  /** Ile projektów wciąż nie ma finansów (migawka bez danych wyceny). */
  skippedCount: number
}

/**
 * Uzupełnia finanse WYŁĄCZNIE tam, gdzie ich nie ma (`financials === null`).
 *
 * Istniejących migawek nigdy nie przelicza — to zamrożona księga (patrz
 * `projectFinancialsSchema`). Każdy projekt liczony jest z WŁASNEGO cennika
 * zapisanego w migawce, nie z bieżącego, więc wynik odpowiada temu, co
 * pokazałby kalkulator w dniu zapisu.
 */
export function backfillMissingFinancials<
  P extends { financials: ProjectFinancials | null; quote: unknown }
>(projects: P[], now: Date = new Date()): BackfillResult<P> {
  let filledCount = 0
  let skippedCount = 0
  const next = projects.map((project) => {
    // Projekt bez wyceny (`quote: null`) to nie błąd danych — nie liczymy go jako pominiętego.
    if (project.financials || !project.quote) return project
    const financials = computeSnapshotFinancials(project.quote as FinancialsSource, now)
    if (!financials) {
      skippedCount += 1
      return project
    }
    filledCount += 1
    return { ...project, financials }
  })
  return { projects: next, filledCount, skippedCount }
}
