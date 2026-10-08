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
import { getTotals } from './quote-calc'
import { computeProfitSummary, resolveProfitSections } from './profit-calc'
import { safeArray, safeNum } from './safe-numbers'
import type { ProjectFinancials } from './project-types'

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
      day.statysta,
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
export function computeSnapshotFinancials(
  snapshot: FinancialsSource | null | undefined,
  now: Date = new Date()
): ProjectFinancials | null {
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

  const totals = computeQuoteTotals(data, margin, pricing)
  const { totalCost } = resolveProfitSections(data, pricing, computeTotalCrewDays(data))
  const transferAmount = data.profitTransferAmount ?? totals.sumaNetto
  const summary = computeProfitSummary(transferAmount, data.profitTaxRatePercent, totalCost)

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
    if (project.financials) return project
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
