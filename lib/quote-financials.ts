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

import { defaultQuoteData, type QuoteData, type ShootingDay } from './quote-types'
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

/** Plan wyceny w PLN: przychód (suma × kurs albo kwota przelewu), koszty, zysk. */
export function quotePlnPlan(data: QuoteData, pricing: PricingConfigShape, margin: number) {
  const views = quoteViews(data, pricing)
  const totals = computeQuoteTotals(views.client.data, margin, views.client.pricing)
  const sumaNettoPln = toPln(totals.sumaNetto, views.money)
  const profit = resolveProfitSections(views.cost, pricing, computeTotalCrewDays(data))
  const summary = computeProfitSummary(data.profitTransferAmount ?? sumaNettoPln, data.profitTaxRatePercent, profit.totalCost)
  return { views, totals, sumaNettoPln, sections: profit.sections, totalCost: profit.totalCost, summary }
}

export function computeSnapshotFinancials(
  snapshot: FinancialsSource | null | undefined,
  now: Date = new Date()
): ProjectFinancials | null {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return null
  const { data, pricing, margin } = resolved
  const { summary } = quotePlnPlan(data, pricing, margin)

  return {
    sumaNetto: summary.sumaNetto,
    koszty: summary.koszty,
    podatek: summary.podatek,
    zysk: summary.zysk,
    marzaPct: summary.marzaPct,
    computedAt: now.toISOString(),
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
